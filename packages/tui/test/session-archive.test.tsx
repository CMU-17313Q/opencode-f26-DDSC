import { expect, mock, test } from "bun:test"
import type { Session } from "@opencode-ai/sdk/v2"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createTestRenderer } from "@opentui/core/testing"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Global } from "@opencode-ai/core/global"
import { createTuiResolvedConfig } from "./fixture/tui-runtime"
import { createEventSource, createFetch, directory, json } from "./fixture/tui-sdk"

function session(id: string, title: string, archived?: number): Session {
  return {
    id,
    title,
    slug: id,
    projectID: "project",
    directory,
    version: "test",
    time: { created: Date.now() - 2000, updated: Date.now() - 1000, archived },
  }
}

async function mount(sessions: Session[]) {
  const screen = await createTestRenderer({ width: 100, height: 30, useThread: false, kittyKeyboard: true })
  const core = await import("@opentui/core")
  mock.module("@opentui/core", () => ({ ...core, createCliRenderer: async () => screen.renderer }))
  const events = createEventSource()
  const fallback = createFetch()
  const requests: { id: string; archived: number | null }[] = []
  const state = { fail: false, pending: undefined as Promise<void> | undefined }
  let api: TuiPluginApi | undefined
  let disposeSlots: (() => void) | undefined
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    const url = new URL(request.url)
    if (url.pathname === "/provider")
      return json({ all: [{ id: "test", name: "Test", models: {} }], default: {}, connected: ["test"] })
    if (url.pathname === "/config/providers")
      return json({ providers: [{ id: "test", name: "Test", models: {} }], default: {} })
    if (url.pathname === "/agent") return json([{ name: "build", mode: "primary", options: {}, permission: [] }])
    if (url.pathname === "/session") {
      const archived = url.searchParams.get("archived")
      return json(
        sessions.filter((s) => archived === null || (s.time.archived !== undefined) === (archived === "true")),
      )
    }
    const id = url.pathname.match(/^\/session\/([^/]+)$/)?.[1]
    if (id) {
      const item = sessions.find((s) => s.id === id)
      if (!item) return json({ message: "Missing session" }, { status: 404 })
      if (request.method === "PATCH") {
        const body = await request.json()
        requests.push({ id, archived: body.time.archived })
        await state.pending
        if (state.fail) return json({ message: "Unable to update session" }, { status: 500 })
        item.time.archived = body.time.archived ?? undefined
        if (body.time.archived === null) item.time.updated = Date.now()
        events.emit({
          directory,
          payload: {
            id: `event-${requests.length}`,
            type: "session.updated",
            properties: { sessionID: item.id, info: structuredClone(item) },
          },
        })
      }
      return json(item)
    }
    if (/^\/session\/[^/]+\/(message|todo|diff)$/.test(url.pathname)) return json([])
    return fallback.fetch(input, init)
  }) as typeof globalThis.fetch
  const { run } = await import("../src/app")
  const task = Effect.runPromise(
    run({
      url: "http://test",
      directory,
      fetch,
      events: events.source,
      config: createTuiResolvedConfig({ plugin_enabled: {}, mouse: true }),
      args: {},
      pluginHost: {
        async start(input) {
          api = input.api
          disposeSlots = input.runtime.setupSlots(input.api).dispose
        },
        async dispose() {
          disposeSlots?.()
        },
      },
    }).pipe(Effect.provide(AppNodeBuilder.build(Global.node))),
  )

  async function wait(predicate: () => boolean) {
    const start = Date.now()
    while (!predicate()) {
      if (Date.now() - start > 5000) throw new Error(`Condition not met:\n${screen.captureCharFrame()}`)
      await screen.renderOnce()
      await Bun.sleep(10)
    }
    await screen.renderOnce()
  }
  await wait(() => !!api)
  return {
    ...screen,
    requests,
    state,
    sessions,
    api: api!,
    wait,
    async text(value: string) {
      await wait(() => screen.captureCharFrame().includes(value))
    },
    async [Symbol.asyncDispose]() {
      screen.renderer.destroy()
      await task
      mock.restore()
    },
  }
}

