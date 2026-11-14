"""
The morning upkeep: requests that ran out, borrowers who forgot to finish, and
loans the app stops waiting for (apps/carsharing/tasks.py).

The services take `now`, so every boundary here is tested against a fixed
morning rather than whatever the clock says when the suite runs.
"""

import datetime

import pytest
from django.urls import reverse
from django.utils import timezone

from apps.carsharing.constants import TERMS_VERSION, UNFINISHED_LOAN_CLOSE_DAYS
from apps.carsharing.models import CarLoan, CarLoanCandidate
from apps.carsharing.roles import LoanRole, can_cancel, loan_role
from apps.carsharing.services import (
    close_unfinished_loans,
    expire_unanswered_requests,
    remind_unfinished_loans,
)
from apps.houses.models import Car, House
from apps.notifications.models import Notification, NotificationType
from apps.notifications.services import notify_car_loan_requested
from apps.users.models import User


def _local(day: datetime.date, hour: int, minute: int = 0) -> datetime.datetime:
    return timezone.make_aware(
        datetime.datetime.combine(day, datetime.time(hour, minute)),
        timezone.get_current_timezone(),
    )


# A Wednesday morning at ten, when the task runs.
TODAY = datetime.date(2027, 3, 10)
NOW = _local(TODAY, 10)


@pytest.fixture
def owner_house(db):
    return House.objects.create(name="Kløverbakkevej 7", address="Kløverbakkevej 7")


@pytest.fixture
def owner(owner_house):
    return User.objects.create_user(
        email="owner@example.com", password="x", first_name="Ove", house=owner_house
    )


@pytest.fixture
def housemate(owner_house):
    return User.objects.create_user(
        email="housemate@example.com", password="x", first_name="Hanne", house=owner_house
    )


@pytest.fixture
def borrower(house):
    return User.objects.create_user(
        email="borrower@example.com", password="x", first_name="Bo", house=house
    )


@pytest.fixture
def car(owner_house):
    return Car.objects.create(
        house=owner_house,
        license_plate="EA78950",
        is_shared=True,
        make="Tesla",
        model_name="3",
        terms_accepted_version=TERMS_VERSION,
        terms_accepted_at=timezone.now(),
    )


def _request(borrower, car, start, end):
    loan = CarLoan.objects.create(
        borrower=borrower,
        start_at=start,
        end_at=end,
        expected_km=40,
        terms_version=TERMS_VERSION,
    )
    CarLoanCandidate.objects.create(loan=loan, car=car)
    return loan


def _loan(borrower, car, owner, start, end):
    loan = CarLoan.objects.create(
        borrower=borrower,
        status=CarLoan.Status.ACTIVE,
        start_at=start,
        end_at=end,
        expected_km=40,
        terms_version=TERMS_VERSION,
        car=car,
        approved_by=owner,
        activated_at=start - datetime.timedelta(days=1),
    )
    CarLoanCandidate.objects.create(
        loan=loan, car=car, status=CarLoanCandidate.Status.ACCEPTED, responded_by=owner
    )
    return loan


def _notes(user, title):
    return Notification.objects.filter(
        user=user, notification_type=NotificationType.CAR_LOAN_UPDATE, title=title
    )


# -- Requests nobody answered ---------------------------------------------------


@pytest.mark.django_db
def test_a_request_whose_window_has_passed_expires_quietly(borrower, owner, car):
    yesterday = TODAY - datetime.timedelta(days=1)
    loan = _request(borrower, car, _local(yesterday, 13), _local(yesterday, 17))
    notify_car_loan_requested(loan)

    assert expire_unanswered_requests(NOW) == [loan]

    loan.refresh_from_db()
    assert loan.status == CarLoan.Status.EXPIRED
    # The household is released, as a cancellation releases it...
    assert loan.candidates.get().status == CarLoanCandidate.Status.CLOSED
    assert loan_role(loan, owner) == LoanRole.CLOSED_OUT
    assert not can_cancel(loan, borrower)
    # ...and the borrower is not told what they already know.
    assert not Notification.objects.filter(user=borrower).exists()


