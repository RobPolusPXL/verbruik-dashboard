import * as store from './store.js';
import { parseFluvius } from './fluvius.js';
import { parseWater, isWater } from './water.js';
import { kostenPerMaand, ontbreekt } from './kosten.js';
import { MIN_PIEK, contracten, netVoor, kiesProfiel, heeftProfiel } from './tarieven.js';
import * as A from './berekeningen.js';
import * as P from './plaats.js';
import { esc, ring, gegroepeerd, gestapeld, lijnen, heatmap, dagprofiel } from './charts.js';

const KLEUR = { stroom: '#F5C542', gas: '#FF8A4C', water: '#4FA3F7', ok: '#5BD68A', slecht: '#F2A65A' };
const OUDE_JAREN = ['#3A414D', '#5B6472', '#9AA3AE']; // van oud naar recent; het nieuwste gekozen jaar krijgt de accentkleur
const MND = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const MAAND_VOL = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
const DAG = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];

const nf = (d) => new Intl.NumberFormat('nl-BE', { minimumFractionDigits: d, maximumFractionDigits: d });
const f0 = nf(0).format, f1 = nf(1).format, f2 = nf(2).format;
const eur = (v) => '€ ' + f2(v);
const eur0 = (v) => '€ ' + f0(v);
const datumKort = (d) => `${+d.slice(8, 10)} ${MND[+d.slice(5, 7) - 1]}`;
const datumJaar = (d) => `${datumKort(d)} ${d.slice(0, 4)}`;
const maandLang = (ym) => `${MND[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;
const maandVol = (ym) => `${MAAND_VOL[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;

const $view = document.getElementById('view');
const state = {
  user: null, gestart: false, data: null, instellingen: {}, imports: [], bezig: false, fout: null, melding: null,
  ui: { jaren: {}, uurMaand: {}, kostenJaar: 'laatste' },
};

const ENERGIE = {
  stroom: { naam: 'Stroom', waarde: A.stroomKwh, eenheid: 'kWh', fmt: f0, fmtD: f1, kleur: KLEUR.stroom, rgb: '245, 197, 66' },
  gas: { naam: 'Gas', waarde: A.gasM3, eenheid: 'm³', fmt: f1, fmtD: f2, kleur: KLEUR.gas, rgb: '255, 138, 76' },
  water: { naam: 'Water', waarde: A.waterL, eenheid: 'l', fmt: f0, fmtD: f0, kleur: KLEUR.water, rgb: '79, 163, 247' },
};

// ---------- kleine bouwstenen ----------
function delta(pct) {
  if (pct == null) return '';
  return `<span class="delta ${pct > 0 ? 'slecht' : 'ok'}">${pct > 0 ? '+' : '−'}${f1(Math.abs(pct))}%</span>`;
}

function legende(reeksen) {
  return `<div class="legende">${reeksen.map((r) => `<span><i style="background:${r.kleur}"></i>${esc(r.naam)}</span>`).join('')}</div>`;
}

function splitBalk(split, fmt = eur) {
  const tot = split.reduce((a, p) => a + p.v, 0) || 1;
  return `<div class="splitbalk">${split.map((p) => `<i style="width:${(p.v / tot * 100).toFixed(1)}%;background:${p.kleur}" data-tip="${esc(`${p.naam}: ${fmt(p.v)}`)}"></i>`).join('')}</div>
    <div class="splitlegende">${split.map((p) => `<span><i style="background:${p.kleur}"></i>${p.naam}<b>${fmt(p.v)}</b></span>`).join('')}</div>`;
}

function chips(opties, gekozen, actie, label) {
  return `<div class="chips" role="group" aria-label="${esc(label)}">${opties.map((o) => `<button type="button" class="chip${gekozen(o.waarde) ? ' aan' : ''}" data-actie="${actie}" data-waarde="${esc(o.waarde)}" aria-pressed="${gekozen(o.waarde)}">${esc(o.label)}</button>`).join('')}</div>`;
}

function conclusies(items) {
  if (!items?.length) return '';
  return `<ul class="conclusies">${items.map((c) => `<li${c.toon ? ` class="${c.toon}"` : ''}>${c.t}</li>`).join('')}</ul>`;
}

function detailKop(titel) {
  return `<header class="kop rij"><a class="terug" href="#/" aria-label="Terug naar overzicht">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg></a><h1>${titel}</h1></header>`;
}

function leegScherm() {
  return `<section class="leeg"><h2>Nog geen gegevens</h2>
    <p>Exporteer je verbruik uit Mijn Fluvius en laad de CSV-bestanden hier in.</p>
    <a class="knop" href="#/import">Gegevens inladen</a></section>`;
}

// Gekozen jaren voor een energiesoort: standaard de laatste 3.
function gekozenJaren(soort, beschikbaar) {
  const g = state.ui.jaren[soort];
  if (!g) return beschikbaar.slice(-3);
  const geldig = g.filter((j) => beschikbaar.includes(j));
  return geldig.length ? geldig : beschikbaar.slice(-3);
}

function jaarReeksen(maandSom, jaren, kleurNu) {
  const s = [...jaren].sort();
  return s.map((j, i) => ({
    naam: String(j),
    kleur: i === s.length - 1 ? kleurNu : OUDE_JAREN[OUDE_JAREN.length - (s.length - 1) + i] ?? OUDE_JAREN[0],
    waarden: Array.from({ length: 12 }, (_, m) => maandSom[`${j}-${String(m + 1).padStart(2, '0')}`] ?? null),
  }));
}

function kostenVan(maanden) {
  const som = (soort, veld) => maanden.reduce((a, k) => a + (k[soort]?.[veld] ?? 0), 0);
  const deel = (veld) => som('stroom', veld) + som('gas', veld);
  return {
    stroom: som('stroom', 'totaal'), gas: som('gas', 'totaal'),
    split: [
      { naam: 'Energie', v: deel('energie'), kleur: '#E8EAED' },
      { naam: 'Netkosten', v: deel('net'), kleur: '#8B95A3' },
      { naam: 'Heffingen', v: deel('heffingen'), kleur: '#5B6472' },
      { naam: 'Vast', v: deel('vast'), kleur: '#3A414D' },
    ],
  };
}

const laatste12 = (kosten) => kosten.filter((k) => k.stroom && k.gas).slice(-12);

// ---------- Thuis ----------
function overzicht() {
  const { dagen, pieken } = state.data;
  if (!Object.keys(dagen).length) return leegScherm();
  const nu = new Date();
  const s = A.ytd(dagen, A.stroomKwh), g = A.ytd(dagen, A.gasM3);
  const ymNu = Object.keys(pieken).sort().pop();
  const kosten = kostenPerMaand(dagen, pieken);
  const l12 = laatste12(kosten);
  const k = l12.length ? kostenVan(l12) : null;
  const p = heeftProfiel() ? A.prognose(state.data, state.instellingen) : null;
  const w = A.ytd(dagen, A.waterL);
  const wuren = state.data.wuren || {};
  const lek = A.lekNachten(Object.keys(wuren).sort().slice(-3), wuren);

  return `
  <header class="kop"><div class="sub">${DAG[nu.getDay()]} ${nu.getDate()} ${MND[nu.getMonth()]}</div><h1>Thuis</h1></header>
  <div class="tegels${w ? ' vier' : ''}">
    ${s ? `<a class="tegel" href="#/stroom"><div class="tl"><i style="background:${KLEUR.stroom}"></i>Stroom</div>
      <div class="tw">${f1(A.stroomKwh(dagen[s.laatste]))}<small>kWh</small></div><div class="td">${datumKort(s.laatste)}</div></a>` : ''}
    ${g ? `<a class="tegel" href="#/gas"><div class="tl"><i style="background:${KLEUR.gas}"></i>Gas</div>
      <div class="tw">${f1(A.gasM3(dagen[g.laatste]))}<small>m³</small></div><div class="td">${datumKort(g.laatste)}</div></a>` : ''}
    ${ymNu ? `<a class="tegel" href="#/stroom"><div class="tl"><i style="background:${KLEUR.stroom}"></i>Piek</div>
      <div class="tw">${f2(pieken[ymNu])}<small>kW</small></div><div class="td">${maandLang(ymNu)}</div></a>` : ''}
    ${w ? `<a class="tegel" href="#/water"><div class="tl"><i style="background:${KLEUR.water}"></i>Water</div>
      <div class="tw">${f0(A.waterL(dagen[w.laatste]))}<small>l</small></div><div class="td">${datumKort(w.laatste)}</div></a>` : ''}
  </div>
  ${lek.verdacht ? `<a class="kaart let-op" data-id="lekalarm" href="#/water"><div class="kaart-kop"><h2>Mogelijk waterlek</h2></div>
    ${conclusies([{ t: `De laatste ${lek.nachten} nachten liep er ${lek.verdacht === lek.nachten ? 'elke nacht' : `${lek.verdacht} keer`} tussen 1u en 5u elk uur water. Controleer wc en kranen.`, toon: 'slecht' }])}</a>` : ''}

  ${contractStatusKaart()}

  ${herinneringKaart()}
  ${weekKaart()}

  ${s || g ? `<section class="kaart" data-id="ringen">
    <div class="kaart-kop"><h2>Dit jaar tegen vorig jaar</h2><span>t.e.m. ${datumKort((g || s).laatste)}</span></div>
    <div class="ringen">${g ? ringBlok('Gas', g, 'm³', KLEUR.gas) : ''}${s ? ringBlok('Stroom', s, 'kWh', KLEUR.stroom) : ''}</div>
  </section>` : ''}

  ${k ? `<a class="kaart" data-id="kosten12" href="#/kosten">
    <div class="kaart-kop"><h2>Kosten, laatste ${l12.length} maanden</h2><span>${maandLang(l12[0].maand)} – ${maandLang(l12.at(-1).maand)}</span></div>
    <div class="groot">${eur(k.stroom + k.gas)}</div>${splitBalk(k.split)}
  </a>` : ''}

  ${p ? prognoseKaart(p, true) : ''}`;
}

// Lopende contracten en wanneer ze aflopen. Waarschuwt 60 dagen op voorhand als er nog geen opvolger is,
// en als de nettarieven van volgend jaar in december nog niet ingevuld zijn.
const WAARSCHUW_DAGEN = 60;
function contractStatus() {
  const vandaag = new Date().toISOString().slice(0, 10);
  const dagenTot = (d) => Math.round((Date.parse(d) - Date.parse(vandaag)) / 864e5);
  const plus1 = (d) => new Date(Date.parse(d) + 864e5).toISOString().slice(0, 10);
  return ['stroom', 'gas'].map((soort) => {
    const lijst = contracten(soort);
    const nu = lijst.find((c) => vandaag >= c.van && vandaag <= c.tot);
    if (!nu) return { soort, nu: null, toon: 'slecht' };
    const opvolger = lijst.find((c) => c.van === plus1(nu.tot) || (c.van > nu.van && c.van <= plus1(nu.tot) && c.tot > nu.tot));
    const rest = dagenTot(nu.tot);
    return { soort, nu, rest, opvolger, toon: !opvolger && rest <= WAARSCHUW_DAGEN ? 'slecht' : undefined };
  });
}

function contractStatusKaart() {
  if (!heeftProfiel()) return '';
  const st = contractStatus();
  const nu = new Date();
  const volgendJaar = nu.getFullYear() + 1;
  const tariefMist = nu.getMonth() === 11 && !(netVoor('stroom', volgendJaar) && netVoor('gas', volgendJaar));
  const ditJaarMist = !(netVoor('stroom', nu.getFullYear()) && netVoor('gas', nu.getFullYear()));
  const items = st.map((x) => {
    const naam = x.soort === 'stroom' ? 'Stroom' : 'Gas';
    if (!x.nu) return { t: `<b>${naam}: geen contract voor vandaag.</b> Zonder contract worden er geen kosten berekend.`, toon: 'slecht' };
    const einde = `loopt tot <b>${datumJaar(x.nu.tot)}</b>`;
    if (x.opvolger) return { t: `${naam}: ${esc(x.nu.naam)} ${einde}, daarna ${esc(x.opvolger.naam)}.` };
    if (x.toon) return { t: `<b>${naam}: je contract loopt af over ${x.rest} ${x.rest === 1 ? 'dag' : 'dagen'}</b> (${datumJaar(x.nu.tot)}). Zonder nieuw contract stopt de kostenberekening.`, toon: 'slecht' };
    return { t: `${naam}: ${esc(x.nu.naam)} ${einde} (nog ${x.rest} dagen).` };
  });
  if (ditJaarMist) items.push({ t: `<b>De nettarieven van ${nu.getFullYear()} zijn nog niet ingevuld.</b> Zonder die tarieven worden er geen kosten berekend.`, toon: 'slecht' });
  else if (tariefMist) items.push({ t: `<b>De nettarieven van ${volgendJaar} ontbreken nog.</b> Vanaf 1 januari zijn ze nodig.`, toon: 'slecht' });
  const dringend = items.some((i) => i.toon === 'slecht');
  return `<section class="kaart${dringend ? ' let-op' : ''}" data-id="contractstatus">
    <div class="kaart-kop"><h2>${dringend ? 'Actie nodig' : 'Contracten'}</h2></div>${conclusies(items)}</section>`;
}

// Herinnering als de laatste data van een soort ouder is dan een maand.
function herinneringKaart() {
  const { dagen } = state.data;
  const vandaag = new Date().toISOString().slice(0, 10);
  const items = ['stroom', 'gas', 'water'].map((soort) => {
    const e = ENERGIE[soort];
    const ds = Object.keys(dagen).filter((d) => e.waarde(dagen[d]) != null);
    if (!ds.length) return null;
    const laatste = ds.sort().at(-1);
    const oud = Math.round((Date.parse(vandaag) - Date.parse(laatste)) / 864e5);
    return oud > 31 ? { t: `Je laatste <b>${soort}data</b> is van ${datumJaar(laatste)}, ${oud} dagen geleden. Laad een nieuwe export in.`, toon: 'slecht' } : null;
  }).filter(Boolean);
  if (!items.length) return '';
  return `<a class="kaart let-op" data-id="herinnering" href="#/import"><div class="kaart-kop"><h2>Nieuwe gegevens inladen</h2></div>${conclusies(items)}</a>`;
}

// De laatste 7 dagen tegen de 7 dagen daarvoor, naast elkaar.
function weekKaart() {
  let periode = '';
  const kol = ['stroom', 'gas', 'water'].map((soort) => {
    const e = ENERGIE[soort];
    const w = A.weekTegenWeek(state.data.dagen, e.waarde);
    if (!w) return '';
    periode ||= `${datumKort(w.van)} – ${datumKort(w.tot)}`;
    return `<div class="week-kol"><span class="wk-naam"><i style="background:${e.kleur}"></i>${e.naam}</span>
      <b>${e.fmt(w.nu)}<small> ${e.eenheid}</small></b>
      ${delta(w.pct)}
      <span class="wk-vorig">vorige: ${e.fmt(w.vorig)}</span></div>`;
  }).filter(Boolean);
  if (!kol.length) return '';
  return `<section class="kaart" data-id="week"><div class="kaart-kop"><h2>Week tegen week</h2><span>${periode}</span></div>
    <div class="week-rij" style="--n:${kol.length}">${kol.join('')}</div></section>`;
}

function ringBlok(naam, y, eenheid, kleur) {
  const pctTxt = y.pct == null ? '—' : `${y.pct > 0 ? '+' : '−'}${f1(Math.abs(y.pct))}%`;
  return `<div class="ring-blok">
    ${ring(y.vorig ? y.nu / y.vorig : 0, kleur, `${naam}: ${f1(y.nu)} ${eenheid} dit jaar, ${f1(y.vorig)} ${eenheid} vorig jaar`, pctTxt, naam)}
    <div class="ring-sub">${f1(y.nu)} ${eenheid}<br><span>vorig jaar ${f1(y.vorig)} ${eenheid}</span></div>
  </div>`;
}

function prognoseKaart(p, link) {
  const terug = p.verschil < 0;
  const inhoud = `<div class="kaart-kop"><h2>Verwachte jaarafrekening</h2><span>${datumJaar(p.van)} – ${datumJaar(p.tot)}</span></div>
    <div class="groot ${terug ? 'ok' : 'slecht'}">${terug ? 'Terug' : 'Bijbetalen'} ${eur0(Math.abs(p.verschil))}</div>
    <div class="vergelijk">
      <div><span>Verwachte kost</span><b>${eur0(p.kost)}</b></div>
      <div><span>Voorschotten (12 ×)</span><b>${eur0(p.betaald)}</b></div>
    </div>
    <p class="uitleg">Schatting: ${p.echteDagen} dagen echt verbruik, ${p.geschatteDagen} dagen aangevuld met het verbruik van een jaar eerder, aan de laatst gekende prijzen.</p>`;
  return link ? `<a class="kaart" data-id="prognose" href="#/kosten">${inhoud}</a>` : `<section class="kaart" data-id="prognose">${inhoud}</section>`;
}

// ---------- Stroom en gas ----------
// Dit jaar tegen elk vorig jaar, telkens over dezelfde periode, als ringen.
function jarenRingen(dagen, e, y) {
  const jaren = A.zelfdePeriode(dagen, e.waarde);
  const nu = jaren.find((j) => j.jaar === y.jaar);
  const vorige = jaren.filter((j) => j.jaar < y.jaar).reverse();
  if (!nu || !vorige.length) return '';
  return `<section class="kaart" data-id="jaren"><div class="kaart-kop"><h2>${y.jaar} tegen vorige jaren</h2><span>1 jan – ${datumKort(y.laatste)}</span></div>
    <div class="ringen">${vorige.map((v) => {
      const pct = (nu.totaal / v.totaal - 1) * 100;
      return `<div class="ring-blok">
        ${ring(nu.totaal / v.totaal, e.kleur, `${y.jaar}: ${e.fmt(nu.totaal)} ${e.eenheid}, ${v.jaar}: ${e.fmt(v.totaal)} ${e.eenheid}`, `${pct > 0 ? '+' : '−'}${f1(Math.abs(pct))}%`, `t.o.v. ${v.jaar}`)}
        <div class="ring-sub">${e.fmt(v.totaal)} ${e.eenheid}<br><span>in ${v.jaar}</span></div></div>`;
    }).join('')}</div></section>`;
}

// ---------- Water ----------
function persoonKaart(dagen) {
  const n = +state.instellingen.bewoners || 0;
  const kop = '<div class="kaart-kop"><h2>Per persoon</h2><span>laatste 30 dagen</span></div>';
  if (!n) return `<section class="kaart" data-id="persoon">${kop}<p class="uitleg">Vul bij <a href="#/import"><b>Gegevens</b></a> het aantal bewoners in om je waterverbruik per persoon te zien.</p></section>`;
  const ds = Object.keys(dagen).filter((d) => dagen[d].wl != null).sort().slice(-30);
  if (!ds.length) return '';
  const perPersoon = ds.reduce((a, d) => a + dagen[d].wl, 0) / ds.length / n;
  const ref = A.VMM_WATER[Math.min(5, n)];
  const pct = (perPersoon / ref - 1) * 100;
  return `<section class="kaart" data-id="persoon">${kop}
    <div class="vergelijk"><div><span>Jullie (${n} ${n === 1 ? 'persoon' : 'personen'})</span><b>${f0(perPersoon)} <small>l/dag</small></b></div>
      <div><span>Vlaams gemiddelde${n > 5 ? ' (5+)' : ''}</span><b>${ref} <small>l/dag</small></b></div></div>
    <p class="uitleg">${Math.abs(pct) < 5 ? 'Ongeveer gemiddeld' : `${f0(Math.abs(pct))}% ${pct < 0 ? 'onder' : 'boven'} het gemiddelde`} voor een gezin van ${n > 5 ? '5 of meer' : n} ${n === 1 ? 'persoon' : 'personen'}. Bron: VMM, kraanwaterverbruik per gezinsgrootte (2022), ${ds.length} dagen gemeten.</p></section>`;
}


function lekKaart(wuren) {
  const ds = Object.keys(wuren).sort().slice(-14);
  if (ds.length < 3) return '';
  const l = A.lekNachten(ds, wuren);
  const items = l.verdacht
    ? [{ t: `<b>${l.verdacht} van de laatste ${l.nachten} nachten</b> liep er tussen 1u en 5u elk uur water: ${l.dagen.map(datumKort).join(', ')}. Dat wijst op een lekkende wc of kraan.`, toon: 'slecht' }]
    : [{ t: `Geen lek: de laatste ${l.nachten} nachten was er tussen 1u en 5u telkens minstens één uur zonder verbruik.`, toon: 'ok' }];
  return `<section class="kaart" data-id="lek"><div class="kaart-kop"><h2>Lekcontrole</h2><span>laatste ${l.nachten} nachten</span></div>
    ${conclusies(items)}
    <p class="uitleg">Een lekkende wc of kraan loopt dag en nacht. Als er 's nachts geen enkel uur zonder verbruik is, klopt er iets niet.</p></section>`;
}

// ---------- Buitentemperatuur ----------
const plaatsVan = () => state.instellingen.plaats || null;
function tempNodig() {
  const pl = plaatsVan();
  if (!pl || state.temp || state.tempBezig || state.tempFout) return;
  state.tempBezig = true;
  const van = Object.keys(state.data.dagen).sort()[0];
  P.temperaturen(pl, van).then((t) => { state.temp = t; })
    .catch((err) => { state.tempFout = err.message; })
    .finally(() => { state.tempBezig = false; if (location.hash.replace(/^#\/?/, '') === 'gas') render(false); });
}

function tempKaart(gekozen) {
  const pl = plaatsVan();
  const kop = '<div class="kaart-kop"><h2>Buitentemperatuur</h2>' + (pl ? `<span>${esc(pl.naam)}</span>` : '') + '</div>';
  if (!pl) return `<section class="kaart" data-id="temp">${kop}<p class="uitleg">Vul bij <a href="#/import"><b>Gegevens</b></a> je gemeente in om hier de gemiddelde buitentemperatuur per maand te zien.</p></section>`;
  tempNodig();
  if (state.tempFout) return `<section class="kaart" data-id="temp">${kop}<p class="uitleg">${esc(state.tempFout)}</p></section>`;
  if (!state.temp) return `<section class="kaart" data-id="temp">${kop}<p class="uitleg">Temperaturen laden…</p></section>`;
  const pm = P.perMaand(state.temp);
  const reeksen = jaarReeksen(pm, gekozen, KLEUR.gas);
  // Laatste maand met temperaturen tegen dezelfde maand vorig jaar.
  const laatste = Object.keys(pm).sort().at(-1);
  const vorig = laatste && `${+laatste.slice(0, 4) - 1}${laatste.slice(4)}`;
  const zin = laatste && pm[vorig] != null
    ? `${MAAND_VOL[+laatste.slice(5) - 1][0].toUpperCase()}${MAAND_VOL[+laatste.slice(5) - 1].slice(1)} ${laatste.slice(0, 4)}${laatste === new Date().toISOString().slice(0, 7) ? ' (tot nu toe)' : ''} was gemiddeld <b>${f1(pm[laatste])}°</b>, tegen <b>${f1(pm[vorig])}°</b> in ${vorig.slice(0, 4)}: ${Math.abs(pm[laatste] - pm[vorig]) < 0.5 ? 'ongeveer even warm' : `<b>${f1(Math.abs(pm[laatste] - pm[vorig]))}° ${pm[laatste] < pm[vorig] ? 'kouder' : 'warmer'}</b>`}.`
    : null;
  return `<section class="kaart" data-id="temp">${kop}${legende(reeksen)}
    ${lijnen(reeksen, MND, (v) => `${f1(v)} °C`, 'Gemiddelde buitentemperatuur per maand')}
    ${zin ? conclusies([{ t: zin }]) : ''}
    <p class="uitleg">Gemiddelde dagtemperatuur, bron Open-Meteo.</p></section>`;
}

// Hoe koud de getoonde dagen waren tegen dezelfde dagen vorig jaar.
function tempZin(dagenLijst) {
  if (!plaatsVan()) return [];
  tempNodig();
  const t = state.temp;
  if (!t) return [];
  const vj = (d) => `${+d.slice(0, 4) - 1}${d.slice(4)}`;
  const ok = dagenLijst.filter((d) => t[d] != null && t[vj(d)] != null);
  if (ok.length < dagenLijst.length * 0.8) return [];
  const nu = ok.reduce((a, d) => a + t[d], 0) / ok.length, toen = ok.reduce((a, d) => a + t[vj(d)], 0) / ok.length;
  const v = nu - toen;
  return [{ t: `Buiten was het gemiddeld <b>${f1(nu)}°</b>, tegen <b>${f1(toen)}°</b> op dezelfde dagen vorig jaar: ${Math.abs(v) < 0.5 ? 'ongeveer even warm' : `<b>${f1(Math.abs(v))}° ${v < 0 ? 'kouder' : 'warmer'}</b>`}.` }];
}

function plaatsKaart() {
  const pl = plaatsVan();
  const keuzes = state.plaatsKeuzes || [];
  return `<form class="kaart" data-id="plaats" id="plaatsform">
    <h2>Plaats van de woning</h2>
    <p class="uitleg">Nodig voor de buitentemperatuur. Alleen de gemeente wordt bewaard, geen adres.</p>
    ${pl ? `<p class="uitleg">Nu: <b>${esc(pl.naam)}</b>${pl.postcode ? ` (${esc(pl.postcode)})` : ''}${pl.provincie ? `, ${esc(pl.provincie)}` : ''}</p>` : ''}
    <div class="velden2">
      <label class="veld"><span>Gemeente of postcode</span><input name="zoek" autocomplete="address-level2"></label>
      <div class="veld"><span>&nbsp;</span><button type="submit" class="knop">Zoeken</button></div>
    </div>
    <label class="knop">Uit een factuur halen (PDF)<input id="factuur" type="file" accept="application/pdf,.pdf" hidden></label>
    <p class="uitleg">Werkt alleen met facturen van <b>Energie.be</b>.</p>
    ${keuzes.length ? `<ul class="importlijst">${keuzes.map((k, i) => `<li><b>${esc(k.naam)}</b>${k.postcode ? ` (${esc(k.postcode)})` : ''}${k.provincie ? `, ${esc(k.provincie)}` : ''}
      <button type="button" class="link kies" data-actie="plaats-kies" data-waarde="${i}">Kiezen</button></li>`).join('')}</ul>` : ''}
    ${state.plaatsMelding ? `<p class="melding">${esc(state.plaatsMelding)}</p>` : ''}
  </form>`;
}

function uurKaart(soort, uren, e, eenheidUur) {
  const fu = soort === 'water' ? f1 : f2;
  const beschikbaar = [...new Set(Object.keys(uren).map((d) => d.slice(0, 7)))].sort();
  if (!beschikbaar.length) return null;
  const keuze = state.ui.uurMaand[soort] ?? null; // null = laatste 3 weken
  let dagenLijst, titel;
  if (!keuze) {
    dagenLijst = Object.keys(uren).sort().slice(-21);
    titel = 'Laatste 3 weken';
  } else {
    dagenLijst = Object.keys(uren).filter((d) => d.startsWith(keuze)).sort();
    titel = maandVol(keuze);
  }
  // Vorige: vanuit "laatste 3 weken" naar de maand vóór de laatste maand; daarna telkens een maand terug.
  const laatsteMaand = beschikbaar.at(-1);
  const huidig = keuze ?? laatsteMaand;
  const vorige = beschikbaar.filter((m) => m < huidig).at(-1) ?? null;
  const volgende = keuze ? (beschikbaar.filter((m) => m > keuze && m < laatsteMaand).at(0) ?? 'laatste') : null;
  const gem = Array.from({ length: 24 }, (_, u) => dagenLijst.reduce((a, d) => a + (uren[d][u] ?? 0), 0) / dagenLijst.length);
  return `<section class="kaart" data-id="uur">
    <div class="kaart-kop bladeren">
      <button type="button" class="pijl" data-actie="uur-vorige" data-soort="${soort}" data-waarde="${vorige ?? ''}" ${vorige ? '' : 'disabled'} aria-label="Vorige maand">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg></button>
      <h2>Per uur · ${esc(titel)}</h2>
      <button type="button" class="pijl" data-actie="uur-volgende" data-soort="${soort}" data-waarde="${volgende ?? ''}" ${volgende ? '' : 'disabled'} aria-label="Volgende">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>
    </div>
    ${heatmap(dagenLijst.map((d) => ({ label: datumKort(d), waarden: uren[d] })), e.rgb, (v) => `${fu(v)} ${eenheidUur}`, `${e.naam} per uur, één rij per dag`)}
  </section>
  <section class="kaart" data-id="dagprofiel"><div class="kaart-kop"><h2>Gemiddelde dag</h2><span>${esc(titel.toLowerCase())}</span></div>
    ${dagprofiel(gem, e.kleur, (v) => `${fu(v)} ${eenheidUur}`, `Gemiddeld ${e.naam.toLowerCase()}verbruik per uur van de dag`)}
    ${conclusies([...A.uurConclusies(soort, dagenLijst, uren, state.data.dagen, (v) => `${fu(v)} ${eenheidUur}`), ...(soort === 'gas' ? tempZin(dagenLijst) : [])])}
  </section>`;
}

function energieScherm(soort) {
  const e = ENERGIE[soort];
  const { dagen, pieken, uren, suren, wuren = {} } = state.data;
  const y = A.ytd(dagen, e.waarde);
  if (!y) return detailKop(e.naam) + leegScherm();
  const beschikbaar = A.jaren(dagen, e.waarde);
  const gekozen = gekozenJaren(soort, beschikbaar);
  const reeksen = jaarReeksen(A.perMaand(dagen, e.waarde).som, gekozen, e.kleur);
  const totalen = A.jaarTotalen(dagen, e.waarde);
  const jaarChips = chips(beschikbaar.map((j) => ({ waarde: j, label: String(j) })), (j) => gekozen.includes(+j), `jaar-${soort}`, 'Jaren om te vergelijken');

  let extra = '';
  if (soort === 'stroom') {
    const piekReeksen = jaarReeksen(pieken, gekozen.filter((j) => Object.keys(pieken).some((m) => m.startsWith(j))), KLEUR.stroom);
    const dit = Object.entries(dagen).filter(([d]) => d.startsWith(String(y.jaar)));
    const dag = dit.reduce((a, [, v]) => a + (v.sd ?? 0), 0), nacht = dit.reduce((a, [, v]) => a + (v.sn ?? 0), 0);
    const sluip = A.sluipverbruik(suren, kostenPerMaand(dagen, pieken));
    const netNu = netVoor('stroom', new Date().getFullYear());
    const pc = netNu ? A.piekConclusie(pieken, netNu.capaciteit, MIN_PIEK) : null;
    const top = A.uitschieters(dagen, A.stroomKwh);
    extra = `
    ${piekReeksen.length ? `<section class="kaart" data-id="piek"><div class="kaart-kop"><h2>Maandpiek</h2>${legende(piekReeksen)}</div>
      <p class="uitleg">Hoogste kwartiervermogen per maand. Telt mee in het capaciteitstarief.</p>
      ${lijnen(piekReeksen, MND, (v) => `${f2(v)} kW`, 'Maandpiek per jaar')}
      ${pc ? conclusies([
        { t: `Je hoogste piek van de laatste 12 maanden was <b>${f2(pc.topKw)} kW</b> in ${maandVol(pc.top)}.` },
        { t: `Je capaciteitstarief rekent met het gemiddelde van die 12 pieken: <b>${f2(pc.rollend)} kW</b>, ongeveer <b>${eur0(pc.kost)}</b> per jaar. Elke kW lager scheelt <b>${eur0(pc.perKw)}</b> per jaar: niet tegelijk koken, wassen en drogen helpt.` },
      ]) : ''}</section>` : ''}
    ${top ? `<section class="kaart" data-id="drukste"><div class="kaart-kop"><h2>Drukste dagen</h2><span>laatste 12 maanden</span></div>
      ${conclusies(top.top.map(([d, v]) => ({ t: `<b>${DAG[new Date(d + 'T12:00:00Z').getUTCDay()]} ${datumJaar(d)}</b>: ${f1(v)} kWh, ${f1(v / top.mediaan)}× een gewone dag (${f1(top.mediaan)} kWh)` })))}</section>` : ''}
    <section class="kaart" data-id="sluip"><div class="kaart-kop"><h2>Sluipverbruik</h2>${sluip ? `<span>laatste ${sluip.nachten} nachten</span>` : ''}</div>
      ${sluip ? `<div class="groot">${f0(sluip.watt)}<small>W</small></div>
        <p class="uitleg">Zoveel verbruikt je huis zelfs 's nachts, als alles uit lijkt: koelkast, diepvries, router, toestellen op stand-by.
        Die blijven ook overdag aanstaan, dus 24 uur op 24. Op een jaar is dat ongeveer <b>${f0(sluip.jaarKwh)} kWh</b>${sluip.jaarEur ? ` of <b>${eur0(sluip.jaarEur)}</b>` : ''}:
        <b>${f0(sluip.jaarKwh / (y.nu / y.detail.nu.aantalDagen * 365) * 100)}%</b> van al je stroom gaat naar toestellen die altijd aanstaan.</p>`
        : '<p class="uitleg">Laad je stroomexport met <b>kwartiertotalen</b> (opnieuw) in om je sluipverbruik te zien.</p>'}</section>
    <section class="kaart" data-id="dagnacht"><div class="kaart-kop"><h2>Dag en nacht, ${y.jaar}</h2></div>
      ${splitBalk([{ naam: 'Dag', v: dag, kleur: KLEUR.stroom }, { naam: 'Nacht', v: nacht, kleur: '#7A6A2E' }], (v) => `${f0(v)} kWh`)}</section>`;
  }

  const uurData = soort === 'gas' ? uren : soort === 'water' ? wuren : suren;
  const uk = uurKaart(soort, uurData, e, soort === 'gas' ? 'm³' : soort === 'water' ? 'l' : 'kWh');
  if (soort === 'water') extra = lekKaart(wuren) + persoonKaart(dagen);

  return `${detailKop(e.naam)}
  <div class="kop-getal"><div class="groot" style="color:${e.kleur}">${e.fmt(y.nu)}<small>${e.eenheid}</small></div>
    <div>${y.vorig ? `${delta(y.pct)} <span class="sub">t.o.v. ${y.jaar - 1}, t.e.m. ${datumKort(y.laatste)}</span>` : `<span class="sub">${y.jaar}, t.e.m. ${datumKort(y.laatste)}</span>`}</div></div>
  ${jarenRingen(dagen, e, y)}
  <section class="kaart" data-id="maand"><div class="kaart-kop"><h2>Per maand</h2></div>${jaarChips}${legende(reeksen)}
    ${gegroepeerd(reeksen, MAAND_VOL, (v) => `${e.fmt(v)} ${e.eenheid}`, `${e.naam}verbruik per maand per jaar`)}</section>
  ${soort === 'gas' ? tempKaart(gekozen) : ''}
  ${totalen.length < 2 ? '' : `<section class="kaart" data-id="jaar"><div class="kaart-kop"><h2>Per jaar</h2></div>
    ${gestapeld(totalen.map((t) => ({ label: String(t.jaar), kort: `'${String(t.jaar).slice(2)}`, onvolledig: t.dagen < 365,
      delen: [{ naam: e.naam.toLowerCase(), waarde: t.som, kleur: e.kleur }] })), (v) => `${e.fmt(v)} ${e.eenheid}`, `${e.naam}verbruik per jaar`)}
    ${totalen.some((t) => t.dagen < 365) ? '<p class="uitleg">Lichtere staven zijn onvolledige jaren.</p>' : ''}</section>`}
  ${uk ?? (soort === 'stroom' ? '<section class="kaart" data-id="uur"><p class="uitleg">Laad je stroomexport met <b>kwartiertotalen</b> (opnieuw) in om je verbruik per uur te zien.</p></section>'
    : soort === 'water' ? '<section class="kaart" data-id="uur"><p class="uitleg">Laad een waterexport <b>per uur</b> in om je verbruik per uur en de lekcontrole te zien.</p></section>'
    : '<section class="kaart" data-id="uur"><p class="uitleg">Laad een gasexport met <b>uurtotalen</b> in om je verbruik per uur te zien.</p></section>')}
  ${extra}`;
}

// ---------- Kosten ----------
function kostenScherm() {
  const { dagen, pieken } = state.data;
  const kosten = kostenPerMaand(dagen, pieken);
  if (!heeftProfiel()) return `${detailKop('Kosten')}<section class="leeg"><h2>Geen kosten voor dit account</h2>
    <p>Voor dit account zijn geen contracten ingesteld. De app toont daarom alleen je verbruik. Kosten worden nooit berekend met de prijzen van iemand anders.</p></section>`;
  if (!kosten.length) return detailKop('Kosten') + leegScherm();
  const jaren = [...new Set(kosten.map((k) => k.maand.slice(0, 4)))];
  const keuze = state.ui.kostenJaar;
  const selectie = keuze === 'laatste' ? laatste12(kosten) : kosten.filter((k) => k.maand.startsWith(keuze));
  const k = selectie.length ? kostenVan(selectie) : null;
  const kol = selectie.map((m) => ({
    label: maandVol(m.maand), kort: MND[+m.maand.slice(5) - 1][0],
    delen: [{ naam: 'stroom', waarde: m.stroom?.totaal ?? 0, kleur: KLEUR.stroom }, { naam: 'gas', waarde: m.gas?.totaal ?? 0, kleur: KLEUR.gas }],
  }));
  const perJaar = jaren.map((j) => {
    const ms = kosten.filter((m) => m.maand.startsWith(j));
    const kk = kostenVan(ms);
    const volledig = ms.filter((m) => m.stroom && m.gas).length;
    return { label: j, kort: `'${j.slice(2)}`, onvolledig: volledig < 12,
      delen: [{ naam: 'stroom', waarde: kk.stroom, kleur: KLEUR.stroom }, { naam: 'gas', waarde: kk.gas, kleur: KLEUR.gas }] };
  });
  // Maanden zonder kosten: waarom niet?
  const REDEN = { index: 'de beursindex van die maand is nog niet gepubliceerd', contract: 'er is geen contract voor die periode', tarieven: 'de nettarieven van dat jaar ontbreken' };
  const ontbrekend = [];
  for (const m of selectie) for (const soort of ['stroom', 'gas']) {
    if (m[soort]) continue;
    const r = Object.keys(dagen).filter((x) => x.startsWith(m.maand) && (soort === 'stroom' ? A.stroomKwh(dagen[x]) : dagen[x].gk) != null)
      .sort().map((x) => ontbreekt(soort, x)).find(Boolean);
    if (r) ontbrekend.push(`${soort === 'stroom' ? 'Stroom' : 'Gas'} van ${maandLang(m.maand)}: ${REDEN[r]}.`);
  }
  const titel = keuze === 'laatste' ? `Laatste ${selectie.length} maanden` : `${keuze}${selectie.length < 12 ? ` (${selectie.length} maanden)` : ''}`;
  const p = heeftProfiel() ? A.prognose(state.data, state.instellingen) : null;

  return `${detailKop('Kosten')}
  ${chips([{ waarde: 'laatste', label: '12 maanden' }, ...jaren.map((j) => ({ waarde: j, label: j }))], (w) => w === keuze, 'kosten-jaar', 'Periode')}
  ${k ? `<div class="kop-getal"><div class="sub">${esc(titel)}, incl. btw</div><div class="groot">${eur(k.stroom + k.gas)}</div>
    <div class="legende"><span><i style="background:${KLEUR.stroom}"></i>Stroom ${eur(k.stroom)}</span><span><i style="background:${KLEUR.gas}"></i>Gas ${eur(k.gas)}</span></div></div>` : ''}
  <section class="kaart" data-id="kmaand"><div class="kaart-kop"><h2>Per maand</h2></div>
    ${gestapeld(kol, eur, 'Kosten per maand, stroom en gas gestapeld')}
    ${(() => { const c = A.kostenConclusies(selectie); return c ? conclusies([
      { t: `Duurste maand: <b>${maandVol(c.duurst.maand)}</b> (${eur0(c.duurst.eur)}), goedkoopste: <b>${maandVol(c.goedkoopst.maand)}</b> (${eur0(c.goedkoopst.eur)}).` },
      ...(c.winterAandeel != null ? [{ t: `December tot februari zijn samen goed voor <b>${Math.round(c.winterAandeel * 100)}%</b> van je gaskosten in deze periode.` }] : []),
    ]) : ''; })()}
    ${ontbrekend.length ? `<p class="uitleg">Niet berekend: ${ontbrekend.map(esc).join(' ')}</p>` : ''}</section>
  ${k ? `<section class="kaart" data-id="split"><div class="kaart-kop"><h2>Waar betaal je voor?</h2></div>${splitBalk(k.split)}</section>` : ''}
  <section class="kaart" data-id="kjaar"><div class="kaart-kop"><h2>Jaar na jaar</h2></div>
    ${gestapeld(perJaar, eur, 'Kosten per jaar, stroom en gas gestapeld')}
    <p class="uitleg">Lichtere staven zijn onvolledige jaren. De kosten worden berekend vanaf april 2025.</p></section>
  ${p ? prognoseKaart(p, false) : `<section class="kaart" data-id="prognose"><h2>Verwachte jaarafrekening</h2><p class="uitleg">Vul je maandelijkse voorschot in bij <a href="#/import"><b>Gegevens</b></a> om te zien of je geld terugkrijgt of moet bijbetalen.</p></section>`}
  ${vastVariabelKaart(kosten)}
  <p class="uitleg los"><b>Contractprijzen:</b> alleen voor Energie.be. <b>Nettarieven:</b> Fluvius Limburg, geldig voor iedereen in die regio. <b>Verbruik:</b> uit je Fluvius-export, voor elke leverancier. Berekend per dag met de tariefkaart van je contract, de gepubliceerde beursindex van de maand en de nettarieven van Fluvius Limburg. April 2025 – maart 2026 is gecontroleerd met je jaarafrekening.</p>`;
}

function vastVariabelKaart(kosten) {
  const gas = A.gasVastTegenVariabel(state.data.dagen);
  const ps = parseFloat(state.instellingen.vasteStroomprijs), pg = parseFloat(state.instellingen.vasteGasprijs);
  const s = ps ? A.energieTegenVastePrijs(kosten, 'stroom', ps) : null;
  const g2 = pg ? A.energieTegenVastePrijs(kosten, 'gas', pg) : null;
  const regel = (titel, echtLabel, echt, altLabel, alt, uitleg) => {
    const v = alt - echt;
    return `<div class="vv"><h3 class="tussenkop">${titel}</h3>
      <div class="vergelijk"><div><span>${echtLabel}</span><b>${eur0(echt)}</b></div><div><span>${altLabel}</span><b>${eur0(alt)}</b></div></div>
      <p class="uitleg">${v > 0 ? `Je contract was <b class="ok">${eur0(v)} goedkoper</b>.` : `Je contract was <b class="slecht">${eur0(-v)} duurder</b>.`} ${uitleg}</p></div>`;
  };
  let h = '';
  if (gas) h += regel('Gas: vast tegen variabel', 'Vast (4,59 c€/kWh)', gas.echt, 'Was variabel gebleven', gas.alt,
    `Alleen de energieprijs, sinds ${datumJaar(gas.vast.van)}. Variabel = de formule van je vorige contract met de TTF-index van elke maand.`);
  if (s) h += regel('Stroom: jouw contract tegen een vaste prijs', 'Jouw contract', s.echt, `Vast aan ${f2(ps)} c€/kWh`, s.alt, `Alleen de energieprijs, ${maandLang(s.van)} – ${maandLang(s.tot)}.`);
  if (g2) h += regel('Gas: jouw contract tegen een vaste prijs', 'Jouw contract', g2.echt, `Vast aan ${f2(pg)} c€/kWh`, g2.alt, `Alleen de energieprijs, ${maandLang(g2.van)} – ${maandLang(g2.tot)}.`);
  if (!s && !g2) h += '<p class="uitleg">Vul bij <a href="#/import"><b>Gegevens</b></a> de prijs van een vast aanbod in (c€/kWh incl. btw, van een tariefkaart) om het met je huidige contract te vergelijken.</p>';
  return `<section class="kaart" data-id="vastvar"><div class="kaart-kop"><h2>Vast of variabel?</h2></div><div class="vv-rij">${h}</div></section>`;
}

// ---------- Gegevens ----------
function importScherm() {
  const imps = state.imports, i = state.instellingen;
  return `${detailKop('Gegevens')}
  <section class="kaart" data-id="import">
    <h2>Gegevens inladen</h2>
    <h3 class="tussenkop">Stroom en gas</h3>
    <ol class="stappen">
      <li>Mijn Fluvius → Verbruik → exporteer als CSV.</li>
      <li>Stroom: <b>kwartiertotalen</b>. Gas: <b>dagtotalen</b>, en <b>uurtotalen</b> voor de grafiek per uur.</li>
    </ol>
    <h3 class="tussenkop">Water</h3>
    <ol class="stappen">
      <li>Klantenportaal van je waterbedrijf → Evolutie van je waterverbruik → exporteer als CSV.</li>
      <li>Kies <b>per uur</b> en de periode vanaf je laatste export. Het portaal gaat maximaal 6 maanden terug.</li>
    </ol>
    <p class="uitleg">Kies hieronder de bestanden; stroom, gas en water mogen samen. De app herkent zelf welk bestand wat is. Dubbele dagen worden overschreven.</p>
    <label class="knop">Bestanden kiezen<input id="bestanden" type="file" accept=".csv,text/csv" multiple hidden></label>
    ${imps.length ? `<ul class="importlijst">${imps.map((x) => `<li class="${x.fout ? 'fout' : ''}"><b>${esc(x.naam)}</b><br>${
      x.fout ? esc(x.fout) : `${x.soort}, ${x.resolutie}: ${x.aantalDagen} dagen (${datumJaar(x.van)} – ${datumJaar(x.tot)})`}</li>`).join('')}</ul>
      <button type="button" class="knop primair" id="opslaan" ${state.bezig || !imps.some((x) => !x.fout) ? 'disabled' : ''}>${state.bezig ? 'Bezig…' : 'Opslaan'}</button>` : ''}
    ${state.melding ? `<p class="melding">${esc(state.melding)}</p>` : ''}
  </section>
  <form class="kaart" data-id="instellingen" id="instellingen">
    <h2>Instellingen</h2>
    <label class="veld"><span>Aantal bewoners</span><input name="bewoners" type="number" inputmode="numeric" step="1" min="1" max="20" value="${esc(i.bewoners ?? '')}"></label>
    <label class="veld"><span>Maandelijks voorschot (€, incl. btw)</span><input name="voorschot" type="number" inputmode="decimal" step="0.01" min="0" value="${esc(i.voorschot ?? '')}"></label>
    <label class="veld"><span>Afrekeningsperiode begint in</span><select name="startMaand">${MAAND_VOL.map((m, n) => `<option value="${n + 1}" ${(+(i.startMaand ?? 4)) === n + 1 ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
    <label class="veld"><span>Vaste stroomprijs om te vergelijken (c€/kWh incl. btw)</span><input name="vasteStroomprijs" type="number" inputmode="decimal" step="0.01" min="0" value="${esc(i.vasteStroomprijs ?? '')}"></label>
    <label class="veld"><span>Vaste gasprijs om te vergelijken (c€/kWh incl. btw)</span><input name="vasteGasprijs" type="number" inputmode="decimal" step="0.01" min="0" value="${esc(i.vasteGasprijs ?? '')}"></label>
    <button type="submit" class="knop">Bewaren</button>
    ${state.instMelding ? `<p class="melding">${esc(state.instMelding)}</p>` : ''}
  </form>
  ${plaatsKaart()}
  <section class="kaart" data-id="account">
    <h2>Account</h2>
    <p class="uitleg">Aangemeld als ${esc(state.user.email || state.user.displayName || '')}. ${Object.keys(state.data.dagen).length} dagen opgeslagen.</p>
    <div class="knoppen">
      <button type="button" class="knop" id="export-csv">Download per dag (CSV)</button>
      <button type="button" class="knop" id="export-json">Download alles (back-up)</button>
    </div>
    ${state.user.demo ? '' : '<button type="button" class="knop" id="afmelden">Afmelden</button>'}
  </section>`;
}

async function bewaarInst(extra, veld) {
  const nieuw = { ...state.instellingen, ...extra };
  try {
    await store.bewaarInstellingen(state.user, nieuw);
    state.instellingen = nieuw; state[veld] = 'Bewaard.';
  } catch (err) { state[veld] = 'Bewaren mislukt: ' + err.message; }
  render(false);
}

// ---------- Export ----------
function exporteer(soort) {
  const { dagen, uren, suren, wuren, pieken } = state.data;
  const datum = new Date().toISOString().slice(0, 10);
  let inhoud, naam, type;
  if (soort === 'csv') {
    const getal = (v, d) => (v == null ? '' : String(+v.toFixed(d)).replace('.', ','));
    const regels = ['datum;stroom dag (kWh);stroom nacht (kWh);gas (m³);gas (kWh);water (liter)'];
    for (const d of Object.keys(dagen).sort()) {
      const v = dagen[d];
      regels.push([d, getal(v.sd, 3), getal(v.sn, 3), getal(v.gm, 3), getal(v.gk, 3), getal(v.wl, 0)].join(';'));
    }
    inhoud = '\uFEFF' + regels.join('\r\n'); naam = `verbruik-per-dag-${datum}.csv`; type = 'text/csv;charset=utf-8';
  } else {
    inhoud = JSON.stringify({ gemaakt: new Date().toISOString(), dagen, uren, suren, wuren, pieken, instellingen: state.instellingen }, null, 1);
    naam = `verbruik-backup-${datum}.json`; type = 'application/json';
  }
  const url = URL.createObjectURL(new Blob([inhoud], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: naam });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- weergave ----------
const ROUTES = { '': overzicht, stroom: () => energieScherm('stroom'), gas: () => energieScherm('gas'), water: () => energieScherm('water'), kosten: kostenScherm, import: importScherm };

function render(boven = true) {
  const route = location.hash.replace(/^#\/?/, '');
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('actief', a.getAttribute('href') === `#/${route}`));
  if (!state.user) { $view.innerHTML = state.gestart || state.fout ? loginScherm() : '<div class="laden">Laden…</div>'; return; }
  if (!state.data) { $view.innerHTML = '<div class="laden">Laden…</div>'; return; }
  const y = scrollY;
  $view.innerHTML = (ROUTES[route] || overzicht)();
  indelen(route);
  if (boven) scrollTo(0, 0); else scrollTo(0, y);
}

// ---------- Computer ----------
// Vaste indeling per scherm: elke rij bevat kaarten van dezelfde soort, zodat ze even hoog zijn.
// Een rij is een lijst van vakken; een vak is één kaart of een lijst kaarten onder elkaar.
const INDELING = {
  '': [['herinnering'], ['lekalarm'], ['contractstatus'], ['week'], ['ringen', 'kosten12', 'prognose']],
  stroom: [['jaren'], ['maand', 'jaar'], ['uur', 'dagprofiel'], ['piek', ['sluip', 'dagnacht']], ['drukste']],
  gas: [['jaren', 'jaar'], ['maand', 'temp'], ['uur', 'dagprofiel']],
  water: [['jaren', 'jaar'], ['maand', ['lek', 'persoon']], ['uur', 'dagprofiel']],
  kosten: [['kmaand', 'kjaar'], ['split', 'prognose'], ['vastvar']],
  import: [['import', ['instellingen', 'plaats', 'account']]],
};
const COMPUTER = matchMedia('(min-width: 1100px)');
function indelen(route) {
  if (!COMPUTER.matches) return;
  const spec = INDELING[route] ?? INDELING[''];
  const kaarten = Object.fromEntries([...$view.querySelectorAll(':scope > [data-id]')].map((k) => [k.dataset.id, k]));
  const eerste = $view.querySelector(':scope > [data-id]');
  if (!eerste) return;
  const blok = document.createElement('div');
  blok.className = 'indeling';
  $view.insertBefore(blok, eerste);
  const gebruikt = new Set();
  const neem = (id) => { const k = kaarten[id]; if (k && !gebruikt.has(id)) { gebruikt.add(id); return k; } return null; };
  for (const rij of spec) {
    const vakken = rij.map((v) => {
      const ks = (Array.isArray(v) ? v : [v]).map(neem).filter(Boolean);
      if (!ks.length) return null;
      if (ks.length === 1) return ks[0];
      const st = document.createElement('div'); st.className = 'stapel'; st.append(...ks); return st;
    }).filter(Boolean);
    if (!vakken.length) continue;
    const r = document.createElement('div');
    r.className = 'rij'; r.style.setProperty('--n', vakken.length);
    r.append(...vakken); blok.append(r);
  }
  const rest = Object.keys(kaarten).filter((id) => !gebruikt.has(id)).map((id) => kaarten[id]);
  for (let i = 0; i < rest.length; i += 2) {
    const r = document.createElement('div'); r.className = 'rij';
    r.style.setProperty('--n', Math.min(2, rest.length - i)); r.append(...rest.slice(i, i + 2)); blok.append(r);
  }
}
COMPUTER.addEventListener('change', () => render(false));

function loginScherm() {
  if (state.fout === 'config') return '<section class="leeg"><h2>Firebase is nog niet ingesteld</h2><p>Vul <code>firebase-config.js</code> in (zie README).</p></section>';
  return `<section class="leeg login"><div class="logo" aria-hidden="true">${document.getElementById('logo').innerHTML}</div>
    <h1>Verbruik thuis</h1><p>Stroom, gas en kosten in één overzicht.</p>
    <button type="button" class="knop primair" id="aanmelden">Aanmelden met Google</button>
    ${state.fout ? `<p class="melding">${esc(state.fout)}</p>` : ''}</section>`;
}

async function laad() {
  state.data = null; render();
  const [data, inst] = await Promise.all([store.laadAlles(state.user), store.laadInstellingen(state.user).catch(() => ({}))]);
  state.data = data; state.instellingen = inst; state.temp = null; state.tempFout = null;
  render();
}

// ---------- acties ----------
document.addEventListener('click', async (e) => {
  const knop = e.target.closest('button');
  if (!knop) return;
  const { actie, waarde, soort } = knop.dataset;
  if (knop.id === 'aanmelden') {
    try { await store.login(); } catch (err) { state.fout = 'Aanmelden mislukt: ' + err.message; render(); }
  } else if (knop.id === 'export-csv' || knop.id === 'export-json') {
    exporteer(knop.id === 'export-csv' ? 'csv' : 'json');
  } else if (knop.id === 'afmelden') {
    await store.logout();
  } else if (knop.id === 'opslaan') {
    state.bezig = true; state.melding = null; render(false);
    try {
      const n = await store.bewaar(state.user, state.imports.filter((x) => !x.fout), state.data);
      state.imports = []; state.melding = `Opgeslagen (${n} maanden bijgewerkt).`; state.bezig = false;
      await laad();
    } catch (err) { state.bezig = false; state.melding = 'Opslaan mislukt: ' + err.message; render(false); }
  } else if (actie?.startsWith('jaar-')) {
    const s = actie.slice(5);
    const beschikbaar = A.jaren(state.data.dagen, ENERGIE[s].waarde);
    const huidig = new Set(gekozenJaren(s, beschikbaar));
    const j = +waarde;
    if (huidig.has(j)) { if (huidig.size > 1) huidig.delete(j); } else huidig.add(j);
    state.ui.jaren[s] = [...huidig];
    render(false);
  } else if (actie === 'plaats-kies') {
    const k = state.plaatsKeuzes?.[+waarde];
    if (!k) return;
    state.plaatsKeuzes = [];
    state.temp = null; state.tempFout = null;
    await bewaarInst({ plaats: { naam: k.naam, postcode: k.postcode, provincie: k.provincie, lat: k.lat, lon: k.lon } }, 'plaatsMelding');
  } else if (actie === 'kosten-jaar') {
    state.ui.kostenJaar = waarde; render(false);
  } else if (actie === 'uur-vorige') {
    state.ui.uurMaand[soort] = waarde || null; render(false);
  } else if (actie === 'uur-volgende') {
    state.ui.uurMaand[soort] = waarde === 'laatste' ? null : waarde; render(false);
  }
});

document.addEventListener('submit', async (e) => {
  const id = e.target.id;
  if (!['instellingen', 'plaatsform'].includes(id)) return;
  e.preventDefault();
  const fd = Object.fromEntries(new FormData(e.target).entries());
  const getal = (k) => (fd[k] === '' || fd[k] == null ? null : parseFloat(fd[k]));
  if (id === 'plaatsform') {
    state.plaatsMelding = null;
    try {
      const q = (fd.zoek || '').trim();
      const pc = /^\d{4}$/.test(q) ? q : null;
      state.plaatsKeuzes = await P.zoekPlaats(q, pc);
      if (!state.plaatsKeuzes.length) state.plaatsMelding = 'Niets gevonden. Probeer de naam van de gemeente.';
    } catch (err) { state.plaatsMelding = err.message; }
    render(false);
    return;
  }
  if (id === 'instellingen') {
    const data = { bewoners: null, voorschot: null, startMaand: 4, vasteStroomprijs: null, vasteGasprijs: null };
    for (const k of Object.keys(data)) data[k] = k === 'startMaand' ? +fd[k] : getal(k);
    await bewaarInst(data, 'instMelding');
  }
});

document.addEventListener('change', async (e) => {
  if (e.target.id === 'factuur') {
    const f = e.target.files[0];
    if (!f) return;
    state.plaatsMelding = 'Factuur lezen…'; state.plaatsKeuzes = []; render(false);
    try {
      const a = await P.adresUitFactuur(f);
      state.plaatsKeuzes = await P.zoekPlaats(a.gemeente, a.postcode);
      state.plaatsMelding = state.plaatsKeuzes.length ? `Gevonden op de factuur: ${a.postcode} ${a.gemeente}. Kies hieronder.` : `Gevonden op de factuur: ${a.postcode} ${a.gemeente}, maar die gemeente kon niet opgezocht worden.`;
    } catch (err) { state.plaatsMelding = err.message; }
    render(false);
    return;
  }
  if (e.target.id !== 'bestanden') return;
  state.melding = null;
  state.imports = await Promise.all([...e.target.files].map(async (f) => {
    try { const t = await f.text(); return { naam: f.name, ...(isWater(t) ? parseWater(t) : parseFluvius(t, f.name)) }; }
    catch (err) { return { naam: f.name, fout: err.message }; }
  }));
  render(false);
});

// Tooltip bij aanraken of muis
const tip = document.getElementById('tip');
let actief = null;
function toonTip(e) {
  const el = e.target.closest?.('[data-tip]');
  if (actief && actief !== el) actief.classList.remove('actief');
  actief = el;
  if (!el) { tip.hidden = true; return; }
  el.classList.add('actief');
  tip.textContent = el.dataset.tip;
  tip.hidden = false;
  const x = Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8);
  tip.style.left = Math.max(8, x) + 'px';
  tip.style.top = Math.max(8, e.clientY - tip.offsetHeight - 12) + 'px';
}
document.addEventListener('pointermove', toonTip);
document.addEventListener('pointerdown', toonTip);
document.addEventListener('scroll', () => { tip.hidden = true; actief?.classList.remove('actief'); }, { passive: true });

window.addEventListener('hashchange', () => render());

store.init(async (u) => {
  state.user = u; state.gestart = true;
  if (u) { await kiesProfiel(u.email, !!u.demo); laad(); } else { await kiesProfiel(null); state.data = null; render(); }
}).catch((err) => { state.fout = err.message === 'config' ? 'config' : err.message; render(); });

render();

if ('serviceWorker' in navigator && !location.search.includes('demo')) {
  // Nieuwe versie geïnstalleerd: één keer herladen zodat je meteen de nieuwste app ziet.
  const hadController = !!navigator.serviceWorker.controller;
  let herladen = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !herladen) { herladen = true; location.reload(); }
  });
  navigator.serviceWorker.register('sw.js').then((reg) => reg.update()).catch(() => {});
}
