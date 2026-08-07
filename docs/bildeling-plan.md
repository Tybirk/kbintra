# Bildeling — implementeringsplan

Deling af husstandenes biler i Kløverbakkens delebilpark. Appen er **et overblik og en
lommeregner** — ikke en myndighed der tildeler biler. Et lån opstår først når en
ejer har sagt ja, og aftalen indgås mellem to mennesker der kender hinanden.

## Designbeslutninger (fastlagt)

1. **Ugeskemaet er rådgivende, ikke bindende.** Hver bil kan have et ugentligt
   skema over hvornår den normalt er i brug. Det bruges til at *vise* hvilke biler
   det er relevant at spørge — ikke til at reservere. Konsekvens: ingen hård
   overlap-validering, ingen undtagelsesmekanik, ingen udløbs-tasks.
2. **Blød filtrering.** Biler der ifølge skemaet er optagede skjules ikke — de
   vises nedtonet med "normalt optaget". En bil der plejer at være væk om tirsdagen
   kan godt være fri netop denne tirsdag, og et uudfyldt skema forvrider intet.
3. **Låneren spørger én eller flere ejere, og det første ja afgør sagen.**
   Låneren har allerede valgt hvilke biler der spørges, så enhver af dem er i
   orden — der er intet tilbage at vælge bagefter. To trin i alt: forespørg,
   svar. Ejeren får at vide at hun er en af flere spurgte, og at den første der
   siger ja, låner bilen ud. De øvrige får besked om at de ikke skal gøre mere.

   Det koster den frihed at kunne vælge mellem flere ja, og til gengæld
   forsvinder et helt trin fra fladen: ingen ventetid på lånerens valg, ingen
   tilbud der udløber, ingen tvivl om hvem der har bolden.
4. **Tre grader af "optaget" — de skal ikke behandles ens.** Ugeskemaet er et gæt,
   et aktivt lån er et faktum:
   - **Aktivt lån i tidsrummet → hård.** Bilen vises som udlånt og kan ikke
     vælges. Den er reelt væk.
   - **Ugeskemaet siger optaget → blød.** Nedtonet med "normalt optaget", men kan
     stadig vælges (beslutning 2).
   - **En anden har allerede spurgt, men ingen har svaret → kun information.**
     "Der er allerede spurgt om denne bil i tidsrummet." Blokerer intet — den
     første forespørgsel får måske aldrig svar, så nummer to skal ikke låses ude.
   Uanset visningen skal serveren håndhæve den første: to lån om samme bil i
   overlappende tidsrum må ikke kunne opstå (se *Atomaritet*).
5. **Ingen mellemregning.** Beløbet vises, folk afregner selv (MobilePay).
6. **Ladning/brændstof:** de fleste biler er elektriske og har en ladebrik i bilen
   der virker de fleste steder. Har låneren haft udgifter derudover, indtastes de
   ved afslutning og **fratrækkes** det beløb låneren skal betale.

**Bevidst udenfor v1:** auto-godkend, svarfrister, påmindelser, ad-hoc-undtagelser
i ugeskemaet, betalingssaldi, aflysningsstatistik. Bliver det brugt, er
**auto-godkend** det første der skal tilbage — det er én boolean, og det er det
der gør lån hurtige.

---

## Backend

Ny app `apps.carsharing` (tilføjes til `INSTALLED_APPS` og
`config/urls.py` som `path("api/carsharing/", include("apps.carsharing.urls"))`).
Bilen selv bliver i `apps.houses` — den findes allerede.

### 1. Udvid `houses.Car`

`backend/apps/houses/models.py:118` har allerede `house`, `license_plate`,
`is_electric` og fuld CRUD på `/api/houses/my/cars/`. Tilføj:

| Felt | Type | Note |
|---|---|---|
| `is_shared` | `BooleanField(default=False, db_index=True)` | med i delebilparken |
| `rate_per_km` | `DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)` | `null` → falder tilbage til fælles standardsats |
| `make` | `CharField(max_length=50, blank=True)` | mærke |
| `model_name` | `CharField(max_length=50, blank=True)` | *ikke* `model` — for forvekslingsrisiko med Djangos eget navnerum |
| `color` | `CharField(max_length=30, blank=True)` | |
| `year` | `PositiveSmallIntegerField(null=True, blank=True)` | |
| `seats` | `PositiveSmallIntegerField(null=True, blank=True)` | |
| `has_tow_hitch` | `BooleanField(default=False)` | træk |
| `has_isofix` | `BooleanField(default=False)` | |
| `dogs_allowed` | `BooleanField(default=False)` | |
| `has_charge_fob` | `BooleanField(default=False)` | ladebrik ligger i bilen |
| `equipment_note` | `TextField(blank=True)` | andet udstyr |
| `practical_note` | `TextField(blank=True)` | hvor nøglen og ladebrikken er, hvor bilen holder |

