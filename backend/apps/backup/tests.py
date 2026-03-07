"""
Tests for the backup app.
"""

from unittest.mock import MagicMock, patch

from django.test import TestCase, override_settings

from apps.backup.s3 import is_enabled, prune_old_db_backups
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


class PruneOldDbBackupsTest(TestCase):
    @override_settings(S3_BACKUP_BUCKET="")
    def test_noop_when_disabled(self):
        assert prune_old_db_backups() == 0

    @override_settings(
        S3_BACKUP_BUCKET="test-bucket",
        S3_BACKUP_ENDPOINT="https://example.com",
        S3_BACKUP_ACCESS_KEY="key",
        S3_BACKUP_SECRET_KEY="secret",
        S3_BACKUP_REGION="auto",
        S3_BACKUP_PREFIX="media/",
    )
    @patch("apps.backup.s3._get_client")
    def test_prunes_oldest_keeps_recent(self, mock_get_client):
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client

        # Simulate paginator returning 5 backups
        keys = [f"media/db-backups/db-2026030{i}-030000.sqlite3" for i in range(1, 6)]
        mock_paginator = MagicMock()
        mock_paginator.paginate.return_value = [{"Contents": [{"Key": k} for k in keys]}]
        mock_client.get_paginator.return_value = mock_paginator

        deleted = prune_old_db_backups(keep=3)
        assert deleted == 2
        # Should delete the 2 oldest
        mock_client.delete_object.assert_any_call(Bucket="test-bucket", Key=keys[0])
        mock_client.delete_object.assert_any_call(Bucket="test-bucket", Key=keys[1])
        assert mock_client.delete_object.call_count == 2

    @override_settings(
        S3_BACKUP_BUCKET="test-bucket",
        S3_BACKUP_ENDPOINT="https://example.com",
        S3_BACKUP_ACCESS_KEY="key",
        S3_BACKUP_SECRET_KEY="secret",
        S3_BACKUP_REGION="auto",
        S3_BACKUP_PREFIX="media/",
    )
    @patch("apps.backup.s3._get_client")
    def test_no_prune_when_under_limit(self, mock_get_client):
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client

        keys = [f"media/db-backups/db-2026030{i}-030000.sqlite3" for i in range(1, 3)]
        mock_paginator = MagicMock()
        mock_paginator.paginate.return_value = [{"Contents": [{"Key": k} for k in keys]}]
        mock_client.get_paginator.return_value = mock_paginator

        deleted = prune_old_db_backups(keep=5)
        assert deleted == 0
        mock_client.delete_object.assert_not_called()
