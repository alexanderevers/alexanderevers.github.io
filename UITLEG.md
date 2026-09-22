# Icesights: testen draaien en instelbare waarden

Deze pagina is de Nederlandse, niet-technische versie van twee dingen: hoe je de automatische controles ("tests") draait, en waar in de bestanden de getallen en instellingen staan die je zou kunnen willen aanpassen (bijvoorbeeld "vanaf hoeveel renners is het een marathon" of "hoe lang blijft iemand in de lijst staan"). Je hoeft geen JavaScript te kunnen lezen om dit te gebruiken: elke instelling hieronder staat met de exacte naam waarop je kunt zoeken (Ctrl+F, of "zoeken in bestand" in je editor), en een uitleg in gewone taal van wat hij doet.

Voor uitleg van wat de site doet en hoe alles samenhangt: zie [README.md](README.md) en [DOCUMENTATION.md](DOCUMENTATION.md) (Engels, technisch, maar dat is de volledige referentie).

## Inhoud

1. [Tests draaien](#1-tests-draaien)
2. [Eén testbestand of één test draaien](#2-één-testbestand-of-één-test-draaien)
3. [Wat te doen als een instelling niet meer klopt met een test](#3-wat-te-doen-als-een-instelling-niet-meer-klopt-met-een-test)
4. [Instelbare waarden: live- en marathonpagina (`live-model.js`)](#4-instelbare-waarden-live--en-marathonpagina-live-modeljs)
5. [Instelbare waarden: live- en marathonpagina, weergave (`live.js`)](#5-instelbare-waarden-live--en-marathonpagina-weergave-livejs)
6. [Instelbare waarden: replay-pagina (`replay-model.js`)](#6-instelbare-waarden-replay-pagina-replay-modeljs)
7. [Instelbare waarden: ophalen van data (`api.js`)](#7-instelbare-waarden-ophalen-van-data-apijs)
8. [Instelbare waarden: persoonlijke records (`records.js`, `history-store.js`)](#8-instelbare-waarden-persoonlijke-records-recordsjs-history-storejs)
9. [Instelbare waarden: het tussenstation bij Cloudflare (`cloudflare-worker/src/index.js`)](#9-instelbare-waarden-het-tussenstation-bij-cloudflare-cloudflare-workersrcindexjs)
10. [Instelbare waarden: installeerbare app (`sw.js`)](#10-instelbare-waarden-installeerbare-app-swjs)
11. [Iets aanpassen: het hele stappenplan](#11-iets-aanpassen-het-hele-stappenplan)

---

## 1. Tests draaien

Open een terminal (Opdrachtprompt, PowerShell, Git Bash of Terminal) in de hoofdmap van het project (de map met `package.json` en `index.html`). Gebruik op Windows in PowerShell `npm.cmd` in plaats van `npm` als je de melding "running scripts is disabled" krijgt.

Er zijn drie soorten controles:

```
npm test               # snelle controles van losse stukjes code (± 1,5 s)
npm run test:worker    # controles van het tussenstation bij Cloudflare (± 2 s)
npm run test:e2e       # een echte, onzichtbare browser klikt door de hele site heen (± 10-15 s)
```

En één die de eerste twee combineert:

```
npm run test:all       # test + test:worker samen (start geen browser)
```

**Wat je ziet als alles goed gaat:**

```
npm test
  ...
  # tests 248
  # suites 57
  # pass 248
  # fail 0
```
`pass 248` en `fail 0` betekent: 248 controles geslaagd, 0 mislukt. Zolang `fail` op 0 staat, is alles in orde. Het exacte aantal (`248`) loopt op naarmate er meer functionaliteit bijkomt; dat is normaal.

```
npm run test:worker
  ...
  ALL PASS
```

```
npm run test:e2e
  ...
  ALL PASSED
```
Bij deze twee is de laatste regel (`ALL PASS` / `ALL PASSED`) het enige dat telt. Zie je in plaats daarvan een regel die begint met `FAIL`, dan staat daaronder direct een korte uitleg wat er misging.

**Voor `test:e2e` heb je Chrome, Edge of Chromium nodig** (geen aparte installatie: als je Chrome of Edge al hebt, wordt die automatisch gevonden). Wordt er geen browser gevonden, geef dan het pad ernaartoe op:

```
# PowerShell
$env:CHROME_PATH = "C:\Pad\naar\msedge.exe"; npm run test:e2e

# Git Bash
CHROME_PATH="/pad/naar/chrome" npm run test:e2e
```

Er is ook een kortere variant die alleen de live/marathon-browsertest draait (sneller dan de volledige `test:e2e`):

```
npm run test:e2e:live
```

## 2. Eén testbestand of één test draaien

Als je aan het testen van één specifiek onderdeel bent (bijvoorbeeld alleen de marathon-berekeningen), hoef je niet steeds alles te draaien.

**Eén bestand met snelle controles:**
```
node --test tests/unit/live-model.test.js
```
(vervang de bestandsnaam door een ander bestand uit de map `tests/unit/`, zoals `api.test.js` of `overlap-sort.test.js`.)

**Alleen controles waarvan de naam een bepaald woord bevat** (Node's ingebouwde testrunner ondersteunt dit):
```
node --test --test-name-pattern="marathon" tests/unit/live-model.test.js
```
Dit draait alleen de controles waarvan de beschrijving "marathon" bevat.

**Eén browsertest-bestand:**
```
node tests/e2e/live.e2e.js
```
of
```
node tests/e2e/replay-flow.e2e.js
```

## 3. Wat te doen als een instelling niet meer klopt met een test

Veel van de instellingen hieronder worden door een test gecontroleerd: de test rekent uit "met deze instelling hoort er dit uit te komen" en vergelijkt dat met wat de code echt doet. Verander je zo'n instelling met de hand, dan gaat die test waarschijnlijk stuk (`fail` gaat omhoog) — niet omdat er iets kapot is, maar omdat de test nog de oude waarde verwacht.

Twee manieren om hiermee om te gaan:

- **De makkelijke weg:** vertel mij (Claude) welke waarde je wilt veranderen en naar wat. Ik pas de instelling aan, werk de bijbehorende tests bij, draai alle controles opnieuw, en meld je of het nog steeds klopt.
- **Zelf proberen:** verander het getal, draai `npm test`, en lees bij een `FAIL`-melding de tekst die eronder staat — die noemt meestal het bestand, de regel, en wat er verwacht werd tegenover wat er nu uitkwam. Je hoeft de test zelf niet te begrijpen; als het antwoord logisch klinkt bij je nieuwe instelling, mag je de verwachte waarde in het testbestand aanpassen aan de nieuwe.

## 4. Instelbare waarden: live- en marathonpagina (`live-model.js`)

Dit bestand bevat de rekenregels achter de Live-pagina en de Marathon-pagina (niet de opmaak — dat staat in `live.js`, zie hoofdstuk 5). Zoek in het bestand op de naam in **vet** om de regel te vinden.

### Wanneer verdwijnt iemand uit de lijst, wanneer telt hij als "op het ijs"

| Naam | Rond regel | Huidige waarde | Wat hij doet |
|---|---|---|---|
| **`LIVE_WINDOW_MS`** | 10 | 15 minuten | Zolang iemands laatste rondje minder lang dan dit geleden was, blijft hij ergens in de lijst staan (op het ijs of "recent op het ijs"). Daarna verdwijnt hij helemaal. |
| **`LIVE_ACTIVE_MS`** | 12 | 2 minuten | Zolang iemands laatste rondje korter dan dit geleden is, staat hij bij "op het ijs" met een bewegend stipje. Duurt het langer, dan gaat hij naar "recent op het ijs". |

### Hoe vaak nieuwe rondetijden opgehaald worden

| Naam | Rond regel | Huidige waarde | Wat hij doet |
|---|---|---|---|
| **`LIVE_SAFETY_REFRESH_MS`** | 119 | 30 seconden | Ook als er niets bijzonders aan de hand is, wordt elke 30 s toch opnieuw gekeken of er een nieuwe ronde is (voor de zekerheid). |
| **`LIVE_RESTING_REFRESH_MS`** | 121 | 20 seconden | Hoe vaak iemand die stilstaat (rust) opnieuw gecontroleerd wordt. |
| **`LIVE_WAITING_REFRESH_MS`** | 123 | 3 seconden | Hoe vaak iemand die net begonnen is (nog geen eerste rondje) opnieuw gecontroleerd wordt. |
| **`LIVE_DUE_AFTER_MS`** | 126 | 1 seconde | Hoelang er gewacht wordt ná het moment dat een nieuwe rondetijd verwacht wordt, voordat er echt gevraagd wordt (de data van MYLAPS komt met een kleine vertraging binnen). |
| **`LIVE_RETRY_MIN_MS`** / **`LIVE_RETRY_MAX_MS`** | 127-128 | 1,5 - 8 seconden | Als een verwachte rondetijd uitblijft, wordt steeds opnieuw geprobeerd, met een wachttijd die tussen deze twee grenzen ligt. |

### Wanneer wordt een activiteit als marathon herkend (bij "Marathon analysis" op de hoofdpagina)

| Naam | Rond regel | Huidige waarde | Wat hij doet |
|---|---|---|---|
| **`MARATHON_DETECT_BREAK_MS`** | 275 | 2,5 minuut | Een renner telt alleen mee als hij vóór de start minstens zo lang heeft stilgestaan/gewacht. |
| **`MARATHON_DETECT_WINDOW_MS`** | 277 | 5 minuten | Renners die niet binnen dit tijdvenster van elkaar zijn gestart, horen niet bij dezelfde marathon. |
| **`MARATHON_DETECT_MIN_RIDERS`** | 279 | 15 | Minimum aantal renners dat samen moet starten voordat het als marathon telt. |
| **`MARATHON_DETECT_MIN_BREAK_SHARE`** | 281 | 0,3 (30%) | Minimaal dit aandeel van de groep moet zo'n pauze (zie `MARATHON_DETECT_BREAK_MS`) hebben gehad, anders wordt een drukke trainingsavond ten onrechte als marathon gezien. |
| **`MARATHON_DETECT_NEXT_SHARE`** | 284 | 0,75 (75%) | Minimaal dit aandeel van de groep moet één ronde later opnieuw gezamenlijk over de finish komen ("de loze ronde"). |
| **`MARATHON_DETECT_NEXT_WINDOW_MS`** | 285 | 30 seconden | Hoe dicht bij elkaar die renners een ronde later over de finish moeten komen om nog als "samen" te tellen. |

### Rekenregels van de marathon-uitslag zelf (de lijst per ronde)

| Naam | Rond regel | Huidige waarde | Wat hij doet |
|---|---|---|---|
| **`MARATHON_GAP_MS`** | 220 | 5 minuten | Een pauze van minstens zo lang scheidt "opwarmen" van de echte wedstrijd. |
| **`MARATHON_QUIET_MS`** | 222 | 90 seconden | Komt er zo lang niemand meer over de finish, dan wordt de wedstrijd als afgelopen beschouwd. |
| **`MARATHON_SKATE_OUT`** | 225 | 1,3× | Een ronde die minstens dit veel langzamer is dan gebruikelijk, aan het eind van de wedstrijd, wordt gezien als "uitrijden" en telt niet mee als laatste ronde. |
| **`MARATHON_MIN_CROSSINGS`** / **`MARATHON_MIN_LAPS`** | 227-228 | 3 / 5 | Ondergrenzen om te bepalen of een trage slotronde echt "uitrijden" is (te weinig renners of te weinig ronden telt niet). |
| **`MARATHON_MISSED`** | 243 | 1,7× | Een ronde die minstens dit veel langer duurde dan gebruikelijk, wordt gezien als "de tijdmeting heeft deze renner één keer gemist" in plaats van als een hele trage ronde. |
| **`MARATHON_LAP_SHARE`** | 246 | 0,75 | Bepaalt wanneer een nieuwe rondenummer van de hele groep begint (een groepsronde). |
| **`MARATHON_BEFORE_START_MS`** | 333 | 20 seconden | Renners die tot dit lang vóór de starttijd al over de finish kwamen, tellen nog mee als "aan de start". |

### Nauwkeurigheid van de bewegende stipjes op de marathonpagina

| Naam | Rond regel | Huidige waarde | Wat hij doet |
|---|---|---|---|
| **`MARATHON_ESTIMATE_OPTIONS`** | 63 | laatste ronde, geen "afremregel" | Hoe de positie van een stipje tussen twee rondes door geschat wordt, alleen op de marathonpagina (de Live-pagina gebruikt andere, minder scherp afgestelde instellingen). Zie de toelichting direct boven deze regel in het bestand: hier is met echte marathondata uitgerekend welke instelling het dichtst bij de werkelijkheid zit. |
| **`MARATHON_SHOWN_OPTIONS`** | 64 | snel bijsturen (5% van een ronde), snelheid 0,2-3× | Hoe snel een stipje op het scherm zijn geschatte positie "inhaalt" als er een nieuwe, echte rondetijd binnenkomt. |

## 5. Instelbare waarden: live- en marathonpagina, weergave (`live.js`)

Dit bestand tekent de lijst en de baan. De belangrijkste instelbare dingen staan helemaal bovenaan de functie (rond regel 9-35):

| Naam | Wat hij doet |
|---|---|
| **`RINKS`** | De lijst van ijsbanen die je in het keuzemenu ziet, met naam en baanlengte. Wil je een baan toevoegen, dit is de lijst. |
| **`LAP_FETCH_CONCURRENCY`** | Hoeveel renners tegelijk (parallel) bevraagd worden voor nieuwe rondetijden. Hoger = sneller bijgewerkt, maar meer verzoeken tegelijk naar het tussenstation. |
| **`LABELLED_RIDERS`** | Hoeveel renners tegelijk een eigen kleur en initialen op de baan krijgen (de rest is een klein blauw stipje). |
| **`LANE_STEP`**, **`LANES`** | Hoe ver stipjes van renners die naast elkaar rijden, uit elkaar getekend worden op de baan (zodat ze niet overlappen). |
| **`BAND_WIDTH`**, **`MARGIN`** | Tekenafmetingen van de baan zelf (hoe breed de baan getekend wordt, hoeveel ruimte eromheen). |

## 6. Instelbare waarden: replay-pagina (`replay-model.js`)

| Naam | Rond regel | Huidige waarde | Wat hij doet |
|---|---|---|---|
| **`MIN_SKATING_KPH`** | 13 | 8 km/u | Een ronde die langzamer gereden is dan dit, wordt niet als "schaatsen" gezien maar als pauze/stilstand (en telt dus niet mee in bijvoorbeeld de rondetijdenstatistiek). |
| **`LAP_GAP_TOLERANCE_MS`** | 9 | 5 seconden | Hoeveel speling er zit tussen twee rondes voordat ze als "aaneengesloten" gelden in de rondetijdgrafiek. |
| **`GROUP_GAP_MS`** | 86 | 1 seconde | Hoe dicht twee renners na elkaar over de finish moeten komen om als "in dezelfde groep" te tellen (voor "in your group" op de hoofdpagina). |
| **`GROUP_WINDOW_SHARE`** | 88 | 0,25 (een kwart ronde) | Hoe ver voor en na jouw eigen rondje nog gekeken wordt om te bepalen wie er "in jouw groep" zat. |

## 7. Instelbare waarden: ophalen van data (`api.js`)

| Naam | Rond regel | Huidige waarde | Wat hij doet |
|---|---|---|---|
| **`PROXY_BASE_URL`** | 6 | `https://mylaps-proxy.iceskater.workers.dev/api/mylaps` | Het adres van het tussenstation bij Cloudflare waar de site al zijn data ophaalt. Verander dit alleen als het tussenstation zelf verhuist. |
| **`ACTIVITIES_COUNT`** | 9 | 500 | Hoeveel sessies er maximaal per renner worden opgehaald op de hoofdpagina. |
| **`FETCH_RETRIES`** / **`FETCH_RETRY_DELAY_MS`** | 11-12 | 2 pogingen / 500 ms | Hoe vaak een mislukt verzoek opnieuw geprobeerd wordt, en hoe lang er tussen pogingen gewacht wordt. |
| **`FINISHED_AFTER_MS`** | 87 | 15 minuten | Een activiteit die minstens dit lang geleden is afgelopen, wordt als "definitief klaar" beschouwd — dat maakt dat het tussenstation de rondetijden lang mag onthouden (zie ook hoofdstuk 8). |

## 8. Instelbare waarden: persoonlijke records (`records.js`, `history-store.js`)

Deze bestanden horen bij het "Records"-onderdeel op de hoofdpagina (persoonlijke records, lokaal in de browser onthouden). Er is er hier maar één instelling in, maar wel een belangrijk gedrag om te kennen.

| Naam | Bestand | Rond regel | Huidige waarde | Wat hij doet |
|---|---|---|---|---|
| **`RECORDS_FAST_LAP_SHARE`** | `records.js` | 14 | 0,2 (20%) | Bepaalt welk deel van de rondes van een seizoen als "snel" telt voor de grafiek "Fast laps per season": steeds de snelste 20% van dát seizoen (met een minimum van 1 ronde), dus een rustig seizoen wordt niet vergeleken met je beste seizoen ooit. |

**Wat is een "seizoen"?** Ook geen instelbaar getal, maar wel het belangrijkste concept van dit hoofdstuk: een schaatsseizoen loopt van september tot en met april en overspant de jaarwisseling, dus het heeft een naam met twee jaartallen — een ronde in maart 2026 én een ronde in november 2025 horen allebei bij seizoen "25/26" (`seasonOf` in `records.js`). Mei tot en met augustus valt buiten elk seizoen: die rondes tellen nog gewoon mee voor "snelste ronde ooit" en de totalen, maar krijgen geen eigen rij in "Best lap per season" of "Fast laps per season".

**Eén transponder tegelijk per apparaat.** Dit is geen instelbaar getal, maar wel iets om te weten: dit apparaat onthoudt de geschiedenis van maar één transponder tegelijk (`historyOwner` in `history-store.js`). Zoek je op een andere transponder dan degene waarvan al gegevens zijn onthouden, dan verschijnt de knop "Change my transponder" in plaats van de records — die knop wist na een waarschuwing alle opgeslagen gegevens van de vorige transponder. Er is expres geen aparte "wis geschiedenis"-knop meer: wisselen van transponder is de enige manier om opnieuw te beginnen.

## 9. Instelbare waarden: het tussenstation bij Cloudflare (`cloudflare-worker/src/index.js`)

Dit bestand is **niet** onderdeel van de website zelf; het is het losse tussenstation-programma. Een wijziging hier moet je apart online zetten met `npx wrangler deploy` (zie [cloudflare-worker/README.md](cloudflare-worker/README.md) en [README.md](README.md#deploy)) — die knop draai ik normaal niet zonder het eerst aan jou te vragen, omdat dit voor alle bezoekers meteen verandert.

| Naam | Rond regel | Huidige waarde | Wat hij doet |
|---|---|---|---|
| **`LIVE_SECONDS`** | 41 | 1 seconde | Hoelang data die de Live-pagina opvraagt (`?live=1`) onthouden wordt voordat er opnieuw bij MYLAPS gevraagd wordt. |
| Bij `laps:` in **`ENDPOINTS`** | rond 80-93 | 30 dagen (afgeronde activiteit van een eerdere dag) / 1 minuut (van vandaag) / 1 seconde (live) | Hoelang rondetijden onthouden worden, afhankelijk van of de sessie al lang geleden is afgerond. |
| Bij `account:` / `userid:` / `avatar:` | rond 60-70 | 1 dag | Profielgegevens (naam, account) veranderen bijna nooit, dus die worden een hele dag onthouden. |
| Bij `activities:` / `chips:` | rond 74-97 | 2 minuten | De activiteitenlijst van een renner wordt kort onthouden, zodat een nieuwe sessie snel zichtbaar wordt. |
| **`DEFAULT_ALLOWED_ORIGINS`** | 29 | de echte site + `localhost`/`127.0.0.1` op poort 8080 en 5500 | Van welke websites/computers het tussenstation verzoeken accepteert. Test je lokaal op een ander poortnummer, dan moet dat hier (of in `wrangler.toml`) bij, anders krijg je een `403`-foutmelding. |

## 10. Instelbare waarden: installeerbare app (`sw.js`)

| Naam | Wat hij doet |
|---|---|
| **`VERSION`** | Verhoog dit getal (bijvoorbeeld van `v2` naar `v3`) als je de lijst hieronder (`SHELL`) wijzigt, zodat bezoekers die de app al geïnstalleerd hebben de nieuwe versie krijgen in plaats van een verouderde uit hun eigen opslag. |
| **`SHELL`** | De volledige lijst van bestanden die de installeerbare app nodig heeft om zonder internetverbinding te kunnen openen. Voeg je een nieuwe pagina of een nieuw script toe aan de site, dan moet die hier ook bij, anders werkt de app-versie niet meer goed offline. (Er is een test die dit controleert: `tests/unit/pwa.test.js`.) |

## 11. Iets aanpassen: het hele stappenplan

1. Zoek de naam van de instelling op in dit document, en vind hem terug in het genoemde bestand (Ctrl+F op de naam).
2. Verander het getal.
3. Draai `npm test` (en bij een wijziging in `replay-model.js` of iets dat de browsertest raakt, ook `npm run test:e2e`).
4. Zie je `FAIL`-meldingen die precies over jouw wijziging gaan, dan is dat verwacht (hoofdstuk 3) — werk de verwachte waarde in het bijbehorende testbestand bij, of vraag mij dat te doen.
5. Wijziging in een gewoon site-bestand (bijna alles behalve `cloudflare-worker/`)? Dan is `git commit` + `git push` naar `main` genoeg; GitHub Pages werkt zichzelf vanzelf bij.
6. Wijziging in `cloudflare-worker/src/index.js`? Dan is er ook nog `npx wrangler deploy` nodig (zie [README.md](README.md#deploy)) — vraag dit gerust aan mij, maar ik voer dit nooit uit zonder het eerst met je te bevestigen.
