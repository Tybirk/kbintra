"""
Constants for the car sharing (bildeling) app.

The rate lives in exactly one place so an annual adjustment is a one-line change
rather than an edit to every car. A car's own rate_per_km is only an override.
"""

from decimal import Decimal

# DKK per driven kilometre, used when a car has no rate of its own.
DEFAULT_RATE_PER_KM = Decimal("3.94")

# Bump when LOAN_TERMS changes materially. Stored on each loan so it can always
# be looked up which terms the borrower agreed to.
TERMS_VERSION = "2026-08-01"

# Upper bound on how many owners one request may reach. Without it, "pick
# several cars" is just a broadcast with extra steps.
MAX_CANDIDATES_PER_LOAN = 5

# Guards the availability day-walk and keeps loans reviewable.
MAX_LOAN_DAYS = 30

# A painted week can at worst need one window per day per gap; well above that.
MAX_BLOCKS_PER_CAR = 60

LOAN_TERMS_TITLE = "Vilkår for lån af bil i bilpølen"

# Plain sentences, not Markdown: the UI renders them as a real list, and nothing
# in the app interprets Markdown, so "**bold**" would simply show its asterisks.
LOAN_TERMS_BULLETS = (
    "Du er ansvarlig for bilen, mens du har den. Kør forsigtigt og aflever den i "
    "samme stand, som du fik den.",
    "Sker der skade, eller virker noget ikke, giver du ejeren besked med det samme "
    "— også småting. Udgangspunktet er, at låneren dækker selvrisikoen ved skader "
    "opstået under lånet.",
    "Almindeligt slid og mekanisk svigt, der ikke skyldes lånerens brug, er ejerens.",
    "Bøder, parkerings- og broafgifter betaler du selv.",
    "Du skal have gyldigt kørekort til bilen.",
    "Der ligger en ladebrik i bilen, som virker de fleste steder. Har du haft "
    "udgifter til strøm eller brændstof derudover, skriver du beløbet ind når du "
    "afslutter lånet — det bliver trukket fra din betaling.",
    "Prisen er {rate} kr. pr. kørt km. Du oplyser de faktisk kørte kilometer, når "
    "du afslutter lånet.",
)


def _format_rate(rate: Decimal | None) -> str:
    effective = DEFAULT_RATE_PER_KM if rate is None else rate
    return f"{effective:.2f}".replace(".", ",")


def loan_terms_bullets(rate: Decimal | None = None) -> list[str]:
    """The terms as separate points, with the applicable rate filled in."""
    formatted = _format_rate(rate)
    return [bullet.format(rate=formatted) for bullet in LOAN_TERMS_BULLETS]


def loan_terms_text(rate: Decimal | None = None) -> str:
    """The terms as one plain-text block, for email and for the record."""
    lines = "\n".join(f"- {bullet}" for bullet in loan_terms_bullets(rate))
    return f"{LOAN_TERMS_TITLE}\n\n{lines}"
