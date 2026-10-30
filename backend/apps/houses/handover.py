"""Carrying out a handover (houses.Handover), one dated step at a time.

Each step stamps the handover when it is done, so ``process_handover`` can run any
number of times. The admin view runs it straight after saving, which makes a date
that has already come happen at once, and ``tasks.process_due_handovers`` runs it
hourly for the dates still ahead.
"""

from __future__ import annotations

import calendar
import logging
from datetime import date, timedelta
from typing import TYPE_CHECKING

from django.conf import settings
from django.db import transaction
from django.utils import timezone

if TYPE_CHECKING:
    from apps.users.models import Invitation, User

    from .models import Handover

logger = logging.getLogger(__name__)

# An invitation is good for this long from the day it is mailed, not from the day
# the admin typed it in: a handover may be registered weeks ahead.
INVITATION_VALID_DAYS = 14


def one_month_after(day: date) -> date:
    """The same day next month, or that month's last day when it is shorter
    (31/1 gives 28/2)."""
    year, month = (day.year + 1, 1) if day.month == 12 else (day.year, day.month + 1)
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, min(day.day, last_day))


def new_resident_pause(handover: Handover, today: date) -> tuple[date, str] | None:
    """The madhold pause a resident who moves in with this handover starts with:
    the first month from the handover day. None once that month is over."""
    until = one_month_after(handover.handover_date)
    if until <= today:
        return None
    return until, (
        f"Ny beboer: holder pause fra madhold den første måned, til {until.day}/{until.month}"
    )


def leaving_dates() -> dict[int, date]:
    """Residents who are moving out but haven't yet, by the day they go.

    The madhold generator plans nobody on or after the day they move.
    """
    from .models import Handover

    rows = Handover.objects.filter(moved_out_at__isnull=True).values_list(
        "outgoing", "handover_date"
    )
    return {user_id: day for user_id, day in rows if user_id is not None}


def process_handover(handover_id: int, today: date | None = None) -> None:
    """Run every step of the handover whose date has come and that hasn't run yet."""
    from .models import Handover

    today = today or timezone.localdate()
    handover = Handover.objects.select_related("house").get(pk=handover_id)

    if handover.invite_on <= today:
        # The new household arrives to an empty house: reset first, then invite.
        if (
            handover.reset_household
            and handover.household_reset_at is None
            and handover.invitations.exists()
        ):
            reset_household(handover, today)
        send_due_invitations(handover, today)

    if handover.handover_date <= today:
        if handover.moved_out_at is None:
            move_out(handover, today)
        # Nobody was invited, so the reset waited for the day itself.
        handover.refresh_from_db(fields=["reset_household", "household_reset_at"])
        if handover.reset_household and handover.household_reset_at is None:
            reset_household(handover, today)

    if (
        handover.access_until < today
        and handover.moved_out_at is not None
        and handover.access_ended_at is None
    ):
        end_access(handover)


def _other_residents(handover: Handover) -> list[User]:
    """Residents of the house who are neither moving out nor moving in with this
    handover: a household reset would take their children and cars."""
    invited = {email.lower() for email in handover.invitations.values_list("email", flat=True)}
    staying = handover.house.inhabitants.filter(is_active=True).exclude(
        pk__in=handover.outgoing.values("pk")
    )
    return [user for user in staying if user.email.lower() not in invited]


def reset_household(handover: Handover, today: date) -> None:
    """Clear what belonged to the old household, so the new one starts from scratch.

    Children, cars, the house's description and picture, meal preferences, and the
    meal registrations from the handover day on that can still be changed. A car
    with loan history can't be deleted (the loans keep it), so it is only taken
    out of the delebilpark and logged.
    """
    from apps.food.models import MealPreference, MealRegistration
    from apps.food.serializers import is_after_deadline

    house = handover.house
    others = _other_residents(handover)
    if others:
        # Someone else lives here now. Wiping their children is not what the admin
        # asked for, so the reset is called off and the handover says so.
        logger.warning(
            "Handover %s: not resetting %s, %d other resident(s) live there",
            handover.pk,
            house,
            len(others),
        )
        type(handover).objects.filter(pk=handover.pk).update(reset_household=False)
        return

    with transaction.atomic():
        for child in house.children.all():
            child.delete()
        for car in house.cars.all():
            if car.loans.exists():
                logger.warning(
                    "Handover %s: car %s has loans and was kept, unshared", handover.pk, car.pk
                )
                car.is_shared = False
                car.save(update_fields=["is_shared"])
            else:
                car.delete()

        if house.profile_picture:
            house.profile_picture.delete(save=False)
        if house.profile_picture_thumbnail:
            house.profile_picture_thumbnail.delete(save=False)
        house.description = ""
        house.save(update_fields=["description", "profile_picture", "profile_picture_thumbnail"])

        MealPreference.objects.filter(house=house).delete()
        upcoming = MealRegistration.objects.filter(
            house=house, date__gte=max(handover.handover_date, today)
        )
        open_ids = [reg.pk for reg in upcoming if not is_after_deadline(reg.date)]
        MealRegistration.objects.filter(pk__in=open_ids).delete()

        handover.household_reset_at = timezone.now()
        handover.save(update_fields=["household_reset_at"])
    logger.info("Handover %s: reset the household of %s", handover.pk, house)


