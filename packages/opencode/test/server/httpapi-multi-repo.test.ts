import { afterEach, describe, expect, test } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Context, Effect } from "effect"
import fs from "fs/promises"
import path from "path"
import { Agent } from "../../src/agent/agent"
import { InstanceRef } from "../../src/effect/instance-ref"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Format } from "../../src/format"
import { LSP } from "../../src/lsp/lsp"
import type { InstanceContext } from "../../src/project/instance-context"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { FilePaths } from "../../src/server/routes/instance/httpapi/groups/file"
import { Instruction } from "../../src/session/instruction"
import { MessageID, SessionID } from "../../src/session/schema"
import { ReadTool } from "../../src/tool/read"
import { Truncate } from "../../src/tool/truncate"
import { WriteTool } from "../../src/tool/write"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir, withTestInstance } from "../fixture/fixture"

const context = Context.empty() as Context.Context<unknown>

// Goes through the real HttpApi app, the same way the TUI/web clients add and inspect roots.
async function request(method: string, route: string, directory: string, body?: unknown) {
  const response = await HttpApiApp.webHandler().handler(
    new Request(new URL(`http://localhost${route}`), {
      method,
      headers: { "x-opencode-directory": directory, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    context,
  )
  return { status: response.status, body: await response.json() }
}

const layer = LayerNode.compile(
  LayerNode.group([
    Agent.node,
    FSUtil.node,
    CrossSpawnSpawner.node,
    Instruction.node,
    LSP.node,
    Ripgrep.node,
    Truncate.node,
    EventV2Bridge.node,
    Format.node,
  ]),
)

// Runs tools against the same app-runtime instance the HTTP routes use, so root changes are visible.
function tools<A>(
  instance: InstanceContext,
  fn: (tools: {
    read: Effect.Success<ReturnType<Effect.Success<typeof ReadTool>["init"]>>
    write: Effect.Success<ReturnType<Effect.Success<typeof WriteTool>["init"]>>
  }) => Effect.Effect<A>,
) {
  return Effect.gen(function* () {
    const read = yield* (yield* ReadTool).init()
    const write = yield* (yield* WriteTool).init()
    return yield* fn({ read, write })
  }).pipe(Effect.scoped, Effect.provide(layer), Effect.provideService(InstanceRef, instance), Effect.runPromise)
}

function toolContext(asked: string[] = []) {
  return {
    sessionID: SessionID.make("ses_multi_repo"),
    messageID: MessageID.make("msg_multi_repo"),
    callID: "",
    agent: "build",
    abort: AbortSignal.any([]),
    messages: [],
    metadata: () => Effect.void,
    ask: (input: { permission: string }) => Effect.sync(() => void asked.push(input.permission)),
  }
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("multi-repo project roots", () => {
  test("add a second repo, read from repo 1 and write to repo 2 in one session", async () => {
    await using a = await tmpdir({ git: true })
    await using b = await tmpdir({ git: true })
    const realB = await fs.realpath(b.path)
    // Identically named files in both repos must stay distinguishable.
    await Bun.write(path.join(a.path, "main.py"), "print('repo a')\n")
    await Bun.write(path.join(b.path, "main.py"), "print('repo b')\n")

    const project = await request("GET", "/project/current", a.path)
    expect(project.body.roots ?? []).toEqual([])
    const updated = await request("PATCH", `/project/${project.body.id}`, a.path, { roots: [b.path] })
    expect(updated.status).toBe(200)
    expect(updated.body.roots).toEqual([realB])

    await withTestInstance({
      directory: a.path,
      fn: async (instance) => {
        expect(instance.project.roots).toEqual([realB])
        const aliasA = path.basename(instance.worktree)
        const aliasB = path.basename(realB)
        const asked: string[] = []

        const result = await tools(instance, (t) =>
          Effect.gen(function* () {
            const fromA = yield* t.read.execute({ filePath: path.join(aliasA, "main.py") }, toolContext(asked))
            const toB = yield* t.write.execute(
              { filePath: path.join(aliasB, "main.py"), content: "print('written to repo b')\n" },
              toolContext(asked),
            )
            return { fromA, toB }
          }),
        )

        expect(result.fromA.output).toContain("print('repo a')")
        expect(result.fromA.title).toBe(path.join(aliasA, "main.py"))
        expect(result.toB.title).toBe(path.join(aliasB, "main.py"))
        expect(asked).not.toContain("external_directory")
        expect(await Bun.file(path.join(b.path, "main.py")).text()).toBe("print('written to repo b')\n")
        expect(await Bun.file(path.join(a.path, "main.py")).text()).toBe("print('repo a')\n")
      },
    })

    const list = await request("GET", `${FilePaths.list}?path=.`, a.path)
    expect(list.body).toContainEqual(
      expect.objectContaining({ name: path.basename(realB), absolute: realB, type: "directory" }),
    )
    const content = await request("GET", `${FilePaths.content}?path=${path.basename(realB)}/main.py`, a.path)
    expect(content.body).toMatchObject({ type: "text", content: "print('written to repo b')" })

    // Removing the root takes it back out of the project.
    const removed = await request("PATCH", `/project/${project.body.id}`, a.path, { roots: [] })
    expect(removed.body.roots).toEqual([])
  })

  test("single repo sessions keep worktree relative paths", async () => {
    await using a = await tmpdir({ git: true })
    await Bun.write(path.join(a.path, "main.py"), "print('repo a')\n")

    await withTestInstance({
      directory: a.path,
      fn: async (instance) => {
        const result = await tools(instance, (t) => t.read.execute({ filePath: "main.py" }, toolContext()))
        expect(result.title).toBe("main.py")
        expect(result.output).toContain("print('repo a')")
      },
    })
  })
})
