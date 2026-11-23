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
  const max = Math.max(1, ...reeksen.flatMap((r) => r.waarden.filter((v) => v != null)));
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
  return `<svg class="grafiek" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${s}</svg>`;
}

// Gestapelde staven: [{ label, kort, delen: [{ waarde, kleur, naam }] }]
export function gestapeld(kolommen, fmt, label) {
  const W = 350, H = 170, onder = 18, boven = 6;
  const max = Math.max(1, ...kolommen.map((k) => k.delen.reduce((a, d) => a + (d.waarde || 0), 0)));
  const breed = W / kolommen.length, bw = breed * 0.72;
  const stap = Math.ceil(kolommen.length / 10);
  let s = '';
  kolommen.forEach((k, i) => {
    let y = H - onder;
    const x = i * breed + (breed - bw) / 2;
    const tot = k.delen.reduce((a, d) => a + (d.waarde || 0), 0);
    k.delen.forEach((d, j) => {
      if (!d.waarde) return;
      const h = (d.waarde / max) * (H - onder - boven);
      y -= h;
      const r = j === k.delen.length - 1 ? 3 : 0;
      s += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${(h - 1).toFixed(1)}" rx="${r}" fill="${d.kleur}"
        data-tip="${esc(`${k.label}: ${d.naam} ${fmt(d.waarde)} · totaal ${fmt(tot)}`)}"></rect>`;
    });
    if (i % stap === 0) s += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 4}" class="as">${esc(k.kort)}</text>`;
  });
  return `<svg class="grafiek" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${s}</svg>`;
}

// Lijnen per jaar over 12 maanden.
export function lijnen(reeksen, maandLabels, fmt, label) {
  const W = 350, H = 150, onder = 18, boven = 8;
  const alle = reeksen.flatMap((r) => r.waarden.filter((v) => v != null));
  const max = Math.max(1, ...alle) * 1.08;
  const x = (m) => 10 + m * ((W - 20) / 11);
  const y = (v) => H - onder - (v / max) * (H - onder - boven);
  let s = '';
  for (const r of reeksen) {
    const pts = r.waarden.map((v, m) => (v == null ? null : [x(m), y(v)])).filter(Boolean);
    if (pts.length > 1) s += `<polyline points="${pts.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="${r.kleur}" stroke-width="2" stroke-linejoin="round"></polyline>`;
    r.waarden.forEach((v, m) => {
      if (v != null) s += `<circle cx="${x(m).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4" fill="${r.kleur}" data-tip="${esc(`${maandLabels[m]} ${r.naam}: ${fmt(v)}`)}"></circle>`;
    });
  }
  maandLabels.forEach((l, m) => { s += `<text x="${x(m).toFixed(1)}" y="${H - 4}" class="as">${esc(l[0])}</text>`; });
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
