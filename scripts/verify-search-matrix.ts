import { createOpencodeClient } from "../packages/sdk/js/src/v2/index"

interface TestCase {
  name: string
  query: string
  includeArchived: boolean
  expectedTitles: string[]
  unexpectedTitles: string[]
}

async function run() {
  const client = createOpencodeClient({ baseUrl: "http://127.0.0.1:4096" })

  console.log("=== Setting up test sessions ===")
  const s1 = await client.session.create({ title: "Alpha Active Core" })
  const s2 = await client.session.create({ title: "Alpha Archived Legacy" })
  const s3 = await client.session.create({ title: "Beta Archived Secret" })
  const s4 = await client.session.create({ title: "Gamma Active Pipeline" })

  // Archive s2 and s3
  await client.session.update({
    sessionID: s2.data!.id,
    time: { archived: Date.now() - 5000 },
  })
  await client.session.update({
    sessionID: s3.data!.id,
    time: { archived: Date.now() },
  })

  console.log("Created:")
  console.log(`- Active: ${s1.data!.title} (${s1.data!.id})`)
  console.log(`- Archived: ${s2.data!.title} (${s2.data!.id})`)
  console.log(`- Archived: ${s3.data!.title} (${s3.data!.id})`)
  console.log(`- Active: ${s4.data!.title} (${s4.data!.id})\n`)

  const testMatrix: TestCase[] = [
    {
      name: "Search 'Alpha' with archived=false (Default)",
      query: "Alpha",
      includeArchived: false,
      expectedTitles: ["Alpha Active Core"],
      unexpectedTitles: ["Alpha Archived Legacy"],
    },
    {
      name: "Search 'Alpha' with archived=true (Include Archived)",
      query: "Alpha",
      includeArchived: true,
      expectedTitles: ["Alpha Active Core", "Alpha Archived Legacy"],
      unexpectedTitles: [],
    },
    {
      name: "Search 'Secret' with archived=false (Hidden by default)",
      query: "Secret",
      includeArchived: false,
      expectedTitles: [],
      unexpectedTitles: ["Beta Archived Secret"],
    },
    {
      name: "Search 'Secret' with archived=true (Discovered)",
      query: "Secret",
      includeArchived: true,
      expectedTitles: ["Beta Archived Secret"],
      unexpectedTitles: [],
    },
    {
      name: "Search 'Pipeline' with archived=true (Active still works when flag enabled)",
      query: "Pipeline",
      includeArchived: true,
      expectedTitles: ["Gamma Active Pipeline"],
      unexpectedTitles: [],
    },
    {
      name: "Search 'NonExistent' with archived=true (No false positives)",
      query: "NonExistentXYZ",
      includeArchived: true,
      expectedTitles: [],
      unexpectedTitles: ["Alpha Active Core", "Beta Archived Secret"],
    },
    {
      name: "Case-insensitive 'secret' with archived=true",
      query: "secret",
      includeArchived: true,
      expectedTitles: ["Beta Archived Secret"],
      unexpectedTitles: [],
    },
  ]

  let passedAll = true
  const results = []

  for (const tc of testMatrix) {
    const res = await client.session.list({
      search: tc.query,
      archived: tc.includeArchived || undefined,
      roots: true,
    })

    const foundTitles = (res.data ?? []).map((s) => s.title)
    const hasExpected = tc.expectedTitles.every((t) => foundTitles.includes(t))
    const avoidsUnexpected = tc.unexpectedTitles.every((t) => !foundTitles.includes(t))
    const countMatches =
      tc.expectedTitles.length === 0 ? foundTitles.length === 0 : hasExpected && avoidsUnexpected

    const passed = hasExpected && avoidsUnexpected && (tc.expectedTitles.length === 0 ? countMatches : true)

    if (!passed) passedAll = false

    results.push({
      name: tc.name,
      query: tc.query,
      includeArchived: tc.includeArchived,
      foundCount: foundTitles.length,
      foundTitles: foundTitles.join(", ") || "[None]",
      passed,
    })
  }

  console.log("=== RESULTS MATRIX ===")
  for (const r of results) {
    const status = r.passed ? "✅ PASS" : "❌ FAIL"
    console.log(`${status} | ${r.name}`)
    console.log(`       Query: "${r.query}" | includeArchived: ${r.includeArchived}`)
    console.log(`       Found (${r.foundCount}): ${r.foundTitles}`)
  }

  // Cleanup test sessions
  console.log("\n=== Cleaning up test sessions ===")
  for (const s of [s1, s2, s3, s4]) {
    await client.session.delete({ sessionID: s.data!.id })
  }
  console.log("Cleanup complete.")

  if (!passedAll) {
    process.exit(1)
  }
}

run().catch((e) => {
  console.error("Test matrix error:", e)
  process.exit(1)
})
