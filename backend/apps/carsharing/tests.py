"""
Tests for the car sharing (bildeling) app.
"""

import datetime
import re
from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError
from django.urls import reverse
from django.utils import timezone

from apps.carsharing.constants import (
    DEFAULT_RATE_PER_KM,
    MAX_BLOCKS_PER_CAR,
    MAX_CANDIDATES_PER_LOAN,
    MAX_LOAN_DAYS,
    TERMS_VERSION,
)
from apps.carsharing.models import CarBlock, CarLoan, CarLoanCandidate
from apps.carsharing.services import has_open_request, shared_cars_with_availability
from apps.houses.models import Car, House
from apps.notifications.models import Notification, NotificationType
from apps.users.models import User


def _make_car(house, plate="AB12345", **overrides):
    """A car that is genuinely on offer: shared *and* with the terms accepted."""
    defaults = {
        "is_shared": True,
        "make": "Skoda",
        "model_name": "Octavia",
        "seats": 5,
        "terms_accepted_version": TERMS_VERSION,
        "terms_accepted_at": timezone.now(),
    }
    defaults.update(overrides)
    return Car.objects.create(house=house, license_plate=plate, **defaults)


def _window(days_ahead=1, start_hour=9, hours=3):
    """An aware window in local time, safely in the future."""
    tz = timezone.get_current_timezone()
    day = (timezone.localtime(timezone.now()) + datetime.timedelta(days=days_ahead)).date()
    start = timezone.make_aware(datetime.datetime.combine(day, datetime.time(start_hour)), tz)
    return start, start + datetime.timedelta(hours=hours)


@pytest.fixture
def owner_house(db):
    return House.objects.create(name="House 7", address="Kløverbakkevej 7")


@pytest.fixture
def owner(db, owner_house):
    return User.objects.create_user(
        email="owner@example.com",
        password="testpass123",
        first_name="Ove",
        last_name="Ejer",
        house=owner_house,
    )


@pytest.fixture
def borrower(db, house):
    return User.objects.create_user(
        email="borrower@example.com",
        password="testpass123",
        first_name="Bo",
        last_name="Låner",
        house=house,
    )


def _client_for(person):
    """A client of its own — sharing one APIClient across fixtures would mean the
    last force_authenticate silently wins for both."""
    from rest_framework.test import APIClient

    client = APIClient()
    client.force_authenticate(user=person)
    return client


@pytest.fixture
def borrower_client(borrower):
    return _client_for(borrower)


@pytest.fixture
def owner_client(owner):
    return _client_for(owner)


def _create_loan(client, cars, *, start=None, end=None, **extra):
    start_at, end_at = (start, end) if start else _window()
    payload = {
        "start_at": start_at.isoformat(),
        "end_at": end_at.isoformat(),
        "expected_km": 40,
        "car_ids": [car.id for car in cars],
        # The borrower has to confirm the terms; tests that check the gate itself
        # override this.
        "accepted_terms": True,
        **extra,
    }
    return client.post(reverse("carsharing-loan-list"), payload, format="json")


# -- Delebilpark flag and rate --------------------------------------------------


@pytest.mark.django_db
def test_shared_car_requires_license_plate(owner_house):
    car = Car(house=owner_house, license_plate="", is_shared=True)
    with pytest.raises(ValidationError) as exc:
        car.clean()
    assert "nummerplade" in str(exc.value)


@pytest.mark.django_db
def test_shared_car_with_plate_is_valid(owner_house):
    Car(house=owner_house, license_plate="AB12345", is_shared=True).clean()


@pytest.mark.django_db
def test_api_rejects_sharing_car_without_plate(authenticated_client, user, house):
    user.house = house
    user.save()
    car = Car.objects.create(house=house, license_plate="")
    response = authenticated_client.patch(
        reverse("car-detail", args=[car.id]), {"is_shared": True}, format="json"
    )
    assert response.status_code == 400
    assert "nummerplade" in str(response.data)


@pytest.mark.django_db
def test_rate_falls_back_to_default(owner_house, borrower, borrower_client):
    car = _make_car(owner_house, rate_per_km=None)
    _create_loan(borrower_client, [car])
    candidate = CarLoanCandidate.objects.get(car=car)
    loan = candidate.loan

    _accept(car)

    loan.refresh_from_db()
    assert loan.rate_per_km == DEFAULT_RATE_PER_KM


@pytest.mark.django_db
def test_rate_snapshot_survives_later_rate_change(owner_house, borrower, borrower_client):
    car = _make_car(owner_house, rate_per_km=Decimal("5.00"))
    _create_loan(borrower_client, [car])
    candidate = CarLoanCandidate.objects.get(car=car)
    _accept(car)

    car.rate_per_km = Decimal("9.99")
    car.save()

    loan = CarLoan.objects.get(pk=candidate.loan_id)
    assert loan.rate_per_km == Decimal("5.00")
    loan.actual_km = 10
    assert loan.calculate_amount_due() == Decimal("50.00")


# -- Terms: the file, and both parties' consent ------------------------------


def _terms_lines(rate=None) -> list[str]:
    """Every point and paragraph of the terms, flattened for assertions."""
    from apps.carsharing.constants import loan_terms_sections

    lines: list[str] = []
    for section in loan_terms_sections(rate):
        for block in section["blocks"]:
            if block["kind"] == "bullets":
                lines.extend(f"{item['lead']} {item['text']}".strip() for item in block["items"])
            else:
                lines.append(block["text"])
    return lines


def test_terms_come_from_the_markdown_file():
    """The file is the only source, so a parse failure must not pass silently."""
    from apps.carsharing.constants import LOAN_TERMS_TITLE, TERMS_FILE, loan_terms_sections

    assert TERMS_FILE.exists()
    assert LOAN_TERMS_TITLE == "Vilkår for lån af bil i delebilparken"
    sections = loan_terms_sections()
    assert len(sections) >= 10
    lines = _terms_lines()
    # Editing instructions live in an HTML comment and are not terms.
    assert not any(line.startswith("<!--") or "-->" in line for line in lines)
    # Wrapped lines are joined rather than truncated at the wrap.
    assert any("i samme stand som du fik den" in line for line in lines)


def test_terms_keep_the_numbered_sections():
    """The agreement is read by section number, so the headings must survive."""
    from apps.carsharing.constants import loan_terms_sections

    headings = [section["heading"] for section in loan_terms_sections()]
    assert headings[0] == "Kort fortalt"
    assert "5. Hvad du betaler, hvis der er sket skade" in headings
    assert "11. Ændringer" in headings
    # Every section carries something; an empty one means a parse slip.
    assert all(section["blocks"] for section in loan_terms_sections())


def test_a_blank_line_separates_two_paragraphs():
    """A wrapped line continues a paragraph; a blank line starts a new one.

    Without the distinction section 1 became one run-on block, which in a legal
    text silently merges two separate provisions.
    """
    from apps.carsharing.constants import loan_terms_sections

    section = next(s for s in loan_terms_sections() if s["heading"].startswith("1."))
    paragraphs = [b["text"] for b in section["blocks"] if b["kind"] == "paragraph"]
    assert len(paragraphs) == 2
    assert paragraphs[0].startswith("Et lån er en privat aftale")
    assert paragraphs[0].endswith("skader, tab eller udgifter.")
    assert paragraphs[1].startswith("Når du sender en forespørgsel")


def test_a_bold_opening_becomes_a_lead_label():
    """Section 5 is nine cases, each introduced in bold. Losing that is unreadable."""
    from apps.carsharing.constants import loan_terms_sections

    section = next(s for s in loan_terms_sections() if s["heading"].startswith("5."))
    bullets = [item for block in section["blocks"] for item in block.get("items", [])]
    leads = [item["lead"] for item in bullets if item["lead"]]
    assert "Anmeldes skaden:" in leads
    assert "Loft:" in leads
    # The lead is split off, not duplicated into the body.
    anmeldes = next(item for item in bullets if item["lead"] == "Anmeldes skaden:")
    assert anmeldes["text"].startswith("du betaler ejerens selvrisiko")


