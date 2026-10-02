"""Screenshots for both guides, from the local demo stack (see README.md).

uv run --no-project --with playwright python shoot.py [scene ...]
"""

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:5180"
OUT = Path(__file__).parent / "shots"
OUT.mkdir(exist_ok=True)
NOW = "2026-10-01T16:45:00+02:00"
IPHONE_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
)


def settle(page, ms=1200):
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(ms)


def go(page, path, ms=1200):
    page.goto(f"{BASE}{path}")
    settle(page, ms)


def shot(page, name, **kw):
    page.screenshot(path=str(OUT / f"{name}.png"), **kw)
    print("shot", name)


def card_of(page, text):
    """The closest Mantine card/paper around a piece of text."""
    return (
        page.locator("main")
        .get_by_text(text, exact=True)
        .first.locator(
            "xpath=ancestor::div[contains(@class,'mantine-Paper-root') or contains(@class,'mantine-Card-root')][1]"
        )
    )


def element_shot(page, name, locator, pad=8):
    locator.scroll_into_view_if_needed()
    page.wait_for_timeout(400)
    box = locator.bounding_box()
    clip = {
        "x": max(box["x"] - pad, 0),
        "y": max(box["y"] - pad, 0),
        "width": min(box["width"] + 2 * pad, 390),
        "height": box["height"] + 2 * pad,
    }
    shot(page, name, clip=clip)


SCENES = {}


def scene(fn):
    SCENES[fn.__name__] = fn
    return fn


@scene
def forside(page):
    go(page, "/")
    shot(page, "forside")


@scene
def menu(page):
    go(page, "/")
    page.locator(".mantine-Burger-root").first.click()
    page.wait_for_timeout(800)
    shot(page, "menu")


@scene
def forside_mad(page):
    go(page, "/")
    page.add_style_tag(
        content="header, .mantine-AppShell-header { display: none !important; }"
    )
    card = card_of(page, "Mad")
    card.screenshot(path=str(OUT / "forside_mad_full.png"))
    print("shot forside_mad_full")


@scene
def forside_notif(page):
    go(page, "/")
    element_shot(page, "forside_notif", card_of(page, "Ulæste notifikationer"))


@scene
def notifikationer(page):
    go(page, "/notifikationer")
    shot(page, "notifikationer")


@scene
def push(page):
    go(page, "/notifikationer/indstillinger")
    page.get_by_role("tab", name="Push").click()
    page.wait_for_timeout(800)
    shot(page, "push")


@scene
def mad(page):
    go(page, "/mad")
    shot(page, "mad")


@scene
def madhold(page):
    go(page, "/madhold/mine-hold")
    shot(page, "madhold")


@scene
def madhold_bytte(page):
    go(page, "/madhold/bytte")
    shot(page, "madhold_bytte")


@scene
def madhold_oensker(page):
    go(page, "/madhold/oensker")
    shot(page, "madhold_oensker")


@scene
def madhold_profil(page):
    go(page, "/madhold/profil")
    shot(page, "madhold_profil")


@scene
def madhold_idag(page):
    go(page, "/")
    shot(page, "madhold_idag")


@scene
def rester(page):
    go(page, "/")
    page.get_by_role("button", name="Rester er klar").click()
    page.wait_for_timeout(500)
    page.get_by_placeholder("Hvad er der til rest? (valgfri)").fill(
        "Der er pitabrød og pulled svampe i køleskabet"
    )
    btn = page.get_by_role("button", name="Send rester-besked")
    btn.scroll_into_view_if_needed()
    page.wait_for_timeout(400)
    shot(page, "rester_form")
    btn.click()
    page.wait_for_timeout(1500)
    go(page, "/mad/rester")
    shot(page, "rester_side")


@scene
def forum(page):
    go(page, "/forum")
    shot(page, "forum")


@scene
def faelles(page):
    go(page, "/forum/faelles")
    shot(page, "faelles")


@scene
def opslag(page):
    go(page, "/opslag")
    shot(page, "opslag")


@scene
def besked(page):
    go(page, "/beskeder")
    page.get_by_text("Bent", exact=True).first.click()
    settle(page)
    shot(page, "besked")


@scene
def kalender(page):
    go(page, "/kalender")
    page.get_by_text("Liste", exact=True).first.click()
    settle(page)
    shot(page, "kalender")


