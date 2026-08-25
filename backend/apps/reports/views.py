"""
Views for the Indrapportering app.

Every resident may read the whole queue and comment on any case — the point of
moving this in from Driftsudvalgets standalone app was that people can follow
the cases. Only the target udvalg's own members (and staff) move a case through
its statuses; only the reporter may correct their own case, and only while
nobody has started working on it.
"""

import csv
import io

from django.core.paginator import Paginator
from django.db.models import Q, QuerySet
from django.http import Http404, HttpResponse
from django.utils import timezone
from PIL import Image
from rest_framework import generics, permissions, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.forum.image_processing import is_image_attachment
from apps.forum.models import Subgroup
from apps.forum.utils import validate_file_size

from .models import Report, ReportPhoto
from .serializers import (
    ReportCreateSerializer,
    ReportDetailSerializer,
    ReportEventCreateSerializer,
    ReportSerializer,
    ReportSubgroupSerializer,
    ReportUpdateSerializer,
    report_queryset,
)
from .services import add_event, add_photo, create_report, is_caseworker, reporting_subgroups

PAGE_SIZE = 20

# Cap per case so a queue of photos can't run away with the media volume. A
# phone photo is 2-5 MB, so this is generous for "vis hvad der er i stykker".
MAX_PHOTOS_PER_REPORT = 10


def _csv_safe(value: object) -> str:
    """Neutralize CSV/formula injection before writing a cell.

    Same reasoning as ``apps.expenses.views._csv_safe``: a field beginning with
    =, +, -, @ (or a leading tab/CR) is read as a formula by Excel/Sheets, and
    these cells carry resident-supplied text.
    """
    text = "" if value is None else str(value)
    if text and text[0] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + text
    return text


def _get_report(subgroup_slug: str, number: int) -> Report:
    """Fetch one case by udvalg slug and case number, or 404."""
    report = report_queryset().filter(subgroup__slug=subgroup_slug, number=number).first()
    if report is None:
        raise Http404
    return report


def _validate_photo_is_image(upload: object) -> None:
    """Reject anything that is not an image we can actually display.

    Two checks, because either alone lets something through. The extension
    allowlist is the app's own notion of an image (``is_image_attachment``
    includes HEIC/HEIF, which is what an iPhone hands over) and gives a Danish
    error naming the file; Pillow's ``verify()`` then catches a PDF renamed to
    .jpg.

    This has to live here because ``add_photo`` writes the row with
    ``objects.create()``, which never calls ``full_clean()`` — so ImageField's
    own validation does not run. Without it a .txt was stored happily and left a
    broken tile on the case forever.
    """
    name = getattr(upload, "name", "") or "filen"
    if not is_image_attachment(name):
        raise ValidationError(
            {"photos": f"'{name}' er ikke et billede. Vedhæft et foto — fx JPG, PNG eller HEIC."}
        )
    try:
        Image.open(upload).verify()
    except Exception as exc:  # Pillow raises a wide range for malformed input
        raise ValidationError(
            {"photos": f"'{name}' kunne ikke læses som et billede. Prøv et andet foto."}
        ) from exc
    finally:
        # verify() consumes the stream; storage needs to read it from the top.
        upload.seek(0)


def _validate_photos(uploads: list, existing: int = 0) -> None:
    """Check count, size and type before anything is written to storage."""
    if not uploads:
        return
    if existing + len(uploads) > MAX_PHOTOS_PER_REPORT:
        raise ValidationError(
            {"photos": f"Der kan højst være {MAX_PHOTOS_PER_REPORT} billeder på en sag."}
        )
    for upload in uploads:
        validate_file_size(upload)
        _validate_photo_is_image(upload)


class ReportingSubgroupsView(APIView):
    """The udvalg that accept reports — drives the form's 'Til:' field."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request: Request) -> Response:
        data = ReportSubgroupSerializer(reporting_subgroups(), many=True).data
        return Response(data)


class ReportListCreateView(APIView):
    """List the whole queue (filtered) or file a new report."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request: Request) -> Response:
        qs = self._filtered(request)
        paginator = Paginator(qs, PAGE_SIZE)
        # get_page clamps out-of-range values, so closing the last case on a page
        # doesn't strand the client on a page that no longer exists.
        page_obj = paginator.get_page(request.query_params.get("page"))
        data = ReportSerializer(page_obj.object_list, many=True, context={"request": request}).data
        return Response(
            {
                "results": data,
                "count": paginator.count,
                "page": page_obj.number,
                "num_pages": paginator.num_pages,
                "open_count": qs.exclude(status__in=Report.CLOSED_STATUSES).count(),
            }
        )

    def post(self, request: Request) -> Response:
        serializer = ReportCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        uploads = request.FILES.getlist("photos")
        _validate_photos(uploads)

        report = create_report(
            subgroup=serializer.validated_data["subgroup"],
            kind=serializer.validated_data["kind"],
            description=serializer.validated_data["description"],
            location=serializer.validated_data.get("location", ""),
            submitted_by=request.user,
            photos=uploads,
        )
        out = ReportDetailSerializer(
            _get_report(report.subgroup.slug, report.number), context={"request": request}
        )
        return Response(out.data, status=status.HTTP_201_CREATED)

    def _filtered(self, request: Request) -> QuerySet[Report]:
        qs = report_queryset()

        subgroup_slug = request.query_params.get("subgroup")
        if subgroup_slug:
            qs = qs.filter(subgroup__slug=subgroup_slug)

        status_param = request.query_params.get("status")
        if status_param == "open":
            qs = qs.exclude(status__in=Report.CLOSED_STATUSES)
        elif status_param in Report.Status.values:
            qs = qs.filter(status=status_param)

        kind_param = request.query_params.get("kind")
        if kind_param in Report.Kind.values:
            qs = qs.filter(kind=kind_param)

        if request.query_params.get("mine") in ("true", "1"):
            qs = qs.filter(submitted_by=request.user)

        query = (request.query_params.get("q") or "").strip()
        if query:
            qs = qs.filter(
                Q(description__icontains=query)
                | Q(location__icontains=query)
                | Q(submitted_by__first_name__icontains=query)
                | Q(submitted_by__last_name__icontains=query)
                | Q(legacy_reporter_name__icontains=query)
            )
        return qs


