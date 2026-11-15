import { expect, test } from "bun:test"
import fc from "fast-check"
import { promptOffsetWidth } from "../../src/prompt/display"
import type { PromptInfo } from "../../src/prompt/history"
import { expandTrackedPastedText } from "../../src/prompt/part"
import { findPastedTextAtOffset, type PasteChipExtmarks } from "../../src/prompt/paste-chip"

type Parts = PromptInfo["parts"][number][]

function textPart(text: string): Parts[number] {
  return { type: "text", text, synthetic: true }
}

function fakeExtmarks(marks: readonly { id: number; typeId: number; start: number; end: number }[]): PasteChipExtmarks {
  return {
    getAtOffset: (offset: number) => marks.filter((mark) => offset >= mark.start && offset < mark.end),
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

// Placeholder labels are inserted at display-width offsets, so prefixes and
// suffixes can contain wide characters and newlines.
const promptArb = fc
  .array(
    fc.record({
      prefix: fc.string({ unit: "grapheme-composite", maxLength: 20 }),
      text: textArb,
      suffix: fc.string({ unit: "grapheme-composite", maxLength: 20 }),
    }),
    { minLength: 1, maxLength: 4 },
  )
  .map((specs) => {
    let input = ""
    const ranges: { start: number; end: number; text: string }[] = []
    const parts: Parts = []

    for (const spec of specs) {
      input += spec.prefix
      const label = `[Pasted ~${spec.text.split("\n").length} lines]`
      const start = promptOffsetWidth(input)
      input += label
      const end = start + promptOffsetWidth(label)
      ranges.push({ start, end, text: spec.text })
      parts.push(textPart(spec.text))
      input += spec.suffix
    }

    return { input, ranges, parts }
  })

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

// R3: Opening, viewing, and closing the viewer leaves the prompt text, paste
// parts, extmark ranges, and cursor offset unchanged. Submitting after viewing
// sends the same text.
// Kind: round trip.
// Generator: arbitrary prompt text around tracked paste labels, with random
// viewer offsets and cursor positions.
test("R3 [round trip]: resolving viewer content leaves the prompt and submitted text unchanged", () => {
  fc.assert(
    fc.property(
      promptArb,
      fc.array(fc.nat({ max: 100 }), { minLength: 1, maxLength: 20 }),
      fc.nat({ max: 100 }),
      (prompt, raws, rawCursor) => {
        // Frozen so a mutation in the read path throws instead of being masked
        // by the equality check below.
        const ranges = deepFreeze(prompt.ranges)
        const parts = deepFreeze(prompt.parts)
        const marks = deepFreeze(
          ranges.map((range, index) => ({
            id: index + 1,
            typeId: 7,
            start: range.start,
            end: range.end,
          })),
        )
        const map = deepFreeze(new Map(marks.map((mark, index) => [mark.id, index])))
        const total = promptOffsetWidth(prompt.input)
        const state = deepFreeze({
          input: prompt.input,
          ranges,
          parts,
          cursor: rawCursor % (total + 1),
        })
        const snapshot = structuredClone(state)
        const submitted = expandTrackedPastedText(prompt.input, ranges)

        for (const chip of ranges) {
          expect(findPastedTextAtOffset(fakeExtmarks(marks), 7, map, parts, chip.start)).toBe(chip.text)
        }
        for (const raw of raws) {
          findPastedTextAtOffset(fakeExtmarks(marks), 7, map, parts, raw % (total + 10))
        }

        expect(state).toEqual(snapshot)
        expect(expandTrackedPastedText(prompt.input, ranges)).toBe(submitted)
      },
    ),
  )
})
