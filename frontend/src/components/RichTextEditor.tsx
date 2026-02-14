import { useEffect, useRef } from "react"
import { useEditor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Link from "@tiptap/extension-link"
import Placeholder from "@tiptap/extension-placeholder"
import { RichTextEditor as MantineRTE } from "@mantine/tiptap"
import EmojiPicker from "./EmojiPicker"

interface RichTextEditorProps {
  content: string
  onChange: (content: string) => void
  placeholder?: string
  minHeight?: number
  onFilePaste?: (files: File[]) => void
}

export default function RichTextEditor({
  content,
  onChange,
  placeholder = "Write something...",
  minHeight = 150,
  onFilePaste,
}: RichTextEditorProps) {
  const onFilePasteRef = useRef(onFilePaste)
  onFilePasteRef.current = onFilePaste

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: false,
      }),
      Placeholder.configure({
        placeholder,
      }),
    ],
    content,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML())
    },
    editorProps: {
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
        cb(files)
        return true
      },
    },
  })

  useEffect(() => {
    if (editor && !editor.isDestroyed && content !== editor.getHTML()) {
      editor.commands.setContent(content)
    }
  }, [content, editor])

  const handleEmojiSelect = (emoji: string) => {
    editor?.chain().focus().insertContent(emoji).run()
  }

  return (
    <MantineRTE editor={editor} style={{ minHeight }}>
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

        <MantineRTE.ControlsGroup>
          <EmojiPicker onSelect={handleEmojiSelect} size="sm" iconSize={16} />
        </MantineRTE.ControlsGroup>

        <MantineRTE.ControlsGroup>
          <MantineRTE.Undo />
          <MantineRTE.Redo />
        </MantineRTE.ControlsGroup>
      </MantineRTE.Toolbar>

      <MantineRTE.Content />
    </MantineRTE>
  )
}
