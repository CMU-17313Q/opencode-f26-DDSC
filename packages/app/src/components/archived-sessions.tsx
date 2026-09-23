import { For, Show, createResource } from "solid-js"
import { createStore } from "solid-js/store"
import type { OpencodeClient, Session } from "@opencode-ai/sdk/v2/client"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { ContextMenu } from "@opencode-ai/ui/context-menu"
import { useLanguage } from "@/context/language"
import { showToast } from "@/utils/toast"

type Props = {
  directories: string[]
  client: OpencodeClient
  onRestore: (session: Session) => void | Promise<void>
}

function ArchivedSessions(props: Props) {
  const language = useLanguage()
  const [state, setState] = createStore({ pending: "", removed: [] as string[] })
  const [sessions, { refetch }] = createResource(
    () => [...new Set(props.directories)],
    async (directories) => {
      const lists = await Promise.all(
        directories.map((directory) =>
          props.client.session.list({ directory, archived: true, roots: true }, { throwOnError: true }),
        ),
      )
      return [
        ...new Map(lists.flatMap((list) => list.data ?? []).map((session) => [session.id, session])).values(),
      ].sort((a, b) => b.time.updated - a.time.updated)
    },
  )
  const visible = () => (sessions.latest ?? []).filter((session) => !state.removed.includes(session.id))
  async function restore(session: Session) {
    if (state.pending) return
    setState("pending", session.id)
    await props.client.session
      .update({ sessionID: session.id, directory: session.directory, time: { archived: null } }, { throwOnError: true })
      .then(async (result) => {
        await props.onRestore(result.data!)
        setState("removed", (ids) => [...ids, session.id])
        showToast({ title: language.t("session.unarchive.success") })
      })
      .catch(() => showToast({ title: language.t("session.unarchive.failed") }))
      .finally(() => setState("pending", ""))
  }
  return (
    <div data-component="archived-sessions" class="flex flex-col gap-2 p-3 max-h-96 overflow-y-auto">
      <Show when={sessions.loading}>
        <span>{language.t("common.loading")}</span>
      </Show>
      <Show when={sessions.error}>
        <Button onClick={() => refetch()}>{language.t("session.archived.retry")}</Button>
      </Show>
      <Show when={!sessions.loading && !sessions.error && !visible().length}>
        <p class="text-text-weak text-14-regular">{language.t("session.archived.empty")}</p>
      </Show>
      <For each={visible()}>
        {(session) => (
          <ContextMenu>
            <ContextMenu.Trigger
              as="div"
              tabIndex={0}
              data-session-id={session.id}
              class="flex items-center justify-between gap-3 rounded-md p-2 hover:bg-surface-base-hover"
              onKeyDown={(event: KeyboardEvent) => {
                if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.key.toLowerCase() !== "u") return
                event.preventDefault()
                void restore(session)
              }}
            >
              <span class="truncate text-14-regular">{session.title}</span>
              <Button size="small" variant="ghost" disabled={!!state.pending} onClick={() => restore(session)}>
                {language.t("session.unarchive")}
              </Button>
            </ContextMenu.Trigger>
            <ContextMenu.Portal>
              <ContextMenu.Content>
                <ContextMenu.Item disabled={!!state.pending} onSelect={() => void restore(session)}>
                  {language.t("session.unarchive")}
                </ContextMenu.Item>
              </ContextMenu.Content>
            </ContextMenu.Portal>
          </ContextMenu>
        )}
      </For>
    </div>
  )
}

export function DialogArchivedSessions(props: Props) {
  const language = useLanguage()
  return (
    <Dialog title={language.t("session.archived.title")}>
      <ArchivedSessions {...props} />
    </Dialog>
  )
}

export function SidebarArchivedSessions(props: Props) {
  const language = useLanguage()
  const [state, setState] = createStore({ open: false })
  return (
    <div>
      <Button variant="ghost" onClick={() => setState("open", !state.open)}>
        {language.t("session.archived.title")}
      </Button>
      <Show when={state.open}>
        <ArchivedSessions {...props} />
      </Show>
    </div>
  )
}
