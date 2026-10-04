import { getFilename } from "@opencode-ai/core/util/path"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { serverName } from "@/context/server"
import { displayName, projectForSession } from "@/pages/layout/helpers"
import { pathKey } from "@/utils/path-key"
import { normalizeSessionInfo } from "@/utils/session"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createMemo, createResource, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import type { HomeController } from "./home-controller"
import { homeSessionSearchKey, type HomeSessionRecord, type HomeSessionsController } from "./home-sessions-controller"

type HomeSessionSearchSource = Pick<HomeSessionsController, "data" | "session">

export function createHomeSessionSearchController(home: HomeController, sessions: HomeSessionSearchSource) {
  const command = useCommand()
  const language = useLanguage()
  const [state, setState] = createStore({ value: "", focused: false, highlighted: "", includeArchived: false })
  let root: HTMLDivElement | undefined
  let input: HTMLInputElement | undefined
  let list: HTMLDivElement | undefined
  const query = createMemo(() => state.value.trim())

  const [remoteResults] = createResource(
    () => ({
      query: query(),
      includeArchived: state.includeArchived,
      ctx: home.server.focusedContext(),
      selectedProject: home.project.selected(),
      projects: home.project.list(),
    }),
    async (params) => {
      if (!params.includeArchived || !params.query || !params.ctx) return []
      const projectByID = new Map(params.projects.flatMap((p) => (p.id ? [[p.id, p] as const] : [])))
      const res = await params.ctx.sdk.client.session
        .list({
          search: params.query,
          roots: true,
          archived: true,
          limit: 100,
        })
        .catch(() => ({ data: [] }))

      const items = (res.data ?? []).map(normalizeSessionInfo)
      return items.flatMap((session) => {
        const directory = pathKey(session.directory)
        const proj =
          params.projects.find(
            (item) =>
              pathKey(item.worktree) === directory ||
              item.sandboxes?.some((sandbox) => pathKey(sandbox) === directory),
          ) ?? projectForSession(session, params.projects, projectByID)
        if (params.selectedProject && proj && pathKey(proj.worktree) !== pathKey(params.selectedProject.worktree)) return []
        if (params.selectedProject && !proj && pathKey(session.directory) !== pathKey(params.selectedProject.worktree)) return []
        const project = proj ?? { worktree: session.directory, expanded: false }
        const projectName = proj ? displayName(proj) : getFilename(session.directory)
        return [{ session, project, projectName }]
      })
    },
  )

  const results = createMemo(() => {
    if (state.includeArchived) {
      return remoteResults() ?? []
    }
    const value = query().toLowerCase()
    if (!value) return []
    return sessions.data
      .searchRecords()
      .filter((record) => `${record.session.title} ${record.projectName}`.toLowerCase().includes(value))
  })
  const active = createMemo(() => {
    const records = results()
    if (records.some((record) => homeSessionSearchKey(record) === state.highlighted)) return state.highlighted
    return records[0] ? homeSessionSearchKey(records[0]) : ""
  })
  const open = createMemo(() => state.focused && query().length > 0)
  const placeholder = createMemo(() => {
    const project = home.project.selected()
    if (project) return language.t("home.sessions.search.placeholder.scoped", { scope: displayName(project) })
    if (home.server.list().length > 1) {
      const conn = home.server.focused()
      if (conn) return language.t("home.sessions.search.placeholder.scoped", { scope: serverName(conn) })
    }
    return language.t("home.sessions.search.placeholder")
  })

  onCleanup(
    makeEventListener(document, "pointerdown", (event) => {
      if (!open()) return
      const target = event.target
      if (!(target instanceof Node) || root?.contains(target)) return
      close()
    }),
  )

  command.register("home.search", () => [
    {
      id: "home.sessions.search.focus",
      title: placeholder(),
      keybind: "mod+f",
      hidden: true,
      onSelect: focus,
    },
  ])

  function focus() {
    input?.focus()
    setState("focused", true)
  }

  function close() {
    setState({ value: "", focused: false })
  }

  function select(record: HomeSessionRecord, options?: { background?: boolean }) {
    sessions.session.open(record.session, options)
    if (!options?.background) close()
  }

  return {
    query: {
      value: () => state.value,
      placeholder,
      open,
      focus,
      input: (value: string) => setState({ value, highlighted: "" }),
      close,
      includeArchived: () => state.includeArchived,
      toggleIncludeArchived: () => setState("includeArchived", (val) => !val),
    },
    result: {
      loading: () => (state.includeArchived ? remoteResults.loading : sessions.data.loading()),
      list: results,
      active,
      noResultsLabel: () => language.t("home.sessions.search.noResults", { query: query() }),
      highlight: (record: HomeSessionRecord) => setState("highlighted", homeSessionSearchKey(record)),
      move: (delta: number) => {
        const records = results()
        if (records.length === 0) return
        const index = records.findIndex((record) => homeSessionSearchKey(record) === active())
        const next = ((index === -1 ? 0 : index) + delta + records.length) % records.length
        setState("highlighted", homeSessionSearchKey(records[next]))
        list?.querySelector<HTMLElement>(`[data-key="${state.highlighted}"]`)?.scrollIntoView({ block: "nearest" })
      },
      select,
      selectActive: () => {
        const record = results().find((item) => homeSessionSearchKey(item) === active())
        if (record) select(record)
      },
    },
    element: {
      setRoot: (element: HTMLDivElement) => (root = element),
      setInput: (element: HTMLInputElement) => (input = element),
      setList: (element: HTMLDivElement) => (list = element),
    },
  }
}

export type HomeSessionSearchController = ReturnType<typeof createHomeSessionSearchController>
