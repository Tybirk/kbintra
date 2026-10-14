"""
Huey background tasks for the Expenses (Udlæg) app.
"""

import logging
import mimetypes
from email.utils import parseaddr

from huey.contrib.djhuey import db_task

logger = logging.getLogger(__name__)

# Fallback raw-bytes budget for receipts if the setting is missing. Cloudflare
# caps a message at 5 MiB (incl. base64, ~+33%); the real limit lives in
# settings.EXPENSE_EMAIL_MAX_ATTACHMENT_BYTES so it can be raised once the
# economy inbox is a verified Cloudflare destination (25 MiB tier).
_DEFAULT_MAX_ATTACH_BYTES = 3_500_000

# Intro line per notification action (created / edited / deleted).
_ACTION_INTRO = {
    "created": "Der er oprettet et nyt udlæg på KB Intra.",
    "edited": "Et udlæg er blevet rettet på KB Intra.",
    "deleted": "Et udlæg er blevet slettet på KB Intra.",
}


@db_task(retries=3, retry_delay=60)
def send_expense_notification_task(action: str, fields: dict) -> None:
    """Notify whoever settles an udlæg about an event (created/edited/deleted).

    ``fields`` is a snapshot of serializable primitives (built by
    ``apps.expenses.views._expense_email_fields``) rather than a model instance,
    so the ``deleted`` notice still has its data after the row is gone.

    Ordinary udlæg go to ``settings.ECONOMY_EMAIL`` (the treasurer). Udlæg
    flagged ``food_related`` (i forbindelse med fællesmad) go to the
    madøkonomiansvarlig instead: ``settings.FOOD_ECONOMY_EMAIL`` if set, else
    every active user with ``is_food_economy_admin``. With no recipient the
    notice is skipped (e.g. in dev).

    All mails about one udlæg are threaded together: we can neither set nor read
    the real Message-ID (Cloudflare generates it), so we (a) keep the subject
    identical per expense and (b) put a synthetic shared id in References /
    In-Reply-To, which jwz-style clients (Apple Mail, Thunderbird) group on.
    """
    from django.conf import settings

    expense_id = fields.get("id")
    # ``route_food_related`` lets a caller address the other inbox than the
    # expense's current flag would (used when the flag is flipped on edit).
    food_related = bool(fields.get("route_food_related", fields.get("food_related")))
    recipients = _food_economy_recipients() if food_related else _economy_recipients()
    if not recipients:
        logger.info(
            "No recipient for udlæg notice (expense=%s food_related=%s) — skipping",
            expense_id,
            food_related,
        )
        return

    from django.core.mail import EmailMultiAlternatives

    who = fields.get("who") or "Ukendt"
    amount = fields.get("amount", "")
    food_line = "Ja" if fields.get("food_related") else "Nej"
    site_url = getattr(settings, "SITE_URL", "http://localhost:5173")

    # The test site (kbintra.top) shares prod's data and economy inbox, so flag
    # its mails with TEST: in the subject to avoid mistaking them for real udlæg.
    test_prefix = "TEST: " if "kbintra.top" in site_url else ""

    # The body is a list of blocks rendered twice: as plain text and as HTML with
    # bold labels, which the treasurer asked for to skim the mail faster.
    #   ("text", paragraph) | ("fields", [(label, value), ...])
    #   | ("section", label, text) | ("link", label, url)
    blocks: list[tuple] = [
        ("text", _ACTION_INTRO.get(action, "Der er en opdatering på et udlæg på KB Intra.")),
        (
            "fields",
            [
                ("Udlæg nr.", str(expense_id)),
                ("Beboer", who),
                ("Beløb", f"{amount} kr."),
                ("Reg. nr.", fields.get("reg_nr", "")),
                ("Kontonummer", fields.get("account_number", "")),
                ("Vedrører fællesmad", food_line),
            ],
        ),
        ("section", "Beskrivelse", fields.get("description", "")),
    ]
    approval = (fields.get("approval_reference") or "").strip()
    if approval:
        blocks.append(("section", "Skriftlig godkendelse", approval))

    # Attach the receipts for created/edited so the treasurer can act straight
    # from the mail. Skipped for deleted (the files are gone). Anything over the
    # size budget is left out — the in-app link still has it.
    specs = [] if action == "deleted" else (fields.get("attachments") or [])
    # Only the configured inboxes are verified Cloudflare destinations (25 MiB
    # tier); a madøkonomiansvarlig's own address gets the 5 MiB default budget.
    budget = (
        getattr(settings, "EXPENSE_EMAIL_MAX_ATTACHMENT_BYTES", _DEFAULT_MAX_ATTACH_BYTES)
        if not food_related or getattr(settings, "FOOD_ECONOMY_EMAIL", "")
        else _DEFAULT_MAX_ATTACH_BYTES
    )
    attached, omitted, combined = _build_email_attachments(expense_id, specs, budget)
    if combined:
        blocks.append(
            (
                "text",
                "Bilagene er vedhæftet både som én samlet PDF, som regnskabsprogrammet "
                "kan tage (det tager kun ét bilag pr. udlæg), og som de oprindelige filer.",
            )
        )
    if omitted:
        blocks.append(
            (
                "text",
                "Bemærk: en eller flere af de oprindelige filer var for store til at "
                "vedhæfte enkeltvis — brug den samlede PDF eller se dem i appen."
                if combined
                else "Bemærk: et eller flere bilag var for store til at vedhæfte — se dem i appen.",
            )
        )
    if action == "deleted":
        blocks.append(("text", "Udlægget er slettet og kan ikke længere ses i systemet."))
    else:
        blocks.append(("link", "Se og behandl udlægget her:", f"{site_url}/udlaeg"))

    # Synthetic thread id — the same value for every mail about this expense. The
    # domain matches the sender so it reads as a normal Message-ID token.
    _, from_addr = parseaddr(settings.DEFAULT_FROM_EMAIL)
    from_domain = (from_addr.split("@")[-1] if "@" in from_addr else "") or "kbintra.local"
    thread_id = f"<udlaeg-{expense_id}@{from_domain}>"
    headers = {"References": thread_id}
    if action != "created":
        headers["In-Reply-To"] = thread_id

    msg = EmailMultiAlternatives(
        subject=f"{test_prefix}[Udlæg #{expense_id}] Udlæg fra {who}",
        body=_render_text(blocks),
        to=recipients,
        from_email=settings.DEFAULT_FROM_EMAIL,
        headers=headers,
    )
    msg.attach_alternative(_render_html(blocks), "text/html")
    for name, content, mimetype in attached:
        msg.attach(name, content, mimetype)
    msg.send()
    logger.info(
        "send_expense_notification_task COMPLETED: expense=%s action=%s attachments=%d",
        expense_id,
        action,
        len(attached),
    )


