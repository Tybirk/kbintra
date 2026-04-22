import type { SuggestionOptions } from "@tiptap/suggestion"

import { ReactRenderer } from "@tiptap/react"

import type { MentionUser } from "../types"

import { usersApi } from "../api/users"

import MentionList, {
  type MentionCommandItem,
  type MentionListRef,
} from "./MentionList"

export const mentionSuggestion: Partial<SuggestionOptions<MentionUser>> = {
  char: "@",

  items: async ({ query }: { query: string }): Promise<MentionUser[]> => {
    try {
      return await usersApi.mentionSearch(query)
    } catch {
      return []
    }
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
        component = new ReactRenderer(MentionList, {
          editor: props.editor,

          props: {
            items: props.items as MentionUser[],

            command: (item: MentionCommandItem) => props.command(item),
          },
        })

        component.element.style.position = "absolute"

        component.element.style.zIndex = "9999"

        document.body.appendChild(component.element)

        setPosition(props.clientRect ?? null)
      },

      onUpdate(props) {
        component?.updateProps({
          items: props.items as MentionUser[],

          command: (item: MentionCommandItem) => props.command(item),
        })

        setPosition(props.clientRect ?? null)
      },

      onKeyDown(props) {
        // Return false for Escape so the plugin can call onExit itself

        if (props.event.key === "Escape") {
          return false
        }

        const ref = component?.ref as MentionListRef | null

        return ref?.onKeyDown(props.event) ?? false
      },

      onExit() {
        component?.destroy()

        component = null
      },
    }
  },
}
