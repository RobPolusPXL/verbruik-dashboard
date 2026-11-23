// Afgeleide cijfers: totalen, vergelijkingen, prognose, sluipverbruik en weercorrectie.
import { kostenPerMaand, contractOp, indexVan } from './kosten.js';
import { CONTRACTEN } from './tarieven.js';
import { TTF_RLP } from './indexen.js';

export const stroomKwh = (v) => (v.sd != null || v.sn != null ? (v.sd ?? 0) + (v.sn ?? 0) : null);
export const gasM3 = (v) => v.gm ?? null;

export const dagenInMaand = (ym) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).getUTCDate();
const plusDagen = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const jaarErbij = (d, n) => `${+d.slice(0, 4) + n}${d.slice(4)}`;

export function perMaand(dagen, waarde) {
  const m = {}, n = {};
  for (const [d, v] of Object.entries(dagen)) {
    const x = waarde(v);
    if (x == null) continue;
    const ym = d.slice(0, 7);
    m[ym] = (m[ym] ?? 0) + x;
    n[ym] = (n[ym] ?? 0) + 1;
  }
  return { som: m, dagen: n };
}

// Dit jaar t.e.m. de laatste dag met data, tegen dezelfde periode vorig jaar, met extra statistieken.
export function ytd(dagen, waarde) {
  const met = Object.keys(dagen).filter((d) => waarde(dagen[d]) != null).sort();
  if (!met.length) return null;
  const laatste = met[met.length - 1];
  const j = +laatste.slice(0, 4), md = laatste.slice(5);
  const periode = (jaar) => {
    const ds = met.filter((d) => d >= `${jaar}-01-01` && d <= `${jaar}-${md}`);
    if (!ds.length) return null;
    const vals = ds.map((d) => [d, waarde(dagen[d])]);
    const totaal = vals.reduce((a, [, v]) => a + v, 0);
    const maanden = {};
    for (const [d, v] of vals) maanden[d.slice(0, 7)] = (maanden[d.slice(0, 7)] ?? 0) + v;
    // Alleen volledige maanden tellen mee voor hoogste/laagste maand
    const vol = Object.entries(maanden).filter(([ym]) => ds.filter((d) => d.startsWith(ym)).length === dagenInMaand(ym));
    const sorteer = (a, b) => a[1] - b[1];
    const dagSort = [...vals].sort(sorteer);
    const maandSort = [...vol].sort(sorteer);
    return {
      totaal, perDag: totaal / ds.length, aantalDagen: ds.length,
      hoogsteMaand: maandSort.at(-1) ?? null, laagsteMaand: maandSort[0] ?? null,
      hoogsteDag: dagSort.at(-1), laagsteDag: dagSort[0],
    };
  };
  const nu = periode(j), vorig = periode(j - 1);
  return {
    laatste, jaar: j, nu: nu.totaal, vorig: vorig?.totaal ?? 0,
    pct: vorig?.totaal ? (nu.totaal / vorig.totaal - 1) * 100 : null,
    detail: { nu, vorig },
  };
}

export function jaren(dagen, waarde) {
  return [...new Set(Object.keys(dagen).filter((d) => waarde(dagen[d]) != null).map((d) => +d.slice(0, 4)))].sort();
}

// Totaal per kalenderjaar, met het aantal dagen met data (om onvolledige jaren aan te duiden).
export function jaarTotalen(dagen, waarde) {
  const t = {};
  for (const [d, v] of Object.entries(dagen)) {
    const x = waarde(v);
    if (x == null) continue;
    const j = d.slice(0, 4);
    (t[j] ||= { jaar: +j, som: 0, dagen: 0 });
    t[j].som += x; t[j].dagen += 1;
  }
  return Object.values(t).sort((a, b) => a.jaar - b.jaar);
}

