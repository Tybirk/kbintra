"""
URL configuration for the car sharing (bildeling) app.
"""

from django.urls import path

from .views import (
    CancelLoanView,
    CandidateRespondView,
    CarBlockDeleteView,
    CarBlockListCreateView,
    CarLoanDetailView,
    CarLoanListCreateView,
    CompleteLoanView,
    SharedCarListView,
    TermsView,
)

urlpatterns = [
    path("cars/", SharedCarListView.as_view(), name="carsharing-car-list"),
    path("cars/<int:pk>/blocks/", CarBlockListCreateView.as_view(), name="carsharing-block-list"),
    path("blocks/<int:pk>/", CarBlockDeleteView.as_view(), name="carsharing-block-delete"),
    path("terms/", TermsView.as_view(), name="carsharing-terms"),
    path("loans/", CarLoanListCreateView.as_view(), name="carsharing-loan-list"),
    path("loans/<int:pk>/", CarLoanDetailView.as_view(), name="carsharing-loan-detail"),
    path(
        "loans/<int:pk>/candidates/<int:candidate_pk>/respond/",
        CandidateRespondView.as_view(),
        name="carsharing-candidate-respond",
    ),
    path("loans/<int:pk>/complete/", CompleteLoanView.as_view(), name="carsharing-loan-complete"),
    path("loans/<int:pk>/cancel/", CancelLoanView.as_view(), name="carsharing-loan-cancel"),
]
