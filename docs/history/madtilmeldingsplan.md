# Plan: Mixed meal types + partial ticket selling

## Context

Two limitations in the current meal registration model:
1. A family registration has a single `meal_type` for all adults — no way to have e.g. 1 adult meat + 1 adult vegetarian on Wednesday.
2. Ticket selling is all-or-nothing — you can't sell just one adult's spot and keep the rest.

Both stem from the `adults_count + meal_type` data model. The solution: replace with **`adults_meat` + `adults_veg`** everywhere. Children eat one dish (no meat/veg split). `MealPreference.prefers_meat` (boolean) is replaced accordingly.

**Business rule**: Meat is only served on Wednesdays. On Mon/Tue/Thu, `adults_meat` must be 0 — all adults are counted via `adults_veg`. This is enforced strictly on create/update, and the data migration converts existing non-Wednesday data accordingly.

---

## Step 1: Backend models (`backend/apps/food/models.py`)

### MealRegistration (line 89-153)
- Remove: `adults_count` (line 107-110), `meal_type` (line 115-120)
- Add:
  ```python
  adults_meat = models.PositiveIntegerField(default=0, validators=[MinValueValidator(0)])
  adults_veg = models.PositiveIntegerField(default=0, validators=[MinValueValidator(0)])
  ```
- Update `total_portions` property: `self.adults_meat + self.adults_veg + self.children_count`
- Add computed property:
  ```python
  @property
  def adults_count(self) -> int:
      return self.adults_meat + self.adults_veg
  ```

### FoodTicket (line 155-221)
- Remove: `adults_count` (line 169-172), `meal_type` (line 177-182)
- Add: `adults_meat`, `adults_veg` (same fields as above)
- Update `total_portions`: `self.adults_meat + self.adults_veg + self.children_count`
- Add computed `adults_count` property

### MealPreference (line 48-86)
- Remove: `adults_count` (line 57-60), `prefers_meat` (line 65-68)
- Add: `adults_meat`, `adults_veg` (same fields)
- Add computed `adults_count` property

### MealType enum (line 27-31)
- Remove the `MealType` class — no longer used on any model
- Remove imports of `MealType` in `serializers.py`, `views.py`, `admin.py`, `conftest.py`

---

## Step 2: Migrations (`backend/apps/food/migrations/`)

**Three separate migrations** to avoid data loss:

### Migration 1: Add new columns
- Add `adults_meat` and `adults_veg` to `MealRegistration`, `FoodTicket`, `MealPreference` with `default=0`

### Migration 2: Data migration (with reverse)
Forward:
- `MealRegistration`/`FoodTicket`: `meal_type == "meat"` → `adults_meat = adults_count, adults_veg = 0`; `meal_type == "vegetarian"` → `adults_meat = 0, adults_veg = adults_count`
- **Non-Wednesday registrations**: regardless of stored `meal_type`, set `adults_meat = 0, adults_veg = adults_count` (enforcing the meat-only-Wednesday rule)
- `MealPreference`: `prefers_meat == True` → `adults_meat = adults_count, adults_veg = 0`; `prefers_meat == False` → `adults_meat = 0, adults_veg = adults_count`
- **Non-Wednesday preferences** (day_of_week != 2): set `adults_meat = 0, adults_veg = adults_count`

Reverse:
- `MealRegistration`/`FoodTicket`: `adults_meat > 0` → `meal_type = "meat", adults_count = adults_meat + adults_veg`; else → `meal_type = "vegetarian", adults_count = adults_meat + adults_veg`
- `MealPreference`: `adults_meat > 0` → `prefers_meat = True, adults_count = adults_meat + adults_veg`; else → `prefers_meat = False, adults_count = adults_meat + adults_veg`
- Note: reverse migration is lossy for mixed-type registrations (1 meat + 1 veg → picks "meat"), but acceptable for rollback safety

### Migration 3: Remove old columns
- Remove `adults_count`, `meal_type` from `MealRegistration` and `FoodTicket`
- Remove `adults_count`, `prefers_meat` from `MealPreference`

---

## Step 3: Serializers (`backend/apps/food/serializers.py`)

### MealPreferenceSerializer (line 37-53)
- Remove `adults_count`, `prefers_meat` from fields
- Add `adults_meat`, `adults_veg`