def test_the_adopted_amounts_are_in_the_terms():
    """The bracketed proposals were adopted; a stray bracket means a bad edit."""
    lines = _terms_lines()
    joined = " ".join(lines)
    assert "3.000 kr." in joined
    assert "8.000 kr." in joined
    assert "24 timer" in joined
    assert "[" not in joined and "]" not in joined


def test_the_background_note_is_not_part_of_the_terms():
    """The appendix reasons about insurance law; residents must not tick that."""
    joined = " ".join(_terms_lines())
    assert "erstatningsansvarsloven" not in joined
    assert "bonusbeskyttelse" in joined.lower()  # the term itself does mention it
    assert "telefonopringning" not in joined


def test_terms_version_is_a_date():
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", TERMS_VERSION)


def test_the_rate_placeholder_is_filled_in():
    from apps.carsharing.constants import loan_terms_text

    assert "{rate}" not in loan_terms_text()
    assert any("3,94" in line for line in _terms_lines())
    assert any("9,50" in line for line in _terms_lines(Decimal("9.50")))


def test_docs_symlink_is_the_same_file():
    """docs/bildeling-vilkaar.md is the path people edit; it must not be a copy."""
    from apps.carsharing.constants import TERMS_FILE

    docs_path = TERMS_FILE.parents[3] / "docs" / "bildeling-vilkaar.md"
    assert docs_path.exists(), f"{docs_path} findes ikke"
    assert docs_path.resolve() == TERMS_FILE.resolve()


def test_a_malformed_terms_file_is_rejected(tmp_path):
    """A silently empty set of terms would mean agreeing to nothing."""
    from django.core.exceptions import ImproperlyConfigured

    from apps.carsharing import constants

    for text in (
        "",
        "# Kun en overskrift\n",
        "Version: 2026-08-04\n- Et vilkår\n",
        # Title and version, but the point sits before any section heading, so
        # there are no terms to show.
        "# En overskrift\n\nVersion: 2026-08-04\n\n- Et hjemløst vilkår\n",
        # A heading with nothing under it is a slip, not an agreement.
        "# En overskrift\n\nVersion: 2026-08-04\n\n## Tomt afsnit\n",
    ):
        broken = tmp_path / "vilkaar.md"
        broken.write_text(text, encoding="utf-8")
        original = constants.TERMS_FILE
        constants.TERMS_FILE = broken
        try:
            with pytest.raises(ImproperlyConfigured):
                constants._load_terms()
        finally:
            constants.TERMS_FILE = original


@pytest.mark.django_db
def test_borrower_must_confirm_the_terms(owner_house, borrower_client):
    car = _make_car(owner_house)

    refused = _create_loan(borrower_client, [car], accepted_terms=False)

    assert refused.status_code == 400
    assert "vilkårene" in str(refused.data)
    assert not CarLoan.objects.exists()


@pytest.mark.django_db
def test_a_request_without_the_field_is_refused(owner_house, borrower_client):
    """Absent must not read as "declined quietly" — the client has to be explicit."""
    car = _make_car(owner_house)
    start_at, end_at = _window()

    response = borrower_client.post(
        reverse("carsharing-loan-list"),
        {
            "start_at": start_at.isoformat(),
            "end_at": end_at.isoformat(),
            "expected_km": 40,
            "car_ids": [car.id],
        },
        format="json",
    )

    assert response.status_code == 400
    assert "accepted_terms" in response.data


@pytest.mark.django_db
def test_the_loan_records_both_sides_accepted_version(owner_house, borrower_client):
    car = _make_car(owner_house)
    _create_loan(borrower_client, [car])

    _accept(car)

    loan = CarLoan.objects.get()
    assert loan.terms_version == TERMS_VERSION
    assert loan.owner_terms_version == TERMS_VERSION


@pytest.mark.django_db
def test_owner_must_accept_the_terms_to_share_a_car(authenticated_client, user, house):
    user.house = house
    user.save()
    car = Car.objects.create(house=house, license_plate="AB12345")
    url = reverse("car-detail", args=[car.id])

    refused = authenticated_client.patch(url, {"is_shared": True}, format="json")
    assert refused.status_code == 400
    assert "vilkårene" in str(refused.data)
    car.refresh_from_db()
    assert car.is_shared is False

    accepted = authenticated_client.patch(
        url, {"is_shared": True, "accept_terms": True}, format="json"
    )
    assert accepted.status_code == 200
    car.refresh_from_db()
    assert car.is_shared is True
    assert car.terms_accepted_version == TERMS_VERSION
    assert car.terms_accepted_at is not None
    assert car.has_accepted_current_terms is True


@pytest.mark.django_db
def test_owner_need_not_reaccept_on_every_edit(authenticated_client, user, house):
    user.house = house
    user.save()
    car = Car.objects.create(
        house=house,
        license_plate="AB12345",
        is_shared=True,
        terms_accepted_version=TERMS_VERSION,
        terms_accepted_at=timezone.now(),
    )

    response = authenticated_client.patch(
        reverse("car-detail", args=[car.id]), {"color": "grøn"}, format="json"
    )

    assert response.status_code == 200
    car.refresh_from_db()
    assert car.color == "grøn"
    assert car.is_shared is True


@pytest.mark.django_db
def test_a_car_with_stale_consent_is_not_offered(owner_house, borrower, borrower_client):
    """A new terms date takes cars out of the delebilpark until owners re-accept."""
    start_at, end_at = _window()
    car = _make_car(owner_house, terms_accepted_version="1999-01-01")

    result = shared_cars_with_availability(start_at, end_at)
    assert result == []

    listed = borrower_client.get(
        reverse("carsharing-car-list"),
        {"start": start_at.isoformat(), "end": end_at.isoformat()},
    )
    assert listed.data["cars"] == []

    # And it cannot be asked for directly either.
    refused = _create_loan(borrower_client, [car])
    assert refused.status_code == 400
    assert "delebilparken" in str(refused.data)


# -- Availability -----------------------------------------------------------


@pytest.mark.django_db
def test_schedule_conflict_is_soft_and_marked(owner_house):
    start_at, end_at = _window(start_hour=9, hours=3)
    car = _make_car(owner_house)
    local_start = timezone.localtime(start_at)
    CarBlock.objects.create(
        car=car,
        days_of_week=[local_start.weekday()],
        start_time=datetime.time(8),
        end_time=datetime.time(16),
    )

    result = shared_cars_with_availability(start_at, end_at)
    assert len(result) == 1
    assert result[0].conflict == "schedule"
    assert result[0].selectable is True
    assert "Normalt optaget" in result[0].conflict_note


@pytest.mark.django_db
def test_block_outside_window_is_no_conflict(owner_house):
    start_at, end_at = _window(start_hour=9, hours=2)
    car = _make_car(owner_house)
    local_start = timezone.localtime(start_at)
    CarBlock.objects.create(
        car=car,
        days_of_week=[local_start.weekday()],
        start_time=datetime.time(18),
        end_time=datetime.time(22),
    )

    result = shared_cars_with_availability(start_at, end_at)
    assert result[0].conflict is None


@pytest.mark.django_db
def test_block_on_other_weekday_is_no_conflict(owner_house):
    start_at, end_at = _window(start_hour=9, hours=2)
    car = _make_car(owner_house)
    other_day = (timezone.localtime(start_at).weekday() + 3) % 7
    CarBlock.objects.create(
        car=car,
        days_of_week=[other_day],
        start_time=datetime.time(8),
        end_time=datetime.time(16),
    )

    result = shared_cars_with_availability(start_at, end_at)
    assert result[0].conflict is None


