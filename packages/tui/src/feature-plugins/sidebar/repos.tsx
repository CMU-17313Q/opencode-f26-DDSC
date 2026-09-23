import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { Part } from "@opencode-ai/sdk/v2"
import type { BuiltinTuiPlugin } from "../builtins"
import { ProjectRoots } from "@opencode-ai/core/project/roots"
import { existsSync, readdirSync } from "fs"
import path from "path"
import { createMemo, createSignal, For, Show } from "solid-js"
import { useProject } from "../../context/project"
import { useTuiPaths } from "../../context/runtime"
import { abbreviateHome } from "../../runtime"
import { Locale } from "../../util/locale"

const id = "internal:sidebar-repos"
const MAX_FILES = 5

// Repository roots of the current project plus, per session, which files the agent touched in each.
function useRepos(api: TuiPluginApi, sessionID?: string) {
  const project = useProject()
  const paths = useTuiPaths()
  const worktree = () => project.data.project.worktree
  const roots = createMemo(() => {
    const dir = worktree()
    return dir ? ProjectRoots.list(dir, project.roots()) : []
  })
  const touched = createMemo(() => {
    const dir = worktree()
    if (!dir || !sessionID || roots().length < 2) return []
    const base = api.state.session.get(sessionID)?.directory || api.state.path.directory || paths.cwd
    return api.state.session
      .messages(sessionID)
      .flatMap((message) => api.state.part(message.id))
      .flatMap(files)
      .flatMap((file) => {
        const absolute = ProjectRoots.resolve(file, base, dir, project.roots())
        const root = ProjectRoots.find(absolute, dir, project.roots())
        return root ? [{ root, file: path.relative(root.directory, absolute) }] : []
      })
  })
  return {
    roots,
    touched,
    multi: () => roots().length > 1,
    // The repo the agent most recently worked in; the primary repo until it touches a file.
    active: () => touched().at(-1)?.root.alias ?? roots()[0]?.alias,
  }
}

// read/write/edit pass `filePath`; apply_patch reports every changed file in its metadata.
function files(part: Part): string[] {
  if (part.type !== "tool" || part.state.status === "pending") return []
  const input = part.state.input.filePath
  const patched = part.state.status === "completed" ? part.state.metadata?.files : undefined
  return [
    ...(typeof input === "string" ? [input] : []),
    ...(Array.isArray(patched)
      ? patched.flatMap((item: unknown) =>
          item && typeof item === "object" && "filePath" in item && typeof item.filePath === "string"
            ? [item.filePath]
            : [],
        )
      : []),
  ]
}

function Sidebar(props: { api: TuiPluginApi; sessionID: string }) {
  const [open, setOpen] = createSignal(true)
  const theme = () => props.api.theme.current
  const paths = useTuiPaths()
  const repos = useRepos(props.api, props.sessionID)

  return (
    <Show when={repos.multi()}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => setOpen((x) => !x)}>
          <text fg={theme().text}>{open() ? "▼" : "▶"}</text>
          <text fg={theme().text}>
            <b>Repositories</b> <span style={{ fg: theme().textMuted }}>({repos.roots().length})</span>
          </text>
        </box>
        <Show when={open()}>
          <For each={repos.roots()}>
            {(root) => {
              const list = createMemo(() => [
                ...new Set(repos.touched().flatMap((item) => (item.root.alias === root.alias ? [item.file] : []))),
              ])
              return (
                <box>
                  <box flexDirection="row" gap={1}>
                    <text flexShrink={0} fg={repos.active() === root.alias ? theme().success : theme().textMuted}>
                      •
                    </text>
                    <text fg={theme().text} wrapMode="none">
                      <b>{root.alias}</b>
                      <Show when={root.primary}>
                        <span style={{ fg: theme().textMuted }}> primary</span>
                      </Show>
                    </text>
                  </box>
                  <text fg={theme().textMuted} paddingLeft={2} wrapMode="none">
                    {Locale.truncateLeft(abbreviateHome(root.directory, paths.home), 34)}
                  </text>
                  <For each={list().slice(-MAX_FILES)}>
                    {(file) => (
                      <text fg={theme().textMuted} paddingLeft={2} wrapMode="none">
                        {Locale.truncateLeft("↳ " + file, 34)}
                      </text>
                    )}
                  </For>
                </box>
              )
            }}
          </For>
        </Show>
      </box>
    </Show>
  )
}

function Indicator(props: { api: TuiPluginApi; sessionID?: string }) {
  const theme = () => props.api.theme.current
  const repos = useRepos(props.api, props.sessionID)
  return (
    <Show when={repos.multi()}>
      <text fg={theme().textMuted} wrapMode="none">
        ⎇ <span style={{ fg: theme().text }}>{repos.active()}</span> · {repos.roots().length} repos
      </text>
    </Show>
  )
}

type Choice = { type: "add"; directory: string } | { type: "open"; directory: string } | { type: "type" }