### MealPreferenceCreateUpdateSerializer (line 56-72)
- Remove `adults_count`, `prefers_meat` from fields
- Add `adults_meat`, `adults_veg`
- Add validation in `validate()`: on non-Wednesday (day_of_week != 2), `adults_meat` must be 0
- Add validation: `adults_meat + adults_veg + children_count` must be > 0

### MealRegistrationSerializer (line 82-114)
- Remove `adults_count`, `meal_type` from fields
- Add `adults_meat`, `adults_veg`
- Keep `total_portions` (computed property still works)

### MealRegistrationCreateUpdateSerializer (line 117-199)
- Remove `adults_count`, `meal_type` from fields
- Add `adults_meat`, `adults_veg`
- Add validation in `validate()`:
  - On non-Wednesday dates, `adults_meat` must be 0 → raise `"Kød serveres kun om onsdagen."`
  - `adults_meat + adults_veg + children_count` must be > 0 (when `is_active=True`)
- **Update `_user_has_active_ticket` check**: With partial tickets, a user may have an active ticket AND a valid reduced registration. Remove the blanket block. Instead, only block if the user has NO active registration at all (the ticket creation already reduced portions). Simplify: remove the `_user_has_active_ticket` check entirely — the old logic was: "don't register if you have an active ticket". With partial selling, this no longer applies because the registration and ticket coexist. The backend's ticket creation serializer already handles the deduction, so this validation is redundant and actively harmful.

### FoodTicketSerializer (line 202-247)
- Remove `adults_count`, `meal_type` from fields
- Add `adults_meat`, `adults_veg`

### FoodTicketCreateSerializer (line 249-325)
- Remove `adults_count`, `meal_type` from fields
- Add `adults_meat`, `adults_veg`
- Update `calculate_default_price` (drop `meal_type` parameter):
  ```python
  def calculate_default_price(self, adults_meat: int, adults_veg: int, children_count: int) -> Decimal:
      return (self.PRICE_ADULT_MEAT * adults_meat) + (self.PRICE_ADULT_VEG * adults_veg) + (self.PRICE_CHILD * children_count)
  ```
- Add validation in `validate()`: on non-Wednesday dates, `adults_meat` must be 0
- Add validation in `validate()`: `adults_meat + adults_veg + children_count` must be > 0
- Add validation in `validate()`: ticket portions don't exceed registration portions:
  ```python
  user = self.context["request"].user
  reg_date = attrs.get("date")
  reg = MealRegistration.objects.filter(user=user, date=reg_date, is_active=True).first()
  if reg:
      if attrs.get("adults_meat", 0) > reg.adults_meat:
          raise ValidationError("Du kan ikke sælge flere kød-portioner end du er tilmeldt.")
      if attrs.get("adults_veg", 0) > reg.adults_veg:
          raise ValidationError("Du kan ikke sælge flere vegetar-portioner end du er tilmeldt.")
      if attrs.get("children_count", 0) > reg.children_count:
          raise ValidationError("Du kan ikke sælge flere børne-portioner end du er tilmeldt.")
  ```
- **Update `create()`** — partial deactivation with `transaction.atomic()` + `select_for_update()`.
  **Critical**: Extract portion values BEFORE `super().create()`, because `super().create()` consumes `validated_data`:
  ```python
  def create(self, validated_data: dict) -> FoodTicket:
      user = self.context["request"].user
      validated_data["owner"] = user

      # Extract portion values BEFORE super().create() consumes validated_data
      ticket_adults_meat = validated_data.get("adults_meat", 0)
      ticket_adults_veg = validated_data.get("adults_veg", 0)
      ticket_children = validated_data.get("children_count", 0)

      # Set default price if not provided
      if validated_data.get("price") is None:
          validated_data["price"] = self.calculate_default_price(
              ticket_adults_meat, ticket_adults_veg, ticket_children
          )

      ticket = super().create(validated_data)

      # Partial deactivation of the user's meal registration
      with transaction.atomic():
          try:
              reg = MealRegistration.objects.select_for_update().get(
                  user=user, date=ticket.date, is_active=True
              )
              reg.adults_meat = max(0, reg.adults_meat - ticket_adults_meat)
              reg.adults_veg = max(0, reg.adults_veg - ticket_adults_veg)
              reg.children_count = max(0, reg.children_count - ticket_children)
              if reg.adults_meat == 0 and reg.adults_veg == 0 and reg.children_count == 0:
                  reg.is_active = False
              reg.save()
          except MealRegistration.DoesNotExist:
              pass

      return ticket
  ```

