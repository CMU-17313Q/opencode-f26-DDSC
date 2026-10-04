import { describe, expect, test } from "bun:test"
import { triggerDialogAction } from "../../src/ui/dialog-select"
import {
  NO_FOLDER_LABEL,
  compareFolderLabels,
  createDialogSessionListQuery,
  loadDialogSessionList,
  sessionFolderLabel,
} from "../../src/component/dialog-session-list"
import { buildFolderOptions, collectFolderNames, orderIDsByFolder } from "../../src/component/session-folder"

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

  test("maps missing folders to No folder", () => {
    expect(sessionFolderLabel(undefined)).toBe(NO_FOLDER_LABEL)
    expect(sessionFolderLabel("")).toBe(NO_FOLDER_LABEL)
    expect(sessionFolderLabel("  ")).toBe(NO_FOLDER_LABEL)
    expect(sessionFolderLabel(" Work ")).toBe("Work")
  })

  test("sorts folders alphabetically with No folder last", () => {
    expect(["No folder", "b", "A"].toSorted(compareFolderLabels)).toEqual(["A", "b", "No folder"])
    expect(compareFolderLabels("a", "a")).toBe(0)
  })

  test("collects unique trimmed folder names", () => {
    expect(
      collectFolderNames([
        { folder: " Work " },
        { folder: "Work" },
        { folder: undefined },
        { folder: "  " },
        { folder: "play" },
      ]),
    ).toEqual(["play", "Work"])
  })

  test("keeps case variants as separate folder names", () => {
    expect(collectFolderNames([{ folder: "Work" }, { folder: "work" }, { folder: null }])).toEqual(["Work", "work"])
  })

  test("builds No folder plus matches plus Create row", () => {
    expect(buildFolderOptions(["Work", "play"], "").map((option) => option.title)).toEqual([
      "No folder",
      "Work",
      "play",
    ])
    expect(buildFolderOptions(["Work", "play"], "wo").map((option) => option.title)).toEqual([
      "No folder",
      "Work",
      'Create "wo"',
    ])
    expect(buildFolderOptions(["Work"], "work").map((option) => option.title)).toEqual(["No folder", "Work"])
  })

  test("hides Create row for blank or case-insensitive exact queries", () => {
    expect(buildFolderOptions(["Work"], "   ").map((option) => option.title)).toEqual(["No folder", "Work"])
    expect(buildFolderOptions(["Work"], "WORK").map((option) => option.title)).toEqual(["No folder", "Work"])
    expect(buildFolderOptions([], "New").map((option) => option.title)).toEqual(["No folder", 'Create "New"'])
    expect(buildFolderOptions([], "").map((option) => option.title)).toEqual(["No folder"])
  })

  test("orders ids by folder with No folder last and recency kept", () => {
    const folderOf = (id: string) => ({ b: "play", a: "Work", c: "No folder", d: "Work" })[id]
    expect(orderIDsByFolder(["b", "a", "c", "d"], folderOf)).toEqual(["b", "a", "d", "c"])
  })

  test("skips ids without a folder mapping", () => {
    expect(orderIDsByFolder(["a", "missing"], (id) => (id === "a" ? "Work" : undefined))).toEqual(["a"])
    expect(orderIDsByFolder([], () => "Work")).toEqual([])
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
