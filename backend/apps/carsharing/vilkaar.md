# Vilkår for lån af bil i delebilparken

Version: 2026-08-04

<!--
Dette er den eneste kilde til vilkårene. Appen læser filen direkte, så en
rettelse her ændrer både det låneren ser før en forespørgsel, det ejeren
accepterer når bilen meldes ind, og teksten i notifikationer.

Regler for filen:

- `Version:` skal være en dato på formen ÅÅÅÅ-MM-DD. Ret den når vilkårene
  ændres på en måde folk bør se igen. Hver bil gemmer hvilken version ejeren har
  accepteret, så en ny dato betyder at ejerne skal acceptere på ny, før deres
  biler igen kan lånes. Ret derfor ikke datoen for en kommatering.
- Ét vilkår pr. punkt, indledt med "- ". Et punkt må gerne fortsætte på næste
  linje.
- `{rate}` erstattes af den gældende km-takst (bilens egen, ellers
  fællesskabets standardsats). Andre pladsholdere findes ikke.
- Ingen overskrifter udover den øverste: UI'et viser punkterne som en simpel
  liste, ikke som formateret Markdown.

Filen ligger i backend'en fordi den skal med i serverimaget.
`docs/bildeling-vilkaar.md` er et symlink hertil, så der kun findes én tekst.
-->

- Du er ansvarlig for bilen, mens du har den. Kør forsigtigt og aflever den i
  samme stand, som du fik den.
- Sker der skade, eller virker noget ikke, giver du ejeren besked med det samme
  — også småting. Udgangspunktet er, at låneren dækker selvrisikoen ved skader
  opstået under lånet.
- Almindeligt slid og mekanisk svigt, der ikke skyldes lånerens brug, er ejerens.
- Bøder, parkerings- og broafgifter betaler du selv.
- Du skal have gyldigt kørekort til bilen.
- Der ligger en ladebrik i bilen, som virker de fleste steder. Har du haft
  udgifter til strøm eller brændstof derudover, skriver du beløbet ind når du
  afslutter lånet — det bliver trukket fra din betaling.
- Prisen er den takst der står på bilen — {rate} kr. pr. kørt km, medmindre
  ejeren har sat sin egen. Du oplyser de faktisk kørte kilometer, når du
  afslutter lånet.
