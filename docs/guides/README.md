# Resident guides

Two short guides in Danish for residents, many of them elderly: large type, one
screen per page, A4 landscape.

- `beboerguide/kb-intra-guide.html`: the whole app, 16 pages.
- `madholdguide/madhold-guide.html`: madhold in depth (wishes, profile, the three
  ways to swap, favours, the cooking day, takeaway, leftovers, every madhold
  notification), 16 pages.

Open the HTML and print it (A4, liggende), or rebuild the PDFs (below). The PDFs are
gitignored: they are 2–3 MB, over the repo's 500 KB per-file hook, and are rebuilt
from the HTML in one command.

## No real residents in the screenshots

This repo is public. Every screenshot comes from a scratch copy of a prod download
in which `kilde/demo_seed.py` has renamed every resident and child to an example name
(never their own first name, and never a name a real resident of the same house has,
so "Navn (12)" on a team list can never point at a real resident of house 12). It also clears e-mails, phones, bios,
photos and house descriptions, and scrubs free text that names people ("Navn (12)",
full names, rare surnames) from thread and event titles, announcements and group
descriptions. The demo residents are Hanne and Bent Eksempel (house 22) and Ole
Eksempel (house 64).

`kilde/check_names.py <prod download> <scratch db>` compares the two and must print
four empty lists before any screenshot is taken. It checks same-name-same-house
collisions, real full names, real "Fornavn (husnr)" and rare real surnames in the
free text. Look through the images anyway before committing new ones.

## Rebuilding

The demo is pinned to the September–October 2026 plan: the clock is Thursday
1 October 16:45, Hanne cooks that day and on 19 October. For a later period, change
the dates in `demo_seed.py` and `timed_daphne.py`.

```bash
# 1. Scratch copy, never the real data dir
mkdir -p /tmp/guide && cp ~/Downloads/"db (N).sqlite3" /tmp/guide/db.sqlite3
cd backend
DATA_DIR=/tmp/guide uv run python manage.py fix_orphaned_reactions   # the DB download leaves these behind
DATA_DIR=/tmp/guide uv run python manage.py migrate
# import the plan if the download predates it: import_food_teams / import_food_flags
DATA_DIR=/tmp/guide EMAIL_BACKEND=django.core.mail.backends.locmem.EmailBackend \
  uv run --with time-machine python manage.py shell < ../docs/guides/kilde/demo_seed.py
python3 ../docs/guides/kilde/check_names.py ~/Downloads/"db (N).sqlite3" /tmp/guide/db.sqlite3

# 2. The stack, with the server clock on the demo day (port 7100).
#    No VAPID private key, so nothing can be pushed; any public key shows the push button.
DATA_DIR=/tmp/guide EMAIL_BACKEND=django.core.mail.backends.locmem.EmailBackend \
  VAPID_PRIVATE_KEY= VAPID_PUBLIC_KEY=<any P-256 public key> \
  uv run --with time-machine python ../docs/guides/kilde/timed_daphne.py
# in frontend/:
VITE_DEV_PORT=5180 VITE_BACKEND_PORT=7100 npx vite --port 5180 --strictPort

# 3. Screenshots (headless Chrome, browser clock pinned too), then both guides
cd docs/guides/kilde
uv run --no-project --with playwright python shoot.py      # default order matters: see DEFAULT_ORDER
uv run --no-project --with playwright --with pillow python build_guides.py
```

`shoot.py` sends the day's takeaway and leftovers announcements, which can only
happen once per demo DB. Start again from step 1 to re-shoot those scenes.
