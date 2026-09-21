/** @jsxImportSource @opentui/solid */
import { ScrollBoxRenderable, type CapturedFrame, type Renderable, type RGBA } from "@opentui/core"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { onCleanup, onMount } from "solid-js"
import { tmpdir } from "../../fixture/fixture"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import type { TuiKeybind } from "../../../src/config/keybind"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"

type TestApp = Awaited<ReturnType<typeof testRender>>

async function mountDialogPastedText(input: {
  root: string
  keybinds: Partial<TuiKeybind.Keybinds>
  content: string
  onClose: () => void
}) {
  const state = path.join(input.root, "state")
  await mkdir(state, { recursive: true })
  await Bun.write(path.join(state, "kv.json"), "{}")

  const [
    { DialogProvider, useDialog },
    { DialogPastedText },
    { KVProvider },
    { ThemeProvider },
    { TuiConfigProvider },
    { ToastProvider },
    { OpencodeKeymapProvider, registerOpencodeKeymap },
  ] = await Promise.all([
    import("../../../src/ui/dialog"),
    import("../../../src/component/dialog-pasted-text"),
    import("../../../src/context/kv"),
    import("../../../src/context/theme"),
    import("../../../src/config"),
    import("../../../src/ui/toast"),
    import("../../../src/keymap"),
  ])

  // Open through dialog.replace() like production does, so the frames exercise
  // the real Dialog chrome (backdrop, panel sizing, vertical centering).
  function Opener() {
    const dialog = useDialog()
    onMount(() => {
      dialog.replace(() => <DialogPastedText content={input.content} onClose={input.onClose} />)
    })
    onCleanup(() => dialog.clear())
    return null
  }

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const resolvedConfig = createTuiResolvedConfig({
      keybinds: input.keybinds,
      leader_timeout: 1000,
    })
    const off = registerOpencodeKeymap(keymap, renderer, resolvedConfig)
    onCleanup(off)

    return (
      <TestTuiContexts
        directory={input.root}
        paths={{
          home: input.root,
          state,
          worktree: input.root,
        }}
      >
        <OpencodeKeymapProvider keymap={keymap}>
          <TuiConfigProvider config={resolvedConfig}>
            <KVProvider>
              <ThemeProvider mode="dark">
                <ToastProvider>
                  <DialogProvider>
                    <Opener />
                  </DialogProvider>
                </ToastProvider>
              </ThemeProvider>
            </KVProvider>
          </TuiConfigProvider>
        </OpencodeKeymapProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Harness />, { width: 100, height: 30, kittyKeyboard: true })
  return {
    app,
    async cleanup() {
      app.renderer.destroy()
    },
  }
}

// The test renderer does not run a continuous loop, so pump frames manually
// until the predicate matches (or give up and return the last frame).
async function frameMatching(app: TestApp, predicate: (frame: string) => boolean): Promise<string> {
  let frame = ""
  for (let i = 0; i < 40; i++) {
    await app.renderOnce()
    frame = app.captureCharFrame()
    if (predicate(frame)) return frame
    await Bun.sleep(10)
  }
  return frame
}

async function waitFor(fn: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (fn()) return
    await Bun.sleep(10)
  }
  throw new Error("timed out waiting for condition")
}

function findScrollBox(root: Renderable): ScrollBoxRenderable | undefined {
  if (root instanceof ScrollBoxRenderable) return root
  for (const child of root.getChildren()) {
    const found = findScrollBox(child)
    if (found) return found
  }
  return undefined
}

async function spansMatching(app: TestApp, predicate: (spans: CapturedFrame) => boolean): Promise<CapturedFrame> {
  let spans = app.captureSpans()
  for (let i = 0; i < 40; i++) {
    await app.renderOnce()
    spans = app.captureSpans()
    if (predicate(spans)) return spans
    await Bun.sleep(10)
  }
  return spans
}

function containsText(spans: CapturedFrame, text: string): boolean {
  return spans.lines.some((line) => line.spans.some((span) => span.text.includes(text)))
}