**Validering:** `is_shared=True` kræver `license_plate` ≠ "". `rate_per_km` må være
`null` (→ standardsats). Læg det i `Car.clean()` **og** i
`CarCreateUpdateSerializer.validate()`, så både admin og API dækkes.
`license_plate` er i forvejen `blank=True`, så biler udenfor delebilparken er upåvirkede.

**Rettigheder:** uændret — enhver beboer i huset kan redigere husets biler
(`CarDetailView.get_queryset` filtrerer på `user.house`). Det matcher "husstandens
voksne vælger". Bivirkning at være bevidst om: din bofælle kan sætte din bil i
delebilparken uden at spørge.

### 2. Ny model `CarBlock` — ugentligt skema

```
car          FK(houses.Car, related_name="blocks")
days_of_week JSONField(default=list)   # [0..6], 0 = mandag — samme konvention som bookings.RecurringBooking
start_time   TimeField
end_time     TimeField
note         CharField(max_length=100, blank=True)
```

Kopier konventionen fra `apps/bookings/models.py` (`RecurringBooking.days_of_week`)
så der kun er én måde at repræsentere ugedage i kodebasen.

Valider `start_time < end_time`. Blokke over midnat splittes i to — et pendlerskema
(bilen væk 07–16) rammer aldrig midnat, så det er ikke en reel begrænsning.

### 3. Nye modeller `CarLoan` + `CarLoanCandidate`

Én tabel for hele forløbet: en godkendt forespørgsel **er** lånet. Det holder
tilstandsmaskinen på én række frem for at sprede den over to.

```
CarLoan
  borrower        FK(User, related_name="car_loans")
  status          REQUESTED | ACTIVE | COMPLETED | CANCELLED
  start_at        DateTimeField
  end_at          DateTimeField
  expected_km     PositiveIntegerField
  needs_isofix    BooleanField(default=False)
  needs_tow_hitch BooleanField(default=False)
  min_seats       PositiveSmallIntegerField(null=True, blank=True)
  note            TextField(blank=True)          # øvrige behov, fritekst
  terms_version   CharField(max_length=20)       # hvilke vilkår låneren fik vist
  owner_terms_version CharField(max_length=20, blank=True)  # og hvad ejeren havde accepteret
  # udfyldes når den første ejer siger ja (REQUESTED → ACTIVE):
  car             FK(houses.Car, null=True, blank=True, related_name="loans")
  approved_by     FK(User, null=True, blank=True, related_name="approved_car_loans")
  rate_per_km     DecimalField(5,2, null=True)   # snapshot — satsen må kunne ændres bagefter
  activated_at    DateTimeField(null=True, blank=True)
  # udfyldes ved afslutning (ACTIVE → COMPLETED):
  actual_km       PositiveIntegerField(null=True, blank=True)
  expense_amount  DecimalField(7,2, default=0)   # lånerens udgifter til strøm/brændstof
  expense_note    CharField(max_length=200, blank=True)
  damage_note     TextField(blank=True)          # skader eller ting der ikke virker
  amount_due      DecimalField(8,2, null=True)   # beregnet og gemt ved afslutning
  completed_at    DateTimeField(null=True, blank=True)
  created_at / updated_at

CarLoanCandidate
  loan          FK(CarLoan, related_name="candidates")
  car           FK(houses.Car, related_name="loan_candidacies")
  status        ASKED | ACCEPTED | DECLINED | CLOSED    # CLOSED = en anden ejer var først
  responded_by  FK(User, null=True, blank=True)
  responded_at  DateTimeField(null=True, blank=True)
  unique_together = ("loan", "car")
```

**Afregning** (metode på `CarLoan`, kaldes ved afslutning):

```
amount_due = (actual_km * rate_per_km - expense_amount).quantize(Decimal("0.01"))
```

