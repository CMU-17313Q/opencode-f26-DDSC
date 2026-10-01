## View Pasted Text by Clicking the Paste Chip

Contributer: Ebil Jacob [RobbyTato]
Issue Number: #3
Pull Request Number: #14
Branch Name: ebilj/view-pasted-text

### Description

When pasting multi-line text into the prompt bar, the TUI collapses it into an orange `[Pasted ~N lines]` chip with no way to inspect what was behind it before submitting. Clicking a paste chip now opens a viewer dialog showing the full pasted text. The dialog fills the terminal (minus padding), fits short content exactly, scrolls when content overflows, and word-wraps long lines so no horizontal scrolling is needed. It closes via ESC, the `x` button, or backdrop click.

### How to use

git checkout ebilj/view-pasted-text

1. Launch the opencode TUI from your branch.
2. Paste multi-line text into the prompt bar. It collapses into a `[Pasted ~N lines]` chip.
3. Click the chip with the mouse. The viewer dialog opens with the full pasted text.
4. Scroll for long pastes. Verify long lines wrap.
5. Close with ESC, the `x` button, or backdrop click, then submit as normal.

### Testing

Test files:

* `packages/tui/test/prompt/paste-chip.test.ts` (new)
* `packages/tui/test/cli/tui/dialog-pasted-text.test.tsx` (new)
* `packages/tui/test/prompt/part.test.ts` (added cases)

Run:

cd packages/tui && bun test test/prompt/part.test.ts test/prompt/paste-chip.test.ts test/cli/tui/dialog-pasted-text.test.tsx

What is covered and why it is sufficient:

* `paste-chip.test.ts`: unit tests for `getBufferOffsetFromMouse()` (global coords to buffer offset, `-1` on miss) and `findPastedTextAtOffset()` (extmark to stored text, `undefined` on any miss), including the global-vs-local coordinate regression and wrapped-line / viewport cases. This proves clicks resolve to the correct paste.
* `dialog-pasted-text.test.tsx`: headless-renderer tests through real `dialog.replace()` covering rendering, ESC / `x` / backdrop close, wrap fit vs. scroll, vertical centering, anchored panel top, and vertical-scrollbar-without-horizontal-track. This proves the viewer displays and closes correctly.
* `part.test.ts`: placeholder-expansion cases proving submit-time expansion of the chip format still restores full text (regression guard).

All green (30 tests total). `npx tsgo --noEmit` passes in `packages/tui` and `packages/plugin`. Manually verified in the terminal: click chip opens dialog with correct content, scrolls for long pastes, wraps long lines, closes all three ways.