"""
Views for the car sharing (bildeling) app.

State transitions all use conditional updates (filter(...).update(...)) and check
the row count rather than read-modify-write, so a double-click or a resubmitted
request cannot settle the same loan twice.
"""

import datetime

from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import generics, permissions, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.houses.models import Car
from apps.notifications.services import (
    notify_car_loan_accepted,
    notify_car_loan_cancelled,
    notify_car_loan_candidate_closed,
    notify_car_loan_chosen,
    notify_car_loan_completed,
    notify_car_loan_declined,
    notify_car_loan_requested,
)

from .constants import (
    DEFAULT_RATE_PER_KM,
    LOAN_TERMS_TITLE,
    MAX_CANDIDATES_PER_LOAN,
    MAX_LOAN_DAYS,
    TERMS_VERSION,
    loan_terms_bullets,
    loan_terms_text,
)
from .models import CarBlock, CarLoan, CarLoanCandidate
from .realtime import broadcast_car_sharing_update, loan_audience
from .serializers import (
    CandidateRespondSerializer,
    CarBlockReplaceSerializer,
    CarBlockSerializer,
    CarLoanCreateSerializer,
    CarLoanSerializer,
    ChooseCandidateSerializer,
    CompleteLoanSerializer,
    PoolCarSerializer,
)
from .services import active_loan_conflict, pool_cars_with_availability, rate_for_car


def _parse_window(request) -> tuple[datetime.datetime, datetime.datetime]:
    """Read ?start=&end= as aware datetimes, defaulting to the next two hours."""
    from rest_framework.fields import DateTimeField

    field = DateTimeField()
    now = timezone.now()

    raw_start = request.query_params.get("start")
    raw_end = request.query_params.get("end")
    start_at = field.to_internal_value(raw_start) if raw_start else now
    end_at = field.to_internal_value(raw_end) if raw_end else start_at + datetime.timedelta(hours=2)

    if end_at <= start_at:
        raise ValidationError({"end": "Sluttidspunktet skal være efter starttidspunktet."})
    if end_at - start_at > datetime.timedelta(days=MAX_LOAN_DAYS):
        raise ValidationError({"end": f"Et lån kan højst vare {MAX_LOAN_DAYS} dage."})
    return start_at, end_at


class PoolCarListView(APIView):
    """GET /api/carsharing/cars/ — the pool with availability for a window."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        start_at, end_at = _parse_window(request)
        min_seats = request.query_params.get("seats")

        availability = pool_cars_with_availability(
            start_at,
            end_at,
            needs_isofix=request.query_params.get("isofix") == "true",
            needs_tow_hitch=request.query_params.get("tow") == "true",
            min_seats=int(min_seats) if min_seats and min_seats.isdigit() else None,
            exclude_house_id=request.user.house_id,
        )
        serializer = PoolCarSerializer(
            [item.car for item in availability],
            many=True,
            context={
                "request": request,
                "availability": {item.car.id: item for item in availability},
            },
        )
        return Response(
            {
                "start": start_at,
                "end": end_at,
                "default_rate_per_km": str(DEFAULT_RATE_PER_KM),
                "max_candidates": MAX_CANDIDATES_PER_LOAN,
                "cars": serializer.data,
            }
        )


class TermsView(APIView):
    """GET /api/carsharing/terms/ — the terms text, version and default rate."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response(
            {
                "version": TERMS_VERSION,
                "title": LOAN_TERMS_TITLE,
                "bullets": loan_terms_bullets(),
                "text": loan_terms_text(),
                "default_rate_per_km": str(DEFAULT_RATE_PER_KM),
            }
        )


