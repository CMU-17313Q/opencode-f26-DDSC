import { afterEach, describe, expect, test } from "bun:test"
import fc from "fast-check"
import { ProjectRoots } from "@opencode-ai/core/project/roots"
import { Context, Effect } from "effect"
import fs from "fs/promises"
import path from "path"
import { InstanceRef } from "../../src/effect/instance-ref"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { MessageID, SessionID } from "../../src/session/schema"
import { assertExternalDirectoryEffect } from "../../src/tool/external-directory"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir, withTestInstance } from "../fixture/fixture"

// Property-based tests for the Multi-Repo requirements in traceability/saabdull.md.

const PRIMARY = path.resolve("/w/main")

// Repo folders come from a few parents and a few names, so the cases interviewees worried about show up
// constantly instead of almost never: same-name repos (`/x/api`, `/y/api`, C-6/O-7), a name that looks like a
// collision suffix (`api-2`), a repo sharing the primary's name (`main`), a repo named like a common folder
// (`src`), and repos nested inside the primary (`/w/main/vendor/...`).
const repo = fc
  .tuple(fc.constantFrom("/x", "/y", "/z", "/w/main/vendor"), fc.constantFrom("api", "api-2", "src", "main", "web"))
  .map((parts) => path.resolve(parts[0], parts[1]))

// File name segments that are legal on Linux but easy to mishandle (spaces, unicode, a backslash, leading
// dots, names equal to a repo alias), plus arbitrary short strings without a path separator.
const segment = fc.oneof(
  fc.constantFrom("index.ts", "my file.ts", "ünïcode.ts", "a\\b.txt", "..foo", ".env", "api", "src"),
  fc
    .string({ minLength: 1, maxLength: 8 })
    .filter((s) => !s.includes("/") && !s.includes("\0") && s !== "." && s !== ".."),
)
const relativeFile = fc.array(segment, { minLength: 1, maxLength: 3 })

describe("multi-repo roots (pure)", () => {
  // R2: Removing a repo removes only that repo from the active list. Every other repo stays listed and is
  // still reached by the same absolute path and the same alias, and files already written to disk are untouched.
  // Kind: invariant
  test("R2: removing a repo leaves every other repo's directory and alias unchanged", () => {
    fc.assert(
      fc.property(
        fc
          .uniqueArray(repo, { minLength: 1, maxLength: 5 })
          .chain((roots) => fc.tuple(fc.constant(roots), fc.constantFrom(...roots))),
        (input) => {
          const before = ProjectRoots.list(PRIMARY, input[0])
          // Same removal the Repositories sidebar sends: the current roots minus the removed directory.
          const after = ProjectRoots.list(
            PRIMARY,
            input[0].filter((dir) => dir !== input[1]),
          )
          expect(after.map((root) => root.directory)).toEqual(
            before.map((root) => root.directory).filter((dir) => dir !== input[1]),
          )
          after.forEach((root) =>
            expect(before.find((item) => item.directory === root.directory)?.alias).toBe(root.alias),
          )
        },
      ),
    )
  })

  // R3: Repos with the same folder name get distinct aliases, and every displayed file path resolves back to
  // that exact file.
  // Kind: invariant
  test("R3: every repo in a session gets a distinct alias", () => {
    fc.assert(
      fc.property(fc.oneof(fc.constant(PRIMARY), repo), fc.array(repo, { maxLength: 6 }), (worktree, roots) => {
        const aliases = ProjectRoots.list(worktree, roots).map((root) => root.alias)
        expect(new Set(aliases).size).toBe(aliases.length)
      }),
    )
  })

  // R3: Repos with the same folder name get distinct aliases, and every displayed file path resolves back to
  // that exact file.
  // Kind: round-trip (display, then resolve)
  test("R3: resolving a file's displayed path returns that same file", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.constant(PRIMARY), repo),
        fc.uniqueArray(repo, { maxLength: 5 }),
        fc.nat(),
        relativeFile,
        (worktree, roots, pick, segments) => {
          const all = ProjectRoots.list(worktree, roots)
          const file = path.join(all[pick % all.length].directory, ...segments)
          const shown = ProjectRoots.display(file, worktree, roots)
          expect(ProjectRoots.resolve(shown, worktree, worktree, roots)).toBe(file)
        },
      ),
    )
  })

  // R5: The order in which repositories are added shall not affect resolution of explicitly qualified file
  // paths (absolute paths and paths qualified with a repo alias).
  // Kind: metamorphic (reordering the repos, including which one is primary, must not change the result)
  test("R5: repo order does not change which file a qualified path resolves to", () => {
    fc.assert(
      fc.property(
        fc
          .uniqueArray(fc.oneof(fc.constant(PRIMARY), repo), { minLength: 1, maxLength: 5 })
          .chain((dirs) =>
            fc.tuple(
              fc.shuffledSubarray(dirs, { minLength: dirs.length }),
              fc.shuffledSubarray(dirs, { minLength: dirs.length }),
            ),
          ),
        fc.nat(),
        relativeFile,
        (orders, pick, segments) => {
          const first = orders[0]
          const second = orders[1]
          const file = path.join(first[pick % first.length], ...segments)
          // The path the agent was shown for this file when the repos were added in the first order.
          const shown = ProjectRoots.display(file, first[0], first.slice(1))
          expect(ProjectRoots.resolve(shown, second[0], second[0], second.slice(1))).toBe(
            ProjectRoots.resolve(shown, first[0], first[0], first.slice(1)),
          )
          expect(ProjectRoots.resolve(file, second[0], second[0], second.slice(1))).toBe(file)
        },
      ),
    )
  })
})

