"""
Tests for the backup app.
"""

from django.test import TestCase, override_settings

from apps.backup.s3 import is_enabled
from apps.backup.views import _is_safe_path


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
