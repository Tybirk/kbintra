"""
URL configuration for the Indrapportering app.

Cases are addressed by udvalg slug and case number — ``driftsudvalget/14`` — so
URLs stay readable and the ``#n`` people actually say out loud is the thing in
the address bar.
"""

from django.urls import path

from .views import (
    ReportDetailView,
    ReportEventView,
    ReportExportView,
    ReportingSubgroupsView,
    ReportListCreateView,
    ReportPhotoView,
)

urlpatterns = [
    path("", ReportListCreateView.as_view(), name="report-list-create"),
    path("subgroups/", ReportingSubgroupsView.as_view(), name="report-subgroups"),
    path("export/", ReportExportView.as_view(), name="report-export"),
    # Before the <subgroup_slug>/<number>/ patterns: "photos" is a valid slug and
    # a photo id a valid number, so this would otherwise be shadowed.
    path("photos/<int:pk>/", ReportPhotoView.as_view(), name="report-photo-delete"),
    path("<slug:subgroup_slug>/<int:number>/", ReportDetailView.as_view(), name="report-detail"),
    path(
        "<slug:subgroup_slug>/<int:number>/events/",
        ReportEventView.as_view(),
        name="report-event",
    ),
    path(
        "<slug:subgroup_slug>/<int:number>/photos/",
        ReportPhotoView.as_view(),
        name="report-photo-add",
    ),
]
