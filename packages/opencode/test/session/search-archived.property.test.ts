import { afterEach, describe, expect } from "bun:test"
import fc from "fast-check"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Session } from "@/session/session"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

// Property-based tests for the "search archived sessions" requirements in traceability/smalinka.md.
// They drive the real Session service (SQLite + projector), the same code the session list route calls when the
// home page searches with "Include archived" on (`archived: true`) or off (`archived: false`).

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Database.node, Session.node, SessionProjector.node]), [
    [RuntimeFlags.node, RuntimeFlags.layer({ experimentalWorkspaces: false })],
  ]),
)

afterEach(async () => {
  await disposeAllInstances()
})

// Title words come from a small vocabulary that overlaps on purpose, so substring matches the interviewees asked
// about show up constantly: "log" is inside "login", "logout" and "catalog" (the R6 acceptance criteria), words
// differ only in case ("Fix" / "FIX"), and some contain SQL LIKE wildcards ("50%", "a_b") or non-ASCII letters,
// which a database LIKE treats differently from plain text.
const word = fc.constantFrom(
  "log",
  "login",
  "logout",
  "catalog",
  "bug",
  "Fix",
  "FIX",
  "page",
  "50%",
  "a_b",
  "axb",
  "ünï",
)
const title = fc.array(word, { minLength: 1, maxLength: 3 }).map((words) => words.join(" "))
const sessions = fc.array(fc.record({ title, archived: fc.boolean() }), { maxLength: 8 })

// Queries are what a user types into the search bar: a few vocabulary words or word fragments ("lo", "og"), in
// any order and letter case, sometimes with a bare wildcard character or extra spaces between words.
const fragment = fc.oneof(
  word,
  word.chain((value) =>
    fc
      .tuple(fc.nat(value.length - 1), fc.integer({ min: 1, max: value.length }))
      .map((range) => value.slice(range[0], Math.max(range[0] + 1, range[1]))),
  ),
  fc.constantFrom("%", "_"),
)
const query = fc
  .tuple(fc.array(fragment, { minLength: 1, maxLength: 3 }), fc.constantFrom(" ", "  "), fc.boolean())
  .map((parts) => {
    const text = parts[0].join(parts[1])
    return parts[2] ? text.toUpperCase() : text
  })

// The model of a match (R7, revised): the title contains every whitespace-separated word of the query as literal
// text, in any order, ignoring the case of ASCII letters.
function matches(text: string, search: string) {
  const fold = (value: string) => value.replace(/[A-Z]/g, (letter) => letter.toLowerCase())
  return search
    .split(/\s+/)
    .filter(Boolean)
    .every((part) => fold(text).includes(fold(part)))
}

// Creates the generated sessions, runs `body`, and removes them again so every run starts from the same state.
// Results are narrowed to the sessions this run created, so nothing left over from another test can leak in.
function withSessions<A, E>(
  input: { title: string; archived: boolean }[],
  body: (ids: Set<string>) => Effect.Effect<A, E, Session.Service>,
) {
  return Effect.gen(function* () {
    const session = yield* Session.Service
    const created = yield* Effect.forEach(input, (item) =>
      session
        .create({ title: item.title })
        .pipe(
          Effect.tap((info) =>
            item.archived ? session.setArchived({ sessionID: info.id, time: Date.now() }) : Effect.void,
          ),
        ),
    )
    return yield* body(new Set(created.map((info) => info.id))).pipe(
      Effect.ensuring(Effect.forEach(created, (info) => session.remove(info.id).pipe(Effect.ignore))),
    )
  })
}

function search(ids: Set<string>, text: string, archived: boolean) {
  return Effect.gen(function* () {
    const session = yield* Session.Service
    const found = yield* session.list({ search: text, archived, roots: true })
    return found.filter((info) => ids.has(info.id))
  })
}

// fast-check needs a Promise-returning property, so each run is executed with the services of the enclosing test.
function check<T>(arbitrary: fc.Arbitrary<T>, property: (value: T) => Effect.Effect<void, unknown, Session.Service>) {
  return Effect.gen(function* () {
    const context = yield* Effect.context<Session.Service>()
    yield* Effect.promise(() =>
      fc.assert(
        fc.asyncProperty(arbitrary, (value) => Effect.runPromiseWith(context)(property(value))),
        { numRuns: 40 },
      ),
    )
  })
}

