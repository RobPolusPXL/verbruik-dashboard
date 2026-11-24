// Afgeleide cijfers: totalen, vergelijkingen, prognose, sluipverbruik en conclusies.
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


// ---------- Conclusies ----------
// Geven zinnen terug als { t: 'html', toon?: 'ok' | 'slecht' }. Getallen worden door de aanroeper opgemaakt via fmt.
const gem = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const uurTxt = (u) => `${u}u`;

// Drukste blok van 2 opeenvolgende uren in een gemiddeld dagprofiel.
function drukstBlok(profiel) {
  let best = 0;
  for (let u = 1; u < 23; u++) if (profiel[u] + profiel[u + 1] > profiel[best] + profiel[best + 1]) best = u;
  return { van: best, tot: best + 2, waarde: (profiel[best] + profiel[best + 1]) / 2 };
}

export function uurConclusies(soort, dagenLijst, uren, dagen, fmt) {
  if (dagenLijst.length < 5) return [];
  const prof = Array.from({ length: 24 }, (_, u) => gem(dagenLijst.map((d) => uren[d][u] ?? 0)));
  const nacht = gem(prof.slice(0, 6)), dag = gem(prof.slice(7, 23));
  const blok = drukstBlok(prof);
  const uit = [];
  if (soort === 'gas') {
    const totaal = gem(dagenLijst.map((d) => uren[d].reduce((a, b) => a + b, 0)));
    if (totaal < 0.5) return [{ t: 'De verwarming stond in deze periode zo goed als uit.' }];
    const uitNachten = dagenLijst.filter((d) => uren[d].slice(1, 6).reduce((a, b) => a + b, 0) < 0.05).length;
    if (dag < 0.05) {
      // Weinig gestookt: dag/nacht-vergelijking zegt dan weinig.
    } else if (nacht > dag * 1.05) {
      uit.push({ t: `Je verwarming verbruikt 's nachts zelfs méér dan overdag: <b>${fmt(nacht)}</b> per uur tegen <b>${fmt(dag)}</b>. Een nachtverlaging is niet te zien.`, toon: 'slecht' });
    } else if (nacht >= dag * 0.85) {
      uit.push({ t: `Je verwarming verbruikt 's nachts ongeveer evenveel als overdag: <b>${fmt(nacht)}</b> per uur tegen <b>${fmt(dag)}</b>. Een nachtverlaging is niet te zien.`, toon: 'slecht' });
    } else {
      uit.push({ t: `'s Nachts verbruik je <b>${Math.round((1 - nacht / dag) * 100)}% minder</b> gas dan overdag (${fmt(nacht)} tegen ${fmt(dag)} per uur).`, toon: 'ok' });
    }
    if (uitNachten) uit.push({ t: `Op <b>${uitNachten} van ${dagenLijst.length}</b> nachten brandde de ketel tussen 1u en 6u nauwelijks.`, toon: 'ok' });
    uit.push({ t: `Het meeste gas gaat op tussen <b>${uurTxt(blok.van)} en ${uurTxt(blok.tot)}</b> (${fmt(blok.waarde)} per uur).` });
  } else {
    const laag = Math.min(...prof);
    uit.push({ t: `Je verbruikt het meest tussen <b>${uurTxt(blok.van)} en ${uurTxt(blok.tot)}</b>: ${fmt(blok.waarde)} per uur, <b>${f1nl(blok.waarde / laag)}×</b> zoveel als op het rustigste uur.` });
    const we = dagenLijst.filter((d) => [0, 6].includes(new Date(d + 'T12:00:00Z').getUTCDay()));
    const wk = dagenLijst.filter((d) => !we.includes(d));
    if (we.length >= 2 && wk.length >= 3) {
      const t = (d) => uren[d].reduce((a, b) => a + b, 0);
      const pct = (gem(we.map(t)) / gem(wk.map(t)) - 1) * 100;
      if (Math.abs(pct) >= 5) uit.push({ t: `In het weekend verbruik je <b>${Math.round(Math.abs(pct))}% ${pct > 0 ? 'meer' : 'minder'}</b> per dag dan in de week (${fmt(gem(we.map(t)))} tegen ${fmt(gem(wk.map(t)))}).` });
      else uit.push({ t: 'Weekend en week verschillen nauwelijks in verbruik per dag.' });
    }
  }
  const vj = tegenVorigJaar(soort, dagenLijst, dagen);
  if (vj) uit.push(vj);
  return uit;
}