### Remove MealType import
- Remove `MealType` from import list (line 24)

---

## Step 4: Views (`backend/apps/food/views.py`)

### DailyRegistrationStatsView._get_stats_for_date (line 106-155)
All four `.aggregate()` calls use `Sum("adults_count")`. Replace **all of them** with two separate sums added in Python (Django's `Sum() + Sum()` in keyword args doesn't work directly):
```python
from django.db.models import F, Value
from django.db.models.functions import Coalesce

# For each category (takeaway, eat_in_1730, eat_in_1830, total):
agg = qs.aggregate(
    adults_meat=Coalesce(Sum("adults_meat"), 0),
    adults_veg=Coalesce(Sum("adults_veg"), 0),
    children=Coalesce(Sum("children_count"), 0),
)
# Then compute total adults in Python:
adults = agg["adults_meat"] + agg["adults_veg"]
```

Add `adults_meat`/`adults_veg` breakdown to the `total` section:
```python
"total": {
    "adults": adults,
    "adults_meat": total_agg["adults_meat"],
    "adults_veg": total_agg["adults_veg"],
    "children": total_agg["children"],
}
```

### MonthlyFoodCostView (line 861-1000)
Update the registration cost calculation loop (line 932-938):
```python
cost = (price_adult_meat * reg.adults_meat) + (price_adult_veg * reg.adults_veg) + (price_child * reg.children_count)
adult_portions += reg.adults_meat + reg.adults_veg
```
Same for the ticket loop (line 950-957):
```python
cost = (price_adult_meat * ticket.adults_meat) + (price_adult_veg * ticket.adults_veg) + (price_child * ticket.children_count)
adult_portions += ticket.adults_meat + ticket.adults_veg
```

### ApplyDefaultsView (line 228-313)
Preference branch (line 265-279): replace `adults_count` + `meal_type` with:
```python
defaults={
    "house": house,
    "adults_meat": pref.adults_meat,
    "adults_veg": pref.adults_veg,
    "children_count": pref.children_count,
    "dining_option": pref.dining_option,
    "seating_time": pref.seating_time,
    "is_active": True,
}
```
Fallback branch (line 293-306): replace with:
```python
is_wednesday = day == 2
defaults={
    "house": house,
    "adults_meat": house_inhabitant_count if is_wednesday else 0,
    "adults_veg": 0 if is_wednesday else house_inhabitant_count,
    "children_count": 0,
    "dining_option": "eat_in",
    "seating_time": "17:30",
    "is_active": True,
}
```

