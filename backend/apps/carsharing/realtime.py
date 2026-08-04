"""
Live updates for the car sharing pages.

Every state change is pushed to the people it concerns so the page reflects it
without a reload. This is deliberately a bare "something changed" signal rather
than a payload: the client refetches, so there is no second copy of the
serialisation logic to keep in sync, and no risk of a stale push overwriting
fresher data.

Notifications cover only what is worth telling someone; this covers the rest
(a decline, a cancellation you already knew about, another household answering).
"""

import logging
from collections.abc import Iterable

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

logger = logging.getLogger(__name__)


def broadcast_car_sharing_update(user_ids: Iterable[int]) -> None:
    """Tell these users that car sharing data changed."""
    channel_layer = get_channel_layer()
    if channel_layer is None:
        return

    for user_id in {int(user_id) for user_id in user_ids if user_id}:
        try:
            async_to_sync(channel_layer.group_send)(
                f"user_{user_id}",
                {"type": "car_sharing_update"},
            )
        except Exception:
            # A failed live update must never break the request that caused it.
            logger.exception("Failed to push car sharing update to user %s", user_id)


def loan_audience(loan) -> set[int]:
    """Everyone who can see this loan: the borrower and every asked household."""
    from apps.users.models import User

    house_ids = {
        candidate.car.house_id for candidate in loan.candidates.select_related("car").all()
    }
    if loan.car_id:
        house_ids.add(loan.car.house_id)

    audience = {loan.borrower_id}
    if house_ids:
        audience.update(
            User.objects.filter(house_id__in=house_ids, is_active=True).values_list("id", flat=True)
        )
    return audience