Alt i `Decimal`, aldrig float. `amount_due` **må være negativ** — så skylder ejeren
låneren, og UI'en skal skrive det rent ud ("Ejeren skylder dig 42,50 kr."). Gem det
beregnede beløb frem for kun at beregne det on the fly, så en senere satsændring
ikke ændrer historiske lån.

`rate_per_km` snapshottes ved aktivering fra `car.rate_per_km or DEFAULT_RATE_PER_KM`.

### 4. Tilgængelighed — `apps/carsharing/services.py`

```python
def pool_cars_with_availability(start_at, end_at, *, needs_isofix=False,
                                needs_tow_hitch=False, min_seats=None):
    """Alle delte biler, hver mærket med hvorfor den evt. ser optaget ud."""
```

Returnerer hver bil med `conflict`, der afspejler de tre grader fra beslutning 4:

| `conflict` | Årsag | Kan vælges? |
|---|---|---|
| `None` | ingen konflikt | ja |
| `"requested"` | en anden har spurgt om bilen i tidsrummet (`CarLoan.status=REQUESTED` med overlap) | ja — kun information |
| `"schedule"` | `CarBlock` overlapper | ja — nedtonet |
| `"loan"` | aktivt lån overlapper (`status=ACTIVE`) | **nej** |

Sortér frie først, så `"requested"`, så `"schedule"`, og udlånte sidst.
**Returnér dem alle** — også de udlånte, så låneren kan se *hvorfor* bilen ikke er
en mulighed frem for at den bare mangler. Krav (isofix/træk/sæder) filtrerer ikke
hårdt; de bruges til sortering og til at markere "opfylder ikke dine krav".

Skema-overlap beregnes i almindelig Python ved at gå datoerne i intervallet
igennem. Valider derfor `end_at > start_at` og en maksimal lånelængde (30 dage),
så løkken er begrænset.

### 5. Notifikationer

`apps/notifications/models.py` — to nye typer, ikke flere:

```python
CAR_LOAN_REQUEST = "car_loan_request", "Forespørgsel om at låne din bil"
CAR_LOAN_UPDATE  = "car_loan_update", "Opdatering om bildeling"
```

Tilføj `notify_car_sharing` (default `True`), `email_car_sharing` (default
`False`), `push_car_sharing` (default `True`) på `NotificationPreference`, og
indsæt dem i **alle tre** opslagstabeller i `apps/notifications/services.py`:
`get_user_preference` (linje ~141), `get_user_push_preference` (linje ~179) og
tilsvarende i `email_service.should_send_email`. Husk også `push_car_sharing` i
"har brugeren nogen push slået til"-summen omkring linje 206.

Nye funktioner i `services.py`, i stil med `notify_expense_processed`:

- `notify_car_loan_requested(loan)` → alle `car.house.inhabitants` for hver
  kandidatbil. Beskeden skal nævne antal spurgte biler ("Du er en af 3 spurgt").
- `notify_car_loan_accepted(candidate)` → låneren ("du har fået en bil"). Dette er
  hele svaret, ikke et tilbud der skal vejes op mod andre.
- `notify_car_loan_activated(loan, by_user)` → resten af den udlånende husstand
  ("din bil er udlånt"). Den der trykkede ja ved det godt; bofællerne gør ikke.
- `notify_car_loan_candidate_closed(candidate)` → de husstande der stadig
  overvejede ("en anden ejer var først — du skal ikke gøre mere").
- `notify_car_loan_cancelled(loan, by_user)` → modparten.
- `notify_car_loan_completed(loan)` → ejeren, med beløb og evt. skadesnote.

Link: `/bildeling/laan/<id>`.

### 6. Endpoints

Bilredigering genbruger det eksisterende `/api/houses/my/cars/` — kun serializeren
udvides. Resten under `/api/carsharing/`:

| Metode | Sti | Hvem |
|---|---|---|
| `GET` | `/cars/?start=&end=&isofix=&tow=&seats=` | alle — delebilparkens biler med tilgængelighed |
| `GET` `POST` | `/cars/<pk>/blocks/` | kun egen husstand |
| `DELETE` | `/blocks/<pk>/` | kun egen husstand |
| `GET` | `/terms/` | vilkårstekst + aktuel version + standardsats |
| `GET` `POST` | `/loans/` | egne lån + forespørgsler til husstandens biler |
| `GET` | `/loans/<pk>/` | låner eller spurgt husstand |
| `POST` | `/loans/<pk>/candidates/<pk>/respond/` | ejer — `{"action": "accept"\|"decline"}`; accept → ACTIVE |
| `POST` | `/loans/<pk>/complete/` | låner — km, udgifter, skadesnote |
| `POST` | `/loans/<pk>/cancel/` | låner (altid) eller ejer (på aktivt lån) |