@pytest.mark.django_db
def test_open_request_is_information_only(owner_house, borrower, borrower_client):
    start_at, end_at = _window()
    car = _make_car(owner_house)
    _create_loan(borrower_client, [car], start=start_at, end=end_at)

    result = shared_cars_with_availability(start_at, end_at)
    assert result[0].conflict == "requested"
    assert result[0].selectable is True


@pytest.mark.django_db
def test_active_loan_is_hard_conflict(owner_house, borrower):
    start_at, end_at = _window()
    car = _make_car(owner_house)
    CarLoan.objects.create(
        borrower=borrower,
        status=CarLoan.Status.ACTIVE,
        start_at=start_at,
        end_at=end_at,
        expected_km=10,
        terms_version=TERMS_VERSION,
        car=car,
    )

    result = shared_cars_with_availability(start_at, end_at)
    assert result[0].conflict == "loan"
    assert result[0].selectable is False


@pytest.mark.django_db
def test_cars_are_never_filtered_away_and_free_sort_first(owner_house, borrower):
    start_at, end_at = _window()
    free = _make_car(owner_house, plate="CD11111", make="Fri")
    lent = _make_car(owner_house, plate="EF22222", make="Udlånt")
    CarLoan.objects.create(
        borrower=borrower,
        status=CarLoan.Status.ACTIVE,
        start_at=start_at,
        end_at=end_at,
        expected_km=10,
        terms_version=TERMS_VERSION,
        car=lent,
    )

    result = shared_cars_with_availability(start_at, end_at)
    assert [item.car.id for item in result] == [free.id, lent.id]


@pytest.mark.django_db
def test_loan_boundary_does_not_collide(owner_house, borrower):
    """A loan 10-12 and a loan 12-14 on the same car do not overlap."""
    tz = timezone.get_current_timezone()
    day = (timezone.localtime(timezone.now()) + datetime.timedelta(days=2)).date()
    first_start = timezone.make_aware(datetime.datetime.combine(day, datetime.time(10)), tz)
    first_end = timezone.make_aware(datetime.datetime.combine(day, datetime.time(12)), tz)
    second_end = timezone.make_aware(datetime.datetime.combine(day, datetime.time(14)), tz)

    car = _make_car(owner_house)
    CarLoan.objects.create(
        borrower=borrower,
        status=CarLoan.Status.ACTIVE,
        start_at=first_start,
        end_at=first_end,
        expected_km=10,
        terms_version=TERMS_VERSION,
        car=car,
    )

    result = shared_cars_with_availability(first_end, second_end)
    assert result[0].conflict is None


@pytest.mark.django_db
def test_requirements_mark_but_do_not_filter(owner_house):
    start_at, end_at = _window()
    _make_car(owner_house, has_isofix=False)
    result = shared_cars_with_availability(start_at, end_at, needs_isofix=True)
    assert len(result) == 1
    assert result[0].meets_requirements is False


@pytest.mark.django_db
def test_own_household_cars_are_excluded(house, owner_house):
    start_at, end_at = _window()
    _make_car(house, plate="GH33333")
    _make_car(owner_house, plate="IJ44444")
    result = shared_cars_with_availability(start_at, end_at, exclude_house_id=house.id)
    assert [item.car.license_plate for item in result] == ["IJ44444"]


# -- Request → first yes wins ----------------------------------------------


@pytest.mark.django_db
def test_first_owner_to_accept_gets_the_loan(owner_house, borrower, borrower_client):
    """Three cars asked, two owners try to say yes — only the first one counts."""
    house_b = House.objects.create(name="House 8", address="Kløverbakkevej 8")
    house_c = House.objects.create(name="House 9", address="Kløverbakkevej 9")
    owner_b = User.objects.create_user(
        email="b@example.com", password="x", first_name="Bodil", house=house_b
    )
    owner_c = User.objects.create_user(
        email="c@example.com", password="x", first_name="Carl", house=house_c
    )
    car_a = _make_car(owner_house, plate="AA11111")
    car_b = _make_car(house_b, plate="BB22222")
    car_c = _make_car(house_c, plate="CC33333")

    response = _create_loan(borrower_client, [car_a, car_b, car_c])
    assert response.status_code == 201
    loan_id = response.data["id"]
    assert len(response.data["candidates"]) == 3
    assert response.data["terms_version"] == TERMS_VERSION

    # Bodil is first: that alone starts the loan, with no borrower step.
    first = _accept(car_b, loan_id)
    assert first.status_code == 200
    assert first.data["status"] == CarLoan.Status.ACTIVE
    assert first.data["car"] == car_b.id

    # Carl is slower, and is told *why* — not the generic "no longer open".
    second = _accept(car_c, loan_id)
    assert second.status_code == 400
    assert "hurtigere" in str(second.data)

    loan = CarLoan.objects.get(pk=loan_id)
    assert loan.status == CarLoan.Status.ACTIVE
    assert loan.car_id == car_b.id
    assert loan.approved_by_id == owner_b.id
    assert loan.rate_per_km == DEFAULT_RATE_PER_KM
    assert loan.activated_at is not None

    # The winner is ACCEPTED; everyone still waiting is released, not rejected.
    assert loan.candidates.get(car=car_b).status == CarLoanCandidate.Status.ACCEPTED
    assert loan.candidates.get(car=car_a).status == CarLoanCandidate.Status.CLOSED
    assert loan.candidates.get(car=car_c).status == CarLoanCandidate.Status.CLOSED

    # The borrower learns they have a car, and the released households learn
    # they are off the hook.
    assert Notification.objects.filter(
        user=borrower, notification_type=NotificationType.CAR_LOAN_UPDATE
    ).exists()
    assert Notification.objects.filter(
        user=owner_c, notification_type=NotificationType.CAR_LOAN_UPDATE
    ).exists()


@pytest.mark.django_db
def test_accepting_twice_is_rejected(owner_house, borrower_client):
    """A double-click must not settle the same loan twice."""
    car = _make_car(owner_house)
    _create_loan(borrower_client, [car])

    first = _accept(car)
    second = _accept(car)

    assert first.status_code == 200
    assert second.status_code == 400
    assert CarLoan.objects.filter(car=car, status=CarLoan.Status.ACTIVE).count() == 1


@pytest.mark.django_db
def test_lending_household_is_told_their_car_went_out(owner, owner_house, borrower_client):
    """The one who clicked yes knows; the rest of the household would not."""
    housemate = User.objects.create_user(
        email="housemate@example.com", password="x", first_name="Hanne", house=owner_house
    )
    car = _make_car(owner_house)
    _create_loan(borrower_client, [car])

    _accept(car, as_user=owner)

    assert Notification.objects.filter(user=housemate, title="Din bil er udlånt").exists()
    # The responder is not told what they just did.
    assert not Notification.objects.filter(user=owner, title="Din bil er udlånt").exists()


@pytest.mark.django_db
def test_declining_leaves_the_request_open_for_the_others(owner_house, borrower_client):
    house_b = House.objects.create(name="House 8")
    User.objects.create_user(
        email="b3@example.com", password="x", first_name="Bodil", house=house_b
    )
    car_a = _make_car(owner_house, plate="AA11111")
    car_b = _make_car(house_b, plate="BB22222")
    _create_loan(borrower_client, [car_a, car_b])

    candidate_a = CarLoanCandidate.objects.get(car=car_a)
    declined = _decline(car_a)

    assert declined.status_code == 200
    assert declined.data["status"] == CarLoan.Status.REQUESTED
    # The other household can still take it.
    assert _accept(car_b, candidate_a.loan_id).status_code == 200


