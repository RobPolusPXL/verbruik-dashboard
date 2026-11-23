// Opslag: Firebase (Auth + Firestore) of, met ?demo in de URL, een lokaal bestand voor testen.
// Firestore-structuur: users/{uid}/maanden/{YYYY-MM} = { dagen: { 'YYYY-MM-DD': {sd,sn,gm,gk,gbron} },
//                                                       uren: { 'YYYY-MM-DD': [24 × m³] }, piek: kW }

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
const DEMO = typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo');

let fb = null; // { auth, db, a: authModule, f: firestoreModule }

export async function init(onUser) {
  if (DEMO) { onUser({ uid: 'demo', displayName: 'Demo', demo: true }); return; }
  const { firebaseConfig } = await import('../firebase-config.js');
  if (!firebaseConfig || !firebaseConfig.apiKey) throw new Error('config');
  const [{ initializeApp }, a, f] = await Promise.all([
    import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`), import(`${SDK}/firebase-firestore.js`),
  ]);
  const app = initializeApp(firebaseConfig);
  const auth = a.getAuth(app);
  const db = f.initializeFirestore(app, { localCache: f.persistentLocalCache() });
  fb = { auth, db, a, f };
  a.getRedirectResult(auth).catch(() => {});
  a.onAuthStateChanged(auth, (u) => onUser(u));
}

export async function login() {
  const { auth, a } = fb;
  const provider = new a.GoogleAuthProvider();
  try { await a.signInWithPopup(auth, provider); }
  catch (e) {
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
      await a.signInWithRedirect(auth, provider);
    } else throw e;
  }
}

export async function logout() { if (fb) await fb.a.signOut(fb.auth); }

// Alles inlezen en samenvoegen tot { dagen, uren, pieken }.
export async function laadAlles(user) {
  let docs;
  if (user.demo) {
    const r = await fetch('demo-data.json', { cache: 'no-store' });
    docs = r.ok ? await r.json() : {};
  } else {
    const { db, f } = fb;
    const snap = await f.getDocs(f.collection(db, 'users', user.uid, 'maanden'));
    docs = {};
    snap.forEach((d) => { docs[d.id] = d.data(); });
  }
  const dagen = {}, uren = {}, pieken = {};
  for (const [ym, m] of Object.entries(docs)) {
    Object.assign(dagen, m.dagen || {});
    Object.assign(uren, m.uren || {});
    if (m.piek != null) pieken[ym] = m.piek;
  }
  return { dagen, uren, pieken };
}

// Geparste exports omzetten naar maanddocumenten.
// bestaand = huidige data (voor de voorrang van dag- boven uurwaarden bij gas, en de hoogste maandpiek).
export function bouwDocs(imports, bestaand) {
  const perMaand = {};
  const M = (ym) => (perMaand[ym] ||= { dagen: {}, uren: {} });
  for (const imp of imports) {
    for (const [d, v] of Object.entries(imp.dagen)) {
      const doel = M(d.slice(0, 7)).dagen;
      if (imp.soort === 'stroom') {
        doel[d] = { ...(doel[d] || {}), sd: v.sd ?? 0, sn: v.sn ?? 0 };
      } else {
        const dagBron = imp.resolutie === 'dag';
        const huidigeBron = doel[d]?.gbron ?? bestaand.dagen[d]?.gbron;
        if (dagBron || huidigeBron !== 'dag') {
          doel[d] = { ...(doel[d] || {}), gbron: dagBron ? 'dag' : 'uur' };
          if (v.gm != null) doel[d].gm = v.gm;
          if (v.gk != null) doel[d].gk = v.gk;
        }
      }
    }
    for (const [d, a] of Object.entries(imp.uren)) M(d.slice(0, 7)).uren[d] = a;
    // Een export die midden in een maand begint, mag een hogere piek van die maand niet overschrijven.
    for (const [ym, p] of Object.entries(imp.pieken)) M(ym).piek = Math.max(p, M(ym).piek ?? 0, bestaand.pieken[ym] ?? 0);
  }
  // Afronden om de documenten klein te houden
  const r3 = (x) => Math.round(x * 1000) / 1000;
  for (const m of Object.values(perMaand)) {
    for (const v of Object.values(m.dagen)) for (const k of ['sd', 'sn', 'gm', 'gk']) if (v[k] != null) v[k] = r3(v[k]);
    for (const d of Object.keys(m.uren)) m.uren[d] = m.uren[d].map(r3);
    if (m.piek != null) m.piek = r3(m.piek);
    if (!Object.keys(m.uren).length) delete m.uren;
  }
  return perMaand;
}

// Een of meer geparste exports opslaan in Firestore. Geeft het aantal bijgewerkte maanden terug.
export async function bewaar(user, imports, bestaand) {
  const perMaand = bouwDocs(imports, bestaand);
  if (user.demo) return Object.keys(perMaand).length;
  const { db, f } = fb;
  const maanden = Object.entries(perMaand);
  for (let i = 0; i < maanden.length; i += 400) {
    const batch = f.writeBatch(db);
    for (const [ym, data] of maanden.slice(i, i + 400)) {
      batch.set(f.doc(db, 'users', user.uid, 'maanden', ym), data, { merge: true });
    }
    await batch.commit();
  }
  return maanden.length;
}
