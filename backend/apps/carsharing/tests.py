"""
Tests for the car sharing (bildeling) app.
"""

import datetime
from decimal import Decimal

import pytest
from django.core.exceptions import ValidationError
from django.urls import reverse
from django.utils import timezone

from apps.carsharing.constants import (
    DEFAULT_RATE_PER_KM,
    MAX_BLOCKS_PER_CAR,
    MAX_CANDIDATES_PER_LOAN,
    TERMS_VERSION,
)
from apps.carsharing.models import CarBlock, CarLoan, CarLoanCandidate
from apps.carsharing.services import pool_cars_with_availability
from apps.houses.models import Car, House
from apps.notifications.models import Notification, NotificationType
from apps.users.models import User


def _make_car(house, plate="AB12345", **overrides):
    defaults = {"in_pool": True, "make": "Skoda", "model_name": "Octavia", "seats": 5}
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
        **extra,
    }
    return client.post(reverse("carsharing-loan-list"), payload, format="json")


# -- Car pool flag and rate --------------------------------------------------


@pytest.mark.django_db
def test_pool_car_requires_license_plate(owner_house):
    car = Car(house=owner_house, license_plate="", in_pool=True)
    with pytest.raises(ValidationError) as exc:
        car.clean()
    assert "nummerplade" in str(exc.value)


@pytest.mark.django_db
def test_pool_car_with_plate_is_valid(owner_house):
    Car(house=owner_house, license_plate="AB12345", in_pool=True).clean()


@pytest.mark.django_db
def test_api_rejects_pooling_car_without_plate(authenticated_client, user, house):
    user.house = house
    user.save()
    car = Car.objects.create(house=house, license_plate="")
    response = authenticated_client.patch(
        reverse("car-detail", args=[car.id]), {"in_pool": True}, format="json"
    )
    assert response.status_code == 400
    assert "nummerplade" in str(response.data)


@pytest.mark.django_db
def test_rate_falls_back_to_default(owner_house, borrower, borrower_client):
    car = _make_car(owner_house, rate_per_km=None)
    _create_loan(borrower_client, [car])
    candidate = CarLoanCandidate.objects.get(car=car)
    loan = candidate.loan

    candidate.status = CarLoanCandidate.Status.ACCEPTED
    candidate.save()
    borrower_client.post(
        reverse("carsharing-loan-choose", args=[loan.id]),
        {"candidate": candidate.id},
        format="json",
    )

    loan.refresh_from_db()
    assert loan.rate_per_km == DEFAULT_RATE_PER_KM


@pytest.mark.django_db
def test_rate_snapshot_survives_later_rate_change(owner_house, borrower, borrower_client):
    car = _make_car(owner_house, rate_per_km=Decimal("5.00"))
    _create_loan(borrower_client, [car])
    candidate = CarLoanCandidate.objects.get(car=car)
    candidate.status = CarLoanCandidate.Status.ACCEPTED
    candidate.save()
    borrower_client.post(
        reverse("carsharing-loan-choose", args=[candidate.loan_id]),
        {"candidate": candidate.id},
        format="json",
    )

    car.rate_per_km = Decimal("9.99")
    car.save()

    loan = CarLoan.objects.get(pk=candidate.loan_id)
    assert loan.rate_per_km == Decimal("5.00")
    loan.actual_km = 10
    assert loan.calculate_amount_due() == Decimal("50.00")


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

    result = pool_cars_with_availability(start_at, end_at)
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

    result = pool_cars_with_availability(start_at, end_at)
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

    result = pool_cars_with_availability(start_at, end_at)
    assert result[0].conflict is None


@pytest.mark.django_db
def test_open_request_is_information_only(owner_house, borrower, borrower_client):
    start_at, end_at = _window()
    car = _make_car(owner_house)
    _create_loan(borrower_client, [car], start=start_at, end=end_at)

    result = pool_cars_with_availability(start_at, end_at)
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

    result = pool_cars_with_availability(start_at, end_at)
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

    result = pool_cars_with_availability(start_at, end_at)
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

    result = pool_cars_with_availability(first_end, second_end)
    assert result[0].conflict is None


@pytest.mark.django_db
def test_requirements_mark_but_do_not_filter(owner_house):
    start_at, end_at = _window()
    _make_car(owner_house, has_isofix=False)
    result = pool_cars_with_availability(start_at, end_at, needs_isofix=True)
    assert len(result) == 1
    assert result[0].meets_requirements is False


@pytest.mark.django_db
def test_own_household_cars_are_excluded(house, owner_house):
    start_at, end_at = _window()
    _make_car(house, plate="GH33333")
    _make_car(owner_house, plate="IJ44444")
    result = pool_cars_with_availability(start_at, end_at, exclude_house_id=house.id)
    assert [item.car.license_plate for item in result] == ["IJ44444"]


# -- Request → offer → choice ----------------------------------------------


