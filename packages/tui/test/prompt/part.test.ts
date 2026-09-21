import { describe, expect, test } from "bun:test"
import { expandTrackedPastedText, stripPromptPartIDs, expandPastedTextPlaceholders } from "../../src/prompt/part"

describe("prompt part", () => {
  test("strips persisted IDs from reused parts", () => {
    expect(
      stripPromptPartIDs({
        id: "prt_old",
        sessionID: "ses_old",
        messageID: "msg_old",
        type: "file" as const,
        mime: "image/png",
        filename: "tiny.png",
        url: "data:image/png;base64,abc",
      }),
    ).toEqual({
      type: "file",
      mime: "image/png",
      filename: "tiny.png",
      url: "data:image/png;base64,abc",
    })
  })

  test("preserves wide characters around pasted text", () => {
    const marker = "[Pasted ~3 lines]"
    const prefix = "你好你好\n"

    expect(
      expandTrackedPastedText(prefix + marker + "\n阿斯顿法国红酒看来", [
        {
          start: Bun.stringWidth("你好你好") + 1,
          end: Bun.stringWidth("你好你好") + 1 + Bun.stringWidth(marker),
          text: "public:\n\tvoid ExecuteTask();\nprivate:",
        },
      ]),
    ).toBe("你好你好\npublic:\n\tvoid ExecuteTask();\nprivate:\n阿斯顿法国红酒看来")
  })

  test("only expands the tracked placeholder occurrence", () => {
    const marker = "[Pasted ~3 lines]"
    const prefix = `keep ${marker} then `

    expect(
      expandTrackedPastedText(prefix + marker + " tail", [
        {
          start: Bun.stringWidth(prefix),
          end: Bun.stringWidth(prefix + marker),
          text: "alpha\nbeta\ngamma",
        },
      ]),
    ).toBe(`keep ${marker} then alpha\nbeta\ngamma tail`)
  })

  test("expands pasted text at the tracked offset", () => {
    const marker = "[Pasted ~3 lines]"
    const prefix = "prefix "

    expect(
      expandTrackedPastedText(prefix + marker + " tail", [
        {
          start: Bun.stringWidth(prefix),
          end: Bun.stringWidth(prefix + marker),
          text: "alpha\nbeta\ngamma",
        },
      ]),
    ).toBe(`prefix alpha\nbeta\ngamma tail`)
  })

  test("expandPastedTextPlaceholders replaces placeholder with actual text", () => {
    const parts = [
      {
        type: "text" as const,
        text: "actual pasted content\nwith multiple lines",
        source: {
          text: {
            start: 0,
            end: 20,
            value: "[Pasted ~3 lines]",
          },
        },
      },
    ]

    const input = "prefix [Pasted ~3 lines] suffix"
    const result = expandPastedTextPlaceholders(input, parts)
    expect(result).toBe("prefix actual pasted content\nwith multiple lines suffix")
  })
})
