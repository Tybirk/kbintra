"""
Tests for the Indrapportering app.
"""

import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image
from rest_framework.test import APIClient

from apps.forum.models import Subgroup, SubgroupMembership
from apps.notifications.models import Notification, NotificationType
from apps.reports.models import Report, ReportCounter, ReportEvent
from apps.reports.services import add_event, create_report, next_number
from apps.users.models import User


def _png_bytes() -> bytes:
    """A real 1x1 PNG, so ImageField validation has something to chew on."""
    buffer = io.BytesIO()
    Image.new("RGB", (1, 1), "white").save(buffer, format="PNG")
    return buffer.getvalue()


@pytest.fixture
def du(db):
    """An udvalg that accepts reports."""
    return Subgroup.objects.create(
        name="Driftsudvalget",
        slug="driftsudvalget",
        is_committee=True,
        allows_members=True,
        reporting_enabled=True,
    )


@pytest.fixture
def other_udvalg(db):
    return Subgroup.objects.create(
        name="Grønt udvalg",
        slug="groent-udvalg",
        is_committee=True,
        allows_members=True,
        reporting_enabled=True,
    )


@pytest.fixture
def member(db, du):
    """A member of the udvalg — a caseworker."""
    person = User.objects.create_user(
        email="medlem@example.com",
        password="pass12345",
        first_name="Mette",
        last_name="Medlem",
    )
    SubgroupMembership.objects.create(user=person, subgroup=du, role="Medlem")
    return person


@pytest.fixture
def neighbour(db):
    """A resident with no committee role."""
    return User.objects.create_user(
        email="nabo@example.com",
        password="pass12345",
        first_name="Nanna",
        last_name="Nabo",
    )


def _client(person) -> APIClient:
    client = APIClient()
    client.force_authenticate(user=person)
    return client


def _photo(name: str = "billede.png") -> SimpleUploadedFile:
    return SimpleUploadedFile(name, _png_bytes(), content_type="image/png")


def _report(du, user, **overrides) -> Report:
    kwargs = {
        "subgroup": du,
        "kind": Report.Kind.DEFECT,
        "description": "Defekt støvsugerslange, falder ud når man bruger den",
        "submitted_by": user,
        "notify": False,
    }
    kwargs.update(overrides)
    return create_report(**kwargs)


# --- Numbering ---------------------------------------------------------------


@pytest.mark.django_db
def test_numbers_are_sequential_per_subgroup(du, other_udvalg, user):
    first = _report(du, user)
    second = _report(du, user)
    other = _report(other_udvalg, user)

    assert (first.number, second.number) == (1, 2)
    # Each udvalg counts on its own, so both queues start at #1.
    assert other.number == 1


@pytest.mark.django_db
def test_numbering_continues_after_imported_cases(du, user):
    """Historic cases keep their numbers and the next one carries on from there."""
    create_report(
        subgroup=du,
        kind=Report.Kind.DEFECT,
        description="Importeret sag",
        submitted_by=user,
        notify=False,
    )
    Report.objects.filter(subgroup=du).update(number=13)

    assert _report(du, user).number == 14


# --- Creating -----------------------------------------------------------------


@pytest.mark.django_db
def test_resident_files_a_report_with_photo(du, user):
    resp = _client(user).post(
        "/api/reports/",
        {
            "subgroup": "driftsudvalget",
            "kind": "defect",
            "description": "Høj stol mangler et ben",
            "location": "Fælleshuset",
            "photos": [_photo()],
        },
        format="multipart",
    )
    assert resp.status_code == 201
    assert resp.data["number"] == 1
    assert resp.data["status"] == "new"
    assert resp.data["location"] == "Fælleshuset"
    assert len(resp.data["photos"]) == 1
    # Filing a case opens its log.
    assert [event["kind"] for event in resp.data["events"]] == ["created"]


@pytest.mark.django_db
def test_cannot_file_to_a_subgroup_without_reporting(db, user, subgroup):
    resp = _client(user).post(
        "/api/reports/",
        {
            "subgroup": subgroup.slug,
            "kind": "defect",
            "description": "Noget er gået i stykker",
        },
        format="multipart",
    )
    assert resp.status_code == 400
    assert "subgroup" in resp.data


@pytest.mark.django_db
def test_description_is_required(du, user):
    resp = _client(user).post(
        "/api/reports/",
        {"subgroup": "driftsudvalget", "kind": "defect", "description": "   "},
        format="multipart",
    )
    assert resp.status_code == 400


# --- Visibility ---------------------------------------------------------------


@pytest.mark.django_db
def test_every_resident_sees_every_case(du, user, neighbour):
    _report(du, user)

    resp = _client(neighbour).get("/api/reports/")
    assert resp.status_code == 200
    assert resp.data["count"] == 1
    assert resp.data["open_count"] == 1


