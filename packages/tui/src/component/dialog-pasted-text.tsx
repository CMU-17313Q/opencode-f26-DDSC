import { TextAttributes } from "@opentui/core"
import { useDialog } from "../ui/dialog"
import { useTheme } from "../context/theme"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, onMount } from "solid-js"
import { useBindings } from "../keymap"

export interface DialogPastedTextProps {
  content: string
  onClose: () => void
}

export function DialogPastedText(props: DialogPastedTextProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  onMount(() => dialog.setSize("full"))

  const contentWidth = createMemo(() => Math.max(1, dimensions().width - 8))

  // Word wrap turns long logical lines into multiple visual rows. Estimate the
  // wrapped row count so the dialog fits wrapped text instead of clipping it;
  // the scrollbox absorbs any packing slack the estimate misses.
  const visualLines = createMemo(() => {
    const width = contentWidth()
    return props.content
      .split("\n")
      .reduce((total, line) => total + Math.max(1, Math.ceil(Bun.stringWidth(line) / width)), 0)
  })

  // The content box fits short content (header + padding account for 4 rows)
  // and caps at the panel height, with the scrollbox absorbing any overflow.
  // It stays centered inside the full-height panel via the root container.
  const dialogHeight = createMemo(() => Math.min(visualLines() + 4, dimensions().height - 5))

  useBindings(() => ({
    bindings: [
      {
        key: "escape",
        desc: "Close dialog",
        group: "Dialog",
        cmd: () => {
          props.onClose()
          dialog.clear()
        },
      },
    ],
  }))

  return (
    <box width="100%" height="100%" justifyContent="center" backgroundColor={theme.backgroundPanel}>
      <box
        width="100%"
        height={dialogHeight()}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        backgroundColor={theme.backgroundPanel}
      >
        <box flexDirection="row" justifyContent="space-between" paddingBottom={1}>
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            Pasted Text
          </text>
          <box
            onMouseUp={() => {
              props.onClose()
              dialog.clear()
            }}
            paddingLeft={1}
            paddingRight={1}
          >
            <text fg={theme.textMuted}>×</text>
          </box>
        </box>
        <scrollbox
          flexGrow={1}
          verticalScrollbarOptions={{ visible: true }}
          horizontalScrollbarOptions={{ visible: false }}
          backgroundColor={theme.backgroundPanel}
        >
          <text fg={theme.text} wrapMode="word">
            {props.content}
          </text>
        </scrollbox>
      </box>
    </box>
  )
}