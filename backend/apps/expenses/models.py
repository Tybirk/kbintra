"""
Models for the Expenses (Udlæg) app — resident expense reimbursements.

A resident who has bought something on the community's behalf submits an
``Expense`` with bank details, an amount, a description and one or more
attachments (receipt / written approval). A treasurer (staff) reviews it and
marks it paid or rejected.

Attachment files are private financial documents: they live under MEDIA_ROOT
(so the S3 backup covers them) but the ``expense_receipts/`` prefix is blocked
in ``apps.backup.views.serve_media``. They are only reachable through the
permission-checked ``ExpenseAttachmentDownloadView``.
"""

from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models


class Expense(models.Model):
    """A single expense reimbursement request (udlæg)."""

    class Status(models.TextChoices):
        PENDING = "pending", "Afventer"
        PAID = "paid", "Udbetalt"
        REJECTED = "rejected", "Afvist"

    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        related_name="expenses",
    )
    reg_nr = models.CharField(max_length=10, help_text="Bank reg. nr. (4 cifre)")
    account_number = models.CharField(max_length=20, help_text="Kontonummer")
    amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.01"))],
        help_text="Beløb i DKK",
    )
    description = models.TextField(help_text="Hvad er købt og formålet")
    approval_reference = models.TextField(
        blank=True,
        help_text="Henvisning til skriftlig godkendelse (referat, mail, intranet).",
    )
    food_related = models.BooleanField(
        default=False,
        help_text="Udlæg i forbindelse med fællesmad — gør det synligt for madansvarlige.",
    )
    status = models.CharField(
        max_length=10,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
    )
    admin_note = models.TextField(
        blank=True,
        help_text="Begrundelse ved afvisning eller intern note.",
    )
    processed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="processed_expenses",
        help_text="Den administrator der markerede udlægget som udbetalt/afvist.",
    )
    paid_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        who = self.submitted_by.get_full_name() if self.submitted_by else "Ukendt"
        return f"{who} - {self.amount} kr ({self.get_status_display()})"


class ExpenseAttachment(models.Model):
    """A receipt or approval document attached to an expense."""

    expense = models.ForeignKey(
        Expense,
        on_delete=models.CASCADE,
        related_name="attachments",
    )
    file = models.FileField(upload_to="expense_receipts/")
    name = models.CharField(max_length=255)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["uploaded_at"]

    def __str__(self) -> str:
        return f"{self.name} ({self.expense_id})"

    def delete(self, *args: object, **kwargs: object) -> tuple:
        """Delete the file from storage when the model instance is deleted."""
        self.file.delete(save=False)
        return super().delete(*args, **kwargs)