### FoodTicketDetailView.destroy (line 341-360)
When a ticket is deleted, restore the portions back to the registration. Guard against double-counting: only add portions back, don't create a new registration:
```python
def destroy(self, request, *args, **kwargs):
    ticket = self.get_object()
    # ... existing ownership/availability checks ...
    with transaction.atomic():
        # Restore portions to registration (if one exists)
        try:
            reg = MealRegistration.objects.select_for_update().get(
                user=request.user, date=ticket.date
            )
            reg.adults_meat += ticket.adults_meat
            reg.adults_veg += ticket.adults_veg
            reg.children_count += ticket.children_count
            reg.is_active = True
            reg.save()
        except MealRegistration.DoesNotExist:
            pass  # No registration to restore to — just delete the ticket
        ticket.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)
```
Note: `select_for_update()` prevents concurrent modifications. The filter has no `is_active` constraint — we restore to the registration even if it was deactivated (since deactivation happened when portions hit 0, and we're adding portions back).

### Remove MealType import
- Remove `MealType` from import list (line 25)

---

## Step 5: Admin site (`backend/apps/food/admin.py`)

### MealPreferenceAdmin (line 20-25)
- `list_display`: replace `"adults_count"` → `"adults_meat", "adults_veg"`, remove `"prefers_meat"`
- `list_filter`: remove `"prefers_meat"`

### MealRegistrationAdmin (line 28-34)
- `list_display`: replace `"adults_count"` → `"adults_meat", "adults_veg"`, remove `"meal_type"`
- `list_filter`: remove `"meal_type"`

### FoodTicketAdmin (line 37-51)
- `list_display`: replace `"adults_count"` → `"adults_meat", "adults_veg"`
- `list_filter`: remove `"meal_type"`

---

## Step 6: Shared test fixtures (`backend/conftest.py`)

### meal_preference fixture (line 120-130)
```python
# Before:
adults_count=2, prefers_meat=True
# After:
adults_meat=2, adults_veg=0
```

### meal_registration fixture (line 134-145)
```python
# Before:
adults_count=2, meal_type=MealType.MEAT
# After:
adults_meat=2, adults_veg=0
```
Note: the fixture uses `monday_date` (a Monday) — with the strict rule, this should be `adults_meat=0, adults_veg=2` since meat is only Wednesday. Update accordingly.

### food_ticket fixture (line 149-159)
```python
# Before:
adults_count=1, meal_type=MealType.MEAT
# After:
adults_meat=0, adults_veg=1
```
Same reasoning: Monday ticket can't have meat.

### Remove MealType import
- Remove `MealType` from conftest import list

---

## Step 7: Backend tests (`backend/apps/food/tests.py`)

Update all fixtures and assertions that use `adults_count`, `meal_type`, `prefers_meat`. Add new tests:
- Mixed meal type on Wednesday (1 meat + 1 vegetarian)
- Partial ticket selling: registration counter reduced correctly, registration stays active
- Full ticket selling: registration deactivated (all portions sold)
- Ticket deletion: portions restored to registration
- Ticket deletion when registration was re-created manually: no double-counting (guard check)
- Overselling validation: sell more portions than registered → 400
- Validation: `adults_meat > 0` on non-Wednesday → 400
- Validation: `adults_meat + adults_veg + children_count == 0` → 400 (for both registration and ticket)
- Stats: shows correct `adults_meat`/`adults_veg` breakdown in total
- Monthly cost with mixed meal types (correct DKK per meat vs veg)
- Apply defaults: Wednesday gets meat, other days get veg
- Preferences: Wednesday preference can have meat, other days forced to veg

---

## Step 8: Frontend types (`frontend/src/types/index.ts`)

### MealPreference (line 329-338)
- Remove: `adults_count`, `prefers_meat`
- Add: `adults_meat: number`, `adults_veg: number`

### CreateMealPreferenceData (line 340-347)
- Remove: `adults_count`, `prefers_meat`
- Add: `adults_meat: number`, `adults_veg: number`

### MealRegistration (line 354-369)
- Remove: `adults_count`, `meal_type`
- Add: `adults_meat: number`, `adults_veg: number`

### CreateMealRegistrationData (line 371-380)
- Remove: `adults_count`, `meal_type`
- Add: `adults_meat: number`, `adults_veg: number`

### DailyRegistrationStats / RegistrationCount (line 382-397)
- Add `adults_meat` and `adults_veg` to the total stats type:
  ```typescript
  interface TotalRegistrationCount extends RegistrationCount {
    adults_meat: number
    adults_veg: number
  }
  ```
  Or add optional fields to `DailyRegistrationStats.total`.

### FoodTicket (line 403-421)
- Remove: `adults_count`, `meal_type`
- Add: `adults_meat: number`, `adults_veg: number`

### CreateFoodTicketData (line 423-430)
- Remove: `adults_count`, `meal_type`
- Add: `adults_meat: number`, `adults_veg: number`

---

## Step 9: Frontend price calculation (`frontend/src/utils/priceCalculation.ts`)

Remove `MealType` type and update function signature:
```typescript
export function calculateDefaultTicketPrice(
  adultsMeat: number,
  adultsVeg: number,
  childrenCount: number,
): number {
  return PRICE_ADULT_MEAT * adultsMeat + PRICE_ADULT_VEG * adultsVeg + PRICE_CHILD * childrenCount
}
```

### Tests (`frontend/src/utils/priceCalculation.test.ts`)
Update all test cases to new signature. Add test for mixed (e.g. 1 meat + 1 vegetarian + 1 child = 37 + 26 + 18 = 81).

---

## Step 10: Frontend API module (`frontend/src/api/food.ts`)

Update payload types in:
- `createRegistration` / `updateRegistration`: uses `CreateMealRegistrationData` (already updated in step 8)
- `createTicket`: uses `CreateFoodTicketData` (already updated in step 8)
- `createPreference` / `updatePreference`: uses `CreateMealPreferenceData` (already updated in step 8)

No function signature changes needed — types change automatically via interface updates.

---

## Step 11: Frontend `MealFormFields.tsx` (`frontend/src/components/MealFormFields.tsx`)

Change props interface:
- Remove: `adults`, `mealType`, `onAdultsChange`, `onMealTypeChange`
- Add: `adultsMeat`, `adultsVeg`, `onAdultsMeatChange`, `onAdultsVegChange`

Render logic:
- **Wednesday**: two NumberInputs: "Voksne (kød)" → `adultsMeat`, "Voksne (vegetar)" → `adultsVeg`. Remove SegmentedControl for meal type.
- **Non-Wednesday**: one "Voksne" NumberInput → `adultsVeg` (meat implicitly 0, hidden). Label is just "Voksne" (no "(vegetar)" suffix since there's no choice).
- "Børn" unchanged

---

## Step 12: Frontend `FoodPage.tsx` (`frontend/src/pages/FoodPage.tsx`)

### DayRegistrationCard (line 764-1170)
State changes:
- Remove: `mealType` state
- Change: `adults` → `adultsMeat` + `adultsVeg` (initialized from `registration?.adults_meat` / `registration?.adults_veg`)
- Default for new registration: Wednesday → `adultsMeat=house_count, adultsVeg=0`; other days → `adultsMeat=0, adultsVeg=house_count`

Auto-save payload (line 937-948): send `adults_meat`, `adults_veg` instead of `adults_count`, `meal_type`.

Dependency array (line 949): `[adultsMeat, adultsVeg, children, diningOption, seatingTime, isActive]`

### Auto-save suppression during ticket creation
**Critical**: The auto-save `useEffect` (line 929-949) fires whenever state changes. When ticket creation reduces `adultsMeat`/`adultsVeg` via optimistic update, the auto-save will fire and try to save the reduced values. Meanwhile, the backend's `FoodTicketCreateSerializer.create()` already reduced those values on the registration. This causes a race:
1. Ticket creation reduces reg from (2,0) → (1,0) on backend
2. Optimistic update sets local state to (1,0)
3. Auto-save fires and PATCHes registration with (1,0) — this is redundant but safe IF the timing aligns

Actually, since both write the same final values (1,0), this is safe — the auto-save will just overwrite with the same value. **No suppression needed** as long as the optimistic update computes the same values the backend did. The `useDebouncedCallback` with 500ms delay means the PATCH goes out after the ticket POST has already completed on the backend.

**However**, we should add a query invalidation after ticket creation to re-fetch the registration from backend, ensuring local state stays in sync:
```typescript
onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["registrations"] })
    // ... existing close/reset logic
}
```

### Ticket modal (line 1085-1127)
Replace the current all-or-nothing ticket modal with partial selling:
- "Sælg voksne (kød)": NumberInput 0..adultsMeat (hidden if adultsMeat === 0 or not Wednesday)
- "Sælg voksne (vegetar)": NumberInput 0..adultsVeg (label: just "Sælg voksne" on non-Wednesday)
- "Sælg børn": NumberInput 0..children (hidden if children === 0)
- Live price display: `37*sellMeat + 26*sellVeg + 18*sellChildren` kr.
- Default: all fields set to their max (sell everything — preserves current UX for simple case)
- Payload: `{ adults_meat: sellMeat, adults_veg: sellVeg, children_count: sellChildren }`

Optimistic state update after creation:
```typescript
const newMeat = adultsMeat - sellMeat
const newVeg = adultsVeg - sellVeg
const newChildren = children - sellChildren
setAdultsMeat(newMeat)
setAdultsVeg(newVeg)
setChildren(newChildren)
if (newMeat + newVeg + newChildren === 0) setIsActive(false)
```

### handleCreateTicketAndSave (line 964-979)
Update payload to new fields:
```typescript
const ticketData: CreateFoodTicketData = {
    date,
    adults_meat: sellMeat,
    adults_veg: sellVeg,
    children_count: sellChildren,
    price: calculateDefaultTicketPrice(sellMeat, sellVeg, sellChildren),
    description: ticketDescription,
}
```

### DriveMenuDayCard (line 664-762)
Stats display: add `adults_meat`/`adults_veg` breakdown to the total row if data is available.

### MealFormFields usage (line 1021-1034)
Update to new props: `adultsMeat`, `adultsVeg`, `onAdultsMeatChange`, `onAdultsVegChange`.

---

## Step 13: Frontend `FoodTicketsPage.tsx` (`frontend/src/pages/FoodTicketsPage.tsx`)

### CreateTicketModal (line 489-625)
- Replace `adults` + `mealType` state with `adultsMeat` + `adultsVeg`
- Wednesday: two NumberInputs ("Voksne (kød)" + "Voksne (vegetar)"). Remove SegmentedControl.
- Non-Wednesday: one "Voksne" NumberInput → `adultsVeg` (adultsMeat forced to 0)
- **Note**: This standalone modal does NOT have the current registration loaded. It creates tickets independently (e.g., for a date the user hasn't registered for yet). The backend validates that portions don't exceed the registration, so the frontend doesn't need to bound the inputs here — just let the backend reject if overselling.
- Payload: `{ adults_meat, adults_veg, children_count }`
- Disabled state: `!date || (adultsMeat === 0 && adultsVeg === 0 && children === 0)`

### TicketCard display (line 172-481)
Replace `meal_type` badge with detailed breakdown:
```
{adults_meat > 0 && `${adults_meat} voksen kød`}
{adults_veg > 0 && `${adults_veg} voksen vegetar`}
{children_count > 0 && `${children_count} børn`}
```

---

## Step 14: Frontend `FoodPreferencesPage.tsx` (`frontend/src/pages/FoodPreferencesPage.tsx`)

State changes per day card:
- Remove: `mealType` state (initialized from `pref.prefers_meat`)
- Add: `adultsMeat`, `adultsVeg` (initialized from `pref.adults_meat`, `pref.adults_veg`)

Auto-save payload: send `adults_meat`, `adults_veg` instead of `adults_count`, `prefers_meat`.

Update `MealFormFields` usage to new props.

---

## Critical files

| File | Change |
|---|---|
| `backend/apps/food/models.py` | Add `adults_meat`/`adults_veg`, remove `adults_count`/`meal_type`/`prefers_meat`, remove `MealType` enum |
| `backend/apps/food/migrations/` | 3-step migration (add → data with reverse → remove) |
| `backend/apps/food/serializers.py` | All serializers, new price calculation, partial deactivation with locking, remove `_user_has_active_ticket` check |
| `backend/apps/food/views.py` | Stats (aggregate in Python), monthly cost, apply defaults, ticket deletion restore with guard |
| `backend/apps/food/admin.py` | Update `list_display` and `list_filter` for 3 admin classes |
| `backend/conftest.py` | Update `meal_preference`, `meal_registration`, `food_ticket` fixtures, remove `MealType` import |
| `backend/apps/food/tests.py` | Update + new tests (partial selling, mixed types, validation, restore, non-Wednesday rule) |
| `frontend/src/types/index.ts` | All affected interfaces |
| `frontend/src/utils/priceCalculation.ts` | New signature (drop mealType) |
| `frontend/src/utils/priceCalculation.test.ts` | Update tests |
| `frontend/src/api/food.ts` | Payload types change automatically via interfaces |
| `frontend/src/components/MealFormFields.tsx` | New props, two-input Wednesday UI |
| `frontend/src/pages/FoodPage.tsx` | State, auto-save, ticket sell modal with partial selling, query invalidation |
| `frontend/src/pages/FoodTicketsPage.tsx` | Create modal + ticket card display |
| `frontend/src/pages/FoodPreferencesPage.tsx` | State, auto-save, MealFormFields props |

---

## Verification

1. `cd backend && uv run python manage.py makemigrations && uv run python manage.py migrate`
2. `cd backend && uv run pytest apps/food/tests.py -v`
3. `cd backend && uv run ruff check --fix . && uv run ruff format . && uvx ty check`
4. `cd frontend && npm run typecheck && npm run lint && npm run format:check && npm run test:run`
5. Manual testing:
   - Wednesday: register 1 adult (meat) + 1 adult (vegetarian) → stats show correct breakdown
   - Wednesday: sell 1 adult (meat) → registration reduced to 0 meat + 1 vegetarian, remains active
   - Monday: register 2 adults → sell 1 → registration remains active with 1 adult (veg)
   - Monday: sell all → registration deactivated
   - Monday: try to register `adults_meat=1` → 400 error
   - Delete ticket → portions restored to registration
   - Create ticket then delete → registration back to original values
   - Apply default preferences → correct meat/vegetarian split from preferences
   - Monthly cost page → correct DKK per household (meat vs veg priced differently)
   - FoodTicketsPage: create ticket from standalone modal → backend validates
