"""
Views for House models.
"""

from django.db.models import Count

from rest_framework import generics, permissions

from .models import House
from .serializers import HouseListSerializer, HouseSerializer


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
            House.objects.prefetch_related("inhabitants")
            .annotate(inhabitant_count_annotated=Count("inhabitants"))
            .order_by("-inhabitant_count_annotated", "name")
        )


class HouseDetailView(generics.RetrieveAPIView):
    """
    Get details of a specific house with inhabitants.
    """

    serializer_class = HouseSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = House.objects.prefetch_related("inhabitants")