test("archive command on home reports an error without updating any session", async () => {
  await using app = await mount([])
  app.api.keymap.dispatchCommand("session.archive")
  await app.text("Open a session to archive it")
  expect(app.requests).toEqual([])
})

test("empty archive picker hides search and switches to active sessions with the keyboard", async () => {
  await using app = await mount([session("active", "Active conversation")])
  app.api.keymap.dispatchCommand("session.archived")
  await app.text("Archived sessions")
  await app.text("No results found")
  expect(app.captureCharFrame()).not.toContain("Search")
  app.mockInput.pressKey("h", { ctrl: true, shift: true })
  await app.text("Active conversation")
  expect(app.captureCharFrame()).toContain("Search")
  app.mockInput.pressKey("h", { ctrl: true, shift: true })
  await app.text("Archived sessions")
  app.mockInput.pressEscape()
  await app.wait(() => !app.captureCharFrame().includes("Archived sessions"))
  expect(app.requests).toEqual([])
})

test("Enter restores a selected archived session and leaves active sessions unchanged", async () => {
  const active = session("active", "Active conversation")
  const before = structuredClone(active)
  await using app = await mount([active, session("archived", "Archived conversation", 1)])
  app.api.keymap.dispatchCommand("session.archived")
  await app.text("Archived conversation")
  expect(app.captureCharFrame()).not.toContain("Active conversation")
  app.mockInput.pressEnter()
  await app.text("Session restored")
  expect(app.requests).toEqual([{ id: "archived", archived: null }])
  expect(active).toEqual(before)
  await app.text("No results found")
  app.mockInput.pressKey("h", { ctrl: true, shift: true })
  await app.text("Archived conversation")
  const frame = app.captureCharFrame()
  expect(frame.indexOf("Archived conversation")).toBeLessThan(frame.indexOf("Active conversation"))
})

for (const action of ["shortcut", "mouse"] as const) {
  test(`${action} restores an archived session without changing the open conversation`, async () => {
    await using app = await mount([
      session("active", "Keep this conversation"),
      session("archived", "Restore this conversation", 1),
    ])
    app.api.route.navigate("session", { sessionID: "active" })
    await app.wait(() => app.api.route.current.name === "session")
    const route = structuredClone(app.api.route.current)
    app.api.keymap.dispatchCommand("session.archived")
    await app.text("Restore this conversation")
    if (action === "shortcut") app.mockInput.pressKey("u", { ctrl: true, shift: true })
    if (action === "mouse") {
      const rows = app.captureCharFrame().split("\n")
      const y = rows.findIndex((row) => row.includes("Restore this conversation"))
      await app.mockMouse.click(rows[y].indexOf("Restore this conversation") + 2, y)
    }
    await app.text("Session restored")
    expect(app.requests).toEqual([{ id: "archived", archived: null }])
    expect(app.api.route.current).toEqual(route)
  })
}

test("failed restoration keeps the entry visible and allows retry", async () => {
  await using app = await mount([session("archived", "Retry this conversation", 1)])
  app.state.fail = true
  app.api.keymap.dispatchCommand("session.archived")
  await app.text("Retry this conversation")
  app.mockInput.pressEnter()
  await app.text("Unable to update session")
  expect(app.sessions[0].time.archived).toBe(1)
  expect(app.captureCharFrame()).toContain("Retry this conversation")
  app.state.fail = false
  app.mockInput.pressEnter()
  await app.text("Session restored")
  expect(app.requests).toHaveLength(2)
})

test("repeated restore input sends one request while restoration is pending", async () => {
  await using app = await mount([session("archived", "Slow conversation", 1)])
  const pending = Promise.withResolvers<void>()
  app.state.pending = pending.promise
  app.api.keymap.dispatchCommand("session.archived")
  await app.text("Slow conversation")
  app.mockInput.pressEnter()
  await app.wait(() => app.requests.length === 1)
  app.mockInput.pressEnter()
  app.mockInput.pressKey("u", { ctrl: true, shift: true })
  await app.renderOnce()
  expect(app.requests).toHaveLength(1)
  pending.resolve()
  await app.text("Session restored")
  expect(app.requests).toHaveLength(1)
})

