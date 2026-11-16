import { describe, expect } from "bun:test"
import fc from "fast-check"
import { Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Session } from "@/session/session"
import { MessageID, PartID } from "@/session/schema"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceStore } from "@/project/instance-store"
import { InstanceBootstrap } from "@/project/bootstrap"
import { orderIDsByFolder, sessionFolderLabel } from "../../../tui/src/component/session-folder"
import { testEffect } from "../lib/effect"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      Session.node,
      EventV2Bridge.node,
      SessionProjector.node,
      CrossSpawnSpawner.node,
      InstanceStore.node,
      Database.node,
    ]),
    [
      [RuntimeFlags.node, RuntimeFlags.layer({ experimentalWorkspaces: false })],
      [
        InstanceBootstrap.node,
        Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void })),
      ],
    ],
  ),
)

// Include empty/whitespace strings, repeated content, Unicode and multiline text.
// Small histories keep 100 database-backed examples per property affordable.
const text = fc.oneof(fc.string({ maxLength: 60 }), fc.constantFrom("", " ", "مرحبا", "🙂", "line 1\nline 2"))
const conversation = fc.record({ title: text, messages: fc.array(text, { maxLength: 5 }) })
const archiveTime = fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 2_000_000_000_000 }))

// Capture the real Effect services/instance once; fast-check can then replay and
// shrink each asynchronous example inside that same scoped test environment.
function check<A, E, R>(id: string, input: fc.Arbitrary<A>, property: (value: A) => Effect.Effect<void, E, R>) {
  return Effect.gen(function* () {
    const context = yield* Effect.context<R>()
    yield* Effect.promise(() =>
      fc.assert(
        fc.asyncProperty(input, (value) => Effect.runPromiseWith(context)(property(value))),
        { numRuns: 100 },
      ),
    )
    console.info(`[P4B archive] ${id}: 100 generated examples passed`)
  })
}

function withSessions<A, E, R>(
  input: { title: string; messages: string[] }[],
  body: (sessions: Session.Info[]) => Effect.Effect<A, E, R>,
) {
  return Effect.gen(function* () {
    const session = yield* Session.Service
    return yield* Effect.acquireUseRelease(
      Effect.forEach(input, (value) => session.create({ title: value.title })),
      (sessions) =>
        Effect.gen(function* () {
          yield* Effect.forEach(sessions, (info, index) =>
            Effect.forEach(input[index]!.messages, (content) =>
              Effect.gen(function* () {
                const id = MessageID.ascending()
                yield* session.updateMessage({
                  id,
                  sessionID: info.id,
                  role: "user",
                  time: { created: Date.now() },
                  agent: "test",
                  model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
                })
                yield* session.updatePart({
                  id: PartID.ascending(),
                  sessionID: info.id,
                  messageID: id,
                  type: "text",
                  text: content,
                })
              }),
            ),
          )
          return yield* body(sessions)
        }),
      (sessions) => Effect.forEach(sessions, (info) => session.remove(info.id), { discard: true }),
    )
  })
}

function snapshot(info: Session.Info) {
  return Effect.gen(function* () {
    const session = yield* Session.Service
    return { info: yield* session.get(info.id), messages: yield* session.messages({ sessionID: info.id }) }
  })
}

