import { Schema } from "effect"
import type {
  CassetteMetadata,
  HttpInteraction,
  RequestSnapshot,
  ResponseSnapshot,
  WebSocketEvent,
  WebSocketInteraction,
} from "./types.js"

export type { CassetteMetadata, WebSocketEvent } from "./types.js"

const RequestSnapshotSchema = Schema.Struct({
  method: Schema.String,
  url: Schema.String,
  headers: Schema.Record(Schema.String, Schema.String),
  body: Schema.String,
})

const ResponseSnapshotSchema = Schema.Struct({
  status: Schema.Number,
  headers: Schema.Record(Schema.String, Schema.String),
  body: Schema.String,
  bodyEncoding: Schema.optional(Schema.Literals(["text", "base64"])),
})

const CassetteMetadataSchema = Schema.Record(Schema.String, Schema.Unknown)

const HttpInteractionSchema = Schema.Struct({
  transport: Schema.tag("http"),
  request: RequestSnapshotSchema,
  response: ResponseSnapshotSchema,
})

const WebSocketEventSchema = Schema.Union([
  Schema.Struct({
    direction: Schema.Literals(["client", "server"]),
    kind: Schema.tag("text"),
    body: Schema.String,
  }),
  Schema.Struct({
    direction: Schema.Literals(["client", "server"]),
    kind: Schema.tag("binary"),
    body: Schema.String,
    bodyEncoding: Schema.Literal("base64"),
  }),
])

const WebSocketInteractionSchema = Schema.Struct({
  transport: Schema.tag("websocket"),
  open: Schema.Struct({
    url: Schema.String,
    headers: Schema.Record(Schema.String, Schema.String),
  }),
  events: Schema.Array(WebSocketEventSchema),
})

const InteractionSchema = Schema.Union([HttpInteractionSchema, WebSocketInteractionSchema]).pipe(
  Schema.toTaggedUnion("transport"),
)
export type Interaction = Schema.Schema.Type<typeof InteractionSchema>

const isHttpInteraction = InteractionSchema.guards.http

const isWebSocketInteraction = InteractionSchema.guards.websocket

export const httpInteractions = (interactions: ReadonlyArray<Interaction>) => interactions.filter(isHttpInteraction)

export const webSocketInteractions = (interactions: ReadonlyArray<Interaction>) =>
  interactions.filter(isWebSocketInteraction)

export const CassetteSchema = Schema.Struct({
  version: Schema.Literal(1),
  metadata: Schema.optional(CassetteMetadataSchema),
  interactions: Schema.Array(InteractionSchema),
})
export type Cassette = Schema.Schema.Type<typeof CassetteSchema>

const decodeCassette = Schema.decodeUnknownSync(CassetteSchema)
export const encodeCassette = Schema.encodeSync(CassetteSchema)
