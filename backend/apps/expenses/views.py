"""
Views for the Expenses (Udlæg) app.

Residents create and view their own expenses; economy admins (the treasurer)
list, filter, mark paid/rejected and export all expenses. Attachment files are
private and served only through ``expense_attachment_download`` after an
owner-or-economy-admin check.
"""

import csv
import io
import logging
import re
from datetime import datetime
from decimal import Decimal
from typing import Any
from urllib.parse import quote

from django.conf import settings
from django.core.paginator import Paginator
from django.db import transaction
from django.db.models import QuerySet, Sum
from django.http import Http404, HttpRequest, HttpResponse
from django.utils import timezone
from django.utils.cache import patch_cache_control
from rest_framework import generics, permissions, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.forum.utils import validate_file_size

from .models import Expense, ExpenseAttachment
from .serializers import (
    ExpenseAdminUpdateSerializer,
    ExpenseCreateUpdateSerializer,
    ExpenseSerializer,
)

logger = logging.getLogger(__name__)


def _attachment_disposition(name: str) -> str:
    """Build a safe ``Content-Disposition: attachment`` header value.

    The filename comes from a user upload, so it is sanitized for the ASCII
    ``filename`` (anything outside a conservative set becomes ``_``, which also
    blocks header injection via quotes/newlines) and the full original is
    carried in the RFC 5987 ``filename*`` field for modern browsers (æøå etc.).
    """
    raw = name or "bilag"
    ascii_name = re.sub(r"[^A-Za-z0-9._ -]", "_", raw.encode("ascii", "ignore").decode()).strip()
    ascii_name = ascii_name or "bilag"
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(raw)}"


def _read_attachment_bytes(attachment: ExpenseAttachment) -> bytes | None:
    """Read one receipt's bytes, restoring from the S3 backup if needed.

    Returns ``None`` when the file is gone for good — callers render a notice in
    its place rather than failing the whole download.
    """
    from pathlib import Path

    file_path = attachment.file.name
    local_path = Path(settings.MEDIA_ROOT) / file_path
    if not local_path.is_file():
        from apps.backup.s3 import download_file, is_enabled

        if not (is_enabled() and download_file(file_path)):
            return None
    try:
        return local_path.read_bytes()
    except OSError:
        logger.warning("Could not read expense attachment %s", file_path)
        return None


def _csv_safe(value: object) -> str:
    """Neutralize CSV/formula injection before writing a cell.

    A field beginning with =, +, -, @ (or a leading tab/CR) is interpreted as a
    formula by Excel/Sheets. Prefixing with a single quote forces it to text.
    Applied to every cell since several carry resident-supplied content.
    """
    text = "" if value is None else str(value)
    if text and text[0] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + text
    return text


def _can_view_expense(user: Any, expense: Expense) -> bool:
    """Whether *user* may read *expense* (not counting ownership).

    Economy admins (the treasurer) see every expense; food admins see only the
    ones flagged ``food_related`` (udlæg i forbindelse med fællesmad).
    """
    if user.has_economy_admin:
        return True
    return bool(user.has_food_admin and expense.food_related)


def _create_attachments(expense: Expense, files: list) -> None:
    """Validate and persist uploaded files as ExpenseAttachment rows.

    Receipts are capped at ``EXPENSE_EMAIL_MAX_ATTACHMENT_BYTES`` so each one
    still fits the economy notification email. Validate everything up front so a
    too-big file doesn't leave half the uploads written to storage.
    """
    max_bytes = getattr(settings, "EXPENSE_EMAIL_MAX_ATTACHMENT_BYTES", 18_000_000)
    for upload in files:
        validate_file_size(upload)
        if upload.size > max_bytes:
            raise ValidationError(
                {
                    "files": (
                        f"Bilaget '{upload.name}' er for stort. "
                        f"Hvert bilag må højst fylde {max_bytes // 1_000_000} MB."
                    )
                }
            )
    for upload in files:
        ExpenseAttachment.objects.create(
            expense=expense,
            file=upload,
            name=upload.name,
        )


