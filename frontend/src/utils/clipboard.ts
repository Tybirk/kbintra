/**
 * Copy text to the clipboard, returning whether it actually succeeded.
 *
 * The async Clipboard API (`navigator.clipboard.writeText`) is the preferred
 * path, but Safari/macOS can reject it silently in some configurations. When it
 * is unavailable or rejects, we fall back to the legacy hidden-textarea +
 * `execCommand("copy")` method, which works across all evergreen browsers.
 *
 * Always reflect the returned boolean in the UI — never assume success.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through to the legacy method below.
    }
  }

  return copyViaExecCommand(text)
}

function copyViaExecCommand(text: string): boolean {
  try {
    const textarea = document.createElement("textarea")
    textarea.value = text
    // Read-only avoids the iOS keyboard popping up; fixed/transparent keeps it
    // out of view without causing the page to scroll on focus.
    textarea.setAttribute("readonly", "")
    textarea.style.position = "fixed"
    textarea.style.top = "0"
    textarea.style.left = "0"
    textarea.style.width = "1px"
    textarea.style.height = "1px"
    textarea.style.padding = "0"
    textarea.style.border = "none"
    textarea.style.opacity = "0"

    document.body.appendChild(textarea)

    textarea.focus()
    textarea.select()
    textarea.setSelectionRange(0, text.length)

    const ok = document.execCommand("copy")
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}
