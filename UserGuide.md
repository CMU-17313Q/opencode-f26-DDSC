# User Guide

## View Pasted Text by Clicking the Paste Chip

Contributer: Ebil Jacob [RobbyTato] \
Issue Number: #3 \
Pull Request Number: #14 \
Branch Name: ebilj/view-pasted-text \

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


## Session Folders

Contributer: Ravin Kumar [Ravin-Kumar] \
Issue Number: #2 \
Pull Request Number: #17 \
Branch Name: ravink/session-folders \

### Description

Sessions in the TUI picker are grouped only by recency date which leaves users with no way to organise many sessions (e.g. by topic or workspace). This feature allows users to categorise sessions within a project into user-defined folders. Running the `/sessions` will now show sessions grouped by folder rather than by recency. The folders are sorted alphabetically with pinned sessions appearing at the top and sessions in "No Folder" appearing at the bottom. 

### How to use

```bash
git checkout ravink/session-folders
bun run dev
```

1. Start the TUI
2. Run the `/sessions` command to view your sessions grouped by folder
3. Use the `ctrl+o` keybind when hovering a session to move it to a folder
4. The dialogue should have all existing folders with sessions in them and the option to move to "No Folder"
5. When typing in the dialogue, the folder list should be filtered and the option to create the typed name will appear
6. Selecting any option should update the UI of `/sessions` command with the associated action
7. The folder assignments should persist between Opencode restarts (Quit Opencode, start the TUI again and check `/sessions` to make sure assignments persisted)

### Testing

Files:
- `packages/tui/test/component/dialog-session-list.test.ts`, `packages/tui/test/keybind-folder.test.ts`: picker helpers, grouping order, and shortcut wiring.
- `packages/opencode/test/session/session.test.ts, session-schema.test.ts`: folder assignment/clearing, defaults, row-mapper round-trips.
- `packages/opencode/test/server/httpapi-session.test.ts`: update-endpoint trim/clear/preserve behavior.
- `packages/core/test/database-migration.test.ts`: migrated databases include the folder column.

Commands:
```bash
cd packages/tui && bun test test/component/dialog-session-list.test.ts test/keybind-folder.test.ts
cd packages/core && bun test test/database-migration.test.ts
cd packages/opencode && bun test test/session/session.test.ts test/session/session-schema.test.ts test/server/session-actions.test.ts test/server/httpapi-session.test.ts test/server/session-list.test.ts test/server/session-select.test.ts
```

The unit tests cover all code paths taken by the changes and test all changes apart from graphical changes to the TUI and verification of keyboard actions and database changes on real data (the migration is only tested on an empty DB, not with real data). The TUI changes are tested manually and are therefore covered and the database changes are still tested as well as unit tests can feasibly test the change.