@scene
def booking(page):
    go(page, "/booking")
    shot(page, "booking")


@scene
def beboere(page):
    go(page, "/beboere")
    page.get_by_placeholder("Søg efter hus eller beboer...").fill("Eksempel")
    page.wait_for_timeout(1000)
    shot(page, "beboere")


@scene
def profil(page):
    go(page, "/profil")
    shot(page, "profil")


@scene
def soeg(page):
    go(page, "/soeg?q=madhold")
    shot(page, "soeg")


@scene
def bildeling(page):
    go(page, "/bildeling")
    shot(page, "bildeling")


@scene
def udlaeg(page):
    go(page, "/udlaeg")
    shot(page, "udlaeg")


@scene
def indrapportering(page):
    go(page, "/indrapportering")
    shot(page, "indrapportering", clip={"x": 0, "y": 0, "width": 390, "height": 420})


@scene
def links(page):
    go(page, "/links")
    shot(page, "links")


HIDE_HEADER = "header, .mantine-AppShell-header { display: none !important; }"


def _abs_top(locator):
    return locator.evaluate("e => e.getBoundingClientRect().top + window.scrollY")


def section_shot(page, name, start_text, end_text=None, pad=10):
    """Crop the page from one heading to the next (or to the end)."""
    page.add_style_tag(content=HIDE_HEADER)
    page.wait_for_timeout(300)
    main = page.locator("main")
    y0 = _abs_top(main.get_by_text(start_text, exact=True).first)
    if end_text:
        y1 = _abs_top(main.get_by_text(end_text, exact=True).first)
    else:
        y1 = page.evaluate("document.documentElement.scrollHeight")
    shot(
        page,
        name,
        full_page=True,
        clip={"x": 0, "y": max(y0 - pad, 0), "width": 390, "height": y1 - y0},
    )


def card_with(page, text):
    return (
        page.locator("main .mantine-Card-root, main .mantine-Paper-root")
        .filter(has_text=text)
        .first
    )


@scene
def mh_mine_hold(page):
    go(page, "/madhold/mine-hold")
    shot(page, "mh_mine_hold_full", full_page=True)


@scene
def mh_alle(page):
    go(page, "/madhold/alle-hold")
    shot(page, "mh_alle")


@scene
def mh_oensker(page):
    go(page, "/madhold/oensker")
    shot(page, "mh_oensker_full", full_page=True)
    page.get_by_label("Jeg er forhindret i hele perioden").check(force=True)
    page.wait_for_timeout(600)
    shot(page, "mh_oensker_forhindret_full", full_page=True)


@scene
def mh_profil(page):
    go(page, "/madhold/profil")
    shot(page, "mh_profil_full", full_page=True)


@scene
def mh_swap_specific(page):
    page.set_viewport_size({"width": 390, "height": 2200})
    go(page, "/madhold/mine-hold")
    card_with(page, "19. oktober 2026").get_by_role(
        "button", name="Anmod specifik person om bytte"
    ).click()
    dialog = page.get_by_role("dialog")
    dialog.get_by_text("Tirsdag, 20. oktober", exact=False).first.click()
    page.wait_for_timeout(700)
    dialog.get_by_text("Ole", exact=False).last.click()
    dialog.get_by_label("Besked (valgfri)").fill("Som aftalt ved postkassen")
    page.wait_for_timeout(400)
    dialog.screenshot(path=str(OUT / "mh_swap_specific.png"))
    print("shot mh_swap_specific")
    page.keyboard.press("Escape")
    page.set_viewport_size({"width": 390, "height": 844})


@scene
def mh_swap_broadcast(page):
    go(page, "/madhold/mine-hold")
    card_with(page, "19. oktober 2026").get_by_role(
        "button", name="Anmod fællesskabet om bytte"
    ).click()
    page.wait_for_timeout(700)
    page.get_by_role("dialog").screenshot(path=str(OUT / "mh_swap_broadcast.png"))
    print("shot mh_swap_broadcast")
    page.keyboard.press("Escape")


@scene
def mh_bytte(page):
    go(page, "/madhold/bytte")
    section_shot(page, "mh_indgaaende", "Indgående anmodninger", "Mine anmodninger")
    go(page, "/madhold/bytte")
    section_shot(
        page, "mh_broadcast_in", "Bytteanmodninger til dig", "Mine udsendte anmodninger"
    )
    go(page, "/madhold/bytte")
    section_shot(page, "mh_ledger", "Tjeneste-regnskab")