test("active picker refuses to open a session archived after the list loaded", async () => {
  await using app = await mount([session("stale", "Stale conversation")])
  app.api.keymap.dispatchCommand("session.list")
  await app.text("Stale conversation")
  app.sessions[0].time.archived = Date.now()
  app.mockInput.pressEnter()
  await app.text("Restore this session with /unarchive")
  expect(app.api.route.current.name).toBe("home")
  expect(app.requests).toEqual([])
})

test("archive command archives the current conversation and returns home", async () => {
  await using app = await mount([
    session("current", "Archive this conversation"),
    session("other", "Keep this conversation"),
  ])
  const other = structuredClone(app.sessions[1])
  app.api.route.navigate("session", { sessionID: "current" })
  await app.wait(() => app.api.route.current.name === "session")
  app.api.keymap.dispatchCommand("session.archive")
  await app.text("Session archived")
  expect(app.api.route.current.name).toBe("home")
  expect(app.requests).toHaveLength(1)
  expect(app.requests[0].id).toBe("current")
  expect(app.requests[0].archived).toBeNumber()
  expect(app.sessions[1]).toEqual(other)
  app.api.keymap.dispatchCommand("session.archived")
  await app.text("Archive this conversation")
  app.mockInput.pressEnter()
  await app.text("Session restored")
  app.mockInput.pressKey("h", { ctrl: true, shift: true })
  await app.text("Archive this conversation")
  expect(app.captureCharFrame()).toContain("Keep this conversation")
})

test("failed archive keeps the current conversation open", async () => {
  await using app = await mount([session("current", "Keep this conversation")])
  app.state.fail = true
  app.api.route.navigate("session", { sessionID: "current" })
  await app.wait(() => app.api.route.current.name === "session")
  app.api.keymap.dispatchCommand("session.archive")
  await app.text("Unable to update session")
  expect(app.api.route.current).toEqual({ name: "session", params: { sessionID: "current" } })
  expect(app.sessions[0].time.archived).toBeUndefined()
})

test("typed slash commands archive, list archived sessions, restore, and list active sessions", async () => {
  await using app = await mount([session("current", "Slash command conversation")])
  app.api.route.navigate("session", { sessionID: "current" })
  await app.wait(() => !!app.renderer.currentFocusedEditor)
  await app.mockInput.typeText("/archive")
  app.mockInput.pressEnter()
  await app.text("Session archived")
  await app.wait(() => !!app.renderer.currentFocusedEditor)
  await app.mockInput.typeText("/unarchive")
  app.mockInput.pressEnter()
  await app.text("Archived sessions")
  await app.text("Slash command conversation")
  app.mockInput.pressEnter()
  await app.text("Session restored")
  app.mockInput.pressEscape()
  await app.wait(() => !!app.renderer.currentFocusedEditor)
  await app.mockInput.typeText("/sessions")
  app.mockInput.pressEnter()
  await app.text("Slash command conversation")
  expect(app.requests).toHaveLength(2)
  expect(app.requests[1]).toEqual({ id: "current", archived: null })
})

test("arrow selection restores only the chosen archived entry", async () => {
  const first = session("first", "First archived conversation", 1)
  first.time.updated = Date.now()
  const second = session("second", "Second archived conversation", 1)
  second.time.updated = first.time.updated - 1000
  await using app = await mount([first, second])
  app.api.keymap.dispatchCommand("session.archived")
  await app.text("First archived conversation")
  await app.text("Second archived conversation")
  app.mockInput.pressKey("ARROW_DOWN")
  app.mockInput.pressEnter()
  await app.text("Session restored")
  expect(app.requests).toEqual([{ id: "second", archived: null }])
  expect(first.time.archived).toBe(1)
  expect(app.captureCharFrame()).toContain("First archived conversation")
})
