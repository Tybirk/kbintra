"""
What a given user *is* to a given loan, and what that lets them do.

One loan is visible to the borrower and to every asked household — up to
MAX_CANDIDATES_PER_LOAN of them — so "am I looking at my own business here?" has
several distinct answers, and the UI needs all of them to say anything true.

This module is the single authority for that question. The serializer exposes the
role and the permission it implies, and CancelLoanView enforces the permission by
calling the same function. That is deliberate: the earlier UI inferred the role
from combinations of is_borrower and status, guessed "any viewer of an active loan
is the lender", and showed nine households a button that could only ever 403.
"""

from .models import CarLoan, CarLoanCandidate


class LoanRole:
    """A viewer's relationship to one loan. Mutually exclusive by construction."""

    # The person who asked to borrow a car.
    BORROWER = "borrower"
    # My household owns the car that is (or was) lent out.
    LENDER = "lender"
    # My household was asked and still owes an answer.
    ASKED = "asked"
    # My household said no.
    DECLINED = "declined"
    # My household was asked, but another owner said yes first. Nothing to do.
    CLOSED_OUT = "closed_out"
    # Not party to this loan at all. visible_loans() should not return such a
    # loan, so this exists to keep the function total rather than to be used.
    NONE = "none"


def loan_role(loan, user) -> str:
    """Which of LoanRole this user holds on this loan.

    Reads only what visible_loans() already selects and prefetches, so calling it
    per loan in a list serializer costs no extra queries.
    """
    if loan.borrower_id == user.id:
        return LoanRole.BORROWER

    house_id = getattr(user, "house_id", None)
    if not house_id:
        return LoanRole.NONE

    # Mirrors CancelLoanView's notion of the owner: the household of the car that
    # actually went out, which is only set once someone accepted.
    if loan.car_id and loan.car.house_id == house_id:
        return LoanRole.LENDER

    mine = [candidate for candidate in loan.candidates.all() if candidate.car.house_id == house_id]
    if not mine:
        return LoanRole.NONE

    # A household can have two cars asked and have answered for only one of them.
    # Still owing an answer outranks having given one.
    statuses = {candidate.status for candidate in mine}
    if CarLoanCandidate.Status.ASKED in statuses:
        return LoanRole.ASKED
    if CarLoanCandidate.Status.DECLINED in statuses:
        return LoanRole.DECLINED
    return LoanRole.CLOSED_OUT


def can_cancel(loan, user) -> bool:
    """Whether this user may cancel this loan right now.

    CancelLoanView enforces exactly this, and the serializer ships exactly this,
    so the button cannot appear for someone the server would refuse.
    """
    if loan.status not in (CarLoan.Status.REQUESTED, CarLoan.Status.ACTIVE):
        return False

    role = loan_role(loan, user)
    if role == LoanRole.BORROWER:
        return True
    if role == LoanRole.LENDER:
        # A request has no car yet, so there is nothing for an owner to withdraw —
        # they answer it instead.
        return loan.status == CarLoan.Status.ACTIVE
    return False
