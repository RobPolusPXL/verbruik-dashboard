// Tarieven voor de kostenberekening. Alle bedragen incl. 6% btw tenzij "excl." vermeld.
// Netbeheerder: Fluvius Limburg, digitale meter, gas "gemiddeld verbruik" (> 5.000 kWh/jaar).
// Bronnen: Energie.be-tariefkaarten (okt 2024, okt 2025, maart 2026, okt 2026) en de wet energienorm.

export const BTW = 1.06;

// Vanaf deze datum wordt gerekend (gecontroleerd met de jaarafrekening apr 2025 – apr 2026).
export const START = '2025-04-01';

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

// Minimum voor het capaciteitstarief (kW).
export const MIN_PIEK = 2.5;

// ---------- Eigen contracten en tarieven (ingevuld bij Gegevens) ----------
// Gaan voor op de waarden hierboven. Zonder contract of tarieven voor een dag wordt er niets berekend.
let eigen = { contracten: [], net: {} };

export function zetEigen(inst = {}) {
  eigen = { contracten: Array.isArray(inst.contracten) ? inst.contracten : [], net: inst.net || {} };
}

const naarContract = (c) => ({
  naam: c.naam, van: c.van, tot: c.tot, vast: !!c.vast, eigen: true, id: c.id,
  vergoeding: c.vergoeding ?? VASTE_VERGOEDING,
  prijs: c.vast ? () => c.prijs : (i) => (c.factor * i + c.constante) * BTW,
  formule: c.vast ? `${String(c.prijs).replace('.', ',')} c€/kWh incl. btw` : `${String(c.factor).replace('.', ',')} × index + ${String(c.constante).replace('.', ',')} c€/kWh excl. btw`,
});

// Eigen contracten eerst, zodat ze voorgaan bij overlap.
export function contracten(soort) {
  return [...eigen.contracten.filter((c) => c.soort === soort).map(naarContract), ...CONTRACTEN[soort]];
}

export function netVoor(soort, jaar) {
  const e = eigen.net?.[jaar]?.[soort];
  if (e) return e;
  return NET[soort][jaar] ?? null;
}

export function gscVoor(jaar) {
  const e = eigen.net?.[jaar]?.stroom?.gsc;
  if (e != null) return e;
  return GSC_WKK[jaar] ?? null;
}

export const eigenNetJaren = () => Object.keys(eigen.net || {});
