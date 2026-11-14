# Traceability: Ravin Kumar (ravink)

**Target feature:** Session folders - `packages/core/src/session/sql.ts`, `packages/opencode/src/session/session.ts`, `packages/tui/src/component/session-folder.ts`

## Requirements

| ID | Interview evidence | Requirement | Acceptance Criteria | Changed in P4B? | Property (kind) | Test |
|---|---|---|---|---|---|---|
| R1 | C-4, C-6, C-7, S-4, S-6, S-7, O-4, O-6 | When a session is added/removed from a folder no other sessions should be changed. | Assigning or clearing one session’s folder leaves every other session’s context (messages and parts) unchanged. | Yes | Invariant: every non-target session's message and part snapshot is unchanged after each generated folder move or clear. | `packages/opencode/test/session/session-folder.property.test.ts` — `R1 [invariant]: folder moves leave other sessions' context unchanged` |
| R2 | C-4, C-5, C-6, S-4, S-6, S-5, O-4, O-6 | When a session is added/removed from a folder, the codebase shouldn’t be changed. | Assigning or clearing a session’s folder leaves every workspace file’s relative path and contents unchanged, ignoring `.opencode` and `.git`. | No | Invariant: the workspace file path and content-hash snapshot is unchanged after each generated folder move or clear. | `packages/opencode/test/session/session-folder.property.test.ts` — `R2 [invariant]: folder moves leave the codebase unchanged` |
| R3 | C-4, C-6, S-4, S-6, O-4, O-6 | When a session is added/removed from a folder, the session’s context shouldn’t be changed. | Assigning or clearing a session’s folder leaves that session’s context (messages and parts) unchanged. | No | Invariant: the target session's message and part snapshot is unchanged after each generated folder move or clear. | `packages/opencode/test/session/session-folder.property.test.ts` — `R3 [invariant]: folder moves leave the session's context unchanged` |
| R4 | C-10 | All created folders should exist after closing Opencode. | After closing and reopening Opencode, every folder containing at least one session before closing is still present in the session picker. | No | Round-Trip | Not tested. |
| R5 | C-10, S-11, O-11 | The organisation of sessions in folders shouldn’t change after closing and reopening Opencode. | After closing and reopening Opencode against the same database, every session has the same folder assignment, including sessions with no folder. | No | Round-trip: close the database layer, reopen the same database file, and compare the session-to-folder map. | `packages/opencode/test/session/session-folder.property.test.ts` — `R5 [round-trip]: close and reopen preserves folder organization` |

Properties written or suggested by opencode or another AI tool: R1, R2, R3, R5 (fast-check property tests)

## Requirement changes

| ID | Original requirement (P4A) | Revised requirement | Why it changed |
|---|---|---|---|
| R1 | When a session is added/removed from a folder no other sessions should be changed. | When a session is added/removed from a folder no other sessions' context should be changed. | The wording was unclear as to what about the session shouldn't change. |
