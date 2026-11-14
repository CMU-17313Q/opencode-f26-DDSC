import { afterAll, expect } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtempSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Database } from "@opencode-ai/core/database/database"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Effect, Layer } from "effect"
import fc from "fast-check"
import { Session as SessionNs } from "@/session/session"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceStore } from "@/project/instance-store"
import { InstanceBootstrap } from "@/project/bootstrap"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { MessageID, PartID, type SessionID } from "@/session/schema"
import { provideInstance, tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const noopBootstrap = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))

const appLayer = (dbFile: string) =>
  AppNodeBuilder.build(
    LayerNode.group([
      SessionNs.node,
      EventV2Bridge.node,
      SessionProjector.node,
      CrossSpawnSpawner.node,
      InstanceStore.node,
    ]),
    [
      [RuntimeFlags.node, RuntimeFlags.layer({ experimentalWorkspaces: false })],
      [InstanceBootstrap.node, noopBootstrap],
      [Database.node, Database.layerFromPath(dbFile)],
    ],
  )

const dbRoot = mkdtempSync(path.join(os.tmpdir(), "opencode-folder-property-"))
const it = testEffect(appLayer(path.join(dbRoot, "opencode.sqlite")))

afterAll(async () => {
  await fs.rm(dbRoot, { recursive: true, force: true })
})

// Folder labels
const folder = fc.constantFrom("Work", "Play", "Personal")

// Operations bias toward interesting membership changes: moves, clears,
// repeated moves to the same folder, and clearing an already-empty session.
type FolderOp = { type: "move"; target: number; folder: string } | { type: "clear"; target: number }

const folderOp: fc.Arbitrary<FolderOp> = fc.oneof(
  fc.record({ type: fc.constant("move" as const), target: fc.nat({ max: 5 }), folder }),
  fc.record({ type: fc.constant("clear" as const), target: fc.nat({ max: 5 }) }),
)

const folderOps = fc.array(folderOp, { minLength: 1, maxLength: 12 })

// Contexts include empty, single-message, multi-message, and multi-part cases.
const text = fc.oneof(fc.string({ maxLength: 80 }), fc.constantFrom("", "hello", "line\nbreak", "x".repeat(200)))
const context = fc.array(fc.array(text, { maxLength: 3 }), { maxLength: 4 })
const multiContexts = fc.array(context, { minLength: 2, maxLength: 5 })
const anyContexts = fc.array(context, { minLength: 1, maxLength: 5 })

const applyFolderOp = (session: SessionNs.Interface, info: SessionNs.Info, op: FolderOp) =>
  op.type === "move"
    ? session.setFolder({ sessionID: info.id, folder: op.folder })
    : session.setFolder({ sessionID: info.id, folder: undefined })

const seedContext = (session: SessionNs.Interface, sessionID: SessionID, groups: string[][]) =>
  Effect.gen(function* () {
    for (const texts of groups) {
      const message = yield* session.updateMessage({
        id: MessageID.ascending(),
        sessionID,
        role: "user",
        time: { created: Date.now() },
        agent: "user",
        model: { providerID: "test", modelID: "test" },
        tools: {},
        mode: "",
      } as unknown as SessionV1.Info)
      for (const text of texts) {
        yield* session.updatePart({
          id: PartID.ascending(),
          sessionID,
          messageID: message.id,
          type: "text",
          text,
        })
      }
    }
  })

const contextSnapshot = (session: SessionNs.Interface, sessionID: SessionID) =>
  session.messages({ sessionID }).pipe(
    Effect.orDie,
    Effect.map((messages) => JSON.stringify(messages)),
  )

const createSessions = (session: SessionNs.Interface, contexts: string[][][], prefix: string) =>
  Effect.gen(function* () {
    const infos: SessionNs.Info[] = []
    for (let i = 0; i < contexts.length; i++) {
      const info = yield* Effect.acquireRelease(session.create({ title: `${prefix}-${i}` }), (created) =>
        session.remove(created.id).pipe(Effect.ignore),
      )
      yield* seedContext(session, info.id, contexts[i] ?? [])
      infos.push(info)
    }
    return infos
  })

