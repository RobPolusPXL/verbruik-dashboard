// Inlezen van een waterexport (per dag of per uur) van het waterbedrijf.
// Kolommen: Verbruiks adres;Klantrekeningnummer;Meternummer;Contractnummer;Metertype;Volume;Eenheid;
//           Validatiestatus;Van tijdstip;Tot tijdstip;Van datum;Tot datum
// Het adres en de klantgegevens worden niet bewaard, alleen het verbruik in liter.

export const isWater = (tekst) => /^﻿?Verbruiks ?adres;/i.test(tekst) && /;Liter;/i.test(tekst);

const datum = (s) => { const [d, m, j] = s.trim().split('-'); return `${j}-${m}-${d}`; };

export function parseWater(tekst) {
  const regels = tekst.replace(/^﻿/, '').split(/\r?\n/).filter((r) => r.trim());
  const kop = regels.shift().split(';').map((k) => k.trim().toLowerCase());
  const i = (naam) => kop.indexOf(naam);
  const iv = i('volume'), ie = i('eenheid'), ivt = i('van tijdstip'), itt = i('tot tijdstip'), ivd = i('van datum'), itd = i('tot datum');
  if ([iv, ie, ivt, itt, ivd, itd].some((x) => x < 0)) throw new Error('Dit lijkt geen waterexport: kolommen ontbreken.');

  const perUur = {}, perDag = {};
  let uurRegels = 0, dagRegels = 0;
  for (const r of regels) {
    const c = r.split(';');
    if (c.length < kop.length - 1) continue;
    if ((c[ie] || '').trim().toLowerCase() !== 'liter') throw new Error(`Onbekende eenheid "${c[ie]}" in de waterexport.`);
    const v = c[iv].trim() === '' ? 0 : parseFloat(c[iv].replace(',', '.'));
    if (Number.isNaN(v)) continue;
    const d = datum(c[ivd]);
    const van = c[ivt].trim(), tot = c[itt].trim();
    if (van === '00:00:00' && tot.startsWith('23:59') && datum(c[itd]) === d) {
      perDag[d] = v; dagRegels++;
    } else {
      const u = parseInt(van.slice(0, 2), 10);
      (perUur[d] ||= Array(24).fill(null))[u] = v; uurRegels++;
    }
  }
  const resolutie = uurRegels >= dagRegels ? 'uur' : 'dag';
  const dagen = {}, wuren = {};
  if (resolutie === 'dag') {
    for (const [d, v] of Object.entries(perDag)) dagen[d] = { wl: v };
  } else {
    for (const [d, a] of Object.entries(perUur)) {
      const gevuld = a.filter((x) => x != null).length;
      wuren[d] = a.map((x) => x ?? 0);
      // Een dag telt alleen mee als bijna alle uren er zijn (de eerste dag begint soms om 1 uur).
      if (gevuld >= 23) dagen[d] = { wl: a.reduce((s, x) => s + (x ?? 0), 0) };
    }
  }
  const ds = Object.keys({ ...dagen, ...wuren }).sort();
  if (!ds.length) throw new Error('Geen verbruik gevonden in de waterexport.');
  return { soort: 'water', resolutie, van: ds[0], tot: ds.at(-1), dagen, uren: {}, suren: {}, wuren, pieken: {}, aantalDagen: Object.keys(dagen).length };
}