// ---------- Prognose jaarafrekening ----------
// Volgt de afrekeningsperiode die begint in startMaand (1–12). Dagen zonder data worden ingevuld met
// het verbruik van dezelfde dag een jaar eerder; ontbrekende indexen en contracten met de laatst gekende.
export function prognose(data, { voorschot, startMaand = 4 }, vandaag = new Date()) {
  if (!voorschot) return null;
  const { dagen, pieken } = data;
  const nu = vandaag.toISOString().slice(0, 10);
  let startJaar = +nu.slice(0, 4);
  if (+nu.slice(5, 7) < startMaand) startJaar -= 1;
  const van = `${startJaar}-${String(startMaand).padStart(2, '0')}-01`;
  const tot = plusDagen(`${startJaar + 1}-${String(startMaand).padStart(2, '0')}-01`, -1);

  const est = {}, estPieken = { ...pieken };
  let geschatteDagen = 0, echteDagen = 0;
  for (let d = van; d <= tot; d = plusDagen(d, 1)) {
    const echt = dagen[d];
    const vorig = dagen[jaarErbij(d, -1)];
    const v = {};
    if (echt && stroomKwh(echt) != null) { v.sd = echt.sd; v.sn = echt.sn; } else if (vorig && stroomKwh(vorig) != null) { v.sd = vorig.sd; v.sn = vorig.sn; v.geschat = true; }
    if (echt?.gk != null) v.gk = echt.gk; else if (vorig?.gk != null) { v.gk = vorig.gk; v.geschat = true; }
    if (v.sd == null && v.gk == null) continue;
    est[d] = v;
    if (v.geschat) geschatteDagen++; else echteDagen++;
    const ym = d.slice(0, 7);
    if (estPieken[ym] == null && pieken[jaarErbij(ym + '-01', -1).slice(0, 7)] != null) estPieken[ym] = pieken[jaarErbij(ym + '-01', -1).slice(0, 7)];
  }
  const maanden = kostenPerMaand(est, estPieken, { schatting: true });
  const kost = maanden.reduce((a, m) => a + (m.stroom?.totaal ?? 0) + (m.gas?.totaal ?? 0), 0);
  const betaald = voorschot * 12;
  return { van, tot, kost, betaald, verschil: kost - betaald, geschatteDagen, echteDagen };
}

// ---------- Vast tegen variabel ----------
// Gas-energiekost (incl. btw) van een periode met het echte contract, tegen een andere prijs per kWh.
function vergelijkGasEnergie(dagen, van, tot, prijsAlt) {
  let echt = 0, alt = 0, kwh = 0, aantal = 0;
  for (const [d, v] of Object.entries(dagen)) {
    if (d < van || d > tot || v.gk == null) continue;
    const c = contractOp('gas', d);
    const idx = indexVan(TTF_RLP, d.slice(0, 7));
    const p = prijsAlt(d);
    if (!c || (!c.vast && idx == null) || p == null) continue;
    echt += c.prijs(idx) * v.gk / 100;
    alt += p * v.gk / 100;
    kwh += v.gk; aantal++;
  }
  return { echt, alt, kwh, dagen: aantal };
}

// Gas: je vaste contract tegen het laatste variabele contract met de TTF-index van elke maand.
export function gasVastTegenVariabel(dagen) {
  const vast = CONTRACTEN.gas.find((c) => c.vast);
  const variabel = [...CONTRACTEN.gas].reverse().find((c) => !c.vast);
  if (!vast || !variabel) return null;
  const r = vergelijkGasEnergie(dagen, vast.van, vast.tot, (d) => {
    const i = indexVan(TTF_RLP, d.slice(0, 7));
    return i == null ? null : variabel.prijs(i);
  });
  return r.dagen ? { ...r, vast, variabel } : null;
}

// Laatste 12 volledige maanden: wat de energie zou kosten aan een vaste prijs (c€/kWh incl. btw).
export function energieTegenVastePrijs(kosten, soort, prijs) {
  const vol = kosten.filter((m) => m[soort] && m[soort].dagen === dagenInMaand(m.maand)).slice(-12);
  if (!vol.length || !prijs) return null;
  const echt = vol.reduce((a, m) => a + m[soort].energie, 0);
  const kwh = vol.reduce((a, m) => a + m[soort].kwh, 0);
  return { van: vol[0].maand, tot: vol.at(-1).maand, maanden: vol.length, echt, alt: prijs * kwh / 100, kwh };
}

// ---------- Sluipverbruik ----------
// Laagste uurverbruik tussen 0 en 6 uur per nacht, mediaan over de laatste 30 nachten, in watt.
export function sluipverbruik(suren, kosten) {
  const nachten = Object.keys(suren).sort().slice(-30);
  if (nachten.length < 7) return null;
  const minima = nachten.map((d) => Math.min(...suren[d].slice(0, 6))).sort((a, b) => a - b);
  const watt = minima[Math.floor(minima.length / 2)] * 1000;
  const vol = kosten.filter((m) => m.stroom).slice(-12);
  const kwh = vol.reduce((a, m) => a + m.stroom.kwh, 0);
  const eur = vol.reduce((a, m) => a + m.stroom.totaal, 0);
  const prijs = kwh ? eur / kwh : null; // gemiddelde all-in prijs per kWh
  const jaarKwh = watt * 8.76;
  return { watt, jaarKwh, jaarEur: prijs ? jaarKwh * prijs : null, nachten: nachten.length };
}

