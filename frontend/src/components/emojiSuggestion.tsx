import type { SuggestionOptions } from "@tiptap/suggestion"
import { ReactRenderer } from "@tiptap/react"
import { filterEmojis, type EmojiItem } from "./emojiData"
import EmojiList, { type EmojiListRef } from "./EmojiList"

export const emojiSuggestion: Partial<SuggestionOptions<EmojiItem>> = {
  char: ":",
  allowSpaces: false,

  items: async ({ query }: { query: string }): Promise<EmojiItem[]> =>
    filterEmojis(query),

  command: ({ editor, range, props }) => {
    editor.chain().focus().deleteRange(range).insertContent(props.native).run()
  },

  render: () => {
    let component: ReactRenderer | null = null

    const setPosition = (clientRect: (() => DOMRect | null) | null) => {
      if (!clientRect || !component) return
      const rect = clientRect()
      if (!rect) return
      component.element.style.top = `${rect.bottom + window.scrollY + 4}px`
      component.element.style.left = `${rect.left + window.scrollX}px`
    }

    return {
      onStart(props) {
        component = new ReactRenderer(EmojiList, {
          editor: props.editor,
          props: {
            items: props.items as EmojiItem[],
            command: (item: EmojiItem) => props.command(item),
          },
        })
        component.element.style.position = "absolute"
        component.element.style.zIndex = "9999"
        document.body.appendChild(component.element)
        setPosition(props.clientRect ?? null)
      },

      onUpdate(props) {
        component?.updateProps({
          items: props.items as EmojiItem[],
          command: (item: EmojiItem) => props.command(item),
        })
        setPosition(props.clientRect ?? null)
      },

      onKeyDown(props) {
        if (props.event.key === "Escape") return false
        const ref = component?.ref as EmojiListRef | null
        return ref?.onKeyDown(props.event) ?? false
      },

      onExit() {
        component?.destroy()
        component = null
      },
    }
  },
}