@pytest.mark.django_db
def test_a_request_is_open_until_its_window_ends(borrower, car):
    """A request for "now" has already started when the owner reads it, and a
    yes is still worth having while the window lasts."""
    loan = _request(borrower, car, _local(TODAY, 9), _local(TODAY, 12))

    assert expire_unanswered_requests(NOW) == []
    loan.refresh_from_db()
    assert loan.status == CarLoan.Status.REQUESTED


@pytest.mark.django_db
def test_an_owner_cannot_say_yes_once_the_window_is_over(borrower, owner, car):
    """Until the morning task has closed it, a stale request still shows its
    buttons to a household that never opened the app — a yes must not start a
    loan that is already over."""
    start = timezone.now() - datetime.timedelta(hours=5)
    loan = _request(borrower, car, start, start + datetime.timedelta(hours=2))
    candidate = loan.candidates.get()

    client = _client_for(owner)
    response = client.post(
        reverse("carsharing-candidate-respond", args=[loan.id, candidate.id]),
        {"action": "accept"},
        format="json",
    )

    assert response.status_code == 400
    assert "Tidsrummet er forbi" in str(response.data)
    loan.refresh_from_db()
    assert loan.status == CarLoan.Status.REQUESTED
    assert loan.car_id is None
    candidate.refresh_from_db()
    assert candidate.status == CarLoanCandidate.Status.ASKED


# -- Loans nobody finished --------------------------------------------------------


@pytest.mark.django_db
def test_the_borrower_is_reminded_the_morning_after_once(borrower, owner, car):
    yesterday = TODAY - datetime.timedelta(days=1)
    loan = _loan(borrower, car, owner, _local(yesterday, 13), _local(yesterday, 17))

    assert remind_unfinished_loans(NOW) == [loan]
    assert remind_unfinished_loans(NOW + datetime.timedelta(days=1)) == []

    loan.refresh_from_db()
    assert loan.status == CarLoan.Status.ACTIVE
    assert loan.completion_reminded_at == NOW


@pytest.mark.django_db
def test_no_reminder_on_the_day_the_trip_ends(borrower, owner, car):
    """Ended at nine this morning: they may still be parking the car."""
    _loan(borrower, car, owner, _local(TODAY, 6), _local(TODAY, 9))

    assert remind_unfinished_loans(NOW) == []


@pytest.mark.django_db
def test_an_unfinished_loan_is_closed_two_weeks_after_it_ended(borrower, owner, car):
    ended = TODAY - datetime.timedelta(days=UNFINISHED_LOAN_CLOSE_DAYS)
    loan = _loan(borrower, car, owner, _local(ended, 13), _local(ended, 17))

    assert close_unfinished_loans(NOW) == [loan]

    loan.refresh_from_db()
    assert loan.status == CarLoan.Status.EXPIRED
    # Nothing is settled: there are no kilometres to settle from.
    assert loan.amount_due is None
    assert loan.completed_at is None


@pytest.mark.django_db
def test_a_loan_is_left_open_the_day_before_it_would_close(borrower, owner, car):
    ended = TODAY - datetime.timedelta(days=UNFINISHED_LOAN_CLOSE_DAYS - 1)
    loan = _loan(borrower, car, owner, _local(ended, 13), _local(ended, 23, 30))

    assert close_unfinished_loans(NOW) == []
    loan.refresh_from_db()
    assert loan.status == CarLoan.Status.ACTIVE


@pytest.mark.django_db
def test_settled_and_cancelled_loans_are_never_touched(borrower, owner, car):
    long_ago = TODAY - datetime.timedelta(days=60)
    completed = _loan(borrower, car, owner, _local(long_ago, 9), _local(long_ago, 12))
    CarLoan.objects.filter(pk=completed.pk).update(status=CarLoan.Status.COMPLETED)
    cancelled = _request(borrower, car, _local(long_ago, 13), _local(long_ago, 15))
    CarLoan.objects.filter(pk=cancelled.pk).update(status=CarLoan.Status.CANCELLED)

    assert close_unfinished_loans(NOW) == []
    assert remind_unfinished_loans(NOW) == []
    assert expire_unanswered_requests(NOW) == []


