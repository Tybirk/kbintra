# PRD: Grafisk overblik over foreningens organisation (organer + arbejdsgrupper)

**Tracks:** `bugs/11-subgroup-hierarchy.md` (HC/Peter, 4. maj 2026) + Bestyrelsens uddybende ønsker.
**Prod thread to report back on:** https://kb-intra.dk/forum/feature-ideer/traad/hierarki-i-grupper-udvalg

## Problem Statement

Foreningens "officielle" struktur lever i dag kun i hovederne på folk og i vedtægterne. Appen kan ikke vise:

- **Hvilke arbejdsgrupper hører under hvilket organ.** En beboer kan ikke se, at fx "Bivenner-arbejdsgruppen" har mandat fra Grønt udvalg, eller hvilke arbejdsgrupper bestyrelsen har nedsat. Der er intet mandat-overblik.
- **Hvad en arbejdsgruppe er til for, hvornår den blev oprettet, hvornår den udløber, og hvem der er med.** Metadata findes ikke som struktureret data.
- **Forholdet mellem en arbejdsgruppe og dens forumgruppe.** Langt fra alle arbejdsgrupper har en forumgruppe i dag, og der er ingen kobling.

Datamodellen mangler konkret: en klassifikation af organ-typer (i dag findes kun `is_committee` for Udvalg), en forælder/barn-relation mellem grupper, og felter for formål/datoer/aktiv-status. Foreningens to øverste organer — **Generalforsamlingen** og **Fællesmødet** — findes slet ikke som forumgrupper endnu.

## Solution

Vi udvider den eksisterende `Subgroup`-model til at bære foreningens struktur, og bygger en ny grafisk overbliksside. En node i strukturen **er** en forumgruppe — så forum-integrationen, som Bestyrelsen efterspørger på den længere bane, falder ud gratis: at oprette en arbejdsgruppe er at oprette dens forumgruppe.

Fra brugerens perspektiv:

- **Ny hovedmenu-indgang "Grafisk overblik"** (`/overblik`) viser foreningens organer øverst — Generalforsamlingen → Fællesmødet → Bestyrelsen → de enkelte Udvalg — med deres arbejdsgrupper hængende nedenunder i et træ. Hver node linker til sin forumgruppe og viser formål, medlemmer og datoer. Sådan kan man se hvilke grupperinger der har et mandat fra foreningen.
- **Arbejdsgrupper kan ligge i vilkårlig dybde.** En arbejdsgruppe kan have en arbejdsgruppe under sig (fx "Grønt udvalg" → "Bivenner" → en undergruppe). Træet rendres rekursivt.
- **Almindelige grupper (uden mandat) er IKKE en del af overblikket** — de bliver ved med kun at ligge i `/forum` som i dag. Dermed bevarer vi muligheden for "uofficielle" forumgrupper.
- **Alle beboere kan oprette arbejdsgrupper og almindelige grupper.** I opret-flowet vælger man type (arbejdsgruppe / almindelig gruppe), og for arbejdsgrupper vælger man forælder-organet. At oprette/omdøbe et organ (Generalforsamling, Fællesmøde, Bestyrelse, et nyt Udvalg) er en admin-opgave i Django admin. At slette en gruppe er ligeledes en admin-opgave i Django admin.
- **Afsluttede arbejdsgrupper arkiveres.** Når en arbejdsgruppe er færdig med sit arbejde, markeres den som afsluttet (inaktiv). Den forsvinder fra overblikket og fra forum-listen som standard, så vi ikke over tid drukner i gamle grupper. Arkivering af en gruppe skjuler også hele dens undertræ i overblikket (en arkiveret forælder tager sine eventuelle undergrupper med — uden at skrive `is_active` på dem; det er en visnings-regel, ikke en cascade). En kontakt ("Vis afsluttede") kan slå dem til igen. Selve forumgruppen findes stadig på sin URL.
- **Metadata på arbejdsgrupper.** Formål (genbruger gruppens beskrivelse), oprettelsesdato, evt. udløbsdato, medlemmer (genbruger den eksisterende medlems-funktion) og link til forumgruppen.
- **Alle bliver abonnenter på Generalforsamlingen og Fællesmødet.** De to nye organ-forumgrupper oprettes, sættes som standard-grupper, og alle nuværende brugere bliver bagudfyldt som abonnenter (samme mønster som migration `0041`).

Forælder/barn-relationen er **kun struktur og navigation — ikke en rettigheds- eller synligheds-cascade.** Privathed styres fortsat per gruppe via den eksisterende `allows_members`/`members_only`-mekanik. (Bevidst videreført fra `bugs/11`.)

## User Stories

