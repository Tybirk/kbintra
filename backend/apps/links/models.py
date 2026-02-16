from django.conf import settings
from django.db import models


class UsefulLinks(models.Model):
    content = models.TextField(blank=True, default="")
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True
    )

    class Meta:
        verbose_name_plural = "Useful links"
