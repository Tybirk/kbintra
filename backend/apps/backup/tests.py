"""
Tests for the backup app.
"""

from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, patch

from django.apps import apps as django_apps
from django.db.models.signals import post_delete, post_save, pre_save
from django.test import TestCase, override_settings

from apps.backup.s3 import is_enabled
from apps.backup.signals import ATTACHMENT_MODELS, IMAGE_MODELS
from apps.backup.tasks import _check_litestream_health
from apps.backup.views import _is_safe_path


class SignalRegistrationTest(TestCase):
    """Regression: signals were registered with closures held only by weakref,
    so they were silently GC'd and never fired. Verify each model has live
    receivers attached.
    """

    def test_attachment_models_have_live_receivers(self):
        for label, _field in ATTACHMENT_MODELS:
            model = django_apps.get_model(label)
            for signal, name in [(post_save, "post_save"), (post_delete, "post_delete")]:
                live = signal._live_receivers(sender=model)
                # _live_receivers returns (receivers, sync_receivers) in Django 5
                flat = [r for group in live for r in group] if isinstance(live, tuple) else live
                assert flat, f"{label} has no live {name} receivers"

    def test_image_models_have_live_receivers(self):
        for label, _field in IMAGE_MODELS:
            model = django_apps.get_model(label)
            for signal, name in [
                (pre_save, "pre_save"),
                (post_save, "post_save"),
                (post_delete, "post_delete"),
            ]:
                live = signal._live_receivers(sender=model)
                flat = [r for group in live for r in group] if isinstance(live, tuple) else live
                assert flat, f"{label} has no live {name} receivers"


class IsSafePathTest(TestCase):
    def test_normal_paths(self):
        assert _is_safe_path("post_attachments/file.pdf")
        assert _is_safe_path("profile_pictures/img.jpg")
        assert _is_safe_path("a/b/c/d.txt")

    def test_traversal_rejected(self):
        assert not _is_safe_path("../../etc/passwd")
        assert not _is_safe_path("../secret")

    def test_absolute_path_rejected(self):
        assert not _is_safe_path("/etc/passwd")

    def test_sneaky_traversal(self):
        assert not _is_safe_path("foo/../../etc/passwd")


class IsEnabledTest(TestCase):
    @override_settings(S3_BACKUP_BUCKET="my-bucket")
    def test_enabled_when_bucket_set(self):
        assert is_enabled()

    @override_settings(S3_BACKUP_BUCKET="")
    def test_disabled_when_bucket_empty(self):
        assert not is_enabled()


S3_SETTINGS = {
    "S3_BACKUP_BUCKET": "test-bucket",
    "S3_BACKUP_ENDPOINT": "https://example.com",
    "S3_BACKUP_ACCESS_KEY": "key",
    "S3_BACKUP_SECRET_KEY": "secret",
    "S3_BACKUP_REGION": "auto",
    "S3_BACKUP_PREFIX": "media/",
}


class CheckLitestreamHealthTest(TestCase):
    @override_settings(S3_BACKUP_BUCKET="")
    def test_skips_when_s3_disabled(self):
        # Should return without error when S3 is not configured
        _check_litestream_health()

    @override_settings(**S3_SETTINGS)
    @patch("apps.backup.tasks._is_active_hour", return_value=True)
    @patch("apps.backup.s3._get_client")
    def test_raises_when_no_objects(self, mock_get_client, _mock_active):
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client
        mock_client.list_objects_v2.return_value = {"Contents": []}

        with self.assertRaises(RuntimeError, msg="no objects found"):
            _check_litestream_health()

    @override_settings(**S3_SETTINGS)
    @patch("apps.backup.tasks._is_active_hour", return_value=True)
    @patch("apps.backup.s3._get_client")
    def test_raises_when_stale(self, mock_get_client, _mock_active):
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client
        # Threshold is 240 minutes, so 300 minutes is unambiguously stale.
        mock_client.list_objects_v2.return_value = {
            "Contents": [{"LastModified": datetime.now(UTC) - timedelta(minutes=300)}]
        }

        with self.assertRaises(RuntimeError, msg="minutes old"):
            _check_litestream_health()

    @override_settings(**S3_SETTINGS)
    @patch("apps.backup.tasks._is_active_hour", return_value=True)
    @patch("apps.backup.s3._get_client")
    def test_passes_when_recent(self, mock_get_client, _mock_active):
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client
        mock_client.list_objects_v2.return_value = {
            "Contents": [{"LastModified": datetime.now(UTC) - timedelta(minutes=2)}]
        }

        # Should not raise
        _check_litestream_health()

    @override_settings(**S3_SETTINGS)
    @patch("apps.backup.tasks._is_active_hour", return_value=False)
    @patch("apps.backup.s3._get_client")
    def test_skips_outside_active_hours(self, mock_get_client, _mock_active):
        # When outside the active window, the check returns early without
        # ever touching S3.
        _check_litestream_health()
        mock_get_client.assert_not_called()
