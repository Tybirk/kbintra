# Vilkår for lån af bil i delebilparken

Version: 2026-08-07

<!--
Dette er den eneste kilde til vilkårene. Appen læser filen direkte, så en
rettelse her ændrer både det låneren ser før en forespørgsel, det ejeren
accepterer når bilen meldes ind, og teksten i notifikationer.

Regler for filen:

- `Version:` skal være en dato på formen ÅÅÅÅ-MM-DD. Ret den når vilkårene
  ændres på en måde folk bør se igen. Hver bil gemmer hvilken version ejeren har
  accepteret, så en ny dato betyder at ejerne skal acceptere på ny, før deres
  biler igen kan lånes. Ret derfor ikke datoen for en kommatering.
- Teksten er delt i afsnit. Et afsnit indledes med "## Overskrift" og indeholder
  brødtekst, punkter ("- ") eller begge. Rækkefølgen bevares.
- Et punkt eller et afsnit må gerne fortsætte på næste linje.
- Fed skrift i starten af et punkt ("- **Sådan:** resten") vises som en
  fremhævet indledning. Fed skrift midt i en sætning vises som almindelig tekst.
- Vilkårene nævner med vilje ingen km-takst. Taksten kan være forskellig fra bil
  til bil, og ét tal i en fælles tekst ville kunne modsige det lånerens egen bil
  koster. Beløbet står på bilkortet og i afregningen, hvor bilen er kendt.
- Beløbene i punkt 5 hænger sammen: 6.000 kr. for selvrisikoen plus 3.000 kr.
  for tab af skadefri år er præcis loftet på 9.000 kr. Ændrer du ét af dem,
  skal de andre to følge med, ellers kan en låner komme til at skylde mere end
  loftet lover.

Filen ligger i backend'en fordi den skal med i serverimaget.
`docs/bildeling-vilkaar.md` er et symlink hertil, så der kun findes én tekst.
-->

## Kort fortalt

Du er ansvarlig for bilen, mens du har den. Sker der noget, siger du det med det
samme. Ved skade betaler du ejerens selvrisiko, dog højst 6.000 kr. — er bilen
uden kasko, betaler du reparationen. Koster skaden ejeren skadefri år, betaler du
3.000 kr. oveni. Uanset hvad er dit samlede ansvar højst 9.000 kr. pr. lån.
Bøder og afgifter er dine.
Du betaler en forudbestemt takst pr. kørt km, minus hvad du selv har
lagt ud til strøm eller brændstof.

## 1. Hvem aftalen er mellem

Et lån er en privat aftale mellem dig (låneren) og den husstand der ejer bilen
(ejeren). Foreningen og appen formidler kontakten og regner beløbet ud, men er
ikke part i aftalen og hæfter ikke for skader, tab eller udgifter.

Når du sender en forespørgsel, accepterer du de vilkår der vises i appen på det
tidspunkt. Den version gemmes på lånet, og det er den der gælder for netop det
lån — også hvis vilkårene ændres bagefter.

## 2. Hvem må køre bilen

- Kun du, der har lånt bilen, må køre den. Skal andre køre, skal ejeren sige ja
  først.
- Du skal have et kørekort til bilen, der er gyldigt i Danmark og hverken
  betinget, inddraget eller frakendt.
- Er du under 25 år, har mange forsikringer en ekstra selvrisiko. Spørg ejeren,
  inden du kører.
- Du må ikke køre, hvis du er påvirket af alkohol, medicin eller andet, eller er
  for træt til at køre sikkert.

## 3. Sådan bruger du bilen

- Kør forsigtigt, følg færdselsloven, og aflever bilen til aftalt tid, ryddet op
  og i samme stand som du fik den. Sæt elbilen til at lade, hvis den er under 50 %.
- Overhold de vilkår ejeren oplyser om bilen og dens forsikring.
- Bilen må ikke bruges til: erhvervsmæssig kørsel (herunder mad- og
  pakkeudbringning og taxikørsel), motorsport, bane- eller terrænkørsel,
  videreudlån, træk af mere end bilen er godkendt til, eller kørsel uden for
  Danmark uden ejerens ja på forhånd. Flere af tingene kan koste dækningen på
  ejerens forsikring, og så står du med hele regningen (punkt 5).
- Dyr kun hvis det står i bilens beskrivelse.
- Autostol til børn og andet du har brug for, sørger du selv for.
- Dine egne ting i bilen er ikke forsikret.

## 4. Sker der noget

- Skriv eller ring til ejeren med det samme — også ved småting, og også hvis
  noget bare ikke virker som det skal.
- Ved uheld med andre implicerede: udfyld skadesanmeldelse på stedet, tag
  billeder, og tilkald politiet ved personskade, uenighed, eller hvis en fører
  ikke har gyldigt kørekort.
- Tag billeder af bilen både når du henter den og når du afleverer den, og behold
  dem — I deler dem kun, hvis der bliver brug for dem. Skader som ejeren gør dig
  opmærksom på senest 24 timer efter aflevering, regnes som opstået under lånet,
  medmindre billederne viser andet. Derefter er de ejerens.
- Det er ejeren der beslutter, om en skade skal anmeldes til forsikringen. Det er
  deres police.

## 5. Hvad du betaler, hvis der er sket skade

- **Er bilen kaskoforsikret, og anmeldes skaden:** du betaler ejerens selvrisiko,
  dog højst 6.000 kr. Er selvrisikoen højere end det, bærer ejeren resten.
