# Code Review: Bookings System Module

## Summary

The Bookings System provides room reservation functionality with support for one-time and recurring bookings. The review identified several issues including a race condition in booking creation, incorrect React hook usage, and missing input validation. All issues have been fixed.

## Files Reviewed

- `backend/apps/bookings/models.py` (136 lines)
- `backend/apps/bookings/views.py` (329 lines)
- `backend/apps/bookings/serializers.py` (334 lines)
- `backend/apps/bookings/validators.py` (207 lines)
- `backend/apps/bookings/admin.py` (67 lines)
- `backend/apps/bookings/urls.py` (40 lines)
- `frontend/src/pages/BookingsPage.tsx` (2303 lines)
- `frontend/src/api/bookings.ts` (153 lines)

## Bugs Found and Fixed

### 1. Race Condition in Booking Creation (Medium)
**File:** `backend/apps/bookings/serializers.py:176-213`
**Description:** Two users submitting simultaneous booking requests for the same time slot could both pass validation and create overlapping bookings since overlap checks were done outside a database transaction.
**Fix:** Wrapped booking creation in `transaction.atomic()` and added a re-check for overlaps inside the transaction to ensure atomicity.

### 2. Race Condition in Booking Update (Medium)
**File:** `backend/apps/bookings/serializers.py:215-238`
**Description:** Similar race condition issue existed in the update method.
**Fix:** Added same transaction protection pattern with overlap re-check inside the atomic block.

### 3. useMemo Used for Side Effects (Medium)
**File:** `frontend/src/pages/BookingsPage.tsx:1269-1281`
**Description:** `useMemo` was incorrectly used to set React state (side effects). This caused issues where the initial date/time values might not update properly when the modal reopened with different values.
**Fix:** Changed `useMemo` to `useEffect` and removed the `!startDate` condition that prevented re-initialization.

### 4. Missing Date Format Validation (Low)
**File:** `backend/apps/bookings/views.py:201-215`
**Description:** The `exception_date` parameter for recurring booking exceptions was not validated for proper date format before being used in a database query.
**Fix:** Added explicit date format validation using `datetime.strptime` with YYYY-MM-DD format, returning 400 Bad Request for invalid formats.

## Issues NOT Fixed

### 1. Large Frontend File (Low Priority)
**File:** `frontend/src/pages/BookingsPage.tsx` (2303 lines)
**Reason:** While the file is large, it contains multiple well-organized React components (CreateBookingModal, EditBookingModal, DayTimeline, AdminModal, RoomsAdmin, etc.) that are only used within the bookings page. Splitting would add complexity without significant benefit for a small team. The code is readable and each component is well-defined.

### 2. N+1 Query in Conflict Error Messages (Low Priority)
**File:** `backend/apps/bookings/serializers.py:167-169, 191-193, 229-231`
**Reason:** When building error messages for conflicts, individual Room.objects.get() calls are made. This is acceptable because: (a) it only occurs on validation errors (not happy path), (b) typically involves 1-3 rooms maximum for this use case, and (c) adding complexity for optimization is not warranted.

## Tests Added

Created comprehensive test suite in `backend/apps/bookings/tests.py`:

1. **RoomModelTest** - Room creation and string representation
2. **BookingModelTest** - Booking creation and duration calculation
3. **OverlapValidatorTest** - Non-overlapping allowed, overlaps detected, exclusion works
4. **MultiRoomValidatorTest** - Multi-room availability checking
5. **RecurringBookingTest** - Day-of-week active checks, exception date skipping
6. **BookingAPITest** - API booking creation, overlap rejection, past date rejection, max duration validation
7. **RecurringBookingExceptionAPITest** - Exception creation, invalid date rejection

All 12 tests pass.

## Mobile and PWA Notes

The BookingsPage already includes good mobile support:
- `isMobile` media query for responsive layouts
- Responsive calendar size (`sm` on mobile, `md` on desktop)
- Touch-friendly click handlers on timeline slots
- ScrollArea for day timeline with proper scroll-to-9am
- Responsive button sizes and text

No mobile-specific bugs were identified.

## Commits

1. `d9e7c2c` - Various bugfixes (includes bookings fixes in a batch commit)
2. `6c3e8fd` - test(bookings): add comprehensive tests for booking system
