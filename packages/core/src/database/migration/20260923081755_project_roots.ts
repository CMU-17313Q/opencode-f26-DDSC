import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260923081755_project_roots",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`ALTER TABLE \`project\` ADD \`roots\` text;`)
    })
  },
} satisfies DatabaseMigration.Migration