@pytest.mark.django_db
def test_detail_is_addressed_by_slug_and_number(du, user, neighbour):
    report = _report(du, user)

    resp = _client(neighbour).get(f"/api/reports/driftsudvalget/{report.number}/")
    assert resp.status_code == 200
    assert resp.data["url"] == f"/indrapportering/driftsudvalget/{report.number}"


@pytest.mark.django_db
def test_filters_by_status_kind_and_open(du, user):
    _report(du, user)
    closed = _report(du, user, kind=Report.Kind.SUGGESTION)
    add_event(report=closed, author=user, new_status=Report.Status.DONE, notify=False)

    client = _client(user)
    assert client.get("/api/reports/?status=open").data["count"] == 1
    assert client.get("/api/reports/?status=done").data["count"] == 1
    assert client.get("/api/reports/?kind=suggestion").data["count"] == 1
    assert client.get("/api/reports/").data["count"] == 2


@pytest.mark.django_db
def test_search_matches_description(du, user):
    _report(du, user, description="Vandhane i køkkenet mangler en overdel")
    _report(du, user, description="Dørlukker er skruet af")

    resp = _client(user).get("/api/reports/?q=vandhane")
    assert resp.data["count"] == 1


# --- Status changes -----------------------------------------------------------


@pytest.mark.django_db
def test_committee_member_changes_status(du, user, member):
    report = _report(du, user)

    resp = _client(member).post(
        f"/api/reports/driftsudvalget/{report.number}/events/",
        {"status": "in_progress", "message": "Kan fikses med gaffa tape indtil videre"},
        format="json",
    )
    assert resp.status_code == 201
    assert resp.data["status"] == "in_progress"

    # A status change with a note is one log entry, not two.
    events = [event for event in resp.data["events"] if event["kind"] == "status"]
    assert len(events) == 1
    assert events[0]["old_status"] == "new"
    assert events[0]["new_status"] == "in_progress"
    assert "gaffa" in events[0]["message"]


@pytest.mark.django_db
def test_neighbour_cannot_change_status(du, user, neighbour):
    report = _report(du, user)

    resp = _client(neighbour).post(
        f"/api/reports/driftsudvalget/{report.number}/events/",
        {"status": "done"},
        format="json",
    )
    assert resp.status_code == 403
    report.refresh_from_db()
    assert report.status == Report.Status.NEW


@pytest.mark.django_db
def test_reporter_cannot_close_own_case(du, user):
    """Being the reporter is not the same as being on the udvalg."""
    report = _report(du, user)

    resp = _client(user).post(
        f"/api/reports/driftsudvalget/{report.number}/events/",
        {"status": "done"},
        format="json",
    )
    assert resp.status_code == 403


@pytest.mark.django_db
def test_staff_can_change_status(du, user, admin_user):
    report = _report(du, user)

    resp = _client(admin_user).post(
        f"/api/reports/driftsudvalget/{report.number}/events/",
        {"status": "rejected"},
        format="json",
    )
    assert resp.status_code == 201
    assert resp.data["status"] == "rejected"


@pytest.mark.django_db
def test_closing_and_reopening_tracks_closed_at(du, user, member):
    report = _report(du, user)

    add_event(report=report, author=member, new_status=Report.Status.DONE, notify=False)
    report.refresh_from_db()
    assert report.closed_at is not None
    assert not report.is_open

    add_event(report=report, author=member, new_status=Report.Status.IN_PROGRESS, notify=False)
    report.refresh_from_db()
    assert report.closed_at is None
    assert report.is_open


@pytest.mark.django_db
def test_resubmitting_the_same_status_logs_a_comment(du, user, member):
    """The dropdown starts on the current status; sending it back is not a change."""
    report = _report(du, user)

    event = add_event(
        report=report, author=member, new_status=Report.Status.NEW, message="Set", notify=False
    )
    assert event.kind == ReportEvent.Kind.COMMENT


# --- Comments -----------------------------------------------------------------


@pytest.mark.django_db
def test_any_resident_can_comment(du, user, neighbour):
    report = _report(du, user)

    resp = _client(neighbour).post(
        f"/api/reports/driftsudvalget/{report.number}/events/",
        {"message": "Jeg har lappet den midlertidigt"},
        format="json",
    )
    assert resp.status_code == 201
    assert resp.data["comment_count"] == 1


@pytest.mark.django_db
def test_empty_update_is_rejected(du, user, member):
    report = _report(du, user)

    resp = _client(member).post(
        f"/api/reports/driftsudvalget/{report.number}/events/",
        {"message": "   "},
        format="json",
    )
    assert resp.status_code == 400


# --- Editing and deleting -----------------------------------------------------


