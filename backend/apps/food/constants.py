from datetime import time

# Danish day names (Monday–Sunday)
DAY_NAMES = ["Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag", "Søndag"]

# Portion prices are date-dependent and configurable by food admins — see
# `apps/food/pricing.py`.

# Cutoff time for selling food tickets on the meal day (18:30)
TICKET_SALE_CUTOFF_TIME = time(18, 30)