- **Anmeldes skaden ikke:** du betaler de dokumenterede reparationsudgifter, dog
  højst det selvrisikoen ville have været og aldrig over 6.000 kr.
- **Er bilen ikke kaskoforsikret:** du betaler de dokumenterede
  reparationsudgifter, dog højst 9.000 kr. Ejeren oplyser inden lånet, at bilen
  er uden kasko (punkt 9). Skader på andre biler, ting og personer er dækket af
  den lovpligtige ansvarsforsikring, uanset om bilen har kasko.
- **Tab af skadefri år:** påvirker skaden ejerens præmie, betaler du 3.000 kr.
  som fuld og endelig dækning af den højere præmie fremover. Der gøres ikke krav
  op derudover. Beløbet betales ikke, hvis skaden ikke påvirker præmien — fx
  fordi policen har bonusbeskyttelse, eller fordi det er en rude- eller
  friskade, der efter ejerens police ikke koster skadefri år.
- **Loft:** dit samlede ansvar for ét lån er højst 9.000 kr., uanset hvordan
  beløbet er sammensat, og uanset om bilen har kasko. Alt derover bærer ejeren —
  det er den risiko, der følger med at melde sin bil i delebilparken. Er bilen
  uden kasko, er der ingen forsikring til at dække resten, og det ejeren bærer,
  er hele skaden over de 9.000 kr. Det er en beslutning, ejeren træffer bevidst
  ved at melde bilen ind uden kasko.
- **Loftet gælder ikke,** hvis du har handlet forsætligt eller groft uagtsomt
  (fx spirituskørsel, grov hastighedsovertrædelse, kørsel uden gyldigt kørekort),
  eller har brugt bilen i strid med punkt 2 eller 3. Så hæfter du for ejerens
  fulde tab, herunder hvis forsikringen nedsætter eller nægter dækning eller
  kræver beløbet tilbage fra dig.
- **Uanset loftet betaler du** dokumenterede udgifter til fejltankning eller
  forkert ladning, tabt eller ødelagt nøgle, ladebrik, ladekabel og tilbehør.
- **Almindeligt slid og mekanisk svigt,** der ikke skyldes din brug, er ejerens —
  også vejhjælp og reparation. Skyldes driftsstoppet din brug (kørt tom for
  strøm, fejltankning, punktering mod en kantsten), betaler du.
- **Ingen af jer** kan kræve erstatning af den anden for følgetab: aflyst tur,
  taxa, mistet arbejdstid, værditab ud over ovenstående. Vi er naboer, ikke et
  udlejningsfirma.

## 6. Bøder og afgifter

- Bøder, parkeringsafgifter, kontrolafgifter, bro- og færgeafgifter og
  administrationsgebyrer for kørsel i din låneperiode betaler du — også når de
  først dukker op måneder senere.
- Du accepterer, at ejeren oplyser dit navn og din adresse som fører til politi,
  parkeringsselskab eller myndighed, når der bliver spurgt.
- Klip i kørekortet og andre personlige følger er dine.

## 7. Betaling

- Du dækker ejerens omkostninger med en fastsat takst pr. kørt kilometer. Satsen er
  fastsat som deling af de faktiske omkostninger ved at holde bilen (afskrivning,
  forsikring, service, dæk, afgift og strøm) og indeholder ingen fortjeneste. Der
  er ikke tale om leje.
- Kilometre opgøres efter bilens kilometertæller. Du oplyser forskellen mellem
  start og slut når du afslutter lånet.
- Der ligger en ladebrik i bilen, som virker de fleste steder, og strøm via
  brikken er med i satsen. Har du haft udgifter til strøm eller brændstof
  derudover, skriver du beløbet ind når du afslutter lånet — det trækkes fra din
  betaling. Gem kvitteringen. Bliver beløbet negativt, skylder ejeren dig.
- Beløbet betales til ejeren senest 7 dage efter lånet er afsluttet. Beløb
  efter punkt 5 betales senest 14 dage efter ejeren har dokumenteret udgiften.
- Kun du kan afslutte lånet i appen. Gør du det ikke, gør ejeren beløbet op
  mellem jer ud fra kilometertælleren.

## 8. Aflysning, forsinkelse og tilbagekaldelse

- Aflys i appen så snart du ved det.
- Ejeren kan aflyse et lån, indtil det er startet. Efter start kan ejeren bede om
  bilen tilbage ved et akut behov, og så afleverer du den, så snart det er sikkert
  og rimeligt muligt.
- Kan du ikke aflevere til tiden, skriver du til ejeren med det samme.

## 9. Ejerens pligter

En bil i delebilparken skal være indregistreret, ansvarsforsikret, synet og i
lovlig, køreklar stand med årstidsrigtige dæk. Kasko er ikke et krav. Ejeren
oplyser kendte fejl og mangler, om bilen har kasko og med hvilken selvrisiko, og
hvor nøgle og ladebrik ligger, inden lånet starter. Uden de oplysninger kan du
ikke vide, hvad punkt 5 betyder for netop den bil.

## 10. Hvis I bliver uenige

Tal først sammen. Kan I ikke blive enige, kan I bede bilgruppen om at mægle.
Aftalen er underlagt dansk ret.

## 11. Ændringer

Vilkårene kan ændres af fællesmødet. Ændringer gælder for lån, der oprettes
efter ændringen — for et igangværende lån gælder den version, der er gemt på det.
