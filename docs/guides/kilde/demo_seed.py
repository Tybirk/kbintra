"""Demo data for the guides. Run on a SCRATCH copy only — it renames every resident.

DATA_DIR=<scratch> uv run --with time-machine python manage.py shell < guide_seed2.py

1. Anonymise: every resident gets an example name (never their own first name),
   example e-mail, no phone/bio/photo; children and house descriptions likewise;
   "(Navn 12)" is stripped from event titles.
2. Demo residents Hanne + Bent Eksempel (house 22) and Ole Eksempel, on real
   teams, with a broadcast and a 1:1 swap request made through the real API, a
   favour ledger, and the madhold notifications with their real wording.
"""

import datetime as dt
import random
import re
from zoneinfo import ZoneInfo

import time_machine
from rest_framework.test import APIClient

from apps.announcements.models import Announcement
from apps.events.models import Event
from apps.food.models import (
    CycleStatus,
    FoodTeam,
    FoodTeamCycle,
    FoodTeamMember,
    TeamFavour,
)
from apps.food.services import cycle_planning as cp
from apps.food.utils import house_number_for
from apps.forum.models import Thread
from apps.houses.models import Child, House
from apps.messaging.models import Conversation, Message
from apps.notifications import services as ns
from apps.users.models import User

CPH = ZoneInfo("Europe/Copenhagen")
DEMO = {"hanne@eksempel.dk", "bent@eksempel.dk", "ole@eksempel.dk"}

FIRST = [
    "Anna",
    "Birgit",
    "Camilla",
    "Dorthe",
    "Emma",
    "Freja",
    "Gitte",
    "Ida",
    "Jette",
    "Karen",
    "Lise",
    "Mette",
    "Nina",
    "Pia",
    "Rikke",
    "Signe",
    "Tove",
    "Ulla",
    "Vibeke",
    "Ditte",
    "Elin",
    "Gry",
    "Helle",
    "Inge",
    "Lone",
    "Maja",
    "Nanna",
    "Olivia",
    "Sanne",
    "Tine",
    "Asta",
    "Grethe",
    "Karin",
    "Marianne",
    "Susanne",
    "Anders",
    "Carsten",
    "Erik",
    "Frank",
    "Henrik",
    "Jakob",
    "Jens",
    "Kim",
    "Lars",
    "Morten",
    "Niels",
    "Peter",
    "Rasmus",
    "Søren",
    "Thomas",
    "Uffe",
    "Viggo",
    "Aksel",
    "Bjørn",
    "Christian",
    "Karl",
    "Poul",
    "Rune",
    "Villads",
    "Eigil",
    "Jørgen",
    "Kasper",
    "Mikkel",
    "Torben",
    "Allan",
    "Finn",
    "Kristian",
    "Steen",
    "Martin",
]
LAST = [
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
]
KIDS = [
    "Alma",
    "Bertram",
    "Clara",
    "Elias",
    "Frida",
    "Hugo",
    "Ella",
    "Oscar",
    "Lea",
    "Noah",
    "Liva",
    "Vilja",
    "Malthe",
    "Sigurd",
]


def at(y, m, d, h, mi=0):
    return time_machine.travel(dt.datetime(y, m, d, h, mi, tzinfo=CPH), tick=False)


# ---- 1. anonymise ----------------------------------------------------------- #
rng = random.Random(42)


def _house_no(house) -> str:  # type: ignore[no-untyped-def]
    return house_number_for(house) if house else ""


def _first_word(name: str) -> str:
    return (name or "").split()[0].casefold() if (name or "").split() else ""


real_users = list(User.objects.exclude(email__in=DEMO).select_related("house"))
real_children = list(Child.objects.select_related("house"))
# Every real (first name, house) pair: an example name must never land on a house
# where a real resident of that name lives, or "Navn (12)" points at a real person.
taken = {(_first_word(u.first_name), _house_no(u.house)) for u in real_users} | {
    (_first_word(c.name), _house_no(c.house)) for c in real_children
}
real_full = {f"{u.first_name} {u.last_name}".strip() for u in real_users if u.last_name}
real_first = {u.first_name.split()[0] for u in real_users if u.first_name.split()}
common_last = set(LAST)
rare_last = {
    w
    for u in real_users
    for w in (u.last_name or "").split()
    if len(w) >= 6 and w not in common_last
}


def _pick(pool: list[str], house) -> str:  # type: ignore[no-untyped-def]
    choices = [n for n in pool if (n.casefold(), _house_no(house)) not in taken]
    return rng.choice(choices)


for u in real_users:
    u.first_name = _pick(FIRST, u.house)
    u.last_name = rng.choice(LAST)
    u.email = f"beboer{u.id}@eksempel.dk"
    u.phone_number = ""
    u.bio = ""
    u.profile_picture = ""
    if hasattr(u, "profile_picture_thumbnail"):
        u.profile_picture_thumbnail = ""
    u.save()
