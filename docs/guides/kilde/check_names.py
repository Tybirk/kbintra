"""Compare the anonymised guide DB against the real names in the prod copy.

python3 check_names.py <prod.sqlite3> <guide.sqlite3>
"""

import re
import sqlite3
import sys

prod = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
guide = sqlite3.connect(f"file:{sys.argv[2]}?mode=ro", uri=True)


def house_no(name: str | None) -> str:
    m = re.search(r"(\d+)\s*$", name or "")
    return m.group(1) if m else ""


q = """select u.first_name, u.last_name, h.name from users_user u
       left join houses_house h on h.id = u.house_id"""
real = [(f or "", last or "", house_no(h)) for f, last, h in prod.execute(q)]
real_children = [
    (n or "", house_no(h))
    for n, h in prod.execute(
        "select c.name, h.name from houses_child c left join houses_house h on h.id = c.house_id"
    )
]

# 1. An example name that lands on the same house as a real resident of that name.
real_pairs = {(f.split()[0].casefold(), h) for f, _l, h in real if f} | {
    (n.split()[0].casefold(), h) for n, h in real_children if n
}
collisions = [
    (f, last, h)
    for f, last, h in (
        (f or "", last or "", house_no(hn)) for f, last, hn in guide.execute(q)
    )
    if f
    and (f.split()[0].casefold(), h) in real_pairs
    and not last.endswith("Eksempel")
]
print("same-name-same-house collisions:", collisions)

# 2. Real names in the free text the screenshots show.
texts = []
for table, cols in [
    ("forum_thread", ["title"]),
    ("events_event", ["title", "location"]),
    ("announcements_announcement", ["title", "content"]),
    ("forum_subgroup", ["name", "description"]),
    (
        "food_drivemenucache",
        [
            "monday_menu",
            "tuesday_menu",
            "wednesday_menu",
            "thursday_menu",
            "daily_front_pages",
            "recipe_sheets",
        ],
    ),
    ("links_usefullinks", ["content"]),
]:
    try:
        for row in guide.execute(f"select {', '.join(cols)} from {table}"):
            texts.extend(str(v) for v in row if v)
    except sqlite3.OperationalError as exc:
        print("skip", table, exc)
blob = "\n".join(texts)

full_names = {f"{f} {last}".strip() for f, last, _h in real if f and last}
hits_full = sorted(n for n in full_names if len(n) > 6 and n in blob)
first_house = sorted({f"{f.split()[0]} ({h})" for f, _l, h in real if f and h})
hits_fh = sorted(n for n in first_house if n in blob)
common = {
    "Jensen",
    "Nielsen",
    "Hansen",
    "Pedersen",
    "Andersen",
    "Christensen",
    "Larsen",
    "Sørensen",
    "Rasmussen",
    "Jørgensen",
    "Petersen",
    "Madsen",
    "Kristensen",
    "Olsen",
    "Thomsen",
    "Poulsen",
    "Johansen",
    "Møller",
    "Mortensen",
    "Knudsen",
    "Jakobsen",
    "Lund",
    "Holm",
    "Bach",
    "Kjær",
    "Dam",
    "Bak",
    "Krogh",
    "Vestergaard",
    "Skov",
}
rare_last = {
    w for _f, last, _h in real for w in last.split() if len(w) >= 6 and w not in common
}
hits_last = sorted(w for w in rare_last if re.search(rf"\b{re.escape(w)}\b", blob))
print("real full names in free text:", hits_full)
print("real 'Fornavn (husnr)' in free text:", hits_fh)
print("rare real surnames in free text:", hits_last)