@pytest.mark.django_db
def test_a_declined_household_keeps_that_answer(owner_house, borrower_client):
    """Being released is not the same as having said no, so DECLINED stands."""
    house_b = House.objects.create(name="House 8")
    User.objects.create_user(
        email="b4@example.com", password="x", first_name="Bodil", house=house_b
    )
    car_a = _make_car(owner_house, plate="AA11111")
    car_b = _make_car(house_b, plate="BB22222")
    _create_loan(borrower_client, [car_a, car_b])

    candidate_a = CarLoanCandidate.objects.get(car=car_a)
    _decline(car_a)
    _accept(car_b, candidate_a.loan_id)

    assert CarLoanCandidate.objects.get(car=car_a).status == CarLoanCandidate.Status.DECLINED


@pytest.mark.django_db
def test_request_notifies_owners_with_count(owner_house, borrower, borrower_client, owner):
    house_b = House.objects.create(name="House 8")
    owner_b = User.objects.create_user(
        email="b2@example.com", password="x", first_name="Bodil", house=house_b
    )
    car_a = _make_car(owner_house, plate="AA11111")
    car_b = _make_car(house_b, plate="BB22222")

    _create_loan(borrower_client, [car_a, car_b])

    for recipient in (owner, owner_b):
        notification = Notification.objects.get(
            user=recipient, notification_type=NotificationType.CAR_LOAN_REQUEST
        )
        assert "en af 2 spurgte" in notification.message
        assert "den første der siger ja" in notification.message
        assert notification.link.startswith("/bildeling/laan/")


@pytest.mark.django_db
def test_double_booking_of_same_car_is_rejected(owner_house, owner, house, house2, api_client):
    """Two borrowers want the same car in the same window; only one can have it."""
    start_at, end_at = _window()
    car = _make_car(owner_house)
    borrower_one = User.objects.create_user(
        email="one@example.com", password="x", first_name="En", house=house
    )
    borrower_two = User.objects.create_user(
        email="two@example.com", password="x", first_name="To", house=house2
    )

    loans = []
    for person in (borrower_one, borrower_two):
        api_client.force_authenticate(user=person)
        response = _create_loan(api_client, [car], start=start_at, end=end_at)
        assert response.status_code == 201
        loans.append(response.data["id"])

    owner_client = _client_for(owner)
    responses = []
    for loan_id in loans:
        candidate = CarLoanCandidate.objects.get(loan_id=loan_id, car=car)
        responses.append(
            owner_client.post(
                reverse("carsharing-candidate-respond", args=[loan_id, candidate.id]),
                {"action": "accept"},
                format="json",
            )
        )

    assert responses[0].status_code == 200
    assert responses[1].status_code == 400
    assert "udlånt" in str(responses[1].data).lower()
    assert CarLoan.objects.filter(car=car, status=CarLoan.Status.ACTIVE).count() == 1


@pytest.mark.django_db
def test_candidate_limit_is_enforced(owner_house, borrower_client):
    cars = [
        _make_car(
            House.objects.create(name=f"House 1{index}"),
            plate=f"ZZ{index}{index}{index}{index}{index}",
        )
        for index in range(MAX_CANDIDATES_PER_LOAN + 1)
    ]
    response = _create_loan(borrower_client, cars)
    assert response.status_code == 400
    assert "højst" in str(response.data)


@pytest.mark.django_db
def test_cannot_request_own_household_car(house, borrower_client):
    car = _make_car(house, plate="OW11111")
    response = _create_loan(borrower_client, [car])
    assert response.status_code == 400
    assert "egen husstands" in str(response.data)


@pytest.mark.django_db
def test_cannot_request_car_outside_delebilpark(owner_house, borrower_client):
    car = _make_car(owner_house, is_shared=False)
    response = _create_loan(borrower_client, [car])
    assert response.status_code == 400


# -- Who a loan belongs to, and what that lets them see --------------------


def _roles_setup(owner_house, borrower_client):
    """A loan asked of two households, won by the second one."""
    house_b = House.objects.create(name="House 8", address="Kløverbakkevej 8")
    User.objects.create_user(
        email="roles_b@example.com", password="x", first_name="Bodil", house=house_b
    )
    car_a = _make_car(owner_house, plate="AA11111", practical_note="Nøglen hos A.")
    car_b = _make_car(house_b, plate="BB22222", practical_note="Nøglen hos B.")
    _create_loan(borrower_client, [car_a, car_b])
    loan_id = CarLoan.objects.get().pk
    return car_a, car_b, loan_id


def _loan_as(person, loan_id):
    return _client_for(person).get(reverse("carsharing-loan-detail", args=[loan_id])).data


@pytest.mark.django_db
def test_the_server_names_each_viewers_role(owner, owner_house, borrower, borrower_client):
    """The UI must not have to infer this from status flags — that is what broke."""
    car_a, car_b, loan_id = _roles_setup(owner_house, borrower_client)

    # While the request is open, the asked household still owes an answer.
    assert _loan_as(owner, loan_id)["viewer_role"] == "asked"
    assert _loan_as(borrower, loan_id)["viewer_role"] == "borrower"

    _accept(car_b, loan_id)

    lender = User.objects.get(email="roles_b@example.com")
    assert _loan_as(lender, loan_id)["viewer_role"] == "lender"
    # The household that was released is neither the lender nor still asked.
    assert _loan_as(owner, loan_id)["viewer_role"] == "closed_out"
    assert _loan_as(borrower, loan_id)["viewer_role"] == "borrower"


@pytest.mark.django_db
def test_a_declining_household_is_marked_declined(owner, owner_house, borrower_client):
    car_a, car_b, loan_id = _roles_setup(owner_house, borrower_client)

    _decline(car_a, loan_id)

    assert _loan_as(owner, loan_id)["viewer_role"] == "declined"


@pytest.mark.django_db
def test_a_closed_out_household_is_told_nothing_private(owner, owner_house, borrower_client):
    """Up to nine households per loan are not party to it and must not receive
    the key location or the settlement."""
    car_a, car_b, loan_id = _roles_setup(owner_house, borrower_client)
    _accept(car_b, loan_id)

    outsider = _loan_as(owner, loan_id)
    assert outsider["car_practical_note"] == ""
    assert outsider["amount_due"] is None
    assert outsider["actual_km"] is None
    assert outsider["expense_amount"] is None
    assert outsider["expense_note"] == ""
    assert outsider["damage_note"] == ""

    # The two households actually party to the loan still see it.
    lender = User.objects.get(email="roles_b@example.com")
    assert _loan_as(lender, loan_id)["car_practical_note"] == "Nøglen hos B."


@pytest.mark.django_db
def test_a_declined_household_cannot_see_the_settlement(owner, owner_house, borrower_client):
    car_a, car_b, loan_id = _roles_setup(owner_house, borrower_client)
    _decline(car_a, loan_id)
    _accept(car_b, loan_id)
    borrower_client.post(
        reverse("carsharing-loan-complete", args=[loan_id]),
        {"actual_km": 100, "expense_amount": "50.50", "damage_note": "Ridse"},
        format="json",
    )

    outsider = _loan_as(owner, loan_id)
    assert outsider["amount_due"] is None
    assert outsider["damage_note"] == ""
    assert outsider["car_practical_note"] == ""


@pytest.mark.django_db
def test_can_cancel_agrees_with_the_cancel_endpoint(owner, owner_house, borrower, borrower_client):
    """The anti-drift guard: the flag the button reads and the rule the endpoint
    enforces are the same function, so they cannot disagree."""
    car_a, car_b, loan_id = _roles_setup(owner_house, borrower_client)
    lender = User.objects.get(email="roles_b@example.com")

    def check(person):
        claimed = _loan_as(person, loan_id)["can_cancel"]
        response = _client_for(person).post(reverse("carsharing-loan-cancel", args=[loan_id]))
        allowed = response.status_code == 200
        assert claimed == allowed, (
            f"{person.email}: can_cancel={claimed} but API gave {response.status_code}"
        )
        return allowed

    # While requested: only the borrower may cancel; an asked owner answers instead.
    assert _loan_as(owner, loan_id)["can_cancel"] is False
    assert _loan_as(borrower, loan_id)["can_cancel"] is True
    assert check(owner) is False

    _accept(car_b, loan_id)
    # Once active: the lender may withdraw, the closed-out household may not.
    assert check(owner) is False
    assert _loan_as(lender, loan_id)["can_cancel"] is True
    assert check(lender) is True
    # And nobody may cancel it twice.
    assert check(borrower) is False


