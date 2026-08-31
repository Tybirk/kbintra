"""
Tests for the Expenses (Udlæg) app.
"""

from decimal import Decimal

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from apps.expenses.models import Expense, ExpenseAttachment
from apps.users.models import User


@pytest.fixture
def economy_admin(db):
    """A non-staff user with the economy admin role (the treasurer)."""
    return User.objects.create_user(
        email="economy@example.com",
        password="pass12345",
        first_name="Øko",
        last_name="Nom",
        is_economy_admin=True,
    )


@pytest.fixture
def food_admin(db):
    """A non-staff user with only the food admin role."""
    return User.objects.create_user(
        email="food@example.com",
        password="pass12345",
        first_name="Mad",
        last_name="Ansvarlig",
        is_food_admin=True,
    )


def _receipt(name: str = "kvittering.pdf") -> SimpleUploadedFile:
    return SimpleUploadedFile(name, b"%PDF-1.4 fake receipt", content_type="application/pdf")


def _real_pdf_receipt(name: str = "kvittering.pdf") -> SimpleUploadedFile:
    """A genuinely parseable one-page PDF (the merge needs real bytes)."""
    from io import BytesIO

    from PIL import Image

    buf = BytesIO()
    Image.new("RGB", (600, 800), "white").save(buf, format="PDF")
    return SimpleUploadedFile(name, buf.getvalue(), content_type="application/pdf")


def _photo_receipt(name: str = "foto.jpg") -> SimpleUploadedFile:
    """A photo of a kassebon, as residents upload from their phones."""
    from io import BytesIO

    from PIL import Image

    buf = BytesIO()
    Image.new("RGB", (800, 1200), "red").save(buf, format="JPEG")
    return SimpleUploadedFile(name, buf.getvalue(), content_type="image/jpeg")


def _pdf_page_count(content: bytes) -> int:
    from io import BytesIO

    from pypdf import PdfReader

    return len(PdfReader(BytesIO(content)).pages)


def _make_expense(user, **overrides) -> Expense:
    data = {
        "submitted_by": user,
        "reg_nr": "1234",
        "account_number": "1234567890",
        "amount": Decimal("250.00"),
        "description": "Indkøb af kaffe til fællesmøde",
    }
    data.update(overrides)
    return Expense.objects.create(**data)


# --- Creation / validation ---------------------------------------------------


@pytest.mark.django_db
def test_create_expense_with_receipt(authenticated_client, user):
    resp = authenticated_client.post(
        "/api/expenses/",
        {
            "reg_nr": "1234",
            "account_number": "9876543",
            "amount": "250.50",
            "description": "Maling til fælleshus",
            "files": [_receipt()],
        },
        format="multipart",
    )
    assert resp.status_code == 201, resp.data
    assert resp.data["status"] == "pending"
    assert resp.data["status_display"] == "Afventer"
    assert len(resp.data["attachments"]) == 1
    expense = Expense.objects.get(id=resp.data["id"])
    assert expense.submitted_by == user
    assert expense.attachments.count() == 1


@pytest.mark.django_db
def test_create_expense_requires_attachment(authenticated_client):
    resp = authenticated_client.post(
        "/api/expenses/",
        {
            "reg_nr": "1234",
            "account_number": "9876543",
            "amount": "250.50",
            "description": "Maling",
        },
        format="multipart",
    )
    assert resp.status_code == 400
    assert "files" in resp.data


@pytest.mark.django_db
def test_create_expense_rejects_bad_reg_nr(authenticated_client):
    resp = authenticated_client.post(
        "/api/expenses/",
        {
            "reg_nr": "12",
            "account_number": "9876543",
            "amount": "10.00",
            "description": "Test",
            "files": [_receipt()],
        },
        format="multipart",
    )
    assert resp.status_code == 400
    assert "reg_nr" in resp.data


@pytest.mark.django_db
def test_create_expense_rejects_zero_amount(authenticated_client):
    resp = authenticated_client.post(
        "/api/expenses/",
        {
            "reg_nr": "1234",
            "account_number": "9876543",
            "amount": "0",
            "description": "Test",
            "files": [_receipt()],
        },
        format="multipart",
    )
    assert resp.status_code == 400
    assert "amount" in resp.data


# --- Ownership / listing -----------------------------------------------------


