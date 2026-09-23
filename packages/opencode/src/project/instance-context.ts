import { LocalContext } from "@/util/local-context"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ProjectRoots } from "@opencode-ai/core/project/roots"
import type * as Project from "./project"

export interface InstanceContext {
  directory: string
  worktree: string
  project: Project.Info
}

export const context = LocalContext.create<InstanceContext>("instance")

/**
 * Check if a path is within the project boundary.
 * Returns true if path is inside ctx.directory, ctx.worktree, or any extra project root.
 * Paths within the worktree but outside the working directory should not trigger external_directory permission.
 */
export function containsPath(filepath: string, ctx: InstanceContext): boolean {
  if (FSUtil.contains(ctx.directory, filepath)) return true
  if (ctx.project.roots?.some((root) => ProjectRoots.contains(root, filepath))) return true
  // Non-git projects set worktree to "/" which would match ANY absolute path.
  // Skip worktree check in this case to preserve external_directory permissions.
  if (ctx.worktree === "/") return false
  return FSUtil.contains(ctx.worktree, filepath)
}

/**
 * Resolve a tool supplied path. `repo-b/src/x.ts` resolves inside the root aliased `repo-b` when the project
 * has extra roots; otherwise relative paths resolve against ctx.directory exactly as before.
 */
export function resolvePath(input: string, ctx: InstanceContext) {
  return ProjectRoots.resolve(input, ctx.directory, ctx.worktree, ctx.project.roots)
}

/** Path shown to the user; prefixed with the owning repo's alias once the project has several roots. */
export function displayPath(filepath: string, ctx: InstanceContext) {
  return ProjectRoots.display(filepath, ctx.worktree, ctx.project.roots)
}