// The panel background is identified by the title span's own background; the
// first row carrying it is the panel's top edge.
function panelTopRow(spans: CapturedFrame, marker: string): number {
  let bg: RGBA | undefined
  for (const line of spans.lines) {
    const span = line.spans.find((span) => span.text.includes(marker))
    if (span) {
      bg = span.bg
      break
    }
  }
  expect(bg).toBeDefined()
  return spans.lines.findIndex((line) => line.spans.some((span) => bg!.equals(span.bg)))
}

test("dialog pasted text renders title and short content", async () => {
  await using tmp = await tmpdir()
  const closed: boolean[] = []
  const dialog = await mountDialogPastedText({
    root: tmp.path,
    keybinds: {},
    content: "short text",
    onClose: () => closed.push(true),
  })

  try {
    const frame = await frameMatching(dialog.app, (frame) => frame.includes("Pasted Text"))
    expect(frame).toContain("Pasted Text")
    expect(frame).toContain("short text")
    expect(frame).toContain("×")
    expect(closed).toHaveLength(0)
  } finally {
    await dialog.cleanup()
  }
})

test("dialog pasted text renders long multiline content", async () => {
  await using tmp = await tmpdir()
  const closed: boolean[] = []
  const dialog = await mountDialogPastedText({
    root: tmp.path,
    keybinds: {},
    content: "line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9\nline 10",
    onClose: () => closed.push(true),
  })

  try {
    const frame = await frameMatching(dialog.app, (frame) => frame.includes("Pasted Text"))
    expect(frame).toContain("line 1")
    expect(frame).toContain("line 10")
    expect(closed).toHaveLength(0)
  } finally {
    await dialog.cleanup()
  }
})

test("dialog pasted text closes on escape key", async () => {
  await using tmp = await tmpdir()
  const closed: boolean[] = []
  const dialog = await mountDialogPastedText({
    root: tmp.path,
    keybinds: {},
    content: "test content",
    onClose: () => closed.push(true),
  })

  try {
    await frameMatching(dialog.app, (frame) => frame.includes("Pasted Text"))
    dialog.app.mockInput.pressEscape()
    await waitFor(() => closed.length === 1)
    expect(closed).toHaveLength(1)
  } finally {
    await dialog.cleanup()
  }
})

test("dialog pasted text closes on close button click", async () => {
  await using tmp = await tmpdir()
  const closed: boolean[] = []
  const dialog = await mountDialogPastedText({
    root: tmp.path,
    keybinds: {},
    content: "test content",
    onClose: () => closed.push(true),
  })

  try {
    const frame = await frameMatching(dialog.app, (frame) => frame.includes("×"))
    const rows = frame.split("\n")
    const rowIndex = rows.findIndex((row) => row.includes("×"))
    expect(rowIndex).toBeGreaterThanOrEqual(0)
    const colIndex = rows[rowIndex].indexOf("×")
    await dialog.app.mockMouse.click(colIndex, rowIndex)
    await waitFor(() => closed.length === 1)
    expect(closed).toHaveLength(1)
  } finally {
    await dialog.cleanup()
  }
})

test("dialog pasted text fits wrapped lines without scrolling", async () => {
  await using tmp = await tmpdir()
  const closed: boolean[] = []
  const words = Array.from({ length: 60 }, (_, i) => `w${String(i + 1).padStart(2, "0")}`)
  const dialog = await mountDialogPastedText({
    root: tmp.path,
    keybinds: {},
    content: words.join(" "),
    onClose: () => closed.push(true),
  })

  try {
    // A single logical line wraps onto ~3 visual rows at this width. The
    // dialog height must account for wrapping: w30 sits on the second wrapped
    // row, so it is only visible without scrolling when the dialog grew past
    // the single-row height the logical line count alone would give.
    const frame = await frameMatching(dialog.app, (frame) => frame.includes("w01"))
    expect(frame).toContain("w01")
    expect(frame).toContain("w30")
    expect(closed).toHaveLength(0)
  } finally {
    await dialog.cleanup()
  }
})