`POST /loans/` tager `car_ids: [int]` og opretter én `CarLoanCandidate` pr. bil.
Afvis bil-id'er der ikke er `is_shared`, og bil-id'er hvor lånerens egen husstand ejer
bilen (man forespørger ikke sin egen bil).

**Sæt et loft: `MAX_CANDIDATES_PER_LOAN = 10`.** Uden det er "vælg flere biler" bare
broadcast med ekstra trin — spørger man alle 25 biler i delebilparken, får 30+ voksne en
notifikation om det samme lån, og så er vi tilbage ved notifikationstræthed og
ansvarsdiffusion. Loftet håndhæves i serializeren med en dansk fejlbesked, og
UI'et må ikke have en "vælg alle"-knap.

**Rettigheder:** `IsAuthenticated` + filtrering i `get_queryset` på
`borrower=user` eller `candidates__car__house=user.house` — samme mønster som
`CarDetailView`. Ingen objekt-permission-klasser nødvendige.

**Atomaritet.** `respond` med `accept` skal værne mod tre ting:

1. **Samme lån afgøres to gange** (dobbeltklik, genindsendt request) — betinget
   update på status, tjek rowcount, aldrig read-modify-write.
2. **To ejere siger ja i samme øjeblik.** Begge kommer forbi statustjekket; kun én
   kan vinde den betingede update. Derfor skal lånet *claimes først*, og først
   derefter markeres kandidaten som ACCEPTED — ellers står taberen som udlåner.
3. **Samme bil siges ja til for to lånere i overlappende tidsrum.** Den reelle
   dobbeltbooking, og den kan opstå uden at nogen gør noget forkert: to lånere
   spørger uafhængigt om bil X til lørdag, og ejeren siger ja til begge.
   Guarden hører på serveren — ikke i UI'et.

```python
with transaction.atomic():
    candidate = loan.candidates.get(pk=candidate_pk, car__house=user.house)
    if loan.status != REQUESTED:
        raise ValidationError("Forespørgslen er ikke længere åben.")

    clash = (
        CarLoan.objects.filter(
            car=candidate.car,
            status=CarLoan.Status.ACTIVE,
            start_at__lt=loan.end_at,
            end_at__gt=loan.start_at,
        )
        .exclude(pk=loan.pk)
        .exists()
    )
    if clash:
        raise ValidationError("Bilen er netop blevet udlånt i det tidsrum.")

    claimed = CarLoan.objects.filter(pk=pk, status=REQUESTED).update(
        status=CarLoan.Status.ACTIVE, car=candidate.car, approved_by=user, ...
    )
    if not claimed:
        raise ValidationError("En anden ejer var hurtigere ...")

    # først nu er kandidaten vinderen; de ventende slippes fri
    loan.candidates.filter(status=ASKED).exclude(pk=candidate.pk).update(status=CLOSED)
```

Overlap-testen er den sædvanlige halvåbne `start_a < end_b AND end_a > start_b`, så
et lån der slutter kl. 12 og et der starter kl. 12 ikke kolliderer.

Læn dig **ikke** på `select_for_update()` her — SQLite understøtter det ikke. Det er
også unødvendigt: begge sætninger ligger i samme `transaction.atomic()`, og SQLite
serialiserer skrivetransaktioner, så tjek og update kan ikke skilles af en anden
skriver.

Samme betingede-update-mønster i `complete` (`status=ACTIVE`).

### 7. Konstanter og vilkårstekst

`apps/carsharing/constants.py` (samme mønster som `apps/food/constants.py`):

```python
DEFAULT_RATE_PER_KM = Decimal("3.94")
MAX_CANDIDATES_PER_LOAN = 10
TERMS_FILE = Path(__file__).resolve().parent / "vilkaar.md"
```

Satsen ligger **ét sted** og bilens `rate_per_km` er kun et override — så en årlig
satsændring er én linje, ikke 25 bilredigeringer. Serveres via `/terms/` så
frontend og gemt `terms_version` altid stemmer.

