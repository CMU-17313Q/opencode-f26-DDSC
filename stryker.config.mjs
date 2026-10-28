const targets = {
  opencode: {
    files: ["src/util/wildcard.ts"],
    tests: "test/util/wildcard.test.ts",
  },
  core: {
    files: ["src/project/roots.ts"],
    tests: "test/project-roots.test.ts",
    flags: "--tsconfig-override ../../script/mutation-core.tsconfig.json",
  },
  tui: {
    files: ["src/component/session-folder.ts", "src/prompt/paste-chip.ts"],
    tests: "test/component/dialog-session-list.test.ts test/prompt/paste-chip.test.ts",
  },
  app: {
    files: [
      "src/pages/home-session-archive.ts",
      "src/context/global-sync/session-trim.ts",
      "src/context/global-sync/home-session-index.ts",
    ],
    tests:
      "src/pages/home-session-archive.test.ts src/context/global-sync/session-trim.test.ts src/context/global-sync/home-session-index.test.ts",
    flags: "--conditions=solid",
  },
}

const group = process.env.MUTATION_PACKAGE ?? "opencode"
if (!Object.hasOwn(targets, group)) throw new Error(`Unknown MUTATION_PACKAGE: ${group}`)
const target = targets[group]

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  ignorePatterns: [
    "**",
    "!package.json",
    "!tsconfig.json",
    "!script/mutation-core.tsconfig.json",
    "!script/mutation-unit.bunfig.toml",
    `!packages/${group}/**/*`,
    "**/node_modules/**",
    "**/dist/**",
    "**/.turbo/**",
    "**/test-results/**",
  ],
  // Bun transpiles without type checking, so no @ts-nocheck rewriting is needed.
  disableTypeChecks: false,
  mutate: target.files.map((file) => `packages/${group}/${file}`),
  testRunner: "command",
  commandRunner: {
    command: `cd packages/${group} && bun test ${target.flags ?? ""} --timeout 30000 ${target.tests}`,
  },
  // Wildcard helpers do not need server integration preloads. Replace only
  // the sandbox bunfig; preserve TUI preloads for the session dialog tests.
  buildCommand:
    group === "opencode"
      ? `cp script/mutation-unit.bunfig.toml packages/${group}/bunfig.toml`
      : undefined,
  coverageAnalysis: "off",
  concurrency: 2,
  timeoutMS: 5000,
  dryRunTimeoutMinutes: 2,
  tempDirName: `.stryker-tmp/${group}`,
  reporters: ["clear-text", "html", "json"],
  clearTextReporter: { reportMutants: false },
  htmlReporter: { fileName: `reports/mutation/${group}/index.html` },
  jsonReporter: { fileName: `reports/mutation/${group}/mutation.json` },
  thresholds: { high: 80, low: 60, break: 0 },
  // The command runner cannot reliably track which tests changed. Run fresh
  // mutations rather than reuse potentially stale incremental results.
  incremental: false,
}
