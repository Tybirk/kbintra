"""
Serializers for the Indrapportering app.
"""

from typing import Any

from rest_framework import serializers

from apps.backup.signing import signed_media_url
from apps.forum.models import Subgroup
from apps.users.models import User
from apps.users.serializer_mixins import AvatarUrlMixin

from .models import Report, ReportEvent, ReportPhoto
from .services import is_caseworker


class ReporterSerializer(AvatarUrlMixin, serializers.ModelSerializer):
    """Minimal serializer for the resident who reported or commented."""

    class Meta:
        model = User
        fields = ["id", "first_name", "last_name", "profile_picture"]


class ReportSubgroupSerializer(serializers.ModelSerializer):
    """Just enough of the udvalg to label and link a case."""

    class Meta:
        model = Subgroup
        fields = ["id", "name", "slug"]


class ReportPhotoSerializer(serializers.ModelSerializer):
    """A report photo, with signed URLs for the full image and its thumbnail."""

    image_url = serializers.SerializerMethodField()
    thumbnail_url = serializers.SerializerMethodField()

    class Meta:
        model = ReportPhoto
        fields = ["id", "name", "image_url", "thumbnail_url", "uploaded_at"]

    def get_image_url(self, obj: ReportPhoto) -> str:
        return signed_media_url(obj.image.url) if obj.image else ""

    def get_thumbnail_url(self, obj: ReportPhoto) -> str:
        """Thumbnail if it exists, else the original.

        Falling back keeps the frontend simple: it always reads thumbnail_url and
        gets something sensible whether or not the background task has run yet.
        """
        if obj.thumbnail:
            return signed_media_url(obj.thumbnail.url)
        return signed_media_url(obj.image.url) if obj.image else ""


class ReportEventSerializer(serializers.ModelSerializer):
    """One entry in a case's log."""

    author = ReporterSerializer(read_only=True)
    old_status_display = serializers.SerializerMethodField()
    new_status_display = serializers.SerializerMethodField()

    class Meta:
        model = ReportEvent
        fields = [
            "id",
            "kind",
            "author",
            "old_status",
            "new_status",
            "old_status_display",
            "new_status_display",
            "message",
            "created_at",
        ]

    def get_old_status_display(self, obj: ReportEvent) -> str:
        return _status_label(obj.old_status)

    def get_new_status_display(self, obj: ReportEvent) -> str:
        return _status_label(obj.new_status)


def _status_label(value: str) -> str:
    """Danish label for a stored status value, or "" when unset."""
    if not value:
        return ""
    return dict(Report.Status.choices).get(value, value)


class ReportSerializer(serializers.ModelSerializer):
    """Read serializer for a case in the list."""

    subgroup = ReportSubgroupSerializer(read_only=True)
    submitted_by = ReporterSerializer(read_only=True)
    photos = ReportPhotoSerializer(many=True, read_only=True)
    kind_display = serializers.CharField(source="get_kind_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    reporter_name = serializers.CharField(read_only=True)
    comment_count = serializers.SerializerMethodField()
    can_manage = serializers.SerializerMethodField()
    can_edit = serializers.SerializerMethodField()
    url = serializers.SerializerMethodField()

    class Meta:
        model = Report
        fields = [
            "id",
            "number",
            "subgroup",
            "kind",
            "kind_display",
            "status",
            "status_display",
            "description",
            "location",
            "submitted_by",
            "reporter_name",
            "legacy_url",
            "photos",
            "comment_count",
            "can_manage",
            "can_edit",
            "url",
            "created_at",
            "updated_at",
            "closed_at",
        ]

    def get_comment_count(self, obj: Report) -> int:
        return sum(1 for e in obj.events.all() if e.kind == ReportEvent.Kind.COMMENT)

    def get_can_manage(self, obj: Report) -> bool:
        """Whether the requesting user may change this case's status."""
        request = self.context.get("request")
        return bool(request and is_caseworker(request.user, obj))

    def get_can_edit(self, obj: Report) -> bool:
        """Whether the requesting user may edit or delete the case itself.

        The reporter may, while nobody has started working on it; staff always.
        """
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return False
        if request.user.is_staff:
            return True
        return obj.submitted_by_id == request.user.id and obj.status == Report.Status.NEW

    def get_url(self, obj: Report) -> str:
        return f"/indrapportering/{obj.subgroup.slug}/{obj.number}"


class ReportDetailSerializer(ReportSerializer):
    """Read serializer for one case, including its full log."""

    events = ReportEventSerializer(many=True, read_only=True)

    class Meta(ReportSerializer.Meta):
        fields = [*ReportSerializer.Meta.fields, "events"]


class ReportCreateSerializer(serializers.Serializer):
    """Validate a new report. Photos are handled separately from request.FILES."""

    subgroup = serializers.SlugRelatedField(
        slug_field="slug",
        queryset=Subgroup.objects.filter(reporting_enabled=True),
        error_messages={
            "does_not_exist": "Denne gruppe modtager ikke indrapporteringer.",
        },
    )
    kind = serializers.ChoiceField(choices=Report.Kind.choices)
    description = serializers.CharField()
    location = serializers.CharField(required=False, allow_blank=True, max_length=200)

    def validate_description(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Skriv en beskrivelse af hvad der er sket.")
        return value


class ReportUpdateSerializer(serializers.ModelSerializer):
    """Fields the reporter may correct while the case is still new."""

    class Meta:
        model = Report
        fields = ["kind", "description", "location"]

    def validate_description(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Skriv en beskrivelse af hvad der er sket.")
        return value


class ReportEventCreateSerializer(serializers.Serializer):
    """A status change, a comment, or both at once."""

    status = serializers.ChoiceField(choices=Report.Status.choices, required=False)
    message = serializers.CharField(required=False, allow_blank=True)

    def validate(self, attrs: dict) -> dict:
        status = attrs.get("status")
        message = (attrs.get("message") or "").strip()
        if not status and not message:
            raise serializers.ValidationError("Skriv en besked eller vælg en ny status.")
        attrs["message"] = message
        return attrs


def report_queryset() -> Any:
    """Base queryset with everything the serializers touch prefetched."""
    return Report.objects.select_related("subgroup", "submitted_by").prefetch_related(
        "photos", "events__author"
    )