**Vilkårene ligger i `backend/apps/carsharing/vilkaar.md`**, ikke i Python. En
rettelse i teksten er dermed en redigering af et dokument, som kan læses og
godkendes på et fællesmøde uden at nogen skal kunne kode.
`docs/bildeling-vilkaar.md` er et **symlink** til filen, så teksten findes ét
sted. Grunden til at kilden ligger i backend'en og ikke i `docs/` er prosaisk:
serverimaget bygges med `context: ./backend`, så `docs/` er ikke med i imaget.

Filen har en overskrift, en `Version: ÅÅÅÅ-MM-DD`-linje og derefter nummererede
afsnit indledt med `## `. Under et afsnit må der stå brødtekst, punkter (`- `)
eller begge, og rækkefølgen bevares. En tom linje afslutter et afsnit eller en
punktopstilling — uden den ville to selvstændige bestemmelser i samme afsnit
smelte sammen til én. Fed skrift i starten af et punkt bliver en fremhævet
indledning (`{"lead": "Loft:", "text": "dit samlede ansvar ..."}`), fordi punkt 5
er ni tilfælde der hver især indledes sådan.

`constants.py` læser og validerer filen ved import og nægter at starte på en
ødelagt fil — tomme vilkår ville betyde at folk accepterede ingenting.
`{rate}` erstattes af den gældende km-takst (`str.replace`, ikke `str.format`, så
en tilfældig tuborgklamme i en håndredigeret fil ikke vælter importen).

**Serveren deler teksten op, ikke klienten.** `/terms/` leverer færdige afsnit og
punkter, så frontend aldrig skal fortolke Markdown — en `**` der slap igennem
ville ellers stå som to stjerner midt i en juridisk tekst.

Der lå tidligere et baggrundsnotat, `docs/bildeling-vilkaar-baggrund.md`, med
ræsonnementet bag beløbene og forholdet til erstatningsansvarslovens § 19. Det er
fjernet, fordi det blev overhalet af de beløb fællesskabet selv landede på —
7.000/3.000/10.000 og biler uden kasko. Teksten står i git-historikken, hvis den
skal bruges igen.

**Begge parter accepterer, og begge accepter gemmes:**

- **Låneren** sætter flueben før afsendelse (`accepted_terms` er *påkrævet* i
  serializeren, så en klient der glemmer feltet får en fejl i stedet for at sende
  en ubekræftet forespørgsel). Versionen gemmes som `CarLoan.terms_version`.
- **Ejeren** accepterer én gang, når bilen meldes ind i delebilparken
  (`Car.terms_accepted_version` + `terms_accepted_at`). Det holder svaret på en
  forespørgsel på ét tryk. Versionen — ikke en boolean — gemmes, så en ny
  vilkårsdato spørger alle igen i stedet for stiltiende at bære en accept af en
  tekst ingen har set.
- `is_shared` er ejerens *hensigt*, `terms_accepted_version` er hendes
  *samtykke*, og der skal være begge, før bilen kan lånes.
  `shared_cars_with_availability` filtrerer derfor på den aktuelle version, og en
  bil med forældet samtykke forsvinder fra listen indtil ejeren accepterer igen.
  "Mine biler" viser i så fald badge og advarsel, så det er til at forstå hvorfor.
- `CarLoan.owner_terms_version` snapshotter ejerens version ved aktivering, af
  samme grund som `rate_per_km`: bilens felt kan ændre sig bagefter, men et
  afgjort lån skal stadig kunne gøres op.

### 8. Søgeindeks

`index_car` i `apps/search/signals.py:77` indekserer allerede biler på nummerplade.
Udvid `subtitle_parts` med "Delebil" når `is_shared`, og læg `make`/`model_name` i
body — så finder søgning på "delebil" eller "Skoda" bilen. Husk
`rebuild_search_index` efter deploy. Se `apps/search/SEARCH.md`.

### 9. Admin

`apps/carsharing/admin.py` for `CarBlock`, `CarLoan`, `CarLoanCandidate`.
`Car` er allerede registreret — tilføj de nye felter til dens `list_display`.

---

## Frontend

- **`src/types/index.ts`** — udvid `Car` (linje 63), tilføj `CarBlock`, `CarLoan`,
  `CarLoanCandidate` og status-unions. Husk reglen i CLAUDE.md: ingen inline
  objekttyper inde i generics — navngivne interfaces.
