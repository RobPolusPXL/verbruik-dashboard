import { BELPEX_RLP, TTF_RLP } from './indexen.js';
import {
  START, CONTRACTEN, VASTE_VERGOEDING, NET, GSC_WKK, HEFFINGEN, MIN_PIEK,
} from './tarieven.js';

export const contractOp = (soort, datum, schatting = false) =>
  CONTRACTEN[soort].find((c) => datum >= c.van && datum <= c.tot)
  || (schatting && datum > CONTRACTEN[soort].at(-1).tot ? CONTRACTEN[soort].at(-1) : null);

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

const jaarVan = (datum, tabel) => {
  const j = +datum.slice(0, 4);
  return tabel[j] || tabel[Math.max(...Object.keys(tabel).map(Number))];
};

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
      if (!c || idx == null) M.stroomOk = false;
      else {
        const net = jaarVan(d, NET.stroom);
        M.stroom.kwh += kwh;
        M.stroom.energie += c.prijs(idx) * kwh / 100;
        M.stroom.net += net.afname * kwh / 100 + (net.capaciteit * rollendePiek(pieken, ym) + net.databeheer) / 365;
        M.stroom.heffingen += (jaarVan(d, GSC_WKK) + geldend(HEFFINGEN.stroom, d)) * kwh / 100;
        M.stroom.vast += VASTE_VERGOEDING / 365;
        M.stroom.dagen += 1;
      }
    }

    // Gas
    if (v.gk != null) {
      const c = contractOp('gas', d, schatting);
      const idx = indexVan(TTF_RLP, ym, schatting);
      if (!c || (!c.vast && idx == null)) M.gasOk = false;
      else {
        const net = jaarVan(d, NET.gas);
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
