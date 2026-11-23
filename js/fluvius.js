// Leest een verbruiksexport uit Mijn Fluvius (CSV met puntkomma's).
// Ondersteunt stroom (kwartier/uur/dag) en gas (uur/dag).

const num = (s) => (s === '' || s == null ? null : parseFloat(s.replace(/\./g, '').replace(',', '.')));
const iso = (d) => { const [dd, mm, yy] = d.split('-'); return `${yy}-${mm}-${dd}`; };
const minuten = (d, t) => {
  const [y, m, dd] = iso(d).split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  return Date.UTC(y, m - 1, dd, h, mi) / 60000;
};

export function parseFluvius(tekst, bestandsnaam = '') {
  const regels = tekst.replace(/^﻿/, '').split(/\r?\n/).filter((r) => r.trim());
  if (regels.length < 2) throw new Error('Leeg bestand');
  const kop = regels[0].split(';').map((s) => s.trim());
  const k = (naam) => {
    const i = kop.indexOf(naam);
    if (i < 0) throw new Error(`Kolom "${naam}" ontbreekt. Is dit een Fluvius-export?`);
    return i;
  };
  const iVD = k('Van (datum)'), iVT = k('Van (tijdstip)'), iTD = k('Tot (datum)'), iTT = k('Tot (tijdstip)');
  const iReg = k('Register'), iVol = k('Volume'), iEh = k('Eenheid');

  const isGas = kop.includes('Calorische bovenwaarde') || /gas/i.test(bestandsnaam);
  const soort = isGas ? 'gas' : 'stroom';
  const dagen = {};
  const uren = {};  // gas m³ per uur
  const suren = {}; // stroom kWh per uur
  const pieken = {};
  let resolutie = null;
  const telling = {}; // aantal ingevulde kwartieren/uren per dag
  let van = null, tot = null, rijen = 0;

  for (let r = 1; r < regels.length; r++) {
    const c = regels[r].split(';');
    if (c.length < kop.length - 1) continue;
    const vd = c[iVD], vt = c[iVT];
    if (!/^\d{2}-\d{2}-\d{4}$/.test(vd)) continue;
    const duur = minuten(c[iTD], c[iTT]) - minuten(vd, vt);
    if (!resolutie) resolutie = duur <= 15 ? 'kwartier' : duur <= 60 ? 'uur' : 'dag';
    const v = num(c[iVol]);
    const d = iso(vd);
    const reg = c[iReg];
    const eh = c[iEh];
    if (v == null) continue;
    van = !van || d < van ? d : van;
    tot = !tot || d > tot ? d : tot;
    rijen++;
    const D = (dagen[d] ||= {});
    if ((soort === 'stroom' && /^Afname/i.test(reg)) || (soort === 'gas' && (eh === 'm³' || eh === 'm3'))) telling[d] = (telling[d] ?? 0) + 1;

    if (soort === 'stroom') {
      if (!/^Afname/i.test(reg)) continue;
      const veld = /nacht/i.test(reg) ? 'sn' : 'sd';
      D[veld] = (D[veld] ?? 0) + v;
      if (resolutie !== 'dag') {
        const u = parseInt(vt.slice(0, 2), 10);
        (suren[d] ||= Array(24).fill(0))[u] += v;
      }
      if (resolutie === 'kwartier') {
        const ym = d.slice(0, 7);
        // kWh per kwartier × 4 = gemiddeld vermogen in kW; dag+nacht vallen nooit in hetzelfde kwartier
        pieken[ym] = Math.max(pieken[ym] ?? 0, v * 4);
      }
    } else {
      const veld = eh === 'm³' || eh === 'm3' ? 'gm' : eh === 'kWh' ? 'gk' : null;
      if (!veld) continue;
      D[veld] = (D[veld] ?? 0) + v;
      if (resolutie === 'uur' && veld === 'gm') {
        const u = parseInt(vt.slice(0, 2), 10);
        (uren[d] ||= Array(24).fill(0))[u] += v;
      }
    }
  }
  if (!rijen) throw new Error('Geen verbruiksgegevens gevonden in dit bestand');
  for (const d of Object.keys(dagen)) if (!Object.keys(dagen[d]).length) delete dagen[d];
  // De laatste dag van een kwartier- of uurexport is vaak nog niet volledig: weglaten als er waarden ontbreken.
  const laatste = Object.keys(dagen).sort().pop();
  const nodig = resolutie === 'kwartier' ? 90 : resolutie === 'uur' ? 23 : 0;
  if (nodig && (telling[laatste] ?? 0) < nodig) {
    delete dagen[laatste];
    delete uren[laatste];
    delete suren[laatste];
    tot = Object.keys(dagen).sort().pop() ?? tot;
  }
  return { soort, resolutie, van, tot, dagen, uren, suren, pieken, aantalDagen: Object.keys(dagen).length };
}
