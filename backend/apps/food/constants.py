from datetime import time

# Danish day names (Monday–Sunday)
DAY_NAMES = ["Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag", "Søndag"]

# Portion prices are date-dependent and configurable by food admins — see
# `apps/food/pricing.py`.

# Cutoff time for selling food tickets on the meal day (18:30)
TICKET_SALE_CUTOFF_TIME = time(18, 30)

# When take-away is normally picked up. "Takeaway er klar" is only news when the
# food is ready before this, so an announcement for this time or later is refused.
TAKEAWAY_STANDARD_TIME = time(17, 30)

# What a maddag blocks out in people's own calendars.
FOOD_TEAM_CALENDAR_START = time(15, 0)
FOOD_TEAM_CALENDAR_END = time(20, 0)