const f1nl = (v) => v.toLocaleString('nl-BE', { maximumFractionDigits: 1 });
const vorigJaarDag = (d) => `${+d.slice(0, 4) - 1}${d.slice(4)}`;

// Dezelfde dagen een jaar eerder: gewoon het gemeten verbruik.
export function tegenVorigJaar(soort, dagenLijst, dagen) {
  const w = soort === 'stroom' ? stroomKwh : gasM3;
  const ok = dagenLijst.map((d) => [d, vorigJaarDag(d)]).filter(([a, b]) => dagen[a] && dagen[b] && w(dagen[a]) != null && w(dagen[b]) != null);
  if (ok.length < dagenLijst.length * 0.8) return null;
  const nu = ok.reduce((s, [a]) => s + w(dagen[a]), 0), toen = ok.reduce((s, [, b]) => s + w(dagen[b]), 0);
  if (!toen) return null;
  const pct = (nu / toen - 1) * 100;
  return { t: `Tegen dezelfde dagen vorig jaar: <b>${pct > 0 ? '+' : '−'}${f1nl(Math.abs(pct))}%</b> ${soort}.`, toon: pct > 2 ? 'slecht' : pct < -2 ? 'ok' : undefined };
}

// Hoogste maandpiek en wat 1 kW lager rollend gemiddelde per jaar scheelt.
export function piekConclusie(pieken, capaciteitPerKw, minPiek) {
  const ms = Object.keys(pieken).sort().slice(-12);
  if (ms.length < 3) return null;
  const top = ms.reduce((a, m) => (pieken[m] > pieken[a] ? m : a), ms[0]);
  const rollend = Math.max(minPiek, gem(ms.map((m) => pieken[m])));
  return { top, topKw: pieken[top], rollend, perKw: capaciteitPerKw, kost: rollend * capaciteitPerKw };
}

// Drukste dagen van de laatste 365 dagen, tegenover een gewone dag (mediaan).
export function uitschieters(dagen, waarde, n = 3) {
  const ds = Object.keys(dagen).filter((d) => waarde(dagen[d]) != null).sort();
  if (ds.length < 60) return null;
  const laatste = ds.at(-1);
  const grens = vorigJaarDag(laatste);
  const jaar = ds.filter((d) => d > grens).map((d) => [d, waarde(dagen[d])]);
  const sorted = jaar.map((x) => x[1]).sort((a, b) => a - b);
  const mediaan = sorted[Math.floor(sorted.length / 2)];
  return { mediaan, top: [...jaar].sort((a, b) => b[1] - a[1]).slice(0, n) };
}

// Duurste maand van een reeks en aandeel van de wintermaanden (dec–feb) in de gaskost.
export function kostenConclusies(maanden) {
  const vol = maanden.filter((m) => m.stroom && m.gas);
  if (vol.length < 6) return null;
  const tot = (m) => m.stroom.totaal + m.gas.totaal;
  const duurst = vol.reduce((a, m) => (tot(m) > tot(a) ? m : a), vol[0]);
  const goedkoopst = vol.reduce((a, m) => (tot(m) < tot(a) ? m : a), vol[0]);
  const gasTot = vol.reduce((s, m) => s + m.gas.totaal, 0);
  const winter = vol.filter((m) => ['12', '01', '02'].includes(m.maand.slice(5)));
  const winterGas = winter.reduce((s, m) => s + m.gas.totaal, 0);
  return {
    duurst: { maand: duurst.maand, eur: tot(duurst) }, goedkoopst: { maand: goedkoopst.maand, eur: tot(goedkoopst) },
    winterAandeel: winter.length === 3 && gasTot ? winterGas / gasTot : null,
  };
}