@pytest.mark.django_db
def test_full_flow_three_cars_two_accept_borrower_chooses(owner_house, borrower, borrower_client):
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

    # Owners of B and C accept; A never answers.
    for owner_user, car in ((owner_b, car_b), (owner_c, car_c)):
        api_client = _client_for(owner_user)
        candidate = CarLoanCandidate.objects.get(loan_id=loan_id, car=car)
        accept = api_client.post(
            reverse("carsharing-candidate-respond", args=[loan_id, candidate.id]),
            {"action": "accept"},
            format="json",
        )
        assert accept.status_code == 200

    chosen = CarLoanCandidate.objects.get(loan_id=loan_id, car=car_b)
    response = borrower_client.post(
        reverse("carsharing-loan-choose", args=[loan_id]), {"candidate": chosen.id}, format="json"
    )
    assert response.status_code == 200
    assert response.data["status"] == CarLoan.Status.ACTIVE
    assert response.data["car"] == car_b.id

    loan = CarLoan.objects.get(pk=loan_id)
    assert loan.approved_by_id == owner_b.id
    assert loan.candidates.get(car=car_c).status == CarLoanCandidate.Status.CLOSED
    assert loan.candidates.get(car=car_a).status == CarLoanCandidate.Status.ASKED

    # The released owner is told, the chosen one too.
    assert Notification.objects.filter(
        user=owner_c, notification_type=NotificationType.CAR_LOAN_UPDATE
    ).exists()
    assert Notification.objects.filter(
        user=owner_b, notification_type=NotificationType.CAR_LOAN_UPDATE
    ).exists()


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
        assert notification.link.startswith("/bildeling/laan/")


@pytest.mark.django_db
def test_choose_twice_is_rejected(owner_house, borrower_client):
    car = _make_car(owner_house)
    _create_loan(borrower_client, [car])
    candidate = CarLoanCandidate.objects.get(car=car)
    candidate.status = CarLoanCandidate.Status.ACCEPTED
    candidate.save()
    url = reverse("carsharing-loan-choose", args=[candidate.loan_id])

    first = borrower_client.post(url, {"candidate": candidate.id}, format="json")
    second = borrower_client.post(url, {"candidate": candidate.id}, format="json")

    assert first.status_code == 200
    assert second.status_code == 400
    assert CarLoan.objects.filter(car=car, status=CarLoan.Status.ACTIVE).count() == 1


@pytest.mark.django_db
def test_double_booking_of_same_car_is_rejected(owner_house, house, house2, api_client):
    """Two borrowers, one car, one window, both offered — only one may win."""
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

    # The owner sees two offers and accepts both — entirely reasonable.
    for loan_id in loans:
        candidate = CarLoanCandidate.objects.get(loan_id=loan_id, car=car)
        candidate.status = CarLoanCandidate.Status.ACCEPTED
        candidate.save()

    api_client.force_authenticate(user=borrower_one)
    first = api_client.post(
        reverse("carsharing-loan-choose", args=[loans[0]]),
        {"candidate": CarLoanCandidate.objects.get(loan_id=loans[0], car=car).id},
        format="json",
    )
    api_client.force_authenticate(user=borrower_two)
    second = api_client.post(
        reverse("carsharing-loan-choose", args=[loans[1]]),
        {"candidate": CarLoanCandidate.objects.get(loan_id=loans[1], car=car).id},
        format="json",
    )

    assert first.status_code == 200
    assert second.status_code == 400
    assert "udlånt" in str(second.data).lower()
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
def test_cannot_request_car_outside_pool(owner_house, borrower_client):
    car = _make_car(owner_house, in_pool=False)
    response = _create_loan(borrower_client, [car])
    assert response.status_code == 400


# -- Completion and settlement ---------------------------------------------


def _activate_loan(client, car):
    _create_loan(client, [car])
    candidate = CarLoanCandidate.objects.get(car=car)
    candidate.status = CarLoanCandidate.Status.ACCEPTED
    candidate.save()
    client.post(
        reverse("carsharing-loan-choose", args=[candidate.loan_id]),
        {"candidate": candidate.id},
        format="json",
    )
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
    result = pool_cars_with_availability(loan.start_at, loan.end_at)
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
def test_terms_are_plain_sentences_not_markdown(authenticated_client):
    """Nothing in the app renders Markdown, so asterisks would show literally."""
    response = authenticated_client.get(reverse("carsharing-terms"))
    assert response.data["title"] == "Vilkår for lån af bil i bilpølen"
    assert len(response.data["bullets"]) >= 5
    for bullet in response.data["bullets"]:
        assert "**" not in bullet
        assert not bullet.startswith("- ")
    assert "3,94 kr. pr. kørt km" in response.data["bullets"][-1]


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
    """End to end: paint a week, and the pool marks the car "normalt optaget"."""
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
def test_pool_car_list_returns_availability(owner_house, borrower_client):
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

    notification = Notification.objects.get(user=borrower, title="Du kan låne en bil")
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
def test_accept_message_mentions_how_many_cars_were_asked(
    owner_house, owner, borrower, borrower_client
):
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

    notification = Notification.objects.get(user=borrower, title="Du kan låne en bil")
    assert "spurgt 2 biler" in notification.message


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