describe("search archived sessions", () => {
  // R1: With "Include archived" off, search never returns an archived session. With it on, every archived session
  // whose title matches the query is returned, up to the result limit.
  // Kind: invariant
  it.instance(
    "R1: archived sessions appear only when Include archived is on, and all matching ones do",
    () =>
      check(fc.tuple(sessions, query), (input) =>
        withSessions(input[0], (ids) =>
          Effect.gen(function* () {
            const off = yield* search(ids, input[1], false)
            const on = yield* search(ids, input[1], true)
            expect(off.filter((info) => info.time.archived !== undefined)).toEqual([])
            // The badge (R2) is drawn from `time.archived`, so every archived result must carry it.
            expect(on.every((info) => info.time.archived !== undefined)).toBe(true)
            const expected = input[0].filter((item) => item.archived && matches(item.title, input[1])).length
            expect(on.length).toBe(expected)
          }),
        ),
      ),
    60_000,
  )

  // R4 (revised in P4B): Archiving a session and then unarchiving it returns the same sessions with the same labels.
  // The restored session moves to the top as the most recently updated one, and every other session keeps its
  // place relative to the others.
  // Kind: round-trip
  it.instance(
    "R4: archiving then unarchiving a session keeps the same results, with only that session moved to the top",
    () =>
      check(
        fc.tuple(sessions, query, fc.nat()).filter((input) => input[0].some((item) => !item.archived)),
        (input) =>
          withSessions(input[0], (ids) =>
            Effect.gen(function* () {
              const session = yield* Session.Service
              const labelled = (archived: boolean) =>
                search(ids, input[1], archived).pipe(
                  Effect.map((found) =>
                    found.map((info) => ({ id: info.id, archived: info.time.archived !== undefined })),
                  ),
                )
              const active = (yield* search(ids, "", false)).toSorted((a, b) => a.id.localeCompare(b.id))
              const target = active[input[2] % active.length].id
              const before = { off: yield* labelled(false), on: yield* labelled(true) }
              yield* session.setArchived({ sessionID: target, time: Date.now() })
              yield* session.setArchived({ sessionID: target })
              const moved = before.off.filter((item) => item.id === target)
              expect(yield* labelled(false)).toEqual([...moved, ...before.off.filter((item) => item.id !== target)])
              expect(yield* labelled(true)).toEqual(before.on)
            }),
          ),
      ),
    60_000,
  )

  // R6: Extending a query never adds results.
  // Kind: metamorphic
  it.instance(
    "R6: typing more characters only narrows the results",
    () =>
      check(
        fc.tuple(
          sessions,
          query,
          fc.oneof(
            fragment,
            fragment.map((value) => " " + value),
          ),
          fc.boolean(),
        ),
        (input) =>
          withSessions(input[0], (ids) =>
            Effect.gen(function* () {
              const shorter = (yield* search(ids, input[1], input[3])).map((info) => info.id)
              const longer = (yield* search(ids, input[1] + input[2], input[3])).map((info) => info.id)
              expect(longer.filter((id) => !shorter.includes(id))).toEqual([])
            }),
          ),
      ),
    60_000,
  )

  // R7: A query is split into words on whitespace. A session matches when its title contains every word as
  // literal text, in any order, ignoring the case of ASCII letters.
  // Kind: model / oracle (compared against `matches`, a plain string implementation)
  it.instance(
    "R7: search returns exactly the sessions whose title contains every query word",
    () =>
      check(fc.tuple(sessions, query, fc.boolean()), (input) =>
        withSessions(input[0], (ids) =>
          Effect.gen(function* () {
            const found = (yield* search(ids, input[1], input[2])).map((info) => info.title).toSorted()
            const expected = input[0]
              .filter((item) => item.archived === input[2] && matches(item.title, input[1]))
              .map((item) => item.title)
              .toSorted()
            expect(found).toEqual(expected)
          }),
        ),
      ),
    60_000,
  )
})
