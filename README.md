# Verbruik thuis

Een PWA die het stroom- en gasverbruik van thuis toont: vergelijking met vorige jaren, maandpiek,
gas per uur en de kosten per maand. Je laadt de CSV-exports uit Mijn Fluvius in de app; die rekent
alles in je browser uit en bewaart het in je eigen Firestore-database.

Er staat geen verbruiksdata in deze repo. Alles zit achter een Google-login in Firebase.

## Instellen (eenmalig)

1. **Firebase-project**: maak er een in de [Firebase console](https://console.firebase.google.com/) (of gebruik een bestaand project).
2. **Authentication** → Sign-in method → **Google** inschakelen.
   Bij Settings → Authorized domains: `robpoluspxl.github.io` toevoegen.
3. **Firestore Database** aanmaken (productiemodus, regio `europe-west1`) en bij **Regels** de inhoud van
   [`firestore.rules`](firestore.rules) plakken en publiceren.
4. Projectinstellingen → Je apps → **Web-app** toevoegen en de `firebaseConfig` overnemen in
   [`firebase-config.js`](firebase-config.js).
5. **GitHub Pages**: repo-instellingen → Pages → Deploy from a branch → `main` / `(root)`.

De app staat dan op `https://robpoluspxl.github.io/verbruik-dashboard/`. Op je gsm: openen in Chrome →
menu → *Toevoegen aan startscherm*.

## Maandelijks bijwerken

In de app onder **Gegevens** de exports uit Mijn Fluvius kiezen:

- stroom: **kwartiertotalen** (geeft verbruik per dag en de maandpiek)
- gas: **dagtotalen**, en **uurtotalen** voor de grafiek per uur

Dubbele dagen worden overschreven, dus een export die overlapt met vorige maand is geen probleem.

## Kosten

De kosten worden per dag berekend in [`js/kosten.js`](js/kosten.js):

- energieprijs volgens de tariefkaart van het contract dat die dag liep ([`js/tarieven.js`](js/tarieven.js))
- maandelijkse beursindex Belpex RLP / TTF RLP ([`js/indexen.js`](js/indexen.js))
- nettarieven Fluvius Limburg per jaar, capaciteitstarief op het rollend gemiddelde van de maandpieken
- heffingen volgens de geldende periode

Elke maand komt er een indexwaarde bij in `js/indexen.js`. Bij een nieuw contract een regel in
`CONTRACTEN` toevoegen.

## Lokaal testen

`demo-data.json` (niet in git) met maanddocumenten in de map zetten en de app openen met `?demo`.