class CarBlockListCreateView(generics.ListCreateAPIView):
    """The weekly schedule for one of your own household's cars."""

    serializer_class = CarBlockSerializer
    permission_classes = [permissions.IsAuthenticated]

    def _get_car(self) -> Car:
        user = self.request.user
        if not user.house_id:
            raise PermissionDenied("Du skal være tilknyttet et hus.")
        return get_object_or_404(Car, pk=self.kwargs["pk"], house_id=user.house_id)

    def get_queryset(self):
        return CarBlock.objects.filter(car=self._get_car())

    def perform_create(self, serializer):
        serializer.save(car=self._get_car())

    def put(self, request, *args, **kwargs):
        """Replace the whole schedule — what the painting grid sends."""
        car = self._get_car()
        serializer = CarBlockReplaceSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        with transaction.atomic():
            car.blocks.all().delete()
            CarBlock.objects.bulk_create(
                [
                    CarBlock(
                        car=car,
                        days_of_week=block["days_of_week"],
                        start_time=block["start_time"],
                        end_time=block["end_time"],
                    )
                    for block in serializer.validated_data["blocks"]
                ]
            )

        return Response(CarBlockSerializer(car.blocks.all(), many=True).data)


class CarBlockDeleteView(generics.DestroyAPIView):
    """Remove a weekly window from your own household's car."""

    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if not user.house_id:
            return CarBlock.objects.none()
        return CarBlock.objects.filter(car__house_id=user.house_id)