describe("archive properties", () => {
  // R1: Archiving/restoring preserves title and complete message history/order.
  // Kind: round-trip.
  it.instance(
    "R1 [round-trip]: archive and restore preserve the conversation",
    () =>
      check("R1", fc.tuple(conversation, archiveTime), ([value, time]) =>
        withSessions([value], ([info]) =>
          Effect.gen(function* () {
            const session = yield* Session.Service
            const before = yield* snapshot(info!)
            expect(
              before.messages.flatMap((message) =>
                message.parts.map((part) => (part.type === "text" ? part.text : "")),
              ),
            ).toEqual(value.messages)
            yield* session.setArchived({ sessionID: info!.id, time })
            expect((yield* session.get(info!.id)).time.archived).toBe(time)
            expect(yield* session.messages({ sessionID: info!.id })).toEqual(before.messages)
            yield* session.setArchived({ sessionID: info!.id })
            const after = yield* snapshot(info!)
            expect(after.info.id).toBe(before.info.id)
            expect(after.info.title).toBe(value.title)
            expect(after.info.time.archived).toBeUndefined()
            expect(after.messages).toEqual(before.messages)
          }),
        ),
      ),
    { git: true },
  )

  // R2: Operations select a unique ID and leave other sessions unaffected.
  // Kind: metamorphic. Repeat the same operation after making titles identical;
  // the targeted ID and the unaffected session's full snapshot must stay the same.
  it.instance(
    "R2 [metamorphic]: duplicate titles do not change which session is restored",
    () =>
      check("R2", fc.tuple(conversation, conversation, archiveTime, fc.boolean()), ([a, b, time, otherArchived]) =>
        withSessions(
          [
            { ...a, title: `A:${a.title}` },
            { ...b, title: `B:${b.title}` },
          ],
          ([target, other]) =>
            Effect.gen(function* () {
              const session = yield* Session.Service
              if (otherArchived) yield* session.setArchived({ sessionID: other!.id, time })
              for (const duplicate of [false, true]) {
                if (duplicate) yield* session.setTitle({ sessionID: other!.id, title: target!.title })
                const before = yield* snapshot(other!)
                yield* session.setArchived({ sessionID: target!.id, time })
                expect((yield* session.get(target!.id)).time.archived).toBe(time)
                expect(yield* snapshot(other!)).toEqual(before)
                yield* session.setArchived({ sessionID: target!.id })
                expect((yield* session.get(target!.id)).time.archived).toBeUndefined()
                expect(yield* snapshot(other!)).toEqual(before)
              }
            }),
        ),
      ),
    { git: true },
  )

  // R4: Restore moves the original session into the active list exactly once and
  // removes it from the archive. Kind: invariant, checked after every operation.
  // Generate mixed initial states and repeated restores, including archive time 0.
  it.instance(
    "R4 [invariant]: sessions belong to exactly one list without duplicates",
    () =>
      check(
        "R4",
        fc.record({
          states: fc.array(fc.boolean(), { minLength: 1, maxLength: 5 }),
          operations: fc.array(fc.record({ index: fc.nat({ max: 20 }), archive: fc.boolean(), time: archiveTime }), {
            minLength: 1,
            maxLength: 8,
          }),
        }),
        ({ states, operations }) =>
          withSessions(
            states.map(() => ({ title: "same title", messages: [] })),
            (sessions) =>
              Effect.gen(function* () {
                const session = yield* Session.Service
                const archived = new Set(states.flatMap((value, index) => (value ? [sessions[index]!.id] : [])))
                yield* Effect.forEach(
                  sessions.filter((info) => archived.has(info.id)),
                  (info) => session.setArchived({ sessionID: info.id, time: 0 }),
                )
                // Always exercise a restore, even when all generated operations archive.
                for (const operation of [...operations, { index: 0, archive: false, time: 0 }]) {
                  const target = sessions[operation.index % sessions.length]!
                  yield* session.setArchived({
                    sessionID: target.id,
                    time: operation.archive ? operation.time : undefined,
                  })
                  if (operation.archive) archived.add(target.id)
                  else archived.delete(target.id)
                  const active = yield* session.list({ archived: false })
                  const inactive = yield* session.list({ archived: true })
                  expect(active.map((info) => info.id).toSorted()).toEqual(
                    sessions
                      .filter((info) => !archived.has(info.id))
                      .map((info) => info.id)
                      .toSorted(),
                  )
                  expect(inactive.map((info) => info.id).toSorted()).toEqual([...archived].toSorted())
                }
              }),
          ),
      ),
    { git: true },
  )

  // R6 (revised): Restored sessions lead their unpinned folder group when all
  // other updates precede restoration. Kind: model/oracle.
  // Past timestamps include ties; equal-time peers have no promised ID order.
  it.instance(
    "R6 [model/oracle]: restored session leads its recency group",
    () =>
      check(
        "R6",
        fc.record({
          ages: fc.array(fc.integer({ min: 1, max: 100_000 }), { minLength: 2, maxLength: 5 }),
          folder: text,
          index: fc.nat({ max: 20 }),
        }),
        ({ ages, folder, index }) =>
          withSessions(
            ages.map(() => ({ title: "recency", messages: [] })),
            (sessions) =>
              Effect.gen(function* () {
                const session = yield* Session.Service
                const database = yield* Database.Service
                const base = Date.now() - 60_000
                yield* Effect.forEach(sessions, (info, i) =>
                  database.db
                    .update(SessionTable)
                    .set({ time_updated: base - ages[i]!, folder })
                    .where(eq(SessionTable.id, info.id))
                    .run(),
                )
                const target = sessions[index % sessions.length]!
                const before = yield* session.get(target.id)
                yield* session.setArchived({ sessionID: target.id, time: 0 })
                const started = Date.now()
                yield* session.setArchived({ sessionID: target.id })
                const restored = yield* session.get(target.id)
                expect(restored.time.updated).toBeGreaterThan(before.time.updated)
                expect(restored.time.updated).toBeGreaterThanOrEqual(started)
                const active = yield* session.list({ archived: false })
                const expectedTimes = [
                  restored.time.updated,
                  ...ages
                    .filter((_, i) => sessions[i]!.id !== target.id)
                    .map((age) => base - age)
                    .sort((a, b) => b - a),
                ]
                expect(active[0]?.id).toBe(target.id)
                expect(active.map((info) => info.time.updated)).toEqual(expectedTimes)
                expect(active.map((info) => info.id).toSorted()).toEqual(sessions.map((info) => info.id).toSorted())
                expect(
                  orderIDsByFolder(
                    active.map((info) => info.id),
                    () => sessionFolderLabel(folder),
                  ),
                ).toEqual(active.map((info) => info.id))
              }),
          ),
      ),
    { git: true },
  )
})
