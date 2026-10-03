import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260926090412_add_session_folder",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`session\` ADD \`folder\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
