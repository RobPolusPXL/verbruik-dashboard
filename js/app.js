import * as store from './store.js';
import { parseFluvius } from './fluvius.js';
import { kostenPerMaand } from './kosten.js';
import { BELPEX_RLP } from './indexen.js';
import { esc, ring, gegroepeerd, gestapeld, lijnen, heatmap } from './charts.js';

const KLEUR = { stroom: '#F5C542', gas: '#FF8A4C', water: '#4CA8FF', ok: '#5BD68A', slecht: '#F2A65A' };
const JAARKLEUR = ['#4A5260', '#9AA3AE']; // twee jaar terug, vorig jaar
const MND = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const DAG = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];

const nf = (d) => new Intl.NumberFormat('nl-BE', { minimumFractionDigits: d, maximumFractionDigits: d });
const f0 = nf(0).format, f1 = nf(1).format, f2 = nf(2).format;
const eur = (v) => '€ ' + f2(v);
const datumKort = (d) => `${+d.slice(8, 10)} ${MND[+d.slice(5, 7) - 1]}`;
const maandLang = (ym) => `${MND[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;

const $view = document.getElementById('view');
const state = { user: null, data: null, imports: [], bezig: false, fout: null };

// ---------- afgeleide cijfers ----------
const stroomKwh = (v) => (v.sd != null || v.sn != null ? (v.sd ?? 0) + (v.sn ?? 0) : null);
const gasM3 = (v) => v.gm ?? null;

function perMaand(dagen, waarde) {
  const m = {};
  for (const [d, v] of Object.entries(dagen)) {
    const x = waarde(v);
    if (x != null) m[d.slice(0, 7)] = (m[d.slice(0, 7)] ?? 0) + x;
  }
  return m;
}

// Dit jaar t.e.m. de laatste dag met data, tegen dezelfde periode vorig jaar.
function ytd(dagen, waarde) {
  const met = Object.keys(dagen).filter((d) => waarde(dagen[d]) != null).sort();
  if (!met.length) return null;
  const laatste = met[met.length - 1];
  const j = +laatste.slice(0, 4), md = laatste.slice(5);
  const som = (jaar) => met.filter((d) => d >= `${jaar}-01-01` && d <= `${jaar}-${md}`).reduce((a, d) => a + waarde(dagen[d]), 0);
  const nu = som(j), vorig = som(j - 1);
  return { laatste, jaar: j, nu, vorig, pct: vorig ? (nu / vorig - 1) * 100 : null };
}

function jaarReeksen(maanden, kleurNu) {
  const jaren = [...new Set(Object.keys(maanden).map((m) => +m.slice(0, 4)))].sort().slice(-3);
  return jaren.map((j, i) => ({
    naam: String(j),
    kleur: i === jaren.length - 1 ? kleurNu : JAARKLEUR[i + (3 - jaren.length)] ?? JAARKLEUR[1],
    waarden: Array.from({ length: 12 }, (_, m) => maanden[`${j}-${String(m + 1).padStart(2, '0')}`] ?? null),
  }));
}

function legende(reeksen) {
  return `<div class="legende">${reeksen.map((r) => `<span><i style="background:${r.kleur}"></i>${esc(r.naam)}</span>`).join('')}</div>`;
}

function delta(pct) {
  if (pct == null) return '';
  const cls = pct > 0 ? 'slecht' : 'ok';
  return `<span class="delta ${cls}">${pct > 0 ? '+' : '−'}${f1(Math.abs(pct))}%</span>`;
}

function kosten12(kosten) {
  const vol = kosten.filter((k) => k.stroom && k.gas).slice(-12);
  if (!vol.length) return null;
  const som = (soort, veld) => vol.reduce((a, k) => a + k[soort][veld], 0);
  const deel = (veld) => som('stroom', veld) + som('gas', veld);
  return {
    van: vol[0].maand, tot: vol[vol.length - 1].maand, maanden: vol.length,
    stroom: som('stroom', 'totaal'), gas: som('gas', 'totaal'),
    split: [
      { naam: 'Energie', v: deel('energie'), kleur: '#E8EAED' },
      { naam: 'Netkosten', v: deel('net'), kleur: '#8B95A3' },
      { naam: 'Heffingen', v: deel('heffingen'), kleur: '#5B6472' },
      { naam: 'Vast', v: deel('vast'), kleur: '#3A414D' },
    ],
  };
}

// ---------- schermen ----------
function leegScherm() {
  return `<section class="leeg">
    <h2>Nog geen gegevens</h2>
    <p>Exporteer je verbruik uit Mijn Fluvius en laad de CSV-bestanden hier in.</p>
    <a class="knop" href="#/import">Gegevens inladen</a>
  </section>`;
}

function overzicht() {
  const { dagen, pieken } = state.data;
  if (!Object.keys(dagen).length) return leegScherm();
  const nu = new Date();
  const s = ytd(dagen, stroomKwh), g = ytd(dagen, gasM3);
  const laatsteS = s && stroomKwh(dagen[s.laatste]);
  const laatsteG = g && gasM3(dagen[g.laatste]);
  const ymNu = Object.keys(pieken).sort().pop();
  const k = kosten12(kostenPerMaand(dagen, pieken));

  return `
  <header class="kop"><div class="sub">${DAG[nu.getDay()]} ${nu.getDate()} ${MND[nu.getMonth()]}</div><h1>Thuis</h1></header>
  <div class="tegels">
    ${s ? `<a class="tegel" href="#/stroom"><div class="tl"><i style="background:${KLEUR.stroom}"></i>Stroom</div>
      <div class="tw">${f1(laatsteS)}<small>kWh</small></div><div class="td">${datumKort(s.laatste)}</div></a>` : ''}
    ${g ? `<a class="tegel" href="#/gas"><div class="tl"><i style="background:${KLEUR.gas}"></i>Gas</div>
      <div class="tw">${f1(laatsteG)}<small>m³</small></div><div class="td">${datumKort(g.laatste)}</div></a>` : ''}
    ${ymNu ? `<a class="tegel" href="#/stroom"><div class="tl"><i style="background:${KLEUR.stroom}"></i>Piek</div>
      <div class="tw">${f2(pieken[ymNu])}<small>kW</small></div><div class="td">${maandLang(ymNu)}</div></a>` : ''}
  </div>

  ${s || g ? `<section class="kaart">
    <div class="kaart-kop"><h2>Dit jaar tegen vorig jaar</h2><span>t.e.m. ${datumKort((g || s).laatste)}</span></div>
    <div class="ringen">
      ${g ? ringBlok('Gas', g, 'm³', KLEUR.gas, f1) : ''}
      ${s ? ringBlok('Stroom', s, 'kWh', KLEUR.stroom, f1) : ''}
    </div>
  </section>` : ''}

  ${k ? `<a class="kaart" href="#/kosten">
    <div class="kaart-kop"><h2>Kosten, laatste ${k.maanden} maanden</h2><span>${maandLang(k.van)} – ${maandLang(k.tot)}</span></div>
    <div class="groot">${eur(k.stroom + k.gas)}</div>
    ${splitBalk(k.split)}
  </a>` : ''}`;
}

function ringBlok(naam, y, eenheid, kleur, fmt) {
  const pctTxt = y.pct == null ? '—' : `${y.pct > 0 ? '+' : '−'}${f1(Math.abs(y.pct))}%`;
  return `<div class="ring-blok">
    ${ring(y.vorig ? y.nu / y.vorig : 0, kleur, `${naam}: ${fmt(y.nu)} ${eenheid} dit jaar, ${fmt(y.vorig)} ${eenheid} vorig jaar`, pctTxt, naam)}
    <div class="ring-sub">${fmt(y.nu)} ${eenheid}<br><span>vorig jaar ${fmt(y.vorig)} ${eenheid}</span></div>
  </div>`;
}

function splitBalk(split, fmt = eur) {
  const tot = split.reduce((a, p) => a + p.v, 0);
  return `<div class="splitbalk">${split.map((p) => `<i style="width:${(p.v / tot * 100).toFixed(1)}%;background:${p.kleur}" data-tip="${esc(`${p.naam}: ${fmt(p.v)}`)}"></i>`).join('')}</div>
    <div class="splitlegende">${split.map((p) => `<span><i style="background:${p.kleur}"></i>${p.naam}<b>${fmt(p.v)}</b></span>`).join('')}</div>`;
}

function detailKop(titel) {
  return `<header class="kop rij"><a class="terug" href="#/" aria-label="Terug naar overzicht">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg></a><h1>${titel}</h1></header>`;
}

function stroomScherm() {
  const { dagen, pieken } = state.data;
  const y = ytd(dagen, stroomKwh);
  if (!y) return detailKop('Stroom') + leegScherm();
  const reeksen = jaarReeksen(perMaand(dagen, stroomKwh), KLEUR.stroom);
  const piekReeksen = jaarReeksen(pieken, KLEUR.stroom);
  const dit = Object.entries(dagen).filter(([d]) => d.startsWith(String(y.jaar)));
  const dag = dit.reduce((a, [, v]) => a + (v.sd ?? 0), 0), nacht = dit.reduce((a, [, v]) => a + (v.sn ?? 0), 0);
  return `${detailKop('Stroom')}
  <div class="kop-getal"><div class="groot" style="color:${KLEUR.stroom}">${f1(y.nu)}<small>kWh</small></div>
    <div>${delta(y.pct)} <span class="sub">t.o.v. ${y.jaar - 1}, t.e.m. ${datumKort(y.laatste)}</span></div></div>
  <section class="kaart"><div class="kaart-kop"><h2>Per maand</h2>${legende(reeksen)}</div>
    ${gegroepeerd(reeksen, MND, (v) => `${f0(v)} kWh`, 'Stroomverbruik per maand per jaar')}</section>
  <section class="kaart"><div class="kaart-kop"><h2>Maandpiek</h2>${legende(piekReeksen)}</div>
    <p class="uitleg">Hoogste kwartiervermogen per maand. Telt mee in het capaciteitstarief.</p>
    ${lijnen(piekReeksen, MND, (v) => `${f2(v)} kW`, 'Maandpiek per jaar')}</section>
  <section class="kaart"><div class="kaart-kop"><h2>Dag en nacht, ${y.jaar}</h2></div>
    ${splitBalk([{ naam: 'Dag', v: dag, kleur: KLEUR.stroom }, { naam: 'Nacht', v: nacht, kleur: '#7A6A2E' }], (v) => `${f0(v)} kWh`)}</section>`;
}

function gasScherm() {
  const { dagen, uren } = state.data;
  const y = ytd(dagen, gasM3);
  if (!y) return detailKop('Gas') + leegScherm();
  const reeksen = jaarReeksen(perMaand(dagen, gasM3), KLEUR.gas);
  const urenDagen = Object.keys(uren).sort().slice(-21);
  return `${detailKop('Gas')}
  <div class="kop-getal"><div class="groot" style="color:${KLEUR.gas}">${f1(y.nu)}<small>m³</small></div>
    <div>${delta(y.pct)} <span class="sub">t.o.v. ${y.jaar - 1}, t.e.m. ${datumKort(y.laatste)}</span></div></div>
  <section class="kaart"><div class="kaart-kop"><h2>Per maand</h2>${legende(reeksen)}</div>
    ${gegroepeerd(reeksen, MND, (v) => `${f1(v)} m³`, 'Gasverbruik per maand per jaar')}</section>
  ${urenDagen.length ? `<section class="kaart"><div class="kaart-kop"><h2>Per uur</h2><span>${datumKort(urenDagen[0])} – ${datumKort(urenDagen[urenDagen.length - 1])}</span></div>
    ${heatmap(urenDagen.map((d) => ({ label: datumKort(d), waarden: uren[d] })), '255, 138, 76', (v) => `${f2(v)} m³`, 'Gasverbruik per uur, één rij per dag')}
    <p class="uitleg">Een donkere strook 's nachts betekent dat de ketel niet brandt, bijvoorbeeld door je nachtverlaging.</p></section>`
    : `<section class="kaart"><p class="uitleg">Laad een gasexport met <b>uurtotalen</b> in om je verbruik per uur te zien.</p></section>`}`;
}

function kostenScherm() {
  const { dagen, pieken } = state.data;
  const kosten = kostenPerMaand(dagen, pieken);
  const k = kosten12(kosten);
  if (!kosten.length) return detailKop('Kosten') + leegScherm();
  const kol = kosten.map((m) => ({
    label: maandLang(m.maand), kort: MND[+m.maand.slice(5) - 1][0],
    delen: [
      { naam: 'stroom', waarde: m.stroom?.totaal ?? 0, kleur: KLEUR.stroom },
      { naam: 'gas', waarde: m.gas?.totaal ?? 0, kleur: KLEUR.gas },
    ],
  }));
  const zonderIndex = kosten.filter((m) => !m.stroom && Object.keys(dagen).some((d) => d.startsWith(m.maand) && stroomKwh(dagen[d]) != null) && !BELPEX_RLP[m.maand]);
  return `${detailKop('Kosten')}
  ${k ? `<div class="kop-getal"><div class="sub">Laatste ${k.maanden} maanden, incl. btw</div><div class="groot">${eur(k.stroom + k.gas)}</div>
    <div class="legende"><span><i style="background:${KLEUR.stroom}"></i>Stroom ${eur(k.stroom)}</span><span><i style="background:${KLEUR.gas}"></i>Gas ${eur(k.gas)}</span></div></div>` : ''}
  <section class="kaart"><div class="kaart-kop"><h2>Per maand</h2><span>${maandLang(kosten[0].maand)} – ${maandLang(kosten[kosten.length - 1].maand)}</span></div>
    ${gestapeld(kol, eur, 'Kosten per maand, stroom en gas gestapeld')}
    ${zonderIndex.length ? `<p class="uitleg">Stroom van ${zonderIndex.map((m) => maandLang(m.maand)).join(', ')} volgt zodra de beursindex van die maand gepubliceerd is.</p>` : ''}</section>
  ${k ? `<section class="kaart"><div class="kaart-kop"><h2>Waar betaal je voor?</h2></div>${splitBalk(k.split)}</section>` : ''}
  <p class="uitleg los">Berekend per dag met de tariefkaart van je contract, de gepubliceerde beursindex van de maand en de nettarieven van Fluvius Limburg. Vanaf april 2025 gecontroleerd met je jaarafrekening.</p>`;
}

function importScherm() {
  const imps = state.imports;
  return `${detailKop('Gegevens')}
  <section class="kaart">
    <h2>Fluvius-export inladen</h2>
    <ol class="stappen">
      <li>Mijn Fluvius → Verbruik → exporteer als CSV.</li>
      <li>Stroom: <b>kwartiertotalen</b>. Gas: <b>dagtotalen</b>, en <b>uurtotalen</b> voor de grafiek per uur.</li>
      <li>Kies hier de bestanden. Dubbele dagen worden overschreven.</li>
    </ol>
    <label class="knop">Bestanden kiezen<input id="bestanden" type="file" accept=".csv,text/csv" multiple hidden></label>
    ${imps.length ? `<ul class="importlijst">${imps.map((i) => `<li class="${i.fout ? 'fout' : ''}"><b>${esc(i.naam)}</b><br>${
      i.fout ? esc(i.fout) : `${i.soort}, ${i.resolutie}: ${i.aantalDagen} dagen (${datumKort(i.van)} ${i.van.slice(0, 4)} – ${datumKort(i.tot)} ${i.tot.slice(0, 4)})`}</li>`).join('')}</ul>
      <button class="knop primair" id="opslaan" ${state.bezig || !imps.some((i) => !i.fout) ? 'disabled' : ''}>${state.bezig ? 'Bezig…' : 'Opslaan'}</button>` : ''}
    ${state.melding ? `<p class="melding">${esc(state.melding)}</p>` : ''}
  </section>
  <section class="kaart">
    <h2>Account</h2>
    <p class="uitleg">Aangemeld als ${esc(state.user.email || state.user.displayName || '')}. ${Object.keys(state.data.dagen).length} dagen opgeslagen.</p>
    ${state.user.demo ? '' : '<button class="knop" id="afmelden">Afmelden</button>'}
  </section>`;
}

const ROUTES = { '': overzicht, stroom: stroomScherm, gas: gasScherm, kosten: kostenScherm, import: importScherm };

function render() {
  const route = location.hash.replace(/^#\/?/, '');
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('actief', a.getAttribute('href') === `#/${route}`));
  if (!state.user) { $view.innerHTML = loginScherm(); return; }
  if (!state.data) { $view.innerHTML = '<div class="laden">Laden…</div>'; return; }
  $view.innerHTML = (ROUTES[route] || overzicht)();
  window.scrollTo(0, 0);
}