- **`src/api/carsharing.ts`** — samme form som `src/api/expenses.ts`.
- **`src/pages/CarSharingPage.tsx`** — rute `/bildeling`, tre faner:
  1. **Lån en bil** — tidsrum (med "nu"-genvej), forventede km, krav; derunder
     delebilparkens biler med tilgængelighedsmarkering; vælg én eller flere (max 10, ingen
     "vælg alle"); vilkårstekst med påkrævet flueben; send. Vis løbende hvor
     mange husstande man er ved
     at spørge ("Du spørger 3 husstande"), så det er en bevidst handling og ikke et
     uheld.
  2. **Mine lån** — afventende forespørgsler med de ja'er der er kommet ind (vælg
     bil), aktive lån med bilens praktiske info (nøgle, ladebrik, kontakt), og
     afslutningsformular med km + udgifter + skadesnote og live-beregnet beløb.
  3. **Mine biler** — pool-toggle pr. bil, attributter, ugeskema, og genvej til
     `/beboere/hus/.../rediger` for resten.
- **`src/App.tsx`** — `const CarSharingPage = lazy(...)` + rute, i stil med
  `BookingsPage`.
- **`src/components/AppNavbar.tsx`** — `{ icon: IconCar, label: "Bildeling", path: "/bildeling" }`
  placeret ved "Bookingkalender" (linje 77).
- **`src/pages/NotificationPreferencesPage.tsx`** — Bildeling-toggles.

Mobile-first, jf. CLAUDE.md. Al brugervendt tekst på dansk.

---

## Tests

Backend, `apps/carsharing/tests.py`:

- `is_shared=True` uden nummerplade afvises; med nummerplade accepteres.
- Sats falder tilbage til 3,94 når `car.rate_per_km` er `null`.
- Snapshot: ændres bilens sats efter aktivering, ændres lånets beløb ikke.
- Tilgængelighed: ugeskema-overlap markeres `"schedule"`, ubesvaret forespørgsel
  `"requested"`, aktivt lån `"loan"`; biler filtreres **ikke** væk, og rækkefølgen
  er fri-først.
- Overlap-grænse: et lån 10–12 og et lån 12–14 på samme bil kolliderer ikke.
- Fuldt forløb: forespørgsel til 3 biler → første ejer siger ja → lånet bliver
  ACTIVE med den bil, de øvrige kandidater bliver CLOSED og notificeres, og den
  langsomme ejers accept giver 400.
- `accept` to gange giver 400 og kun ét aktivt lån.
- Et nej holder forespørgslen åben for de andre, og et allerede afgivet nej
  overskrives ikke af at en anden ejer siger ja (DECLINED, ikke CLOSED).
- Resten af den udlånende husstand får "din bil er udlånt"; den der svarede gør ikke.
- **Dobbeltbooking afvises:** to lånere spørger om samme bil i overlappende
  tidsrum, ejeren siger ja til begge → det andet `accept` giver 400, og bilen har
  præcis ét aktivt lån.
- `complete`: `amount_due == km * sats − udgifter`; negativt beløb tillades; kun
  låneren kan afslutte.
- Rettigheder: man kan ikke svare på en kandidat for en bil udenfor sin husstand,
  og ikke se andres lån.
- `terms_version` gemmes på lånet.

Frontend: `CarSharingPage.test.tsx` — billisten renderes, beløbet beregnes
korrekt i afslutningsformularen (inkl. negativt), vilkårsteksten vises.

Kør de sædvanlige tjek fra CLAUDE.md før commit (`ruff`, `ty`, `pytest`;
`typecheck`, `lint`, `format:check`, `test:run`).

---

## Rækkefølge — fire selvstændigt shipbare PR'er

1. **Bilattributter + pool-flag.** Model, migration, udvidet serializer på det
   eksisterende car-endpoint, UI i "Mine biler", søgeindeks. Giver værdi alene: man
   kan se hvem der har hvad, og melde sin bil ind.
2. **Ugeskema + Bildeling-siden.** `CarBlock`, tilgængelighedsberegning, listen
   over relevante biler med kontaktinfo. Herefter kan folk låne biler ved at
   skrive til hinanden — uden noget forespørgselsflow.
3. **Forespørgsel → første ja afgør**, med de to notifikationstyper.
4. **Afslutning + lommeregner + vilkårstekst.**

Stop efter 2 hvis brugen udebliver. Det er hele pointen med opdelingen.

---

## Åbne spørgsmål til jer

