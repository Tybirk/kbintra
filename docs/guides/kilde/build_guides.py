"""Build both resident guides (HTML + PDF) from the screenshots in ./shots.

    uv run --no-project --with playwright --with pillow python build_guides.py

Writes docs/guides/beboerguide/ and docs/guides/madholdguide/: an HTML page,
its billeder/ and a PDF (A4 landscape). The PDFs are gitignored; rebuild them
with this command, or open the HTML and print it (A4, liggende).
"""

from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

KILDE = Path(__file__).parent
SHOTS = KILDE / "shots"
GUIDES = KILDE.parent

# Screenshots are taken at 2x (780 px for a 390 px phone). 1.5x is plenty for
# print at the sizes used here, and keeps every image well under the repo's
# 500 KB per-file limit.
SCALE = 0.75


class Guide:
    def __init__(self, folder: str, filename: str, title: str):
        self.dir = GUIDES / folder
        self.img = self.dir / "billeder"
        self.img.mkdir(parents=True, exist_ok=True)
        self.filename = filename
        self.title = title

    def put(self, name: str, src: str, crop: tuple[int, int] | None = None) -> str:
        im = Image.open(SHOTS / f"{src}.png").convert("RGB")
        if crop:
            im = im.crop((0, crop[0], im.width, min(crop[1], im.height)))
        im = im.resize(
            (round(im.width * SCALE), round(im.height * SCALE)), Image.LANCZOS
        )
        im = im.quantize(
            colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE
        )
        im.save(self.img / f"{name}.png", optimize=True)
        return f"billeder/{name}.png"

    def build(self, slides: list[str]) -> Path:
        html = f"""<!doctype html>
<html lang="da"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{self.title}</title>
<style>{CSS}</style></head>
<body>{"".join(slides)}</body></html>"""
        page_path = self.dir / f"{self.filename}.html"
        page_path.write_text(html, encoding="utf-8")
        return page_path


def phone(src: str, cls: str = "short") -> str:
    return f'<figure class="phone {cls}"><img src="{src}" alt=""></figure>'


def slide(title: str, body: str, *shots: str, kicker: str = "", cls: str = "") -> str:
    k = f'<p class="kicker">{kicker}</p>' if kicker else ""
    return f"""
<section class="slide {cls}">
  <div class="text">{k}<h2>{title}</h2>{body}</div>
  <div class="shots n{len(shots)}">{"".join(shots)}</div>
</section>"""


def cover(kicker: str, title: str, lead: str, shot: str) -> str:
    return f"""
<section class="slide cover">
  <div class="text">
    <p class="kicker">{kicker}</p>
    <h1>{title}</h1>
    <p class="lead">{lead}</p>
    <p class="url">kb-intra.dk</p>
  </div>
  <div class="shots n1">{shot}</div>
</section>"""


def text_slide(kicker: str, title: str, body: str, cls: str = "") -> str:
    return f"""
<section class="slide textonly {cls}">
  <div class="text wide"><p class="kicker">{kicker}</p><h2>{title}</h2>{body}</div>
</section>"""