@pytest.mark.django_db
def test_a_loan_before_its_window_has_not_started(owner_house, borrower_client):
    """A future loan must not offer the settlement form as if the trip happened."""
    start_at, end_at = _window(days_ahead=4)
    car = _make_car(owner_house)
    _create_loan(borrower_client, [car], start=start_at, end=end_at)
    _accept(car)
    loan_id = CarLoan.objects.get().pk

    assert (
        borrower_client.get(reverse("carsharing-loan-detail", args=[loan_id])).data["has_started"]
        is False
    )


# -- A withdrawn request stops asking anything of anyone -------------------


@pytest.mark.django_db
def test_cancelling_a_request_releases_the_asked_households(owner, owner_house, borrower_client):
    """A cancelled request must not still look answerable.

    Cancelling used to leave candidates ASKED, so the role stayed "asked" and the
    owner was offered accept/decline buttons that could only ever fail.
    """
    car_a, car_b, loan_id = _roles_setup(owner_house, borrower_client)

    borrower_client.post(reverse("carsharing-loan-cancel", args=[loan_id]))

    loan = CarLoan.objects.get(pk=loan_id)
    assert loan.status == CarLoan.Status.CANCELLED
    assert set(loan.candidates.values_list("status", flat=True)) == {CarLoanCandidate.Status.CLOSED}
    assert _loan_as(owner, loan_id)["viewer_role"] == "closed_out"


@pytest.mark.django_db
def test_a_declined_answer_survives_a_cancellation(owner, owner_house, borrower_client):
    """Releasing the undecided must not overwrite a real answer."""
    car_a, car_b, loan_id = _roles_setup(owner_house, borrower_client)
    _decline(car_a, loan_id)

    borrower_client.post(reverse("carsharing-loan-cancel", args=[loan_id]))

    assert CarLoanCandidate.objects.get(car=car_a).status == CarLoanCandidate.Status.DECLINED
    assert CarLoanCandidate.objects.get(car=car_b).status == CarLoanCandidate.Status.CLOSED


@pytest.mark.django_db
def test_a_cancelled_request_cannot_be_answered(owner_house, borrower_client):
    car_a, car_b, loan_id = _roles_setup(owner_house, borrower_client)
    borrower_client.post(reverse("carsharing-loan-cancel", args=[loan_id]))

    response = _accept(car_a, loan_id)

    assert response.status_code == 400
    assert "aflyst" in str(response.data)
    assert CarLoan.objects.get(pk=loan_id).car_id is None


# -- The claim-first ordering that makes the race safe ----------------------


@pytest.mark.django_db
def test_the_loser_of_a_race_is_not_recorded_as_the_lender(owner_house, borrower_client):
    """The invariant behind claiming the loan before marking the candidate.

    If the order were reversed, the household that lost the conditional update
    would still be sitting there as ACCEPTED on a loan it never lent a car to.
    """
    car_a, car_b, loan_id = _roles_setup(owner_house, borrower_client)

    assert _accept(car_b, loan_id).status_code == 200
    assert _accept(car_a, loan_id).status_code == 400

    loan = CarLoan.objects.get(pk=loan_id)
    assert loan.car_id == car_b.id
    assert loan.candidates.get(car=car_b).status == CarLoanCandidate.Status.ACCEPTED
    # The loser is released, never ACCEPTED, and did not become the lender.
    assert loan.candidates.get(car=car_a).status == CarLoanCandidate.Status.CLOSED
    assert loan.candidates.filter(status=CarLoanCandidate.Status.ACCEPTED).count() == 1


# -- Who answered is not everyone's business -------------------------------


@pytest.mark.django_db
def test_the_responder_name_reaches_only_the_borrower_and_their_own_household(
    owner, owner_house, borrower, borrower_client
):
    car_a, car_b, loan_id = _roles_setup(owner_house, borrower_client)
    _decline(car_a, loan_id, as_user=owner)

    def name_seen_by(person):
        data = _loan_as(person, loan_id)
        return next(c["responded_by_name"] for c in data["candidates"] if c["car"] == car_a.id)

    assert name_seen_by(borrower) == owner.first_name
    assert name_seen_by(owner) == owner.first_name
    # A different asked household sees the car and the answer, not the person.
    other = User.objects.get(email="roles_b@example.com")
    assert name_seen_by(other) == ""
    statuses = {c["car"]: c["status"] for c in _loan_as(other, loan_id)["candidates"]}
    assert statuses[car_a.id] == CarLoanCandidate.Status.DECLINED


# -- When everybody says no ------------------------------------------------


@pytest.mark.django_db
def test_the_last_no_closes_the_request(owner_house, borrower, borrower_client):
    """Otherwise the borrower waits forever on a request nobody can answer."""
    car_a, car_b, loan_id = _roles_setup(owner_house, borrower_client)

    first = _decline(car_a, loan_id)
    assert first.data["status"] == CarLoan.Status.REQUESTED

    last = _decline(car_b, loan_id)
    assert last.data["status"] == CarLoan.Status.DECLINED

    loan = CarLoan.objects.get(pk=loan_id)
    assert loan.status == CarLoan.Status.DECLINED
    # The borrower's last notification says there is nobody left to wait for.
    assert Notification.objects.filter(
        user=borrower, message__contains="ikke flere biler at afvente svar fra"
    ).exists()


@pytest.mark.django_db
def test_a_dead_request_stops_blocking_the_car(owner_house, borrower_client):
    """A fully-declined request must not keep marking the car as already asked."""
    start_at, end_at = _window()
    car = _make_car(owner_house)
    _create_loan(borrower_client, [car], start=start_at, end=end_at)
    assert has_open_request(car.id, start_at, end_at) is True

    _decline(car)

    assert has_open_request(car.id, start_at, end_at) is False


@pytest.mark.django_db
def test_a_closed_request_cannot_be_cancelled(owner_house, borrower_client):
    car = _make_car(owner_house)
    _create_loan(borrower_client, [car])
    loan_id = CarLoan.objects.get().pk
    _decline(car)

    response = borrower_client.post(reverse("carsharing-loan-cancel", args=[loan_id]))

    assert response.status_code == 400
    assert CarLoan.objects.get(pk=loan_id).status == CarLoan.Status.DECLINED


@pytest.mark.django_db
def test_a_household_cannot_turn_its_own_no_into_the_deciding_yes(owner_house, borrower_client):
    """Accepting claims the loan first, so this must roll that claim back."""
    car_a, car_b, loan_id = _roles_setup(owner_house, borrower_client)
    _decline(car_a, loan_id)

    late = _accept(car_a, loan_id)

    assert late.status_code == 400
    loan = CarLoan.objects.get(pk=loan_id)
    assert loan.status == CarLoan.Status.REQUESTED
    assert loan.car_id is None
    # Still open for the household that has not answered.
    assert _accept(car_b, loan_id).status_code == 200


# -- Notification preferences actually gate car sharing ---------------------


@pytest.mark.django_db
def test_car_sharing_notifications_respect_the_in_app_preference(
    owner, owner_house, borrower_client
):
    """The preference fields exist; this is the test that they are wired up."""
    from apps.notifications.models import NotificationPreference

    NotificationPreference.objects.update_or_create(
        user=owner, defaults={"notify_car_sharing": False}
    )
    car = _make_car(owner_house)

    _create_loan(borrower_client, [car])

    assert not Notification.objects.filter(
        user=owner, notification_type=NotificationType.CAR_LOAN_REQUEST
    ).exists()


