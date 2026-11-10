import { describe, expect, test } from "bun:test"
import path from "path"
import { ProjectRoots } from "@opencode-ai/core/project/roots"

const a = path.resolve("/work/repo-a")
const b = path.resolve("/work/repo-b")

describe("ProjectRoots.list", () => {
  test("puts the worktree first and aliases roots by folder name", () => {
    expect(ProjectRoots.list(a, [b])).toEqual([
      { alias: "repo-a", directory: a, primary: true },
      { alias: "repo-b", directory: b, primary: false },
    ])
  })

  test("suffixes aliases when folder names collide, independent of order", () => {
    const other = path.resolve("/elsewhere/repo-a")
    const third = path.resolve("/third/repo-a")
    const aliases = ProjectRoots.list(a, [other, third]).map((root) => root.alias)
    expect(new Set(aliases).size).toBe(3)
    aliases.forEach((alias) => expect(alias).toMatch(/^repo-a-[0-9a-f]{6}$/))
    expect(
      ProjectRoots.list(third, [other, a])
        .map((root) => root.alias)
        .toSorted(),
    ).toEqual(aliases.toSorted())
  })

  test("a folder name that stops colliding goes back to the plain name", () => {
    const other = path.resolve("/elsewhere/repo-a")
    expect(ProjectRoots.list(b, [a, other]).map((root) => root.alias)[2]).toMatch(/^repo-a-[0-9a-f]{6}$/)
    expect(ProjectRoots.list(b, [other]).map((root) => root.alias)).toEqual(["repo-b", "repo-a"])
  })

  test("drops duplicates and the worktree itself", () => {
    expect(ProjectRoots.list(a, [a, b, b]).map((root) => root.directory)).toEqual([a, b])
  })
})

describe("ProjectRoots.display", () => {
  test("single root keeps the plain worktree relative path", () => {
    expect(ProjectRoots.display(path.join(a, "main.py"), a)).toBe("main.py")
    expect(ProjectRoots.display(path.join(a, "main.py"), a, [])).toBe("main.py")
  })

  test("same file name in two repos gets distinct alias prefixes", () => {
    expect(ProjectRoots.display(path.join(a, "main.py"), a, [b])).toBe(path.join("repo-a", "main.py"))
    expect(ProjectRoots.display(path.join(b, "main.py"), a, [b])).toBe(path.join("repo-b", "main.py"))
  })

  test("colliding folder names still produce distinct paths", () => {
    const other = path.resolve("/elsewhere/repo-a")
    const shown = ProjectRoots.display(path.join(other, "main.py"), a, [other])
    expect(shown).not.toBe(ProjectRoots.display(path.join(a, "main.py"), a, [other]))
    expect(ProjectRoots.resolve(shown, a, a, [other])).toBe(path.join(other, "main.py"))
  })

  test("a hashed alias still resolves after its name stops colliding", () => {
    const other = path.resolve("/elsewhere/repo-a")
    const shown = ProjectRoots.display(path.join(other, "main.py"), b, [a, other])
    expect(ProjectRoots.resolve(shown, b, b, [other])).toBe(path.join(other, "main.py"))
  })

  test("nested root wins over its parent", () => {
    const nested = path.join(a, "vendor", "lib")
    expect(ProjectRoots.display(path.join(nested, "x.ts"), a, [nested])).toBe(path.join("lib", "x.ts"))
  })

  test("paths outside every root fall back to worktree relative", () => {
    const outside = path.resolve("/tmp/file.txt")
    expect(ProjectRoots.display(outside, a, [b])).toBe(path.relative(a, outside))
  })
})

describe("ProjectRoots.resolve", () => {
  test("single root resolves relative to the directory exactly as before", () => {
    expect(ProjectRoots.resolve("repo-b/main.py", a, a)).toBe(path.join(a, "repo-b", "main.py"))
    expect(ProjectRoots.resolve("src/x.ts", path.join(a, "src"), a)).toBe(path.join(a, "src", "src", "x.ts"))
  })

  test("alias prefix routes into the matching root", () => {
    expect(ProjectRoots.resolve("repo-b/main.py", a, a, [b])).toBe(path.join(b, "main.py"))
    expect(ProjectRoots.resolve("repo-a/main.py", a, a, [b])).toBe(path.join(a, "main.py"))
    expect(ProjectRoots.resolve("./repo-b/main.py", a, a, [b])).toBe(path.join(b, "main.py"))
  })

  test("non alias relative paths resolve against the directory", () => {
    expect(ProjectRoots.resolve("src/main.py", a, a, [b])).toBe(path.join(a, "src", "main.py"))
  })

  test("absolute paths pass through untouched", () => {
    const absolute = path.join(b, "main.py")
    expect(ProjectRoots.resolve(absolute, a, a, [b])).toBe(absolute)
  })

  test("resolve and display round trip for identical names", () => {
    const roots = [b]
    for (const file of [path.join(a, "main.py"), path.join(b, "main.py")]) {
      expect(ProjectRoots.resolve(ProjectRoots.display(file, a, roots), a, a, roots)).toBe(file)
    }
  })
})

describe("ProjectRoots.find", () => {
  test("returns the root owning a file", () => {
    expect(ProjectRoots.find(path.join(b, "x"), a, [b])?.alias).toBe("repo-b")
    expect(ProjectRoots.find(path.resolve("/nope"), a, [b])).toBeUndefined()
  })
})
