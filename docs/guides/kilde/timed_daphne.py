import datetime as dt
import sys
from zoneinfo import ZoneInfo

import time_machine

time_machine.travel(
    dt.datetime(2026, 10, 1, 16, 45, tzinfo=ZoneInfo("Europe/Copenhagen")), tick=True
).start()

from daphne.cli import CommandLineInterface  # noqa: E402

sys.argv = ["daphne", "-b", "127.0.0.1", "-p", "7100", "config.asgi:application"]
CommandLineInterface.entrypoint()