CSS = """
@page { size: A4 landscape; margin: 0; }
:root { --ink:#16181d; --muted:#4a5160; --accent:#1c7ed6; --soft:#e7f1fb; --paper:#ffffff;
  --green:#2f9e44; --greensoft:#ebfbee; }
* { box-sizing: border-box; }
html, body { margin:0; background:var(--paper); color:var(--ink);
  font-family: "Noto Sans", "DejaVu Sans", "Segoe UI", Arial, sans-serif; }
.slide { width:297mm; height:210mm; padding:16mm 18mm; display:flex; gap:12mm;
  align-items:center; page-break-after:always; break-after:page; overflow:hidden; }
.text { flex:1 1 0; min-width:108mm; }
.text.wide { flex:1 1 100%; }
.kicker { margin:0 0 3mm; color:var(--accent); font-weight:700; font-size:15pt; letter-spacing:.04em; }
h1 { font-size:58pt; margin:0 0 6mm; line-height:1.02; }
h2 { font-size:31pt; margin:0 0 7mm; line-height:1.1; }
p, li { font-size:18pt; line-height:1.4; }
p { margin:0 0 5mm; }
ul, ol { margin:0 0 5mm; padding-left:9mm; }
li { margin-bottom:3.5mm; }
.small { font-size:14.5pt; color:var(--muted); line-height:1.4; }
li .small { display:inline-block; margin-top:2mm; }
.dense p, .dense li { font-size:16pt; }
.dense h2 { margin-bottom:5mm; }
.lead { font-size:23pt; color:var(--muted); max-width:150mm; }
.url { display:inline-block; margin-top:6mm; font-size:22pt; font-weight:700; color:var(--accent);
  background:var(--soft); padding:3mm 7mm; border-radius:4mm; }
.note { margin-top:4mm; font-size:15.5pt; background:var(--greensoft); border-left:2mm solid var(--green);
  padding:3.5mm 5mm; border-radius:2mm; line-height:1.4; }
.shots { flex:0 0 auto; display:flex; gap:7mm; align-items:center; justify-content:center; }
.phone { margin:0; border:2.4mm solid #20232a; border-radius:6mm; overflow:hidden; background:#fff;
  box-shadow:0 3mm 8mm rgba(0,0,0,.18); }
.phone img { display:block; width:100%; height:auto; }
.phone.short { width:64mm; max-height:172mm; }
.n1 .phone.short { width:76mm; }
.phone.full { height:168mm; width:auto; }
.phone.full img { height:100%; width:auto; }
.n2 .phone.full { height:142mm; }
.col { display:flex; flex-direction:column; gap:6mm; }
.four .text { flex:0 0 120mm; }
.n4 { display:grid; grid-template-columns:1fr 1fr; gap:6mm; }
.n4 .phone { width:58mm; border-width:1.8mm; border-radius:4mm; }
table { border-collapse:collapse; width:100%; margin-bottom:4mm; }
th, td { text-align:left; padding:2.2mm 3.5mm; font-size:13.5pt; vertical-align:top; line-height:1.3; }
th { background:var(--soft); color:var(--accent); font-size:12pt; text-transform:uppercase; letter-spacing:.04em; }
tr + tr td { border-top:0.3mm solid #dfe3ea; }
.textonly h2 { margin-bottom:5mm; }
.steps { list-style:none; padding:0; display:grid; grid-template-columns:1fr 1fr; gap:5mm 10mm; }
.steps li { display:flex; gap:5mm; align-items:flex-start; margin:0; font-size:16.5pt; }
.steps b.n { flex:0 0 13mm; height:13mm; border-radius:50%; background:var(--accent); color:#fff;
  display:flex; align-items:center; justify-content:center; font-size:17pt; }
.three { display:grid; grid-template-columns:1fr 1fr 1fr; gap:7mm; }
.three div { background:var(--soft); border-radius:4mm; padding:6mm; }
.three h3 { margin:0 0 3mm; font-size:19pt; }
.three p { font-size:15pt; margin:0 0 3mm; }
.help { margin-top:4mm; font-size:17pt; background:var(--greensoft); border-left:2mm solid var(--green);
  padding:4mm 6mm; border-radius:2mm; }
"""


