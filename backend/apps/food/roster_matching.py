"""Find the resident a printed roster means by "<fornavn> (<husnummer>)".

Shared by the importers that read the madhold CLI's lists (the published plan
and all_persons.csv), so both resolve a name the same way.
"""

import difflib

from apps.food.utils import house_number_for
from apps.users.models import User


def residents_by_house() -> dict[str, list[User]]:
    """Every active resident, grouped by the number on their house."""
    by_house: dict[str, list[User]] = {}
    for user in User.objects.filter(is_active=True).select_related("house"):
        by_house.setdefault(house_number_for(user.house), []).append(user)
    return by_house


def match_resident(
    name: str, house_number: str, by_house: dict[str, list[User]]
) -> tuple[User | None, str]:
    """Find the one resident in ``house_number`` that ``name`` refers to.

    Returns (user, note); user is None when nobody or several people fit.
    Everything is decided within the house, so tolerant tiers stay safe:
    houses hold a handful of adults, not ninety.
    """
    candidates = by_house.get(house_number, [])
    if not candidates:
        return None, f"hus {house_number} findes ikke, eller har ingen beboere"

    wanted = name.casefold()

    def pick(matches: list[User], note: str) -> tuple[User | None, str] | None:
        if len(matches) == 1:
            return matches[0], note
        if len(matches) > 1:
            names = ", ".join(f"{u.first_name} {u.last_name}".strip() for u in matches)
            return None, f"flere i hus {house_number} passer på {name!r}: {names}"
        return None

    # 1. The whole registered first name, exactly.
    if hit := pick([u for u in candidates if u.first_name.casefold() == wanted], ""):
        return hit

    # 2. The first word of it -- "Helge Kjær" is called Helge on the list.
    first_word = [u for u in candidates if u.first_name.casefold().split()[:1] == [wanted]]
    if hit := pick(first_word, f"{name} → {{full}}"):
        return hit

    # 3. A shortening of it: "Deni" for "Denitza".
    prefix = [u for u in candidates if u.first_name.casefold().startswith(wanted)]
    if hit := pick(prefix, f"{name} → {{full}}"):
        return hit

    # 4. Initials: "HC" for "Hans Christian".
    if wanted.isalpha() and 1 < len(wanted) <= 3:
        initials = [
            u
            for u in candidates
            if "".join(w[0] for w in u.first_name.casefold().split() if w) == wanted
        ]
        if hit := pick(initials, f"{name} → {{full}} (initialer)"):
            return hit

    # 5. Spelling variants: "Phillip" for "Philip".
    close = difflib.get_close_matches(
        wanted, [u.first_name.casefold() for u in candidates], n=2, cutoff=0.8
    )
    if len(close) == 1:
        matched = [u for u in candidates if u.first_name.casefold() == close[0]]
        if hit := pick(matched, f"{name} → {{full}} (stavemåde)"):
            return hit

    living = ", ".join(f"{u.first_name} {u.last_name}".strip() for u in candidates)
    return None, f"ingen i hus {house_number} hedder {name!r}. Huset har: {living}"