const context = Context.empty() as Context.Context<unknown>

// Goes through the real HttpApi app, the same route the TUI sidebar uses to add and remove roots.
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

function toolContext(asked: string[]) {
  return {
    sessionID: SessionID.make("ses_multi_repo_property"),
    messageID: MessageID.make("msg_multi_repo_property"),
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

describe("multi-repo roots (through the server)", () => {
  // R2: Removing a repo removes only that repo from the active list. Every other repo stays listed and is
  // still reached by the same absolute path and the same alias, and files already written to disk are untouched.
  // Kind: round-trip (add a repo, then remove it)
  test("R2: adding then removing a repo restores the list and keeps its files", async () => {
    await using primary = await tmpdir({ git: true })
    await using pool = await tmpdir()
    // Real directories, two of them sharing the name `api`, since the route only stores existing directories.
    const dirs = [path.join(pool.path, "one", "api"), path.join(pool.path, "two", "api"), path.join(pool.path, "web")]
    await Promise.all(dirs.map((dir) => fs.mkdir(dir, { recursive: true })))
    const project = await request("GET", "/project/current", primary.path)
    const patch = (roots: string[]) => request("PATCH", `/project/${project.body.id}`, primary.path, { roots })

    await fc.assert(
      fc.asyncProperty(fc.subarray(dirs), fc.constantFrom(...dirs), async (initial, added) => {
        fc.pre(!initial.includes(added))
        const start: string[] = (await patch(initial)).body.roots
        await Bun.write(path.join(added, "written-by-agent.txt"), "kept")
        await patch([...start, added])
        const end = await patch([...start, added].filter((dir) => dir !== added))
        expect(end.status).toBe(200)
        expect(end.body.roots).toEqual(start)
        expect(await Bun.file(path.join(added, "written-by-agent.txt")).text()).toBe("kept")
      }),
      { numRuns: 25 },
    )
  }, 60_000)

  // R4: Adding the same repository path multiple times shall not create duplicate active repository entries.
  // Kind: invariant
  test("R4: the same repo added repeatedly, however it is spelled, appears once", async () => {
    await using primary = await tmpdir({ git: true })
    await using pool = await tmpdir()
    const project = await request("GET", "/project/current", primary.path)
    const dirs = [project.body.worktree, path.join(pool.path, "one", "api"), path.join(pool.path, "two", "api")]
    await Promise.all(dirs.slice(1).map((dir) => fs.mkdir(dir, { recursive: true })))
    await fs.mkdir(path.join(pool.path, "links"))
    await Promise.all(dirs.map((dir, index) => fs.symlink(dir, path.join(pool.path, "links", String(index)))))

    // Each pick is a repo plus one way a user (or the sidebar's path input) might spell it.
    const spell = (index: number, how: string) => {
      if (how === "trailing slash") return dirs[index] + path.sep
      if (how === "dot-dot") return [dirs[index], "..", path.basename(dirs[index])].join(path.sep)
      if (how === "symlink") return path.join(pool.path, "links", String(index))
      return dirs[index]
    }
    const pick = fc.tuple(
      fc.integer({ min: 0, max: dirs.length - 1 }),
      fc.constantFrom("plain", "trailing slash", "dot-dot", "symlink"),
    )

    await fc.assert(
      fc.asyncProperty(fc.array(pick, { minLength: 1, maxLength: 6 }), async (picks) => {
        const result = await request("PATCH", `/project/${project.body.id}`, primary.path, {
          roots: picks.map((item) => spell(item[0], item[1])),
        })
        const stored: string[] = result.body.roots
        expect(new Set(stored).size).toBe(stored.length)
        expect(
          ProjectRoots.list(project.body.worktree, stored)
            .map((root) => root.directory)
            .toSorted(),
        ).toEqual([...new Set([project.body.worktree, ...picks.map((item) => dirs[item[0]])])].toSorted())
      }),
      { numRuns: 25 },
    )
  }, 60_000)

  // R6: A path outside every active repo is never treated as inside the project: a tool must ask for
  // `external_directory` permission before touching it.
  // Kind: model / oracle
  test("R6: tools ask for permission exactly when a path is outside every active repo", async () => {
    await using primary = await tmpdir({ git: true })

    // Targets start from a session folder, a repo, a near miss that only shares a prefix (`/x/api-2` vs
    // `/x/api`) or an unrelated folder, then may add `..` segments that climb out of where they started.
    const target = fc
      .tuple(
        fc.constantFrom(PRIMARY, path.join(PRIMARY, "packages"), "/x/api", "/x/api-2", "/y/api", "/etc", "/w"),
        fc.array(fc.oneof(segment, fc.constant("..")), { maxLength: 4 }),
      )
      .map((parts) => [parts[0], ...parts[1]].join(path.sep))

    await withTestInstance({
      directory: primary.path,
      fn: (instance) =>
        fc.assert(
          fc.asyncProperty(
            // A worktree of "/" is how opencode marks a folder that is not a git repo.
            fc.constantFrom(PRIMARY, "/"),
            fc.constantFrom(PRIMARY, path.join(PRIMARY, "packages")),
            fc.uniqueArray(repo, { maxLength: 4 }),
            target,
            async (worktree, directory, roots, file) => {
              const asked: string[] = []
              await Effect.runPromise(
                assertExternalDirectoryEffect(toolContext(asked), file).pipe(
                  Effect.provideService(InstanceRef, {
                    ...instance,
                    directory,
                    worktree,
                    project: { ...instance.project, roots },
                  }),
                ),
              )
              // The model: after normalizing, the path is one of the session's folders or sits below one.
              // A worktree of "/" grants nothing, otherwise every path would count as inside.
              const normal = path.resolve(file)
              const inside = [directory, ...roots, ...(worktree === "/" ? [] : [worktree])].some(
                (dir) => normal === dir || normal.startsWith(dir + path.sep),
              )
              expect(asked.includes("external_directory")).toBe(!inside)
            },
          ),
        ),
    })
  })
})
