# Food System (Frontend)

The food system manages shared meals for the community: registrations, ticket trading, cooking team rotation, and billing. This documents the frontend side; see also `backend/apps/food/CLAUDE.md` for the full system design.

## Key Design Dogmas

### Registrations are per-house, not per-user

One registration per house per date. The UI edits the current user's house registration. All housemates see and share the same data.

### Preferences and registrations are separate concepts

`MealPreference` = mutable defaults (per house, per day-of-week). `MealRegistration` = concrete commitment for a specific date. Pre-deadline, the API returns virtual registrations derived from preferences. Post-deadline, they're frozen in the DB. The frontend doesn't need to distinguish — the API handles materialization.

### Strict Wednesday 23:59:59 deadline

Deadline logic lives in `utils/foodDeadline.ts`. Pre-deadline: all fields editable. Post-deadline: only `dining_option` and `seating_time` can change; portion inputs should be disabled/locked.

### Tickets are completely separate from registrations

Tickets are a secondary trading layer. They don't modify registrations. They can only be created after deadline. Partial claims are supported (claiming a subset splits the ticket). The ticket system has its own tab in `FoodPage.tsx`.

### Meat only on Wednesday

`adults_meat > 0` only valid on Wednesdays. The UI should reflect this (hide/disable meat inputs on other days). Backend enforces this too.

### Cooking happens Mon-Thu only

No meals on Friday, Saturday, or Sunday. Week views show 4 days.

### Portion prices are date-versioned

Prices depend on the **meal date**, not on today — meals before a price change keep the old prices forever. Fetch the schedule with `useMealPrices()` and resolve it with `resolvePrices(schedule, mealDate)` / `calculateDefaultTicketPrice(schedule, mealDate, ...)` from `utils/priceCalculation.ts`. Never hardcode a price.

Current: 37/26/18 DKK until 2026-08-01, 40/30/18 DKK from 2026-08-02 (adult meat / adult veg / child). Food admins change them from the Admin tab on `/mad/admin`.

### Two seating times

17:30 and 18:30, plus eat-in vs. take-away. Stats are bucketed by these dimensions.

## Menus come from Google Drive

Google Drive is the **source of truth** for weekly menus. The app fetches and caches them server-side. The frontend displays the menu for the selected week via the `/food/drive-menu/` endpoint. The app never creates or edits menus — it only reads and displays them.

## Food Teams

Team management lives on a separate page (`FoodTeamsPage.tsx`). Key concepts:

- **Cycles**: planning periods with wish deadlines
- **Wishes**: users declare available cooking dates
- **Swaps**: users can request to swap team assignments with others
- Preferences page (`FoodPreferencesPage.tsx`) handles default cooking day preferences

## Key Files

| File | Purpose |
|------|---------|
| `pages/FoodPage.tsx` | Main food page (registrations tab, tickets tab, admin tab) |
| `pages/FoodTeamsPage.tsx` | Team assignments and swap requests |
| `pages/FoodPreferencesPage.tsx` | Default meal preferences |
| `api/food.ts` | All food API calls, query hooks, mutations |
| `utils/foodDeadline.ts` | Deadline calculation and lock status |
| `types/index.ts` | Food-related TypeScript types (search for `Meal`, `FoodTicket`, `FoodTeam`) |
