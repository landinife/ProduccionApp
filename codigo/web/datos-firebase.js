// ===== Capa de datos de ProducciónApp en Firebase =====
// Todo lo que toca Firebase está en este archivo. Para mudar la app a otro proyecto alcanza con cambiar `config`.
import {
  initializeApp, getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, signOut,
  sendPasswordResetEmail, createUserWithEmailAndPassword, initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, collection, onSnapshot, writeBatch, query, orderBy, limit, FieldPath, deleteField, setDoc
} from './sdk.js';

const config = {
  apiKey: 'AIzaSyBgZLlQqkzYFMjMPWupO5R7nhVyNR_s8Lk',
  authDomain: 'tpfapps-5f226.firebaseapp.com',
  projectId: 'tpfapps-5f226',
  storageBucket: 'tpfapps-5f226.firebasestorage.app',
  messagingSenderId: '177510210481',
  appId: '1:177510210481:web:674465a1b8ce81a340fb90'
};
export const DUENO = 'flandinitpf@gmail.com';   // administrador fijo (también figura en las reglas)

const app = initializeApp(config);
const auth = getAuth(app);
const alta = getAuth(initializeApp(config, 'alta'));   // segunda conexión, solo para crear cuentas sin cerrar tu sesión
let db;
try { db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
catch (e) { db = initializeFirestore(app, {}); }   // sin guardado local (navegador en modo privado, por ejemplo)

const C = {
  cfg: doc(db, 'produccion_config', 'main'),
  tareas: collection(db, 'produccion_tareas'),
  usuarios: collection(db, 'produccion_usuarios'),
  log: collection(db, 'produccion_log')
};
const CFG = ['cfg', 'operarios', 'operaciones', 'codigos', 'materiales', 'cotizaciones', 'feriados', 'ausencias', 'proyectos', 'ejemplo'];
const MAPAS = ['extras', 'extraModo'];
const limpio = o => JSON.parse(JSON.stringify(o === undefined ? null : o));

// ---------- sesión ----------
const errAuth = e => {
  const c = (e && e.code) || '';
  if (c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request') return null;
  if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-email'].includes(c)) return 'Mail o contraseña incorrectos.';
  if (c === 'auth/too-many-requests') return 'Demasiados intentos. Esperá unos minutos y probá de nuevo.';
  if (c === 'auth/unauthorized-domain') return 'Falta autorizar este sitio en Firebase: Authentication → Configuración (Settings) → Dominios autorizados (Authorized domains).';
  if (c === 'auth/network-request-failed') return 'Sin conexión a internet.';
  if (c === 'auth/email-already-in-use') return 'Ese mail ya tiene cuenta.';
  if (c === 'auth/weak-password') return 'La contraseña tiene que tener al menos 6 caracteres.';
  return 'No se pudo completar: ' + (e && e.message ? e.message : c);
};
export const onAuth = f => onAuthStateChanged(auth, f);
export async function google() { try { const p = new GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' }); await signInWithPopup(auth, p); return null; } catch (e) { const m = errAuth(e); return m && { error: m }; } }
export async function entrar(mail, pass) { try { await signInWithEmailAndPassword(auth, mail, pass); return null; } catch (e) { return { error: errAuth(e) }; } }
export async function reset(mail) { try { await sendPasswordResetEmail(auth, mail); return { ok: `Te mandamos un mail a ${mail} para elegir una contraseña nueva.` }; } catch (e) { return { error: errAuth(e) }; } }
export async function salir() { detener(); await signOut(auth); }
export async function crearCuenta(mail, pass) {
  if (!pass) return {};
  try { await createUserWithEmailAndPassword(alta, mail, pass); await signOut(alta); return {}; }
  catch (e) { if (e.code === 'auth/email-already-in-use') return { existia: true }; return { error: errAuth(e) }; }
}

// ---------- lectura en vivo ----------
let estado = { fase: 'cargando' }; const subs = new Set();
const emitir = x => { estado = { ...estado, ...x }; subs.forEach(f => f(estado)); };
export const onEstado = f => { subs.add(f); f(estado); return () => subs.delete(f); };
let partes, desub = [];
export function detener() { desub.forEach(u => u()); desub = []; estado = { fase: 'cargando' }; }
export function iniciar() {
  detener(); partes = { cfg: undefined, tareas: new Map(), tareasOk: false, usuarios: undefined, log: undefined };
  const falla = e => emitir({ fase: e && e.code === 'permission-denied' ? 'sinacceso' : 'error', error: e && e.message });
  const listo = snap => {
    if (partes.cfg === undefined || !partes.tareasOk || partes.usuarios === undefined || partes.log === undefined) return;
    if (partes.cfg === null) { emitir({ fase: 'sinconfig' }); return; }
    const S = { v: 1, extras: {}, extraModo: {}, ausencias: [], proyectos: [], ...partes.cfg, tareas: [...partes.tareas.values()].sort((a, b) => (a._n || 0) - (b._n || 0)), usuarios: partes.usuarios, log: partes.log };
    emitir({ fase: 'listo', S, remoto: !snap.metadata.hasPendingWrites });
  };
  desub.push(onSnapshot(C.usuarios, s => { partes.usuarios = s.docs.map(d => ({ ...d.data(), id: d.id, email: d.id })).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '')); listo(s); }, falla));
  desub.push(onSnapshot(C.cfg, s => { partes.cfg = s.exists() ? s.data() : null; listo(s); }, falla));
  desub.push(onSnapshot(C.tareas, s => { s.docChanges().forEach(ch => { if (ch.type === 'removed') partes.tareas.delete(ch.doc.id); else partes.tareas.set(ch.doc.id, { ...ch.doc.data(), id: ch.doc.id }); }); partes.tareasOk = true; listo(s); }, falla));
  desub.push(onSnapshot(query(C.log, orderBy('ts', 'desc'), limit(300)), s => { partes.log = s.docs.map(d => ({ ...d.data(), id: d.id })); listo(s); }, falla));
}
export const escuchar = cb => onEstado(e => { if (e.fase === 'listo') cb(e.S, e.remoto); });

// ---------- escritura: solo lo que cambió ----------
let seq = Date.now();
export function escribir(p, n, avisar) {
  const ops = [];
  const pt = new Map(p.tareas.map(t => [t.id, t])), nt = new Set(n.tareas.map(t => t.id));
  n.tareas.forEach(t => { const o = pt.get(t.id); if (o !== t) ops.push(b => b.set(doc(C.tareas, t.id), limpio({ ...t, _n: t._n || (o && o._n) || ++seq }))); });
  p.tareas.forEach(t => { if (!nt.has(t.id)) ops.push(b => b.delete(doc(C.tareas, t.id))); });
  const campos = [];
  CFG.forEach(k => { if (p[k] !== n[k]) campos.push(k, limpio(n[k])); });
  MAPAS.forEach(k => { const a = p[k] || {}, c = n[k] || {}; if (a === c) return; new Set([...Object.keys(a), ...Object.keys(c)]).forEach(key => { if (a[key] !== c[key]) campos.push(new FieldPath(k, key), c[key] === undefined ? deleteField() : c[key]); }); });
  if (campos.length) ops.push(b => b.update(C.cfg, ...campos));
  const pu = new Map((p.usuarios || []).map(u => [u.id, u])), nu = new Set((n.usuarios || []).map(u => u.id));
  (n.usuarios || []).forEach(u => { if (pu.get(u.id) !== u) { const { id, email, ...d } = u; ops.push(b => b.set(doc(C.usuarios, u.id.toLowerCase()), limpio(d))); } });
  (p.usuarios || []).forEach(u => { if (!nu.has(u.id)) ops.push(b => b.delete(doc(C.usuarios, u.id))); });
  const e = n.log && n.log[0], e0 = p.log && p.log[0];
  if (e && e !== e0 && e.id && (!e0 || e.ts >= e0.ts)) ops.push(b => b.set(doc(C.log, e.id), limpio({ ts: e.ts, email: e.email, quien: e.quien, k: e.k, txt: e.txt, uid: e.uid })));
  for (let i = 0; i < ops.length; i += 450) {
    const b = writeBatch(db); ops.slice(i, i + 450).forEach(f => f(b));
    b.commit().catch(err => avisar && avisar(err && err.code === 'permission-denied' ? 'No tenés permiso para guardar ese cambio. Se volvió a lo anterior.' : 'No se pudo guardar el cambio: ' + (err && err.message)));
  }
}

// ---------- primera vez: carga la base y el usuario dueño ----------
export async function inicializar(S, yo) {
  const b = writeBatch(db); const base = {};
  [...CFG, ...MAPAS].forEach(k => { base[k] = limpio(S[k] === undefined ? (MAPAS.includes(k) ? {} : null) : S[k]); });
  b.set(C.cfg, base);
  S.tareas.forEach((t, i) => b.set(doc(C.tareas, t.id), limpio({ ...t, _n: i + 1 })));
  b.set(doc(C.usuarios, yo.email), { nombre: yo.nombre, admin: true, rep: 'editar', proy: 'editar' });
  await b.commit();
}
export async function asegurarDueno(yo) { await setDoc(doc(C.usuarios, yo.email), { nombre: yo.nombre, admin: true, rep: 'editar', proy: 'editar' }, { merge: true }); }
