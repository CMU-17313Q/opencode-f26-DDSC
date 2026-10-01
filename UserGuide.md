
# User Guide

## Session Folders

Contributer: Ravin Kumar [Ravin-Kumar] \\
Issue Number: #2 \\
Pull Request Number: #17 \\
Branch Name: ravink/session-folders \\

### Description

Sessions in the TUI picker are grouped only by recency date which leaves users with no way to organise many sessions (e.g. by topic or workspace). This feature allows users to categorise sessions within a project into user-defined folders. Running the `/sessions` will now show sessions grouped by folder rather than by recency. The folders are sorted alphabetically with pinned sessions appearing at the top and sessions in "No Folder" appearing at the bottom. 

### How to use

```bash
git checkout ravink/session-folders
bun run dev
```

- Start the TUI
- Run the `/sessions` command to view your sessions grouped by folder
- Use the `ctrl+o` keybind when hovering a session to move it to a folder
- The dialogue should have all existing folders with sessions in them and the option to move to "No Folder"
- When typing in the dialogue, the folder list should be filtered and the option to create the typed name will appear
- Selecting any option should update the UI of `/sessions` command with the associated action
- The folder assignments should persist between Opencode restarts (Quit Opencode, start the TUI again and check `/sessions` to make sure assignments persisted)

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