1. **Vilkårsteksten skal godkendes af fællesskabet**, ikke af mig. Den fulde
   tekst ligger nu i appen med de foreslåede beløb som gældende: 3.000 kr. for
   ejerens tab af skadefri år, 8.000 kr. som loft over lånerens samlede ansvar,
   24 timer til at gøre en skade gældende, 7 og 14 dages betalingsfrist, mindst
   2 års kørekortanciennitet, Danmark som geografisk grænse, bilgruppen som
   mægler. **Det er ikke det samme som at fællesmødet har sagt ja** — bekræft
   beløbene og ret dem i `vilkaar.md`, hvis mødet lander et andet sted.
   To ting mangler i koden, før punkt 5 og punkt 7 kan bære en reel uenighed:
   - **`insurance_deductible` på `houses.Car`**, vist på bilkortet. Punkt 5
     siger "Beløbet står på bilens side i appen", og det gør det ikke endnu. En
     selvrisiko låneren ikke har set, kan låneren ikke binde sig til.
   - **`start_km` / `end_km` frem for kun `actual_km`.** Punkt 7 siger "Du
     oplyser standen ved start og ved slut", men afslutningsformularen beder kun
     om de kørte kilometer. En tællerstand kan efterprøves; et husket tal kan
     ikke.
2. **Forsikring:** tjek at kr/km-afregningen ikke af nogens forsikringsselskab kan
   læses som erhvervsmæssig udlejning. Derfor bruges ordet "lån" konsekvent i UI'en
   og satsen omtales som deling af faktiske omkostninger — ikke leje.
3. **Satsen som kodekonstant eller admin-indstilling?** Anbefaling: konstant. Én
   linje om året er billigere at vedligeholde end en indstillingsside.
4. **Hvad hvis låneren aldrig afslutter?** v1: ingenting — lånet står som aktivt og
   er synligt for ejeren, som kan rykke personligt. En Huey-påmindelse kan komme
   senere, hvis det viser sig at være et problem.
5. **Dækker satsen ladning via brikken?** Vilkårenes punkt 7 siger nu ja, og at
   kun udgifter *derudover* fratrækkes. Bekræft på mødet.

---

## Udrulning

Rækkefølgen der skal følges når bildeling går i produktion, i den rækkefølge
tingene gør skade hvis de glemmes.

1. **Migrationer.** `houses/0010` (15 kolonner på `houses_car`, som går fra 6 til
   21 — SQLite bygger tabellen om, trivielt for ~70 biler),
   `carsharing/0001`+`0002` (tre nye
   tabeller) og `notifications/0018` (tre præferencekolonner). De kører
   automatisk i `docker-entrypoint.sh`. Alle fire er rent additive og tog under
   et sekund på en rigtig produktionskopi (se generalprøven nedenfor).
   **Bemærk:** `houses/0010` og `carsharing/0001` er blevet redigeret direkte
   fordi de aldrig havde nået `develop`. Efter merge er de urørlige som alle
   andre — ret dem ikke igen.
   `houses/0007` er også rettet, og det er en *allerede kørt* migration: den
   normaliserede nummerplader gennem den konkrete `Car`-model, som vælger alle
   kolonner der findes i dag, så en `migrate` fra nul brød sammen i det øjeblik
   `houses/0010` tilføjede delebil-kolonnerne (`no such column:
   houses_car.is_shared`). Den bruger nu den historiske model. Produktionen har
   kørt migrationen for længst og kører den ikke igen, så det ændrer intet på en
   eksisterende database — det er kun en rettelse for nye installationer.
2. **`rebuild_search_index` efter deploy.** Bilernes indekstekst er ændret
   (`Bilpøl` → `Delebil`, og `delebil delebilpark bildeling` i body), så
   eksisterende biler har forældede søgeord indtil indekset bygges om.
   `apps/search/signals.py` er ændret på både `develop` og denne gren; merge er
   ren, men kør søgetestene efter.
   **Den samme kørsel dækker også omdøbningen Arrangementer → Begivenheder.**
   `forum/0046` omdøber gruppen med `queryset.update()`, som ikke udløser
   `post_save`, og historiske modeller i `RunPython` har alligevel ingen signaler
   tilkoblet — så indekset bærer `Arrangementer` videre, både for gruppen selv og
   som `subtitle` på hver eneste tråd og indlæg i den, indtil der bygges om.
   Containeren gør det ikke af sig selv: opstart kører `--if-empty`, og
   produktionens indeks er ikke tomt.
   **Regn med cirka et minut:** på produktionskopien tog den 62 sekunder for
   24.189 objekter. Søgning giver forældede resultater indtil den er færdig, så
   kør den med vilje og ikke midt i myldretiden.
