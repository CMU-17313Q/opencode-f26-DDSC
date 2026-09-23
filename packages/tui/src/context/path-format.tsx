import path from "path"
import { ProjectRoots } from "@opencode-ai/core/project/roots"
import { abbreviateHome } from "../runtime"
import { useLocation } from "./location"
import { useProject } from "./project"
import { useTuiPaths } from "./runtime"

export function usePathFormatter() {
  const paths = useTuiPaths()
  const location = useLocation()
  const project = useProject()
  return {
    path: () => location()?.directory || paths.cwd,
    format: (input?: string) => {
      const base = location()?.directory || paths.cwd
      const worktree = project.data.project.worktree
      const roots = project.roots()
      // With extra repo roots, show which repo a file belongs to (repo-b/src/x.ts).
      if (typeof input === "string" && input && worktree && roots.length > 0) {
        const absolute = path.isAbsolute(input) ? input : path.resolve(base, input)
        if (ProjectRoots.find(absolute, worktree, roots)) return ProjectRoots.display(absolute, worktree, roots)
      }
      return formatPath(input, base, paths.home)
    },
  }
}

function formatPath(input: string | undefined, base: string, home: string) {
  if (typeof input !== "string" || !input) return ""

  const absolute = path.isAbsolute(input) ? input : path.resolve(base, input)
  const relative = path.relative(base, absolute)

  if (!relative) return "."
  if (relative !== ".." && !relative.startsWith(".." + path.sep)) return relative
  return abbreviateHome(absolute, home)
}
