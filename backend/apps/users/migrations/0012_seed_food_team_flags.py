"""Seed food-team flags for existing residents.

One-off data seed that turns the launched Madhold feature "on" for the real
community by setting each resident's food-team flags from the cooking team's
own roster (``~/Desktop/madhold/all_persons.csv``, the source of truth for the
standalone scheduler). Columns map to user fields:

    Fritaget                        -> is_exempt_from_food_teams
    Over 50                         -> is_over_50
    Ønsker at være med medbeboer    -> prefers_cooking_with_housemate
    Kan være chefkok                -> can_be_head_chef

Matching is best-effort by house number + first name (case-insensitive). The DB
stores some first names with an extra surname token (e.g. "Carl MM") and a few
nicknames/initials differ from the roster, so we match on exact name, a
"<name> " prefix, or a small alias map. Unmatched rows are skipped silently —
residents can always adjust their own flags on the "Min profil" page. Reverse is
a no-op (we don't track prior values; the flags are user-editable anyway).
"""

import re

from django.db import migrations

# (house_number, name, exempt, over_50, with_housemate, head_chef)
FOOD_TEAM_FLAGS = [
    (1, "Carl", False, False, False, False),
    (1, "Johanne", False, False, False, False),
    (2, "Sanne", False, False, False, False),
    (3, "Richard", False, True, False, True),
    (3, "Lillan", True, True, False, False),
    (4, "Aske", False, False, True, False),
    (4, "Nikoline", False, False, True, False),
    (5, "Peter Emil", False, False, False, True),
    (5, "Hannah", False, False, False, True),
    (6, "Anders", False, False, False, False),
    (6, "Sofie", False, False, False, True),
    (7, "Malene", False, False, False, False),
    (8, "Lasse", False, False, False, False),
    (8, "Elisabeth", False, False, False, True),
    (9, "Jonas", False, False, False, True),
    (9, "Gitte", False, False, False, True),
    (10, "Jens", False, True, False, False),
    (10, "Trine", True, False, False, False),
    (11, "Merete", False, True, False, False),
    (11, "Niels", False, True, False, False),
    (12, "Lasse", False, False, False, False),
    (12, "Kia", False, False, False, True),
    (13, "Andreas", False, False, False, False),
    (13, "Maria", False, False, False, False),
    (14, "Mads", False, False, False, False),
    (14, "Anne", False, False, False, False),
    (15, "Jonas", False, False, False, False),
    (15, "Mette", True, False, False, False),
    (16, "Mads", False, False, False, False),
    (16, "Anne", False, False, False, False),
    (17, "Mikkel", True, False, False, False),
    (17, "Line", False, False, False, False),
    (18, "Phillip", False, False, False, False),
    (18, "Kirstine", True, False, False, False),
    (19, "Søren", False, False, False, False),
    (20, "Eva", False, False, False, True),
    (20, "Simon", False, False, False, False),
    (21, "Lotte", False, False, False, False),
    (21, "Steffen", False, False, False, True),
    (27, "Karen", True, True, False, False),
    (27, "Bent", True, True, False, False),
    (23, "Jens", False, True, False, False),
    (23, "Trine", False, True, False, True),
    (24, "Stine", False, False, False, False),
    (24, "Simon", False, False, False, False),
    (25, "Lene", False, True, False, False),
    (26, "Anne-Mette", False, False, False, False),
    (26, "Emil", False, False, False, False),
    (28, "Mads", False, False, False, False),
    (28, "Marie", False, False, False, False),
    (29, "Anne Kirstine", False, True, False, True),
    (29, "Terkild", False, True, False, False),
    (30, "Gro", False, False, False, True),
    (30, "Esben", True, False, False, False),
    (31, "Ditte-Marie", False, False, False, False),
    (31, "Anton", False, False, False, False),
    (32, "Lars", False, False, False, False),
    (32, "Annika", False, False, False, False),
    (33, "Bo", False, False, False, False),
    (33, "Linette", False, False, False, False),
    (35, "Annette", False, True, False, False),
    (36, "Lise", False, True, False, False),
    (37, "Susanne", False, True, False, False),
    (37, "Peter", False, True, False, False),
    (38, "Jane", True, False, False, False),
    (38, "Peter", False, False, False, False),
    (39, "Lone", False, True, False, False),
    (40, "Natasha", False, False, False, True),
    (40, "Mads Jacob", False, False, False, True),
    (41, "Vibeke", False, True, False, False),
    (41, "Jørgen", False, True, False, False),
    (42, "Johan", False, False, False, False),
    (42, "Sarah", False, False, False, True),
    (43, "Helge", False, True, True, False),
    (43, "Anne", False, True, True, True),
    (44, "Katrine", False, False, False, True),
    (44, "Matias", False, False, False, True),
    (45, "Niels", False, True, False, False),
    (45, "Annette", False, True, False, False),
    (46, "Niels", False, False, False, False),
    (46, "Deni", False, False, False, False),
    (47, "Bente", False, True, False, False),
    (47, "HC", False, True, False, True),
    (48, "Jonas", False, False, True, False),
    (48, "Sidsel", False, False, True, True),
    (49, "Frank", False, True, False, False),
    (49, "Lisbeth", False, True, False, False),
    (50, "Isla", True, False, False, False),
    (50, "Kristian", False, False, False, False),
    (51, "Søren", False, True, False, False),
    (51, "Lotte", False, True, False, False),
    (52, "Asger", False, False, True, False),
    (52, "Christina", False, False, True, True),
    (53, "Pia", False, True, False, True),
    (54, "Jeppe", False, False, False, True),
    (54, "Anne-Mette", False, False, False, False),
    (55, "Birgit", False, True, True, False),
    (55, "Leo", False, True, True, False),
    (56, "Kasper", False, False, False, True),
    (56, "Nanna", True, False, False, False),
    (58, "Søren", False, False, False, False),
    (58, "Katrine", False, False, False, False),
    (60, "Johan", False, False, False, False),
    (62, "Nikolaj", False, False, False, False),
    (62, "Marie", False, False, False, False),
]

