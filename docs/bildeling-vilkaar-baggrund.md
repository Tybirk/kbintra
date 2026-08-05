# Baggrund for vilkårene

Ikke en del af vilkårene. Baggrund for den der senere skal vedligeholde teksten,
og for den næste diskussion på et fællesmøde.

Vilkårene selv står i [bildeling-vilkaar.md](bildeling-vilkaar.md) (et symlink
til `backend/apps/carsharing/vilkaar.md`, som appen læser direkte). De beløb der
tidligere stod i `[firkantede parenteser]` som forslag, står nu som gældende
tekst: 3.000 kr. for tab af skadefri år, 8.000 kr. som loft, 24 timer til at
gøre en skade gældende, 7 og 14 dages betalingsfrist, mindst 2 års
kørekortanciennitet, Danmark som geografisk grænse, bilgruppen som mægler og
fællesmødet som den der kan ændre vilkårene.

## Om bonustabet

Vi valgte et **fast beløb** frem for at gøre ejerens faktiske merpræmie op. Det
er ikke fordi et fast beløb er mere retfærdigt, men fordi alternativet kræver at
ejeren beder selskabet om en beregning og at nogen følger op i 3–5 år. Det sker
ikke i praksis, og så ender tabet alligevel hos ejeren — bare med dårlig stemning
oveni.

Prisen for den forenkling er, at beløbet næsten altid er lidt forkert. Skønnet
bag 3.000 kr.:

- En anmeldt kaskoskade flytter typisk ejeren flere trin ned på skadefri-år-stigen,
  og man vinder ét trin tilbage pr. skadefrit år. Merpræmien betales altså i
  2–4 år, faldende.
- Med en fuld forsikring i omegnen af 6.000–12.000 kr./år og en stigning på
  15–30 % giver det groft 1.500–3.000 kr. det første år og et samlet tab i
  størrelsesordenen 3.000–6.000 kr.
- 1.500 kr. dækker altså cirka det første år. 3.000 kr. rammer den nedre halvdel
  af det samlede tab og lader resten blive hos ejeren.

Tallene varierer nok mellem selskaber til at de bør efterprøves. **Den præcise
metode er én telefonopringning:** spørg selskabet "hvis jeg anmelder en
kaskoskade på 20.000 kr., hvad betyder det for min præmie de næste fem år?".
Gør det for to eller tre repræsentative biler i delebilparken og brug medianen.

To ting, der ændrer billedet helt:

- **Bonusbeskyttelse.** Flere selskaber sælger en tilvalgsdækning, hvor én skade
  ikke koster skadefri år. Har en bil den, findes bonustabet ikke — derfor
  sætningen i punkt 5 om at beløbet ikke betales, når præmien ikke påvirkes. Det
  kan være billigere for delebilparken at betale for den dækning på de biler der
  er med, end at diskutere bonustab bagefter.
- **Opsigelse.** To skader inden for kort tid kan få selskabet til at opsige
  policen, og så lander ejeren i en væsentligt dyrere tarif. Det tab ligger langt
  over ethvert fast beløb, og loftet i punkt 5 lader det bevidst blive hos
  ejeren. Det bør siges højt på fællesmødet, for det er den reelle risiko ved at
  melde sin bil i delebilparken.

Hvis der faktisk kommer skader, er næste skridt en **fælles skadespulje**:
satsen forhøjes fx 0,15 kr./km til en kasse, der dækker selvrisiko og bonustab,
og låneren betaler kun et lille fast beløb. Det kræver en kasse, en kasserer og
en beslutning om hvad der sker når puljen er tom — derfor ikke nu.

## Om ansvaret for skader

Efter erstatningsansvarsloven § 19, stk. 1 bortfalder skadevolderens
erstatningsansvar i det omfang skaden er dækket af en tingsforsikring.
Konsekvensen er, at en låner der laver en bule ved almindelig uagtsomhed som
udgangspunkt **ikke** hæfter — heller ikke for selvrisikoen — når kaskoen dækker.
Undtagelsen er forsæt og grov uagtsomhed, stk. 2.

Punkt 5 er derfor ikke en beskrivelse af retstilstanden, men en aftale, der skal
indgås for at gælde. Det stiller tre krav:

1. Låneren skal **aktivt acceptere** — afkrydsning med gemt tidsstempel, ikke
   blot at teksten var på skærmen.
2. Beløbene skal være **kendte før lånet**. Derfor skal selvrisikoen stå på
   bilen, ikke i en police låneren ikke har set.
3. Bonustabet skal nævnes eksplicit. Det er ikke dækket af forsikringen og falder
   derfor ikke bort efter § 19 — men uden en aftale om det findes kravet ikke.

Loftet er ikke kun venlighed: et åbent, potentielt stort ansvar kan lempes efter
erstatningsansvarslovens § 24 og risikerer at blive tilsidesat efter aftalelovens
§ 36. Et loft er både mere naboligt og mere holdbart end et ubegrænset krav.

Ordet "leje" bruges bevidst ikke nogen steder, og satsen omtales som deling af
faktiske omkostninger uden fortjeneste. Få det bekræftet af et
forsikringsselskab, inden ordningen sættes i drift.

Punkt 5 er det eneste sted, hvor et forkert ord koster penge. Overvej at få en
jurist i foreningen — eller en times betalt rådgivning — til at læse netop det
punkt.

## Afhængigheder i koden

Vilkårene forudsætter tre ting. Status pr. 2026-08-05:

| Hvad | Hvorfor | Status |
|---|---|---|
| `insurance_deductible` på `houses.Car`, vist på bilkortet | Punkt 5 hænger på det — en ukendt selvrisiko kan låneren ikke binde sig til | **Mangler.** Punkt 5 siger "Beløbet står på bilens side i appen", og det gør det endnu ikke |
| Afkrydsning med gemt tidsstempel | Forskellen mellem "teksten blev vist" og "låneren satte kryds" er hele bevisværdien | **På plads.** `CarLoan.terms_version` gemmer den accepterede version, og `created_at` er tidsstemplet. `Car.terms_accepted_version` + `terms_accepted_at` gør det samme for ejeren |
| `start_km` / `end_km` frem for kun `actual_km` | Kilometertællerstand kan efterprøves; et husket tal kan ikke. `actual_km` bliver differencen | **Mangler.** Punkt 7 siger "Du oplyser standen ved start og ved slut", men appen beder kun om de kørte kilometer |

De to manglende punkter er den vigtigste opgave, hvis vilkårene skal kunne stå
for en reel uenighed. Se `bildeling-plan.md`.
