from rest_framework import serializers

from .models import UsefulLinks


class UsefulLinksSerializer(serializers.ModelSerializer):
    class Meta:
        model = UsefulLinks
        fields = ["content", "updated_at"]
        read_only_fields = ["updated_at"]