@pytest.mark.django_db
def test_a_closed_loan_can_no_longer_be_finished_or_cancelled(borrower, owner, car):
    ended = TODAY - datetime.timedelta(days=30)
    loan = _loan(borrower, car, owner, _local(ended, 9), _local(ended, 12))
    close_unfinished_loans(NOW)
    loan.refresh_from_db()

    response = _client_for(borrower).post(
        reverse("carsharing-loan-complete", args=[loan.id]),
        {"actual_km": 50, "expense_amount": "0"},
        format="json",
    )
    assert response.status_code == 400
    assert not can_cancel(loan, borrower)
    assert not can_cancel(loan, owner)
    assert loan_role(loan, owner) == LoanRole.LENDER


# -- The task, end to end ----------------------------------------------------------


@pytest.mark.django_db
def test_the_morning_task_closes_reminds_and_expires(borrower, owner, housemate, car):
    """One run, all three cases, each told to the people it concerns."""
    from apps.carsharing.tasks import tidy_car_loans

    now = timezone.now()
    forgotten = _loan(
        borrower,
        car,
        owner,
        now - datetime.timedelta(days=UNFINISHED_LOAN_CLOSE_DAYS + 6, hours=4),
        now - datetime.timedelta(days=UNFINISHED_LOAN_CLOSE_DAYS + 6),
    )
    # A second car, so the recent loan does not overlap anything.
    other = Car.objects.create(
        house=car.house,
        license_plate="CD12345",
        is_shared=True,
        terms_accepted_version=TERMS_VERSION,
    )
    recent = _loan(
        borrower,
        other,
        owner,
        now - datetime.timedelta(days=3, hours=4),
        now - datetime.timedelta(days=3),
    )
    stale = _request(
        borrower, car, now - datetime.timedelta(days=2, hours=3), now - datetime.timedelta(days=2)
    )
    notify_car_loan_requested(stale)

    tidy_car_loans.call_local()

    forgotten.refresh_from_db()
    recent.refresh_from_db()
    stale.refresh_from_db()
    assert forgotten.status == CarLoan.Status.EXPIRED
    # Closed, not also reminded in the same breath.
    assert forgotten.completion_reminded_at is None
    assert recent.status == CarLoan.Status.ACTIVE
    assert recent.completion_reminded_at is not None
    assert stale.status == CarLoan.Status.EXPIRED

    closed_title = "Billånet er lukket uden afregning"
    to_borrower = _notes(borrower, closed_title).get()
    assert "Gør beløbet op med Kløverbakkevej 7 ud fra kilometertælleren" in to_borrower.message
    # The whole lending household, since it is their money.
    for person in (owner, housemate):
        note = _notes(person, closed_title).get()
        assert note.message.startswith("Bo afsluttede ikke lånet af Tesla 3")

    reminder = _notes(borrower, "Husk at afslutte lånet").get()
    assert "CD 12 345" in reminder.message
    close_on = timezone.localdate(recent.end_at) + datetime.timedelta(
        days=UNFINISHED_LOAN_CLOSE_DAYS
    )
    assert f"{close_on:%d-%m-%Y} uden afregning" in reminder.message

    # The owners' "may I borrow your car?" stops waiting for an answer.
    assert not Notification.objects.filter(
        notification_type=NotificationType.CAR_LOAN_REQUEST, is_read=False
    ).exists()

    # A second run the same morning has nothing left to do.
    count = Notification.objects.count()
    tidy_car_loans.call_local()
    assert Notification.objects.count() == count


def _client_for(person):
    from rest_framework.test import APIClient

    client = APIClient()
    client.force_authenticate(user=person)
    return client
