# Bildeling — implementeringsplan

Deling af husstandenes biler i Kløverbakkens bilpøl. Appen er **et overblik og en
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
3. **Låneren spørger én eller flere ejere. Ejerens ja er et tilbud, ikke en
   tildeling.** Får låneren flere ja, vælger låneren selv. Ingen kamp om
   ressourcen, ingen først-til-mølle. Ejeren får at vide at hun er en af flere
   spurgte.
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
| `in_pool` | `BooleanField(default=False, db_index=True)` | med i bilpølen |
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

**Validering:** `in_pool=True` kræver `license_plate` ≠ "". `rate_per_km` må være
`null` (→ standardsats). Læg det i `Car.clean()` **og** i
`CarCreateUpdateSerializer.validate()`, så både admin og API dækkes.
`license_plate` er i forvejen `blank=True`, så biler udenfor pølen er upåvirkede.

**Rettigheder:** uændret — enhver beboer i huset kan redigere husets biler
(`CarDetailView.get_queryset` filtrerer på `user.house`). Det matcher "husstandens
voksne vælger". Bivirkning at være bevidst om: din bofælle kan sætte din bil i
pølen uden at spørge.

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
  # udfyldes når låneren vælger en bil (REQUESTED → ACTIVE):
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
  status        ASKED | ACCEPTED | DECLINED | CLOSED    # CLOSED = låneren valgte en anden
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
    """Alle biler i pølen, hver mærket med hvorfor den evt. ser optaget ud."""
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
- `notify_car_loan_chosen(loan)` → den valgte ejer ("dit tilbud er accepteret").
- `notify_car_loan_candidate_closed(candidate)` → ejere der sagde ja men ikke blev
  valgt.
- `notify_car_loan_cancelled(loan, by_user)` → modparten.
- `notify_car_loan_completed(loan)` → ejeren, med beløb og evt. skadesnote.

Link: `/bildeling/laan/<id>`.

### 6. Endpoints

Bilredigering genbruger det eksisterende `/api/houses/my/cars/` — kun serializeren
udvides. Resten under `/api/carsharing/`:

| Metode | Sti | Hvem |
|---|---|---|
| `GET` | `/cars/?start=&end=&isofix=&tow=&seats=` | alle — pølens biler med tilgængelighed |
| `GET` `POST` | `/cars/<pk>/blocks/` | kun egen husstand |
| `DELETE` | `/blocks/<pk>/` | kun egen husstand |
| `GET` | `/terms/` | vilkårstekst + aktuel version + standardsats |
| `GET` `POST` | `/loans/` | egne lån + forespørgsler til husstandens biler |
| `GET` | `/loans/<pk>/` | låner eller spurgt husstand |
| `POST` | `/loans/<pk>/candidates/<pk>/respond/` | ejer — `{"action": "accept"\|"decline"}` |
| `POST` | `/loans/<pk>/choose/` | låner — `{"candidate": <pk>}` → ACTIVE |
| `POST` | `/loans/<pk>/complete/` | låner — km, udgifter, skadesnote |
| `POST` | `/loans/<pk>/cancel/` | låner (altid) eller ejer (på aktivt lån) |

`POST /loans/` tager `car_ids: [int]` og opretter én `CarLoanCandidate` pr. bil.
Afvis bil-id'er der ikke er `in_pool`, og bil-id'er hvor lånerens egen husstand ejer
bilen (man forespørger ikke sin egen bil).

**Sæt et loft: `MAX_CANDIDATES_PER_LOAN = 5`.** Uden det er "vælg flere biler" bare
broadcast med ekstra trin — spørger man alle 25 biler i pølen, får 30+ voksne en
notifikation om det samme lån, og så er vi tilbage ved notifikationstræthed og
ansvarsdiffusion. Loftet håndhæves i serializeren med en dansk fejlbesked, og
UI'et må ikke have en "vælg alle"-knap.

**Rettigheder:** `IsAuthenticated` + filtrering i `get_queryset` på
`borrower=user` eller `candidates__car__house=user.house` — samme mønster som
`CarDetailView`. Ingen objekt-permission-klasser nødvendige.

**Atomaritet.** `choose` skal værne mod to ting, og de er ikke det samme:

1. **Samme lån vælges to gange** (dobbeltklik, genindsendt request) — betinget
   update på status, tjek rowcount, aldrig read-modify-write.
2. **Samme bil vælges af to forskellige lånere i overlappende tidsrum.** Det er den
   reelle dobbeltbooking, og den kan opstå selvom ingen gør noget forkert: to
   lånere spørger uafhængigt om bil X til lørdag, ejeren accepterer begge (hun ser
   dem som to tilbud), og så vælger begge lånere bil X. Guarden hører på serveren —
   ikke i UI'et.

```python
with transaction.atomic():
    loan = CarLoan.objects.get(pk=pk, status=REQUESTED)
    candidate = loan.candidates.get(pk=candidate_pk, status=ACCEPTED)

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

    updated = CarLoan.objects.filter(pk=pk, status=REQUESTED).update(
        status=CarLoan.Status.ACTIVE, car=candidate.car, ...
    )
    if not updated:
        raise ValidationError("Lånet er allerede afgjort.")
```

Overlap-testen er den sædvanlige halvåbne `start_a < end_b AND end_a > start_b`, så
et lån der slutter kl. 12 og et der starter kl. 12 ikke kolliderer.

Læn dig **ikke** på `select_for_update()` her — SQLite understøtter det ikke. Det er
også unødvendigt: begge sætninger ligger i samme `transaction.atomic()`, og SQLite
serialiserer skrivetransaktioner, så tjek og update kan ikke skilles af en anden
skriver.