@pytest.mark.django_db
def test_list_only_returns_own_expenses(authenticated_client, user, second_user):
    _make_expense(user)
    _make_expense(second_user)
    resp = authenticated_client.get("/api/expenses/")
    assert resp.status_code == 200
    assert len(resp.data) == 1
    assert resp.data[0]["submitted_by"]["id"] == user.id


@pytest.mark.django_db
def test_owner_can_edit_pending_but_not_paid(authenticated_client, user):
    expense = _make_expense(user)
    resp = authenticated_client.patch(
        f"/api/expenses/{expense.id}/", {"amount": "300.00"}, format="json"
    )
    assert resp.status_code == 200
    assert resp.data["amount"] == "300.00"

    Expense.objects.filter(id=expense.id).update(status=Expense.Status.PAID)
    resp = authenticated_client.patch(
        f"/api/expenses/{expense.id}/", {"amount": "400.00"}, format="json"
    )
    assert resp.status_code == 403


@pytest.mark.django_db
def test_owner_can_delete_pending_only(authenticated_client, user):
    expense = _make_expense(user, status=Expense.Status.PAID)
    resp = authenticated_client.delete(f"/api/expenses/{expense.id}/")
    assert resp.status_code == 403

    pending = _make_expense(user)
    resp = authenticated_client.delete(f"/api/expenses/{pending.id}/")
    assert resp.status_code == 204
    assert not Expense.objects.filter(id=pending.id).exists()


@pytest.mark.django_db
def test_non_owner_cannot_read_detail_admin_can(api_client, user, admin_user, second_user):
    expense = _make_expense(user)

    api_client.force_authenticate(user=second_user)
    assert api_client.get(f"/api/expenses/{expense.id}/").status_code == 404

    api_client.force_authenticate(user=admin_user)
    assert api_client.get(f"/api/expenses/{expense.id}/").status_code == 200


# --- Attachment download (private files) -------------------------------------


@pytest.mark.django_db
def test_attachment_download_permissions(settings, tmp_path, user, admin_user, second_user):
    settings.MEDIA_ROOT = tmp_path
    expense = _make_expense(user)
    attachment = ExpenseAttachment.objects.create(
        expense=expense, file=_receipt(), name="kvittering.pdf"
    )
    url = f"/api/expenses/attachments/{attachment.id}/download/"

    # Unauthenticated
    assert APIClient().get(url).status_code == 401

    # Other resident -> 404 (cannot confirm existence)
    other = APIClient()
    other.force_login(second_user)
    assert other.get(url).status_code == 404

    # Owner -> 200
    owner = APIClient()
    owner.force_login(user)
    assert owner.get(url).status_code == 200

    # Admin -> 200
    staff = APIClient()
    staff.force_login(admin_user)
    assert staff.get(url).status_code == 200


@pytest.mark.django_db
def test_private_prefix_blocked_on_media_path(user):
    client = APIClient()
    client.force_login(user)
    resp = client.get("/media/expense_receipts/anything.pdf")
    assert resp.status_code == 403


@pytest.mark.django_db
def test_private_prefix_blocked_via_path_traversal(settings, tmp_path, user):
    """A ../ that normalizes back into expense_receipts/ must NOT leak the file."""
    settings.MEDIA_ROOT = tmp_path
    # A real sibling dir (prod has avatars/, forum files, etc.) so the traversal
    # resolves on disk — this is what made the naive prefix check exploitable.
    (tmp_path / "avatars").mkdir()
    expense = _make_expense(user)
    attachment = ExpenseAttachment.objects.create(
        expense=expense, file=_receipt(), name="kvittering.pdf"
    )
    client = APIClient()
    client.force_login(user)
    resp = client.get(f"/media/avatars/../{attachment.file.name}")
    assert resp.status_code == 403


@pytest.mark.django_db
def test_attachment_download_forces_attachment_disposition(settings, tmp_path, user):
    """Receipts are served as a download, never rendered inline (stored-XSS guard)."""
    settings.MEDIA_ROOT = tmp_path
    expense = _make_expense(user)
    attachment = ExpenseAttachment.objects.create(
        expense=expense, file=_receipt(), name="kvittering.pdf"
    )
    client = APIClient()
    client.force_login(user)
    resp = client.get(f"/api/expenses/attachments/{attachment.id}/download/")
    assert resp.status_code == 200
    assert resp["Content-Disposition"].startswith("attachment")
    assert resp["X-Content-Type-Options"] == "nosniff"


# --- Combined bilag PDF (one attachment for the accounting program) ----------