# (house_number, roster_name_lower) -> db first_name lower, for spelling/initials
# that the name-prefix rule can't bridge.
ALIASES = {
    (18, "phillip"): "philip",
    (46, "deni"): "denitza",
    (47, "hc"): "hans christian",
}


def _house_number(house) -> int | None:
    if not house or not house.name:
        return None
    m = re.search(r"(\d+)\s*$", house.name)
    return int(m.group(1)) if m else None


def seed_flags(apps, schema_editor):
    User = apps.get_model("users", "User")

    by_house: dict[int, list] = {}
    for u in User.objects.filter(is_active=True).select_related("house"):
        hn = _house_number(u.house)
        if hn is not None:
            by_house.setdefault(hn, []).append(u)

    for house_num, name, exempt, over50, housemate, headchef in FOOD_TEAM_FLAGS:
        candidates = by_house.get(house_num, [])
        target = ALIASES.get((house_num, name.lower()), name.lower())
        matches = [
            u
            for u in candidates
            if (u.first_name or "").strip().lower() == target
            or (u.first_name or "").strip().lower().startswith(target + " ")
        ]
        if len(matches) != 1:
            continue  # ambiguous or missing — leave to self-service
        u = matches[0]
        u.is_exempt_from_food_teams = exempt
        u.is_over_50 = over50
        u.prefers_cooking_with_housemate = housemate
        u.can_be_head_chef = headchef
        u.save(
            update_fields=[
                "is_exempt_from_food_teams",
                "is_over_50",
                "prefers_cooking_with_housemate",
                "can_be_head_chef",
            ]
        )


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [
        ("users", "0011_user_profile_picture_thumbnail"),
    ]

    operations = [
        migrations.RunPython(seed_flags, noop_reverse),
    ]