for c in real_children:
    c.name = _pick(KIDS, c.house)
    c.profile_picture = ""
    c.profile_picture_thumbnail = ""
    c.save()
House.objects.update(description="", profile_picture="", profile_picture_thumbnail="")

# Free text that names residents: "Navn (12)", "Navn(12)", full names, rare surnames.
NAME_HOUSE = re.compile(
    r"\b(?:"
    + "|".join(sorted(map(re.escape, real_first), key=len, reverse=True))
    + r")\s*\(\s*\d+\s*\)"
)


def _names_someone(text: str) -> bool:
    return bool(
        NAME_HOUSE.search(text or "")
        or any(n in (text or "") for n in real_full)
        or any(re.search(rf"\b{re.escape(w)}\b", text or "") for w in rare_last)
    )


for e in Event.objects.all():
    clean = re.sub(r"\s*\([^)]*\d+[^)]*\)", "", e.title).strip()
    if _names_someone(clean):
        clean = "Arrangement"
    if clean != e.title:
        Event.objects.filter(pk=e.pk).update(title=clean or "Arrangement")
for t in Thread.objects.all():
    if _names_someone(t.title):
        Thread.objects.filter(pk=t.pk).update(title="Eksempeltråd")
for a in Announcement.objects.all():
    if _names_someone(a.title) or _names_someone(a.content):
        Announcement.objects.filter(pk=a.pk).update(
            content="<p>Opslag til alle beboere.</p>"
        )
from apps.forum.models import Subgroup  # noqa: E402

for sg in Subgroup.objects.all():
    if _names_someone(sg.description):
        Subgroup.objects.filter(pk=sg.pk).update(description="")
# Nothing may sit in the future of the demo clock (it would read "om en dag").
Announcement.objects.filter(
    created_at__gt=dt.datetime(2026, 10, 1, 16, tzinfo=CPH)
).update(created_at=dt.datetime(2026, 9, 30, 12, tzinfo=CPH))
print("anonymised", len(real_users), "users,", len(real_children), "children")

# ---- 2. demo residents ------------------------------------------------------ #
empty = [
    h
    for h in House.objects.all()
    if not User.objects.filter(house=h, is_active=True).exists()
]
h22 = next(h for h in empty if house_number_for(h) == "22")
h_ole, _ = House.objects.get_or_create(name="Kløverbakkevej 64")


def demo(first, email, house, birth, **flags):
    u, _ = User.objects.get_or_create(
        email=email,
        defaults={
            "first_name": first,
            "last_name": "Eksempel",
            "house": house,
            "birthdate": birth,
        },
    )
    u.set_password("demo1234")
    u.is_active = True
    for k, v in flags.items():
        setattr(u, k, v)
    u.save()
    return u


hanne = demo(
    "Hanne",
    "hanne@eksempel.dk",
    h22,
    dt.date(1951, 4, 12),
    can_be_head_chef=True,
    default_cooking_days=[1, 3],
)
bent = demo("Bent", "bent@eksempel.dk", h22, dt.date(1949, 8, 3))
ole = demo("Ole", "ole@eksempel.dk", h_ole, dt.date(1958, 2, 20))


def member(user, d):
    team = FoodTeam.objects.get(date=d)
    m, _ = FoodTeamMember.objects.get_or_create(
        team=team, user=user, defaults={"house_number": house_number_for(user.house)}
    )
    return m


D = dt.date
h_today = member(hanne, D(2026, 10, 1))
h_1910 = member(hanne, D(2026, 10, 19))
member(bent, D(2026, 9, 29))
member(bent, D(2026, 10, 7))
o_2010 = member(ole, D(2026, 10, 20))
cycle = h_today.team.cycle

karin_m = (
    FoodTeamMember.objects.filter(team__date=D(2026, 10, 8))
    .exclude(user__in=[hanne, bent, ole])
    .first()
)
karin = karin_m.user
# Three different first names, so the guide never reads as one person doing two things.
taker = next(
    m.user
    for m in FoodTeamMember.objects.filter(team__date=D(2026, 9, 24))
    if m.user.first_name != karin.first_name
)
debtor = next(
    m.user
    for m in FoodTeamMember.objects.filter(team__date=D(2026, 9, 28))
    if m.user.first_name not in (karin.first_name, taker.first_name)
)

# The next period, open for wishes.
with at(2026, 10, 1, 8):
    start = cp.suggested_start_date()
    dates = cp.next_cooking_dates(cp.suggested_day_count(), start)
    nxt, _ = FoodTeamCycle.objects.get_or_create(
        name=cp.suggest_cycle_name(dates),
        defaults={
            "cooking_dates": dates,
            "status": CycleStatus.COLLECTING_WISHES,
            "wish_deadline": dt.datetime(2026, 10, 15, 23, 59, tzinfo=CPH),
        },
    )