class ReportDetailView(APIView):
    """Read, correct or withdraw one case."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request: Request, subgroup_slug: str, number: int) -> Response:
        report = _get_report(subgroup_slug, number)
        return Response(ReportDetailSerializer(report, context={"request": request}).data)

    def patch(self, request: Request, subgroup_slug: str, number: int) -> Response:
        report = _get_report(subgroup_slug, number)
        self._check_can_edit(request, report)
        serializer = ReportUpdateSerializer(report, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        report = _get_report(subgroup_slug, number)
        return Response(ReportDetailSerializer(report, context={"request": request}).data)

    def delete(self, request: Request, subgroup_slug: str, number: int) -> Response:
        report = _get_report(subgroup_slug, number)
        self._check_can_edit(request, report)
        report.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @staticmethod
    def _check_can_edit(request: Request, report: Report) -> None:
        """Only the reporter, and only before the udvalg has started on it."""
        if request.user.is_staff:
            return
        if report.submitted_by_id != request.user.id:
            raise PermissionDenied("Du kan kun rette dine egne indrapporteringer.")
        if report.status != Report.Status.NEW:
            raise PermissionDenied(
                "Sagen kan ikke ændres, når udvalget er begyndt at behandle den."
            )


class ReportEventView(APIView):
    """Add a comment and/or change a case's status."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request, subgroup_slug: str, number: int) -> Response:
        report = _get_report(subgroup_slug, number)
        serializer = ReportEventCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        new_status = serializer.validated_data.get("status")

        if new_status and new_status != report.status and not is_caseworker(request.user, report):
            raise PermissionDenied("Kun udvalgets medlemmer kan ændre status på en sag.")

        add_event(
            report=report,
            author=request.user,
            new_status=new_status,
            message=serializer.validated_data.get("message", ""),
        )
        report = _get_report(subgroup_slug, number)
        return Response(
            ReportDetailSerializer(report, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class ReportPhotoView(APIView):
    """Add photos to (POST) or remove one from (DELETE) a case."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request: Request, subgroup_slug: str, number: int) -> Response:
        report = _get_report(subgroup_slug, number)
        ReportDetailView._check_can_edit(request, report)
        uploads = request.FILES.getlist("photos")
        if not uploads:
            raise ValidationError({"photos": "Ingen fil modtaget."})
        _validate_photos(uploads, existing=report.photos.count())
        for upload in uploads:
            add_photo(report, upload)
        report = _get_report(subgroup_slug, number)
        return Response(
            ReportDetailSerializer(report, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )

    def delete(self, request: Request, pk: int) -> Response:
        photo = generics.get_object_or_404(ReportPhoto.objects.select_related("report"), pk=pk)
        ReportDetailView._check_can_edit(request, photo.report)
        photo.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ReportExportView(APIView):
    """Export one udvalg's queue as CSV, for its own members.

    Driftsudvalget worked from spreadsheet exports before this app existed;
    keeping that possible is cheaper than arguing about it.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request: Request) -> HttpResponse:
        slug = request.query_params.get("subgroup")
        if not slug:
            raise ValidationError({"subgroup": "Angiv hvilket udvalg der skal eksporteres."})
        subgroup = generics.get_object_or_404(Subgroup, slug=slug, reporting_enabled=True)

        probe = Report(subgroup=subgroup)
        if not is_caseworker(request.user, probe):
            raise PermissionDenied("Kun udvalgets medlemmer kan eksportere sagerne.")

        qs = report_queryset().filter(subgroup=subgroup).order_by("number")

        buf = io.StringIO()
        # UTF-8 BOM so Excel renders æøå correctly.
        buf.write("﻿")
        writer = csv.writer(buf, delimiter=";")
        writer.writerow(
            ["Nr.", "Dato", "Kategori", "Beskrivelse", "Hvor", "Navn", "Hus", "Status", "Afsluttet"]
        )
        for report in qs:
            house = ""
            if report.submitted_by and report.submitted_by.house:
                house = report.submitted_by.house.name
            writer.writerow(
                _csv_safe(cell)
                for cell in (
                    report.number,
                    timezone.localtime(report.created_at).strftime("%Y-%m-%d"),
                    report.get_kind_display(),
                    report.description,
                    report.location,
                    report.reporter_name,
                    house,
                    report.get_status_display(),
                    timezone.localtime(report.closed_at).strftime("%Y-%m-%d")
                    if report.closed_at
                    else "",
                )
            )

        today = timezone.localdate().isoformat()
        resp = HttpResponse(buf.getvalue(), content_type="text/csv; charset=utf-8")
        resp["Content-Disposition"] = f'attachment; filename="indrapporteringer_{slug}_{today}.csv"'
        return resp