@pytest.mark.django_db
def test_combined_pdf_merges_every_bilag(settings, tmp_path, user):
    """All bilag on one udlæg come back as a single PDF, one page each."""
    settings.MEDIA_ROOT = tmp_path
    expense = _make_expense(user)
    ExpenseAttachment.objects.create(expense=expense, file=_photo_receipt(), name="foto.jpg")
    ExpenseAttachment.objects.create(
        expense=expense, file=_real_pdf_receipt(), name="kvittering.pdf"
    )

    client = APIClient()
    client.force_login(user)
    resp = client.get(f"/api/expenses/{expense.id}/bilag.pdf")

    assert resp.status_code == 200
    assert resp["Content-Type"] == "application/pdf"
    assert resp["Content-Disposition"].startswith("attachment")
    assert f"udlaeg-{expense.id}-bilag.pdf" in resp["Content-Disposition"]
    assert _pdf_page_count(resp.content) == 2


@pytest.mark.django_db
def test_combined_pdf_keeps_a_page_for_bilag_it_cannot_render(settings, tmp_path, user):
    """An unconvertible or missing bilag becomes a notice page, never a silent drop."""
    settings.MEDIA_ROOT = tmp_path
    expense = _make_expense(user)
    ExpenseAttachment.objects.create(expense=expense, file=_photo_receipt(), name="foto.jpg")
    ExpenseAttachment.objects.create(
        expense=expense,
        file=SimpleUploadedFile("regneark.xlsx", b"PK\x03\x04 not a receipt"),
        name="regneark.xlsx",
    )
    gone = ExpenseAttachment.objects.create(
        expense=expense, file=_real_pdf_receipt("væk.pdf"), name="væk.pdf"
    )
    (tmp_path / gone.file.name).unlink()

    client = APIClient()
    client.force_login(user)
    resp = client.get(f"/api/expenses/{expense.id}/bilag.pdf")

    assert resp.status_code == 200
    assert _pdf_page_count(resp.content) == 3


@pytest.mark.django_db
def test_combined_pdf_permissions(settings, tmp_path, user, second_user, economy_admin):
    settings.MEDIA_ROOT = tmp_path
    expense = _make_expense(user)
    ExpenseAttachment.objects.create(expense=expense, file=_photo_receipt(), name="foto.jpg")
    ExpenseAttachment.objects.create(
        expense=expense, file=_real_pdf_receipt(), name="kvittering.pdf"
    )
    url = f"/api/expenses/{expense.id}/bilag.pdf"

    assert APIClient().get(url).status_code == 401

    other = APIClient()
    other.force_login(second_user)
    assert other.get(url).status_code == 404

    treasurer = APIClient()
    treasurer.force_login(economy_admin)
    assert treasurer.get(url).status_code == 200


@pytest.mark.django_db
def test_combined_pdf_404_without_attachments(user):
    expense = _make_expense(user)
    client = APIClient()
    client.force_login(user)
    assert client.get(f"/api/expenses/{expense.id}/bilag.pdf").status_code == 404


@pytest.mark.django_db
def test_combined_pdf_url_only_offered_when_there_is_something_to_merge(
    settings, tmp_path, authenticated_client, user
):
    settings.MEDIA_ROOT = tmp_path
    expense = _make_expense(user)
    first = ExpenseAttachment.objects.create(
        expense=expense, file=_receipt(), name="kvittering.pdf"
    )

    resp = authenticated_client.get("/api/expenses/")
    assert resp.data[0]["combined_pdf_url"] is None

    ExpenseAttachment.objects.create(
        expense=expense, file=_receipt("ekstra.pdf"), name="ekstra.pdf"
    )
    resp = authenticated_client.get("/api/expenses/")
    assert resp.data[0]["combined_pdf_url"] == f"/api/expenses/{expense.id}/bilag.pdf"

    first.delete()
    resp = authenticated_client.get("/api/expenses/")
    assert resp.data[0]["combined_pdf_url"] is None


# --- Admin views -------------------------------------------------------------


@pytest.mark.django_db
def test_admin_list_filters_and_total(admin_client, user, second_user):
    _make_expense(user, amount=Decimal("100.00"))
    _make_expense(second_user, amount=Decimal("50.00"), status=Expense.Status.PAID)

    resp = admin_client.get("/api/expenses/admin/")
    assert resp.status_code == 200
    assert len(resp.data["results"]) == 2
    assert resp.data["total"] == "150.00"

    resp = admin_client.get("/api/expenses/admin/", {"status": "paid"})
    assert len(resp.data["results"]) == 1
    assert resp.data["total"] == "50.00"

    resp = admin_client.get("/api/expenses/admin/", {"user": user.id})
    assert len(resp.data["results"]) == 1


