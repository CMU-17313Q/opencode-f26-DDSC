import { createStore } from "solid-js/store"
import type { ProviderAuthMethod, Todo } from "@opencode-ai/sdk/v2/client"

const [data, setData] = createStore({
  provider: {
    all: new Map(),
    connected: [] as string[],
    default: {} as Record<string, string>,
  },
  provider_auth: {} as Record<string, ProviderAuthMethod[]>,
  config: { disabled_providers: [] as string[] },
  todo: {} as Record<string, Todo[]>,
})

export function mockProviderAuth(provider: string, methods: ProviderAuthMethod[]) {
  const previous = data.provider_auth[provider]
  setData("provider_auth", provider, methods)
  return () => {
    if (previous) {
      setData("provider_auth", provider, previous)
      return
    }
    setData("provider_auth", (current) => {
      const next = { ...current }
      delete next[provider]
      return next
    })
  }
}

export function useServerSync() {
  return () => ({
    session: { data },
    set(key: "provider_auth", value: typeof data.provider_auth) {
      setData(key, value)
    },
    updateConfig: async () => {},
    setTodo(sessionID: string, todos: Todo[]) {
      setData("todo", sessionID, todos)
    },
  })
}
