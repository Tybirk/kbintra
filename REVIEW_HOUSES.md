# Code Review: Houses & Directory Module

## Summary

Reviewed the Houses & Directory module for KB Intra. Found and fixed 4 issues related to database query optimization, mobile UX, and internationalization.

## Files Reviewed

### Backend
- `backend/apps/houses/models.py` (53 lines) - No issues found
- `backend/apps/houses/views.py` (155 lines) - Fixed N+1 queries
- `backend/apps/houses/serializers.py` (119 lines) - Fixed N+1 queries
- `backend/apps/houses/admin.py` - No issues found
- `backend/apps/houses/urls.py` - No issues found

### Frontend
- `frontend/src/pages/DirectoryPage.tsx` - Fixed language consistency
- `frontend/src/pages/HouseDetailPage.tsx` - No issues found
- `frontend/src/pages/HouseEditPage.tsx` - Fixed mobile UX issues
- `frontend/src/api/houses.ts` - No issues found

## Bugs Found and Fixed

### 1. N+1 Query in HouseSerializer.get_inhabitant_count
- **File**: `backend/apps/houses/serializers.py:76`
- **Severity**: Medium
- **Description**: Used `.count()` which executes a separate database query even when the inhabitants relation was prefetched via `prefetch_related`.
- **Fix**: Changed to `len(obj.inhabitants.all())` which uses the already prefetched data.

### 2. N+1 Query in HouseListSerializer.get_inhabitant_count
- **File**: `backend/apps/houses/serializers.py:104`
- **Severity**: Medium
- **Description**: Same issue as above - used `.count()` instead of leveraging prefetched data.
- **Fix**: Changed to `len(obj.inhabitants.all())` as fallback when annotated count not available.

### 3. Missing prefetch_related in MyHouseView
- **File**: `backend/apps/houses/views.py:73,90`
- **Severity**: Medium
- **Description**: Both `get` and `patch` methods accessed `user.house` directly without prefetching inhabitants and children, causing N+1 queries when serializing.
- **Fix**: Added explicit `House.objects.prefetch_related("inhabitants", "children").get(pk=user.house.pk)` calls.

### 4. Small touch targets on mobile (HouseEditPage)
- **File**: `frontend/src/pages/HouseEditPage.tsx:445-458`
- **Severity**: Low
- **Description**: ActionIcon buttons for edit/delete children used default size which is too small for comfortable mobile touch interaction.
- **Fix**: Added `size="lg"` and increased icon size from 16 to 18. Also added `aria-label` for accessibility.

### 5. Table overflow on mobile (HouseEditPage)
- **File**: `frontend/src/pages/HouseEditPage.tsx:426`
- **Severity**: Low
- **Description**: Children table could overflow on small screens without horizontal scroll.
- **Fix**: Wrapped table in `<Table.ScrollContainer minWidth={400}>`.

### 6. English error messages (DirectoryPage)
- **File**: `frontend/src/pages/DirectoryPage.tsx:59,90`
- **Severity**: Low
- **Description**: Error messages "Failed to load houses. Please try again." and "No houses found." were in English while rest of UI is in Danish.
- **Fix**: Translated to "Kunne ikke indlaese huse. Proev igen." and "Ingen huse fundet."

## Tests Added

No new tests added. Existing test coverage is comprehensive (16 tests passing).

## Issues NOT Fixed

### Admin N+1 Query Issue (Low priority)
- **File**: `backend/apps/houses/admin.py:28,33`
- **Description**: The admin list view displays `inhabitant_count` and `children_count` computed via `.count()` calls without using `select_related` or annotations.
- **Why not fixed**: Low impact - admin is used infrequently and only by administrators. The query overhead is minimal for ~20 houses. Fixing would require overriding `get_queryset` and using Count annotations.

## Commits Made

1. `153db63` - fix(houses): fix N+1 query issues in house serializers and views
2. `73fb047` - fix(houses): improve mobile UX and translate to Danish
