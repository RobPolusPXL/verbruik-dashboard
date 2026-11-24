import * as store from './store.js';
import { parseFluvius } from './fluvius.js';
import { kostenPerMaand } from './kosten.js';
import { BELPEX_RLP } from './indexen.js';
import { NET, MIN_PIEK } from './tarieven.js';
import * as A from './berekeningen.js';
import { esc, ring, gegroepeerd, gestapeld, lijnen, heatmap, dagprofiel } from './charts.js';

const KLEUR = { stroom: '#F5C542', gas: '#FF8A4C', ok: '#5BD68A', slecht: '#F2A65A' };
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
  weer: null, weerFout: null, weerBezig: false,
};

const ENERGIE = {
  stroom: { naam: 'Stroom', waarde: A.stroomKwh, eenheid: 'kWh', fmt: f0, fmtD: f1, kleur: KLEUR.stroom, rgb: '245, 197, 66' },
  gas: { naam: 'Gas', waarde: A.gasM3, eenheid: 'm³', fmt: f1, fmtD: f2, kleur: KLEUR.gas, rgb: '255, 138, 76' },
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
  const p = A.prognose(state.data, state.instellingen);
  const kern = kernConclusie(s);

  return `
  <header class="kop"><div class="sub">${DAG[nu.getDay()]} ${nu.getDate()} ${MND[nu.getMonth()]}</div><h1>Thuis</h1></header>
  <div class="tegels">
    ${s ? `<a class="tegel" href="#/stroom"><div class="tl"><i style="background:${KLEUR.stroom}"></i>Stroom</div>
      <div class="tw">${f1(A.stroomKwh(dagen[s.laatste]))}<small>kWh</small></div><div class="td">${datumKort(s.laatste)}</div></a>` : ''}
    ${g ? `<a class="tegel" href="#/gas"><div class="tl"><i style="background:${KLEUR.gas}"></i>Gas</div>
      <div class="tw">${f1(A.gasM3(dagen[g.laatste]))}<small>m³</small></div><div class="td">${datumKort(g.laatste)}</div></a>` : ''}
    ${ymNu ? `<a class="tegel" href="#/stroom"><div class="tl"><i style="background:${KLEUR.stroom}"></i>Piek</div>
      <div class="tw">${f2(pieken[ymNu])}<small>kW</small></div><div class="td">${maandLang(ymNu)}</div></a>` : ''}
  </div>
  ${kern ? `<section class="kaart kern">${conclusies([kern])}</section>` : ''}

  ${s || g ? `<section class="kaart">
    <div class="kaart-kop"><h2>Dit jaar tegen vorig jaar</h2><span>t.e.m. ${datumKort((g || s).laatste)}</span></div>
    <div class="ringen">${g ? ringBlok('Gas', g, 'm³', KLEUR.gas) : ''}${s ? ringBlok('Stroom', s, 'kWh', KLEUR.stroom) : ''}</div>
  </section>` : ''}

  ${k ? `<a class="kaart" href="#/kosten">
    <div class="kaart-kop"><h2>Kosten, laatste ${l12.length} maanden</h2><span>${maandLang(l12[0].maand)} – ${maandLang(l12.at(-1).maand)}</span></div>
    <div class="groot">${eur(k.stroom + k.gas)}</div>${splitBalk(k.split)}
  </a>` : ''}

  ${p ? prognoseKaart(p, true) : ''}`;
}

// Eén zin met het belangrijkste van het moment. In het stookseizoen: gas gecorrigeerd voor het weer.
function kernConclusie(s) {
  if (!state.weer && !state.weerFout && !state.weerBezig) laadWeer();
  if (state.weer) {
    const r = A.gasPerGraaddag(state.data.dagen, state.weer);
    if (r.recent && r.vorigJaar && r.recent.gd >= 60) {
      const pct = (r.recent.perGd / r.vorigJaar.perGd - 1) * 100;
      return { t: `Gecorrigeerd voor het weer verbruik je de laatste 30 dagen <b>${f1(Math.abs(pct))}% ${pct > 0 ? 'meer' : 'minder'} gas</b> dan dezelfde periode vorig jaar.`, toon: pct > 2 ? 'slecht' : pct < -2 ? 'ok' : undefined };
    }
  }
  if (s?.pct != null) return { t: `Dit jaar verbruik je <b>${f1(Math.abs(s.pct))}% ${s.pct > 0 ? 'meer' : 'minder'} stroom</b> dan vorig jaar over dezelfde periode.`, toon: s.pct > 2 ? 'slecht' : s.pct < -2 ? 'ok' : undefined };
  return null;
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
  return link ? `<a class="kaart" href="#/kosten">${inhoud}</a>` : `<section class="kaart">${inhoud}</section>`;
}

