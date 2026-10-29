import { appendFile } from "node:fs/promises"

const group = process.argv[2]
if (!["opencode", "core", "tui", "app"].includes(group)) throw new Error("Expected a mutation package name")
const report = Bun.file(`reports/mutation/${group}/mutation.json`)
const lines = [`## Mutation testing: ${group}`, ""]
if (!(await report.exists())) {
  lines.push("No report was produced. Check the mutation step for setup or baseline test failures.")
} else {
  const data = (await report.json()) as { files: Record<string, { mutants: { status: string }[] }> }
  const mutants = Object.values(data.files).flatMap((file) => file.mutants)
  const count = (status: string) => mutants.filter((mutant) => mutant.status === status).length
  const detected = count("Killed") + count("Timeout")
  const valid = detected + count("Survived") + count("NoCoverage")
  lines.push(
    `Mutation score: **${valid ? ((detected / valid) * 100).toFixed(2) + "%" : "N/A"}**`,
    "",
    "| Killed | Timeout | Survived | No coverage | Runtime errors | Compile errors |",
    "| --- | --- | --- | --- | --- | --- |",
    `| ${count("Killed")} | ${count("Timeout")} | ${count("Survived")} | ${count("NoCoverage")} | ${count("RuntimeError")} | ${count("CompileError")} |`,
    "",
    "Score is informational (break threshold: 0). Download the job artifact and open index.html for details.",
    "The command runner does not distinguish uncovered mutants from survivors. Timeouts count as detected mutations.",
  )
}
const summary = lines.join("\n") + "\n"
console.log(summary)
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary)