# Favour ledger: Hanne owes `taker` for 24/9, `debtor` owes Hanne for 28/9.
with at(2026, 9, 23, 14):
    TeamFavour.objects.get_or_create(
        creditor=taker,
        debtor=hanne,
        origin_date=D(2026, 9, 24),
        defaults={"cycle": cycle},
    )
    ns.notify_food_shift_taken_over(hanne, taker, "2026-09-24", settled_favour=False)
with at(2026, 9, 27, 10):
    TeamFavour.objects.get_or_create(
        creditor=hanne,
        debtor=debtor,
        origin_date=D(2026, 9, 28),
        defaults={"cycle": cycle},
    )

me = User.objects.filter(pk=hanne.pk)
with at(2026, 9, 28, 20):
    ns.notify_food_team_housemate_reminder(hanne, ["Bent"], "2026-09-29")
with at(2026, 9, 29, 19):
    ns.notify_food_team_plan_ready(hanne, cycle.name, ["2026-10-01", "2026-10-19"])
with at(2026, 9, 30, 16, 50):
    ns.create_notification(
        user=hanne,
        notification_type=ns.NotificationType.FOOD_TEAM_TAKEAWAY_READY,
        title="Takeaway klar kl. 17:15",
        message="Dagens takeaway kan hentes i fælleshuset fra kl. 17:15",
        link="/mad",
    )
with at(2026, 9, 30, 18, 55):
    ns.create_notification(
        user=hanne,
        notification_type=ns.NotificationType.FOOD_TEAM_LEFTOVERS_READY,
        title="Rester er klar",
        message="Der er rester i fælleshuset: Peanut nudler i køleskabet",
        link="/mad/rester",
    )
with at(2026, 9, 30, 20):
    ns.notify_food_team_reminder(hanne, "2026-10-01")
with at(2026, 10, 1, 9):
    ns.notify_food_team_wishes_open(hanne, nxt.name, "15/10")

author = (
    User.objects.filter(is_active=True, is_staff=True).exclude(email__in=DEMO).first()
    or karin
)
with at(2026, 10, 1, 9, 30):
    ann = Announcement.objects.create(
        author=author,
        title="Madhold er nu i KB Intra",
        content="<p>Fra i dag finder du dine maddage under <b>Madhold</b> i menuen. "
        "Der kan du også bytte, og du får besked aftenen før, du skal lave mad.</p>",
    )
    ns.notify_new_announcement(me, author, ann.title, ann.id)

thread = (
    Thread.objects.filter(subgroup__slug="faelles")
    .exclude(title__icontains="test")
    .order_by("-created_at")
    .first()
)
with at(2026, 10, 1, 10):
    ns.notify_new_thread(
        me,
        thread.author,
        thread.title,
        thread.id,
        thread.subgroup.name,
        thread.subgroup.slug,
        thread.slug,
    )

api = APIClient(HTTP_HOST="localhost")
with at(2026, 10, 1, 11):
    api.force_authenticate(ole)
    r = api.post(
        "/api/food/swap-broadcasts/",
        {
            "requester_membership_id": o_2010.id,
            "available_dates": ["2026-10-19", "2026-10-08"],
            "message": "Jeg er bortrejst den 20.",
        },
        format="json",
    )
    print("broadcast", r.status_code, str(r.data)[:160])
with at(2026, 10, 1, 12, 30):
    api.force_authenticate(karin)
    r = api.post(
        "/api/food/swap-requests/",
        {
            "requester_membership_id": karin_m.id,
            "target_membership_id": h_1910.id,
            "message": "Som aftalt i går",
        },
        format="json",
    )
    print("swap request", r.status_code, str(r.data)[:160])

ev = Event.objects.filter(title="Over Broen - rockkoncert").first()
if ev:
    with at(2026, 10, 1, 13):
        ns.create_notification(
            user=hanne,
            notification_type=ns.NotificationType.EVENT_REMINDER,
            title=f"I morgen: {ev.title}",
            message="Fredag kl. 20:00 – spisesalen",
            link=f"/kalender/{ev.slug}",
        )

conv = Conversation.objects.filter(participants=hanne).filter(participants=bent).first()
if conv is None:
    conv = Conversation.objects.create()
    conv.participants.add(hanne, bent)
    for t, who, text in [
        (
            (2026, 10, 1, 10, 2),
            bent,
            "Hej Hanne! Skal vi gå en tur ved søen i morgen formiddag?",
        ),
        (
            (2026, 10, 1, 10, 15),
            hanne,
            "Ja, gerne! Skal vi sige kl. 10 ved fælleshuset?",
        ),
        ((2026, 10, 1, 10, 16), bent, "Det er en aftale 😊"),
    ]:
        with at(*t):
            Message.objects.create(conversation=conv, sender=who, content=text)

print(
    "demo ready: hanne",
    hanne.pk,
    "karin",
    karin.first_name,
    "taker",
    taker.first_name,
    "debtor",
    debtor.first_name,
    "next cycle",
    nxt.name,
)
