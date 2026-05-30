from django.db import migrations, models


def fix_legacy_url(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("PRAGMA table_info(forum_thread)")
        columns = {row[1]: row for row in cursor.fetchall()}

        if "legacy_url" not in columns:
            cursor.execute('ALTER TABLE "forum_thread" ADD COLUMN "legacy_url" varchar(500) NULL')
            cursor.execute(
                'CREATE INDEX "forum_thread_legacy_url_1cd50819" ON "forum_thread" ("legacy_url")'
            )
        elif columns["legacy_url"][3] == 1:  # notnull=1 means NOT NULL — needs table recreation
            cursor.execute("PRAGMA foreign_keys=OFF")
            cursor.execute(
                """
                CREATE TABLE "forum_thread_new" (
                    "id" integer NOT NULL PRIMARY KEY AUTOINCREMENT,
                    "title" varchar(200) NOT NULL,
                    "is_pinned" bool NOT NULL,
                    "created_at" datetime NOT NULL,
                    "updated_at" datetime NOT NULL,
                    "author_id" bigint NULL REFERENCES "users_user" ("id") DEFERRABLE INITIALLY DEFERRED,
                    "subgroup_id" bigint NOT NULL REFERENCES "forum_subgroup" ("id") DEFERRABLE INITIALLY DEFERRED,
                    "is_closed" bool NOT NULL,
                    "slug" varchar(200) NOT NULL,
                    "members_only" bool NOT NULL,
                    "legacy_url" varchar(500) NULL,
                    CONSTRAINT "unique_thread_subgroup_slug" UNIQUE ("subgroup_id", "slug")
                )
                """
            )
            cursor.execute('INSERT INTO "forum_thread_new" SELECT * FROM "forum_thread"')
            cursor.execute('DROP TABLE "forum_thread"')
            cursor.execute('ALTER TABLE "forum_thread_new" RENAME TO "forum_thread"')
            cursor.execute(
                'CREATE INDEX "forum_thread_author_id_c72b456f" ON "forum_thread" ("author_id")'
            )
            cursor.execute(
                'CREATE INDEX "forum_thread_subgroup_id_a7dda238" ON "forum_thread" ("subgroup_id")'
            )
            cursor.execute('CREATE INDEX "forum_thread_slug_58819496" ON "forum_thread" ("slug")')
            cursor.execute(
                'CREATE INDEX "forum_thread_legacy_url_1cd50819" ON "forum_thread" ("legacy_url")'
            )
            cursor.execute("PRAGMA foreign_keys=ON")


class Migration(migrations.Migration):
    dependencies = [
        ("forum", "0041_subscribe_all_to_core_subgroups"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.AddField(
                    model_name="thread",
                    name="legacy_url",
                    field=models.CharField(blank=True, max_length=500, null=True),
                ),
            ],
            database_operations=[
                migrations.RunPython(fix_legacy_url, migrations.RunPython.noop),
            ],
        ),
    ]