// ---------- Weer en graaddagen ----------
// Gemiddelde dagtemperatuur in Zonhoven via Open-Meteo (gratis, zonder sleutel).
const LAT = 50.99, LON = 5.37, BASIS = 16.5; // graaddagen t.o.v. 16,5 °C, zoals in België gebruikelijk

export async function haalTemperaturen(van, tot) {
  const sleutel = `verbruik-weer-${van}`;
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem(sleutel) || '{}'); } catch { /* geen cache */ }
  const ontbreekt = (d) => cache[d] == null;
  const gisteren = plusDagen(new Date().toISOString().slice(0, 10), -1);
  const eind = tot < gisteren ? tot : gisteren;
  const archiefEind = plusDagen(eind, -6);
  const urls = [];
  if (ontbreekt(van) || ontbreekt(archiefEind)) {
    urls.push(`https://archive-api.open-meteo.com/v1/archive?latitude=${LAT}&longitude=${LON}&start_date=${van}&end_date=${archiefEind}&daily=temperature_2m_mean&timezone=Europe%2FBrussels`);
  }
  urls.push(`https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&past_days=31&forecast_days=1&daily=temperature_2m_mean&timezone=Europe%2FBrussels`);
  for (const u of urls) {
    const r = await fetch(u);
    if (!r.ok) throw new Error('Weergegevens niet beschikbaar');
    const j = await r.json();
    j.daily.time.forEach((d, i) => { if (j.daily.temperature_2m_mean[i] != null && d <= eind) cache[d] = j.daily.temperature_2m_mean[i]; });
  }
  try { localStorage.setItem(sleutel, JSON.stringify(cache)); } catch { /* vol */ }
  return cache;
}

export const graaddag = (t) => Math.max(0, BASIS - t);

// Gas per graaddag per maand (alleen maanden met genoeg stookdagen) en voor de laatste 30 dagen.
export function gasPerGraaddag(dagen, temp) {
  const m = {};
  for (const [d, v] of Object.entries(dagen)) {
    if (v.gm == null || temp[d] == null) continue;
    const ym = d.slice(0, 7);
    (m[ym] ||= { gas: 0, gd: 0 });
    m[ym].gas += v.gm; m[ym].gd += graaddag(temp[d]);
  }
  const perMaand = {};
  for (const [ym, x] of Object.entries(m)) if (x.gd >= 60) perMaand[ym] = x.gas / x.gd;

  const met = Object.keys(dagen).filter((d) => dagen[d].gm != null && temp[d] != null).sort();
  const laatste = met.at(-1);
  const venster = (eind) => {
    let gas = 0, gd = 0;
    for (let i = 0; i < 30; i++) {
      const d = plusDagen(eind, -i);
      if (dagen[d]?.gm != null && temp[d] != null) { gas += dagen[d].gm; gd += graaddag(temp[d]); }
    }
    return gd >= 30 ? { gas, gd, perGd: gas / gd } : null;
  };
  return { perMaand, recent: laatste ? venster(laatste) : null, vorigJaar: laatste ? venster(jaarErbij(laatste, -1)) : null, laatste };
}

// Elk jaar over dezelfde periode (1 jan t.e.m. de laatste dag met data). Alleen jaren die die periode volledig dekken.
export function zelfdePeriode(dagen, waarde) {
  const met = Object.keys(dagen).filter((d) => waarde(dagen[d]) != null).sort();
  if (!met.length) return [];
  const laatste = met.at(-1), md = laatste.slice(5);
  const nodig = met.filter((d) => d.startsWith(laatste.slice(0, 4))).length;
  const uit = [];
  for (const j of new Set(met.map((d) => +d.slice(0, 4)))) {
    const ds = met.filter((d) => d >= `${j}-01-01` && d <= `${j}-${md}`);
    if (ds.length < nodig - 3) continue;
    uit.push({ jaar: j, totaal: ds.reduce((a, d) => a + waarde(dagen[d]), 0) });
  }
  return uit.sort((a, b) => a.jaar - b.jaar);
}
