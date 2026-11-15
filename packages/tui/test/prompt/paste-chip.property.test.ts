import { expect, test } from "bun:test"
import fc from "fast-check"
import {
  findPastedTextAtOffset,
  getBufferOffsetFromMouse,
  type PasteChipExtmarks,
  type PasteChipTextarea,
} from "../../src/prompt/paste-chip"
import type { PromptInfo } from "../../src/prompt/history"

type Parts = PromptInfo["parts"][number][]
type Chip = { id: number; typeId: number; start: number; end: number; text: string; partIndex: number }

function textPart(text: string): Parts[number] {
  return { type: "text", text, synthetic: true }
}

function fakeExtmarks(marks: readonly { id: number; typeId: number; start: number; end: number }[]): PasteChipExtmarks {
  return {
    getAtOffset: (offset: number) => marks.filter((mark) => offset >= mark.start && offset < mark.end),
  }
}

function fakeTextarea(input: {
  x: number
  y: number
  width: number
  height: number
  offsetX: number
  offsetY: number
  lineStartCols: number[]
}): PasteChipTextarea {
  return {
    ...input,
    editorView: {
      getViewport: () => ({ offsetX: input.offsetX, offsetY: input.offsetY }),
      getLineInfo: () => ({ lineStartCols: input.lineStartCols }),
    },
  }
}

const textArb = fc
  .array(
    fc.oneof(
      fc.constantFrom("\n", " ", "界", "😀", "alpha"),
      fc.string({ unit: "grapheme-composite", maxLength: 4 }),
    ),
    { minLength: 1, maxLength: 8 },
  )
  .map((parts) => `x${parts.join("")}`)

// Ranges are non-overlapping and separated by gaps. Text is prefixed with the
// chip index so a swapped part is never mistaken for the expected one.
function chipsArb(minLength: number) {
  return fc
    .array(
      fc.record({
        gap: fc.nat({ max: 20 }),
        length: fc.integer({ min: 1, max: 20 }),
        text: textArb,
      }),
      { minLength, maxLength: 5 },
    )
    .map((specs) => {
      let cursor = 0
      return specs.map((spec, index): Chip => {
        const start = cursor + spec.gap
        const end = start + spec.length
        cursor = end
        return { id: index + 1, typeId: 7, start, end, text: `${index}:${spec.text}`, partIndex: index }
      })
    })
}

// R1: A click on a paste chip opens a read only viewer titled "Pasted Text"
// with exactly that chip's stored text.
// Kind: invariant.
// Generator: arbitrary text and ranges, with offsets sampled from inside each
// range so start and end boundaries are exercised.
test("R1 [invariant]: every click inside a chip resolves to exactly that chip's stored text", () => {
  fc.assert(
    fc.property(chipsArb(1), fc.nat({ max: 100 }), (chips, raw) => {
      const chip = chips[0]
      const offset = chip.start + (raw % (chip.end - chip.start))
      const textarea = fakeTextarea({
        x: 0,
        y: 0,
        width: offset + 1,
        height: 1,
        offsetX: 0,
        offsetY: 0,
        lineStartCols: [0],
      })

      expect(getBufferOffsetFromMouse(textarea, { x: offset, y: 0 })).toBe(offset)
      expect(
        findPastedTextAtOffset(fakeExtmarks([chip]), chip.typeId, new Map([[chip.id, chip.partIndex]]), [
          textPart(chip.text),
        ], offset),
      ).toBe(chip.text)
    }),
  )
})

// R4: A click that does not land on a paste chip opens nothing and shows no
// paste content.
// Kind: invariant.
// Generator: the same non-overlapping chip layout, with offsets taken from
// gaps, before a chip, and after the last chip.
test("R4 [invariant]: offsets outside every paste range resolve to nothing", () => {
  fc.assert(
    fc.property(chipsArb(1), fc.array(fc.nat({ max: 100 }), { minLength: 1, maxLength: 10 }), (chips, raws) => {
      const parts = chips.map((chip) => textPart(chip.text))
      const map = new Map(chips.map((chip) => [chip.id, chip.partIndex]))
      const marks = chips.map(({ id, typeId, start, end }) => ({ id, typeId, start, end }))
      const lastEnd = chips[chips.length - 1].end

      for (const raw of raws) {
        expect(findPastedTextAtOffset(fakeExtmarks(marks), 7, map, parts, lastEnd + raw)).toBeUndefined()
      }

      const outside = (offset: number) => chips.every((chip) => offset < chip.start || offset >= chip.end)

      for (const [index, chip] of chips.entries()) {
        const gapOffset = index > 0 ? chips[index - 1].end : -1
        if (gapOffset >= 0 && outside(gapOffset)) {
          expect(findPastedTextAtOffset(fakeExtmarks(marks), 7, map, parts, gapOffset)).toBeUndefined()
        }
        if (chip.start > 0 && outside(chip.start - 1)) {
          expect(findPastedTextAtOffset(fakeExtmarks(marks), 7, map, parts, chip.start - 1)).toBeUndefined()
        }
      }
    }),
  )
})

