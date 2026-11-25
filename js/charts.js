// Kleine SVG-grafieken zonder bibliotheek. Elk element met data-tip toont een tooltip bij aanraken.

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Ring die vult naar het aandeel nu/vorig.
export function ring(frac, kleur, label, groot, klein) {
  const r = 50, omtrek = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(frac, 1));
  return `<div class="ring">
    <svg viewBox="0 0 120 120" role="img" aria-label="${esc(label)}">
      <circle cx="60" cy="60" r="${r}" class="ring-bg"></circle>
      <circle cx="60" cy="60" r="${r}" class="ring-fg" stroke="${kleur}"
        stroke-dasharray="${(f * omtrek).toFixed(1)} ${omtrek.toFixed(1)}" transform="rotate(-90 60 60)"></circle>
    </svg>
    <div class="ring-tekst"><b>${esc(groot)}</b><span>${esc(klein)}</span></div>
  </div>`;
}

// Gegroepeerde staven: 12 maanden, één staaf per jaar.
// reeksen: [{ naam, kleur, waarden: [12] }], fmt: getal → tekst
export function gegroepeerd(reeksen, maandLabels, fmt, label) {
  const W = 350, H = 170, onder = 18, boven = 6;
  const max = Math.max(1e-6, ...reeksen.flatMap((r) => r.waarden.filter((v) => v != null)));
  const groep = W / 12, binnen = groep * 0.78, sw = binnen / reeksen.length;
  let s = '';
  for (let m = 0; m < 12; m++) {
    reeksen.forEach((r, i) => {
      const v = r.waarden[m];
      if (v == null || v === 0) return;
      const h = (v / max) * (H - onder - boven);
      const x = m * groep + (groep - binnen) / 2 + i * sw;
      s += `<rect x="${x.toFixed(1)}" y="${(H - onder - h).toFixed(1)}" width="${(sw - 1).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${r.kleur}" data-tip="${esc(`${maandLabels[m]} ${r.naam}: ${fmt(v)}`)}"></rect>`;
    });
    s += `<text x="${(m * groep + groep / 2).toFixed(1)}" y="${H - 4}" class="as">${esc(maandLabels[m][0])}</text>`;
  }
  s += kolommen(12, groep, H, (m) => {
    const regels = reeksen.filter((r) => r.waarden[m] != null && r.waarden[m] !== 0).map((r) => `${r.naam}: ${fmt(r.waarden[m])}`);
    return regels.length ? `${maandLabels[m]}\n${regels.join('\n')}` : null;
  });
  return `<svg class="grafiek" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${s}</svg>`;
}

// Onzichtbare vlakken over de volle hoogte van elke kolom, zodat je op een gsm makkelijk een maand aantikt.
function kolommen(n, breed, H, tekst, x0 = 0) {
  let s = '';
  for (let i = 0; i < n; i++) {
    const t = tekst(i);
    if (t) s += `<rect class="kolom" x="${(x0 + i * breed).toFixed(1)}" y="0" width="${breed.toFixed(1)}" height="${H}" data-tip="${esc(t)}"></rect>`;
  }
  return s;
}

// Gestapelde staven: [{ label, kort, delen: [{ waarde, kleur, naam }] }]
export function gestapeld(kolommen_, fmt, label) {
  const kolommenLijst = kolommen_;
  const W = 350, H = 170, onder = 18, boven = 6;
  const max = Math.max(1, ...kolommenLijst.map((k) => k.delen.reduce((a, d) => a + (d.waarde || 0), 0)));
  const breed = W / kolommenLijst.length, bw = breed * 0.72;
  const stap = Math.ceil(kolommenLijst.length / 10);
  let s = '';
  kolommenLijst.forEach((k, i) => {
    let y = H - onder;
    const x = i * breed + (breed - bw) / 2;
    const tot = k.delen.reduce((a, d) => a + (d.waarde || 0), 0);
    const bovenste = k.delen.findLastIndex((d) => d.waarde);
    k.delen.forEach((d, j) => {
      if (!d.waarde) return;
      const h = (d.waarde / max) * (H - onder - boven);
      y -= h;
      const r = j === bovenste ? 3 : 0;
      s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, h - 1).toFixed(1)}" rx="${r}" fill="${d.kleur}"${k.onvolledig ? ' fill-opacity="0.45"' : ''}></rect>`;
    });
    if (i % stap === 0) s += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 4}" class="as">${esc(k.kort)}</text>`;
  });
  s += kolommen(kolommen_.length, breed, H, (i) => {
    const k = kolommen_[i];
    const tot = k.delen.reduce((a, d) => a + (d.waarde || 0), 0);
    if (!tot) return null;
    const delen = k.delen.filter((d) => d.waarde);
    return `${k.label}${k.onvolledig ? ' (onvolledig)' : ''}\n${delen.map((d) => `${d.naam}: ${fmt(d.waarde)}`).join('\n')}${delen.length > 1 ? `\ntotaal: ${fmt(tot)}` : ''}`;
  });
  return `<svg class="grafiek" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${s}</svg>`;
}

