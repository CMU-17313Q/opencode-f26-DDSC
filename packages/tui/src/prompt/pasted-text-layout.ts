const DIALOG_CHROME_ROWS = 4
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })

function pastedTextContentWidth(terminalWidth: number) {
  return Math.max(1, terminalWidth - 8)
}

// Word wrap can use fewer columns than a hard character wrap, so counting
// display width alone undercounts rows. Walk wrapped words instead.
export function wrappedLineCount(content: string, width: number) {
  const wrapWidth = Math.max(1, width)
  return content.split("\n").reduce((total, line) => total + logicalLineRows(line, wrapWidth), 0)
}

export function pastedTextDialogHeight(content: string, terminalWidth: number, terminalHeight: number) {
  const rows = wrappedLineCount(content, pastedTextContentWidth(terminalWidth))
  return Math.min(rows + DIALOG_CHROME_ROWS, Math.max(1, terminalHeight - 5))
}

function logicalLineRows(line: string, width: number) {
  const text = line.trimEnd()
  if (!text) return 1

  let rows = 1
  let used = 0
  for (const token of text.match(/\s+|\S+/gu) ?? []) {
    if (/^\s+$/u.test(token)) {
      const space = Bun.stringWidth(token)
      if (used + space <= width) {
        used += space
      } else {
        // Whitespace at a wrap boundary is not rendered on either row.
        rows++
        used = 0
      }
      continue
    }

    const word = Bun.stringWidth(token)
    if (used + word <= width) {
      used += word
      continue
    }

    if (used > 0) {
      rows++
      used = 0
    }

    if (word <= width) {
      used = word
      continue
    }

    for (const grapheme of graphemes.segment(token)) {
      const size = Bun.stringWidth(grapheme.segment)
      if (used > 0 && used + size > width) {
        rows++
        used = 0
      }
      used += size
      if (used > width) {
        rows++
        used = 0
      }
    }
  }

  return rows
}
