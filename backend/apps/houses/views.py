"""
Views for House models.
"""

from django.db import transaction
from django.db.models import ProtectedError
from django.http import Http404
from rest_framework import generics, permissions, status
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Car, Child, House
from .serializers import (
    CarCreateUpdateSerializer,
    CarSerializer,
    ChildCreateUpdateSerializer,
    ChildSerializer,
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


def _announce_withdrawn_requests(candidates, car) -> None:
    """Tell the borrowers that a departing car has answered them.

    Both ways a car can leave the delebilpark — removed outright, or un-shared —
    end here, so the borrower is told the same thing either way and the two paths
    cannot drift apart. Called only after the change is committed: announcing a
    dead request and then rolling the change back would be worse than silence.
    """
    from apps.carsharing.realtime import broadcast_car_sharing_update, loan_audience
    from apps.notifications.services import (
        close_car_request_notifications,
        notify_car_loan_declined,
    )

    for candidate in candidates:
        close_car_request_notifications(candidate.loan, car)
        notify_car_loan_declined(candidate)
        broadcast_car_sharing_update(loan_audience(candidate.loan))


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
        from apps.carsharing.services import withdraw_car_from_open_requests

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

        _announce_withdrawn_requests(withdrawn, instance)

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
        from apps.carsharing.services import withdraw_car_from_open_requests

        with transaction.atomic():
            withdrawn = withdraw_car_from_open_requests(instance, by_user=self.request.user)
            try:
                instance.delete()
            except ProtectedError as exc:
                # Rolls back the withdrawals above, so a refused delete changes
                # nothing at all.
                raise ValidationError(
                    "Bilen kan ikke fjernes, fordi den har været lånt ud. "
                    'Slå "Med i delebilparken" fra i stedet, hvis den ikke skal kunne lånes.'
                ) from exc

        # Only once the removal is real: telling someone their request is dead and
        # then rolling the delete back would be worse than saying nothing.
        _announce_withdrawn_requests(withdrawn, instance)
