import { useEffect, useRef, useState, lazy, Suspense } from "react"

import { flushSync } from "react-dom"

import { useEditor } from "@tiptap/react"

import { mergeAttributes, Extension } from "@tiptap/core"

import type { Editor } from "@tiptap/core"

import Suggestion from "@tiptap/suggestion"

import StarterKit from "@tiptap/starter-kit"

import Image from "@tiptap/extension-image"

import Link from "@tiptap/extension-link"

import Mention from "@tiptap/extension-mention"

import Placeholder from "@tiptap/extension-placeholder"

import { RichTextEditor as MantineRTE } from "@mantine/tiptap"

import "@mantine/tiptap/styles.css"

import { Anchor, Group, Text } from "@mantine/core"

import { useMediaQuery } from "@mantine/hooks"

const EmojiPicker = lazy(() => import("./EmojiPicker"))

import { saveDraft, loadDraft, clearDraft } from "../utils/draftStorage"

import { mentionSuggestion } from "./mentionSuggestion"

import { emojiSuggestion } from "./emojiSuggestion"

import { prefetchEmojis } from "./emojiData"

import GiphyPicker, { type GiphyAnchor } from "./GiphyPicker"

interface GiphyState {
  query: string

  anchor: GiphyAnchor

  from: number
}

function detectGiphy(editor: Editor, setter: (s: GiphyState | null) => void) {
  if (!editor.state.selection.empty) {
    setter(null)

    return
  }

  const { from } = editor.state.selection

  // Only trigger when /giphy <query> is the entire document content
  const fullText = editor.state.doc.textContent

  const match = fullText.match(/^\/giphy\s+(.+)/)

  const query = match ? match[1].trim() : ""

  if (query) {
    const coords = editor.view.coordsAtPos(from)

    setter({ query, anchor: coords, from })
  } else {
    setter(null)
  }
}

const EmojiSuggestionExtension = Extension.create({
  name: "emojiSuggestion",

  addProseMirrorPlugins() {
    return [Suggestion({ editor: this.editor, ...emojiSuggestion })]
  },
})

const daLabels = {
  linkControlLabel: "Link",

  boldControlLabel: "Fed",

  italicControlLabel: "Kursiv",

  underlineControlLabel: "Understregning",

  strikeControlLabel: "Gennemstreget",

  clearFormattingControlLabel: "Ryd formatering",

  unlinkControlLabel: "Fjern link",

  bulletListControlLabel: "Punktliste",

  orderedListControlLabel: "Nummereret liste",

  h1ControlLabel: "Overskrift 1",

  h2ControlLabel: "Overskrift 2",

  h3ControlLabel: "Overskrift 3",

  h4ControlLabel: "Overskrift 4",

  h5ControlLabel: "Overskrift 5",

  h6ControlLabel: "Overskrift 6",

  blockquoteControlLabel: "Citat",

  codeControlLabel: "Kode",

  codeBlockControlLabel: "Kodeblok",

  undoControlLabel: "Fortryd",

  redoControlLabel: "Gentag",

  linkEditorInputLabel: "Indtast URL",

  linkEditorInputPlaceholder: "https://eksempel.dk/",

  linkEditorExternalLink: "Åbn link i ny fane",

  linkEditorInternalLink: "Åbn link i samme fane",

  linkEditorSave: "Gem",
}

export interface RichTextEditorProps {
  content: string

  onChange: (content: string) => void

  placeholder?: string

  minHeight?: number

  onFilePaste?: (files: File[]) => void

  /** Called on Cmd+Enter (Mac) / Ctrl+Enter (Windows). */

  onSubmit?: () => void

  /** Unique key for persisting a draft across refreshes. Omit for edit forms. */

  draftKey?: string
}

