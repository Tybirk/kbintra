import { useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { RichTextEditor as MantineRTE } from '@mantine/tiptap';
import { ActionIcon, Group, Box } from '@mantine/core';
import { IconSend } from '@tabler/icons-react';
import { useEffect } from 'react';
import EmojiPicker from './EmojiPicker';

interface ChatRichTextEditorProps {
  content: string;
  onChange: (content: string) => void;
  onSend: () => void;
  placeholder?: string;
  disabled?: boolean;
}

export default function ChatRichTextEditor({
  content,
  onChange,
  onSend,
  placeholder = 'Type a message...',
  disabled = false,
}: ChatRichTextEditorProps) {
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
      onChange(editor.getHTML());
    },
    editorProps: {
      handleKeyDown: (_view, event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          onSend();
          return true;
        }
        return false;
      },
    },
  });

  // Clear editor when content is cleared externally
  useEffect(() => {
    if (content === '' && editor && editor.getHTML() !== '<p></p>') {
      editor.commands.clearContent();
    }
  }, [content, editor]);

  const isEmpty = !editor?.getText().trim();

  const handleEmojiSelect = (emoji: string) => {
    editor?.chain().focus().insertContent(emoji).run();
  };

  return (
    <Group gap="sm" align="flex-end" style={{ width: '100%' }}>
      <Box style={{ flex: 1 }}>
        <MantineRTE editor={editor} style={{ minHeight: 42 }}>
          <MantineRTE.Toolbar>
            <MantineRTE.ControlsGroup>
              <MantineRTE.Bold />
              <MantineRTE.Italic />
            </MantineRTE.ControlsGroup>

            <MantineRTE.ControlsGroup>
              <MantineRTE.BulletList />
              <MantineRTE.OrderedList />
            </MantineRTE.ControlsGroup>

            <MantineRTE.ControlsGroup>
              <MantineRTE.Link />
            </MantineRTE.ControlsGroup>

            <MantineRTE.ControlsGroup>
              <EmojiPicker onSelect={handleEmojiSelect} />
            </MantineRTE.ControlsGroup>
          </MantineRTE.Toolbar>

          <MantineRTE.Content />
        </MantineRTE>
      </Box>
      <ActionIcon
        size="lg"
        variant="filled"
        onClick={onSend}
        disabled={disabled || isEmpty}
        mb={4}
      >
        <IconSend size={18} />
      </ActionIcon>
    </Group>
  );
}