@scene
def mh_takeover(page):
    go(page, "/madhold/bytte")
    page.get_by_role(
        "button", name="Eller tag den uden at bytte (de skylder dig en)"
    ).click()
    page.wait_for_timeout(700)
    page.get_by_role("dialog").screenshot(path=str(OUT / "mh_takeover.png"))
    print("shot mh_takeover")
    page.keyboard.press("Escape")


@scene
def mh_dagen(page):
    go(page, "/")
    shot(page, "mh_idag")
    page.get_by_role("button", name="Dagens forside").click()
    page.wait_for_timeout(1200)
    shot(page, "mh_dagens_forside")
    page.keyboard.press("Escape")
    page.wait_for_timeout(600)
    page.get_by_role("button", name="Pitabrød", exact=True).click()
    page.wait_for_timeout(1200)
    shot(page, "mh_opskrift")
    page.keyboard.press("Escape")
    page.wait_for_timeout(600)
    element_shot(
        page,
        "mh_tilmeldinger",
        page.locator("main")
        .get_by_text("Tilmeldinger i dag", exact=True)
        .locator("xpath=.."),
    )


@scene
def mh_takeaway(page):
    go(page, "/")
    page.get_by_role("button", name="Takeaway er klar").click()
    page.wait_for_timeout(500)
    page.get_by_text("kl. 17:15", exact=True).click()
    send = page.get_by_role("button", name="Send takeaway-besked")
    send.scroll_into_view_if_needed()
    page.wait_for_timeout(500)
    shot(page, "mh_takeaway_panel")
    send.click()
    page.wait_for_timeout(1800)
    btn = page.get_by_role("button", name="Takeaway klar kl. 17:15")
    btn.scroll_into_view_if_needed()
    page.wait_for_timeout(500)
    shot(page, "mh_takeaway_sent")


@scene
def mh_notifikationer(page):
    go(page, "/notifikationer")
    shot(page, "mh_notifikationer_full", full_page=True)


@scene
def mh_notif_mad(page):
    go(page, "/notifikationer/indstillinger")
    section_shot(page, "mh_notif_mad", "Mad", "Bildeling")


def new_page(p, browser, ua=None):
    ctx = browser.new_context(
        viewport={"width": 390, "height": 844},
        device_scale_factor=2,
        is_mobile=True,
        has_touch=True,
        locale="da-DK",
        timezone_id="Europe/Copenhagen",
        service_workers="block",
        user_agent=ua,
    )
    page = ctx.new_page()
    page.clock.install(time=NOW)
    return page


def login(page):
    page.goto(f"{BASE}/login")
    page.fill("input[type=email]", "hanne@eksempel.dk")
    page.fill("input[type=password]", "demo1234")
    page.click("button[type=submit]")
    page.wait_for_url(lambda u: "/login" not in u, timeout=20000)


# Read-only scenes first; the takeaway and leftovers announcements can only be
# sent once per team, so they come after everything that shows them unsent.
DEFAULT_ORDER = [
    "install",
    "mh_notifikationer",
    "notifikationer",
    "forside_notif",
    "forside",
    "forside_mad",
    "menu",
    "mh_mine_hold",
    "mh_alle",
    "mh_oensker",
    "mh_profil",
    "mh_swap_specific",
    "mh_swap_broadcast",
    "mh_bytte",
    "mh_takeover",
    "mh_notif_mad",
    "push",
    "mad",
    "mh_dagen",
    "mh_takeaway",
    "rester",
    "faelles",
    "opslag",
    "besked",
    "kalender",
    "booking",
    "beboere",
    "profil",
    "bildeling",
    "udlaeg",
    "indrapportering",
    "links",
]


def main(names):
    names = names or DEFAULT_ORDER
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome")
        if not names or "install" in names:
            ip = new_page(p, browser, ua=IPHONE_UA)
            go(ip, "/login", 2500)
            shot(ip, "install_login")
            login(ip)
            settle(ip, 2500)
            shot(ip, "install")
            names = [n for n in names if n != "install"]
        page = new_page(p, browser)
        login(page)
        for name in names:
            SCENES[name](page)
        browser.close()


if __name__ == "__main__":
    main(sys.argv[1:])