@pytest.mark.django_db
def test_car_sharing_notifications_are_on_by_default(owner, owner_house, borrower_client):
    """The opposite direction, so the test above cannot pass by silently sending
    nothing at all."""
    car = _make_car(owner_house)

    _create_loan(borrower_client, [car])

    assert Notification.objects.filter(
        user=owner, notification_type=NotificationType.CAR_LOAN_REQUEST
    ).exists()


@pytest.mark.django_db
def test_email_for_car_sharing_is_opt_in_and_push_is_opt_out(owner):
    """Matches how the rest of the app is configured; asserted so a later edit to
    the defaults is a deliberate choice rather than an accident."""
    from apps.notifications.models import NotificationPreference

    prefs = NotificationPreference.objects.create(user=owner)

    assert prefs.notify_car_sharing is True
    assert prefs.email_car_sharing is False
    assert prefs.push_car_sharing is True


# -- Money cannot be negative ----------------------------------------------


@pytest.mark.django_db
def test_a_negative_expense_is_refused(owner_house, borrower_client):
    """A negative expense would *raise* the borrower's own bill."""
    car = _make_car(owner_house)
    loan = _activate_loan(borrower_client, car)

    response = borrower_client.post(
        reverse("carsharing-loan-complete", args=[loan.id]),
        {"actual_km": 10, "expense_amount": "-20.00"},
        format="json",
    )

    assert response.status_code == 400
    assert "negativ" in str(response.data)
    loan.refresh_from_db()
    assert loan.status == CarLoan.Status.ACTIVE


@pytest.mark.django_db
def test_a_malformed_expense_is_refused_in_danish(owner_house, borrower_client):
    car = _make_car(owner_house)
    loan = _activate_loan(borrower_client, car)

    response = borrower_client.post(
        reverse("carsharing-loan-complete", args=[loan.id]),
        {"actual_km": 10, "expense_amount": "50 kr"},
        format="json",
    )

    assert response.status_code == 400
    assert "beløb" in str(response.data)
    assert "valid number" not in str(response.data)


@pytest.mark.django_db
def test_a_negative_km_rate_is_refused(authenticated_client, user, house):
    """It reached borrowers as "-3,50 kr./km" and inverted the bill."""
    user.house = house
    user.save()
    car = Car.objects.create(house=house, license_plate="AB12345")

    response = authenticated_client.patch(
        reverse("car-detail", args=[car.id]), {"rate_per_km": "-3.50"}, format="json"
    )

    assert response.status_code == 400
    assert "positivt" in str(response.data)
    car.refresh_from_db()
    assert car.rate_per_km is None


@pytest.mark.django_db
def test_a_malformed_km_rate_is_refused_in_danish(authenticated_client, user, house):
    user.house = house
    user.save()
    car = Car.objects.create(house=house, license_plate="AB12345")

    response = authenticated_client.patch(
        reverse("car-detail", args=[car.id]), {"rate_per_km": "tre"}, format="json"
    )

    assert response.status_code == 400
    assert "km-takst" in str(response.data)
    assert "valid number" not in str(response.data)


@pytest.mark.django_db
def test_car_clean_also_refuses_a_negative_rate(owner_house):
    """Mirrored so the admin cannot do what the API refuses."""
    car = Car(house=owner_house, license_plate="AB12345", rate_per_km=Decimal("-1.00"))
    with pytest.raises(ValidationError) as exc:
        car.clean()
    assert "positivt" in str(exc.value)


@pytest.mark.django_db
def test_the_completed_notification_shows_the_breakdown(owner, owner_house, borrower_client):
    """The owner has to be able to reconcile the amount against the kilometres."""
    car = _make_car(owner_house, rate_per_km=Decimal("4.00"))
    loan = _activate_loan(borrower_client, car)

    borrower_client.post(
        reverse("carsharing-loan-complete", args=[loan.id]),
        {"actual_km": 100, "expense_amount": "50.00", "expense_note": "Ladning"},
        format="json",
    )

    notification = Notification.objects.get(user=owner, title="Billån afsluttet")
    assert "100 km × 4,00 kr." in notification.message
    assert "50,00 kr. i udgifter" in notification.message
    assert "Ladning" in notification.message


@pytest.mark.django_db
def test_the_car_list_publishes_the_window_limit(borrower_client):
    """So the client can warn before sending a window the server will refuse."""
    response = borrower_client.get(reverse("carsharing-car-list"))

    assert response.data["max_loan_days"] == MAX_LOAN_DAYS


# -- Completion and settlement ---------------------------------------------


def _respond(car, action, loan_id=None, as_user=None):
    """The car's household answers a request. A yes is what starts a loan now."""
    candidate = (
        CarLoanCandidate.objects.get(car=car)
        if loan_id is None
        else CarLoanCandidate.objects.get(car=car, loan_id=loan_id)
    )
    owner_user = as_user or User.objects.filter(house=car.house).first()
    if owner_user is None:
        # Some fixtures set up a house with no residents; a car cannot answer
        # for itself, so give it someone who can.
        owner_user = User.objects.create_user(
            email=f"owner-h{car.house_id}-c{car.id}@example.com",
            password="x",
            first_name="Ejer",
            house=car.house,
        )
    return _client_for(owner_user).post(
        reverse("carsharing-candidate-respond", args=[candidate.loan_id, candidate.id]),
        {"action": action},
        format="json",
    )


def _accept(car, loan_id=None, as_user=None):
    return _respond(car, "accept", loan_id=loan_id, as_user=as_user)


def _decline(car, loan_id=None, as_user=None):
    return _respond(car, "decline", loan_id=loan_id, as_user=as_user)


def _activate_loan(client, car):
    _create_loan(client, [car])
    candidate = CarLoanCandidate.objects.get(car=car)
    _accept(car)
    return CarLoan.objects.get(pk=candidate.loan_id)


@pytest.mark.django_db
def test_complete_calculates_amount_due(owner_house, borrower_client):
    car = _make_car(owner_house, rate_per_km=Decimal("4.00"))
    loan = _activate_loan(borrower_client, car)

    response = borrower_client.post(
        reverse("carsharing-loan-complete", args=[loan.id]),
        {"actual_km": 100, "expense_amount": "50.00", "expense_note": "Lynlader"},
        format="json",
    )
    assert response.status_code == 200
    assert response.data["status"] == CarLoan.Status.COMPLETED
    assert Decimal(response.data["amount_due"]) == Decimal("350.00")


@pytest.mark.django_db
def test_complete_allows_negative_amount(owner_house, borrower_client, owner):
    car = _make_car(owner_house, rate_per_km=Decimal("2.00"))
    loan = _activate_loan(borrower_client, car)

    response = borrower_client.post(
        reverse("carsharing-loan-complete", args=[loan.id]),
        {"actual_km": 10, "expense_amount": "200.00"},
        format="json",
    )
    assert response.status_code == 200
    assert Decimal(response.data["amount_due"]) == Decimal("-180.00")

    notification = Notification.objects.filter(
        user=owner, notification_type=NotificationType.CAR_LOAN_UPDATE, title="Billån afsluttet"
    ).first()
    assert notification is not None
    assert "Du skylder" in notification.message


@pytest.mark.django_db
def test_only_borrower_can_complete(owner_house, borrower_client, owner_client):
    car = _make_car(owner_house)
    loan = _activate_loan(borrower_client, car)
    response = owner_client.post(
        reverse("carsharing-loan-complete", args=[loan.id]), {"actual_km": 5}, format="json"
    )
    assert response.status_code == 404