@pytest.mark.django_db
def test_admin_list_paginates_20_per_page(admin_client, user):
    for _ in range(25):
        _make_expense(user, amount=Decimal("10.00"))

    resp = admin_client.get("/api/expenses/admin/")
    assert resp.status_code == 200
    assert resp.data["count"] == 25
    assert resp.data["num_pages"] == 2
    assert resp.data["page"] == 1
    assert len(resp.data["results"]) == 20
    # The total spans the whole filtered set, not just the page.
    assert resp.data["total"] == "250.00"

    page2 = admin_client.get("/api/expenses/admin/", {"page": 2})
    assert page2.data["page"] == 2
    assert len(page2.data["results"]) == 5

    # An out-of-range page clamps to the last page instead of 404ing.
    clamped = admin_client.get("/api/expenses/admin/", {"page": 99})
    assert clamped.status_code == 200
    assert clamped.data["page"] == 2


@pytest.mark.django_db
def test_admin_list_requires_economy_admin(authenticated_client):
    # A regular resident (no economy role) cannot reach the admin list.
    assert authenticated_client.get("/api/expenses/admin/").status_code == 403


@pytest.mark.django_db
def test_economy_admin_has_admin_access(api_client, economy_admin, user):
    expense = _make_expense(user)
    api_client.force_authenticate(user=economy_admin)

    # List + total
    resp = api_client.get("/api/expenses/admin/")
    assert resp.status_code == 200
    assert resp.data["count"] == 1

    # Read any resident's expense detail
    assert api_client.get(f"/api/expenses/{expense.id}/").status_code == 200

    # Mark paid (records who processed it)
    resp = api_client.patch(
        f"/api/expenses/{expense.id}/status/", {"status": "paid"}, format="json"
    )
    assert resp.status_code == 200
    expense.refresh_from_db()
    assert expense.processed_by == economy_admin


@pytest.mark.django_db
def test_economy_admin_can_download_attachment(settings, tmp_path, economy_admin, user):
    settings.MEDIA_ROOT = tmp_path
    expense = _make_expense(user)
    attachment = ExpenseAttachment.objects.create(
        expense=expense, file=_receipt(), name="kvittering.pdf"
    )
    client = APIClient()
    client.force_login(economy_admin)
    resp = client.get(f"/api/expenses/attachments/{attachment.id}/download/")
    assert resp.status_code == 200


@pytest.mark.django_db
def test_admin_mark_paid_sets_paid_at(admin_client, user, admin_user):
    expense = _make_expense(user)
    resp = admin_client.patch(
        f"/api/expenses/{expense.id}/status/", {"status": "paid"}, format="json"
    )
    assert resp.status_code == 200
    expense.refresh_from_db()
    assert expense.status == Expense.Status.PAID
    assert expense.paid_at is not None
    assert expense.processed_by == admin_user


@pytest.mark.django_db
def test_admin_reject_requires_note(admin_client, user):
    expense = _make_expense(user)
    resp = admin_client.patch(
        f"/api/expenses/{expense.id}/status/", {"status": "rejected"}, format="json"
    )
    assert resp.status_code == 400
    assert "admin_note" in resp.data

    resp = admin_client.patch(
        f"/api/expenses/{expense.id}/status/",
        {"status": "rejected", "admin_note": "Mangler godkendelse"},
        format="json",
    )
    assert resp.status_code == 200
    expense.refresh_from_db()
    assert expense.status == Expense.Status.REJECTED
    assert expense.paid_at is None


@pytest.mark.django_db
def test_admin_csv_export(admin_client, user):
    _make_expense(user, amount=Decimal("123.45"))
    resp = admin_client.get("/api/expenses/admin/export/")
    assert resp.status_code == 200
    assert resp["Content-Type"].startswith("text/csv")
    body = resp.content.decode("utf-8")
    assert body.startswith("﻿")  # BOM
    assert "Reg. nr." in body
    assert "123,45" in body


@pytest.mark.django_db
def test_admin_csv_export_neutralizes_formula_injection(admin_client, user):
    """A description starting with = must be escaped so Excel can't run it."""
    _make_expense(user, description='=HYPERLINK("http://evil")')
    resp = admin_client.get("/api/expenses/admin/export/")
    body = resp.content.decode("utf-8")
    assert "'=HYPERLINK" in body
    assert "\n=HYPERLINK" not in body
    assert ";=HYPERLINK" not in body


