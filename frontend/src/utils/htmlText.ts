/**
 * Convert stored rich-text HTML to a single line of plain text.
 *
 * Used for previews (announcement/activity/conversation summaries) and for
 * copying a post to the clipboard. Tag-stripping regexes are not enough on
 * their own: Tiptap and the legacy import both emit HTML entities, so
 * `&nbsp;` and friends leak into the text unless they're decoded. Parsing the
 * markup and reading its text content decodes every entity for free.
 */
export function htmlToPlainText(html: string): string {
  if (!html) return ""

  // textContent runs block elements together ("<p>a</p><p>b</p>" -> "ab"), so
  // turn block boundaries into whitespace first. Inline tags are left alone —
  // splitting those would break words apart ("<b>ord</b>ner" -> "ord ner").
  const spaced = html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|li|ul|ol|h[1-6]|tr|td|th|blockquote|pre)>/gi, " ")

  const text =
    new DOMParser().parseFromString(spaced, "text/html").body.textContent ?? ""

  // \s in JS covers the non-breaking space that `&nbsp;` decodes to, so this
  // collapses decoded entities along with ordinary whitespace.
  return text.replace(/\s+/g, " ").trim()
}

/** Plain text as above, truncated to `maxLength` with a trailing ellipsis. */
export function htmlToPreview(html: string, maxLength: number): string {
  const text = htmlToPlainText(html)

  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}
