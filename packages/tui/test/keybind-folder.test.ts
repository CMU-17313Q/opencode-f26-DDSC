import { describe, expect, test } from "bun:test"
import { TuiKeybind } from "../src/config/keybind"

describe("session folder keybind", () => {
  test("maps the folder move command", () => {
    expect(TuiKeybind.CommandMap.session_folder_move).toBe("session.folder.move")
  })

  test("binds folder move to ctrl+o by default", () => {
    expect(TuiKeybind.Definitions.session_folder_move.default).toBe("ctrl+o")
  })

  test("allows overriding the folder move binding", () => {
    expect(TuiKeybind.parse({ session_folder_move: "none" }).session_folder_move).toBe("none")
  })
})