function loginScherm() {
  if (state.fout === 'config') return `<section class="leeg"><h2>Firebase is nog niet ingesteld</h2><p>Vul <code>firebase-config.js</code> in (zie README).</p></section>`;
  return `<section class="leeg login"><div class="logo" aria-hidden="true">${document.getElementById('logo').innerHTML}</div>
    <h1>Verbruik thuis</h1><p>Stroom, gas en kosten in één overzicht.</p>
    <button class="knop primair" id="aanmelden">Aanmelden met Google</button>
    ${state.fout ? `<p class="melding">${esc(state.fout)}</p>` : ''}</section>`;
}

// ---------- acties ----------
async function laad() {
  state.data = null; render();
  state.data = await store.laadAlles(state.user);
  render();
}

document.addEventListener('click', async (e) => {
  const id = e.target.closest('button')?.id;
  if (id === 'aanmelden') {
    try { await store.login(); } catch (err) { state.fout = 'Aanmelden mislukt: ' + err.message; render(); }
  } else if (id === 'afmelden') {
    await store.logout();
  } else if (id === 'opslaan') {
    state.bezig = true; state.melding = null; render();
    try {
      const n = await store.bewaar(state.user, state.imports.filter((i) => !i.fout), state.data);
      state.imports = []; state.melding = `Opgeslagen (${n} maanden bijgewerkt).`;
      state.bezig = false;
      await laad();
    } catch (err) { state.bezig = false; state.melding = 'Opslaan mislukt: ' + err.message; render(); }
  }
});