// ---------- Stroom en gas ----------
// Dit jaar tegen elk vorig jaar, telkens over dezelfde periode, als ringen.
function jarenRingen(dagen, e, y) {
  const jaren = A.zelfdePeriode(dagen, e.waarde);
  const nu = jaren.find((j) => j.jaar === y.jaar);
  const vorige = jaren.filter((j) => j.jaar < y.jaar).reverse();
  if (!nu || !vorige.length) return '';
  return `<section class="kaart"><div class="kaart-kop"><h2>${y.jaar} tegen vorige jaren</h2><span>1 jan – ${datumKort(y.laatste)}</span></div>
    <div class="ringen">${vorige.map((v) => {
      const pct = (nu.totaal / v.totaal - 1) * 100;
      return `<div class="ring-blok">
        ${ring(nu.totaal / v.totaal, e.kleur, `${y.jaar}: ${e.fmt(nu.totaal)} ${e.eenheid}, ${v.jaar}: ${e.fmt(v.totaal)} ${e.eenheid}`, `${pct > 0 ? '+' : '−'}${f1(Math.abs(pct))}%`, `t.o.v. ${v.jaar}`)}
        <div class="ring-sub">${e.fmt(v.totaal)} ${e.eenheid}<br><span>in ${v.jaar}</span></div></div>`;
    }).join('')}</div></section>`;
}

function uurKaart(soort, uren, e, eenheidUur) {
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
  return `<section class="kaart uur">
    <div class="kaart-kop bladeren">
      <button type="button" class="pijl" data-actie="uur-vorige" data-soort="${soort}" data-waarde="${vorige ?? ''}" ${vorige ? '' : 'disabled'} aria-label="Vorige maand">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg></button>
      <h2>Per uur · ${esc(titel)}</h2>
      <button type="button" class="pijl" data-actie="uur-volgende" data-soort="${soort}" data-waarde="${volgende ?? ''}" ${volgende ? '' : 'disabled'} aria-label="Volgende">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>
    </div>
    ${heatmap(dagenLijst.map((d) => ({ label: datumKort(d), waarden: uren[d] })), e.rgb, (v) => `${f2(v)} ${eenheidUur}`, `${e.naam} per uur, één rij per dag`)}
    <h3 class="tussenkop">Gemiddelde dag</h3>
    ${dagprofiel(gem, e.kleur, (v) => `${f2(v)} ${eenheidUur}`, `Gemiddeld ${e.naam.toLowerCase()}verbruik per uur van de dag`)}
    ${conclusies(A.uurConclusies(soort, dagenLijst, uren, state.data.dagen, state.weer, (v) => `${f2(v)} ${eenheidUur}`))}
  </section>`;
}