def send_due_invitations(handover: Handover, today: date) -> None:
    """Mail every invitation of the handover that is due and hasn't gone out."""
    due = handover.invitations.filter(
        sent_at__isnull=True, used_at__isnull=True, send_on__lte=today
    )
    for invitation in due:
        mark_sent_and_mail(invitation)


def mark_sent_and_mail(invitation: Invitation) -> None:
    """Stamp the invitation as sent, restart its validity, and queue the mail.

    Stamped before the mail is sent: a mail that fails after its retries leaves an
    invitation marked sent, and the admin page offers "Send igen" for that.
    """
    from .tasks import send_invitation_email_task

    invitation.sent_at = timezone.now()
    invitation.expires_at = invitation.sent_at + timedelta(days=INVITATION_VALID_DAYS)
    invitation.save(update_fields=["sent_at", "expires_at"])
    transaction.on_commit(lambda: send_invitation_email_task(invitation.pk))


def move_out(handover: Handover, today: date) -> None:
    """The outgoing residents lose their house: from now on they are moved out.

    Their maddage after today are dropped, so the 20:00 reminder doesn't send them
    to a kitchen they no longer live by. Today's team is left alone: a cook who
    moves today has already been reminded and may well cook first. Someone the
    admin has already put in another house is moving within the community and is
    left where they are.
    """
    from apps.food.models import FoodTeamMember

    first_dropped = max(handover.handover_date, today + timedelta(days=1))
    with transaction.atomic():
        for user in handover.outgoing.filter(house=handover.house):
            user.house = None
            user.moved_out_on = handover.handover_date
            user.save(update_fields=["house", "moved_out_on"])
            dropped, _ = FoodTeamMember.objects.filter(
                user=user, team__date__gte=first_dropped
            ).delete()
            if dropped:
                logger.info("Handover %s: took user %s off upcoming teams", handover.pk, user.pk)
        handover.moved_out_at = timezone.now()
        handover.save(update_fields=["moved_out_at"])
    logger.info("Handover %s: moved out of %s", handover.pk, handover.house)


def end_access(handover: Handover) -> None:
    """Deactivate the outgoing residents' accounts. Their posts, messages and
    history stay; deleting the account is left to a person."""
    with transaction.atomic():
        for user in handover.outgoing.filter(
            moved_out_on__isnull=False, house__isnull=True, is_active=True
        ):
            user.is_active = False
            user.save(update_fields=["is_active"])
        handover.access_ended_at = timezone.now()
        handover.save(update_fields=["access_ended_at"])
    logger.info("Handover %s: ended access for the outgoing residents", handover.pk)


def register_url(invitation: Invitation) -> str:
    return f"{settings.SITE_URL}/register?token={invitation.token}"


def invitation_email(first_name: str, url: str) -> tuple[str, str]:
    """Subject and body of the mail a new resident gets: the link, and what to do
    once they are in."""
    site = settings.SITE_URL
    greeting = f"Hej {first_name}," if first_name else "Hej,"
    subject = "Velkommen til Kløverbakken – din invitation til KB Intra"
    body = f"""{greeting}

Velkommen til Kløverbakken! Du er inviteret til KB Intra, fællesskabets intranet
med forum, madtilmelding, madhold, kalender, booking og beskeder.

Opret din bruger her (linket virker i {INVITATION_VALID_DAYS} dage):
{url}

Når du er oprettet, er her et par ting, du med fordel kan gøre:

1. Installer KB Intra som app på din telefon
   Står der "Installer som app" nederst på skærmen, så tryk på den. Ellers:
   - Android (Chrome anbefalet): tryk på de tre prikker i browserens menu,
     og vælg "Føj til startskærm".
   - iPhone (Safari anbefalet): tryk på de tre prikker i browserens menu,
     vælg "Del", så "Mere", så "Føj til startskærm".

2. Slå notifikationer til
   Slå email og/eller push til, og vælg, hvad du vil have besked om:
   {site}/notifikationer/indstillinger

3. Tjek husets madpræferencer
   Madtilmelding sker per hus. Ret standarden til det, I faktisk spiser:
   {site}/mad/praeferencer

4. Udfyld dit hus
   Tilføj gerne bil(er), så andre kan finde jer, hvis lyset er tændt eller
   vinduet står åbent. Tilføj også børn, hvis I har lyst:
   {site}/hus/rediger

5. Vælg dine grupper i forummet
   Abonnér på de grupper, du vil følge, og bliv medlem af dem, du er med i
   (fx et udvalg):
   {site}/forum

6. Udfyld din profil med billede og fødselsdag:
   {site}/profil/rediger

Du holder pause fra madhold den første måned, så du kan nå at falde til.

Kig dig omkring! Oplever du problemer, så lav en tråd i gruppen
"Intra fejl og mangler": {site}/forum/bugs

Med venlig hilsen,
KB Intra
"""
    return subject, body