def _render_text(blocks: list[tuple]) -> str:
    """Plain-text body, one paragraph per block."""
    paragraphs: list[str] = []
    for kind, *rest in blocks:
        if kind == "fields":
            paragraphs.append("".join(f"{label}: {value}\n" for label, value in rest[0]))
        elif kind == "section":
            label, text = rest
            paragraphs.append(f"{label}:\n{text}\n")
        elif kind == "link":
            label, url = rest
            paragraphs.append(f"{label} {url}\n")
        else:
            paragraphs.append(f"{rest[0]}\n")
    return "\n".join(paragraphs)


def _render_html(blocks: list[tuple]) -> str:
    """HTML body with the labels in bold. Every value is escaped: it is user input."""
    from django.utils.html import escape

    paragraphs: list[str] = []
    for kind, *rest in blocks:
        if kind == "fields":
            inner = "<br>".join(
                f"<strong>{escape(label)}:</strong> {escape(value)}" for label, value in rest[0]
            )
        elif kind == "section":
            label, text = rest
            lines = "<br>".join(escape(line) for line in text.splitlines())
            inner = f"<strong>{escape(label)}:</strong><br>{lines}"
        elif kind == "link":
            label, url = rest
            inner = f'{escape(label)} <a href="{escape(url)}">{escape(url)}</a>'
        else:
            inner = escape(rest[0])
        paragraphs.append(f"<p>{inner}</p>")
    body = "\n".join(paragraphs)
    return f'<html><body style="font-family: sans-serif; font-size: 14px;">\n{body}\n</body></html>'