// Lijnen per jaar over 12 maanden.
export function lijnen(reeksen, maandLabels, fmt, label) {
  const W = 350, H = 150, onder = 18, boven = 8;
  const alle = reeksen.flatMap((r) => r.waarden.filter((v) => v != null));
  const min = Math.min(0, ...alle);
  const max = Math.max(1, ...alle) * 1.08;
  const x = (m) => 10 + m * ((W - 20) / 11);
  const y = (v) => H - onder - ((v - min) / (max - min)) * (H - onder - boven);
  let s = '';
  for (const r of reeksen) {
    const pts = r.waarden.map((v, m) => (v == null ? null : [x(m), y(v)])).filter(Boolean);
    if (pts.length > 1) s += `<polyline points="${pts.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="${r.kleur}" stroke-width="2" stroke-linejoin="round"></polyline>`;
    r.waarden.forEach((v, m) => {
      if (v != null) s += `<circle cx="${x(m).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4" fill="${r.kleur}" data-tip="${esc(`${maandLabels[m]} ${r.naam}: ${fmt(v)}`)}"></circle>`;
    });
  }
  maandLabels.forEach((l, m) => { s += `<text x="${x(m).toFixed(1)}" y="${H - 4}" class="as">${esc(l[0])}</text>`; });
  const stapX = (W - 20) / 11;
  s += kolommen(12, stapX, H, (m) => {
    const regels = reeksen.filter((r) => r.waarden[m] != null).map((r) => `${r.naam}: ${fmt(r.waarden[m])}`);
    return regels.length ? `${maandLabels[m]}\n${regels.join('\n')}` : null;
  }, 10 - stapX / 2);
  return `<svg class="grafiek" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${s}</svg>`;
}

// Heatmap per uur: rijen [{ label, waarden: [24] }]
export function heatmap(rijen, kleurRgb, fmt, label) {
  const max = Math.max(0.0001, ...rijen.flatMap((r) => r.waarden));
  const cellen = rijen.map((r) => `<div class="hm-rij"><span>${esc(r.label)}</span><div class="hm-cellen">${
    r.waarden.map((v, u) => `<i style="background: rgba(${kleurRgb}, ${(0.07 + 0.93 * Math.min(v / max, 1)).toFixed(2)})" data-tip="${esc(`${r.label} ${u}u–${u + 1}u: ${fmt(v)}`)}"></i>`).join('')
  }</div></div>`).join('');
  return `<div class="heatmap" role="img" aria-label="${esc(label)}">${cellen}
    <div class="hm-as"><span>0u</span><span>6u</span><span>12u</span><span>18u</span><span>24u</span></div></div>`;
}

// Gemiddelde dag: 24 uurwaarden als lijn met vlak eronder.
export function dagprofiel(waarden, kleur, fmt, label) {
  const W = 350, H = 120, onder = 18, boven = 8;
  const max = Math.max(0.0001, ...waarden) * 1.1;
  const x = (u) => 8 + u * ((W - 16) / 23);
  const y = (v) => H - onder - (v / max) * (H - onder - boven);
  const pts = waarden.map((v, u) => `${x(u).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  let s = `<polygon points="${x(0).toFixed(1)},${H - onder} ${pts} ${x(23).toFixed(1)},${H - onder}" fill="${kleur}" fill-opacity="0.18"></polygon>`;
  s += `<polyline points="${pts}" fill="none" stroke="${kleur}" stroke-width="2" stroke-linejoin="round"></polyline>`;
  [0, 6, 12, 18, 23].forEach((u) => { s += `<text x="${x(u).toFixed(1)}" y="${H - 4}" class="as">${u === 23 ? '23u' : u + 'u'}</text>`; });
  const breed = (W - 16) / 23;
  waarden.forEach((v, u) => { s += `<rect class="kolom" x="${(x(u) - breed / 2).toFixed(1)}" y="0" width="${breed.toFixed(1)}" height="${H}" data-tip="${esc(`${u}u–${u + 1}u: gemiddeld ${fmt(v)}`)}"></rect>`; });
  return `<svg class="grafiek" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${s}</svg>`;
}
