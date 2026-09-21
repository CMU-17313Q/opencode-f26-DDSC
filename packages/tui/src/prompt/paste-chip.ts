import type { PromptInfo } from "./history"

// Minimal structural view of the textarea pieces that paste-chip hit-testing
// needs, so tests can pass fakes. The real TextareaRenderable satisfies this
// shape.
export interface PasteChipTextarea {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly editorView: {
    getViewport(): { readonly offsetX: number; readonly offsetY: number }
    getLineInfo(): { readonly lineStartCols: readonly number[] }
  }
}

export interface PasteChipExtmarks {
  getAtOffset(offset: number): readonly { readonly id: number; readonly typeId: number }[]
}

// Mouse events carry global terminal coordinates. Convert to textarea-local
// cells, then map through the visual line info (display-width offsets) to a
// buffer offset that extmarks.getAtOffset understands. Returns -1 on a miss.
export function getBufferOffsetFromMouse(
  textarea: PasteChipTextarea,
  event: { readonly x: number; readonly y: number },
): number {
  const localX = event.x - textarea.x
  const localY = event.y - textarea.y
  if (localX < 0 || localY < 0 || localX >= textarea.width || localY >= textarea.height) return -1
  const viewport = textarea.editorView.getViewport()
  const visualRow = viewport.offsetY + localY
  const lineStartCols = textarea.editorView.getLineInfo().lineStartCols
  if (visualRow < 0 || visualRow >= lineStartCols.length) return -1
  return lineStartCols[visualRow] + viewport.offsetX + localX
}

// Resolve the pasted text behind a buffer offset, if the click landed on a
// tracked paste chip. Returns undefined on any miss.
export function findPastedTextAtOffset(
  extmarks: PasteChipExtmarks,
  promptPartTypeId: number,
  extmarkToPartIndex: ReadonlyMap<number, number>,
  parts: readonly PromptInfo["parts"][number][],
  offset: number,
): string | undefined {
  const extmark = extmarks.getAtOffset(offset).find((item) => item.typeId === promptPartTypeId)
  if (!extmark) return undefined
  const partIndex = extmarkToPartIndex.get(extmark.id)
  const part = partIndex === undefined ? undefined : parts[partIndex]
  if (!part || part.type !== "text" || !part.text) return undefined
  return part.text
}