function energieScherm(soort) {
  const e = ENERGIE[soort];
  const { dagen, pieken, uren, suren } = state.data;
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
    const pc = A.piekConclusie(pieken, (NET.stroom[new Date().getFullYear()] ?? Object.values(NET.stroom).at(-1)).capaciteit, MIN_PIEK);
    const top = A.uitschieters(dagen, A.stroomKwh);
    extra = `
    ${piekReeksen.length ? `<section class="kaart"><div class="kaart-kop"><h2>Maandpiek</h2>${legende(piekReeksen)}</div>
      <p class="uitleg">Hoogste kwartiervermogen per maand. Telt mee in het capaciteitstarief.</p>
      ${lijnen(piekReeksen, MND, (v) => `${f2(v)} kW`, 'Maandpiek per jaar')}
      ${pc ? conclusies([
        { t: `Je hoogste piek van de laatste 12 maanden was <b>${f2(pc.topKw)} kW</b> in ${maandVol(pc.top)}.` },
        { t: `Je capaciteitstarief rekent met het gemiddelde van die 12 pieken: <b>${f2(pc.rollend)} kW</b>, ongeveer <b>${eur0(pc.kost)}</b> per jaar. Elke kW lager scheelt <b>${eur0(pc.perKw)}</b> per jaar: niet tegelijk koken, wassen en drogen helpt.` },
      ]) : ''}</section>` : ''}
    ${top ? `<section class="kaart"><div class="kaart-kop"><h2>Drukste dagen</h2><span>laatste 12 maanden</span></div>
      ${conclusies(top.top.map(([d, v]) => ({ t: `<b>${DAG[new Date(d + 'T12:00:00Z').getUTCDay()]} ${datumJaar(d)}</b>: ${f1(v)} kWh, ${f1(v / top.mediaan)}× een gewone dag (${f1(top.mediaan)} kWh)` })))}</section>` : ''}
    <section class="kaart"><div class="kaart-kop"><h2>Sluipverbruik</h2>${sluip ? `<span>laatste ${sluip.nachten} nachten</span>` : ''}</div>
      ${sluip ? `<div class="groot">${f0(sluip.watt)}<small>W</small></div>
        <p class="uitleg">Zoveel verbruikt je huis zelfs 's nachts, als alles uit lijkt: koelkast, diepvries, router, toestellen op stand-by.
        Die blijven ook overdag aanstaan, dus 24 uur op 24. Op een jaar is dat ongeveer <b>${f0(sluip.jaarKwh)} kWh</b>${sluip.jaarEur ? ` of <b>${eur0(sluip.jaarEur)}</b>` : ''}:
        <b>${f0(sluip.jaarKwh / (y.nu / y.detail.nu.aantalDagen * 365) * 100)}%</b> van al je stroom gaat naar toestellen die altijd aanstaan.</p>`
        : '<p class="uitleg">Laad je stroomexport met <b>kwartiertotalen</b> (opnieuw) in om je sluipverbruik te zien.</p>'}</section>
    <section class="kaart"><div class="kaart-kop"><h2>Dag en nacht, ${y.jaar}</h2></div>
      ${splitBalk([{ naam: 'Dag', v: dag, kleur: KLEUR.stroom }, { naam: 'Nacht', v: nacht, kleur: '#7A6A2E' }], (v) => `${f0(v)} kWh`)}</section>`;
  } else {
    extra = weerKaart();
  }

  const uurData = soort === 'gas' ? uren : suren;
  const uk = uurKaart(soort, uurData, e, soort === 'gas' ? 'm³' : 'kWh');

  return `${detailKop(e.naam)}
  <div class="kop-getal"><div class="groot" style="color:${e.kleur}">${e.fmt(y.nu)}<small>${e.eenheid}</small></div>
    <div>${delta(y.pct)} <span class="sub">t.o.v. ${y.jaar - 1}, t.e.m. ${datumKort(y.laatste)}</span></div></div>
  ${jarenRingen(dagen, e, y)}
  <section class="kaart"><div class="kaart-kop"><h2>Per maand</h2></div>${jaarChips}${legende(reeksen)}
    ${gegroepeerd(reeksen, MAAND_VOL, (v) => `${e.fmt(v)} ${e.eenheid}`, `${e.naam}verbruik per maand per jaar`)}</section>
  <section class="kaart"><div class="kaart-kop"><h2>Per jaar</h2></div>
    ${gestapeld(totalen.map((t) => ({ label: String(t.jaar), kort: `'${String(t.jaar).slice(2)}`, onvolledig: t.dagen < 365,
      delen: [{ naam: e.naam.toLowerCase(), waarde: t.som, kleur: e.kleur }] })), (v) => `${e.fmt(v)} ${e.eenheid}`, `${e.naam}verbruik per jaar`)}
    ${totalen.some((t) => t.dagen < 365) ? '<p class="uitleg">Lichtere staven zijn onvolledige jaren.</p>' : ''}</section>
  ${uk ?? (soort === 'stroom' ? '<section class="kaart"><p class="uitleg">Laad je stroomexport met <b>kwartiertotalen</b> (opnieuw) in om je verbruik per uur te zien.</p></section>'
    : '<section class="kaart"><p class="uitleg">Laad een gasexport met <b>uurtotalen</b> in om je verbruik per uur te zien.</p></section>')}
  ${extra}`;
}

// Gas gecorrigeerd voor het weer
function weerKaart() {
  if (!state.weer && !state.weerFout) {
    if (!state.weerBezig) laadWeer();
    return '<section class="kaart"><div class="kaart-kop"><h2>Gas per graaddag</h2></div><p class="uitleg">Weergegevens laden…</p></section>';
  }
  if (state.weerFout) return `<section class="kaart"><div class="kaart-kop"><h2>Gas per graaddag</h2></div><p class="uitleg">${esc(state.weerFout)}</p></section>`;
  const r = A.gasPerGraaddag(state.data.dagen, state.weer);
  const beschikbaar = [...new Set(Object.keys(r.perMaand).map((m) => +m.slice(0, 4)))].sort();
  const reeksen = jaarReeksen(r.perMaand, gekozenJaren('gas', beschikbaar).filter((j) => beschikbaar.includes(j)), KLEUR.gas);
  const pct = r.recent && r.vorigJaar ? (r.recent.perGd / r.vorigJaar.perGd - 1) * 100 : null;
  return `<section class="kaart"><div class="kaart-kop"><h2>Gas per graaddag</h2></div>
    <p class="uitleg">Je gasverbruik gedeeld door hoe koud het was. Zo vergelijk je eerlijk, los van een zachte of strenge winter: lager is zuiniger.</p>
    ${r.recent ? `<div class="vergelijk">
      <div><span>Laatste 30 dagen</span><b>${f2(r.recent.perGd * 100)} <small>m³ / 100 gd</small></b></div>
      <div><span>Zelfde periode vorig jaar</span><b>${r.vorigJaar ? `${f2(r.vorigJaar.perGd * 100)} <small>m³ / 100 gd</small>` : '—'}</b></div>
    </div>${pct != null ? `<p class="uitleg">${delta(pct)} t.o.v. vorig jaar, gecorrigeerd voor de temperatuur.</p>` : ''}` : ''}
    ${reeksen.length ? `${legende(reeksen)}${gegroepeerd(reeksen, MAAND_VOL, (v) => `${f2(v * 100)} m³ per 100 graaddagen`, 'Gas per graaddag per maand')}
    <p class="uitleg">Alleen stookmaanden. Graaddagen t.o.v. 16,5 °C, temperatuur in Zonhoven via Open-Meteo.</p>` : ''}
  </section>`;
}

async function laadWeer() {
  state.weerBezig = true;
  try {
    const van = Object.keys(state.data.dagen).filter((d) => state.data.dagen[d].gm != null).sort()[0];
    const tot = Object.keys(state.data.dagen).sort().at(-1);
    state.weer = await A.haalTemperaturen(van, tot);
  } catch (e) {
    state.weerFout = 'Weergegevens konden niet geladen worden. Probeer later opnieuw.';
  }
  state.weerBezig = false;
  const r = location.hash.replace(/^#\/?/, '');
  if (r === 'gas' || r === '') render(false);
}

// ---------- Kosten ----------
function kostenScherm() {
  const { dagen, pieken } = state.data;
  const kosten = kostenPerMaand(dagen, pieken);
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
  const zonderIndex = selectie.filter((m) => !m.stroom && Object.keys(dagen).some((d) => d.startsWith(m.maand) && A.stroomKwh(dagen[d]) != null) && !BELPEX_RLP[m.maand]);
  const titel = keuze === 'laatste' ? `Laatste ${selectie.length} maanden` : `${keuze}${selectie.length < 12 ? ` (${selectie.length} maanden)` : ''}`;
  const p = A.prognose(state.data, state.instellingen);

  return `${detailKop('Kosten')}
  ${chips([{ waarde: 'laatste', label: '12 maanden' }, ...jaren.map((j) => ({ waarde: j, label: j }))], (w) => w === keuze, 'kosten-jaar', 'Periode')}
  ${k ? `<div class="kop-getal"><div class="sub">${esc(titel)}, incl. btw</div><div class="groot">${eur(k.stroom + k.gas)}</div>
    <div class="legende"><span><i style="background:${KLEUR.stroom}"></i>Stroom ${eur(k.stroom)}</span><span><i style="background:${KLEUR.gas}"></i>Gas ${eur(k.gas)}</span></div></div>` : ''}
  <section class="kaart"><div class="kaart-kop"><h2>Per maand</h2></div>
    ${gestapeld(kol, eur, 'Kosten per maand, stroom en gas gestapeld')}
    ${(() => { const c = A.kostenConclusies(selectie); return c ? conclusies([
      { t: `Duurste maand: <b>${maandVol(c.duurst.maand)}</b> (${eur0(c.duurst.eur)}), goedkoopste: <b>${maandVol(c.goedkoopst.maand)}</b> (${eur0(c.goedkoopst.eur)}).` },
      ...(c.winterAandeel != null ? [{ t: `December tot februari zijn samen goed voor <b>${Math.round(c.winterAandeel * 100)}%</b> van je gaskosten in deze periode.` }] : []),
    ]) : ''; })()}
    ${zonderIndex.length ? `<p class="uitleg">Stroom van ${zonderIndex.map((m) => maandLang(m.maand)).join(', ')} volgt zodra de beursindex van die maand gepubliceerd is.</p>` : ''}</section>
  ${k ? `<section class="kaart"><div class="kaart-kop"><h2>Waar betaal je voor?</h2></div>${splitBalk(k.split)}</section>` : ''}
  <section class="kaart"><div class="kaart-kop"><h2>Jaar na jaar</h2></div>
    ${gestapeld(perJaar, eur, 'Kosten per jaar, stroom en gas gestapeld')}
    <p class="uitleg">Lichtere staven zijn onvolledige jaren. De kosten worden berekend vanaf april 2025.</p></section>
  ${p ? prognoseKaart(p, false) : `<section class="kaart"><h2>Verwachte jaarafrekening</h2><p class="uitleg">Vul je maandelijkse voorschot in bij <a href="#/import"><b>Gegevens</b></a> om te zien of je geld terugkrijgt of moet bijbetalen.</p></section>`}
  ${vastVariabelKaart(kosten)}
  <p class="uitleg los">Berekend per dag met de tariefkaart van je contract, de gepubliceerde beursindex van de maand en de nettarieven van Fluvius Limburg. April 2025 – maart 2026 is gecontroleerd met je jaarafrekening.</p>`;
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
  return `<section class="kaart"><div class="kaart-kop"><h2>Vast of variabel?</h2></div>${h}</section>`;
}

// ---------- Gegevens ----------
function importScherm() {
  const imps = state.imports, i = state.instellingen;
  return `${detailKop('Gegevens')}
  <section class="kaart">
    <h2>Fluvius-export inladen</h2>
    <ol class="stappen">
      <li>Mijn Fluvius → Verbruik → exporteer als CSV.</li>
      <li>Stroom: <b>kwartiertotalen</b>. Gas: <b>dagtotalen</b>, en <b>uurtotalen</b> voor de grafiek per uur.</li>
      <li>Kies hier de bestanden. Dubbele dagen worden overschreven.</li>
    </ol>
    <label class="knop">Bestanden kiezen<input id="bestanden" type="file" accept=".csv,text/csv" multiple hidden></label>
    ${imps.length ? `<ul class="importlijst">${imps.map((x) => `<li class="${x.fout ? 'fout' : ''}"><b>${esc(x.naam)}</b><br>${
      x.fout ? esc(x.fout) : `${x.soort}, ${x.resolutie}: ${x.aantalDagen} dagen (${datumJaar(x.van)} – ${datumJaar(x.tot)})`}</li>`).join('')}</ul>
      <button type="button" class="knop primair" id="opslaan" ${state.bezig || !imps.some((x) => !x.fout) ? 'disabled' : ''}>${state.bezig ? 'Bezig…' : 'Opslaan'}</button>` : ''}
    ${state.melding ? `<p class="melding">${esc(state.melding)}</p>` : ''}
  </section>
  <form class="kaart" id="instellingen">
    <h2>Instellingen</h2>
    <label class="veld"><span>Maandelijks voorschot (€, incl. btw)</span><input name="voorschot" type="number" inputmode="decimal" step="0.01" min="0" value="${esc(i.voorschot ?? '')}"></label>
    <label class="veld"><span>Afrekeningsperiode begint in</span><select name="startMaand">${MAAND_VOL.map((m, n) => `<option value="${n + 1}" ${(+(i.startMaand ?? 4)) === n + 1 ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
    <label class="veld"><span>Vaste stroomprijs om te vergelijken (c€/kWh incl. btw)</span><input name="vasteStroomprijs" type="number" inputmode="decimal" step="0.01" min="0" value="${esc(i.vasteStroomprijs ?? '')}"></label>
    <label class="veld"><span>Vaste gasprijs om te vergelijken (c€/kWh incl. btw)</span><input name="vasteGasprijs" type="number" inputmode="decimal" step="0.01" min="0" value="${esc(i.vasteGasprijs ?? '')}"></label>
    <button type="submit" class="knop">Bewaren</button>
    ${state.instMelding ? `<p class="melding">${esc(state.instMelding)}</p>` : ''}
  </form>
  <section class="kaart">
    <h2>Account</h2>
    <p class="uitleg">Aangemeld als ${esc(state.user.email || state.user.displayName || '')}. ${Object.keys(state.data.dagen).length} dagen opgeslagen.</p>
    ${state.user.demo ? '' : '<button type="button" class="knop" id="afmelden">Afmelden</button>'}
  </section>`;
}

// ---------- weergave ----------
const ROUTES = { '': overzicht, stroom: () => energieScherm('stroom'), gas: () => energieScherm('gas'), kosten: kostenScherm, import: importScherm };

function render(boven = true) {
  const route = location.hash.replace(/^#\/?/, '');
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('actief', a.getAttribute('href') === `#/${route}`));
  if (!state.user) { $view.innerHTML = state.gestart || state.fout ? loginScherm() : '<div class="laden">Laden…</div>'; return; }
  if (!state.data) { $view.innerHTML = '<div class="laden">Laden…</div>'; return; }
  const y = scrollY;
  $view.innerHTML = (ROUTES[route] || overzicht)();
  if (boven) scrollTo(0, 0); else scrollTo(0, y);
}

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
  state.data = data; state.instellingen = inst; state.weer = null; state.weerFout = null;
  render();
}

