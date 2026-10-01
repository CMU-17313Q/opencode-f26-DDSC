import type { DialogSelectOption } from "../ui/dialog-select"

export const NO_FOLDER_LABEL = "No folder"

export function sessionFolderLabel(folder?: string | null) {
  const trimmed = folder?.trim()
  return trimmed ? trimmed : NO_FOLDER_LABEL
}

export function compareFolderLabels(a: string, b: string) {
  if (a === b) return 0
  if (a === NO_FOLDER_LABEL) return 1
  if (b === NO_FOLDER_LABEL) return -1
  return a.localeCompare(b, undefined, { sensitivity: "base" })
}

export type FolderOptionValue = { type: "folder"; name?: string } | { type: "create"; name: string }

export function collectFolderNames(sessions: Array<{ folder?: string | null }>) {
  const seen = new Set<string>()
  for (const session of sessions) {
    const trimmed = session.folder?.trim()
    if (!trimmed) continue
    seen.add(trimmed)
  }
  return [...seen].toSorted(compareFolderLabels)
}

export function buildFolderOptions(folders: string[], query: string): DialogSelectOption<FolderOptionValue>[] {
  const trimmed = query.trim()
  const needle = trimmed.toLowerCase()
  const matches = needle ? folders.filter((folder) => folder.toLowerCase().includes(needle)) : folders
  const options: DialogSelectOption<FolderOptionValue>[] = [
    { title: NO_FOLDER_LABEL, value: { type: "folder" } },
    ...matches.map((folder) => ({ title: folder, value: { type: "folder", name: folder } as FolderOptionValue })),
  ]
  const exact = trimmed && folders.some((folder) => folder.toLowerCase() === needle)
  if (trimmed && !exact) options.push({ title: `Create "${trimmed}"`, value: { type: "create", name: trimmed } })
  return options
}

export function orderIDsByFolder(ids: string[], folderOf: (id: string) => string | undefined) {
  const groups = new Map<string, string[]>()
  for (const id of ids) {
    const folder = folderOf(id)
    if (folder === undefined) continue
    const list = groups.get(folder)
    if (list) list.push(id)
    else groups.set(folder, [id])
  }
  return [...groups.entries()]
    .toSorted(([a], [b]) => compareFolderLabels(a, b))
    .flatMap(([, group]) => group)
}