@pytest.mark.django_db
def test_admin_list_rejects_non_numeric_user_filter(admin_client):
    resp = admin_client.get("/api/expenses/admin/", {"user": "abc"})
    assert resp.status_code == 400
    assert "user" in resp.data


# --- Notifications -----------------------------------------------------------


@pytest.mark.django_db
def test_notifies_submitter_on_paid_and_rejected(admin_client, user):
    from apps.notifications.models import Notification, NotificationType

    paid = _make_expense(user)
    admin_client.patch(f"/api/expenses/{paid.id}/status/", {"status": "paid"}, format="json")

    rejected = _make_expense(user)
    admin_client.patch(
        f"/api/expenses/{rejected.id}/status/",
        {"status": "rejected", "admin_note": "Mangler godkendelse"},
        format="json",
    )

    notes = Notification.objects.filter(
        user=user, notification_type=NotificationType.EXPENSE_PROCESSED
    )
    assert notes.count() == 2
    # The rejection reason is surfaced to the submitter.
    assert any("Mangler godkendelse" in n.message for n in notes)


@pytest.mark.django_db
def test_no_notification_when_reset_to_pending_or_unchanged(admin_client, user):
    from apps.notifications.models import Notification

    expense = _make_expense(user, status=Expense.Status.PAID)
    # paid -> pending should not notify; the submitter already saw "paid".
    admin_client.patch(f"/api/expenses/{expense.id}/status/", {"status": "pending"}, format="json")
    assert not Notification.objects.filter(user=user).exists()

    # Re-saving the same status (e.g. just editing the note) must not re-notify.
    paid = _make_expense(user, status=Expense.Status.PAID)
    admin_client.patch(
        f"/api/expenses/{paid.id}/status/",
        {"status": "paid", "admin_note": "intern note"},
        format="json",
    )
    assert not Notification.objects.filter(user=user).exists()


@pytest.mark.django_db
def test_expense_notification_channel_routing():
    """No dedicated toggle: push if any push on, email if any email on, always in-app."""
    from apps.notifications.email_service import should_send_email
    from apps.notifications.models import NotificationPreference, NotificationType
    from apps.notifications.services import get_user_preference, get_user_push_preference

    t = NotificationType.EXPENSE_PROCESSED

    quiet = User.objects.create_user(email="quiet@example.com", password="x", first_name="Q")
    NotificationPreference.objects.create(
        user=quiet,
        **{
            f.name: False
            for f in NotificationPreference._meta.get_fields()
            if f.name.startswith(("email_", "push_"))
        },
    )
    # In-app is always on; with every email/push channel off, neither fires.
    assert get_user_preference(quiet, t) is True
    assert should_send_email(quiet, t) is False
    assert get_user_push_preference(quiet, t) is False

    loud = User.objects.create_user(email="loud@example.com", password="x", first_name="L")
    prefs = NotificationPreference.objects.create(user=loud)
    prefs.email_food_tickets = True  # any single email channel
    prefs.push_mentions = True  # any single push channel
    prefs.save()
    assert should_send_email(loud, t) is True
    assert get_user_push_preference(loud, t) is True


# --- Food-related flag -------------------------------------------------------


@pytest.mark.django_db
def test_create_expense_defaults_food_related_off(authenticated_client):
    resp = authenticated_client.post(
        "/api/expenses/",
        {
            "reg_nr": "1234",
            "account_number": "9876543",
            "amount": "50.00",
            "description": "Almindeligt udlæg",
            "files": [_receipt()],
        },
        format="multipart",
    )
    assert resp.status_code == 201, resp.data
    assert resp.data["food_related"] is False


@pytest.mark.django_db
def test_create_expense_can_flag_food_related(authenticated_client):
    resp = authenticated_client.post(
        "/api/expenses/",
        {
            "reg_nr": "1234",
            "account_number": "9876543",
            "amount": "50.00",
            "description": "Krydderier til fællesmad",
            "food_related": "true",
            "files": [_receipt()],
        },
        format="multipart",
    )
    assert resp.status_code == 201, resp.data
    assert resp.data["food_related"] is True
    assert Expense.objects.get(id=resp.data["id"]).food_related is True


# --- Food-admin visibility ---------------------------------------------------