### Overblik (grafisk side)

1. Som beboer vil jeg have en hovedmenu-indgang "Grafisk overblik", så jeg ét sted kan se foreningens officielle struktur.
2. Som beboer vil jeg se organerne i fast rækkefølge — Generalforsamling, Fællesmøde, Bestyrelse, derefter Udvalgene (alfabetisk) — så strukturen afspejler vedtægternes hierarki.
3. Som beboer vil jeg under hvert organ se de arbejdsgrupper, der er oprettet under det, så jeg kan se hvilke grupperinger der har mandat.
4. Som beboer vil jeg kunne folde grene ud/ind, så et stort træ er overskueligt på mobil.
5. Som beboer vil jeg på hver node se formål, medlemmer og datoer samt et link til nodens forumgruppe, så jeg hurtigt kan komme videre.
6. Som beboer vil jeg som standard IKKE se afsluttede arbejdsgrupper, men kunne slå dem til med en "Vis afsluttede"-kontakt, så overblikket er rent men stadig komplet ved behov.
7. Som beboer vil jeg IKKE se almindelige (uofficielle) grupper i overblikket, så overblikket kun viser den officielle struktur.

### Oprettelse & redigering

8. Som beboer vil jeg ved oprettelse af en gruppe kunne vælge, om det er en arbejdsgruppe eller en almindelig gruppe.
9. Som beboer vil jeg ved oprettelse af en arbejdsgruppe vælge dens forælder (et organ eller en anden arbejdsgruppe), så den får det rigtige mandat.
10. Som beboer vil jeg kunne angive formål, oprettelsesdato og evt. udløbsdato på en arbejdsgruppe.
11. Som beboer vil jeg kunne ændre en arbejdsgruppes forælder og metadata senere.
12. Som beboer vil jeg kunne markere en arbejdsgruppe som afsluttet (og fortryde igen), så den arkiveres når arbejdet er slut.
13. Som admin vil jeg oprette/omdøbe organer (Generalforsamling, Fællesmøde, Bestyrelse, nye Udvalg) i Django admin, så de centrale organer ikke kan oprettes ved et uheld af menige brugere.
14. Som admin vil jeg slette grupper i Django admin, så sletning er en bevidst, kontrolleret handling.

### Forum-integration

15. Som beboer oplever jeg, at en arbejdsgruppe og dens forumgruppe er det samme — at oprette arbejdsgruppen giver den en forumgruppe automatisk.
16. Som beboer vil jeg have, at afsluttede arbejdsgruppers forumgrupper også skjules fra forum-listen som standard, så listen ikke vokser ukontrolleret.
17. Som beboer vil jeg automatisk være abonnent på Generalforsamlingen og Fællesmødet, så jeg hører om aktivitet i foreningens øverste organer.

## Implementation Decisions

### Backend — `forum` app

**Model (`backend/apps/forum/models.py`):**

- New `Subgroup.group_type` — `CharField(max_length=20, choices=GroupType.choices, default=GroupType.ALMINDELIG, db_index=True)`. `GroupType` is a `models.TextChoices`:
  - `GENERALFORSAMLING = "generalforsamling", "Generalforsamling"`
  - `FAELLESMOEDE = "faellesmoede", "Fællesmøde"`
  - `BESTYRELSE = "bestyrelse", "Bestyrelse"`
  - `UDVALG = "udvalg", "Udvalg"`
  - `ARBEJDSGRUPPE = "arbejdsgruppe", "Arbejdsgruppe"`
  - `ALMINDELIG = "almindelig", "Almindelig gruppe"`
- Class-level constants/helpers: `ORGAN_TYPES = {GENERALFORSAMLING, FAELLESMOEDE, BESTYRELSE, UDVALG}`; properties `is_organ` and `is_working_group`.
- New `Subgroup.parent` — `ForeignKey("self", on_delete=models.SET_NULL, null=True, blank=True, related_name="children")`.
- New `Subgroup.established_on` — `DateField(null=True, blank=True)` (officiel oprettelsesdato; adskilt fra system-`created_at`).
- New `Subgroup.expires_on` — `DateField(null=True, blank=True)`.
- New `Subgroup.is_active` — `BooleanField(default=True, db_index=True)`. `False` = afsluttet/arkiveret.
- **Reuse** `description` som formål, og den eksisterende `SubgroupMembership` som medlemsliste. Ingen nye `purpose`/`is_leader`/`show_in_forum`-felter.
- **Remove** `is_committee`. Erstat de tre reelle læsninger med `group_type == UDVALG`:
  - `Meta.ordering` → `["-is_main", "-last_activity_at"]` (overbliks-rækkefølge styres af et dedikeret view, ikke modellens default-ordering).
  - `SubgroupSerializer` felt (se nedenfor).
  - `ForumPage.tsx` gruppering (se frontend).
  - Opdater desuden `conftest.py:280`, `tests.py` (linje 49-50, 626, 1671) og `seed_forum_subgroups.py` (linje 143/166/190) til `group_type=`.
