export * as ProjectRoots from "./roots"

import path from "path"
import { Hash } from "../util/hash"

export interface Root {
  readonly alias: string
  readonly directory: string
  readonly primary: boolean
}

/**
 * Every repository root of a project, primary worktree first. Each root gets a
 * unique alias (its folder name, or `name-<hash of its path>` when two roots share
 * a name) that is used to prefix paths so identically named files in different
 * repos stay distinct. An alias never depends on the order of the roots, so adding,
 * removing or reordering repos cannot move an alias onto a different repo.
 */
export function list(worktree: string, roots: readonly string[] = []): Root[] {
  const extra = roots.filter((dir, index) => dir !== worktree && roots.indexOf(dir) === index)
  const directories = [worktree, ...extra]
  return directories.map((directory, index) => ({
    alias: directories.some((other) => other !== directory && name(other) === name(directory))
      ? hashed(directory)
      : name(directory),
    directory,
    primary: index === 0,
  }))
}

function name(directory: string) {
  return path.basename(directory) || "root"
}

function hashed(directory: string) {
  return `${name(directory)}-${Hash.fast(directory).slice(0, 6)}`
}

/** The deepest root containing `filepath`, if any. */
export function find(filepath: string, worktree: string, roots: readonly string[] = []) {
  return list(worktree, roots)
    .filter((root) => contains(root.directory, filepath))
    .toSorted((a, b) => b.directory.length - a.directory.length)[0]
}

/**
 * Human-facing path for a file. With a single root this is exactly the old
 * worktree-relative path; with several roots it is prefixed with the alias of
 * the repo the file lives in (e.g. `main.py` -> `repo-a/main.py`).
 */
export function display(filepath: string, worktree: string, roots: readonly string[] = []) {
  if (list(worktree, roots).length === 1) return path.relative(worktree, filepath)
  const root = find(filepath, worktree, roots)
  if (!root) return path.relative(worktree, filepath)
  return path.join(root.alias, path.relative(root.directory, filepath))
}

/**
 * Resolve a tool supplied path. Relative paths that start with a root alias
 * (`repo-b/src/app.ts`) resolve inside that root; everything else resolves
 * against `directory` as before. Alias lookup only applies once extra roots
 * exist so single-repo sessions keep their original behavior. A root's hashed
 * alias keeps working after it stops sharing a name, so paths the agent was
 * already given still reach the same repo.
 */
export function resolve(input: string, directory: string, worktree: string, roots: readonly string[] = []) {
  if (path.isAbsolute(input)) return input
  const all = list(worktree, roots)
  if (all.length === 1) return path.resolve(directory, input)
  // Split on the platform separator only: on POSIX a backslash is part of a file name.
  const [head, ...rest] = path.normalize(input).split(path.sep)
  const root = all.find((item) => item.alias === head) ?? all.find((item) => hashed(item.directory) === head)
  if (!root) return path.resolve(directory, input)
  return path.join(root.directory, ...rest)
}

export function contains(parent: string, child: string) {
  const result = path.relative(parent, child)
  return result === "" || (!path.isAbsolute(result) && result !== ".." && !result.startsWith(`..${path.sep}`))
}