@pytest.mark.django_db
def test_food_admin_sees_only_food_related_expenses(api_client, food_admin, user):
    _make_expense(user, description="Ikke-mad", food_related=False)
    _make_expense(user, description="Mad", food_related=True)

    api_client.force_authenticate(user=food_admin)
    resp = api_client.get("/api/expenses/admin/")
    assert resp.status_code == 200
    assert resp.data["count"] == 1
    assert all(row["food_related"] for row in resp.data["results"])


@pytest.mark.django_db
def test_food_admin_cannot_change_status(api_client, food_admin, user):
    expense = _make_expense(user, food_related=True)
    api_client.force_authenticate(user=food_admin)
    resp = api_client.patch(
        f"/api/expenses/{expense.id}/status/", {"status": "paid"}, format="json"
    )
    assert resp.status_code == 403
    expense.refresh_from_db()
    assert expense.status == Expense.Status.PENDING


@pytest.mark.django_db
def test_food_admin_detail_and_attachment_scoped_to_food_related(
    settings, tmp_path, api_client, food_admin, user
):
    settings.MEDIA_ROOT = tmp_path
    food = _make_expense(user, food_related=True)
    food_att = ExpenseAttachment.objects.create(
        expense=food, file=_receipt(), name="kvittering.pdf"
    )
    other = _make_expense(user, food_related=False)
    other_att = ExpenseAttachment.objects.create(
        expense=other, file=_receipt(), name="hemmelig.pdf"
    )

    # DRF detail endpoint (token auth)
    api_client.force_authenticate(user=food_admin)
    assert api_client.get(f"/api/expenses/{food.id}/").status_code == 200
    assert api_client.get(f"/api/expenses/{other.id}/").status_code == 404

    # Private attachment download (session auth)
    session = APIClient()
    session.force_login(food_admin)
    assert session.get(f"/api/expenses/attachments/{food_att.id}/download/").status_code == 200
    assert session.get(f"/api/expenses/attachments/{other_att.id}/download/").status_code == 404


@pytest.mark.django_db
def test_economy_admin_can_filter_food_related(api_client, economy_admin, user):
    _make_expense(user, food_related=False)
    _make_expense(user, food_related=True)
    api_client.force_authenticate(user=economy_admin)

    # No filter → everything
    assert api_client.get("/api/expenses/admin/").data["count"] == 2
    # Only food
    resp = api_client.get("/api/expenses/admin/", {"food_related": "true"})
    assert resp.data["count"] == 1
    assert resp.data["results"][0]["food_related"] is True
    # Only non-food
    resp = api_client.get("/api/expenses/admin/", {"food_related": "false"})
    assert resp.data["count"] == 1
    assert resp.data["results"][0]["food_related"] is False


@pytest.mark.django_db
def test_csv_export_includes_food_related_column(admin_client, user):
    _make_expense(user, food_related=True)
    resp = admin_client.get("/api/expenses/admin/export/")
    body = resp.content.decode("utf-8")
    assert "Fællesmad" in body
    assert "Ja" in body


# --- Economy email notifications ---------------------------------------------


@pytest.mark.django_db
def test_economy_email_sent_on_creation(settings, mailoutbox, authenticated_client, user):
    settings.ECONOMY_EMAIL = "oekonomi@example.com"
    settings.DEFAULT_FROM_EMAIL = "KB Intra <noreply@kbintra.top>"
    resp = authenticated_client.post(
        "/api/expenses/",
        {
            "reg_nr": "1234",
            "account_number": "9876543",
            "amount": "250.50",
            "description": "Maling til fælleshus",
            "food_related": "false",
            "files": [_receipt()],
        },
        format="multipart",
    )
    assert resp.status_code == 201, resp.data
    assert len(mailoutbox) == 1
    msg = mailoutbox[0]
    assert msg.to == ["oekonomi@example.com"]
    assert "250,50" in msg.body
    assert "Maling til fælleshus" in msg.body
    assert "Vedrører fællesmad: Nej" in msg.body
    expense_id = resp.data["id"]
    # Prod SITE_URL → no TEST: prefix; stable per-expense subject.
    assert msg.subject == f"[Udlæg #{expense_id}] Udlæg fra Test User"
    # The root notice carries the thread id but no In-Reply-To.
    assert msg.extra_headers["References"] == f"<udlaeg-{expense_id}@kbintra.top>"
    assert "In-Reply-To" not in msg.extra_headers
    # The uploaded receipt is attached so the treasurer gets it in the mail.
    assert len(msg.attachments) == 1
    att_name, att_content, _ = msg.attachments[0]
    assert att_name == "kvittering.pdf"
    assert att_content == b"%PDF-1.4 fake receipt"


