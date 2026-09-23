import * as InstanceState from "@/effect/instance-state"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { LocationServiceMap, locationServiceMapLayer } from "@opencode-ai/core/location-services"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ProjectRoots } from "@opencode-ai/core/project/roots"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath, RelativePath } from "@opencode-ai/core/schema"
import { Effect, Layer, Option } from "effect"
import ignore from "ignore"
import path from "path"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"

export const fileHandlers = HttpApiBuilder.group(InstanceHttpApi, "file", (handlers) =>
  Effect.gen(function* () {
    const ripgrep = yield* Ripgrep.Service
    const locations = yield* LocationServiceMap.Service

    const filesystem = Effect.fnUntraced(function* <A, E, R>(effect: Effect.Effect<A, E, R>, directory?: string) {
      return yield* effect.pipe(
        Effect.provide(
          locations.get(
            Location.Ref.make({ directory: AbsolutePath.make(directory ?? (yield* InstanceState.context).directory) }),
          ),
        ),
      )
    })

    // Extra project roots are exposed under their alias (`repo-b/src/x.ts`); primary paths stay unprefixed.
    const extraRoots = Effect.map(InstanceState.context, (ctx) =>
      ProjectRoots.list(ctx.worktree, ctx.project.roots).filter((root) => !root.primary),
    )

    const route = Effect.fnUntraced(function* (input: string) {
      const directory = (yield* InstanceState.context).directory
      const [head, ...rest] = input.split(/[\\/]/)
      const root = (yield* extraRoots).find((item) => item.alias === head)
      if (!root) return { directory, path: input, root: undefined }
      return { directory: root.directory, path: rest.join("/"), root }
    })

    const findText = Effect.fn("FileHttpApi.findText")(function* (ctx: { query: { pattern: string } }) {
      return (yield* ripgrep
        .grep({ cwd: (yield* InstanceState.context).directory, pattern: ctx.query.pattern, limit: 10 })
        .pipe(Effect.orDie)).map((match) => ({
        path: { text: match.entry.path },
        lines: { text: match.text },
        line_number: match.line,
        absolute_offset: match.offset,
        submatches: match.submatches.map((submatch) => ({
          match: { text: submatch.text },
          start: submatch.start,
          end: submatch.end,
        })),
      }))
    })

    const findFile = Effect.fn("FileHttpApi.findFile")(function* (ctx: {
      query: { query: string; dirs?: "true" | "false"; type?: "file" | "directory"; limit?: number }
    }) {
      const directory = (yield* InstanceState.context).directory
      const limit = ctx.query.limit ?? 10
      const type = ctx.query.type ?? (ctx.query.dirs === "false" ? "file" : undefined)
      const started = performance.now()
      const found = yield* filesystem(FileSystem.Service.use((fs) => fs.find({ query: ctx.query.query, limit, type })))
      const others = yield* Effect.forEach(
        yield* extraRoots,
        (root) =>
          filesystem(
            FileSystem.Service.use((fs) => fs.find({ query: ctx.query.query, limit, type })),
            root.directory,
          ).pipe(Effect.map((items) => items.map((item) => path.posix.join(root.alias, item.path)))),
        { concurrency: "unbounded" },
      )
      yield* Effect.logInfo("find file", {
        query: ctx.query.query,
        type,
        directory,
        limit,
        results: found.length,
        duration: Math.round(performance.now() - started),
      })
      // Interleave roots by rank so one large repo cannot crowd the others out of the limit.
      return [found.map((item) => item.path), ...others]
        .flatMap((items) => items.map((item, rank) => ({ item, rank })))
        .toSorted((a, b) => a.rank - b.rank)
        .map((entry) => entry.item)
        .slice(0, others.length === 0 ? undefined : limit)
    })

    const findSymbol = Effect.fn("FileHttpApi.findSymbol")(function* () {
      return []
    })

    const list = Effect.fn("FileHttpApi.list")(function* (ctx: { query: { path: string } }) {
      const target = yield* route(ctx.query.path)
      const top = !target.root && ["", "."].includes(ctx.query.path)
      const roots = top
        ? (yield* extraRoots).map((root) => ({
            name: root.alias,
            path: root.alias,
            absolute: root.directory,
            type: "directory" as const,
            ignored: false,
          }))
        : []
      const entries = yield* filesystem(
        Effect.gen(function* () {
          const fs = yield* FileSystem.Service
          const raw = yield* FSUtil.Service
          const location = yield* Location.Service
          const ignored = ignore()
          const gitignore = yield* raw
            .readFileString(path.join(location.project.directory, ".gitignore"))
            .pipe(Effect.catch(() => Effect.succeed("")))
          if (gitignore) ignored.add(gitignore)
          const ignorefile = yield* raw
            .readFileString(path.join(location.project.directory, ".ignore"))
            .pipe(Effect.catch(() => Effect.succeed("")))
          if (ignorefile) ignored.add(ignorefile)
          return (yield* fs.list({ path: RelativePath.make(target.path) })).map((item) => ({
            name: path.basename(item.path),
            path: target.root ? path.posix.join(target.root.alias, item.path) : item.path,
            absolute: path.resolve(location.directory, item.path),
            type: item.type,
            ignored: ignored.ignores(
              path.relative(location.project.directory, path.resolve(location.directory, item.path)) +
                (item.type === "directory" ? "/" : ""),
            ),
          }))
        }),
        target.directory,
      )
      return [...roots, ...entries]
    })

    const content = Effect.fn("FileHttpApi.content")(function* (ctx: { query: { path: string } }) {
      const target = yield* route(ctx.query.path)
      const file = path.resolve(target.directory, target.path)
      if (!FSUtil.contains(target.directory, file)) return yield* Effect.die(new Error("Path escapes the location"))
      if (!(yield* FSUtil.Service.use((fs) => fs.existsSafe(file)))) return { type: "text" as const, content: "" }
      return yield* filesystem(
        FileSystem.Service.use((fs) => fs.read({ path: RelativePath.make(target.path) })),
        target.directory,
      ).pipe(
        Effect.flatMap((item) =>
          Effect.gen(function* () {
            const text = item.content.includes(0)
              ? Option.none<string>()
              : yield* Effect.sync(() => new TextDecoder("utf-8", { fatal: true }).decode(item.content)).pipe(
                  Effect.option,
                )
            return { item, text }
          }),
        ),
        Effect.map(({ item, text }) =>
          Option.isSome(text)
            ? { type: "text" as const, content: text.value.trim() }
            : {
                type: "binary" as const,
                content: Buffer.from(item.content).toString("base64"),
                encoding: "base64" as const,
                mimeType: item.mime,
              },
        ),
      )
    })

    const status = Effect.fn("FileHttpApi.status")(function* () {
      return []
    })

    return handlers
      .handle("findText", findText)
      .handle("findFile", findFile)
      .handle("findSymbol", findSymbol)
      .handle("list", list)
      .handle("content", content)
      .handle("status", status)
  }),
).pipe(Layer.provide(locationServiceMapLayer))
