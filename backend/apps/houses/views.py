"""
Views for House models.
"""

from django.conf import settings
from django.db import transaction
from django.db.models import F, ProtectedError
from django.http import Http404
from rest_framework import generics, permissions, status
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from .handover import invitation_email, mark_sent_and_mail, process_handover
from .models import Car, Child, Handover, House
from .serializers import (
    CarCreateUpdateSerializer,
    CarSerializer,
    ChildCreateUpdateSerializer,
    ChildSerializer,
    HandoverCreateSerializer,
    HandoverSerializer,
    HandoverUpdateSerializer,
    HouseListSerializer,
    HouseSerializer,
    HouseUpdateSerializer,
)


class HouseListView(generics.ListAPIView):
    """
    List all houses in the community.
    """

    serializer_class = HouseListSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        """Return houses ordered by house number."""
        houses = list(House.objects.prefetch_related("inhabitants", "children", "cars"))

        def sort_key(house):
            # Extract numeric part from end of house name (e.g., "MyRoad 7" -> 7)
            parts = house.name.split()
            try:
                return int(parts[-1]) if parts else 0
            except ValueError:
                return 0

        houses.sort(key=sort_key)
        return houses


class HouseDetailView(generics.RetrieveAPIView):
    """
    Get details of a specific house with inhabitants.
    """

    serializer_class = HouseSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = House.objects.prefetch_related("inhabitants", "children", "cars")
    lookup_field = "slug"