3. **Bildeling er skjult i produktion.** `isTestEnvironment()` i
   `frontend/src/utils/environment.ts` holder både Bildeling og Udlæg ude af
   menuen på kb-intra.dk, mens de vises på kbintra.top og lokalt.
   **Det skjuler kun menupunktet:** ruten og `/api/carsharing/` er åbne, og
   notifikationer linker til `/bildeling/laan/<id>`. Vil man have funktionen
   *lukket* og ikke blot ikke-synlig, kræver det en redirect på ruten eller en
   `CARSHARING_ENABLED`-indstilling på serveren.
4. **Vilkårene fejler højt.** `constants.py` læser og validerer `vilkaar.md` ved
   import, så en ødelagt redigering giver `ImproperlyConfigured` og en container
   der ikke starter. Det er med vilje — tomme vilkår ville betyde at folk
   accepterede ingenting — men det betyder også at en tastefejl i en
   Markdown-fil er et totalt udfald. CI importerer modulet, så det fanges før
   deploy, hvis man husker at lade CI køre.
5. **Ret ikke `Version:` i `vilkaar.md`** for en kommatering. Hver bil gemmer
   den version ejeren har accepteret, og en ny dato tager alle biler ud af
   delebilparken indtil ejerne accepterer på ny.

### Generalprøve på en produktionskopi (2026-08-05)

Migrationerne er kørt på et frisk `sqlite3 .backup`-øjebliksbillede af
produktionen (111 brugere, 58 husstande, 71 biler, 15.882 indlæg) hentet samme
dag. Udgangspunktet var `houses/0009`, `notifications/0017` og ingen
`carsharing`-app — præcis det produktionen står på.

- Alle fire migrationer kørte igennem på under et sekund. `PRAGMA
  integrity_check` og `PRAGMA foreign_key_check` var rene bagefter, og alle
  rækketal var uændrede.
- `migrate --check`, `makemigrations --check` og `manage.py check` var alle rene
  bagefter, og en gentaget kørsel fra samme øjebliksbillede gav samme resultat.
- **Delebilparken er tom på dag ét.** Alle 71 biler får `is_shared = 0`, så
  ingen bil bliver delt ved et uheld. Siden skriver "Der er ingen biler i
  delebilparken endnu." — det er den rigtige tekst, ikke en fejl.
- **`rate_per_km` er NULL på alle biler**, hvilket er meningen: feltet er en
  *override*, og NULL falder tilbage til fællesskabets 3,94 kr./km.
- **23 af de 71 biler har ingen nummerplade.** De kan ikke komme i
  delebilparken før ejeren skriver en plade ind ("En bil i delebilparken skal
  have en nummerplade."), og kortet viser dem som "Bil" med mærket "MANGLER
  NUMMERPLADE". Altså cirka en tredjedel af bilerne kræver en handling fra
  ejeren først — værd at vide inden man undrer sig over en tom delebilpark.
- Hele forløbet er kørt igennem på de rigtige data: del bil → vis delebilpark →
  forespørg → ejer ser `asked` → uvedkommende husstand ser intet → ejer siger ja
  → afslut med udgift (120 km × 4,25 − 50,50 = 459,50 kr., korrekt) → negativ
  udgift afvist → 45-dages vindue afvist. Ingen fejl i browserkonsollen.
- En `migrate` fra nul på en tom database kører også igennem (73 tabeller).

### Endnu ikke testet

- **E-mail og push** for bildeling-notifikationer. Notifikationen udløses og
  `send_email_task` kører færdig (verificeret i generalprøven, hvor begge
  beboere i ejerens husstand fik en), men det var med udviklings-mailbackend —
  levering til en rigtig indbakke er stadig ikke set. Push var slået fra.
- **Ægte samtidighed** (to ejere der siger ja i samme millisekund) er aldrig
  reproduceret. Rækkefølgen der beskytter mod det er testet
  (`test_the_loser_of_a_race_is_not_recorded_as_the_lender`), men ikke under
  reel parallelitet.
- **Rigtig touch** på ugeskemaet. Geometrien er forbedret (30 px rækker på
  smalle skærme), men kun målt — ikke prøvet på en telefon.

