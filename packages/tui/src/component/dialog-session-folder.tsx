import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { useToast } from "../ui/toast"
import { errorMessage } from "../util/error"
import { createMemo, createSignal, onMount } from "solid-js"
import { buildFolderOptions, type FolderOptionValue } from "./session-folder"

export function DialogSessionFolder(props: {
  sessionID: string
  folders: string[]
  currentFolder?: string | null
  onDone: () => void
}) {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const toast = useToast()
  const [query, setQuery] = createSignal("")
  const current = props.currentFolder?.trim() || undefined

  const options = createMemo(() => buildFolderOptions(props.folders, query()))

  onMount(() => {
    dialog.setSize("medium")
  })

  return (
    <DialogSelect
      title="Move to folder"
      options={options()}
      skipFilter={true}
      onFilter={setQuery}
      current={current ? { type: "folder", name: current } : { type: "folder" }}
      onSelect={async (option) => {
        const value = option.value as FolderOptionValue
        const folder = value.type === "create" ? value.name : (value.name ?? "")
        try {
          const result = await sdk.client.session.update({ sessionID: props.sessionID, folder })
          if (result.error) {
            toast.show({
              variant: "error",
              title: "Failed to move session",
              message: errorMessage(result.error),
            })
            props.onDone()
            return
          }
        } catch (err) {
          toast.show({
            variant: "error",
            title: "Failed to move session",
            message: errorMessage(err),
          })
          props.onDone()
          return
        }
        await sync.session.refresh()
        props.onDone()
      }}
    />
  )
}