// Directory browser; git repositories next to the current folder are suggested first.
function Picker(props: { api: TuiPluginApi; directory: string }) {
  const project = useProject()
  const paths = useTuiPaths()
  const taken = createMemo(() => new Set([project.data.project.worktree, ...project.roots()]))
  const folders = createMemo(() =>
    readable(props.directory)
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => path.join(props.directory, entry.name))
      .toSorted((a, b) => a.localeCompare(b)),
  )
  const options = createMemo(() => [
    ...folders()
      .filter((dir) => existsSync(path.join(dir, ".git")) && !taken().has(dir))
      .map((dir) => ({
        title: path.basename(dir),
        value: { type: "add", directory: dir } satisfies Choice as Choice,
        description: "add repository",
        category: "Git repositories here",
      })),
    {
      title: `Add ${abbreviateHome(props.directory, paths.home)}`,
      value: { type: "add", directory: props.directory } satisfies Choice as Choice,
      category: "Current folder",
      // A folder containing the primary repo would swallow it (and everything beside it) as one root.
      disabled:
        taken().has(props.directory) || ProjectRoots.contains(props.directory, project.data.project.worktree ?? "/"),
    },
    {
      title: "Type a path…",
      value: { type: "type" } satisfies Choice as Choice,
      category: "Current folder",
    },
    ...(path.dirname(props.directory) === props.directory
      ? []
      : [
          {
            title: "..",
            value: { type: "open", directory: path.dirname(props.directory) } satisfies Choice as Choice,
            category: "Current folder",
          },
        ]),
    ...folders().map((dir) => ({
      title: path.basename(dir) + "/",
      value: { type: "open", directory: dir } satisfies Choice as Choice,
      category: "Browse",
    })),
  ])

  return (
    <props.api.ui.DialogSelect<Choice>
      title="Add repository root"
      placeholder={abbreviateHome(props.directory, paths.home)}
      options={options()}
      onSelect={(option) => {
        if (option.value.type === "open") return browse(props.api, option.value.directory)
        if (option.value.type === "add") return add(props.api, project, option.value.directory)
        props.api.ui.dialog.replace(() => <TypePath api={props.api} />)
      }}
    />
  )
}

function TypePath(props: { api: TuiPluginApi }) {
  const project = useProject()
  const paths = useTuiPaths()
  return (
    <props.api.ui.DialogPrompt
      title="Add repository root"
      placeholder="/absolute/path/to/repo"
      onConfirm={(value) => {
        const input = value.trim().replace(/^~(?=$|\/)/, paths.home)
        if (input) add(props.api, project, path.resolve(project.data.project.worktree ?? paths.cwd, input))
      }}
      onCancel={() => props.api.ui.dialog.clear()}
    />
  )
}

function Remove(props: { api: TuiPluginApi }) {
  const project = useProject()
  const paths = useTuiPaths()
  const repos = useRepos(props.api)
  const extra = createMemo(() => repos.roots().filter((root) => !root.primary))
  return (
    <Show
      when={extra().length > 0}
      fallback={
        <props.api.ui.DialogAlert
          title="Remove repository root"
          message="Only the primary repository is open. Use /add-repo to add another."
          onConfirm={() => props.api.ui.dialog.clear()}
        />
      }
    >
      <props.api.ui.DialogSelect
        title="Remove repository root"
        options={extra().map((root) => ({
          title: root.alias,
          value: root.directory,
          description: abbreviateHome(root.directory, paths.home),
        }))}
        onSelect={(option) => {
          props.api.ui.dialog.clear()
          project
            .setRoots(project.roots().filter((dir) => dir !== option.value))
            .then(() => props.api.ui.toast({ variant: "success", message: `Removed ${option.title}` }))
            .catch((error) => props.api.ui.toast({ variant: "error", message: String(error) }))
        }}
      />
    </Show>
  )
}

// Unreadable folders (permissions, races with deletion) just show up empty.
function readable(directory: string) {
  try {
    return readdirSync(directory, { withFileTypes: true })
  } catch {
    return []
  }
}

function browse(api: TuiPluginApi, directory: string) {
  api.ui.dialog.replace(() => <Picker api={api} directory={directory} />)
}

function add(api: TuiPluginApi, project: ReturnType<typeof useProject>, directory: string) {
  api.ui.dialog.clear()
  const before = project.roots().length
  project
    .setRoots([...project.roots(), directory])
    .then(() => {
      // The server drops paths that are not directories.
      if (project.roots().length === before)
        return api.ui.toast({ variant: "error", message: `Not a directory: ${directory}` })
      api.ui.toast({ variant: "success", message: `Added ${path.basename(directory)} as a repository root` })
    })
    .catch((error) => api.ui.toast({ variant: "error", message: String(error) }))
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 150,
    slots: {
      sidebar_content(_ctx, props) {
        return <Sidebar api={api} sessionID={props.session_id} />
      },
      session_prompt_right(_ctx, props) {
        return <Indicator api={api} sessionID={props.session_id} />
      },
      home_prompt_right() {
        return <Indicator api={api} />
      },
    },
  })

  api.keymap.registerLayer({
    commands: [
      {
        name: "repos.add",
        title: "Add repository root",
        slashName: "add-repo",
        category: "Project",
        namespace: "palette",
        run() {
          // Start next to the worktree so sibling repositories are suggested right away.
          browse(api, path.dirname(api.state.path.worktree || api.state.path.directory))
        },
      },
      {
        name: "repos.remove",
        title: "Remove repository root",
        slashName: "remove-repo",
        category: "Project",
        namespace: "palette",
        run() {
          api.ui.dialog.replace(() => <Remove api={api} />)
        },
      },
    ],
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
