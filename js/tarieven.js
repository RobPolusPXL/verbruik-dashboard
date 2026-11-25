// Tarieven voor de kostenberekening. Alle bedragen incl. 6% btw tenzij "excl." vermeld.
// Netbeheerder: Fluvius Limburg, digitale meter, gas "gemiddeld verbruik" (> 5.000 kWh/jaar).
// Bronnen: Energie.be-tariefkaarten (okt 2024, okt 2025, maart 2026, okt 2026) en de wet energienorm.

export const BTW = 1.06;

// Vanaf deze datum wordt gerekend. Apr 2025 – mrt 2026 is gecontroleerd met de jaarafrekening;
// jan – mrt 2025 (contract 10/24, nettarieven 2025) nog niet.
export const START = '2025-01-01';

// Energieprijs per contract. Formules zijn excl. btw, index in €/MWh, resultaat in c€/kWh.
export const CONTRACTEN = {
  stroom: [
    { naam: 'Elektriciteit particulier (variabel) 10/24', van: '2024-12-16', tot: '2025-12-15',
      prijs: (i) => (0.1058 * i + 1.2) * BTW },
    { naam: 'Elektriciteit particulier (variabel) 10/25', van: '2025-12-16', tot: '2026-12-15',
      prijs: (i) => (0.112 * i + 0.8) * BTW },
  ],
  gas: [
    { naam: 'Gas particulier (variabel) 10/24', van: '2024-12-16', tot: '2025-12-15',
      prijs: (i) => (0.1010 * i + 0.2) * BTW },
    { naam: 'Gas particulier (variabel) 10/25', van: '2025-12-16', tot: '2026-03-31',
      prijs: (i) => (0.1025 * i + 0.18) * BTW },
    { naam: 'Gas vast particulier online 03/26', van: '2026-04-01', tot: '2027-03-31',
      prijs: () => 4.59, vast: true },
  ],
};

// Vaste vergoeding leverancier (€/jaar), per energiesoort.
export const VASTE_VERGOEDING = 35;

// Nettarieven per kalenderjaar.
export const NET = {
  stroom: {
    2025: { afname: 6.80, capaciteit: 51.81, databeheer: 18.56 },
    2026: { afname: 5.75, capaciteit: 51.99, databeheer: 18.92 },
  },
  gas: {
    2025: { distributie: 0.94, vast: 70.72, transport: 0.1654, databeheer: 18.56 },
    2026: { distributie: 0.98, vast: 77.46, transport: 0.1654, databeheer: 18.92 },
  },
};

// Groene stroom (GSC) + WKK, c€/kWh.
export const GSC_WKK = { 2025: 1.17 + 0.42, 2026: 1.17 + 0.39 };

// Heffingen per periode, c€/kWh (accijns + bijdrage op de energie).
export const HEFFINGEN = {
  stroom: [
    { van: '0000-00-00', waarde: 5.0329 + 0.2042 },
    { van: '2026-08-01', waarde: 4.8760 },
    { van: '2026-11-01', waarde: 42.20 / 10 * BTW },
  ],
  gas: [
    { van: '0000-00-00', waarde: 0.8724 + 0.1058 },
    { van: '2026-08-01', waarde: 1.0929 },
  ],
};

// Water: De Watergroep, Zonhoven, huishoudelijk, aangesloten op riolering. Bedragen excl. 6% btw,
// som van drinkwater + afvoer + zuivering. Bron: dewatergroep.be/tarieven (2026).
// Basistarief geldt voor 30 m³ per wooneenheid + 30 m³ per gedomicilieerde per jaar, daarboven comforttarief.
// Nog niet nagekeken tegen een afrekening.
export const WATER = {
  2026: { vast: 50 + 30 + 20, korting: 10 + 6 + 4, basis: 2.9251 + 1.9572 + 1.7019, comfort: 5.8502 + 3.9144 + 3.4038 },
};

// Minimum voor het capaciteitstarief (kW).
export const MIN_PIEK = 2.5;

// ---------- Per account ----------
// Contracten, nettarieven en groene stroom/WKK zijn persoonlijk: ze horen bij één account.
// Een account zonder profiel krijgt geen contracten en dus geen kostenberekening, alleen verbruik.
// Sleutel = SHA-256 van het e-mailadres (zodat het adres niet in de code staat).
const PROFIELEN = {
  a7a9e419654b2beba40fe08bee63558e7916a76e0c279bd47bdba0f2ba60615d: { contracten: CONTRACTEN, net: NET, gsc: GSC_WKK, water: WATER },
};
const LEEG = { contracten: { stroom: [], gas: [] }, net: { stroom: {}, gas: {} }, gsc: {}, water: {} };
let profiel = LEEG;

export async function kiesProfiel(email, demo = false) {
  if (demo) { profiel = Object.values(PROFIELEN)[0]; return true; }
  profiel = LEEG;
  if (!email || !globalThis.crypto?.subtle) return false;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.trim().toLowerCase()));
  const hash = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  profiel = PROFIELEN[hash] || LEEG;
  return profiel !== LEEG;
}

export const heeftProfiel = () => profiel !== LEEG;
export const contracten = (soort) => profiel.contracten[soort];
export const netVoor = (soort, jaar) => profiel.net[soort][jaar] ?? null;
export const gscVoor = (jaar) => profiel.gsc[jaar] ?? null;
export const netTabel = (soort) => profiel.net[soort];
export const gscTabel = () => profiel.gsc;
export const waterVoor = (jaar) => profiel.water[jaar] ?? null;
