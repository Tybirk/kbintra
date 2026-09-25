import { describe, it, expect } from "vitest"

import { sanitizeHtml } from "./sanitizeHtml"

describe("sanitizeHtml", () => {
  it("keeps Tiptap's own output unchanged", () => {
    const html =
      '<p>Hej <a href="/profil/91" class="mention" data-type="mention" data-id="91" data-label="Richard">@Richard</a>, ' +
      'se <a target="_blank" rel="noopener noreferrer nofollow" href="https://kb-intra.dk/forum">tråden</a>.</p>' +
      '<ul><li><p><strong>fed</strong> og <em>kursiv</em></p></li></ul><img src="/media/x.jpg" alt="x">'

    expect(sanitizeHtml(html)).toBe(html)
  })

  it("removes event handlers, scripts and javascript: links", () => {
    const html =
      '<img src="x" onerror="alert(1)"><script>alert(2)</script>' +
      '<a href="javascript:alert(3)">klik</a><p onclick="alert(4)">tekst</p>'

    expect(sanitizeHtml(html)).toBe('<img src="x"><a>klik</a><p>tekst</p>')
  })

  it("drops inline styles and form controls, the makings of a fake login", () => {
    const html =
      '<div style="position:fixed;inset:0"><form action="https://x.dk">' +
      '<input type="password"><button>Log ind</button></form></div>'

    expect(sanitizeHtml(html)).toBe("<div>Log ind</div>")
  })

  it("drops <style>, which would restyle the whole page", () => {
    expect(sanitizeHtml("<style>body{display:none}</style><p>hej</p>")).toBe(
      "<p>hej</p>",
    )
  })
})