// ---------- acties ----------
document.addEventListener('click', async (e) => {
  const knop = e.target.closest('button');
  if (!knop) return;
  const { actie, waarde, soort } = knop.dataset;
  if (knop.id === 'aanmelden') {
    try { await store.login(); } catch (err) { state.fout = 'Aanmelden mislukt: ' + err.message; render(); }
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
  } else if (actie === 'kosten-jaar') {
    state.ui.kostenJaar = waarde; render(false);
  } else if (actie === 'uur-vorige') {
    state.ui.uurMaand[soort] = waarde || null; render(false);
  } else if (actie === 'uur-volgende') {
    state.ui.uurMaand[soort] = waarde === 'laatste' ? null : waarde; render(false);
  }
});

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'instellingen') return;
  e.preventDefault();
  const fd = new FormData(e.target);
  const data = {};
  for (const [k, v] of fd.entries()) if (v !== '') data[k] = k === 'startMaand' ? +v : parseFloat(v);
  try {
    await store.bewaarInstellingen(state.user, data);
    state.instellingen = data; state.instMelding = 'Bewaard.';
  } catch (err) { state.instMelding = 'Bewaren mislukt: ' + err.message; }
  render(false);
});

document.addEventListener('change', async (e) => {
  if (e.target.id !== 'bestanden') return;
  state.melding = null;
  state.imports = await Promise.all([...e.target.files].map(async (f) => {
    try { return { naam: f.name, ...parseFluvius(await f.text(), f.name) }; }
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

store.init((u) => {
  state.user = u; state.gestart = true;
  if (u) laad(); else { state.data = null; render(); }
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