@pytest.mark.django_db
def test_receipt_over_size_cap_rejected(settings, authenticated_client):
    # A receipt bigger than the email attachment cap is refused on upload.
    settings.EXPENSE_EMAIL_MAX_ATTACHMENT_BYTES = 5  # tiny, to trip the guard
    resp = authenticated_client.post(
        "/api/expenses/",
        {
            "reg_nr": "1234",
            "account_number": "9876543",
            "amount": "10.00",
            "description": "For stort bilag",
            "files": [_receipt()],  # 21 bytes > 5
        },
        format="multipart",
    )
    assert resp.status_code == 400
    assert "for stort" in str(resp.data)
    assert not Expense.objects.exists()


@pytest.mark.django_db
def test_no_economy_email_when_food_related(settings, mailoutbox, authenticated_client):
    # Fællesmad-udlæg are handled by food admins in-app, so no economy notice.
    settings.ECONOMY_EMAIL = "oekonomi@example.com"
    resp = authenticated_client.post(
        "/api/expenses/",
        {
            "reg_nr": "1234",
            "account_number": "9876543",
            "amount": "99.00",
            "description": "Krydderier til fællesmad",
            "food_related": "true",
            "files": [_receipt()],
        },
        format="multipart",
    )
    assert resp.status_code == 201, resp.data
    assert len(mailoutbox) == 0


@pytest.mark.django_db
def test_economy_email_subject_flagged_on_test_site(
    settings, mailoutbox, authenticated_client, user
):
    settings.ECONOMY_EMAIL = "oekonomi@example.com"
    settings.SITE_URL = "https://kbintra.top"
    resp = authenticated_client.post(
        "/api/expenses/",
        {
            "reg_nr": "1234",
            "account_number": "9876543",
            "amount": "10.00",
            "description": "Test",
            "files": [_receipt()],
        },
        format="multipart",
    )
    assert resp.status_code == 201, resp.data
    assert len(mailoutbox) == 1
    assert mailoutbox[0].subject.startswith("TEST: [Udlæg #")


@pytest.mark.django_db
def test_economy_email_on_edit_threads_with_creation(
    settings, mailoutbox, authenticated_client, user
):
    settings.ECONOMY_EMAIL = "oekonomi@example.com"
    settings.DEFAULT_FROM_EMAIL = "KB Intra <noreply@kbintra.top>"
    expense = _make_expense(user)  # pending, owned by user
    resp = authenticated_client.patch(
        f"/api/expenses/{expense.id}/", {"amount": "300.00"}, format="json"
    )
    assert resp.status_code == 200, resp.data
    assert len(mailoutbox) == 1
    msg = mailoutbox[0]
    assert "rettet" in msg.body.lower()
    assert "300,00" in msg.body
    # Same stable subject + thread id as the creation notice, plus In-Reply-To,
    # so the change threads under the original in the treasurer's inbox.
    thread_id = f"<udlaeg-{expense.id}@kbintra.top>"
    assert msg.subject == f"[Udlæg #{expense.id}] Udlæg fra Test User"
    assert msg.extra_headers["References"] == thread_id
    assert msg.extra_headers["In-Reply-To"] == thread_id


@pytest.mark.django_db
def test_economy_email_on_delete_threads_with_creation(
    settings, mailoutbox, authenticated_client, user
):
    settings.ECONOMY_EMAIL = "oekonomi@example.com"
    settings.DEFAULT_FROM_EMAIL = "KB Intra <noreply@kbintra.top>"
    expense = _make_expense(user)  # pending, owned by user
    ExpenseAttachment.objects.create(expense=expense, file=_receipt(), name="kvittering.pdf")
    expense_id = expense.id
    resp = authenticated_client.delete(f"/api/expenses/{expense_id}/")
    assert resp.status_code == 204
    assert len(mailoutbox) == 1
    msg = mailoutbox[0]
    assert "slettet" in msg.body.lower()
    # No "behandl her" link once it's gone, and no attachments (files are deleted).
    assert "/udlaeg" not in msg.body
    assert msg.attachments == []
    thread_id = f"<udlaeg-{expense_id}@kbintra.top>"
    assert msg.subject == f"[Udlæg #{expense_id}] Udlæg fra Test User"
    assert msg.extra_headers["In-Reply-To"] == thread_id