def _economy_recipients() -> list[str]:
    """The treasurer's inbox, if configured."""
    from django.conf import settings

    economy_email = getattr(settings, "ECONOMY_EMAIL", "")
    return [economy_email] if economy_email else []


def _food_economy_recipients() -> list[str]:
    """The fixed madøkonomi inbox if configured, else the role holders' addresses."""
    from django.conf import settings

    override = getattr(settings, "FOOD_ECONOMY_EMAIL", "")
    if override:
        return [override]

    from apps.users.models import User

    return list(
        User.objects.filter(is_food_economy_admin=True, is_active=True)
        .exclude(email="")
        .order_by("email")
        .values_list("email", flat=True)
    )


def _build_email_attachments(expense_id, specs: list, budget: int) -> tuple[list, bool, bool]:
    """Read the bilag and decide what to hang on the mail.

    With several bilag the mail carries both: one merged PDF first — the
    treasurer's accounting program accepts a single attachment per udlæg, so
    that is the one they file — followed by the original files, which stay
    useful for anything else. The merge is best-effort: if it raises or does not
    fit the mail's size budget, the mail simply goes out with the original files
    (never without bilag).

    Returns ``(attached, omitted, combined)``.
    """
    # Read every bilag once; both the merge and the individual attachments use it.
    parts = [
        (spec.get("name") or "bilag", _read_receipt(expense_id, spec.get("path")))
        for spec in specs
        if spec.get("path")
    ]

    combined = None
    if len(parts) > 1:
        merged = _merge_parts(expense_id, parts)
        # The merged PDF is served first and takes its share of the budget: it
        # is the one the treasurer needs, the originals are the extra.
        if merged is not None and len(merged) <= budget:
            from .pdf import combined_pdf_name

            combined = (combined_pdf_name(expense_id), merged, "application/pdf")
            budget -= len(merged)

    attached, omitted = _fit_within_budget(parts, budget)
    if combined:
        return [combined, *attached], omitted, True
    return attached, omitted, False


def _merge_parts(expense_id, parts: list) -> bytes | None:
    """Merge the bilag into one PDF, or None if that fails for any reason.

    Deliberately catch-all: a single odd receipt must never cost the treasurer
    the whole notification, so a failed merge just falls back to the originals.
    """
    try:
        from .pdf import build_combined_pdf

        merged = build_combined_pdf(parts)
    except Exception:
        logger.warning("Could not merge bilag for expense %s", expense_id, exc_info=True)
        return None
    return merged or None


def _fit_within_budget(parts: list, budget: int) -> tuple[list, bool]:
    """Turn read bilag into mail attachments, dropping what exceeds *budget*.

    Returns ``(attached, omitted)`` where *attached* is a list of
    ``(filename, bytes, mimetype)`` tuples and *omitted* flags that at least one
    bilag was left out (too large or missing from storage).
    """
    attached: list = []
    omitted = False
    for name, content in parts:
        if content is None or len(content) > budget:
            omitted = True
            continue
        budget -= len(content)
        mimetype = mimetypes.guess_type(name)[0] or "application/octet-stream"
        attached.append((name, content, mimetype))
    return attached, omitted


def _read_receipt(expense_id, path: str | None) -> bytes | None:
    """Read one receipt from storage, or None if it is missing."""
    from django.core.files.storage import default_storage

    if not path:
        return None
    try:
        with default_storage.open(path, "rb") as fh:
            return fh.read()
    except (FileNotFoundError, OSError):
        logger.warning("Receipt missing for expense %s: %s", expense_id, path)
        return None
