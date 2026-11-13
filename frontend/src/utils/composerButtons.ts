/**
 * How many columns the buttons beside the message box stand in: all in one
 * row while the message is short, then two rows, then one column, as the text
 * grows tall enough to hold them. Each step gives the text more of the width.
 *
 * Each arrangement is judged by how tall the text would be at the width it
 * leaves the box (`textHeight(columns)`), not by how tall it is now: a
 * narrower block widens the box and the text takes fewer lines, so reacting
 * to the current height would flip back and forth as you type. Judged this
 * way the answer depends only on the text and the room, and the buttons lie
 * down again step by step as the text shrinks.
 *
 * The narrowest arrangement whose buttons are no taller than the text, give
 * or take half a line, wins: two rows of buttons are a little taller than two
 * lines of text, and that much the box may grow. Row counts that need no
 * fewer columns than a lower one (three rows of four buttons) are skipped, so
 * four buttons go two by two, not three and one.
 *
 * `button` is a button's side and `gap` the space between buttons, in px;
 * `line` one line of the text.
 */
export function buttonColumns(
  count: number,
  button: number,
  gap: number,
  line: number,
  textHeight: (columns: number) => number,
): number {
  let best = count

  for (let rows = 2; rows <= count; rows++) {
    const columns = Math.ceil(count / rows)

    if (columns >= best) continue

    const height = rows * button + (rows - 1) * gap

    if (height > textHeight(columns) + line / 2) break

    best = columns
  }

  return best
}

/** How wide `columns` columns of buttons are, in px. */
export function buttonsWidth(columns: number, button: number, gap: number) {
  return columns * button + (columns - 1) * gap
}
