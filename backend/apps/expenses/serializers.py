"""
Serializers for the Expenses (Udlæg) app.
"""

import re

from rest_framework import serializers

from apps.users.models import User
from apps.users.serializer_mixins import AvatarUrlMixin

from .models import Expense, ExpenseAttachment

_REG_NR_RE = re.compile(r"^\d{4}$")
_ACCOUNT_RE = re.compile(r"^\d{1,10}$")


class SubmitterSerializer(AvatarUrlMixin, serializers.ModelSerializer):
    """Minimal serializer for the resident who submitted an expense."""

    class Meta:
        model = User
        fields = ["id", "first_name", "last_name", "profile_picture"]


class ExpenseAttachmentSerializer(serializers.ModelSerializer):
    """Read serializer exposing a permission-checked download URL."""

    download_url = serializers.SerializerMethodField()

    class Meta:
        model = ExpenseAttachment
        fields = ["id", "name", "download_url"]

    def get_download_url(self, obj: ExpenseAttachment) -> str:
        return f"/api/expenses/attachments/{obj.id}/download/"


class ExpenseSerializer(serializers.ModelSerializer):
    """Read serializer for an expense, including nested attachments."""

    submitted_by = SubmitterSerializer(read_only=True)
    attachments = ExpenseAttachmentSerializer(many=True, read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    combined_pdf_url = serializers.SerializerMethodField()

    def get_combined_pdf_url(self, obj: Expense) -> str | None:
        """URL to all bilag merged into one PDF — only when there are several.

        The accounting program accepts a single attachment per udlæg, so the
        merge is what the treasurer actually files. With one bilag there is
        nothing to merge and the frontend hides the link.
        """
        # obj.attachments is prefetched everywhere this serializer is used.
        if len(obj.attachments.all()) < 2:
            return None
        return f"/api/expenses/{obj.id}/bilag.pdf"

    class Meta:
        model = Expense
        fields = [
            "id",
            "submitted_by",
            "reg_nr",
            "account_number",
            "amount",
            "description",
            "approval_reference",
            "food_related",
            "status",
            "status_display",
            "admin_note",
            "paid_at",
            "created_at",
            "updated_at",
            "attachments",
            "combined_pdf_url",
        ]


class ExpenseCreateUpdateSerializer(serializers.ModelSerializer):
    """Serializer for creating/editing an expense (resident-owned fields)."""

    class Meta:
        model = Expense
        fields = [
            "reg_nr",
            "account_number",
            "amount",
            "description",
            "approval_reference",
            "food_related",
        ]

    def validate_reg_nr(self, value: str) -> str:
        value = value.strip()
        if not _REG_NR_RE.match(value):
            raise serializers.ValidationError("Reg. nr. skal være 4 cifre.")
        return value

    def validate_account_number(self, value: str) -> str:
        value = value.strip()
        if not _ACCOUNT_RE.match(value):
            raise serializers.ValidationError("Kontonummer skal være 1-10 cifre.")
        return value


class ExpenseAdminUpdateSerializer(serializers.ModelSerializer):
    """Serializer for an admin setting an expense's status."""

    class Meta:
        model = Expense
        fields = ["status", "admin_note"]

    def validate(self, attrs: dict) -> dict:
        status = attrs.get("status", getattr(self.instance, "status", None))
        admin_note = attrs.get("admin_note", getattr(self.instance, "admin_note", ""))
        if status == Expense.Status.REJECTED and not (admin_note or "").strip():
            raise serializers.ValidationError(
                {"admin_note": "Angiv en begrundelse når et udlæg afvises."}
            )
        return attrs
