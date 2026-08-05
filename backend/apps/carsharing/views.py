"""
Views for the car sharing (bildeling) app.

State transitions all use conditional updates (filter(...).update(...)) and check
the row count rather than read-modify-write, so a double-click or a resubmitted
request cannot settle the same loan twice.
"""

import datetime

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import generics, permissions, status
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.houses.models import Car
from apps.notifications.services import (
    notify_car_loan_accepted,
    notify_car_loan_activated,
    notify_car_loan_cancelled,
    notify_car_loan_candidate_closed,
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
    loan_terms_sections,
    loan_terms_text,
)
from .models import CarBlock, CarLoan, CarLoanCandidate
from .realtime import broadcast_car_sharing_update, loan_audience
from .roles import LoanRole, can_cancel, loan_role
from .serializers import (
    CandidateRespondSerializer,
    CarBlockReplaceSerializer,
    CarBlockSerializer,
    CarLoanCreateSerializer,
    CarLoanSerializer,
    CompleteLoanSerializer,
    SharedCarSerializer,
)
from .services import (
    active_loan_conflict,
    rate_for_car,
    shared_cars_with_availability,
    visible_loans,
)


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


class SharedCarListView(APIView):
    """GET /api/carsharing/cars/ — the delebilpark with availability for a window."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        start_at, end_at = _parse_window(request)
        min_seats = request.query_params.get("seats")

        availability = shared_cars_with_availability(
            start_at,
            end_at,
            needs_isofix=request.query_params.get("isofix") == "true",
            needs_tow_hitch=request.query_params.get("tow") == "true",
            min_seats=int(min_seats) if min_seats and min_seats.isdigit() else None,
            exclude_house_id=request.user.house_id,
        )
        serializer = SharedCarSerializer(
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
                # Published so the client can warn before sending a doomed window
                # instead of hardcoding a third copy of the rule.
                "max_loan_days": MAX_LOAN_DAYS,
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
                "sections": loan_terms_sections(),
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
        return visible_loans(self.request.user)

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
        return visible_loans(self.request.user)


class CandidateRespondView(APIView):
    """Owner answers a request about their car.

    A yes is the whole decision: the borrower already picked which cars to ask,
    so the first owner to accept lends their car out immediately and everyone
    else is released. No second round, and nothing for the borrower to confirm.
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk, candidate_pk):
        serializer = CandidateRespondSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        action = serializer.validated_data["action"]

        user = request.user
        if not user.house_id:
            raise PermissionDenied("Du skal være tilknyttet et hus.")

        candidate = get_object_or_404(
            CarLoanCandidate.objects.select_related("loan", "loan__borrower", "car"),
            pk=candidate_pk,
            loan_id=pk,
            car__house_id=user.house_id,
        )

        # Both branches commit inside a transaction and only then notify: sending
        # mail from inside one risks telling people about a state that rolls back.
        if action == "accept":
            loan, released = self._accept(candidate, user)
            notify_car_loan_accepted(candidate)
            notify_car_loan_activated(loan, user)
            for item in released:
                notify_car_loan_candidate_closed(item)
        else:
            loan = self._decline(candidate, user)
            notify_car_loan_declined(candidate)

        broadcast_car_sharing_update(loan_audience(loan))
        return Response(CarLoanSerializer(loan, context={"request": request}).data)

    @staticmethod
    def _closed_reason(loan, candidate) -> str:
        """Why an answer arrived too late, in words that fit what happened.

        Read from the loan as it now stands rather than from a pre-check, because
        the interesting case — someone else was faster — is invisible until the
        conditional update has already lost the race.
        """
        if loan.status == CarLoan.Status.ACTIVE:
            if loan.car_id == candidate.car_id:
                return "Bilen er allerede udlånt."
            return (
                "En anden ejer var hurtigere — forespørgslen er lukket, og du skal ikke gøre mere."
            )
        if loan.status == CarLoan.Status.CANCELLED:
            return "Låneren har aflyst forespørgslen."
        if loan.status == CarLoan.Status.DECLINED:
            return "Forespørgslen er lukket — ingen kunne låne ud."
        return "Forespørgslen er ikke længere åben."

    def _decline(self, candidate, user):
        """A no from this household.

        The request stays open for the others — unless this was the last household
        that could still say yes, in which case the loan itself is finished and
        must say so instead of leaving the borrower waiting for nobody.
        """
        loan = candidate.loan
        with transaction.atomic():
            declined = CarLoanCandidate.objects.filter(
                pk=candidate.pk,
                status=CarLoanCandidate.Status.ASKED,
                loan__status=CarLoan.Status.REQUESTED,
            ).update(
                status=CarLoanCandidate.Status.DECLINED,
                responded_by=user,
                responded_at=timezone.now(),
            )
            if not declined:
                loan.refresh_from_db()
                if loan.status != CarLoan.Status.REQUESTED:
                    raise ValidationError(self._closed_reason(loan, candidate))
                raise ValidationError("Der er allerede svaret på denne forespørgsel.")

            nobody_left = not loan.candidates.filter(status=CarLoanCandidate.Status.ASKED).exists()
            if nobody_left:
                CarLoan.objects.filter(pk=loan.pk, status=CarLoan.Status.REQUESTED).update(
                    status=CarLoan.Status.DECLINED
                )
            loan.refresh_from_db()

        candidate.refresh_from_db()
        return loan

    def _accept(self, candidate, user):
        """A yes, which is the whole decision: the loan starts here.

        Returns the started loan and the candidates that were released, so the
        caller can tell those households they need not answer.
        """
        loan = candidate.loan
        with transaction.atomic():
            # The same car may already be promised to another borrower for an
            # overlapping window, so check before committing to this one.
            if active_loan_conflict(
                candidate.car_id, loan.start_at, loan.end_at, exclude_loan_id=loan.pk
            ):
                raise ValidationError("Bilen er netop blevet udlånt i det tidsrum.")

            # Claim the loan *first*, and let this conditional update be the only
            # gate. An earlier version pre-checked the status, which meant every
            # late accept — a sleeping phone, a background tab — reported the
            # generic "no longer open" and the reassuring message below was
            # effectively unreachable.
            claimed = CarLoan.objects.filter(pk=loan.pk, status=CarLoan.Status.REQUESTED).update(
                status=CarLoan.Status.ACTIVE,
                car=candidate.car,
                approved_by=user,
                rate_per_km=rate_for_car(candidate.car),
                owner_terms_version=candidate.car.terms_accepted_version,
                activated_at=timezone.now(),
            )
            if not claimed:
                loan.refresh_from_db()
                raise ValidationError(self._closed_reason(loan, candidate))

            # Only an unanswered candidate can become the accepted one. Raising
            # here rolls the claim above back, so a household that already said no
            # cannot quietly turn its own no into the yes that settles the loan.
            accepted = CarLoanCandidate.objects.filter(
                pk=candidate.pk, status=CarLoanCandidate.Status.ASKED
            ).update(
                status=CarLoanCandidate.Status.ACCEPTED,
                responded_by=user,
                responded_at=timezone.now(),
            )
            if not accepted:
                raise ValidationError("Der er allerede svaret på denne forespørgsel.")

            # Everyone still waiting is off the hook. A household that already
            # declined keeps that answer — it is a real one.
            released = list(
                loan.candidates.select_related("car", "car__house")
                .filter(status=CarLoanCandidate.Status.ASKED)
                .exclude(pk=candidate.pk)
            )
            CarLoanCandidate.objects.filter(pk__in=[item.pk for item in released]).update(
                status=CarLoanCandidate.Status.CLOSED
            )
            loan.refresh_from_db()
            candidate.refresh_from_db()

        for item in released:
            item.status = CarLoanCandidate.Status.CLOSED
        return loan, released


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
    """Borrower may always cancel; an owner may cancel an active loan of their car.

    The rule itself lives in roles.can_cancel, which the serializer also reports as
    `can_cancel` — so the button a resident sees and the answer they get from here
    are the same decision, not two implementations of it.
    """

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, pk):
        user = request.user
        with transaction.atomic():
            loan = get_object_or_404(
                CarLoan.objects.select_related("borrower", "car").prefetch_related(
                    "candidates__car"
                ),
                pk=pk,
            )
            if not can_cancel(loan, user):
                # Separate the "not yours" case from "not cancellable any more",
                # because they call for very different reactions from a resident.
                role = loan_role(loan, user)
                if role == LoanRole.NONE:
                    raise PermissionDenied("Du kan ikke aflyse dette lån.")
                if role == LoanRole.LENDER and loan.status == CarLoan.Status.REQUESTED:
                    raise ValidationError("Svar på forespørgslen i stedet for at aflyse den.")
                if role in (LoanRole.ASKED, LoanRole.DECLINED, LoanRole.CLOSED_OUT):
                    raise PermissionDenied("Du kan ikke aflyse dette lån.")
                raise ValidationError("Lånet kan ikke aflyses.")

            updated = CarLoan.objects.filter(
                pk=loan.pk, status__in=[CarLoan.Status.REQUESTED, CarLoan.Status.ACTIVE]
            ).update(status=CarLoan.Status.CANCELLED)
            if not updated:
                raise ValidationError("Lånet kan ikke aflyses.")

            # Release anyone still holding the question, exactly as accepting does.
            # Leaving them ASKED would keep a withdrawn request looking live to
            # households that can no longer do anything about it.
            released = list(
                loan.candidates.select_related("car", "car__house").filter(
                    status=CarLoanCandidate.Status.ASKED
                )
            )
            CarLoanCandidate.objects.filter(pk__in=[item.pk for item in released]).update(
                status=CarLoanCandidate.Status.CLOSED
            )
            loan.refresh_from_db()

        notify_car_loan_cancelled(loan, user)
        broadcast_car_sharing_update(loan_audience(loan))
        return Response(CarLoanSerializer(loan, context={"request": request}).data)