class CarLoanListCreateView(generics.ListCreateAPIView):
    """Your own loans, plus requests aimed at your household's cars."""

    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self):
        if self.request.method == "POST":
            return CarLoanCreateSerializer
        return CarLoanSerializer

    def get_queryset(self):
        user = self.request.user
        visible = Q(borrower=user)
        if user.house_id:
            visible |= Q(candidates__car__house_id=user.house_id)
        return (
            CarLoan.objects.filter(visible)
            .select_related("borrower", "car", "car__house")
            .prefetch_related("candidates__car__house")
            .distinct()
        )

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        loan = serializer.save()
        notify_car_loan_requested(loan)
        broadcast_car_sharing_update(loan_audience(loan))
        return Response(
            CarLoanSerializer(loan, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class CarLoanDetailView(generics.RetrieveAPIView):
    """One loan — visible to the borrower and to every asked household."""

    serializer_class = CarLoanSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        visible = Q(borrower=user)
        if user.house_id:
            visible |= Q(candidates__car__house_id=user.house_id)
        return (
            CarLoan.objects.filter(visible)
            .select_related("borrower", "car", "car__house")
            .prefetch_related("candidates__car__house")
            .distinct()
        )


class CandidateRespondView(APIView):
    """Owner answers a request about their car: accept (an offer) or decline."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk, candidate_pk):
        serializer = CandidateRespondSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        action = serializer.validated_data["action"]

        user = request.user
        if not user.house_id:
            raise PermissionDenied("Du skal være tilknyttet et hus.")

        candidate = get_object_or_404(
            CarLoanCandidate.objects.select_related("loan", "car"),
            pk=candidate_pk,
            loan_id=pk,
            car__house_id=user.house_id,
        )
        if candidate.loan.status != CarLoan.Status.REQUESTED:
            raise ValidationError("Forespørgslen er ikke længere åben.")

        new_status = (
            CarLoanCandidate.Status.ACCEPTED
            if action == "accept"
            else CarLoanCandidate.Status.DECLINED
        )
        updated = CarLoanCandidate.objects.filter(
            pk=candidate.pk, status=CarLoanCandidate.Status.ASKED
        ).update(status=new_status, responded_by=user, responded_at=timezone.now())
        if not updated:
            raise ValidationError("Der er allerede svaret på denne forespørgsel.")

        candidate.refresh_from_db()
        if action == "accept":
            notify_car_loan_accepted(candidate)
        else:
            notify_car_loan_declined(candidate)
        broadcast_car_sharing_update(loan_audience(candidate.loan))

        return Response(CarLoanSerializer(candidate.loan, context={"request": request}).data)


class ChooseCandidateView(APIView):
    """Borrower picks one of the accepted offers, which starts the loan."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        serializer = ChooseCandidateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        candidate_pk = serializer.validated_data["candidate"]

        with transaction.atomic():
            loan = get_object_or_404(
                CarLoan.objects.select_related("borrower"),
                pk=pk,
                borrower=request.user,
            )
            if loan.status != CarLoan.Status.REQUESTED:
                raise ValidationError("Lånet er allerede afgjort.")

            candidate = get_object_or_404(
                CarLoanCandidate.objects.select_related("car"),
                pk=candidate_pk,
                loan=loan,
                status=CarLoanCandidate.Status.ACCEPTED,
            )

            # Two borrowers can independently be offered the same car for the
            # same window; the owner sees two offers and may accept both. The
            # guard against them both choosing it belongs here, on the server.
            if active_loan_conflict(
                candidate.car_id, loan.start_at, loan.end_at, exclude_loan_id=loan.pk
            ):
                raise ValidationError("Bilen er netop blevet udlånt i det tidsrum.")

            updated = CarLoan.objects.filter(pk=loan.pk, status=CarLoan.Status.REQUESTED).update(
                status=CarLoan.Status.ACTIVE,
                car=candidate.car,
                approved_by=candidate.responded_by,
                rate_per_km=rate_for_car(candidate.car),
                activated_at=timezone.now(),
            )
            if not updated:
                raise ValidationError("Lånet er allerede afgjort.")

            # Everyone else who said yes is released.
            closed = list(
                loan.candidates.select_related("car", "car__house")
                .filter(status=CarLoanCandidate.Status.ACCEPTED)
                .exclude(pk=candidate.pk)
            )
            CarLoanCandidate.objects.filter(pk__in=[c.pk for c in closed]).update(
                status=CarLoanCandidate.Status.CLOSED
            )
            loan.refresh_from_db()

        notify_car_loan_chosen(loan)
        for released in closed:
            released.status = CarLoanCandidate.Status.CLOSED
            notify_car_loan_candidate_closed(released)
        broadcast_car_sharing_update(loan_audience(loan))

        return Response(CarLoanSerializer(loan, context={"request": request}).data)


class CompleteLoanView(APIView):
    """Borrower closes the loan: kilometres, expenses, damage note."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        serializer = CompleteLoanSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        with transaction.atomic():
            loan = get_object_or_404(CarLoan, pk=pk, borrower=request.user)
            if loan.status != CarLoan.Status.ACTIVE:
                raise ValidationError("Kun et aktivt lån kan afsluttes.")

            loan.actual_km = data["actual_km"]
            loan.expense_amount = data["expense_amount"]
            loan.expense_note = data["expense_note"]
            loan.damage_note = data["damage_note"]
            amount_due = loan.calculate_amount_due()

            updated = CarLoan.objects.filter(pk=loan.pk, status=CarLoan.Status.ACTIVE).update(
                status=CarLoan.Status.COMPLETED,
                actual_km=loan.actual_km,
                expense_amount=loan.expense_amount,
                expense_note=loan.expense_note,
                damage_note=loan.damage_note,
                amount_due=amount_due,
                completed_at=timezone.now(),
            )
            if not updated:
                raise ValidationError("Lånet er allerede afsluttet.")
            loan.refresh_from_db()

        notify_car_loan_completed(loan)
        broadcast_car_sharing_update(loan_audience(loan))
        return Response(CarLoanSerializer(loan, context={"request": request}).data)


class CancelLoanView(APIView):
    """Borrower may always cancel; an owner may cancel an active loan of their car."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        user = request.user
        with transaction.atomic():
            loan = get_object_or_404(CarLoan.objects.select_related("borrower", "car"), pk=pk)
            is_borrower = loan.borrower_id == user.id
            is_owner = (
                loan.car is not None
                and user.house_id is not None
                and loan.car.house_id == user.house_id
            )
            if not (is_borrower or is_owner):
                raise PermissionDenied("Du kan ikke aflyse dette lån.")
            if loan.status not in (CarLoan.Status.REQUESTED, CarLoan.Status.ACTIVE):
                raise ValidationError("Lånet kan ikke aflyses.")
            if is_owner and not is_borrower and loan.status != CarLoan.Status.ACTIVE:
                raise ValidationError("Svar på forespørgslen i stedet for at aflyse den.")

            updated = CarLoan.objects.filter(
                pk=loan.pk, status__in=[CarLoan.Status.REQUESTED, CarLoan.Status.ACTIVE]
            ).update(status=CarLoan.Status.CANCELLED)
            if not updated:
                raise ValidationError("Lånet kan ikke aflyses.")
            loan.refresh_from_db()

        notify_car_loan_cancelled(loan, user)
        broadcast_car_sharing_update(loan_audience(loan))
        return Response(CarLoanSerializer(loan, context={"request": request}).data)
