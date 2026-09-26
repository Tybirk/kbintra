"""Point legacy @-mentions at the person they name.

Posts written before the cutover (2026-02-20 to 2026-04-23) carry mention links with the
previous platform's user ids: on the prod copy of 2026-09-26, 93 of 161 mention links
opened a different resident's profile than the name shown ("/profil/107" shown as @Peter
Emil Tybirk opens Peter Vogel). Two markups: the editor's `data-type="mention"` with
data-id/data-label, and an older bare `<a class="mention" href="/profil/N">`. No backup maps
the old ids, so the name decides — data-label, else the link text the reader sees:

1. the full name, ignoring case, spaces and periods;
2. else the first and last name, ignoring middle names and initials ("Carl M. Kobel");
3. else, for a one-word name, the only resident with that first name ("Esben").

83 are re-pointed. The 10 that still point nowhere or at several people ("@Peter", or the
made-up link text of an early test thread) become plain "@Name" text (Carl's decision,
2026-09-26), so nothing links to the wrong person. Only href/data-id change and the
text stays, so the search index is unaffected; bulk_update leaves updated_at alone.
"""

import re
from html import unescape

from django.db import migrations

# Either markup: data-type="mention", or the older class="mention" alone.
MENTION = re.compile(
    r"<a\b(?=[^>]*(?:\bdata-type=\"mention\"|\bclass=\"mention\"))[^>]*>(.*?)</a>", re.S
)
ATTR = re.compile(r'\b(data-id|data-label|href)="([^"]*)"')
TAG = re.compile(r"<[^>]+>")


def _norm(text: str) -> str:
    return " ".join(text.lower().replace(".", " ").split())


def resolver(users):
    """Return name -> user id (or None) for the people in `users` (id, first, last)."""
    names = {uid: _norm(f"{first} {last}") for uid, first, last in users}

    def unique(ids):
        return ids[0] if len(set(ids)) == 1 else None

    def resolve(label: str, current_id: int | None) -> int | None:
        wanted = _norm(label)
        words = wanted.split()
        if not words:
            return None
        current = names.get(current_id, "").split()
        if current and (current == words or (current[0], current[-1]) == (words[0], words[-1])):
            return current_id
        exact = [uid for uid, name in names.items() if name == wanted]
        if exact:
            return unique(exact)
        ends = [
            uid
            for uid, name in names.items()
            if (name.split()[:1] + name.split()[-1:]) == [words[0], words[-1]]
        ]
        if len(words) > 1:
            return unique(ends)
        firsts = [uid for uid, name in names.items() if name.split()[:1] == words]
        return unique(firsts)

    return resolve


def repair(html: str, resolve) -> str:
    def fix(match: re.Match) -> str:
        tag, inner = match.group(0), match.group(1)
        attrs = dict(ATTR.findall(tag))
        # The label the editor recorded, else the name the reader sees (the older
        # markup has no label, and a few posts edited the text: "@Terkild nørden").
        names = [attrs.get("data-label", ""), unescape(TAG.sub("", inner)).strip().lstrip("@")]
        names = [name for name in names if name.strip()]
        if not names:
            return tag  # no name to go by: leave it as it is
        linked = re.fullmatch(r"/profil/(\d+)", attrs.get("href", ""))
        current_text = attrs.get("data-id") or (linked.group(1) if linked else "")
        current = int(current_text) if current_text.isdigit() else None
        target = next(
            (found for name in names if (found := resolve(name, current)) is not None), None
        )
        if target is None:
            return inner
        if target == current:
            return tag
        tag = re.sub(r'\bdata-id="\d*"', f'data-id="{target}"', tag, count=1)
        return re.sub(r'\bhref="/profil/\d*"', f'href="/profil/{target}"', tag, count=1)

    return MENTION.sub(fix, html)


FIELDS = (
    ("forum", "Post", "content"),
    ("forum", "Subgroup", "description"),
    ("events", "Event", "description"),
)


def forwards(apps, schema_editor):
    User = apps.get_model("users", "User")
    resolve = resolver(list(User.objects.values_list("id", "first_name", "last_name")))
    for app_label, model_name, field in FIELDS:
        Model = apps.get_model(app_label, model_name)
        changed = []
        for obj in Model.objects.filter(**{f"{field}__contains": 'class="mention"'}):
            html = getattr(obj, field)
            repaired = repair(html, resolve)
            if repaired != html:
                setattr(obj, field, repaired)
                changed.append(obj)
        Model.objects.bulk_update(changed, [field], batch_size=200)


class Migration(migrations.Migration):
    dependencies = [
        ("forum", "0051_subgroup_reporting_states"),
        ("events", "0008_drop_placeholder_event_posts"),
        ("users", "0020_user_hide_birth_year"),
    ]

    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
