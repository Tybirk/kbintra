"""Keep each row's original title and body next to the Danish-folded copies.

Matching needs æ/ø/å folded (æ→ae, ø→oe, å→aa), but results were shown from the same
folded text: "Soeren", "loerdags". The originals go in two UNINDEXED columns at the end,
so column 1 is still the body for snippet() and bm25's weights still apply to title and
body. An FTS5 table can't gain columns, so it is recreated empty; the container
entrypoint and deploy.sh both run `rebuild_search_index --if-empty` after migrating.
"""

from django.db import migrations

COLUMNS_BEFORE = """
    title, body,
    type UNINDEXED, object_id UNINDEXED,
    url UNINDEXED, subtitle UNINDEXED, extra UNINDEXED,
    created_at UNINDEXED,
"""


class Migration(migrations.Migration):
    dependencies = [("search", "0002_add_created_at_to_search_index")]

    operations = [
        migrations.RunSQL(
            sql=f"""
            DROP TABLE IF EXISTS search_index;
            CREATE VIRTUAL TABLE search_index USING fts5(
                {COLUMNS_BEFORE}
                title_raw UNINDEXED, body_raw UNINDEXED,
                tokenize='unicode61 remove_diacritics 2'
            );
            """,
            reverse_sql=f"""
            DROP TABLE IF EXISTS search_index;
            CREATE VIRTUAL TABLE search_index USING fts5(
                {COLUMNS_BEFORE}
                tokenize='unicode61 remove_diacritics 2'
            );
            """,
        ),
    ]
