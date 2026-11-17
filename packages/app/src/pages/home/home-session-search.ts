// Every whitespace-separated word of the query must appear in the session title or project name, in any order and
// ignoring case. The server applies the same rule to archived session titles.
export function matchesSessionSearch(record: { session: { title: string }; projectName: string }, query: string) {
  const text = `${record.session.title} ${record.projectName}`.toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => text.includes(word))
}

// Active matches come first, then archived ones. A session is identified by its ID, so it appears once even when
// several projects return it, or when it is both in the local list and in the archived results.
export function mergeSessionSearchResults<T extends { session: { id: string } }>(local: T[], archived: T[]) {
  const seen = new Set<string>()
  return [...local, ...archived].filter((record) => {
    if (seen.has(record.session.id)) return false
    seen.add(record.session.id)
    return true
  })
}