@pytest.mark.django_db
def test_complete_twice_is_rejected(owner_house, borrower_client):
    car = _make_car(owner_house)
    loan = _activate_loan(borrower_client, car)
    url = reverse("carsharing-loan-complete", args=[loan.id])
    assert borrower_client.post(url, {"actual_km": 10}, format="json").status_code == 200
    assert borrower_client.post(url, {"actual_km": 10}, format="json").status_code == 400


@pytest.mark.django_db
def test_completed_loan_frees_the_car(owner_house, borrower_client):
    car = _make_car(owner_house)
    loan = _activate_loan(borrower_client, car)
    borrower_client.post(
        reverse("carsharing-loan-complete", args=[loan.id]), {"actual_km": 10}, format="json"
    )
    loan.refresh_from_db()
    result = shared_cars_with_availability(loan.start_at, loan.end_at)
    assert result[0].conflict is None


# -- Cancellation ----------------------------------------------------------


@pytest.mark.django_db
def test_borrower_can_cancel_request(owner_house, borrower_client, owner):
    car = _make_car(owner_house)
    _create_loan(borrower_client, [car])
    loan = CarLoan.objects.get(car__isnull=True)

    response = borrower_client.post(reverse("carsharing-loan-cancel", args=[loan.id]))
    assert response.status_code == 200
    assert response.data["status"] == CarLoan.Status.CANCELLED
    assert Notification.objects.filter(user=owner, title="Bilforespørgsel aflyst").exists()


@pytest.mark.django_db
def test_owner_can_cancel_active_loan(owner_house, borrower_client, owner_client, borrower):
    car = _make_car(owner_house)
    loan = _activate_loan(borrower_client, car)

    response = owner_client.post(reverse("carsharing-loan-cancel", args=[loan.id]))
    assert response.status_code == 200
    assert Notification.objects.filter(user=borrower, title="Dit billån er aflyst").exists()


@pytest.mark.django_db
def test_stranger_cannot_cancel(owner_house, borrower_client, api_client, second_user):
    car = _make_car(owner_house)
    loan = _activate_loan(borrower_client, car)
    api_client.force_authenticate(user=second_user)
    response = api_client.post(reverse("carsharing-loan-cancel", args=[loan.id]))
    assert response.status_code == 403


# -- Permissions and visibility -------------------------------------------


@pytest.mark.django_db
def test_cannot_respond_for_car_outside_own_household(
    owner_house, borrower_client, api_client, second_user, house2
):
    car = _make_car(owner_house)
    _create_loan(borrower_client, [car])
    candidate = CarLoanCandidate.objects.get(car=car)

    second_user.house = house2
    second_user.save()
    api_client.force_authenticate(user=second_user)
    response = api_client.post(
        reverse("carsharing-candidate-respond", args=[candidate.loan_id, candidate.id]),
        {"action": "accept"},
        format="json",
    )
    assert response.status_code == 404


@pytest.mark.django_db
def test_cannot_see_other_peoples_loans(
    owner_house, borrower_client, api_client, second_user, house2
):
    car = _make_car(owner_house)
    _create_loan(borrower_client, [car])
    loan = CarLoan.objects.first()

    second_user.house = house2
    second_user.save()
    api_client.force_authenticate(user=second_user)
    assert api_client.get(reverse("carsharing-loan-detail", args=[loan.id])).status_code == 404
    assert api_client.get(reverse("carsharing-loan-list")).data == []


@pytest.mark.django_db
def test_asked_household_sees_the_loan(owner_house, borrower_client, owner_client):
    car = _make_car(owner_house)
    _create_loan(borrower_client, [car])
    loan = CarLoan.objects.first()
    assert owner_client.get(reverse("carsharing-loan-detail", args=[loan.id])).status_code == 200


# -- Blocks and terms endpoints -------------------------------------------


@pytest.mark.django_db
def test_owner_manages_own_blocks_only(owner_house, owner_client, house, borrower_client):
    car = _make_car(owner_house)
    payload = {
        "days_of_week": [0, 2],
        "start_time": "07:00",
        "end_time": "16:00",
    }

    created = owner_client.post(
        reverse("carsharing-block-list", args=[car.id]), payload, format="json"
    )
    assert created.status_code == 201
    assert created.data["days_of_week_display"] == "Mandag, Onsdag"

    # Someone from another house cannot add a block to this car.
    assert (
        borrower_client.post(
            reverse("carsharing-block-list", args=[car.id]), payload, format="json"
        ).status_code
        == 404
    )


@pytest.mark.django_db
def test_block_rejects_reversed_times(owner_house, owner_client):
    car = _make_car(owner_house)
    response = owner_client.post(
        reverse("carsharing-block-list", args=[car.id]),
        {"days_of_week": [1], "start_time": "16:00", "end_time": "07:00"},
        format="json",
    )
    assert response.status_code == 400


@pytest.mark.django_db
def test_terms_endpoint_serves_version_and_rate(authenticated_client):
    response = authenticated_client.get(reverse("carsharing-terms"))
    assert response.status_code == 200
    assert response.data["version"] == TERMS_VERSION
    assert response.data["default_rate_per_km"] == str(DEFAULT_RATE_PER_KM)
    assert "kr. pr. kørt km" in response.data["text"]


@pytest.mark.django_db
def test_terms_are_split_by_the_server_not_the_client(authenticated_client):
    """The client renders no Markdown, so asterisks would show literally."""
    response = authenticated_client.get(reverse("carsharing-terms"))
    assert response.data["title"] == "Vilkår for lån af bil i delebilparken"
    sections = response.data["sections"]
    assert len(sections) >= 10

    for section in sections:
        assert "#" not in section["heading"]
        assert "**" not in section["heading"]
        for block in section["blocks"]:
            assert block["kind"] in ("paragraph", "bullets")
            if block["kind"] == "bullets":
                for item in block["items"]:
                    assert "**" not in item["lead"]
                    assert "**" not in item["text"]
                    assert not item["text"].startswith("- ")
            else:
                assert "**" not in block["text"]

    assert "3,94 kr. pr. kørt kilometer" in response.data["text"]


# -- Replacing the whole schedule (the painting grid) ----------------------


@pytest.mark.django_db
def test_replace_schedule_swaps_the_whole_week(owner_house, owner_client):
    car = _make_car(owner_house)
    CarBlock.objects.create(car=car, days_of_week=[6], start_time="09:00", end_time="10:00")

    response = owner_client.put(
        reverse("carsharing-block-list", args=[car.id]),
        {
            "blocks": [
                {
                    "days_of_week": [0, 1, 2, 3, 4],
                    "start_time": "07:00",
                    "end_time": "16:00",
                },
                {
                    "days_of_week": [5],
                    "start_time": "22:00",
                    "end_time": "23:59",
                },
            ]
        },
        format="json",
    )

    assert response.status_code == 200
    assert len(response.data) == 2
    blocks = list(car.blocks.order_by("start_time"))
    assert [block.days_of_week for block in blocks] == [[0, 1, 2, 3, 4], [5]]
    # The previous Sunday window is gone rather than merged in.
    assert not car.blocks.filter(days_of_week=[6]).exists()


@pytest.mark.django_db
def test_replace_schedule_with_empty_list_clears_it(owner_house, owner_client):
    car = _make_car(owner_house)
    CarBlock.objects.create(car=car, days_of_week=[0], start_time="07:00", end_time="08:00")

    response = owner_client.put(
        reverse("carsharing-block-list", args=[car.id]), {"blocks": []}, format="json"
    )

    assert response.status_code == 200
    assert car.blocks.count() == 0


@pytest.mark.django_db
def test_replace_schedule_accepts_the_last_hour_of_the_day(owner_house, owner_client):
    """A run reaching hour 23 ends at 23:59, since 24:00 is not a valid time."""
    car = _make_car(owner_house)

    response = owner_client.put(
        reverse("carsharing-block-list", args=[car.id]),
        {"blocks": [{"days_of_week": [3], "start_time": "23:00", "end_time": "23:59"}]},
        format="json",
    )

    assert response.status_code == 200
    block = car.blocks.get()
    assert str(block.start_time) == "23:00:00"
    assert str(block.end_time) == "23:59:00"