class MyHouseView(APIView):
    """
    Get or update the current user's house.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        """Get the current user's house."""
        user = request.user
        if not user.house:
            return Response(
                {"detail": "Du er ikke tilknyttet et hus."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Prefetch related data to avoid N+1 queries
        house = House.objects.prefetch_related("inhabitants", "children", "cars").get(
            pk=user.house.pk
        )
        serializer = HouseSerializer(house)
        return Response(serializer.data)

    def patch(self, request):
        """Update the current user's house description and/or profile picture."""
        user = request.user
        if not user.house:
            return Response(
                {"detail": "Du er ikke tilknyttet et hus."},
                status=status.HTTP_404_NOT_FOUND,
            )

        serializer = HouseUpdateSerializer(user.house, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()

        # Refresh with prefetched data to avoid N+1 queries in serializer
        house_with_prefetch = House.objects.prefetch_related("inhabitants", "children", "cars").get(
            pk=user.house.pk
        )
        return Response(HouseSerializer(house_with_prefetch).data)


class ChildListCreateView(generics.ListCreateAPIView):
    """
    List children in the current user's house or create a new child.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self):
        if self.request.method == "POST":
            return ChildCreateUpdateSerializer
        return ChildSerializer

    def get_queryset(self):
        """Return children belonging to the current user's house."""
        user = self.request.user
        if not user.house:
            return Child.objects.none()
        return Child.objects.filter(house=user.house)

    def perform_create(self, serializer):
        """Create a child in the current user's house."""
        user = self.request.user
        if not user.house:
            raise PermissionDenied("Du skal være tilknyttet et hus for at tilføje børn.")
        serializer.save(house=user.house)

    def create(self, request, *args, **kwargs):
        """Override to return full child data after creation."""
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)

        # Return full serializer
        output_serializer = ChildSerializer(serializer.instance)
        headers = self.get_success_headers(output_serializer.data)
        return Response(output_serializer.data, status=status.HTTP_201_CREATED, headers=headers)


class ChildDetailView(generics.RetrieveUpdateDestroyAPIView):
    """
    Retrieve, update or delete a child.
    Users can only manage children in their own house.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self):
        if self.request.method in ["PUT", "PATCH"]:
            return ChildCreateUpdateSerializer
        return ChildSerializer

    def get_queryset(self):
        """Return children belonging to the current user's house."""
        user = self.request.user
        if not user.house:
            return Child.objects.none()
        return Child.objects.filter(house=user.house)

    def update(self, request, *args, **kwargs):
        """Override to return full child data after update."""
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)

        # Return full serializer
        output_serializer = ChildSerializer(instance)
        return Response(output_serializer.data)


class CarListCreateView(generics.ListCreateAPIView):
    """
    List cars in the current user's house or create a new car.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self):
        if self.request.method == "POST":
            return CarCreateUpdateSerializer
        return CarSerializer

    def get_queryset(self):
        user = self.request.user
        if not user.house:
            return Car.objects.none()
        return Car.objects.filter(house=user.house)

    def perform_create(self, serializer):
        user = self.request.user
        if not user.house:
            raise PermissionDenied("Du skal være tilknyttet et hus for at tilføje biler.")
        serializer.save(house=user.house)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)

        output_serializer = CarSerializer(serializer.instance)
        headers = self.get_success_headers(output_serializer.data)
        return Response(output_serializer.data, status=status.HTTP_201_CREATED, headers=headers)


class CarDetailView(generics.RetrieveUpdateDestroyAPIView):
    """
    Retrieve, update or delete a car.
    Users can only manage cars in their own house.
    """

    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self):
        if self.request.method in ["PUT", "PATCH"]:
            return CarCreateUpdateSerializer
        return CarSerializer

    def get_object(self):
        """Answer a vanished car in Danish.

        Django's get_object_or_404 raises "No Car matches the given query.", and
        that reached the resident verbatim. Two adults share a household and a car
        list, so one of them saving a card the other just removed is an ordinary
        Tuesday, not an exotic race.
        """
        try:
            return super().get_object()
        except Http404 as exc:
            raise NotFound(
                "Bilen findes ikke længere — den er måske fjernet fra husstanden."
            ) from exc

    def get_queryset(self):
        user = self.request.user
        if not user.house:
            return Car.objects.none()
        return Car.objects.filter(house=user.house)

    def update(self, request, *args, **kwargs):
        """Save the car, and answer any request it leaves behind.

        Taking a car out of the delebilpark is the same thing to a borrower as
        removing it: the car they are waiting on is gone from the list and no
        longer answerable. So it says no on the household's behalf, exactly as
        perform_destroy does — otherwise the request sits open forever against a
        car nobody can see, and the owner keeps a "Ja, den må lånes" button that
        would lend out a car that is no longer shared.
        """
        from apps.carsharing.services import (
            announce_withdrawn_requests,
            withdraw_car_from_open_requests,
        )

        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        was_shared = instance.is_shared
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)

        with transaction.atomic():
            self.perform_update(serializer)
            withdrawn = (
                withdraw_car_from_open_requests(instance, by_user=request.user)
                if was_shared and not instance.is_shared
                else []
            )

        announce_withdrawn_requests(withdrawn, instance)

        output_serializer = CarSerializer(instance)
        return Response(output_serializer.data)

    def perform_destroy(self, instance):
        """Remove a car, leaving no neighbour waiting on it and no 500 behind.

        Two things can go wrong here and both used to reach the resident raw.
        A car that has ever been lent out is referenced by CarLoan.car, which is
        PROTECTed so the settled history stays answerable — that has to be a
        sentence, not an unhandled ProtectedError. And a car with an unanswered
        request would take its candidacy down with it (CarLoanCandidate.car is
        CASCADE), leaving the borrower waiting for a household that no longer has
        anything to answer with.

        ProtectedError is caught rather than pre-checked so that any protected
        relation added later is covered too, with no check-then-delete window.
        """
        from apps.carsharing.services import (
            announce_withdrawn_requests,
            withdraw_car_from_open_requests,
        )

        with transaction.atomic():
            withdrawn = withdraw_car_from_open_requests(instance, by_user=self.request.user)
            try:
                instance.delete()
            except ProtectedError as exc:
                # Rolls back the withdrawals above, so a refused delete changes
                # nothing at all.
                raise ValidationError(
                    "Bilen kan ikke fjernes, fordi den har været lånt ud. "
                    'Slå "Med i delebilparken" fra under Bildeling → Mine biler i stedet, '
                    "hvis den ikke skal kunne lånes."
                ) from exc

        # Only once the removal is real: telling someone their request is dead and
        # then rolling the delete back would be worse than saying nothing.
        announce_withdrawn_requests(withdrawn, instance)


class HandoverListCreateView(generics.ListCreateAPIView):
    """Staff: every handover, open ones first; or register a new one.

    A new handover is carried out at once as far as its dates have come — a
    handover dated today moves the residents out in the same request.
    """

    permission_classes = [permissions.IsAdminUser]
    pagination_class = None

    def get_serializer_class(self):
        if self.request.method == "POST":
            return HandoverCreateSerializer
        return HandoverSerializer

    def get_queryset(self):
        return (
            Handover.objects.select_related("house", "created_by")
            .prefetch_related("outgoing", "invitations")
            .order_by(F("access_ended_at").asc(nulls_first=True), "-handover_date", "-id")
        )

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        # One transaction: if a step fails, the handover isn't saved either, so the
        # admin can simply try again instead of meeting "already in a handover".
        with transaction.atomic():
            handover = serializer.save()
            process_handover(handover.pk)
        handover.refresh_from_db()
        return Response(HandoverSerializer(handover).data, status=status.HTTP_201_CREATED)


class HandoverDetailView(APIView):
    """Staff: move a date that hasn't come yet, or cancel a handover that
    hasn't started."""

    permission_classes = [permissions.IsAdminUser]

    def _get(self, pk: int) -> Handover:
        handover = Handover.objects.select_related("house").filter(pk=pk).first()
        if handover is None:
            raise NotFound()
        return handover

    def patch(self, request, pk: int):
        handover = self._get(pk)
        serializer = HandoverUpdateSerializer(handover, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            serializer.save()
            # A date moved to today or earlier happens now.
            process_handover(handover.pk)
        return Response(HandoverSerializer(self._get(pk)).data)

    def delete(self, request, pk: int):
        handover = self._get(pk)
        if handover.has_started:
            return Response(
                {"detail": "Overdragelsen er gået i gang og kan ikke annulleres."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        handover.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class HandoverInvitationResendView(APIView):
    """Staff: mail an invitation again, valid for another two weeks from now —
    for the one that got lost in a spam folder or ran out."""

    permission_classes = [permissions.IsAdminUser]

    def post(self, request, pk: int):
        from apps.users.models import Invitation

        invitation = Invitation.objects.filter(pk=pk, handover__isnull=False).first()
        if invitation is None:
            raise NotFound()
        if invitation.used_at:
            raise ValidationError({"detail": "Invitationen er allerede brugt."})
        if not invitation.sent_at:
            raise ValidationError({"detail": "Invitationen er ikke sendt endnu."})
        mark_sent_and_mail(invitation)
        handover = Handover.objects.get(pk=invitation.handover_id)
        return Response(HandoverSerializer(handover).data)


class HandoverInvitationPreviewView(APIView):
    """Staff: the invitation mail as it will be sent, with a placeholder link."""

    permission_classes = [permissions.IsAdminUser]

    def get(self, request):
        first_name = request.query_params.get("first_name", "").strip()[:150]
        subject, body = invitation_email(first_name, f"{settings.SITE_URL}/register?token=…")
        return Response({"subject": subject, "body": body})
