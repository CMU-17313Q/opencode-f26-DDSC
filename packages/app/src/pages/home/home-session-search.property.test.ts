import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import { matchesSessionSearch, mergeSessionSearchResults } from "./home-session-search"

// Property-based tests for the client half of "search archived sessions" (traceability/smalinka.md): how the home
// page filters the active sessions it already has and merges them with the archived results from the server.

// Titles and project names share an overlapping vocabulary ("log" is inside "login", "logout" and "catalog"), mixed
// letter case, and non-ASCII letters, so substring and case handling are exercised on almost every run.
const word = fc.constantFrom("log", "login", "logout", "catalog", "bug", "Fix", "FIX", "page", "api", "ünï", "ÜNÏ")
const text = fc.array(word, { minLength: 1, maxLength: 3 }).map((words) => words.join(" "))
const record = fc.record({ session: fc.record({ title: text }), projectName: word })
// A query is one to three words or fragments of words, as a user types them.
const fragment = fc.oneof(
  word,
  word.chain((value) => fc.nat(value.length - 1).map((start) => value.slice(start, start + 2))),
)
const words = fc.array(fragment, { minLength: 1, maxLength: 3 })

// Sessions come from a small pool of IDs, so the same session often shows up more than once: in both the local
// list and the archived results (a just-archived session still in the local cache), or returned by two projects
// whose searches overlap.
const id = fc.constantFrom("ses_a", "ses_b", "ses_c", "ses_d", "ses_e")
const listed = fc.array(fc.record({ session: fc.record({ id }), source: fc.constantFrom("project-1", "project-2") }), {
  maxLength: 8,
})

describe("home session search", () => {
  // R3: Each session appears at most once in a single result list.
  // Kind: invariant
  test("R3: merged results list every session exactly once", () => {
    fc.assert(
      fc.property(listed, listed, (local, archived) => {
        const merged = mergeSessionSearchResults(local, archived).map((item) => item.session.id)
        expect(new Set(merged).size).toBe(merged.length)
        // Nothing is dropped: every session from either list is still there, and active matches come first.
        expect(merged.toSorted()).toEqual(
          [...new Set([...local, ...archived].map((item) => item.session.id))].toSorted(),
        )
        expect(merged.slice(0, new Set(local.map((item) => item.session.id)).size)).toEqual([
          ...new Set(local.map((item) => item.session.id)),
        ])
      }),
    )
  })

  // R6: Extending a query never adds results.
  // Kind: metamorphic
  test("R6: typing more characters only narrows the active results", () => {
    fc.assert(
      fc.property(
        record,
        words,
        fc.oneof(
          fragment,
          fragment.map((value) => " " + value),
        ),
        (item, query, extra) => {
          const shorter = query.join(" ")
          if (matchesSessionSearch(item, shorter + extra)) expect(matchesSessionSearch(item, shorter)).toBe(true)
        },
      ),
    )
  })

  // R7: A query is split into words on whitespace. A session matches when it contains every word, in any order,
  // ignoring case.
  // Kind: invariant
  test("R7: any of a session's own words, in any order and case, find it", () => {
    // The query is built from the session's own title words, shuffled, so it must match. Random queries almost never
    // match a multi-word title, which would let a word-order bug slip through.
    const ownWords = record.chain((item) =>
      fc.tuple(
        fc.constant(item),
        fc.shuffledSubarray(item.session.title.split(" "), { minLength: 1 }),
        fc.constantFrom(" ", "  "),
        fc.boolean(),
      ),
    )
    fc.assert(
      fc.property(ownWords, (input) => {
        const query = input[1].join(input[2])
        expect(matchesSessionSearch(input[0], input[3] ? query.toUpperCase() : query)).toBe(true)
      }),
    )
  })

  // R7: A query is split into words on whitespace. A session matches when it contains every word, in any order,
  // ignoring case.
  // Kind: metamorphic (reversing the words of any query does not change whether a session matches)
  test("R7: reversing the query words does not change which sessions match", () => {
    fc.assert(
      fc.property(record, words, (item, query) => {
        expect(matchesSessionSearch(item, query.toReversed().join(" "))).toBe(
          matchesSessionSearch(item, query.join(" ")),
        )
      }),
    )
  })
})