# --------------------------------------------------------------------------- #
# Beboerguide: the whole app, short.
# --------------------------------------------------------------------------- #
def beboerguide() -> Guide:
    g = Guide("beboerguide", "kb-intra-guide", "KB Intra: kort guide")
    i = {
        "idag": g.put("idag", "forside"),
        "login": g.put("login", "install_login", (0, 1100)),
        "banner": g.put("banner", "install", (1380, 1688)),
        "menu": g.put("menu", "menu"),
        "notif_widget": g.put("notif_widget", "forside_notif"),
        "mad_widget": g.put("mad_widget", "forside_mad_full", (0, 1130)),
        "notifikationer": g.put("notifikationer", "notifikationer"),
        "indstillinger": g.put("indstillinger", "notif_indstillinger"),
        "push": g.put("push", "push", (0, 900)),
        "mad": g.put("mad", "mad"),
        "madhold": g.put("madhold", "mh_mine_hold_full", (0, 1688)),
        "oensker": g.put("oensker", "mh_oensker_forhindret_full", (0, 1330)),
        "rester": g.put("rester", "rester_form", (440, 1130)),
        "takeaway": g.put("takeaway", "mh_takeaway_panel", (330, 1140)),
        "bytte": g.put("bytte", "mh_indgaaende"),
        "mprofil": g.put("mprofil", "mh_profil_full", (560, 1888)),
        "faelles": g.put("faelles", "faelles"),
        "opslag": g.put("opslag", "opslag"),
        "besked": g.put("besked", "besked"),
        "kalender": g.put("kalender", "kalender"),
        "booking": g.put("booking", "booking"),
        "beboere": g.put("beboere", "beboere", (0, 900)),
        "profil": g.put("profil", "profil"),
        "bildeling": g.put("bildeling", "bildeling", (0, 1000)),
        "udlaeg": g.put("udlaeg", "udlaeg", (0, 1000)),
        "indrap": g.put("indrap", "indrapportering"),
        "links": g.put("links", "links", (0, 1000)),
    }
    slides = [
        cover(
            "Kløverbakken · oktober 2026",
            "KB Intra",
            "En kort guide til vores fælles intranet, på telefonen og på computeren.",
            phone(i["idag"], "full"),
        ),
        slide(
            "Kom i gang",
            """<ol>
<li>Gå ind på <b>kb-intra.dk</b>.</li>
<li>Skriv din <b>e-mail</b> og <b>adgangskode</b>, og tryk <b>Log ind</b>.</li>
<li>Glemt adgangskoden? Tryk <b>Glemt adgangskode?</b> og få en mail.</li>
<li>Læg den på telefonens <b>hjemmeskærm</b>, så den virker som en app.<br>
<span class="small">iPhone: tryk på del-knappen og vælg <b>Føj til hjemmeskærm</b>.<br>
Android: tryk <b>Installér</b>, når telefonen spørger.</span></li>
</ol>""",
            phone(i["login"]),
            phone(i["banner"]),
            kicker="1",
            cls="dense",
        ),
        slide(
            "Menuen",
            """<p>Alt findes i menuen. Tryk på de <b>tre streger ☰</b> øverst til venstre.</p>
<ul>
<li>Det røde tal viser, hvor meget nyt der er.</li>
<li><b>Kuverten</b> øverst er dine beskeder.</li>
<li><b>Klokken</b> er dine notifikationer.</li>
<li><b>Søg</b>-feltet finder tråde, opslag, arrangementer og naboer.</li>
</ul>""",
            phone(i["menu"], "full"),
            kicker="2",
        ),
        slide(
            "Forsiden",
            """<p>Forsiden viser det vigtigste lige nu:</p>
<ul>
<li>Dine ulæste notifikationer.</li>
<li>Dagens mad, og hvem der laver den.</li>
<li>Seneste vigtige post og forumtråde.</li>
<li>Kommende arrangementer og fødselsdage.</li>
</ul>""",
            phone(i["notif_widget"]),
            phone(i["mad_widget"]),
            kicker="3",
        ),
        slide(
            "Notifikationer",
            """<p>Når der sker noget, der vedrører dig, kommer det under <b>klokken</b>.</p>
<ul>
<li>Tryk på en notifikation for at åbne den.</li>
<li><b>✓</b> markerer den som læst.</li>
<li>Blå = ny. Hvid = læst.</li>
</ul>
<p class="small">Se en liste over de vigtigste notifikationer bagerst i guiden.</p>""",
            phone(i["notifikationer"], "full"),
            kicker="4",
        ),
        slide(
            "Vælg, hvad du får besked om",
            """<p>Tryk <b>Indstillinger</b> på notifikationssiden.</p>
<ul>
<li><b>I appen</b>: hvad der kommer under klokken.</li>
<li><b>E-mail</b>: hvad der også sendes som mail.</li>
<li><b>Push</b>: besked direkte på telefonen, også når appen er lukket. Tryk <b>Aktivér push-notifikationer</b> og sig ja.</li>
</ul>""",
            phone(i["indstillinger"], "full"),
            phone(i["push"]),
            kicker="5",
        ),
        slide(
            "Mad: tilmelding",
            """<p>Under <b>Mad</b> ser du ugens menu og melder husstanden til.</p>
<ul>
<li>Vælg <b>Fælleshuset</b> eller <b>Tag med</b>, og <b>17:30</b> eller <b>18:30</b>.</li>
<li>Fristen er <b>onsdag kl. 23:59</b> for næste uge. Derefter står der <b>Bestilt</b>.</li>
<li>Kan du alligevel ikke? Tryk <b>Sælg billet</b>, så kan en nabo købe den.</li>
</ul>""",
            phone(i["mad"], "full"),
            kicker="6",
        ),
        slide(
            "Madhold: dine maddage",
            """<p>Under <b>Madhold</b> → <b>Mine hold</b> står de dage, du skal lave mad, og hvem du laver mad med.</p>
<ul>
<li>Når en ny periode åbner, får du besked. Vælg alle de dage, du kan, under <b>Indsend ønsker</b>.</li>
<li>Madholdet er en fælles opgave. Du kan melde dig fra en periode, hvis der er en god grund, fx sygdom (også stress) eller en lang rejse. Slå <b>Jeg er forhindret i hele perioden</b> til, og skriv hvorfor.</li>
</ul>""",
            phone(i["madhold"], "full"),
            phone(i["oensker"]),
            kicker="7",
            cls="dense",
        ),
        slide(
            "Madhold: dagen, du laver mad",
            """<p>På din maddag er der en <b>grøn boks</b> øverst på forsiden med holdet, dagens opskrifter og hvor mange der spiser.</p>
<ul>
<li><b>Takeaway er klar</b>: kun hvis maden er klar <b>før 17:30</b>. Vælg kl. 17:10, 17:15, 17:20 eller Nu, gerne i god tid.</li>
<li><b>Rester er klar</b>: hvis der er mad tilovers. Skriv gerne hvad.</li>
</ul>
<p class="small">Naboerne får en notifikation med det samme.</p>""",
            phone(i["idag"], "full"),
            phone(i["takeaway"]),
            kicker="8",
            cls="dense",
        ),
        slide(
            "Madhold: bytte og profil",
            """<ul>
<li><b>Anmod specifik person om bytte</b>: når I har aftalt et bytte, fx over hækken, eller du vil spørge én bestemt nabo. Den anden trykker <b>Accepter</b>, så er planen opdateret.</li>
<li><b>Anmod fællesskabet om bytte</b>: alle, der kan tage dagen, får besked.</li>
<li><b>Chefkok</b> på din profil betyder, at du gerne tager teten i køkkenet. Det bruges til at fordele chefkokkene jævnt på holdene.</li>
</ul>""",
            phone(i["bytte"]),
            phone(i["mprofil"]),
            kicker="9",
            cls="dense",
        ),
        slide(
            "Forum og Vigtig post",
            """<ul>
<li><b>Forum</b> er grupperne. <b>Fælles</b> er for alle. Tryk <b>Ny tråd</b> for at skrive.</li>
<li>Tryk på klokken ved en gruppe for at følge den.</li>
<li><b>Vigtig post</b> er opslag, alle bør læse. Du får en notifikation, når der kommer et nyt.</li>
</ul>""",
            phone(i["faelles"], "full"),
            phone(i["opslag"], "full"),
            kicker="10",
        ),
        slide(
            "Beskeder",
            """<p>Skriv direkte til en eller flere naboer.</p>
<ul>
<li>Tryk på <b>kuverten</b> øverst, eller <b>Beskeder</b> i menuen.</li>
<li><b>Ny besked</b> → vælg naboen → skriv → tryk på pilen.</li>
<li>Du kan også sende billeder og filer.</li>
</ul>
<p class="small">Beskeder er private. Kun dem i samtalen kan læse dem.</p>""",
            phone(i["besked"], "full"),
            kicker="11",
        ),
        slide(
            "Kalender og booking",
            """<ul>
<li><b>Begivenhedskalender</b>: det, der er relevant for bofællesskabet, fx fællesmøder, arbejdsdage, fester for alle og affaldsdage.</li>
<li><b>Bookingkalender</b>: her booker du et lokale til noget privat, fx en fødselsdag. Se om det er ledigt, og tryk <b>Ny</b>.</li>
</ul>
<p class="small">Du kan også booke lokaler, når du opretter en begivenhed.</p>""",
            phone(i["kalender"], "full"),
            phone(i["booking"], "full"),
            kicker="12",
        ),
        slide(
            "Naboer og din profil",
            """<ul>
<li><b>Beboeroversigt</b>: alle huse og beboere. Søg på et navn eller et husnummer.</li>
<li>Tryk på et navn for at se kontaktoplysninger.</li>
<li>Din egen profil: tryk på dine initialer øverst til højre → <b>Min profil</b> → <b>Rediger profil</b>. Tilføj gerne et billede.</li>
</ul>""",
            phone(i["beboere"]),
            phone(i["profil"], "full"),
            kicker="13",
        ),
        f"""
<section class="slide four">
  <div class="text"><p class="kicker">14</p><h2>Mere i menuen</h2>
  <ul>
  <li><b>Bildeling</b>: lån en delebil.</li>
  <li><b>Udlæg</b>: få penge tilbage for noget, du har købt til fællesskabet.</li>
  <li><b>Indrapportering</b>: meld noget i stykker eller kom med et forslag.</li>
  <li><b>Nyttige links</b>: vedtægter, referater og meget mere.</li>
  </ul></div>
  <div class="shots n4">{phone(i["bildeling"])}{phone(i["udlaeg"])}{phone(i["indrap"])}{phone(i["links"])}</div>
</section>""",
        text_slide(
            "15",
            "De notifikationer, du oftest får",
            """<table>
<tr><th>Notifikation</th><th>Hvornår</th></tr>
<tr><td><b>Dine maddage: …</b></td><td>Når madholdsplanen er lagt</td></tr>
<tr><td><b>Du har madhold i morgen</b></td><td>Aftenen før kl. 20, også til resten af husstanden</td></tr>
<tr><td><b>Der er åbnet for madholdsønsker</b></td><td>Når en ny periode åbner. En påmindelse 1–2 dage før fristen, hvis du mangler</td></tr>
<tr><td><b>Bytteanmodning til madhold</b></td><td>Når en nabo gerne vil bytte maddag med dig</td></tr>
<tr><td><b>Din maddag er overtaget</b></td><td>Når en nabo har taget din maddag</td></tr>
<tr><td><b>Takeaway klar kl. …</b></td><td>Når maden kan hentes før 17:30, hvis I har bestilt Tag med</td></tr>
<tr><td><b>Rester er klar</b></td><td>Når der er rester, hvis I spiser 17:30 eller tager med</td></tr>
<tr><td><b>Nyt i Vigtig post</b></td><td>Når der kommer et opslag, alle bør læse</td></tr>
<tr><td><b>I morgen: …</b></td><td>Dagen før et arrangement</td></tr>
<tr><td><b>Svar og nye tråde</b></td><td>I tråde, du deltager i, og grupper, du følger</td></tr>
</table>
<p class="small">Nye beskeder vises som et tal på kuverten, ikke under klokken. Mere om madhold i den særskilte madholdsguide.</p>
<div class="help"><b>Brug for hjælp?</b> Spørg en nabo, eller skriv i <b>Forum → Fælles</b>.</div>""",
        ),
    ]
    g.page = g.build(slides)
    return g


