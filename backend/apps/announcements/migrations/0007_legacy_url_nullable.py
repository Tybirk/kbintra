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
            "announcements_announcement",
            """
            CREATE TABLE "announcements_announcement_new" (
                "id" integer NOT NULL PRIMARY KEY AUTOINCREMENT,
                "title" varchar(255) NOT NULL,
                "content" text NOT NULL,
                "is_active" bool NOT NULL,
                "priority" integer NOT NULL,
                "created_at" datetime NOT NULL,
                "updated_at" datetime NOT NULL,
                "author_id" bigint NOT NULL REFERENCES "users_user" ("id") DEFERRABLE INITIALLY DEFERRED,
                "show_on_dashboard" bool NOT NULL,
                "edited_by_id" bigint NULL REFERENCES "users_user" ("id") DEFERRABLE INITIALLY DEFERRED,
                "legacy_url" varchar(500) NULL
            )
            """,
            [
                'CREATE INDEX "announcements_announcement_author_id_47b59c69" ON "announcements_announcement" ("author_id")',
                'CREATE INDEX "announcements_announcement_edited_by_id_8526f5d5" ON "announcements_announcement" ("edited_by_id")',
                'CREATE INDEX "announcements_announcement_legacy_url_a4cd6b4b" ON "announcements_announcement" ("legacy_url")',
            ],
        )
        _make_nullable(
            cursor,
            "announcements_announcementattachment",
            """
            CREATE TABLE "announcements_announcementattachment_new" (
                "id" integer NOT NULL PRIMARY KEY AUTOINCREMENT,
                "file" varchar(100) NOT NULL,
                "name" varchar(255) NOT NULL,
                "uploaded_at" datetime NOT NULL,
                "announcement_id" bigint NOT NULL REFERENCES "announcements_announcement" ("id") DEFERRABLE INITIALLY DEFERRED,
                "uploaded_by_id" bigint NULL REFERENCES "users_user" ("id") DEFERRABLE INITIALLY DEFERRED,
                "preview_html" text NOT NULL,
                "legacy_url" varchar(500) NULL
            )
            """,
            [
                'CREATE INDEX "announcements_announcementattachment_announcement_id_b90086bb" ON "announcements_announcementattachment" ("announcement_id")',
                'CREATE INDEX "announcements_announcementattachment_uploaded_by_id_8e8ef2a9" ON "announcements_announcementattachment" ("uploaded_by_id")',
                'CREATE INDEX "announcements_announcementattachment_legacy_url_2c5f2a1d" ON "announcements_announcementattachment" ("legacy_url")',
            ],
        )


class Migration(migrations.Migration):
    dependencies = [
        ("announcements", "0006_add_edited_by"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.AddField(
                    model_name="announcement",
                    name="legacy_url",
                    field=models.CharField(blank=True, max_length=500, null=True),
                ),
                migrations.AddField(
                    model_name="announcementattachment",
                    name="legacy_url",
                    field=models.CharField(blank=True, max_length=500, null=True),
                ),
            ],
            database_operations=[
                migrations.RunPython(fix_legacy_urls, migrations.RunPython.noop),
            ],
        ),
    ]
