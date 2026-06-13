"""
Huey background tasks for the Expenses (Udlæg) app.
"""

import logging

from huey.contrib.djhuey import db_task

logger = logging.getLogger(__name__)


@db_task(retries=3, retry_delay=60)
def send_expense_created_email_task(expense_id: int) -> None:
    """Notify the economy inbox that a new udlæg has been submitted.

    Sent to ``settings.ECONOMY_EMAIL``. If that is not configured the notice is
    skipped (e.g. in dev). Bank details are included so the treasurer can act
    straight from the email; the link points back to the admin overview.
    """
    from django.conf import settings

    economy_email = getattr(settings, "ECONOMY_EMAIL", "")
    if not economy_email:
        logger.info("ECONOMY_EMAIL not configured — skipping new-udlæg notice")
        return

    from django.core.mail import EmailMessage

    from .models import Expense

    try:
        expense = Expense.objects.select_related("submitted_by").get(id=expense_id)
    except Expense.DoesNotExist:
        logger.warning("send_expense_created_email_task: Expense %d not found", expense_id)
        return

    who = expense.submitted_by.get_full_name() if expense.submitted_by else "Ukendt"
    amount = f"{expense.amount:.2f}".replace(".", ",")
    site_url = getattr(settings, "SITE_URL", "http://localhost:5173")
    food_line = "Ja" if expense.food_related else "Nej"

    body = f"""Der er oprettet et nyt udlæg på KB Intra.

Beboer: {who}
Beløb: {amount} kr.
Reg. nr.: {expense.reg_nr}
Kontonummer: {expense.account_number}
Vedrører fællesmad: {food_line}

Beskrivelse:
{expense.description}
"""
    if expense.approval_reference.strip():
        body += f"\nSkriftlig godkendelse:\n{expense.approval_reference}\n"
    body += f"\nSe og behandl udlægget her: {site_url}/udlaeg\n"

    EmailMessage(
        subject=f"[Udlæg] Nyt udlæg fra {who} – {amount} kr.",
        body=body,
        to=[economy_email],
        from_email=settings.DEFAULT_FROM_EMAIL,
    ).send()
    logger.info("send_expense_created_email_task COMPLETED: expense=%d", expense_id)
