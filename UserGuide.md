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

## Work Across Multiple Repositories in One Session

Contributer: Sultan Abdulla [saabdullcmuq] \
Issue Number: #6 \
Pull Request Number: #15 \
Branch Name: saabdull/multi-repo \

### Description

An opencode project used to be tied to a single repository. Working on a change that spans two repos (for example a backend and its client) meant separate sessions, or approving an `external_directory` prompt every time the agent touched the other repo. A project can now have extra repository roots, and the agent can read, write and search every root in a single session.

Each root gets a short alias taken from its folder name. If two folders share a name, the second gets a suffix such as `api-2`. Once a project has more than one root:

* File paths are shown with the repo alias in front, like `repo-b/src/main.py`, so files with the same name in different repos stay distinct.
* The agent's system prompt lists every root, and the agent can use alias-prefixed paths in its read, write, edit, patch, glob and grep tools. Extra roots never trigger the `external_directory` prompt.
* `@` file mentions search every root and label each result with its repo.
* The sidebar gets a **Repositories** section listing each root (primary marked) and the files the agent touched in it. A `⎇ <repo> · N repos` indicator appears next to the prompt.

Roots are saved on the project in the database (new `roots` column and migration), so they persist across sessions and restarts. Projects with a single repository behave exactly as before.

### How to use

```bash
git checkout saabdull/multi-repo
bun install
```

1. Launch the opencode TUI inside a git repository. This repository is the primary root.
2. Type `/add-repo`, or choose "Add repository root" from the command palette. A folder picker opens in the folder that contains your current repo:
   * Git repositories next to your repo appear first under "Git repositories here". Select one to add it.
   * You can also browse folders, use `..` to go up, or pick "Type a path…" and enter a path (`~` works).
3. A toast confirms the repo was added. The sidebar shows **Repositories (2)**, and the `⎇` indicator appears next to the prompt.
4. Ask the agent to work across repos, for example: "Read `main.py` in repo-a and write a matching client in repo-b." It reads and edits both repos with no permission prompt, and the sidebar lists the touched files under each repo.
5. Type `@` in the prompt to mention a file. Results come from every repo and are prefixed with the repo alias.
6. Type `/remove-repo` to remove an extra root. The primary repository can't be removed.

### Testing

Test files:

* `packages/core/test/project-roots.test.ts` (new)
* `packages/opencode/test/server/httpapi-multi-repo.test.ts` (new)

Run:

```bash
cd packages/core && bun test test/project-roots.test.ts
cd packages/opencode && bun test test/server/httpapi-multi-repo.test.ts
```

What is covered and why it is sufficient:

* `project-roots.test.ts`: unit tests for the path helpers everything else builds on.
  * `list()`: the primary root comes first, aliases come from folder names and get suffixes on collisions, and duplicates are dropped.
  * `display()`: a single root keeps the old worktree-relative path, identical file names in two repos get distinct prefixes, a nested root wins over its parent, and paths outside every root fall back safely.
  * `resolve()`: alias prefixes route into the right root, other relative paths and absolute paths behave as before, and `resolve`/`display` round-trip.
  * `find()`: returns the root that owns a file.

  Together these prove paths are named and resolved correctly in every repo.
* `httpapi-multi-repo.test.ts`: integration tests through the real HTTP API.
  * One test adds a second repo, then reads from repo 1 and writes to repo 2 in the same session. This proves the agent's tools and permissions work end to end across roots.
  * A regression guard checks that single-repo sessions keep plain worktree-relative paths.

All green (16 tests total) on the branch after merging the latest `main`. The database migration test in `packages/core` also passes with this branch's migration and `main`'s session-folder migration together.

## Search Archived Sessions

Contributer: Simon Malinka [smalinka] \
Issue Number: #1 \
Pull Request Number: #18 \
Branch Name: smalinka/search-archive \

### Description

