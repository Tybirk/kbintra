"""
Domain operations for Indrapportering.

Kept out of the views so that number allocation, the log entry and the
notification fan-out happen identically whether a case arrives through the API
or through the import command.
"""

from __future__ import annotations

from typing import Any

from django.db import IntegrityError, transaction
from django.db.models import Max, QuerySet
from django.utils import timezone

from .models import Report, ReportEvent, ReportPhoto

# How many times to retry when two submissions race for the same case number.
_NUMBER_RETRIES = 5


def next_number(subgroup_id: int) -> int:
    """The next free case number within an udvalg."""
    highest = Report.objects.filter(subgroup_id=subgroup_id).aggregate(n=Max("number"))["n"]
    return (highest or 0) + 1


def reporting_subgroups() -> QuerySet:
    """Udvalg that accept reports, in display order."""
    from apps.forum.models import Subgroup

    return Subgroup.objects.filter(reporting_enabled=True).order_by("name")


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

    The number is ``max+1`` computed inside the transaction. SQLite gives us no
    useful row lock to hold across that, so the unique constraint is the real
    guard: on the rare collision from two simultaneous submissions we just try
    the next number. With ~90 residents this is a belt-and-braces loop, not a
    hot path.
    """
    last_error: Exception | None = None
    for _ in range(_NUMBER_RETRIES):
        try:
            with transaction.atomic():
                return Report.objects.create(
                    subgroup=subgroup,
                    number=next_number(subgroup.id),
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