- `Subgroup.clean()` / `save()`-validering:
  - **Cykel-tjek:** en gruppe må ikke være sin egen forfader (gå op ad `parent` med et dybde-loft, fx 10).
  - **Forælder-type-regel:** `ALMINDELIG` → `parent` skal være `None`. `ARBEJDSGRUPPE` → `parent` skal være et organ eller en anden `ARBEJDSGRUPPE` (ikke `ALMINDELIG`, ikke sig selv/efterkommer). Organ-typer → `parent = None`.

**Serializers (`backend/apps/forum/serializers.py`):**

- `SubgroupSerializer`: fjern `is_committee`; tilføj `group_type`, `parent` (id, nullable), `parent_name`/`parent_slug` (read-only, til breadcrumb), `established_on`, `expires_on`, `is_active`. (Lad `members` og `description` være som de er.)
- `SubgroupCreateSerializer`: tilføj `group_type` (skal valideres til `{ARBEJDSGRUPPE, ALMINDELIG}` på app-stien — organ-typer afvises for ikke-staff), `parent`, `established_on`, `expires_on`. Validér forælder-type/cykel som i modellen.
- `SubgroupUpdateSerializer`: tilføj `parent`, `established_on`, `expires_on`, `is_active`. (Lader `group_type` være read-only via app — omklassificering sker kun i Django admin.)
- New lightweight `OrgNodeSerializer` til overbliks-træet: `id, name, slug, group_type, description, established_on, expires_on, is_active, members (avatars+count), children (rekursivt)`. Kun organer + arbejdsgrupper.

**Views/URLs (`backend/apps/forum/views.py`, `urls.py`):**

