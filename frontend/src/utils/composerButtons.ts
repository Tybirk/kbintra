/**
 * Whether the buttons beside the message box stand in a column (giving the
 * text their width) rather than lie in a row at its foot.
 *
 * They stand once the text needs as much height as the column, so it costs no
 * room, and lie down again only when the text fits on one line. Not on height
 * both ways: standing, the box is wider, the text takes fewer lines, and it
 * would flip back and forth as you type.
 *
 * `needed` is the height the text takes at the box's current width, `line` one
 * line of it, `column` the height of the buttons standing; all in px.
 */
export function buttonsStand(
  standing: boolean,
  needed: number,
  line: number,
  column: number,
): boolean {
  return standing ? needed >= 2 * line : needed >= column
}
