import DOMPurify from "dompurify"

/**
 * The gate for stored HTML on its way into the page: posts, event and group
 * descriptions, announcements, the links page, docx previews. Every
 * dangerouslySetInnerHTML goes through here.
 *
 * The server stores what it is sent, and any resident can write through the
 * API directly, so the editor's own schema is no protection. Tiptap's output
 * passes unchanged (links keep their target, mentions their data-*); scripts,
 * event handlers and javascript: URLs do not. Nor does <style>: one in a post
 * would restyle the whole app for everyone reading it.
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ["target"],
    FORBID_TAGS: ["style"],
  })
}