@pytest.mark.django_db
def test_replace_schedule_rejects_reversed_times(owner_house, owner_client):
    car = _make_car(owner_house)
    CarBlock.objects.create(car=car, days_of_week=[0], start_time="07:00", end_time="08:00")

    response = owner_client.put(
        reverse("carsharing-block-list", args=[car.id]),
        {"blocks": [{"days_of_week": [0], "start_time": "16:00", "end_time": "07:00"}]},
        format="json",
    )

    assert response.status_code == 400
    # The existing schedule survives a rejected replace.
    assert car.blocks.count() == 1


@pytest.mark.django_db
def test_replace_schedule_rejects_too_many_blocks(owner_house, owner_client):
    car = _make_car(owner_house)
    blocks = [
        {"days_of_week": [index % 7], "start_time": "07:00", "end_time": "08:00"}
        for index in range(MAX_BLOCKS_PER_CAR + 1)
    ]

    response = owner_client.put(
        reverse("carsharing-block-list", args=[car.id]), {"blocks": blocks}, format="json"
    )

    assert response.status_code == 400
    assert "højst" in str(response.data)


@pytest.mark.django_db
def test_cannot_replace_schedule_for_another_household(owner_house, borrower_client):
    car = _make_car(owner_house)

    response = borrower_client.put(
        reverse("carsharing-block-list", args=[car.id]),
        {"blocks": [{"days_of_week": [0], "start_time": "07:00", "end_time": "08:00"}]},
        format="json",
    )

    assert response.status_code == 404
    assert car.blocks.count() == 0


@pytest.mark.django_db
def test_painted_schedule_shows_up_as_a_soft_conflict(owner_house, owner_client, borrower_client):
    """End to end: paint a week, and the list marks the car "normalt optaget"."""
    car = _make_car(owner_house)
    start_at, end_at = _window(start_hour=9, hours=2)
    weekday = timezone.localtime(start_at).weekday()

    owner_client.put(
        reverse("carsharing-block-list", args=[car.id]),
        {
            "blocks": [
                {
                    "days_of_week": [weekday],
                    "start_time": "08:00",
                    "end_time": "16:00",
                }
            ]
        },
        format="json",
    )

    response = borrower_client.get(
        reverse("carsharing-car-list"),
        {"start": start_at.isoformat(), "end": end_at.isoformat()},
    )
    car_data = response.data["cars"][0]
    assert car_data["conflict"] == "schedule"
    assert car_data["selectable"] is True
    assert car_data["conflict_note"] == "Normalt optaget"


@pytest.mark.django_db
def test_shared_car_list_returns_availability(owner_house, borrower_client):
    start_at, end_at = _window()
    _make_car(owner_house)
    response = borrower_client.get(
        reverse("carsharing-car-list"),
        {"start": start_at.isoformat(), "end": end_at.isoformat()},
    )
    assert response.status_code == 200
    assert response.data["cars"][0]["display_name"] == "Skoda Octavia"
    assert response.data["cars"][0]["conflict"] is None
    assert response.data["max_candidates"] == MAX_CANDIDATES_PER_LOAN


@pytest.mark.django_db
def test_candidate_marks_which_cars_you_may_answer_for(owner, owner_house, borrower_client):
    """An asked household sees the whole loan, but may only answer for its own car."""
    other_house = House.objects.create(name="House 12")
    User.objects.create_user(
        email="other12@example.com", password="x", first_name="Ove", house=other_house
    )
    mine = _make_car(owner_house, plate="MM11111")
    theirs = _make_car(other_house, plate="TT22222")
    _create_loan(borrower_client, [mine, theirs])

    response = _client_for(owner).get(
        reverse("carsharing-loan-detail", args=[CarLoan.objects.first().id])
    )

    by_car = {c["car"]: c["is_own_household"] for c in response.data["candidates"]}
    assert by_car[mine.id] is True
    assert by_car[theirs.id] is False


# -- Telling the borrower, and live updates ---------------------------------


@pytest.mark.django_db
def test_accepting_notifies_the_borrower(owner_house, owner, borrower, borrower_client):
    """The borrower is the one waiting for an answer, so a yes has to reach them."""
    car = _make_car(owner_house)
    _create_loan(borrower_client, [car])
    candidate = CarLoanCandidate.objects.get(car=car)

    _client_for(owner).post(
        reverse("carsharing-candidate-respond", args=[candidate.loan_id, candidate.id]),
        {"action": "accept"},
        format="json",
    )

    notification = Notification.objects.get(user=borrower, title="Du har fået en bil")
    assert car.display_name in notification.message
    assert notification.link == f"/bildeling/laan/{candidate.loan_id}"
    assert notification.notification_type == NotificationType.CAR_LOAN_UPDATE


@pytest.mark.django_db
def test_declining_notifies_the_borrower(owner_house, owner, borrower, borrower_client):
    car = _make_car(owner_house)
    _create_loan(borrower_client, [car])
    candidate = CarLoanCandidate.objects.get(car=car)

    _client_for(owner).post(
        reverse("carsharing-candidate-respond", args=[candidate.loan_id, candidate.id]),
        {"action": "decline"},
        format="json",
    )

    notification = Notification.objects.get(user=borrower, title="En bil kan ikke lånes")
    assert "ikke flere biler at afvente" in notification.message


@pytest.mark.django_db
def test_accept_message_names_the_car_the_borrower_got(
    owner_house, owner, borrower, borrower_client
):
    """No choice is left, so the message states the outcome rather than options."""
    other = House.objects.create(name="House 14")
    User.objects.create_user(email="h14@example.com", password="x", first_name="Hans", house=other)
    mine = _make_car(owner_house, plate="AA55555")
    _make_car(other, plate="BB66666")
    _create_loan(borrower_client, [mine, Car.objects.get(license_plate="BB66666")])

    candidate = CarLoanCandidate.objects.get(car=mine)
    _client_for(owner).post(
        reverse("carsharing-candidate-respond", args=[candidate.loan_id, candidate.id]),
        {"action": "accept"},
        format="json",
    )

    notification = Notification.objects.get(user=borrower, title="Du har fået en bil")
    assert mine.display_name in notification.message
    assert "vælg" not in notification.message.lower()


@pytest.mark.django_db
def test_loan_audience_is_borrower_plus_asked_households(
    owner_house, owner, borrower, borrower_client
):
    """Who a live update goes to: everyone who can see the loan."""
    from apps.carsharing.realtime import loan_audience

    car = _make_car(owner_house)
    _create_loan(borrower_client, [car])
    loan = CarLoan.objects.first()

    audience = loan_audience(loan)
    assert borrower.id in audience
    assert owner.id in audience
    # Someone unrelated is not told.
    outsider = User.objects.create_user(email="out@example.com", password="x", first_name="Ude")
    assert outsider.id not in audience


@pytest.mark.django_db
def test_responding_pushes_a_live_update(
    owner_house, owner, borrower, borrower_client, monkeypatch
):
    car = _make_car(owner_house)
    _create_loan(borrower_client, [car])
    candidate = CarLoanCandidate.objects.get(car=car)

    pushed: list[set[int]] = []
    monkeypatch.setattr(
        "apps.carsharing.views.broadcast_car_sharing_update",
        lambda user_ids: pushed.append(set(user_ids)),
    )

    _client_for(owner).post(
        reverse("carsharing-candidate-respond", args=[candidate.loan_id, candidate.id]),
        {"action": "decline"},
        format="json",
    )

    # A decline produces no notification for the owner's household, so without
    # this push the borrower's open page would keep showing "afventer".
    assert pushed and {borrower.id, owner.id} <= pushed[0]
