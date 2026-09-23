import { describe, expect, test } from "bun:test"
import { triggerDialogAction } from "../../src/ui/dialog-select"
import { createDialogSessionListQuery, loadDialogSessionList } from "../../src/component/dialog-session-list"

describe("dialog session list", () => {
  test("requests root sessions for the default browse list", () => {
    expect(createDialogSessionListQuery({ filter: { path: "packages/tui" } })).toEqual({
      roots: true,
      limit: 100,
      path: "packages/tui",
    })
  })

  test("requests archived sessions before applying the result limit", () => {
    expect(createDialogSessionListQuery({ filter: { archived: true }, search: " old " })).toEqual({
      roots: true,
      limit: 30,
      search: "old",
      archived: true,
    })
  })

  test("requests root sessions for search results", () => {
    expect(createDialogSessionListQuery({ search: " deploy ", filter: { scope: "project" } })).toEqual({
      roots: true,
      limit: 30,
      search: "deploy",
      scope: "project",
    })
  })

  test("keeps the cache usable while the root request is pending", async () => {
    let resolve!: (result: { data: string[] }) => void
    const pending = loadDialogSessionList<string>({
      filter: {},
      list: () => new Promise((done) => (resolve = done)),
    })

    expect(await Promise.race([pending, Promise.resolve("pending")])).toBe("pending")
    resolve({ data: ["root"] })
    expect(await pending).toEqual(["root"])
  })

  test("falls back when the root request returns an error response", async () => {
    expect(await loadDialogSessionList({ filter: {}, list: async () => ({}) })).toBeUndefined()
  })

  test("falls back when the root request rejects", async () => {
    expect(
      await loadDialogSessionList({
        filter: {},
        list: () => Promise.reject(new Error("offline")),
      }),
    ).toBeUndefined()
  })
})

test("archive view toggle runs even when the list is empty", () => {
  const calls: string[] = []
  const action = { onTrigger: () => calls.push("selected"), onEmpty: () => calls.push("empty") }
  triggerDialogAction(action, undefined)
  triggerDialogAction(action, { title: "Session", value: "session" })
  expect(calls).toEqual(["empty", "selected"])
})

test("row actions do not run without a selected session", () => {
  const calls: string[] = []
  triggerDialogAction({ onTrigger: () => calls.push("restore") }, undefined)
  expect(calls).toEqual([])
})

test("active session requests exclude archived sessions", () => {
  expect(createDialogSessionListQuery({ filter: { archived: false } }).archived).toBe(false)
})
