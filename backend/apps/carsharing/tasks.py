"""
Periodic upkeep for bildeling: requests and loans the app should stop waiting for.

Nothing here decides anything a person could still decide. A request is closed
only once its window has passed, and a loan only after its borrower was reminded
and two weeks went by. Each step changes state with a conditional update, so an
owner's yes or a borrower's "Afslut lån" in the same moment wins cleanly.
"""

import logging

from huey.contrib.djhuey import db_periodic_task

from config.scheduling import local_crontab

logger = logging.getLogger(__name__)


@db_periodic_task(local_crontab(hour="10", minute="0"))
def tidy_car_loans() -> None:
    """Every morning: close what has run out, and remind borrowers who forgot.

    In the morning so nothing arrives in the night, and so the reminder lands the
    morning after the trip. A missed run is caught up by the next one: every step
    looks at what is overdue, not at what fell due in the last day.
    """
    from django.utils import timezone

    from apps.carsharing.realtime import broadcast_car_sharing_update, loan_audience
    from apps.carsharing.services import (
        close_unfinished_loans,
        expire_unanswered_requests,
        remind_unfinished_loans,
    )
    from apps.notifications.services import (
        close_car_request_notifications,
        notify_car_loan_closed_unfinished,
        notify_car_loan_completion_reminder,
    )

    now = timezone.now()

    # Closing goes first, so a loan that is long overdue on the first run is
    # closed once rather than reminded and closed in the same breath.
    for loan in close_unfinished_loans(now):
        logger.info("Closing unfinished car loan %d", loan.id)
        notify_car_loan_closed_unfinished(loan)
        broadcast_car_sharing_update(loan_audience(loan))

    for loan in remind_unfinished_loans(now):
        logger.info("Reminding borrower to finish car loan %d", loan.id)
        notify_car_loan_completion_reminder(loan)

    # No notification: the borrower knows the time has passed. What matters is
    # that the asked households stop holding an unread question.
    for loan in expire_unanswered_requests(now):
        logger.info("Expiring unanswered car loan request %d", loan.id)
        close_car_request_notifications(loan)
        broadcast_car_sharing_update(loan_audience(loan))