@pytest.mark.django_db
def test_reporter_edits_while_new(du, user):
    report = _report(du, user)

    resp = _client(user).patch(
        f"/api/reports/driftsudvalget/{report.number}/",
        {"description": "Rettelse: det er den anden støvsuger"},
        format="json",
    )
    assert resp.status_code == 200
    assert resp.data["description"].startswith("Rettelse")


@pytest.mark.django_db
def test_reporter_cannot_edit_once_work_started(du, user, member):
    report = _report(du, user)
    add_event(report=report, author=member, new_status=Report.Status.IN_PROGRESS, notify=False)

    resp = _client(user).patch(
        f"/api/reports/driftsudvalget/{report.number}/",
        {"description": "For sent"},
        format="json",
    )
    assert resp.status_code == 403


@pytest.mark.django_db
def test_neighbour_cannot_edit_or_delete(du, user, neighbour):
    report = _report(du, user)
    client = _client(neighbour)
    path = f"/api/reports/driftsudvalget/{report.number}/"

    assert client.patch(path, {"description": "Nej"}, format="json").status_code == 403
    assert client.delete(path).status_code == 403


@pytest.mark.django_db
def test_reporter_deletes_own_new_case(du, user):
    report = _report(du, user)

    resp = _client(user).delete(f"/api/reports/driftsudvalget/{report.number}/")
    assert resp.status_code == 204
    assert not Report.objects.filter(pk=report.pk).exists()


# --- Notifications ------------------------------------------------------------


@pytest.mark.django_db
def test_new_case_notifies_the_udvalg(du, user, member):
    create_report(
        subgroup=du,
        kind=Report.Kind.DEFECT,
        description="Kloakken er stoppet",
        submitted_by=user,
    )

    notes = Notification.objects.filter(notification_type=NotificationType.REPORT_NEW)
    assert [note.user_id for note in notes] == [member.id]
    assert "Kloakken" in notes[0].message


@pytest.mark.django_db
def test_reporter_is_not_notified_of_their_own_case(du, member):
    """A member who files a case should not be told about it."""
    create_report(
        subgroup=du,
        kind=Report.Kind.DEFECT,
        description="Jeg melder selv ind",
        submitted_by=member,
    )
    assert not Notification.objects.filter(notification_type=NotificationType.REPORT_NEW).exists()


@pytest.mark.django_db
def test_status_change_notifies_the_reporter(du, user, member):
    report = _report(du, user)

    add_event(report=report, author=member, new_status=Report.Status.IN_PROGRESS)

    notes = Notification.objects.filter(notification_type=NotificationType.REPORT_UPDATE)
    assert [note.user_id for note in notes] == [user.id]
    # Status first, case reference last, so a clipped title still delivers it.
    assert notes[0].title == f"I gang · sag #{report.number}"


@pytest.mark.django_db
def test_comment_notifies_reporter_and_udvalg_but_not_author(du, user, member, neighbour):
    report = _report(du, user)

    add_event(report=report, author=neighbour, message="Jeg ved hvor delen er")

    notified = set(
        Notification.objects.filter(notification_type=NotificationType.REPORT_UPDATE).values_list(
            "user_id", flat=True
        )
    )
    assert notified == {user.id, member.id}


# --- Export -------------------------------------------------------------------


@pytest.mark.django_db
def test_member_exports_csv(du, user, member):
    _report(du, user, description="Revne mellem bordplade og væg")

    resp = _client(member).get("/api/reports/export/?subgroup=driftsudvalget")
    assert resp.status_code == 200
    assert resp["Content-Type"].startswith("text/csv")
    body = resp.content.decode("utf-8")
    assert "Revne mellem bordplade" in body


@pytest.mark.django_db
def test_neighbour_cannot_export(du, user, neighbour):
    _report(du, user)
    resp = _client(neighbour).get("/api/reports/export/?subgroup=driftsudvalget")
    assert resp.status_code == 403


# --- Reporting subgroups ------------------------------------------------------


@pytest.mark.django_db
def test_subgroups_endpoint_lists_only_reporting_groups(du, user, subgroup):
    resp = _client(user).get("/api/reports/subgroups/")
    assert resp.status_code == 200
    assert [item["slug"] for item in resp.data] == ["driftsudvalget"]


@pytest.mark.django_db
def test_anonymous_access_is_denied(du):
    assert APIClient().get("/api/reports/").status_code in (401, 403)


# --- Search index -------------------------------------------------------------


@pytest.mark.django_db
def test_case_is_indexed_for_search(du, user):
    from django.db import connection

    report = _report(du, user, description="Bi kravlede ind ved nøgleboksen")

    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT url, subtitle FROM search_index WHERE type='report' AND object_id=%s",
            [str(report.id)],
        )
        row = cursor.fetchone()

    assert row is not None
    assert row[0] == f"/indrapportering/driftsudvalget/{report.number}"
    assert f"#{report.number}" in row[1]