Samme betingede-update-mønster i `complete` (`status=ACTIVE`) og i `respond`.

### 7. Konstanter og vilkårstekst

`apps/carsharing/constants.py` (samme mønster som `apps/food/constants.py`):

```python
DEFAULT_RATE_PER_KM = Decimal("3.94")
TERMS_VERSION = "2026-08-01"
LOAN_TERMS = "..."
```

Satsen ligger **ét sted** og bilens `rate_per_km` er kun et override — så en årlig
satsændring er én linje, ikke 25 bilredigeringer. Serveres via `/terms/` så
frontend og gemt `terms_version` altid stemmer.

Udkast til teksten (skal godkendes på et fællesmøde — se åbne spørgsmål):

> **Vilkår for lån af bil i bilpølen**
>
> - Du er ansvarlig for bilen, mens du har den. Kør forsigtigt og aflever den i
>   samme stand, som du fik den.
> - Sker der skade, eller virker noget ikke, giver du ejeren besked med det samme —
>   også småting. Udgangspunktet er, at låneren dækker selvrisikoen ved skader
>   opstået under lånet.
> - Almindeligt slid og mekanisk svigt, der ikke skyldes lånerens brug, er ejerens.
> - Bøder, parkerings- og broafgifter betaler du selv.
> - Du skal have gyldigt kørekort til bilen.
> - Der ligger en ladebrik i bilen, som virker de fleste steder. Har du haft
>   udgifter til strøm eller brændstof derudover, skriver du beløbet ind når du
>   afslutter lånet — det bliver trukket fra din betaling.
> - Prisen er {sats} kr. pr. kørt km. Du oplyser de faktisk kørte kilometer, når du
>   afslutter lånet.

Vis teksten på forespørgselsformularen (før afsendelse) og på lånesiden, og gem
`TERMS_VERSION` på lånet, så det altid kan slås op hvad der blev aftalt.

### 8. Søgeindeks

`index_car` i `apps/search/signals.py:77` indekserer allerede biler på nummerplade.
Udvid `subtitle_parts` med "Bilpøl" når `in_pool`, og læg `make`/`model_name` i
body — så finder søgning på "bilpøl" eller "Skoda" bilen. Husk
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
     pølens biler med tilgængelighedsmarkering; vælg én eller flere (max 5, ingen
     "vælg alle"); vilkårstekst; send. Vis løbende hvor mange husstande man er ved
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

- `in_pool=True` uden nummerplade afvises; med nummerplade accepteres.
- Sats falder tilbage til 3,94 når `car.rate_per_km` er `null`.
- Snapshot: ændres bilens sats efter aktivering, ændres lånets beløb ikke.
- Tilgængelighed: ugeskema-overlap markeres `"schedule"`, ubesvaret forespørgsel
  `"requested"`, aktivt lån `"loan"`; biler filtreres **ikke** væk, og rækkefølgen
  er fri-først.
- Overlap-grænse: et lån 10–12 og et lån 12–14 på samme bil kolliderer ikke.
- Fuldt forløb: forespørgsel til 3 biler → 2 ejere accepterer → låneren vælger én →
  lånet bliver ACTIVE, de øvrige kandidater bliver CLOSED, og de ejere notificeres.
- `choose` to gange giver 400 og kun ét aktivt lån.
- **Dobbeltbooking afvises:** to lånere spørger om samme bil i overlappende
  tidsrum, ejeren accepterer begge, begge vælger bilen → den anden `choose` giver
  400, og bilen har præcis ét aktivt lån.
- `complete`: `amount_due == km * sats − udgifter`; negativt beløb tillades; kun
  låneren kan afslutte.
- Rettigheder: man kan ikke svare på en kandidat for en bil udenfor sin husstand,
  og ikke se andres lån.
- `terms_version` gemmes på lånet.

Frontend: `CarSharingPage.test.tsx` — pølelisten renderes, beløbet beregnes
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
3. **Forespørgsel → tilbud → valg**, med de to notifikationstyper.
4. **Afslutning + lommeregner + vilkårstekst.**

Stop efter 2 hvis brugen udebliver. Det er hele pointen med opdelingen.

---

## Åbne spørgsmål til jer

1. **Vilkårsteksten skal godkendes af fællesskabet**, ikke af mig. Særligt to
   punkter: et generelt "lånerens ansvar at bilen ikke går i stykker" kan ikke
   dække almindeligt slid og mekanisk svigt uden lånerens skyld — derfor har
   udkastet delt det i skade (låner) og slid/svigt (ejer). Og hvem bærer tabet af
   skadefri år ved en anmeldt skade? Det står der ikke noget om endnu.
2. **Forsikring:** tjek at kr/km-afregningen ikke af nogens forsikringsselskab kan
   læses som erhvervsmæssig udlejning. Derfor bruges ordet "lån" konsekvent i UI'en
   og satsen omtales som deling af faktiske omkostninger — ikke leje.
3. **Satsen som kodekonstant eller admin-indstilling?** Anbefaling: konstant. Én
   linje om året er billigere at vedligeholde end en indstillingsside.
4. **Hvad hvis låneren aldrig afslutter?** v1: ingenting — lånet står som aktivt og
   er synligt for ejeren, som kan rykke personligt. En Huey-påmindelse kan komme
   senere, hvis det viser sig at være et problem.
5. **Dækker satsen ladning via brikken?** Udkastet antager ja, og at kun udgifter
   *derudover* fratrækkes. Bekræft.
