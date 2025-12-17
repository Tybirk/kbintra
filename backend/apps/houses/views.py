"""
Views for House models.
"""

from django.db.models import Count
from django.shortcuts import get_object_or_404

from rest_framework import generics, permissions, status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Child, House
from .serializers import (
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
    pagination_class = None  # Houses are few, no pagination needed

    def get_queryset(self):
        """Return houses ordered by inhabitant count (populated first), then name."""
        return (
            House.objects.prefetch_related("inhabitants", "children")
            .annotate(inhabitant_count_annotated=Count("inhabitants"))
            .order_by("-inhabitant_count_annotated", "name")
        )


class HouseDetailView(generics.RetrieveAPIView):
    """
    Get details of a specific house with inhabitants.
    """

    serializer_class = HouseSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = House.objects.prefetch_related("inhabitants", "children")


class MyHouseView(APIView):
    """
    Get or update the current user's house.
    """

    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def get(self, request):
        """Get the current user's house."""
        user = request.user
        if not user.house:
            return Response(
                {"detail": "Du er ikke tilknyttet et hus."},
                status=status.HTTP_404_NOT_FOUND,
            )

        serializer = HouseSerializer(user.house)
        return Response(serializer.data)

    def patch(self, request):
        """Update the current user's house description and/or profile picture."""
        user = request.user
        if not user.house:
            return Response(
                {"detail": "Du er ikke tilknyttet et hus."},
                status=status.HTTP_404_NOT_FOUND,
            )

        serializer = HouseUpdateSerializer(
            user.house, data=request.data, partial=True
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()

        # Return full house data
        return Response(HouseSerializer(user.house).data)


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
            raise permissions.PermissionDenied(
                "Du skal være tilknyttet et hus for at tilføje børn."
            )
        serializer.save(house=user.house)

    def create(self, request, *args, **kwargs):
        """Override to return full child data after creation."""
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)

        # Return full serializer
        output_serializer = ChildSerializer(serializer.instance)
        headers = self.get_success_headers(output_serializer.data)
        return Response(
            output_serializer.data, status=status.HTTP_201_CREATED, headers=headers
        )


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
