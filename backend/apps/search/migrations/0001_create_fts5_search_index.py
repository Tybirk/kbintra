"""
Create the FTS5 virtual table for full-text search.
"""

from django.db import migrations


class Migration(migrations.Migration):
    initial = True

    dependencies = []

    operations = [
        migrations.RunSQL(
            sql="""
            CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
                title, body,
                type UNINDEXED, object_id UNINDEXED,
                url UNINDEXED, subtitle UNINDEXED, extra UNINDEXED,
                tokenize='unicode61 remove_diacritics 2'
            );
            """,
            reverse_sql="DROP TABLE IF EXISTS search_index;",
        ),
    ]