- New `OrganisationView` (`GET /api/forum/organisation/`): returnerer organ-rødder i fast rækkefølge (Generalforsamling, Fællesmøde, Bestyrelse, derefter Udvalg alfabetisk) med rekursivt nestede arbejdsgrupper. `?include_inactive=true` inkluderer afsluttede; default udelades enhver node der enten selv er inaktiv **eller har en inaktiv forfader** — at arkivere en forælder skjuler altså hele dens undertræ (børn promoveres ikke op til rod). Almindelige grupper udelades altid. Byg træet med ét fladt query (`group_type` in organ-typer ∪ arbejdsgruppe) og saml `parent_id → children` i Python for at undgå N+1; serializeren fodres med de færdigbyggede nestede dicts, så rekursionen lever i Python og ikke i ORM'en.
- `SubgroupListView.create`: validér at ikke-staff kun kan sætte `group_type ∈ {ARBEJDSGRUPPE, ALMINDELIG}`. Bevar den eksisterende auto-enroll af opretteren når `allows_members`.
- `SubgroupListView.get_queryset` (forum-listen): filtrér `is_active=True` som standard; `?include_archived=true` (eller tilsvarende) viser arkiverede. Organer og almindelige grupper er normalt `is_active=True` og påvirkes ikke.
- `SubgroupUpdateView`: tillad de nye strukturfelter. Tilladelse: for en `ARBEJDSGRUPPE` må enhver autentificeret bruger redigere strukturfelter (`parent`, datoer, `is_active`) og beskrivelse (intet leder-koncept, jf. beslutningen "alle medlemmer opretter disse grupper"). For organ-grupper kræver redigering af struktur, `name`, `description` og `icon` at man er staff **eller medlem** af organet — bemærk at navn/beskrivelse i dag kan redigeres af alle (felterne er ikke gated i den nuværende `patch`), så dette er net-ny indsnævring der kun gælder organer. `group_type`-ændringer (omklassificering) forbliver staff/admin-only.
- **Ingen ny delete-endpoint** — sletning forbliver i Django admin (der findes i forvejen ingen subgroup-delete i app'en).

**Django admin (`backend/apps/forum/admin.py`):** registrér/udvid `Subgroup` med `group_type`, `parent` (raw_id eller autocomplete), `established_on`, `expires_on`, `is_active` så admins kan oprette organer, omklassificere, reparentere og slette.

**Migrations:**

1. Schema-migration: tilføj `group_type`, `parent`, `established_on`, `expires_on`, `is_active`; behold `is_committee` midlertidigt.
2. Data-migration:
   - `is_committee=True` → `group_type=UDVALG`.
   - Den gruppe der hedder "Bestyrelsen" (fuzzy match som i `0041`) → `group_type=BESTYRELSE`.
   - Resten beholder default `ALMINDELIG`.
3. Schema-migration: fjern `is_committee` og opdater `Meta.ordering`.
4. Data-migration: opret `Generalforsamling` og `Fællesmøde` som `is_default=True` organ-grupper hvis de ikke findes; bagudfyld `SubgroupSubscription` for alle nuværende brugere (genbrug `0041`-mønsteret; `is_default` dækker kun fremtidige brugere).

### Frontend

- **Navbar (`AppNavbar.tsx`):** ny post `{ icon: IconSitemap, label: "Grafisk overblik", path: "/overblik" }`. Tilføj rute i `App.tsx`.
- **Ny side `OverviewPage.tsx` (`/overblik`):** Mantine `Tree` + `useTree` med custom `renderNode`. Data fra `GET /api/forum/organisation/`. Hver node: navn (link til `/forum/<slug>`), formål (afkortet beskrivelse), medlems-avatars/antal, datoer, og "Afsluttet"-badge for inaktive (kun synlige når slået til). "Vis afsluttede arbejdsgrupper"-`Switch` styrer `?include_inactive`. Knappen "Opret arbejdsgruppe" åbner opret-formen med type forudvalgt og forælder-vælger.
- **Opret-form (genbrug/udvid modal i `ForumPage.tsx` + i overblikket):** `SegmentedControl`/`Select` for type (Arbejdsgruppe / Almindelig gruppe). Når Arbejdsgruppe er valgt: vis et `Select` for forælder (organer + eksisterende arbejdsgrupper, hentet fra organisations-endpointet) samt `DateInput` for oprettelses-/udløbsdato. Almindelig gruppe: som i dag.
- **`ForumPage.tsx` gruppering:** erstat `is_committee`-tjek med `group_type === "udvalg"` for "Udvalg"-sektionen. Arkiverede (`is_active === false`) udelades fra listen som standard (følg backendens default-filter).
- **`SubgroupPage.tsx`:** vis forælder som breadcrumb-chip ("← {parent_name}") og børn som en "Arbejdsgrupper/Underudvalg"-sektion med chips (jf. `bugs/11`). Tilføj "Markér som afsluttet"/"Genåbn"-handling for arbejdsgrupper.
- **Typer (`frontend/src/types/index.ts`):** fjern `is_committee` fra `Subgroup`; tilføj `group_type: GroupType`, `parent: number | null`, `parent_name`, `parent_slug`, `established_on: string | null`, `expires_on: string | null`, `is_active: boolean`. Tilføj `GroupType`-union og et `OrgNode`-interface (navngivet interface — ikke inline objekt-type i generic, jf. CLAUDE.md). Opdater testfixtures der sætter `is_committee`.

### API contract

```
GET   /api/forum/organisation/?include_inactive=<bool>     (ny)  → organ-rødder m. nestede arbejdsgrupper
GET   /api/forum/subgroups/?include_archived=<bool>        (udvidet: filtrér is_active)
POST  /api/forum/subgroups/                                (udvidet: + group_type, parent, established_on, expires_on)
PATCH /api/forum/subgroups/<slug>/update/                  (udvidet: + parent, established_on, expires_on, is_active)
```

### Architectural decisions

- **Node = forumgruppe (Arkitektur A).** Strukturen lever på `Subgroup`, så forum-integrationen er gratis. Matcher ønsket "en forumgruppe skal kunne have forælder og børn".
- **Forælder/barn er soft — kun navigation/struktur, ikke rettigheds-cascade.** Privathed forbliver per gruppe (`allows_members`/`members_only`). Videreført bevidst fra `bugs/11`.
- **Organ-typer oprettes kun i Django admin; arbejdsgrupper/almindelige grupper oprettes i app'en af alle.** Sletning kun i Django admin. Intet leder/delegerings-koncept (eksplicit fravalgt).
- **Arkivering = `is_active=False`** skjuler fra både overblik og forum-liste som standard, med opt-in toggle begge steder. Direkte URL virker stadig.
- **Én sandhed for "er det et udvalg": `group_type`.** `is_committee` fjernes helt (lille blast radius).
- **`include_inactive`-defaults til `false`** så hverken overblik eller forum vokser ukontrolleret over tid.

### Schema changes

- `Subgroup`: + `group_type` (char, default `almindelig`), + `parent` (self-FK, nullable), + `established_on` (date, nullable), + `expires_on` (date, nullable), + `is_active` (bool, default `True`); − `is_committee`.
- Data-migrations: `is_committee`→`group_type`-mapping; opret Generalforsamling+Fællesmøde + bagudfyld abonnementer.

## Testing Decisions

Test observerbar adfærd via endpoints/UI, ikke interne helpers.

**Backend (`apps/forum/tests.py`):**
- Cykel afvises (sæt en gruppes forælder til en efterkommer → fejl).
- Forælder-type-regler: `ALMINDELIG` med forælder afvises; `ARBEJDSGRUPPE` med `ALMINDELIG`-forælder afvises; `ARBEJDSGRUPPE` under organ og under anden arbejdsgruppe accepteres.
- Ikke-staff kan oprette `ARBEJDSGRUPPE`/`ALMINDELIG` men ikke organ-typer.
- `is_active=False` udelades fra `/organisation/` og fra `/subgroups/` som standard; med `include_inactive`/`include_archived` inkluderes de.
- `/organisation/` returnerer rødder i korrekt fast rækkefølge og nester arbejdsgrupper rekursivt (inkl. ≥2 niveauer).
- Almindelige grupper optræder aldrig i `/organisation/`.
- Strukturredigering af en arbejdsgruppe tillades for ikke-medlem; af et organ kun for staff.

**Frontend (Vitest):**
- `/overblik` rendrer organer i rækkefølge og nester børn; "Vis afsluttede"-toggle viser/skjuler inaktive.
- Opret-form: forælder-`Select` vises kun når type = Arbejdsgruppe.
- `ForumPage` "Udvalg"-sektion drives nu af `group_type` (opdater fixtures); arkiverede grupper vises ikke.
- `SubgroupPage` viser forælder-chip og børn-chips.

**Browser-QA (agent-drevet, `claude --chrome`):** efter slice 001–006 køres et end-to-end browsergennemløb af hele funktionen — se `plans/grafisk-overblik/slices/007-browser-qa-pass.md`. Det dækker det Vitest ikke kan se (træ-rækkefølge/foldning, undertræ-skjul-toggle, opret-modalens betingede felter, arkivér/genåbn-runde, organ-redigerings-tilladelsen) og lægger en blivende "Grafisk overblik"-sektion i `MANUAL_TEST_GUIDE.md`.

## Out of Scope

- **Leder/delegerings-rettigheder** (udvalgsleder/bestyrelsesleder som permission-rolle). Bevidst fravalgt — alle medlemmer opretter/redigerer. Kan tilføjes senere som `SubgroupMembership.is_leader`.
- **Sletning og organ-oprettelse i app-UI** — forbliver Django admin.
- **Rettigheds-/synligheds-cascade ned ad hierarkiet** — forælder/barn er kun struktur.
- **Auto-flytning af eksisterende arbejdsgrupper ind under organer** — admins/brugere sætter forælder manuelt efter deploy.
- **Et "ansøg om at oprette under organ X"-flow** — oprettelse er fri.
- **Ægte boks-og-streg SVG-diagram** — vi bruger Mantine `Tree` (responsivt, mobil-først). Kan opgraderes visuelt senere.

## Further Notes

- **Faser, én udrulning.** Fase 1: model + migrations + de to nye organer + `/overblik` læse-visning + `is_committee`-oprydning. Fase 2: opret/redigér/afslut-flows + forælder-vælger + `SubgroupPage`-chips. Bygges som adskilte PR-store bidder, men udrulles samlet.
- **Migrations skal landes sekventielt, ikke parallelt.** Slice 003 (parent) og 004 (lifecycle-felter) tilføjer begge kolonner til `Subgroup` ovenpå slice 001's sidste migration. Kører de på hver sin branch samtidig, får man to leaf-migrations med samme forælder → migration-konflikt. Derfor er 004 nu **blokeret af 003** (jf. konventionen i `plans/README.md`: felter på samme model landes sekventielt for at undgå både migration- og fil-konflikter).
- **Bagudfyld abonnementer eksplicit.** `is_default` dækker kun nye brugere; de ~90 nuværende skal bagudfyldes som i `0041`.
- **Rapportér tilbage på prod-tråden** (se top) når funktionen er landet, og bekræft designet over for HC/Bestyrelsen hvis det afviger.
- **Skala.** ~90 brugere, få organer/grupper — `/organisation/` kan trygt bygge hele træet i ét request uden paginering eller caching.
- **`is_committee`-blast radius (verificeret):** `models.py` (felt + ordering), `serializers.py` (felt), `ForumPage.tsx` (gruppering), `types/index.ts` (felt), `conftest.py:280`, `tests.py` (49-50, 626, 1671), `seed_forum_subgroups.py` (143/166/190). Alt skal migreres til `group_type`.