export default function RichTextEditor({
  content,

  onChange,

  placeholder = "Write something...",

  minHeight = 150,

  onFilePaste,

  onSubmit,

  draftKey,
}: RichTextEditorProps) {
  const isMobile = useMediaQuery("(max-width: 768px)")

  const onFilePasteRef = useRef(onFilePaste)

  onFilePasteRef.current = onFilePaste

  const onSubmitRef = useRef(onSubmit)

  onSubmitRef.current = onSubmit

  // Use refs so the onUpdate callback always sees the latest values

  const onChangeRef = useRef(onChange)

  onChangeRef.current = onChange

  const draftKeyRef = useRef(draftKey)

  draftKeyRef.current = draftKey

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [draftRestored, setDraftRestored] = useState(false)

  const [giphyState, setGiphyState] = useState<GiphyState | null>(null)

  const setGiphyStateRef = useRef(setGiphyState)

  setGiphyStateRef.current = setGiphyState

  // Track which draftKey we've already loaded to avoid re-running on re-renders

  const loadedForKeyRef = useRef<string | null>(null)

  // Track the last HTML emitted via onUpdate so we can skip unnecessary getHTML() calls

  const lastEmittedHtmlRef = useRef<string>("")

  const editor = useEditor({
    extensions: [
      StarterKit,

      Image.configure({ inline: true }),

      Link.extend({
        renderHTML({ HTMLAttributes }) {
          const href: string = HTMLAttributes.href ?? ""

          const isInternal =
            !href ||
            href.startsWith("/") ||
            href.includes("kbintra.top") ||
            href.includes("localhost")

          return [
            "a",

            mergeAttributes(HTMLAttributes, {
              target: isInternal ? null : "_blank",

              rel: isInternal ? null : "noopener noreferrer",
            }),

            0,
          ]
        },
      }).configure({
        openOnClick: false,
      }),

      Placeholder.configure({
        placeholder,
      }),

      EmojiSuggestionExtension,

      // Extend Mention so parseHTML matches <a data-type="mention"> in addition

      // to the default <span data-type="mention">, since our renderHTML outputs <a>.

      Mention.extend({
        atom: true,

        parseHTML() {
          return [{ tag: '[data-type="mention"]' }]
        },
      }).configure({
        HTMLAttributes: { class: "mention" },

        renderHTML({ node }) {
          return [
            "a",

            {
              href: `/profil/${node.attrs.id}`,

              class: "mention",

              "data-type": "mention",

              "data-id": node.attrs.id,

              "data-label": node.attrs.label,
            },

            `@${node.attrs.label ?? node.attrs.id}`,
          ]
        },

        suggestion: mentionSuggestion,
      }),
    ],

    content,

    onUpdate: ({ editor }) => {
      const html = editor.getHTML()

      lastEmittedHtmlRef.current = html

      onChangeRef.current(html)

      const key = draftKeyRef.current

      if (key) {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)

        saveTimerRef.current = setTimeout(() => {
          saveDraft(key, html)
        }, 1500)
      }

      detectGiphy(editor, setGiphyStateRef.current)
    },

    onSelectionUpdate: ({ editor }) => {
      detectGiphy(editor, setGiphyStateRef.current)
    },

    editorProps: {
      handleKeyDown(_view, event) {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          onSubmitRef.current?.()

          return true
        }

        return false
      },

      handlePaste(_view, event) {
        const cb = onFilePasteRef.current

        if (!cb) return false

        const items = event.clipboardData?.items

        if (!items) return false

        const files: File[] = []

        for (const item of items) {
          if (item.kind === "file") {
            const file = item.getAsFile()

            if (file) files.push(file)
          }
        }

        if (files.length === 0) return false

        event.preventDefault()

        cb(files)

        return true
      },

      handleDrop(_view, event) {
        const cb = onFilePasteRef.current

        if (!cb) return false

        const dt = event.dataTransfer

        if (!dt?.files?.length) return false

        const files = Array.from(dt.files)

        if (files.length === 0) return false

        event.preventDefault()

        event.stopPropagation()

        cb(files)

        return true
      },
    },
  })

  useEffect(() => {
    prefetchEmojis()
  }, [])

  useEffect(() => {
    if (
      editor &&
      !editor.isDestroyed &&
      content !== lastEmittedHtmlRef.current
    ) {
      editor.commands.setContent(content)

      lastEmittedHtmlRef.current = content
    }
  }, [content, editor])

  // Load draft once the editor is ready, or when draftKey changes

  useEffect(() => {
    if (!draftKey || !editor || editor.isDestroyed) return

    if (loadedForKeyRef.current === draftKey) return

    loadedForKeyRef.current = draftKey

    loadDraft(draftKey).then((draft) => {
      if (!draft || editor.isDestroyed) return

      const currentHtml = editor.getHTML()

      const isEmpty =
        !currentHtml || currentHtml === "<p></p>" || currentHtml === ""

      if (isEmpty) {
        onChangeRef.current(draft)

        setDraftRestored(true)
      }
    })
  }, [draftKey, editor])

  // Cancel any pending save on unmount

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

  const handleGiphyInsert = (url: string) => {
    if (!editor) return

    editor.chain().focus().clearContent().setImage({ src: url }).run()

    flushSync(() => {
      setGiphyState(null)
    })

    onSubmitRef.current?.()
  }

  const handleGiphyCancel = () => {
    if (!editor) return

    editor.chain().focus().clearContent().run()

    setGiphyState(null)
  }

  const handleEmojiSelect = (emoji: string) => {
    editor?.chain().focus().insertContent(emoji).run()
  }

  const handleClearDraft = () => {
    if (draftKey) clearDraft(draftKey)

    setDraftRestored(false)

    onChange("")
  }

  return (
    <>
      {giphyState && (
        <GiphyPicker
          query={giphyState.query}
          anchor={giphyState.anchor}
          onSend={handleGiphyInsert}
          onCancel={handleGiphyCancel}
        />
      )}
      <MantineRTE editor={editor} style={{ minHeight }} labels={daLabels}>
        <MantineRTE.Toolbar sticky stickyOffset={60}>
          <MantineRTE.ControlsGroup>
            <MantineRTE.Bold />
            <MantineRTE.Italic />
            <MantineRTE.Strikethrough />
            <MantineRTE.ClearFormatting />
          </MantineRTE.ControlsGroup>

          <MantineRTE.ControlsGroup>
            <MantineRTE.H2 />
            <MantineRTE.H3 />
            <MantineRTE.H4 />
          </MantineRTE.ControlsGroup>

          <MantineRTE.ControlsGroup>
            <MantineRTE.Blockquote />
            <MantineRTE.BulletList />
            <MantineRTE.OrderedList />
          </MantineRTE.ControlsGroup>

          <MantineRTE.ControlsGroup>
            <MantineRTE.Link />
            <MantineRTE.Unlink />
          </MantineRTE.ControlsGroup>

          {!isMobile && (
            <MantineRTE.ControlsGroup>
              <Suspense fallback={null}>
                <EmojiPicker
                  onSelect={handleEmojiSelect}
                  size="sm"
                  iconSize={16}
                />
              </Suspense>
            </MantineRTE.ControlsGroup>
          )}

          <MantineRTE.ControlsGroup>
            <MantineRTE.Undo />
            <MantineRTE.Redo />
          </MantineRTE.ControlsGroup>
        </MantineRTE.Toolbar>

        <MantineRTE.Content />
      </MantineRTE>
      {draftRestored && (
        <Group gap={4} mt={4}>
          <Text size="xs" c="dimmed" fs="italic">
            Kladde gendannet automatisk
          </Text>
          <Anchor size="xs" onClick={handleClearDraft}>
            (ryd)
          </Anchor>
        </Group>
      )}
    </>
  )
}