const workspaceSnapshot = async (root: string) => {
  const files: Array<readonly [string, string]> = []
  const visit = async (directory: string) => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      // Workspace-only snapshot: ignore opencode metadata and VCS internals.
      if (entry.name === ".git" || entry.name === ".opencode") continue
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(file)
        continue
      }
      if (!entry.isFile()) continue
      const content = await fs.readFile(file)
      files.push([path.relative(root, file), createHash("sha256").update(content).digest("hex")] as const)
    }
  }
  await visit(root)
  return files.sort((a, b) => a[0].localeCompare(b[0]))
}

const seedWorkspace = async (root: string) => {
  await fs.mkdir(path.join(root, "src", "nested"), { recursive: true })
  await fs.writeFile(path.join(root, "README.md"), "# fixture\n")
  await fs.writeFile(path.join(root, "src", "nested", "empty.txt"), "")
  await fs.writeFile(path.join(root, "src", "binary.bin"), Buffer.from([0, 1, 2, 255]))
  await fs.writeFile(path.join(root, "src", "unicode.txt"), "héllo 世界 🙂\n")
}

const inAppLayer = <A>(dbFile: string, directory: string, effect: Effect.Effect<A, never, SessionNs.Service>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const context = yield* Layer.build(appLayer(dbFile))
      return yield* InstanceStore.Service.use((store) => store.provide({ directory }, effect)).pipe(
        Effect.provide(context),
      )
    }),
  )

// R1: When a session is added/removed from a folder no other sessions' context should be changed.
// Kind: invariant
// Generators: move/clear sequences target every session while two to five
// contexts give every non-target session a full message/part snapshot to preserve.
it.live("R1 [invariant]: folder moves leave other sessions' context unchanged", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped({ git: true })
    yield* Effect.gen(function* () {
      const context = yield* Effect.context()
      const run = (effect: Effect.Effect<void, never, SessionNs.Service>) =>
        Effect.runPromise(effect.pipe(Effect.provide(context)) as Effect.Effect<void, never, never>)
      yield* Effect.promise(() =>
        fc.assert(
          fc.asyncProperty(fc.tuple(multiContexts, folderOps), async ([specs, ops]) => {
            await run(
              Effect.scoped(
                Effect.gen(function* () {
                  const session = yield* SessionNs.Service
                  const infos = yield* createSessions(session, specs, "r1")
                  const baselines = new Map<string, string>()
                  for (const info of infos) baselines.set(info.id, yield* contextSnapshot(session, info.id))
                  for (const op of ops) {
                    const target = infos[op.target % infos.length]!
                    yield* applyFolderOp(session, target, op)
                    for (const info of infos) {
                      if (info.id === target.id) continue
                      expect(yield* contextSnapshot(session, info.id)).toBe(baselines.get(info.id)!)
                    }
                  }
                }),
              ),
            )
          }),
          { numRuns: 20 },
        ),
      )
    }).pipe(provideInstance(directory))
  }),
)

// R2: When a session is added/removed from a folder, the codebase shouldn’t be changed.
// Kind: invariant
// Generators: operation sequences vary while the workspace fixture stays fixed
// with nested, empty, binary, and Unicode files so snapshots catch any file change.
it.live("R2 [invariant]: folder moves leave the codebase unchanged", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped({ git: true })
    yield* Effect.promise(() => seedWorkspace(directory))
    yield* Effect.gen(function* () {
      const context = yield* Effect.context()
      const run = (effect: Effect.Effect<void, never, SessionNs.Service>) =>
        Effect.runPromise(effect.pipe(Effect.provide(context)) as Effect.Effect<void, never, never>)
      yield* Effect.promise(() =>
        fc.assert(
          fc.asyncProperty(fc.tuple(fc.integer({ min: 1, max: 4 }), folderOps), async ([count, ops]) => {
            await run(
              Effect.scoped(
                Effect.gen(function* () {
                  const session = yield* SessionNs.Service
                  const infos = yield* createSessions(
                    session,
                    Array.from({ length: count }, () => []),
                    "r2",
                  )
                  const before = yield* Effect.promise(() => workspaceSnapshot(directory))
                  for (const op of ops) {
                    const target = infos[op.target % infos.length]!
                    yield* applyFolderOp(session, target, op)
                    expect(yield* Effect.promise(() => workspaceSnapshot(directory))).toEqual(before)
                  }
                }),
              ),
            )
          }),
          { numRuns: 20 },
        ),
      )
    }).pipe(provideInstance(directory))
  }),
)

