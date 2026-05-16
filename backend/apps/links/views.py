"""
Views for Useful Links app.
"""

from rest_framework import permissions
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import UsefulLinks
from .serializers import UsefulLinksSerializer


class UsefulLinksView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request: Request) -> Response:
        obj, _ = UsefulLinks.objects.get_or_create(pk=1)
        serializer = UsefulLinksSerializer(obj)
        return Response(serializer.data)

    def put(self, request: Request) -> Response:
        obj, _ = UsefulLinks.objects.get_or_create(pk=1)
        serializer = UsefulLinksSerializer(obj, data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(updated_by=request.user)
        return Response(serializer.data)
