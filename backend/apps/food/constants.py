from datetime import time
from decimal import Decimal

# Danish day names (Monday–Sunday)
DAY_NAMES = ["Mandag", "Tirsdag", "Onsdag", "Torsdag", "Fredag", "Lørdag", "Søndag"]

# Default meal prices in DKK
PRICE_ADULT_MEAT = Decimal("37.00")
PRICE_ADULT_VEG = Decimal("26.00")
PRICE_CHILD = Decimal("18.00")

# Cutoff time for selling food tickets on the meal day (18:30)
TICKET_SALE_CUTOFF_TIME = time(18, 30)


def calculate_meal_price(adults_meat: int, adults_veg: int, children: int) -> Decimal:
    """Calculate meal price from portion counts."""
    return PRICE_ADULT_MEAT * adults_meat + PRICE_ADULT_VEG * adults_veg + PRICE_CHILD * children
