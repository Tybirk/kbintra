"""
Tests for the backup app.
"""

import tempfile
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import MagicMock, patch

from django.apps import apps as django_apps
from django.db.models.signals import post_delete, post_save, pre_save
from django.test import Client, TestCase, override_settings

from apps.backup.s3 import is_enabled
from apps.backup.signals import ATTACHMENT_MODELS, IMAGE_MODELS
from apps.backup.tasks import _check_litestream_health
from apps.backup.views import _is_safe_path
from apps.users.models import User


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


class ServeMediaAuthTest(TestCase):
    """`/media/*` must require an authenticated session.

    Regression: media files (profile pictures, post/message attachments) used
    to be publicly fetchable by guessing the URL. The fix gates `serve_media`
    on `request.user.is_authenticated`, with the session set as a side-effect
    of the JWT login flow.
    """

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.media_root = Path(self.tmpdir)
        (self.media_root / "post_attachments").mkdir()
        self.file_path = "post_attachments/test.txt"
        (self.media_root / self.file_path).write_text("secret payload")

        self.user = User.objects.create_user(
            email="media-auth@example.com",
            password="testpass123",
            first_name="Media",
            last_name="Tester",
        )

    def tearDown(self):
        import shutil

        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_unauthenticated_request_returns_401(self):
        with override_settings(MEDIA_ROOT=str(self.media_root)):
            response = Client().get(f"/media/{self.file_path}")
        assert response.status_code == 401

    def test_authenticated_session_can_fetch(self):
        client = Client()
        client.force_login(self.user)
        with override_settings(MEDIA_ROOT=str(self.media_root)):
            response = client.get(f"/media/{self.file_path}")
        assert response.status_code == 200
        assert b"secret payload" in b"".join(response.streaming_content)

    def test_jwt_login_grants_media_access(self):
        """Logging in via the JWT endpoint must set the session cookie that
        gates media."""
        client = Client()
        login_response = client.post(
            "/api/auth/token/",
            data={"email": "media-auth@example.com", "password": "testpass123"},
            content_type="application/json",
        )
        assert login_response.status_code == 200
        # The session cookie was set as a side-effect of login.
        assert "sessionid" in login_response.cookies

        with override_settings(MEDIA_ROOT=str(self.media_root)):
            response = client.get(f"/media/{self.file_path}")
        assert response.status_code == 200

    def test_jwt_refresh_backfills_session(self):
        """Silent token refresh (used when an access token expires) must also
        set the session cookie. Otherwise, returning users would 401 on
        `/media/*` until their first API call backfilled a session — causing a
        one-time flash of broken images on first load post-deploy.
        """
        client = Client()
        # First login to get a refresh token.
        login = client.post(
            "/api/auth/token/",
            data={"email": "media-auth@example.com", "password": "testpass123"},
            content_type="application/json",
        )
        refresh_token = login.json()["refresh"]

        # Simulate a fresh client (no session yet) calling /token/refresh/.
        client.cookies.clear()
        refresh = client.post(
            "/api/auth/token/refresh/",
            data={"refresh": refresh_token},
            content_type="application/json",
        )
        assert refresh.status_code == 200
        assert "sessionid" in refresh.cookies, (
            "Refresh must set a sessionid cookie so /media/* is accessible immediately."
        )

        with override_settings(MEDIA_ROOT=str(self.media_root)):
            response = client.get(f"/media/{self.file_path}")
        assert response.status_code == 200

    def test_logout_revokes_media_access(self):
        client = Client()
        client.force_login(self.user)
        with override_settings(MEDIA_ROOT=str(self.media_root)):
            # Sanity: logged in, media works.
            assert client.get(f"/media/{self.file_path}").status_code == 200

            logout_response = client.post("/api/auth/logout/")
            assert logout_response.status_code == 204

            assert client.get(f"/media/{self.file_path}").status_code == 401

    def test_scanner_path_still_404s_without_auth(self):
        # Scanner traps should short-circuit before the auth check so we don't
        # leak that the path exists/doesn't exist behind a 401 vs 404 split.
        # Either 401 or 404 is acceptable; we just want it not to serve content.
        with override_settings(MEDIA_ROOT=str(self.media_root)):
            response = Client().get("/media/.env")
        assert response.status_code in (401, 404)

    def test_cache_control_prevents_cdn_caching(self):
        """Cloudflare (and any shared cache) must not cache `/media/*` responses.

        Without `Cache-Control: private`, the first authenticated user's 200
        gets cached at the CDN and subsequent unauthenticated users would
        receive the same file — bypassing the auth gate entirely.
        """
        client = Client()
        client.force_login(self.user)
        with override_settings(MEDIA_ROOT=str(self.media_root)):
            response = client.get(f"/media/{self.file_path}")
        assert response.status_code == 200
        cache_control = response["Cache-Control"].lower()
        assert "private" in cache_control, (
            f"200 must be Cache-Control: private. Got {cache_control!r}"
        )

        # The 401 must also be uncacheable, otherwise a stale 401 could be
        # served from the CDN to authenticated users.
        anon_response = Client().get(f"/media/{self.file_path}")
        assert anon_response.status_code == 401
        anon_cc = anon_response["Cache-Control"].lower()
        assert "private" in anon_cc and "no-store" in anon_cc, (
            f"401 must be Cache-Control: private, no-store. Got {anon_cc!r}"
        )