# --------------------------------------------------------------------------- #
# Madholdsguide: the food-team feature, in depth.
# --------------------------------------------------------------------------- #
def madholdguide() -> Guide:
    g = Guide("madholdguide", "madhold-guide", "Madhold i KB Intra")
    i = {
        "idag": g.put("idag", "mh_idag"),
        "oensker": g.put("oensker", "mh_oensker_full", (560, 2000)),
        "forhindret": g.put("forhindret", "mh_oensker_forhindret_full", (560, 1310)),
        "forhindret_grund": g.put(
            "forhindret_grund", "mh_oensker_forhindret_full", (3190, 3725)
        ),
        "profil": g.put("profil", "mh_profil_full", (560, 1888)),
        "minehold": g.put("minehold", "mh_mine_hold_full", (480, 2072)),
        "alle": g.put("alle", "mh_alle"),
        "swap_specific": g.put("swap_specific", "mh_swap_specific", (0, 1560)),
        "indgaaende": g.put("indgaaende", "mh_indgaaende"),
        "swap_broadcast": g.put("swap_broadcast", "mh_swap_broadcast"),
        "broadcast_in": g.put("broadcast_in", "mh_broadcast_in"),
        "takeover": g.put("takeover", "mh_takeover"),
        "ledger": g.put("ledger", "mh_ledger"),
        "tilmeldinger": g.put("tilmeldinger", "mh_tilmeldinger"),
        "dagens_forside": g.put("dagens_forside", "mh_dagens_forside", (250, 1688)),
        "opskrift": g.put("opskrift", "mh_opskrift", (250, 1020)),
        "takeaway_panel": g.put("takeaway_panel", "mh_takeaway_panel", (330, 1140)),
        "takeaway_sent": g.put("takeaway_sent", "mh_takeaway_sent", (0, 560)),
        "rester_form": g.put("rester_form", "rester_form", (440, 1130)),
        "rester_side": g.put("rester_side", "rester_side", (0, 900)),
        "n_swap": g.put("n_swap", "mh_notifikationer_full", (790, 1535)),
        "n_a": g.put("n_a", "mh_notifikationer_full", (2110, 3450)),
        "n_b": g.put("n_b", "mh_notifikationer_full", (3455, 4620)),
        "notif_mad": g.put("notif_mad", "mh_notif_mad"),
    }
    slides = [
        cover(
            "KB Intra · oktober 2026",
            "Madhold",
            "Dine maddage, bytte, takeaway og rester: sådan gør du i KB Intra.",
            phone(i["idag"], "full"),
        ),
        text_slide(
            "1",
            "Sådan kører en madholdsperiode",
            """<ol class="steps">
<li><b class="n">1</b><span><b>Perioden åbner.</b> Du får besked: <i>Der er åbnet for madholdsønsker</i>.</span></li>
<li><b class="n">2</b><span><b>Indsend ønsker</b> inden fristen. Mangler du, får du en påmindelse 1–2 dage før.</span></li>
<li><b class="n">3</b><span><b>Holdene lægges.</b> Du får besked om dine dage: <i>Dine maddage: …</i></span></li>
<li><b class="n">4</b><span><b>Bliver du forhindret?</b> Byt med en nabo. Det tager et øjeblik.</span></li>
<li><b class="n">5</b><span><b>Aftenen før kl. 20:</b> <i>Du har madhold i morgen</i>. Resten af husstanden får også besked.</span></li>
<li><b class="n">6</b><span><b>Maddagen:</b> en grøn boks på forsiden med holdet, opskrifter og knapper til takeaway og rester.</span></li>
</ol>
<p class="small">Alt om madhold finder du under <b>Madhold</b> i menuen.</p>""",
        ),
        slide(
            "Indsend ønsker",
            """<p><b>Madhold</b> → <b>Indsend ønsker</b>.</p>
<ul>
<li>Sæt flueben ved <b>alle de datoer, du kan</b>. Jo flere, jo lettere er det at lægge gode hold.</li>
<li><b>Dine standard madlavningsdage</b> gemmes og kan bruges næste gang.</li>
<li>Tryk <b>Indsend ønsker</b>. Du kan rette dem frem til fristen.</li>
</ul>
<p class="small">Sender du ingenting, regner vi med dine faste ugedage fra din profil.</p>""",
            phone(i["oensker"]),
            kicker="2",
        ),
        slide(
            "Forhindret i hele perioden?",
            """<p>Madholdet er en fælles opgave, og alle tager deres tur.</p>
<ul>
<li>Du kan melde dig fra en periode, hvis der er en <b>god grund</b>. Slå <b>Jeg er forhindret i hele perioden</b> til.</li>
<li>En god grund kan være sygdom, både fysisk og psykisk, fx stress. Eller en lang rejse.</li>
<li>Skriv kort, <b>hvad grunden er</b>. Madholdsansvarlig læser det.</li>
<li>På barsel? Det gælder i 6 måneder efter en fødsel. Sæt <b>pause</b> på din madhold-profil.</li>
</ul>""",
            phone(i["forhindret"]),
            phone(i["forhindret_grund"]),
            kicker="3",
            cls="dense",
        ),
        slide(
            "Din madhold-profil",
            """<p><b>Madhold</b> → <b>Min profil</b>.</p>
<ul>
<li><b>Chefkok</b> er en, der gerne tager teten i køkkenet: overblik, opgavefordeling og tid. Det bruges til at fordele chefkokkene jævnt på holdene.</li>
<li><b>Medbeboer</b>: I kommer på hold sammen, hvis det kan lade sig gøre.</li>
<li><b>Pause</b>: til længere fravær med en god grund, fx barsel (6 måneder efter en fødsel).</li>
<li><b>Ugedage</b>: de dage, du typisk kan.</li>
</ul>""",
            phone(i["profil"]),
            kicker="4",
            cls="dense",
        ),
        slide(
            "Mine hold og Alle hold",
            """<ul>
<li><b>Mine hold</b>: dine maddage og din husstands. <b>Dig</b> og din husstand står med fed.</li>
<li>Tryk på et navn for at se, hvem det er.</li>
<li><b>Alle hold</b>: hele perioden, dag for dag.</li>
</ul>""",
            phone(i["minehold"]),
            phone(i["alle"], "full"),
            kicker="5",
        ),
        text_slide(
            "6",
            "Bytte: tre muligheder",
            """<div class="three">
<div><h3>Byt med en bestemt nabo</h3>
<p>I har aftalt et bytte, fx over hækken, eller du vil spørge én bestemt.</p>
<p>Den anden trykker <b>Accepter</b>, og så er planen opdateret.</p></div>
<div><h3>Spørg fællesskabet</h3>
<p>Alle, der kan tage din dag og har en dag, du kan tage, får besked.</p>
<p>Den første, der siger ja, bytter med dig.</p></div>
<div><h3>Tag en nabos dag</h3>
<p>Beder en nabo om at blive fri, kan du tage dagen uden at bytte.</p>
<p>Så skylder de dig en tjeneste.</p></div>
</div>
<p class="note">Planen opdateres med det samme, og alle, det drejer sig om, får en notifikation.</p>""",
        ),
        slide(
            "Byt med en bestemt nabo",
            """<ol>
<li><b>Mine hold</b> → <b>Anmod specifik person om bytte</b> ved din dag.</li>
<li>Vælg naboens dato og naboen. Skriv evt. en besked.</li>
<li>Tryk <b>Send anmodning</b>.</li>
</ol>
<p>Naboen får en notifikation og trykker <b>Accepter</b> under <b>Bytte</b>. Har I aftalt byttet på forhånd, er det sådan, I gennemfører det.</p>""",
            phone(i["swap_specific"]),
            phone(i["indgaaende"]),
            kicker="7",
            cls="dense",
        ),
        slide(
            "Spørg fællesskabet",
            """<ol>
<li><b>Mine hold</b> → <b>Anmod fællesskabet om bytte</b>.</li>
<li>Vælg de datoer, du <b>i stedet kan tage</b>.</li>
<li>Tryk <b>Send bytteanmodning</b>.</li>
</ol>
<p>Dem, der kan, ser den under <b>Bytte</b> og vælger, hvilken dag de giver dig. Den første, der accepterer, bytter med dig. Ingen der kan? Tryk <b>Del i Fælles-forum</b>.</p>""",
            phone(i["swap_broadcast"]),
            phone(i["broadcast_in"]),
            kicker="8",
            cls="dense",
        ),
        slide(
            "Tag en dag og tjenester",
            """<ul>
<li>Under en bytteanmodning kan du vælge <b>Eller tag den uden at bytte</b>. Du tager dagen, og naboen skylder dig en tjeneste.</li>
<li><b>Tjeneste-regnskab</b> under <b>Bytte</b> viser, hvem der skylder hvem.</li>
<li><b>Indfri med en maddag</b>: tag en af naboens dage, så er I kvitte.</li>
<li><b>Markér som indfriet</b>, når I er enige om, at tjenesten er betalt.</li>
</ul>
<p class="small">Regnskabet er på ære og tro. Ingen kræver noget af nogen.</p>""",
            phone(i["takeover"]),
            phone(i["ledger"]),
            kicker="9",
            cls="dense",
        ),
        slide(
            "Maddagen: den grønne boks",
            """<p>På din maddag ligger der en <b>grøn boks</b> øverst på forsiden:</p>
<ul>
<li>Hvem der er på holdet.</li>
<li><b>Dagens forside</b> og <b>Dagens opskrifter</b>.</li>
<li><b>Tilmeldinger i dag</b>: hvor mange der spiser 17:30, 18:30 og tager med. Børn tæller halvt.</li>
</ul>""",
            phone(i["idag"], "full"),
            phone(i["tilmeldinger"]),
            kicker="10",
            cls="dense",
        ),
        slide(
            "Dagens forside og opskrifter",
            """<ul>
<li><b>Dagens forside</b>: dagens menu, tilbehør, tips og hvordan der serveres.</li>
<li>Tryk på en <b>ret</b> under Dagens opskrifter for ingredienser og fremgangsmåde.</li>
<li><b>Print / gem som PDF</b>, hvis du vil have den på papir i køkkenet.</li>
<li><b>Åbn dagens opskriftsmappe</b> åbner hele ugens mappe.</li>
</ul>""",
            phone(i["dagens_forside"]),
            phone(i["opskrift"]),
            kicker="11",
            cls="dense",
        ),
        slide(
            "Takeaway er klar",
            """<p>Takeaway hentes normalt <b>kl. 17:30</b>. Send kun en besked, hvis maden er klar <b>før</b>.</p>
<ol>
<li>Tryk <b>Takeaway er klar</b>.</li>
<li>Vælg <b>hvornår</b> den kan hentes: kl. 17:10, 17:15 eller 17:20. Eller <b>Nu</b>. Send den gerne i god tid.</li>
<li>Tryk <b>Send takeaway-besked</b>.</li>
</ol>
<p class="small">Beskeden går ud med det samme til dem, der har bestilt takeaway, og kan kun sendes én gang om dagen.</p>""",
            phone(i["takeaway_panel"]),
            phone(i["takeaway_sent"]),
            kicker="12",
            cls="dense",
        ),
        slide(
            "Rester er klar",
            """<ol>
<li>Tryk <b>Rester er klar</b>.</li>
<li>Skriv, hvad der er tilbage, og tag evt. et billede.</li>
<li>Tryk <b>Send rester-besked</b>.</li>
</ol>
<p>Beskeden går til dem, der har takeaway eller spiste 17:30. 18:30-holdet ser resterne selv. Notifikationen åbner siden <b>Dagens rester</b> med beskeden og billedet.</p>""",
            phone(i["rester_form"]),
            phone(i["rester_side"]),
            kicker="13",
            cls="dense",
        ),
        text_slide(
            "14",
            "Madhold-notifikationer",
            """<table>
<tr><th>Notifikation</th><th>Hvornår</th><th>Til hvem</th><th>Kan slås fra</th></tr>
<tr><td><b>Der er åbnet for madholdsønsker</b></td><td>En ny periode åbner</td><td>Alle, der deltager</td><td>Nej</td></tr>
<tr><td><b>Holder du stadig pause?</b></td><td>En ny periode åbner</td><td>Dem, der holder pause</td><td>Nej</td></tr>
<tr><td><b>Husk dine madholdsønsker</b></td><td>1–2 dage før fristen</td><td>Dem, der mangler at svare</td><td>Nej</td></tr>
<tr><td><b>Dine maddage: …</b></td><td>Holdene er lagt</td><td>Hver kok</td><td>Nej</td></tr>
<tr><td><b>Du har madhold i morgen</b><br><b>… har madhold i morgen</b></td><td>Kl. 20 aftenen før</td><td>Kokken og resten af husstanden</td><td>Ja: Påmindelse om madhold</td></tr>
<tr><td><b>Bytteanmodning til madhold</b></td><td>Nogen vil bytte med dig, eller svarer på dit bytte</td><td>Dem, det drejer sig om</td><td>Ja: Bytteanmodninger</td></tr>
<tr><td><b>Din maddag er overtaget</b></td><td>En nabo har taget din dag</td><td>Dig</td><td>Nej</td></tr>
<tr><td><b>Takeaway klar kl. …</b></td><td>Holdet melder takeaway</td><td>Husstande med Tag med</td><td>Ja: Takeaway er klar</td></tr>
<tr><td><b>Rester er klar</b></td><td>Holdet melder rester</td><td>Tag med og 17:30</td><td>Ja: Rester er klar</td></tr>
</table>
<p class="small">"Nej" betyder, at beskeden altid kommer i appen, og som mail eller push, hvis du har slået mail eller push til for noget som helst. De kommer sjældent og er vigtige.</p>""",
            cls="dense",
        ),
        f"""
<section class="slide">
  <div class="text"><p class="kicker">15</p><h2>Sådan ser de ud, og sådan vælger du</h2>
  <ul>
  <li>Madhold-beskeder har et lille <b>køkken-ikon</b>.</li>
  <li>Tryk på en for at komme direkte til den rigtige side.</li>
  <li>Vælg selv under <b>Notifikationer</b> → <b>Indstillinger</b> → gruppen <b>Mad</b>, for <b>I appen</b>, <b>E-mail</b> og <b>Push</b> hver for sig.</li>
  </ul></div>
  <div class="shots n3"><div class="col">{phone(i["n_swap"])}{phone(i["notif_mad"])}</div>{phone(i["n_a"])}</div>
</section>""",
    ]
    g.page = g.build(slides)
    return g


def render_pdfs(guides: list[Guide]) -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome")
        page = browser.new_page()
        for g in guides:
            page.goto(g.page.as_uri())
            page.wait_for_load_state("networkidle")
            pdf = g.dir / f"{g.filename}.pdf"
            page.pdf(path=str(pdf), prefer_css_page_size=True, print_background=True)
            print("wrote", pdf)
        browser.close()


if __name__ == "__main__":
    render_pdfs([beboerguide(), madholdguide()])
