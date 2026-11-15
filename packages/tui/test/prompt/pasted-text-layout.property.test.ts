import { expect, test } from "bun:test"
import fc from "fast-check"
import { pastedTextDialogHeight, wrappedLineCount } from "../../src/prompt/pasted-text-layout"

const wordArb = fc
  .tuple(fc.constantFrom("x", "界", "😀"), fc.integer({ min: 1, max: 80 }))
  .map(([char, count]) => char.repeat(count))

// Words range from single characters to several times the wrap width. Lines
// include empty cases, and widths include both narrow and wide terminals.
const layoutArb = fc
  .record({
    width: fc.integer({ min: 2, max: 40 }),
    lines: fc.array(
      fc.array(wordArb, { minLength: 0, maxLength: 12 }),
      { minLength: 1, maxLength: 4 },
    ),
    height: fc.integer({ min: 1, max: 40 }),
  })
  .map(({ width, lines, height }) => ({
    content: lines.map((words) => words.join(" ")).join("\n"),
    width,
    height,
  }))

// A deliberately slow model that materializes each row instead of counting
// columns. It is easy to check by eye and does not share the production logic.
function greedyRows(content: string, width: number) {
  return content.split("\n").reduce((total, line) => total + greedyLineRows(line, width), 0)
}

function greedyLineRows(line: string, width: number) {
  const text = line.trimEnd()
  if (!text) return 1

  const rows: string[] = []
  let row = ""
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = row ? `${row} ${word}` : word
    if (Bun.stringWidth(candidate) <= width) {
      row = candidate
      continue
    }

    if (row) {
      rows.push(row)
      row = ""
    }

    let rest = word
    while (Bun.stringWidth(rest) > width) {
      let chunk = ""
      for (const char of rest) {
        if (chunk && Bun.stringWidth(chunk + char) > width) break
        chunk += char
      }
      if (!chunk) chunk = rest[0]
      rows.push(chunk)
      rest = rest.slice(chunk.length)
    }
    row = rest
  }

  rows.push(row)
  return rows.length
}

// R2: The viewer never drops or replaces content. It fits short content, caps
// at terminal height, scrolls vertically when needed, and wraps long lines.
// Kind: invariant.
// Generator: words built from narrow, wide, and emoji characters, with lengths
// from one character to several screen widths.
test("R2 [invariant]: the viewer never under-allocates rows for wrapped content", () => {
  fc.assert(
    fc.property(layoutArb, ({ content, width, height }) => {
      const actual = greedyRows(content, width)
      expect(wrappedLineCount(content, width)).toBeGreaterThanOrEqual(actual)

      const cap = Math.max(1, height - 5)
      const dialogHeight = pastedTextDialogHeight(content, width + 8, height)
      expect(dialogHeight).toBeLessThanOrEqual(cap)

      if (actual + 4 <= cap) {
        expect(dialogHeight - 4).toBeGreaterThanOrEqual(actual)
      }
    }),
  )
})

// R2: The viewer never drops or replaces content. It fits short content, caps
// at terminal height, scrolls vertically when needed, and wraps long lines.
// Kind: metamorphic.
// Generator: the same content at a width and at a wider width.
test("R2 [metamorphic]: widening the terminal never increases the wrapped-row count", () => {
  fc.assert(
    fc.property(layoutArb, fc.integer({ min: 0, max: 40 }), ({ content, width }, extra) => {
      expect(wrappedLineCount(content, width + extra)).toBeLessThanOrEqual(wrappedLineCount(content, width))
    }),
  )
})
