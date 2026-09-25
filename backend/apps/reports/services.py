"""
Domain operations for Indrapportering.

Kept out of the views so that number allocation, the log entry and the
notification fan-out happen identically whether a case arrives through the API
or through the import command.
"""

from __future__ import annotations

from typing import Any

from django.db import IntegrityError, transaction
from django.db.models import Max, Q, QuerySet
from django.utils import timezone

from .models import Report, ReportCounter, ReportEvent, ReportPhoto

# How many times to retry when two submissions race for the same case number.
_NUMBER_RETRIES = 5


def _high_water_mark(subgroup_id: int) -> int:
    """Highest number ever used by an udvalg, as far as we can tell.

    The counter is authoritative, but it seeds itself from the existing rows the
    first time it is read — so udvalg whose cases were imported before the
    counter existed carry on from the right place with no data migration.
    """
    counter = ReportCounter.objects.filter(subgroup_id=subgroup_id).first()
    from_rows = Report.objects.filter(subgroup_id=subgroup_id).aggregate(n=Max("number"))["n"] or 0
    return max(counter.last_number if counter else 0, from_rows)


def next_number(subgroup_id: int) -> int:
    """What the next case in this udvalg will be numbered. Does not allocate."""
    return _high_water_mark(subgroup_id) + 1


def allocate_number(subgroup_id: int) -> int:
    """Take the next case number for an udvalg, and never give it out again.

    Deliberately not ``max(number) + 1``: deleting the newest case would then
    hand its number to the next one, silently repointing any notification link
    that still refers to it.
    """
    counter, _ = ReportCounter.objects.get_or_create(subgroup_id=subgroup_id)
    counter.last_number = _high_water_mark(subgroup_id) + 1
    counter.save(update_fields=["last_number"])
    return counter.last_number


def reporting_subgroups() -> QuerySet:
    """Udvalg that accept reports, in display order.

    Closed udvalg are included: anyone may *file* a case to Bestyrelsen, it is
    only the queue that is theirs to read.
    """
    from apps.forum.models import Subgroup

    return Subgroup.objects.exclude(reporting=Subgroup.Reporting.OFF).order_by("name")


def readable_reports_q(user: Any) -> Q:
    """Which cases *user* may read, as a filter to apply to Report.

    An open udvalg's queue is everybody's — that was the point of moving this in
    from Driftsudvalgets standalone app. Otherwise (closed, or reporting since
    switched off) it is the udvalg's own members, staff, and the reporter of the
    individual case: someone who reports something to a closed udvalg must still
    be able to follow their own case and open the link in their notification.

    Deliberately the same shape as the forum's members-only rule — "member of
    the subgroup, or you wrote it" (``apps.search.views.apply_visibility_filters``)
    — so this is not a second access-control concept to keep in your head.
    """
    from apps.forum.models import Subgroup, SubgroupMembership

    if user and user.is_authenticated and user.is_staff:
        return Q()

    everyones = Q(subgroup__reporting=Subgroup.Reporting.OPEN)
    if not (user and user.is_authenticated):
        return everyones

    return (
        everyones
        | Q(subgroup_id__in=SubgroupMembership.objects.filter(user=user).values("subgroup_id"))
        | Q(submitted_by=user)
    )


def committee_member_ids(subgroup_id: int) -> list[int]:
    """User ids of the udvalg's members — the people who work its queue."""
    from apps.forum.models import SubgroupMembership

    return list(
        SubgroupMembership.objects.filter(subgroup_id=subgroup_id).values_list("user_id", flat=True)
    )


def is_caseworker(user: Any, report: Report) -> bool:
    """Whether *user* may move *report* through its statuses.

    The udvalg's own members handle their cases; staff can step in anywhere.
    """
    if not (user and user.is_authenticated):
        return False
    if user.is_staff:
        return True
    from apps.forum.models import SubgroupMembership

    return SubgroupMembership.objects.filter(
        subgroup_id=report.subgroup_id, user_id=user.id
    ).exists()


def add_photo(report: Report, upload: Any) -> ReportPhoto:
    """Attach an uploaded image and queue its thumbnail."""
    photo = ReportPhoto.objects.create(report=report, image=upload, name=upload.name)
    from .tasks import generate_report_photo_thumbnail_task

    generate_report_photo_thumbnail_task(photo.id)
    return photo


def _create_with_number(
    *,
    subgroup: Any,
    kind: str,
    description: str,
    location: str,
    submitted_by: Any,
    status: str,
    legacy_reporter_name: str,
    legacy_url: str,
) -> Report:
    """Insert the row, allocating the per-udvalg number.

    SQLite gives us no useful row lock to hold across read-then-insert, so the
    unique constraint is the real guard: on the rare collision from two
    simultaneous submissions we simply take the next number. With ~90 residents
    this loop is belt-and-braces, not a hot path.
    """
    last_error: Exception | None = None
    for _ in range(_NUMBER_RETRIES):
        try:
            with transaction.atomic():
                return Report.objects.create(
                    subgroup=subgroup,
                    number=allocate_number(subgroup.id),
                    kind=kind,
                    description=description,
                    location=location,
                    submitted_by=submitted_by,
                    status=status,
                    legacy_reporter_name=legacy_reporter_name,
                    legacy_url=legacy_url,
                )
        except IntegrityError as exc:  # number taken between read and insert
            last_error = exc
    raise last_error if last_error else RuntimeError("Kunne ikke tildele sagsnummer.")


def create_report(
    *,
    subgroup: Any,
    kind: str,
    description: str,
    location: str = "",
    submitted_by: Any = None,
    photos: Any = (),
    status: str = Report.Status.NEW,
    legacy_reporter_name: str = "",
    legacy_url: str = "",
    notify: bool = True,
) -> Report:
    """Create a report with its opening log entry, photos and notification."""
    report = _create_with_number(
        subgroup=subgroup,
        kind=kind,
        description=description,
        location=location,
        submitted_by=submitted_by,
        status=status,
        legacy_reporter_name=legacy_reporter_name,
        legacy_url=legacy_url,
    )
    ReportEvent.objects.create(
        report=report,
        kind=ReportEvent.Kind.CREATED,
        author=submitted_by,
    )
    for upload in photos:
        add_photo(report, upload)

    if notify:
        from apps.notifications.services import notify_new_report

        notify_new_report(report)
    return report


def add_event(
    *,
    report: Report,
    author: Any,
    new_status: str | None = None,
    message: str = "",
    notify: bool = True,
) -> ReportEvent:
    """Append a status change and/or a comment to a report's log.

    A status change carrying a note is one event, matching the udvalg's update
    form. Passing a status equal to the current one is treated as a plain
    comment, so re-submitting the unchanged dropdown doesn't log a no-op change.
    """
    message = (message or "").strip()
    changed = bool(new_status) and new_status != report.status

    if changed:
        old_status = report.status
        report.status = new_status
        if new_status in Report.CLOSED_STATUSES:
            report.closed_at = report.closed_at or timezone.now()
        else:
            report.closed_at = None
        report.save(update_fields=["status", "closed_at", "updated_at"])
        event = ReportEvent.objects.create(
            report=report,
            author=author,
            kind=ReportEvent.Kind.STATUS,
            old_status=old_status,
            new_status=new_status,
            message=message,
        )
    else:
        event = ReportEvent.objects.create(
            report=report,
            author=author,
            kind=ReportEvent.Kind.COMMENT,
            message=message,
        )

    if notify:
        from apps.notifications.services import notify_report_event

        notify_report_event(event)
    return event