def _expense_email_fields(expense: Expense) -> dict:
    """Snapshot the fields the economy notification needs, as primitives.

    Passed to the Huey task instead of the model instance so the ``deleted``
    notice still has its data after the row (and its FK) are gone.
    """
    who = (expense.submitted_by.get_full_name() if expense.submitted_by else "") or "Ukendt"
    return {
        "id": expense.id,
        "who": who,
        "amount": f"{expense.amount:.2f}".replace(".", ","),
        "reg_nr": expense.reg_nr,
        "account_number": expense.account_number,
        "food_related": expense.food_related,
        "description": expense.description,
        "approval_reference": expense.approval_reference,
        # Storage refs (not bytes) — the task reads + attaches the receipts so
        # the treasurer gets them straight in the mail. Captured before delete.
        "attachments": [{"name": a.name, "path": a.file.name} for a in expense.attachments.all()],
    }


class ExpenseListCreateView(generics.ListCreateAPIView):
    """List the current user's expenses or submit a new one."""

    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self) -> type:
        if self.request.method == "POST":
            return ExpenseCreateUpdateSerializer
        return ExpenseSerializer

    def get_queryset(self) -> QuerySet[Expense]:
        return (
            Expense.objects.filter(submitted_by=self.request.user)
            .select_related("submitted_by")
            .prefetch_related("attachments")
        )

    def create(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        files = request.FILES.getlist("files")
        if not files:
            raise ValidationError({"files": "Vedhæft mindst ét købsbilag."})

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            expense = serializer.save(submitted_by=request.user)
            _create_attachments(expense, files)

        # Let the treasurer know a new udlæg was submitted. Enqueued after the
        # atomic block so it only fires once the expense is committed.
        from .tasks import send_expense_notification_task

        send_expense_notification_task("created", _expense_email_fields(expense))

        out = ExpenseSerializer(expense, context=self.get_serializer_context())
        return Response(out.data, status=status.HTTP_201_CREATED)


class ExpenseDetailView(generics.RetrieveUpdateDestroyAPIView):
    """Retrieve, edit or delete one expense.

    Owners may edit/delete only while the expense is still pending. Staff may
    read any expense (status changes go through the admin endpoint).
    """

    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ["get", "patch", "delete"]

    def get_serializer_class(self) -> type:
        if self.request.method == "PATCH":
            return ExpenseCreateUpdateSerializer
        return ExpenseSerializer

    def get_queryset(self) -> QuerySet[Expense]:
        return Expense.objects.select_related("submitted_by").prefetch_related("attachments")

    def get_object(self) -> Expense:
        obj = super().get_object()
        user = self.request.user
        is_owner = obj.submitted_by_id == user.id
        if self.request.method == "GET":
            if not (is_owner or _can_view_expense(user, obj)):
                raise Http404
        else:
            if not is_owner:
                raise PermissionDenied("Du kan kun ændre dine egne udlæg.")
            if obj.status != Expense.Status.PENDING:
                raise PermissionDenied("Udlægget kan ikke ændres, når det er behandlet.")
        return obj

    def perform_update(self, serializer: Any) -> None:
        from .tasks import send_expense_notification_task

        expense = serializer.save()
        # Notify the treasurer of the change, threaded under the original notice.
        send_expense_notification_task("edited", _expense_email_fields(expense))

    def perform_destroy(self, instance: Expense) -> None:
        from .tasks import send_expense_notification_task

        # Snapshot before the row (and its attachments) are gone.
        fields = _expense_email_fields(instance)
        instance.delete()
        send_expense_notification_task("deleted", fields)


class ExpenseAttachmentView(APIView):
    """Add a file to (POST) or remove a file from (DELETE) a pending expense."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request, pk: int) -> Response:
        expense = generics.get_object_or_404(Expense, pk=pk)
        if expense.submitted_by_id != request.user.id:
            raise PermissionDenied("Du kan kun ændre dine egne udlæg.")
        if expense.status != Expense.Status.PENDING:
            raise PermissionDenied("Udlægget kan ikke ændres, når det er behandlet.")
        files = request.FILES.getlist("files")
        if not files:
            raise ValidationError({"files": "Ingen fil modtaget."})
        _create_attachments(expense, files)
        out = ExpenseSerializer(expense, context={"request": request})
        return Response(out.data, status=status.HTTP_201_CREATED)

    def delete(self, request: Request, pk: int) -> Response:
        attachment = generics.get_object_or_404(ExpenseAttachment, pk=pk)
        expense = attachment.expense
        if expense.submitted_by_id != request.user.id:
            raise PermissionDenied("Du kan kun ændre dine egne udlæg.")
        if expense.status != Expense.Status.PENDING:
            raise PermissionDenied("Udlægget kan ikke ændres, når det er behandlet.")
        attachment.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


def expense_attachment_download(request: HttpRequest, pk: int) -> HttpResponse:
    """Serve a private expense attachment to its owner or a staff member.

    A plain Django view (not DRF) that authenticates via the Django session
    cookie — the same mechanism ``apps.backup.views.serve_media`` relies on — so
    the URL works directly in <img src>/<a href>. Files live under MEDIA_ROOT
    but are blocked from the public /media path, so this is the only way in.
    """
    from pathlib import Path

    from django.conf import settings
    from django.views.static import serve

    if not request.user.is_authenticated:
        response = HttpResponse(status=401)
        response["Cache-Control"] = "private, no-store"
        return response

    try:
        attachment = ExpenseAttachment.objects.select_related("expense").get(pk=pk)
    except ExpenseAttachment.DoesNotExist as exc:
        raise Http404 from exc

    user = request.user
    if not (
        attachment.expense.submitted_by_id == user.id or _can_view_expense(user, attachment.expense)
    ):
        # 404 (not 403) so a non-owner can't even confirm the attachment exists.
        raise Http404

    file_path = attachment.file.name  # e.g. "expense_receipts/abc.pdf"
    local_path = Path(settings.MEDIA_ROOT) / file_path
    if not local_path.is_file():
        from apps.backup.s3 import download_file, is_enabled

        if not (is_enabled() and download_file(file_path)):
            raise Http404

    response = serve(request, file_path, document_root=settings.MEDIA_ROOT)
    # Force a download instead of inline rendering. nosniff alone is NOT enough:
    # a resident could upload an .html/.svg "receipt" that serve() hands back
    # with a genuine text/html / image/svg+xml Content-Type, which the browser
    # would execute same-origin when the treasurer opens it (stored XSS → JWT
    # theft). Content-Disposition: attachment makes the browser save it instead.
    response["Content-Disposition"] = _attachment_disposition(attachment.name)
    # Belt-and-braces: also stop the browser MIME-sniffing the bytes.
    response["X-Content-Type-Options"] = "nosniff"
    patch_cache_control(response, private=True, max_age=3600)
    return response


def expense_combined_pdf(request: HttpRequest, pk: int) -> HttpResponse:
    """Serve every bilag on one expense merged into a single PDF.

    The accounting program takes only one attachment per udlæg, so the
    treasurer needs the receipts and the approval as one file. Built on the fly
    (never stored) so it always matches the current attachments, and — like the
    single-file download — a plain Django view authenticated by the session
    cookie, so the frontend can link straight to it.
    """
    if not request.user.is_authenticated:
        response = HttpResponse(status=401)
        response["Cache-Control"] = "private, no-store"
        return response

    try:
        expense = Expense.objects.prefetch_related("attachments").get(pk=pk)
    except Expense.DoesNotExist as exc:
        raise Http404 from exc

    user = request.user
    if not (expense.submitted_by_id == user.id or _can_view_expense(user, expense)):
        # 404 (not 403) so a non-owner can't even confirm the expense exists.
        raise Http404

    attachments = list(expense.attachments.all())
    if not attachments:
        raise Http404

    from .pdf import build_combined_pdf, combined_pdf_name

    pdf_bytes = build_combined_pdf([(a.name, _read_attachment_bytes(a)) for a in attachments])

    response = HttpResponse(pdf_bytes, content_type="application/pdf")
    response["Content-Disposition"] = _attachment_disposition(combined_pdf_name(expense.id))
    response["X-Content-Type-Options"] = "nosniff"
    # Regenerated on every request: the attachments can change while the udlæg
    # is pending, and a stale cached merge would mislead the treasurer.
    patch_cache_control(response, private=True, no_store=True)
    return response


# --- Admin (treasurer) views -------------------------------------------------

ADMIN_PAGE_SIZE = 20


class IsEconomyAdmin(permissions.BasePermission):
    """Allow access to staff or users with is_economy_admin set.

    Economy admins (the treasurer) — distinct from regular site admins — manage
    expense reimbursements. Staff implicitly have the privilege via
    ``User.has_economy_admin``.
    """

    def has_permission(self, request: Request, view: Any) -> bool:
        u = request.user
        return bool(u and u.is_authenticated and u.has_economy_admin)


class IsExpenseAdmin(permissions.BasePermission):
    """Allow economy admins (full access) or food admins (read-only).

    Food admins may *view* the udlæg flagged ``food_related`` so they can keep
    track of fællesmad expenses, but only economy admins change status. The
    food-related restriction itself is enforced in ``_filter_admin_expenses``.
    """

    def has_permission(self, request: Request, view: Any) -> bool:
        u = request.user
        return bool(u and u.is_authenticated and (u.has_economy_admin or u.has_food_admin))


def _filter_admin_expenses(request: Request) -> QuerySet[Expense]:
    """Apply the shared status/user/date filters used by list and export.

    Food-admin-only users (no economy role) are restricted to ``food_related``
    expenses; economy admins see everything and may opt into the same filter
    via the ``food_related`` query param.
    """
    qs = Expense.objects.select_related("submitted_by", "processed_by").prefetch_related(
        "attachments"
    )

    if not request.user.has_economy_admin:
        # Food-admin-only: never expose non-food expenses.
        qs = qs.filter(food_related=True)
    else:
        food_param = request.query_params.get("food_related")
        if food_param in ("true", "1"):
            qs = qs.filter(food_related=True)
        elif food_param in ("false", "0"):
            qs = qs.filter(food_related=False)

    status_param = request.query_params.get("status")
    if status_param in Expense.Status.values:
        qs = qs.filter(status=status_param)

    user_param = request.query_params.get("user")
    if user_param:
        try:
            qs = qs.filter(submitted_by_id=int(user_param))
        except (TypeError, ValueError) as exc:
            raise ValidationError({"user": "Ugyldigt bruger-id."}) from exc

    from_param = request.query_params.get("from")
    if from_param:
        try:
            qs = qs.filter(created_at__date__gte=datetime.strptime(from_param, "%Y-%m-%d").date())
        except ValueError as exc:
            raise ValidationError({"from": "Ugyldig dato. Brug ÅÅÅÅ-MM-DD."}) from exc

    to_param = request.query_params.get("to")
    if to_param:
        try:
            qs = qs.filter(created_at__date__lte=datetime.strptime(to_param, "%Y-%m-%d").date())
        except ValueError as exc:
            raise ValidationError({"to": "Ugyldig dato. Brug ÅÅÅÅ-MM-DD."}) from exc

    ordering = request.query_params.get("ordering", "-created_at")
    allowed = {
        "created_at",
        "-created_at",
        "amount",
        "-amount",
        "status",
        "-status",
        "submitted_by__first_name",
        "-submitted_by__first_name",
    }
    if ordering in allowed:
        qs = qs.order_by(ordering)
    return qs


class AdminExpenseListView(APIView):
    """List all expenses, paginated, with a summed total.

    ``total`` is summed over the whole filtered set, not just the current page,
    so the treasurer always sees the grand total for the active filter. Food
    admins see only the ``food_related`` subset (read-only).
    """

    permission_classes = [IsExpenseAdmin]

    def get(self, request: Request) -> Response:
        qs = _filter_admin_expenses(request)
        total = (qs.aggregate(total=Sum("amount"))["total"] or Decimal("0")).quantize(
            Decimal("0.01")
        )
        paginator = Paginator(qs, ADMIN_PAGE_SIZE)
        # get_page() clamps non-integer/out-of-range values to a valid page
        # (e.g. when marking the last item on a page as paid drops the count).
        page_obj = paginator.get_page(request.query_params.get("page"))
        data = ExpenseSerializer(page_obj.object_list, many=True, context={"request": request}).data
        return Response(
            {
                "results": data,
                "total": str(total),
                "count": paginator.count,
                "page": page_obj.number,
                "num_pages": paginator.num_pages,
            }
        )


class AdminExpenseStatusView(APIView):
    """Set an expense's status to paid/rejected/pending (staff only)."""

    permission_classes = [IsEconomyAdmin]

    def patch(self, request: Request, pk: int) -> Response:
        expense = generics.get_object_or_404(Expense, pk=pk)
        old_status = expense.status
        serializer = ExpenseAdminUpdateSerializer(expense, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        new_status = serializer.validated_data.get("status", expense.status)
        expense = serializer.save(processed_by=request.user)
        if new_status == Expense.Status.PAID:
            expense.paid_at = expense.paid_at or timezone.now()
        else:
            expense.paid_at = None
        expense.save(update_fields=["paid_at"])

        # Tell the submitter once their expense is settled. Only on an actual
        # transition into paid/rejected, so editing the note on an already-paid
        # expense (or resetting to pending) doesn't re-notify.
        if new_status != old_status and new_status in (
            Expense.Status.PAID,
            Expense.Status.REJECTED,
        ):
            from apps.notifications.services import notify_expense_processed

            notify_expense_processed(expense)

        out = ExpenseSerializer(expense, context={"request": request})
        return Response(out.data)


class AdminExpenseExportView(APIView):
    """Export the filtered expenses as CSV.

    Food admins export only the ``food_related`` subset (see filter).
    """

    permission_classes = [IsExpenseAdmin]

    def get(self, request: Request) -> HttpResponse:
        qs = _filter_admin_expenses(request)

        buf = io.StringIO()
        # UTF-8 BOM so Excel renders æøå and names correctly.
        buf.write("﻿")
        writer = csv.writer(buf, delimiter=";")
        writer.writerow(
            [
                "Dato",
                "Navn",
                "Reg. nr.",
                "Kontonummer",
                "Beløb",
                "Beskrivelse",
                "Fællesmad",
                "Status",
                "Udbetalt dato",
                "Note",
            ]
        )
        for e in qs:
            name = e.submitted_by.get_full_name() if e.submitted_by else "Ukendt"
            writer.writerow(
                _csv_safe(cell)
                for cell in (
                    timezone.localtime(e.created_at).strftime("%Y-%m-%d"),
                    name,
                    e.reg_nr,
                    e.account_number,
                    f"{e.amount:.2f}".replace(".", ","),
                    e.description,
                    "Ja" if e.food_related else "Nej",
                    e.get_status_display(),
                    timezone.localtime(e.paid_at).strftime("%Y-%m-%d") if e.paid_at else "",
                    e.admin_note,
                )
            )

        today = timezone.localdate().isoformat()
        resp = HttpResponse(buf.getvalue(), content_type="text/csv; charset=utf-8")
        resp["Content-Disposition"] = f'attachment; filename="udlaeg_{today}.csv"'
        return resp
