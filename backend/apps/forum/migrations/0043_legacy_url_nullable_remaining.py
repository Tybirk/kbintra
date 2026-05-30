from django.db import migrations, models


def _make_nullable(cursor, table, new_ddl, indexes):
    cursor.execute(f"PRAGMA table_info({table})")
    columns = {row[1]: row for row in cursor.fetchall()}

    if "legacy_url" not in columns:
        cursor.execute(f'ALTER TABLE "{table}" ADD COLUMN "legacy_url" varchar(500) NULL')
        for idx in indexes:
            cursor.execute(idx)
    elif columns["legacy_url"][3] == 1:  # notnull=1
        cursor.execute("PRAGMA foreign_keys=OFF")
        cursor.execute(new_ddl)
        cursor.execute(f'INSERT INTO "{table}_new" SELECT * FROM "{table}"')
        cursor.execute(f'DROP TABLE "{table}"')
        cursor.execute(f'ALTER TABLE "{table}_new" RENAME TO "{table}"')
        for idx in indexes:
            cursor.execute(idx)
        cursor.execute("PRAGMA foreign_keys=ON")


def fix_legacy_urls(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        _make_nullable(
            cursor,
            "forum_post",
            """
            CREATE TABLE "forum_post_new" (
                "id" integer NOT NULL PRIMARY KEY AUTOINCREMENT,
                "content" text NOT NULL,
                "created_at" datetime NOT NULL,
                "updated_at" datetime NOT NULL,
                "author_id" bigint NULL REFERENCES "users_user" ("id") DEFERRABLE INITIALLY DEFERRED,
                "thread_id" bigint NOT NULL REFERENCES "forum_thread" ("id") DEFERRABLE INITIALLY DEFERRED,
                "edited_by_id" bigint NULL REFERENCES "users_user" ("id") DEFERRABLE INITIALLY DEFERRED,
                "legacy_url" varchar(500) NULL
            )
            """,
            [
                'CREATE INDEX "forum_post_author_id_609b7963" ON "forum_post" ("author_id")',
                'CREATE INDEX "forum_post_thread_id_f9fa0a56" ON "forum_post" ("thread_id")',
                'CREATE INDEX "forum_post_edited_by_id_142f83f0" ON "forum_post" ("edited_by_id")',
                'CREATE INDEX "forum_post_legacy_url_77ff55d7" ON "forum_post" ("legacy_url")',
                'CREATE INDEX "forum_post_thread_recent_idx" ON "forum_post" ("thread_id", "created_at" DESC)',
            ],
        )
        _make_nullable(
            cursor,
            "forum_postattachment",
            """
            CREATE TABLE "forum_postattachment_new" (
                "id" integer NOT NULL PRIMARY KEY AUTOINCREMENT,
                "file" varchar(100) NOT NULL,
                "name" varchar(255) NOT NULL,
                "uploaded_at" datetime NOT NULL,
                "post_id" bigint NOT NULL REFERENCES "forum_post" ("id") DEFERRABLE INITIALLY DEFERRED,
                "uploaded_by_id" bigint NULL REFERENCES "users_user" ("id") DEFERRABLE INITIALLY DEFERRED,
                "preview_html" text NOT NULL,
                "thumbnail" varchar(100) NULL,
                "legacy_url" varchar(500) NULL
            )
            """,
            [
                'CREATE INDEX "forum_postattachment_post_id_8d6b9e21" ON "forum_postattachment" ("post_id")',
                'CREATE INDEX "forum_postattachment_uploaded_by_id_77945b0e" ON "forum_postattachment" ("uploaded_by_id")',
                'CREATE INDEX "forum_postattachment_legacy_url_6cf908f7" ON "forum_postattachment" ("legacy_url")',
            ],
        )
        _make_nullable(
            cursor,
            "forum_folder",
            """
            CREATE TABLE "forum_folder_new" (
                "id" integer NOT NULL PRIMARY KEY AUTOINCREMENT,
                "name" varchar(100) NOT NULL,
                "created_at" datetime NOT NULL,
                "subgroup_id" bigint NULL REFERENCES "forum_subgroup" ("id") DEFERRABLE INITIALLY DEFERRED,
                "slug" varchar(100) NOT NULL,
                "legacy_url" varchar(500) NULL,
                "parent_id" bigint NULL REFERENCES "forum_folder" ("id") DEFERRABLE INITIALLY DEFERRED,
                CONSTRAINT "unique_folder_subgroup_parent_name" UNIQUE ("subgroup_id", "parent_id", "name"),
                CONSTRAINT "unique_folder_subgroup_slug" UNIQUE ("subgroup_id", "slug")
            )
            """,
            [
                'CREATE INDEX "forum_folder_subgroup_id_755cb39c" ON "forum_folder" ("subgroup_id")',
                'CREATE INDEX "forum_folder_slug_0776436e" ON "forum_folder" ("slug")',
                'CREATE INDEX "forum_folder_legacy_url_43e90d88" ON "forum_folder" ("legacy_url")',
                'CREATE INDEX "forum_folder_parent_id_02595481" ON "forum_folder" ("parent_id")',
            ],
        )
        _make_nullable(
            cursor,
            "forum_file",
            """
            CREATE TABLE "forum_file_new" (
                "id" integer NOT NULL PRIMARY KEY AUTOINCREMENT,
                "file" varchar(100) NOT NULL,
                "name" varchar(255) NOT NULL,
                "uploaded_at" datetime NOT NULL,
                "uploaded_by_id" bigint NULL REFERENCES "users_user" ("id") DEFERRABLE INITIALLY DEFERRED,
                "folder_id" bigint NULL REFERENCES "forum_folder" ("id") DEFERRABLE INITIALLY DEFERRED,
                "subgroup_id" bigint NULL REFERENCES "forum_subgroup" ("id") DEFERRABLE INITIALLY DEFERRED,
                "preview_html" text NOT NULL,
                "members_only" bool NOT NULL,
                "legacy_url" varchar(500) NULL
            )
            """,
            [
                'CREATE INDEX "forum_file_uploaded_by_id_8d0e6393" ON "forum_file" ("uploaded_by_id")',
                'CREATE INDEX "forum_file_folder_id_4253cd8e" ON "forum_file" ("folder_id")',
                'CREATE INDEX "forum_file_subgroup_id_7a676917" ON "forum_file" ("subgroup_id")',
                'CREATE INDEX "forum_file_legacy_url_86405d39" ON "forum_file" ("legacy_url")',
            ],
        )


class Migration(migrations.Migration):
    dependencies = [
        ("forum", "0042_thread_legacy_url_nullable"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.AddField(
                    model_name="post",
                    name="legacy_url",
                    field=models.CharField(blank=True, max_length=500, null=True),
                ),
                migrations.AddField(
                    model_name="postattachment",
                    name="legacy_url",
                    field=models.CharField(blank=True, max_length=500, null=True),
                ),
                migrations.AddField(
                    model_name="folder",
                    name="legacy_url",
                    field=models.CharField(blank=True, max_length=500, null=True),
                ),
                migrations.AddField(
                    model_name="file",
                    name="legacy_url",
                    field=models.CharField(blank=True, max_length=500, null=True),
                ),
            ],
            database_operations=[
                migrations.RunPython(fix_legacy_urls, migrations.RunPython.noop),
            ],
        ),
    ]
