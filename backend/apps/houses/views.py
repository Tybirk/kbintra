"""
Views for House models.
"""

from rest_framework import generics, permissions, status
from rest_framework.exceptions import PermissionDenied
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

    def get_queryset(self):
        user = self.request.user
        if not user.house:
            return Car.objects.none()
        return Car.objects.filter(house=user.house)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)

        output_serializer = CarSerializer(instance)
        return Response(output_serializer.data)
