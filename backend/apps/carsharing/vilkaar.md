# Vilkår for lån af bil i delebilparken

Version: 2026-08-05

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
- `{rate}` erstattes af den gældende km-takst (bilens egen, ellers
  fællesskabets standardsats). Andre pladsholdere findes ikke.
- Baggrunden for teksten — hvorfor beløbene ser ud som de gør, og hvad der
  stadig mangler i koden — står i `docs/bildeling-vilkaar-baggrund.md`. Den er
  med vilje ikke en del af vilkårene og læses ikke af appen.

Filen ligger i backend'en fordi den skal med i serverimaget.
`docs/bildeling-vilkaar.md` er et symlink hertil, så der kun findes én tekst.
-->

## Kort fortalt

Du er ansvarlig for bilen, mens du har den. Sker der noget, siger du det med det
samme. Ved skade betaler du ejerens selvrisiko (står på bilens side) plus 3.000
kr. for ejerens tab af skadefri år — dog samlet højst 8.000 kr. pr. lån. Bøder
og afgifter er dine. Du betaler {rate} kr. pr. kørt km, minus hvad du selv har
lagt ud til strøm.

## 1. Hvem aftalen er mellem

Et lån er en privat aftale mellem dig (låneren) og den husstand der ejer bilen
(ejeren). Foreningen og appen formidler kontakten og regner beløbet ud, men er
ikke part i aftalen og hæfter ikke for skader, tab eller udgifter.

Når du sender en forespørgsel, accepterer du de vilkår der vises i appen på det
tidspunkt. Den version gemmes på lånet, og det er den der gælder for netop det
lån — også hvis vilkårene ændres bagefter.

## 2. Hvem må køre bilen

- Kun du, der har lånt bilen, må køre den. Skal andre køre, skal ejeren sige ja
  først — skriv det i lånets tråd, så det står et sted.
- Du skal have et kørekort til bilen, der er gyldigt i Danmark og hverken
  betinget, inddraget eller frakendt, og du skal have haft det i mindst 2 år.
- Er føreren under 25 år, har mange forsikringer en ekstra selvrisiko. Spørg
  ejeren, inden du kører.
- Du må ikke køre, hvis du er påvirket af alkohol, medicin eller andet, eller er
  for træt til at køre sikkert.

## 3. Sådan bruger du bilen

- Kør forsigtigt, følg færdselsloven, og aflever bilen til aftalt tid, ryddet op
  og i samme stand som du fik den — og med mindst den ladestand eller tankstand
  du fik den med.
- Overhold de vilkår ejeren oplyser om bilen og dens forsikring.
- Bilen må ikke bruges til: erhvervsmæssig kørsel (herunder mad- og
  pakkeudbringning og taxikørsel), motorsport, bane- eller terrænkørsel,
  videreudlån, træk af mere end bilen er godkendt til, eller kørsel uden for
  Danmark uden ejerens ja på forhånd. Flere af tingene kan koste dækningen på
  ejerens forsikring, og så står du med hele regningen (punkt 5).
- Rygning og dyr kun hvis det står i bilens beskrivelse.
- Autostol til børn og andet du har brug for, sørger du selv for.
- Dine egne ting i bilen er ikke forsikret.

## 4. Sker der noget

- Skriv eller ring til ejeren med det samme — også ved småting, og også hvis
  noget bare ikke virker som det skal.
- Ved uheld med andre implicerede: udfyld skadesanmeldelse på stedet, tag
  billeder, og tilkald politiet ved personskade, uenighed, eller hvis en fører
  ikke har gyldigt kørekort.
- Tag billeder af bilen både når du henter den og når du afleverer den, og læg
  dem i lånets tråd. Skader som ejeren gør dig opmærksom på senest 24 timer
  efter aflevering, regnes som opstået under lånet, medmindre billederne viser
  andet. Derefter er de ejerens.
- Det er ejeren der beslutter, om en skade skal anmeldes til forsikringen. Det er
  hendes police.

## 5. Hvad du betaler, hvis der er sket skade

- **Anmeldes skaden:** du betaler ejerens selvrisiko. Beløbet står på bilens side
  i appen, så du kender det, inden du låner.
- **Anmeldes skaden ikke:** du betaler de dokumenterede reparationsudgifter, dog
  højst det selvrisikoen ville have været.
- **Tab af skadefri år:** påvirker skaden ejerens præmie, betaler du 3.000 kr.
  som fuld og endelig dækning af den højere præmie fremover. Der gøres ikke krav
  op derudover. Beløbet betales ikke, hvis skaden ikke påvirker præmien — fx
  fordi policen har bonusbeskyttelse, eller fordi det er en rude- eller
  friskade, der efter ejerens police ikke koster skadefri år.
- **Loft:** dit samlede ansvar for ét lån er højst 8.000 kr. Alt derover bærer
  ejeren — det er den risiko, der følger med at melde sin bil i delebilparken.
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

- Du dækker ejerens omkostninger med {rate} kr. pr. kørt kilometer. Satsen er
  fastsat som deling af de faktiske omkostninger ved at holde bilen (afskrivning,
  forsikring, service, dæk, afgift og strøm) og indeholder ingen fortjeneste. Der
  er ikke tale om leje.
- Kilometre opgøres efter bilens kilometertæller. Du oplyser standen ved start og
  ved slut, når du afslutter lånet.
- Der ligger en ladebrik i bilen, som virker de fleste steder, og strøm via
  brikken er med i satsen. Har du haft udgifter til strøm eller brændstof
  derudover, skriver du beløbet ind når du afslutter lånet — det trækkes fra din
  betaling. Gem kvitteringen. Bliver beløbet negativt, skylder ejeren dig.
- Beløbet betales til ejeren senest 7 dage efter lånet er afsluttet. Beløb
  efter punkt 5 betales senest 14 dage efter ejeren har dokumenteret udgiften.
- Afslutter du ikke lånet i appen, kan ejeren gøre det op selv ud fra
  kilometertælleren.

## 8. Aflysning, forsinkelse og tilbagekaldelse

- Aflys i appen så snart du ved det.
- Ejeren kan aflyse et lån, indtil det er startet. Efter start kan ejeren bede om
  bilen tilbage ved et akut behov, og så afleverer du den, så snart det er sikkert
  og rimeligt muligt.
- Kan du ikke aflevere til tiden, skriver du til ejeren med det samme.

## 9. Ejerens pligter

En bil i delebilparken skal være indregistreret, forsikret, synet og i lovlig,
køreklar stand med årstidsrigtige dæk. Ejeren oplyser kendte fejl og mangler,
bilens selvrisiko og hvor nøgle og ladebrik ligger, inden lånet starter.

## 10. Hvis I bliver uenige

Tal først sammen. Kan I ikke blive enige, kan I bede bilgruppen om at mægle.
Aftalen er underlagt dansk ret.

## 11. Ændringer

Vilkårene kan ændres af fællesmødet. Ændringer gælder for lån, der oprettes
efter ændringen — for et igangværende lån gælder den version, der er gemt på det.