Archived sessions were excluded from session search entirely, so finding past work meant scrolling through the archive list by hand. The session search bar now has an "Include archived" toggle. With the toggle off, search behaves exactly as before and only returns active sessions. With it on, the backend also returns archived sessions whose titles match the query. These show up in the dropdown with an "Archived" badge and open directly in the workspace when clicked.

### How to use

```bash
git checkout smalinka/search-archive
bun install
```

```bash
# Start the backend server
bun run --cwd packages/opencode --conditions=browser src/index.ts serve --port 4096

# In a separate terminal, start the frontend dev server
bun --cwd packages/app dev
```

1. Open http://localhost:3001/ in your browser.
2. Click the "Search sessions" input on the home page.
3. Type a query. Only active sessions are shown by default.
4. Click the "Include archived" toggle on the right side of the search bar.
5. Matching archived sessions appear in the dropdown with an "Archived" badge.
6. Click an archived result to open the session in your workspace.

### Testing

Test files:

* `packages/opencode/test/server/session-list.test.ts`
* `packages/opencode/test/server/httpapi-session.test.ts`
* `scripts/verify-search-matrix.ts`

Run:

```bash
cd packages/opencode && bun test test/server/session-list.test.ts test/server/httpapi-session.test.ts
cd packages/app && bun typecheck
bun run scripts/verify-search-matrix.ts   # from the repository root
```

What is covered and why it is sufficient:

* `session-list.test.ts` and `httpapi-session.test.ts`: backend and HTTP API route tests.
  * Searches without the flag only return sessions where `time_archived IS NULL`. This is the regression guard for the default active-only search.
  * Passing `archived: true` lifts that filter and returns archived sessions matching the title query.
  * Active sessions still appear alongside archived ones when the flag is set.
* `verify-search-matrix.ts`: runs 7 query scenarios (active-only matches, archived-only matches, keywords shared by both, case-insensitive matches, and terms that match nothing) and checks the exact result set for each, with and without the flag. This shows there are no false positives or false negatives across those cases.
* `bun typecheck` passes in `packages/app`.

All green. Manually verified in the browser: the toggle updates results as it is switched, archived results show the "Archived" badge, and clicking one opens the session timeline.

## Session Archive and Unarchive
Contributor: Mohammed Al-Marri [mrmarri1]\
Issue Number: #11\
Pull Request Number: #16\
Branch Name: mrmarri/implement-unarchive


### Description
Adds /archive and /unarchive to the terminal. Users can archive their current session and restore archived sessions from a list. Restoring updates the session’s timestamp and moves it to the top of /sessions.

### How to use
Run from the repository root:\
`git checkout mrmarri/implement-unarchive`\
`bun install`\
`bun run dev`
1. Open a conversation and enter /archive to archive it.
2. Enter /unarchive to open the archived sessions list.
3. Click a session, or select it using the arrow keys and press Enter, to restore it.
4. Enter /sessions to find the restored session at the top.

Inside the session picker, Ctrl+Shift+H switches between active and archived sessions. Ctrl+Shift+U restores the selected archived session. Esc closes the list.


### Testing

Test files:
- packages/tui/test/component/dialog-session-list.test.ts:  9 tests covering session filtering and picker actions.
- packages/tui/test/session-archive.test.tsx: 12  interaction tests using the actual terminal renderer with simulated server responses.
Run from the repository root:
cd packages/tui\
bun test --timeout 30000 test/component/dialog-session-list.test.ts test/session-archive.test.tsx\
bun typecheck\
Results should be 21 tests passed, 0 failed. Type checking passed.

The tests cover:
- Typing /archive, /unarchive, and /sessions.
- Restoring through Enter, mouse clicks, and the keyboard shortcut.
- Switching lists when the archived list is empty.
- Restored sessions appearing above older active sessions.
- Keeping another open conversation unchanged during restoration.
- Failed requests, retrying, and preventing duplicate restore requests.
- Preventing archived sessions from opening through a stale active list.

For a manual check, archive a conversation, make sure it disappears from /sessions, restore it through /unarchive, and make sure it returns at the top. The automated tests cover the main terminal interactions and error cases. This manual checkalso verifies the flow against the running backend.