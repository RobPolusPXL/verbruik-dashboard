// Plaats van de woning (voor de buitentemperatuur) en de temperaturen zelf.
// De plaats wordt alleen bewaard als gemeente, postcode en coördinaten; geen straat.

const GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build';

// Zoekt een Belgische gemeente op naam of postcode.
export async function zoekPlaats(tekst, postcode = null) {
  const q = tekst.trim();
  if (!q) return [];
  const r = await fetch(`${GEO}?name=${encodeURIComponent(q)}&count=10&language=nl&countryCode=BE&format=json`);
  if (!r.ok) throw new Error('De plaats kon niet opgezocht worden.');
  const j = await r.json();
  let res = (j.results || []).map((x) => ({
    naam: x.name, postcode: (x.postcodes || [])[0] ?? null, postcodes: x.postcodes || [],
    provincie: x.admin2 || x.admin1 || '', lat: +x.latitude.toFixed(3), lon: +x.longitude.toFixed(3),
  }));
  if (postcode) {
    const met = res.filter((x) => x.postcodes.includes(postcode));
    if (met.length) res = met.map((x) => ({ ...x, postcode }));
  }
  return res;
}

// Haalt postcode en gemeente uit het leveringsadres op een factuur (PDF).
export async function adresUitFactuur(bestand) {
  const pdfjs = await import(`${PDFJS}/pdf.min.mjs`);
  pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS}/pdf.worker.min.mjs`;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await bestand.arrayBuffer()) }).promise;
  let tekst = '';
  for (let p = 1; p <= Math.min(doc.numPages, 2); p++) {
    const inhoud = await (await doc.getPage(p)).getTextContent();
    tekst += inhoud.items.map((i) => i.str + (i.hasEOL ? '\n' : ' ')).join('') + '\n';
  }
  // Adresregels zoals "STRAAT 12, 3520 Zonhoven"; regels van de leverancier of ombudsdienst niet.
  const regels = tekst.split('\n');
  const vreemd = /\b(NV|BV|SA|BTW|RPR|ombuds|tel\.|fax|www\.)/i;
  const patroon = /\d+\s*[A-Za-z]?(?:\s*bus\s*\S+)?\s*,\s*([1-9]\d{3})\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ'\-]*(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'\-]*)*)/;
  const kandidaten = [];
  regels.forEach((r, i) => {
    if (vreemd.test(r)) return;
    const m = r.match(patroon);
    if (m) kandidaten.push({ postcode: m[1], gemeente: m[2].trim(), leveringsadres: /(levering|verbruiks|afname)s?adres/i.test(r + (regels[i - 1] || '')) });
  });
  if (!kandidaten.length) throw new Error('Geen adres gevonden in deze factuur. Typ je gemeente zelf in.');
  // Voorkeur voor de regel bij "Leveringsadres", anders het adres dat het vaakst voorkomt.
  const bij = kandidaten.find((k) => k.leveringsadres);
  if (bij) return { postcode: bij.postcode, gemeente: bij.gemeente };
  const tel = {};
  for (const k of kandidaten) tel[k.postcode + ' ' + k.gemeente] = (tel[k.postcode + ' ' + k.gemeente] || 0) + 1;
  const [pc, ...g] = Object.entries(tel).sort((a, b) => b[1] - a[1])[0][0].split(' ');
  return { postcode: pc, gemeente: g.join(' ') };
}

// Gemiddelde dagtemperatuur (°C) voor de plaats, van 'van' tot gisteren. Wordt per plaats bewaard.
export async function temperaturen(plaats, van) {
  const sleutel = `verbruik-temp-${plaats.lat},${plaats.lon}`;
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem(sleutel) || '{}'); } catch { /* leeg */ }
  const dag = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const gisteren = dag(-1);
  const opgeslagen = Object.keys(cache).sort();
  const ontbreektBegin = !opgeslagen.length || opgeslagen[0] > van;
  // Archief loopt enkele dagen achter; de recente dagen komen uit de weerdienst zelf.
  const urls = [];
  const archiefTot = dag(-6);
  const archiefVan = ontbreektBegin ? van : (opgeslagen.at(-1) < archiefTot ? opgeslagen.at(-1) : null);
  if (archiefVan && archiefVan <= archiefTot) {
    urls.push(`https://archive-api.open-meteo.com/v1/archive?latitude=${plaats.lat}&longitude=${plaats.lon}&start_date=${archiefVan}&end_date=${archiefTot}&daily=temperature_2m_mean&timezone=Europe%2FBrussels`);
  }
  if (!cache[gisteren]) {
    urls.push(`https://api.open-meteo.com/v1/forecast?latitude=${plaats.lat}&longitude=${plaats.lon}&past_days=14&forecast_days=1&daily=temperature_2m_mean&timezone=Europe%2FBrussels`);
  }
  for (const u of urls) {
    const r = await fetch(u);
    if (!r.ok) throw new Error('De temperaturen konden niet opgehaald worden.');
    const j = await r.json();
    j.daily.time.forEach((d, i) => {
      const t = j.daily.temperature_2m_mean[i];
      if (t != null && d <= gisteren) cache[d] = t;
    });
  }
  try { localStorage.setItem(sleutel, JSON.stringify(cache)); } catch { /* vol */ }
  return cache;
}

// Gemiddelde temperatuur per maand { 'YYYY-MM': °C } (alleen volledige of lopende maanden met data).
export function perMaand(temp) {
  const s = {}, n = {};
  for (const [d, t] of Object.entries(temp)) { const m = d.slice(0, 7); s[m] = (s[m] ?? 0) + t; n[m] = (n[m] ?? 0) + 1; }
  return Object.fromEntries(Object.keys(s).filter((m) => n[m] >= 7).map((m) => [m, s[m] / n[m]]));
}