@pytest.mark.django_db
def test_no_economy_email_on_edit_when_food_related(
    settings, mailoutbox, authenticated_client, user
):
    settings.ECONOMY_EMAIL = "oekonomi@example.com"
    expense = _make_expense(user, food_related=True)
    resp = authenticated_client.patch(
        f"/api/expenses/{expense.id}/", {"amount": "300.00"}, format="json"
    )
    assert resp.status_code == 200, resp.data
    assert len(mailoutbox) == 0


@pytest.mark.django_db
def test_no_economy_email_when_unconfigured(settings, mailoutbox, authenticated_client):
    settings.ECONOMY_EMAIL = ""
    resp = authenticated_client.post(
        "/api/expenses/",
        {
            "reg_nr": "1234",
            "account_number": "9876543",
            "amount": "10.00",
            "description": "Test",
            "files": [_receipt()],
        },
        format="multipart",
    )
    assert resp.status_code == 201, resp.data
    assert len(mailoutbox) == 0


@pytest.mark.django_db
def test_economy_email_carries_both_the_merged_pdf_and_the_originals(
    settings, mailoutbox, authenticated_client
):
    """The merged PDF (for the accounting program) comes first, originals after."""
    settings.ECONOMY_EMAIL = "oekonomi@example.com"
    resp = authenticated_client.post(
        "/api/expenses/",
        {
            "reg_nr": "1234",
            "account_number": "9876543",
            "amount": "120.00",
            "description": "Kaffe og filtre",
            "files": [_photo_receipt(), _real_pdf_receipt()],
        },
        format="multipart",
    )
    assert resp.status_code == 201, resp.data
    expense_id = resp.data["id"]

    msg = mailoutbox[0]
    assert [a[0] for a in msg.attachments] == [
        f"udlaeg-{expense_id}-bilag.pdf",
        "foto.jpg",
        "kvittering.pdf",
    ]
    name, content, mimetype = msg.attachments[0]
    assert mimetype == "application/pdf"
    assert _pdf_page_count(content) == 2
    assert "samlet PDF" in msg.body


@pytest.mark.django_db
def test_economy_email_falls_back_to_single_files_if_merge_fails(
    settings, mailoutbox, monkeypatch, authenticated_client
):
    """A broken merge must never cost the treasurer the bilag themselves."""
    settings.ECONOMY_EMAIL = "oekonomi@example.com"

    from apps.expenses import pdf as pdf_module

    def _boom(parts):
        raise RuntimeError("merge failed")

    monkeypatch.setattr(pdf_module, "build_combined_pdf", _boom)

    resp = authenticated_client.post(
        "/api/expenses/",
        {
            "reg_nr": "1234",
            "account_number": "9876543",
            "amount": "120.00",
            "description": "Kaffe og filtre",
            "files": [_receipt("bon1.pdf"), _receipt("bon2.pdf")],
        },
        format="multipart",
    )
    assert resp.status_code == 201, resp.data

    msg = mailoutbox[0]
    assert [a[0] for a in msg.attachments] == ["bon1.pdf", "bon2.pdf"]
    assert "samlet PDF" not in msg.body


@pytest.mark.django_db
def test_economy_email_skips_the_merge_when_it_would_blow_the_size_budget(
    settings, mailoutbox, monkeypatch, authenticated_client
):
    """Too big to mail → the originals still go out, just without the merged PDF."""
    settings.ECONOMY_EMAIL = "oekonomi@example.com"

    from apps.expenses import pdf as pdf_module

    monkeypatch.setattr(pdf_module, "build_combined_pdf", lambda parts: b"%PDF-" + b"x" * 10_000)
    settings.EXPENSE_EMAIL_MAX_ATTACHMENT_BYTES = 9_000

    resp = authenticated_client.post(
        "/api/expenses/",
        {
            "reg_nr": "1234",
            "account_number": "9876543",
            "amount": "120.00",
            "description": "Kaffe og filtre",
            "files": [_receipt("bon1.pdf"), _receipt("bon2.pdf")],
        },
        format="multipart",
    )
    assert resp.status_code == 201, resp.data

    msg = mailoutbox[0]
    assert [a[0] for a in msg.attachments] == ["bon1.pdf", "bon2.pdf"]
    assert "samlet PDF" not in msg.body
