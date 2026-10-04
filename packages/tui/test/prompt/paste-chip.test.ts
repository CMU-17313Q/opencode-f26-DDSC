import { describe, expect, test } from "bun:test"
import {
  findPastedTextAtOffset,
  getBufferOffsetFromMouse,
  type PasteChipExtmarks,
  type PasteChipTextarea,
} from "../../src/prompt/paste-chip"
import type { PromptInfo } from "../../src/prompt/history"

type Parts = PromptInfo["parts"][number][]

function fakeTextarea(input: {
  x?: number
  y?: number
  width?: number
  height?: number
  offsetX?: number
  offsetY?: number
  lineStartCols?: number[]
} = {}): PasteChipTextarea {
  return {
    x: input.x ?? 10,
    y: input.y ?? 5,
    width: input.width ?? 80,
    height: input.height ?? 10,
    editorView: {
      getViewport: () => ({ offsetX: input.offsetX ?? 0, offsetY: input.offsetY ?? 0 }),
      getLineInfo: () => ({ lineStartCols: input.lineStartCols ?? [0] }),
    },
  }
}

function fakeExtmarks(ranges: { id: number; typeId: number; start: number; end: number }[]): PasteChipExtmarks {
  return {
    getAtOffset: (offset: number) => ranges.filter((item) => offset >= item.start && offset < item.end),
  }
}

function textPart(text: string): Parts[number] {
  return { type: "text", text, synthetic: true }
}

describe("getBufferOffsetFromMouse", () => {
  test("maps the top-left cell to the line start using global coordinates", () => {
    // The textarea sits at (10, 5); the click position is global, so the
    // textarea origin itself must resolve to offset 0. The original
    // implementation treated event coordinates as textarea-local and missed
    // every chip on a positioned prompt.
    expect(getBufferOffsetFromMouse(fakeTextarea(), { x: 10, y: 5 })).toBe(0)
  })

  test("adds the column within the first line", () => {
    expect(getBufferOffsetFromMouse(fakeTextarea(), { x: 13, y: 5 })).toBe(3)
  })

  test("uses the visual row start for wrapped lines", () => {
    const textarea = fakeTextarea({ lineStartCols: [0, 40] })
    expect(getBufferOffsetFromMouse(textarea, { x: 12, y: 6 })).toBe(42)
  })

  test("accounts for vertical scroll", () => {
    const textarea = fakeTextarea({ offsetY: 2, lineStartCols: [0, 40, 80] })
    expect(getBufferOffsetFromMouse(textarea, { x: 10, y: 5 })).toBe(80)
  })

  test("accounts for horizontal scroll", () => {
    const textarea = fakeTextarea({ offsetX: 7 })
    expect(getBufferOffsetFromMouse(textarea, { x: 10, y: 5 })).toBe(7)
  })

  test("works when the textarea sits at the origin", () => {
    const textarea = fakeTextarea({ x: 0, y: 0 })
    expect(getBufferOffsetFromMouse(textarea, { x: 4, y: 0 })).toBe(4)
  })

  test("rejects clicks outside the textarea bounds", () => {
    const textarea = fakeTextarea()
    expect(getBufferOffsetFromMouse(textarea, { x: 9, y: 5 })).toBe(-1)
    expect(getBufferOffsetFromMouse(textarea, { x: 10, y: 4 })).toBe(-1)
    expect(getBufferOffsetFromMouse(textarea, { x: 90, y: 5 })).toBe(-1)
    expect(getBufferOffsetFromMouse(textarea, { x: 10, y: 15 })).toBe(-1)
  })

  test("rejects rows past the reported line info", () => {
    const textarea = fakeTextarea({ lineStartCols: [0] })
    expect(getBufferOffsetFromMouse(textarea, { x: 10, y: 6 })).toBe(-1)
  })
})

describe("findPastedTextAtOffset", () => {
  const typeId = 7
  const parts: Parts = [textPart("alpha\nbeta")]

  test("returns the pasted text behind a chip", () => {
    const extmarks = fakeExtmarks([{ id: 3, typeId, start: 10, end: 20 }])
    expect(findPastedTextAtOffset(extmarks, typeId, new Map([[3, 0]]), parts, 15)).toBe("alpha\nbeta")
  })

  test("finds the paste chip among other extmark types", () => {
    const extmarks = fakeExtmarks([
      { id: 1, typeId: 99, start: 10, end: 20 },
      { id: 3, typeId, start: 10, end: 20 },
    ])
    expect(findPastedTextAtOffset(extmarks, typeId, new Map([[3, 0]]), parts, 15)).toBe("alpha\nbeta")
  })

  test("returns undefined when no extmark covers the offset", () => {
    const extmarks = fakeExtmarks([{ id: 3, typeId, start: 10, end: 20 }])
    expect(findPastedTextAtOffset(extmarks, typeId, new Map([[3, 0]]), parts, 25)).toBeUndefined()
  })

  test("returns undefined when only other extmark types cover the offset", () => {
    const extmarks = fakeExtmarks([{ id: 1, typeId: 99, start: 10, end: 20 }])
    expect(findPastedTextAtOffset(extmarks, typeId, new Map([[1, 0]]), parts, 15)).toBeUndefined()
  })

  test("returns undefined when the extmark has no mapped part", () => {
    const extmarks = fakeExtmarks([{ id: 3, typeId, start: 10, end: 20 }])
    expect(findPastedTextAtOffset(extmarks, typeId, new Map(), parts, 15)).toBeUndefined()
  })

  test("returns undefined when the mapped part index is stale", () => {
    const extmarks = fakeExtmarks([{ id: 3, typeId, start: 10, end: 20 }])
    expect(findPastedTextAtOffset(extmarks, typeId, new Map([[3, 5]]), parts, 15)).toBeUndefined()
  })

  test("returns undefined for non-text parts", () => {
    const fileParts: Parts = [
      { type: "file", mime: "image/png", filename: "tiny.png", url: "data:image/png;base64,abc" },
    ]
    const extmarks = fakeExtmarks([{ id: 3, typeId, start: 10, end: 20 }])
    expect(findPastedTextAtOffset(extmarks, typeId, new Map([[3, 0]]), fileParts, 15)).toBeUndefined()
  })

  test("returns undefined for empty pasted text", () => {
    const extmarks = fakeExtmarks([{ id: 3, typeId, start: 10, end: 20 }])
    expect(findPastedTextAtOffset(extmarks, typeId, new Map([[3, 0]]), [textPart("")], 15)).toBeUndefined()
  })
})