document.addEventListener('change', async (e) => {
  if (e.target.id !== 'bestanden') return;
  state.melding = null;
  state.imports = await Promise.all([...e.target.files].map(async (f) => {
    try { return { naam: f.name, ...parseFluvius(await f.text(), f.name) }; }
    catch (err) { return { naam: f.name, fout: err.message }; }
  }));
  render();
});

// Tooltip bij aanraken of muis
const tip = document.getElementById('tip');
function toonTip(e) {
  const el = e.target.closest?.('[data-tip]');
  if (!el) { tip.hidden = true; return; }
  tip.textContent = el.dataset.tip;
  tip.hidden = false;
  const x = Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8);
  tip.style.left = Math.max(8, x) + 'px';
  tip.style.top = Math.max(8, e.clientY - tip.offsetHeight - 12) + 'px';
}
document.addEventListener('pointermove', toonTip);
document.addEventListener('pointerdown', toonTip);
document.addEventListener('scroll', () => { tip.hidden = true; }, { passive: true });

window.addEventListener('hashchange', render);

store.init((u) => {
  state.user = u;
  if (u) laad(); else { state.data = null; render(); }
}).catch((err) => { state.fout = err.message === 'config' ? 'config' : err.message; render(); });

render();

if ('serviceWorker' in navigator && !location.search.includes('demo')) navigator.serviceWorker.register('sw.js');