// R4: A click that does not land on a paste chip opens nothing and shows no
// paste content.
// Kind: metamorphic.
// Generator: arbitrary textarea geometry and a click, then the same scene
// translated by a random amount. Translation must not change the resolved
// offset.
test("R4 [metamorphic]: shifting the textarea and click together leaves the resolved offset unchanged", () => {
  fc.assert(
    fc.property(
      fc.record({
        x: fc.integer({ min: -10, max: 10 }),
        y: fc.integer({ min: -10, max: 10 }),
        width: fc.integer({ min: 1, max: 40 }),
        height: fc.integer({ min: 1, max: 20 }),
        offsetX: fc.integer({ min: 0, max: 10 }),
        offsetY: fc.integer({ min: 0, max: 10 }),
        rows: fc.integer({ min: 1, max: 20 }),
        localX: fc.integer({ min: -5, max: 45 }),
        localY: fc.integer({ min: -5, max: 25 }),
        dx: fc.integer({ min: -20, max: 20 }),
        dy: fc.integer({ min: -20, max: 20 }),
      }),
      (input) => {
        const lineStartCols = Array.from({ length: input.rows }, (_, index) => index * (input.width + 1))
        const textarea = fakeTextarea({ ...input, lineStartCols })
        const click = { x: textarea.x + input.localX, y: textarea.y + input.localY }
        const shifted = { ...textarea, x: textarea.x + input.dx, y: textarea.y + input.dy }
        const shiftedClick = { x: click.x + input.dx, y: click.y + input.dy }

        expect(getBufferOffsetFromMouse(shifted, shiftedClick)).toBe(getBufferOffsetFromMouse(textarea, click))
      },
    ),
  )
})

// R4: A click that does not land on a paste chip opens nothing and shows no
// paste content.
// Kind: invariant.
// Generator: walks each branch that must fail closed, including a missing map,
// a stale map, another extmark type, empty text, and a non-text part.
test("R4 [invariant]: non paste and empty mappings resolve to nothing", () => {
  fc.assert(
    fc.property(fc.nat({ max: 20 }), fc.integer({ min: 1, max: 20 }), (start, length) => {
      const end = start + length
      const offset = start
      const marks = [{ id: 1, typeId: 7, start, end }]
      const mapped = new Map([[1, 0]])
      const text = textPart("value")
      const file = { type: "file" as const, mime: "image/png", filename: "tiny.png", url: "data:image/png;base64,abc" }

      expect(findPastedTextAtOffset(fakeExtmarks(marks), 7, new Map(), [text], offset)).toBeUndefined()
      expect(findPastedTextAtOffset(fakeExtmarks(marks), 7, new Map([[1, 4]]), [text], offset)).toBeUndefined()
      expect(findPastedTextAtOffset(fakeExtmarks(marks), 7, mapped, [textPart("")], offset)).toBeUndefined()
      expect(findPastedTextAtOffset(fakeExtmarks(marks), 7, mapped, [file], offset)).toBeUndefined()
      expect(
        findPastedTextAtOffset(fakeExtmarks([{ id: 1, typeId: 99, start, end }]), 7, mapped, [text], offset),
      ).toBeUndefined()
    }),
  )
})

// R5: With multiple paste chips, clicking one shows only that chip's text.
// Kind: model/oracle.
// Generator: several chips with distinct text and a rotated extmark to part
// mapping, so extmark order and part order are not the same.
test("R5 [model/oracle]: with several chips, each offset resolves only to its own chip's text", () => {
  fc.assert(
    fc.property(chipsArb(2), fc.nat({ max: 20 }), (chips, raw) => {
      const rotation = raw % chips.length
      const mapped = chips.map((chip, index) => ({ ...chip, partIndex: (index + rotation) % chips.length }))
      const parts = Array.from({ length: mapped.length }, (_, partIndex) => {
        const chip = mapped.find((item) => item.partIndex === partIndex)
        if (!chip) throw new Error("missing part")
        return textPart(chip.text)
      })
      const map = new Map(mapped.map((chip) => [chip.id, chip.partIndex]))
      const marks = mapped.map(({ id, typeId, start, end }) => ({ id, typeId, start, end }))

      for (const chip of mapped) {
        const resolved = findPastedTextAtOffset(fakeExtmarks(marks), 7, map, parts, chip.start)
        expect(resolved).toBe(chip.text)
        for (const other of mapped) {
          if (other === chip) continue
          expect(resolved).not.toBe(other.text)
        }
      }
    }),
  )
})