// R3: When a session is added/removed from a folder, the session’s context shouldn’t be changed.
// Kind: invariant
// Generators: one to five contexts range from empty to multi-message and
// multi-part, and move/clear sequences repeatedly target the same session.
it.live("R3 [invariant]: folder moves leave the session's context unchanged", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped({ git: true })
    yield* Effect.gen(function* () {
      const context = yield* Effect.context()
      const run = (effect: Effect.Effect<void, never, SessionNs.Service>) =>
        Effect.runPromise(effect.pipe(Effect.provide(context)) as Effect.Effect<void, never, never>)
      yield* Effect.promise(() =>
        fc.assert(
          fc.asyncProperty(fc.tuple(anyContexts, folderOps), async ([specs, ops]) => {
            await run(
              Effect.scoped(
                Effect.gen(function* () {
                  const session = yield* SessionNs.Service
                  const infos = yield* createSessions(session, specs, "r3")
                  const baselines = new Map<string, string>()
                  for (const info of infos) baselines.set(info.id, yield* contextSnapshot(session, info.id))
                  for (const op of ops) {
                    const target = infos[op.target % infos.length]!
                    yield* applyFolderOp(session, target, op)
                    expect(yield* contextSnapshot(session, target.id)).toBe(baselines.get(target.id)!)
                  }
                }),
              ),
            )
          }),
          { numRuns: 20 },
        ),
      )
    }).pipe(provideInstance(directory))
  }),
)

// R5: The organisation of sessions in folders shouldn’t change after closing and reopening Opencode.
// Kind: round-trip
// Generators: each case starts with at least one folder, then mixes null,
// repeated, and shared folder labels across sessions
// Checks that the underlying database retains the folder assignment after closing the DB layer
it.live("R5 [round-trip]: close and reopen preserves folder organization", () =>
  Effect.gen(function* () {
    const workspace = yield* tmpdirScoped({ git: true })
    const root = yield* tmpdirScoped()
    yield* Effect.promise(() =>
      fc.assert(
        fc.asyncProperty(
          fc
            .tuple(folder, fc.array(fc.oneof(folder, fc.constant(null)), { maxLength: 4 }))
            .map(([first, rest]) => [first, ...rest] as Array<string | null>),
          async (assignments) => {
            const caseDir = await fs.mkdtemp(path.join(root, "case-"))
            const dbFile = path.join(caseDir, "opencode.sqlite")
            const expected = await Effect.runPromise(
              inAppLayer(
                dbFile,
                workspace,
                Effect.gen(function* () {
                  const session = yield* SessionNs.Service
                  const folders = new Map<SessionID, string | null>()
                  for (let i = 0; i < assignments.length; i++) {
                    const info = yield* session.create({ title: `r5-${i}` })
                    const value = assignments[i] ?? null
                    if (value) yield* session.setFolder({ sessionID: info.id, folder: value })
                    folders.set(info.id, value)
                  }
                  return folders
                }),
              ),
            )
            const actual = await Effect.runPromise(
              inAppLayer(
                dbFile,
                workspace,
                SessionNs.Service.use((session) =>
                  session
                    .list()
                    .pipe(Effect.map((infos) => new Map(infos.map((info) => [info.id, info.folder ?? null])))),
                ),
              ),
            )
            expect(actual).toEqual(expected)
          },
        ),
        { numRuns: 12 },
      ),
    )
  }),
)
