"""
URL configuration for the Expenses (Udlæg) app.
"""

from django.urls import path

from .views import (
    AdminExpenseExportView,
    AdminExpenseListView,
    AdminExpenseStatusView,
    ExpenseAttachmentView,
    ExpenseDetailView,
    ExpenseListCreateView,
    expense_attachment_download,
    expense_combined_pdf,
)

urlpatterns = [
    # Resident-facing
    path("", ExpenseListCreateView.as_view(), name="expense-list-create"),
    path("<int:pk>/", ExpenseDetailView.as_view(), name="expense-detail"),
    path("<int:pk>/attachments/", ExpenseAttachmentView.as_view(), name="expense-attachment-add"),
    path("<int:pk>/bilag.pdf", expense_combined_pdf, name="expense-combined-pdf"),
    path(
        "attachments/<int:pk>/",
        ExpenseAttachmentView.as_view(),
        name="expense-attachment-delete",
    ),
    path(
        "attachments/<int:pk>/download/",
        expense_attachment_download,
        name="expense-attachment-download",
    ),
    # Admin (treasurer)
    path("admin/", AdminExpenseListView.as_view(), name="expense-admin-list"),
    path("admin/export/", AdminExpenseExportView.as_view(), name="expense-admin-export"),
    path("<int:pk>/status/", AdminExpenseStatusView.as_view(), name="expense-admin-status"),
]
