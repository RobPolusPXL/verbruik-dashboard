import { BELPEX_RLP, TTF_RLP } from './indexen.js';
import {
  START, VASTE_VERGOEDING, HEFFINGEN, MIN_PIEK, contracten, netVoor, gscVoor, netTabel, gscTabel,
} from './tarieven.js';

export function contractOp(soort, datum, schatting = false) {
  const lijst = contracten(soort);
  const c = lijst.find((x) => datum >= x.van && datum <= x.tot);
  if (c || !schatting) return c || null;
  const laatste = [...lijst].sort((a, b) => (a.tot < b.tot ? -1 : 1)).at(-1);
  return laatste && datum > laatste.tot ? laatste : null;
}

// Index van een maand; bij een schatting de laatst gekende waarde als de maand nog niet gepubliceerd is.
export function indexVan(tabel, ym, schatting = false) {
  if (tabel[ym] != null) return tabel[ym];
  if (!schatting) return null;
  const vorige = Object.keys(tabel).filter((m) => m <= ym).sort().pop();
  return vorige ? tabel[vorige] : null;
}

const geldend = (lijst, datum) => {
  let w = null;
  for (const p of lijst) if (datum >= p.van) w = p.waarde;
  return w;
};

// Tarieven van het kalenderjaar; bestaan die niet, dan null (niets berekenen). Alleen voor de prognose
// wordt het laatst gekende jaar gebruikt.
function netVan(soort, datum, schatting) {
  const j = +datum.slice(0, 4);
  const t = netVoor(soort, j);
  if (t || !schatting) return t;
  const T = netTabel(soort);
  const jaren = Object.keys(T).map(Number).filter((x) => x < j);
  return jaren.length ? T[Math.max(...jaren)] : null;
}
function gscVan(datum, schatting) {
  const j = +datum.slice(0, 4);
  const w = gscVoor(j);
  if (w != null || !schatting) return w;
  const G = gscTabel();
  const jaren = Object.keys(G).map(Number).filter((x) => x < j);
  return jaren.length ? G[Math.max(...jaren)] : null;
}

// Waarom een dag niet berekend kan worden (of null als het wel kan).
export function ontbreekt(soort, datum) {
  if (!contractOp(soort, datum)) return 'contract';
  const c = contractOp(soort, datum);
  if (!(soort === 'gas' && c.vast) && indexVan(soort === 'stroom' ? BELPEX_RLP : TTF_RLP, datum.slice(0, 7)) == null) return 'index';
  if (!netVoor(soort, +datum.slice(0, 4)) || (soort === 'stroom' && gscVoor(+datum.slice(0, 4)) == null)) return 'tarieven';
  return null;
}

// Gemiddelde van de maandpieken over de laatste 12 maanden (t.e.m. deze maand), min. 2,5 kW.
function rollendePiek(pieken, ym) {
  const maanden = Object.keys(pieken).filter((m) => m <= ym).sort().slice(-12);
  if (!maanden.length) return MIN_PIEK;
  const gem = maanden.reduce((s, m) => s + pieken[m], 0) / maanden.length;
  return Math.max(MIN_PIEK, gem);
}

const leeg = () => ({ kwh: 0, energie: 0, net: 0, heffingen: 0, vast: 0, dagen: 0 });

// dagen: { 'YYYY-MM-DD': { sd, sn, gk } } — stroom dag/nacht kWh, gas kWh.
// pieken: { 'YYYY-MM': kW }.
// Geeft per maand { maand, stroom, gas } met bedragen in euro incl. btw, of null als het niet kan.
// Met { schatting: true } wordt een ontbrekende index of een contract na het laatste gekende
// ingevuld met de laatst gekende waarde (voor prognoses).
export function kostenPerMaand(dagen, pieken, { schatting = false } = {}) {
  const per = {};
  const datums = Object.keys(dagen).filter((d) => d >= START).sort();
  for (const d of datums) {
    const ym = d.slice(0, 7);
    const v = dagen[d];
    const M = (per[ym] ||= { maand: ym, stroom: leeg(), gas: leeg(), stroomOk: true, gasOk: true });

    // Stroom
    const kwh = (v.sd ?? 0) + (v.sn ?? 0);
    if (v.sd != null || v.sn != null) {
      const c = contractOp('stroom', d, schatting);
      const idx = indexVan(BELPEX_RLP, ym, schatting);
      const net = netVan('stroom', d, schatting), gsc = gscVan(d, schatting);
      if (!c || idx == null || !net || gsc == null) M.stroomOk = false;
      else {
        M.stroom.kwh += kwh;
        M.stroom.energie += c.prijs(idx) * kwh / 100;
        M.stroom.net += net.afname * kwh / 100 + (net.capaciteit * rollendePiek(pieken, ym) + net.databeheer) / 365;
        M.stroom.heffingen += (gsc + geldend(HEFFINGEN.stroom, d)) * kwh / 100;
        M.stroom.vast += VASTE_VERGOEDING / 365;
        M.stroom.dagen += 1;
      }
    }

    // Gas
    if (v.gk != null) {
      const c = contractOp('gas', d, schatting);
      const idx = indexVan(TTF_RLP, ym, schatting);
      const net = netVan('gas', d, schatting);
      if (!c || (!c.vast && idx == null) || !net) M.gasOk = false;
      else {
        M.gas.kwh += v.gk;
        M.gas.energie += c.prijs(idx) * v.gk / 100;
        M.gas.net += (net.distributie + net.transport) * v.gk / 100 + (net.vast + net.databeheer) / 365;
        M.gas.heffingen += geldend(HEFFINGEN.gas, d) * v.gk / 100;
        M.gas.vast += VASTE_VERGOEDING / 365;
        M.gas.dagen += 1;
      }
    }
  }
  const totaal = (x) => x.energie + x.net + x.heffingen + x.vast;
  return Object.values(per).sort((a, b) => (a.maand < b.maand ? -1 : 1)).map((M) => ({
    maand: M.maand,
    stroom: M.stroomOk && M.stroom.dagen ? { ...M.stroom, totaal: totaal(M.stroom) } : null,
    gas: M.gasOk && M.gas.dagen ? { ...M.gas, totaal: totaal(M.gas) } : null,
  }));
}