@pytest.mark.django_db
def test_repeated_updates_collapse_into_one_row(du, user, member):
    """A burst of activity on one case should not fill the bell."""
    report = _report(du, user)

    add_event(report=report, author=member, new_status=Report.Status.IN_PROGRESS)
    add_event(report=report, author=member, message="Jeg har set på det")
    add_event(report=report, author=member, message="Delen er bestilt")

    notes = Notification.objects.filter(user=user, notification_type=NotificationType.REPORT_UPDATE)
    assert notes.count() == 1
    note = notes.first()
    assert note.aggregate_count == 3
    # The case number survives aggregation; the event part becomes a count.
    assert note.title == f"3 opdateringer · sag #{report.number}"
    # And the row shows the most recent thing that happened.
    assert "bestilt" in note.message


@pytest.mark.django_db
def test_updates_on_different_cases_stay_separate(du, user, member):
    first = _report(du, user)
    second = _report(du, user)

    add_event(report=first, author=member, message="En")
    add_event(report=second, author=member, message="To")

    assert (
        Notification.objects.filter(
            user=user, notification_type=NotificationType.REPORT_UPDATE
        ).count()
        == 2
    )


# --- Photo type validation ----------------------------------------------------


@pytest.mark.django_db
def test_non_image_upload_is_rejected(du, user):
    """A .txt used to be stored and left a broken tile on the case forever."""
    resp = _client(user).post(
        "/api/reports/",
        {
            "subgroup": "driftsudvalget",
            "kind": "defect",
            "description": "Prøver at vedhæfte et dokument",
            "photos": [
                SimpleUploadedFile("noter.txt", b"ikke et billede", content_type="text/plain")
            ],
        },
        format="multipart",
    )
    assert resp.status_code == 400
    assert "photos" in resp.data
    assert not Report.objects.exists()


@pytest.mark.django_db
def test_image_extension_lying_about_its_contents_is_rejected(du, user):
    """A PDF renamed to .jpg passes the extension check, so Pillow has to catch it."""
    resp = _client(user).post(
        "/api/reports/",
        {
            "subgroup": "driftsudvalget",
            "kind": "defect",
            "description": "Snydefil",
            "photos": [
                SimpleUploadedFile("snyd.jpg", b"%PDF-1.4 not an image", content_type="image/jpeg")
            ],
        },
        format="multipart",
    )
    assert resp.status_code == 400
    assert not Report.objects.exists()


@pytest.mark.django_db
def test_real_photo_is_still_accepted(du, user):
    resp = _client(user).post(
        "/api/reports/",
        {
            "subgroup": "driftsudvalget",
            "kind": "defect",
            "description": "Rigtigt foto",
            "photos": [_photo()],
        },
        format="multipart",
    )
    assert resp.status_code == 201
    assert len(resp.data["photos"]) == 1


@pytest.mark.django_db
def test_non_image_rejected_when_added_to_an_existing_case(du, user):
    report = _report(du, user)
    resp = _client(user).post(
        f"/api/reports/driftsudvalget/{report.number}/photos/",
        {
            "photos": [
                SimpleUploadedFile("regnskab.pdf", b"%PDF-1.4", content_type="application/pdf")
            ]
        },
        format="multipart",
    )
    assert resp.status_code == 400
    assert report.photos.count() == 0


# --- Case numbers are never reused --------------------------------------------


@pytest.mark.django_db
def test_number_is_not_reused_after_the_newest_case_is_deleted(du, user):
    """Old notification links must never resolve to a different case."""
    first = _report(du, user)
    second = _report(du, user)
    assert (first.number, second.number) == (1, 2)

    second.delete()
    third = _report(du, user)

    assert third.number == 3
    assert next_number(du.id) == 4


@pytest.mark.django_db
def test_number_is_not_reused_after_deleting_every_case(du, user):
    for _ in range(3):
        _report(du, user)
    Report.objects.filter(subgroup=du).delete()

    assert _report(du, user).number == 4


@pytest.mark.django_db
def test_counter_seeds_itself_from_cases_that_predate_it(du, user):
    """Imported history was written before the counter existed."""
    Report.objects.create(subgroup=du, number=13, kind=Report.Kind.DEFECT, description="Importeret")
    assert not ReportCounter.objects.filter(subgroup=du).exists()

    assert _report(du, user).number == 14
    assert ReportCounter.objects.get(subgroup=du).last_number == 14


@pytest.mark.django_db
def test_counters_are_independent_per_udvalg(du, other_udvalg, user):
    _report(du, user)
    _report(du, user).delete()

    # The other udvalg is untouched by DU's deletion.
    assert _report(other_udvalg, user).number == 1
    assert _report(du, user).number == 3
