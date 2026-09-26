import { describe, expect, test } from "bun:test"
import {
  NO_FOLDER_LABEL,
  compareFolderLabels,
  createDialogSessionListQuery,
  loadDialogSessionList,
  sessionFolderLabel,
} from "../../src/component/dialog-session-list"
import { buildFolderOptions, collectFolderNames } from "../../src/component/session-folder"

describe("dialog session list", () => {
  test("requests root sessions for the default browse list", () => {
    expect(createDialogSessionListQuery({ filter: { path: "packages/tui" } })).toEqual({
      roots: true,
      limit: 100,
      path: "packages/tui",
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
})
