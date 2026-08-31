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
    """Notify the economy inbox about an udlæg event (created/edited/deleted).

    ``fields`` is a snapshot of serializable primitives (built by
    ``apps.expenses.views._expense_email_fields``) rather than a model instance,
    so the ``deleted`` notice still has its data after the row is gone.

    Sent to ``settings.ECONOMY_EMAIL``; if that is unset the notice is skipped
    (e.g. in dev). Udlæg flagged ``food_related`` (i forbindelse med fællesmad)
    are handled by the food admins in-app, so no economy notice is sent.

    All mails about one udlæg are threaded together: we can neither set nor read
    the real Message-ID (Cloudflare generates it), so we (a) keep the subject
    identical per expense and (b) put a synthetic shared id in References /
    In-Reply-To, which jwz-style clients (Apple Mail, Thunderbird) group on.
    """
    from django.conf import settings

    economy_email = getattr(settings, "ECONOMY_EMAIL", "")
    if not economy_email:
        logger.info("ECONOMY_EMAIL not configured — skipping udlæg notice")
        return

    expense_id = fields.get("id")
    if fields.get("food_related"):
        logger.info("Expense %s is food_related — skipping economy notice", expense_id)
        return

    from django.core.mail import EmailMessage

    who = fields.get("who") or "Ukendt"
    amount = fields.get("amount", "")
    food_line = "Ja" if fields.get("food_related") else "Nej"
    site_url = getattr(settings, "SITE_URL", "http://localhost:5173")

    # The test site (kbintra.top) shares prod's data and economy inbox, so flag
    # its mails with TEST: in the subject to avoid mistaking them for real udlæg.
    test_prefix = "TEST: " if "kbintra.top" in site_url else ""

    intro = _ACTION_INTRO.get(action, "Der er en opdatering på et udlæg på KB Intra.")
    body = f"""{intro}

Beboer: {who}
Beløb: {amount} kr.
Reg. nr.: {fields.get("reg_nr", "")}
Kontonummer: {fields.get("account_number", "")}
Vedrører fællesmad: {food_line}

Beskrivelse:
{fields.get("description", "")}
"""
    approval = (fields.get("approval_reference") or "").strip()
    if approval:
        body += f"\nSkriftlig godkendelse:\n{approval}\n"

    # Attach the receipts for created/edited so the treasurer can act straight
    # from the mail. Skipped for deleted (the files are gone). Anything over the
    # size budget is left out — the in-app link still has it.
    specs = [] if action == "deleted" else (fields.get("attachments") or [])
    attached, omitted, combined = _build_email_attachments(expense_id, specs)
    if combined:
        body += (
            "\nBilagene er vedhæftet både som én samlet PDF, som regnskabsprogrammet "
            "kan tage (det tager kun ét bilag pr. udlæg), og som de oprindelige filer.\n"
        )
    if omitted:
        body += (
            "\nBemærk: en eller flere af de oprindelige filer var for store til at "
            "vedhæfte enkeltvis — brug den samlede PDF eller se dem i appen.\n"
            if combined
            else "\nBemærk: et eller flere bilag var for store til at vedhæfte — se dem i appen.\n"
        )
    if action == "deleted":
        body += "\nUdlægget er slettet og kan ikke længere ses i systemet.\n"
    else:
        body += f"\nSe og behandl udlægget her: {site_url}/udlaeg\n"

    # Synthetic thread id — the same value for every mail about this expense. The
    # domain matches the sender so it reads as a normal Message-ID token.
    _, from_addr = parseaddr(settings.DEFAULT_FROM_EMAIL)
    from_domain = (from_addr.split("@")[-1] if "@" in from_addr else "") or "kbintra.local"
    thread_id = f"<udlaeg-{expense_id}@{from_domain}>"
    headers = {"References": thread_id}
    if action != "created":
        headers["In-Reply-To"] = thread_id

    msg = EmailMessage(
        subject=f"{test_prefix}[Udlæg #{expense_id}] Udlæg fra {who}",
        body=body,
        to=[economy_email],
        from_email=settings.DEFAULT_FROM_EMAIL,
        headers=headers,
    )
    for name, content, mimetype in attached:
        msg.attach(name, content, mimetype)
    msg.send()
    logger.info(
        "send_expense_notification_task COMPLETED: expense=%s action=%s attachments=%d",
        expense_id,
        action,
        len(attached),
    )


def _build_email_attachments(expense_id, specs: list) -> tuple[list, bool, bool]:
    """Read the bilag and decide what to hang on the mail.

    With several bilag the mail carries both: one merged PDF first — the
    treasurer's accounting program accepts a single attachment per udlæg, so
    that is the one they file — followed by the original files, which stay
    useful for anything else. The merge is best-effort: if it raises or does not
    fit the mail's size budget, the mail simply goes out with the original files
    (never without bilag).

    Returns ``(attached, omitted, combined)``.
    """
    from django.conf import settings

    budget = getattr(settings, "EXPENSE_EMAIL_MAX_ATTACHMENT_BYTES", _DEFAULT_MAX_ATTACH_BYTES)
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
