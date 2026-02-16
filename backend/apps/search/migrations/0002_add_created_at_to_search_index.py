"""
Add created_at column to the FTS5 search_index table.

FTS5 virtual tables cannot be ALTERed, so we drop and recreate.
The rebuild_search_index management command repopulates the data.
"""

from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("search", "0001_create_fts5_search_index"),
    ]

    operations = [
        migrations.RunSQL(
            sql="""
            DROP TABLE IF EXISTS search_index;
            CREATE VIRTUAL TABLE search_index USING fts5(
                title, body,
                type UNINDEXED, object_id UNINDEXED,
                url UNINDEXED, subtitle UNINDEXED, extra UNINDEXED,
                created_at UNINDEXED,
                tokenize='unicode61 remove_diacritics 2'
            );
            """,
            reverse_sql="""
            DROP TABLE IF EXISTS search_index;
            CREATE VIRTUAL TABLE search_index USING fts5(
                title, body,
                type UNINDEXED, object_id UNINDEXED,
                url UNINDEXED, subtitle UNINDEXED, extra UNINDEXED,
                tokenize='unicode61 remove_diacritics 2'
            );
            """,
        ),
    ]