test("short dialog is vertically centered instead of hugging the top", async () => {
  await using tmp = await tmpdir()
  const closed: boolean[] = []
  const dialog = await mountDialogPastedText({
    root: tmp.path,
    keybinds: {},
    content: "hi",
    onClose: () => closed.push(true),
  })

  try {
    const frame = await frameMatching(dialog.app, (frame) => frame.includes("Pasted Text"))
    const rows = frame.split("\n")
    const titleRow = rows.findIndex((row) => row.includes("Pasted Text"))
    expect(titleRow).toBeGreaterThanOrEqual(0)
    // In a 30-row terminal a 5-row dialog centers around row 14. A
    // top-anchored dialog would put the title at row ~4, so anything in the
    // top third means centering regressed.
    expect(titleRow).toBeGreaterThanOrEqual(10)
    expect(closed).toHaveLength(0)
  } finally {
    await dialog.cleanup()
  }
})

test("dialog pasted text wraps long lines instead of clipping them", async () => {
  await using tmp = await tmpdir()
  const closed: boolean[] = []
  const words = Array.from({ length: 60 }, (_, i) => `w${String(i + 1).padStart(2, "0")}`)
  const dialog = await mountDialogPastedText({
    root: tmp.path,
    keybinds: {},
    content: words.join(" "),
    onClose: () => closed.push(true),
  })

  try {
    const frame = await frameMatching(dialog.app, (frame) => frame.includes("w01"))
    expect(frame).toContain("w01")
    // With wrapMode="none" the tail of the line would be unreachable: there is
    // no horizontal scrolling, so w60 only becomes visible when the text wraps
    // onto multiple visual rows that can be scrolled vertically.
    const scroll = findScrollBox(dialog.app.renderer.root)
    expect(scroll).toBeDefined()
    for (let i = 0; i < 5; i++) {
      await dialog.app.mockMouse.scroll(scroll!.screenX + 2, scroll!.screenY, "down")
      await Bun.sleep(10)
    }
    const scrolled = await frameMatching(dialog.app, (frame) => frame.includes("w60"))
    expect(scrolled).toContain("w60")
    expect(closed).toHaveLength(0)
  } finally {
    await dialog.cleanup()
  }
})

test("vertical scrollbar shows without a horizontal track", async () => {
  await using tmp = await tmpdir()
  const closed: boolean[] = []
  const content = Array.from({ length: 40 }, (_, i) => `scroll line ${i + 1}`).join("\n")
  const dialog = await mountDialogPastedText({
    root: tmp.path,
    keybinds: {},
    content,
    onClose: () => closed.push(true),
  })

  try {
    const frame = await frameMatching(dialog.app, (frame) => frame.includes("scroll line 1"))
    expect(frame).toContain("scroll line 1")
    const barCounts = frame.split("\n").map((row) => row.match(/█/g)?.length ?? 0)
    // The vertical scrollbar track is back...
    expect(barCounts.some((count) => count > 0)).toBe(true)
    // ...but the full-width horizontal track that ate a content row is gone.
    expect(barCounts.every((count) => count < 10)).toBe(true)
    expect(closed).toHaveLength(0)
  } finally {
    await dialog.cleanup()
  }
})

test("panel top edge stays fixed as content grows", async () => {
  await using tmp = await tmpdir()
  const closed: boolean[] = []
  const short = await mountDialogPastedText({
    root: tmp.path,
    keybinds: {},
    content: "hi",
    onClose: () => closed.push(true),
  })
  const tallContent = Array.from({ length: 20 }, (_, i) => `tall line ${i + 1}`).join("\n")
  const tall = await mountDialogPastedText({
    root: tmp.path,
    keybinds: {},
    content: tallContent,
    onClose: () => closed.push(true),
  })

  try {
    const shortSpans = await spansMatching(short.app, (spans) => containsText(spans, "Pasted Text"))
    const tallSpans = await spansMatching(tall.app, (spans) => containsText(spans, "Pasted Text"))
    expect(containsText(shortSpans, "hi")).toBe(true)
    expect(containsText(tallSpans, "tall line 1")).toBe(true)
    // The full-height panel is top-anchored, so its top edge must not drift as
    // content grows. A compact centered panel would fail this: its top edge
    // rises toward the terminal top with every added line.
    expect(panelTopRow(shortSpans, "Pasted Text")).toBe(panelTopRow(tallSpans, "Pasted Text"))
  } finally {
    await short.cleanup()
    await tall.cleanup()
  }
})
