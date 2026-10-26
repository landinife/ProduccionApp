// ===== Motor de fechas, cargas y empuje (sin React: se puede reutilizar en la versión Android) =====
export const pad = n => String(n).padStart(2, '0');
export const ds = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const pd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = pd(s); d.setDate(d.getDate() + n); return ds(d); };
export const dow = s => pd(s).getDay();
export const diffDays = (a, b) => Math.round((pd(b) - pd(a)) / 864e5);
export const split = dt => { const [d, t] = dt.split('T'); const [h, m] = t.split(':').map(Number); return [d, h * 60 + m]; };
export const join = (d, m) => { m = Math.round(m); if (m >= 1440) { d = addDays(d, Math.floor(m / 1440)); m %= 1440; } return `${d}T${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };
export const hm = s => { const [h, m] = (s || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
export const today = () => ds(new Date());
export const nowDT = () => { const n = new Date(); return `${ds(n)}T${pad(n.getHours())}:${pad(n.getMinutes())}`; };
export const monday = s => { const g = dow(s); return addDays(s, g === 0 ? -6 : 1 - g); };
export const uid = () => Math.random().toString(36).slice(2, 9);

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
export const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const fD = d => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '—';
export const fDia = d => `${DIAS[dow(d)]} ${fD(d)}`;
export const fDT = dt => dt ? `${fDia(dt.slice(0, 10))} ${dt.slice(11, 16)}` : '—';
export const fH = h => (h == null || isNaN(h)) ? '—' : (Math.round(h * 10) / 10).toLocaleString('es-AR') + ' h';
export const fN = h => (Math.round(h * 10) / 10).toLocaleString('es-AR');

// ---- Calendario laboral ----
export function seasonAt(S, d) {
  let t = S.cfg.temporadas[0].t;
  for (const x of S.cfg.temporadas) if (x.desde <= d) t = x.t;
  return t;
}
export const seasonNow = S => S.cfg.temporadas[S.cfg.temporadas.length - 1].t;
export function schedAt(S, d) {
  const h = S.cfg.horarios[seasonAt(S, d)];
  return { in: hm(h.entrada), out: hm(h.salida), bi: hm(h.descansoIni), bm: Number(h.descansoMin) || 0 };
}
export const netOf = h => (hm(h.salida) - hm(h.entrada) - (Number(h.descansoMin) || 0)) / 60;
export const feriadoDe = (S, d) => S.feriados.find(f => f.fecha === d);
export const choque = (a, b) => (a || 'normal') === (b || 'normal') || a === 'ambos' || b === 'ambos';   // dos turnos que se pisan
export const isWork = (S, d) => { const g = dow(d); return g >= 1 && g <= 5 && !feriadoDe(S, d); };
export const ausenciaDe = (S, op, d) => (S.ausencias || []).find(a => a.opId === op && a.desde <= d && d <= a.hasta);
export const extraDe = (S, op, d) => Number(S.extras[op + '|' + d]) || 0;
export function capN(S, op, d) {
  if (!isWork(S, d) || ausenciaDe(S, op, d)) return 0;
  const s = schedAt(S, d); return (s.out - s.in - s.bm) / 60;
}

// Tramos trabajables de un día para un turno y un grupo de operarios
export const modoExtra = (S, op, d) => (S.extraModo || {})[op + '|' + d] === 'sigue' ? 'sigue' : 'aparte';
export const sigueDe = (S, op, d) => modoExtra(S, op, d) === 'sigue' ? extraDe(S, op, d) : 0;
// horas equivalentes de calendario que suma la extra "sigue" a una tarea de turno normal ese día
export const eqSigue = (S, d, ops) => ops.length ? ops.reduce((a, o) => a + sigueDe(S, o, d), 0) / ops.length : 0;
export function dayIv(S, d, turno, ops) {
  if (ops && ops.length && (S.ausencias || []).length && ops.some(o => ausenciaDe(S, o, d))) return [];   // si falta alguno de sus operarios, ese día la tarea no avanza
  const s = schedAt(S, d), wd = isWork(S, d);
  if (turno === 'ambos') {   // normal + extra: el turno normal y después todas las horas extra de ese día
    const iv = !wd ? [] : s.bm > 0 && s.bi > s.in && s.bi + s.bm < s.out ? [[s.in, s.bi], [s.bi + s.bm, s.out]] : [[s.in, s.out - s.bm]];
    const h = ops.length ? Math.min(...ops.map(o => extraDe(S, o, d))) : 0; if (h > 0) { const st = wd ? s.out : s.in; iv.push([st, st + h * 60, true]); }
    return iv;
  }
  if (turno !== 'extra') {
    const iv = !wd ? [] : s.bm > 0 && s.bi > s.in && s.bi + s.bm < s.out ? [[s.in, s.bi], [s.bi + s.bm, s.out]] : [[s.in, s.out - s.bm]];
    const eq = eqSigue(S, d, ops); if (eq > 0) { const st = wd ? s.out : s.in; iv.push([st, st + eq * 60, true]); }
    return iv;
  }
  const h = ops.length ? Math.min(...ops.map(o => modoExtra(S, o, d) === 'sigue' ? 0 : extraDe(S, o, d))) : 0;
  if (h <= 0) return [];
  const st = wd ? s.out : s.in;
  return [[st, st + h * 60]];
}

// inicio + horas de calendario = fin (y reparto por día)
export function addWork(S, start, hours, turno, ops) {
  let [d, m] = split(start); let rem = Math.round(hours * 60); const segs = []; let end = start, guard = 0;
  if (rem <= 0) return { end: start, segs, ok: true, falta: 0 };
  while (rem > 0 && guard++ < 370) {
    for (const [a, b, x] of dayIv(S, d, turno, ops)) {
      const s = Math.max(a, m); if (s >= b) continue;
      const use = Math.min(b - s, rem); rem -= use;
      const last = segs[segs.length - 1];
      const g = last && last.d === d ? last : (segs.push({ d, h: 0, xe: 0 }), segs[segs.length - 1]); if (x) g.xe += use / 60; else g.h += use / 60;
      end = join(d, s + use);
      if (rem <= 0) break;
    }
    if (rem > 0) { d = addDays(d, 1); m = 0; }
  }
  return { end, segs, ok: rem <= 0, falta: rem / 60 };
}
// inicio + fin = horas de calendario
export function workBetween(S, start, end, turno, ops) {
  if (!start || !end || end <= start) return 0;
  const [d0, m0] = split(start), [d1, m1] = split(end); let tot = 0, d = d0, guard = 0;
  while (d <= d1 && guard++ < 800) {
    for (const [a, b] of dayIv(S, d, turno, ops)) {
      const s = Math.max(a, d === d0 ? m0 : 0), e = Math.min(b, d === d1 ? m1 : 1e9);
      if (e > s) tot += e - s;
    }
    d = addDays(d, 1);
  }
  return tot / 60;
}
// primer instante trabajable en o después de dt
export function normStart(S, dt, turno, ops) {
  let [d, m] = split(dt);
  for (let i = 0; i < 90; i++) {
    for (const [a, b] of dayIv(S, d, turno, ops)) if (m < b) return join(d, Math.max(a, m));
    d = addDays(d, 1); m = 0;
  }
  return dt;
}
// Grupo = solo resume a sus hijos (el ensamblaje general de primer nivel, o una tarea partida en partes).
// Cualquier otra pieza con hijos lleva su propio trabajo (soldar, armar…): tiene horas, operario y avance propios
// y no puede empezar hasta que terminen sus hijos.
export const esGrupo = (S, t) => !!t && (!!t.partes || !!t.agrupa || !t.parentId) && S.tareas.some(x => x.parentId === t.id);
export const hojaReal = (S, id) => !S.tareas.some(x => x.parentId === id);
export const isLeaf = (S, id) => !esGrupo(S, S.tareas.find(x => x.id === id));   // lleva trabajo propio (se programa)
// etapa por defecto según el nombre de la operación (se puede cambiar en Configuración → Operaciones)
const ETAPAS = [[/corte|router|oxicorte|plasma/, 1], [/lijad|rebab/, 2], [/plegad|curvad|rolad/, 3], [/torne|mecaniz|fresad|taladr/, 0], [/sold/, 5], [/limpi|pulid|granall/, 6], [/pintur|tratam/, 7], [/ensambl|armad|montaj/, 8]];
export const etapaOp = o => { if (o.etapa !== undefined && o.etapa !== null && o.etapa !== '' && !isNaN(Number(o.etapa))) return Number(o.etapa); const n = (o.nombre || '').toLowerCase(); const m = ETAPAS.find(([r]) => r.test(n)); return m ? m[1] : 9; };
// ---- Etapas de fabricación: en los proyectos que lo activan, cada etapa espera a las anteriores del mismo equipo ----
const _idx = new WeakMap();
function idx(S) {
  let c = _idx.get(S.tareas); if (c && c.ops === S.operaciones && c.pr === S.proyectos) return c;
  const byId = {}, kids = {}; S.tareas.forEach(t => { byId[t.id] = t; (kids[t.parentId || ''] = kids[t.parentId || ''] || []).push(t); });
  const root = t => { let x = t, g = 0; while (x.parentId && byId[x.parentId] && g++ < 50) x = byId[x.parentId]; return x; };
  const et = {}; (S.operaciones || []).forEach(o => { et[o.id] = etapaOp(o); });
  const on = new Set((S.proyectos || []).filter(p => p.etapas).map(p => p.id));
  const porRoot = {}; S.tareas.forEach(t => { if (t.proyId && on.has(t.proyId)) { const k = root(t).id; (porRoot[k] = porRoot[k] || []).push(t); } });
  c = { ops: S.operaciones, pr: S.proyectos, byId, kids, root, et, on, porRoot }; _idx.set(S.tareas, c); return c;
}
export const etapaDe = (S, t) => (t && t.operacionId ? idx(S).et[t.operacionId] : undefined);
const grupoI = (c, x) => !!(c.kids[x.id] && c.kids[x.id].length && (!x.parentId || x.partes || x.agrupa));
const ancestrosI = (c, t) => { const a = new Set(); let x = t, g = 0; while (x.parentId && c.byId[x.parentId] && g++ < 50) { a.add(x.parentId); x = c.byId[x.parentId]; } return a; };
export function etapaPreds(S, t) {
  const c = idx(S); if (!t.proyId || !c.on.has(t.proyId) || t.manual || !t.operacionId || grupoI(c, t)) return [];
  const e = c.et[t.operacionId]; if (e === undefined || isNaN(e) || e <= 0) return [];   // etapa 0 = en paralelo: no espera a nadie
  const an = ancestrosI(c, t);
  return (c.porRoot[c.root(t).id] || []).filter(x => x.id !== t.id && x.operacionId && c.et[x.operacionId] > 0 && c.et[x.operacionId] < e && x.estado !== 'terminada' && !grupoI(c, x) && !an.has(x.id) && !ancestrosI(c, x).has(t.id)).map(x => x.id);
}
export function etapaSucesoras(S, a) {
  const c = idx(S); if (!a.proyId || !c.on.has(a.proyId) || !a.operacionId) return [];
  const e = c.et[a.operacionId]; if (e === undefined || !(e > 0)) return [];
  return (c.porRoot[c.root(a).id] || []).filter(x => x.id !== a.id && !x.manual && x.operacionId && c.et[x.operacionId] > e && !grupoI(c, x) && etapaPreds(S, x).includes(a.id));
}
export const predsDe = (S, t) => { const p = t.preds || []; if (esGrupo(S, t)) return p; const ch = S.tareas.filter(x => x.parentId === t.id).map(x => x.id); const ep = etapaPreds(S, t); const all = ch.length || ep.length ? [...p, ...ch, ...ep] : p; return all.length === p.length ? p : [...new Set(all)]; };
export const calDur = t => t.hh / Math.max(1, t.ops.length);
// Finalizada con fecha de fin real cargada: en el Gantt y el calendario ocupa lo que realmente duró (inicio → fin real)
export const conFinReal = t => !!(t.realFin && t.estado === 'terminada' && t.finReal && t.inicio && t.finReal > t.inicio);
export const durReal = (S, t) => workBetween(S, t.inicio, t.finReal, t.turno, t.ops);
export const durDe = (S, t) => { if (conFinReal(t)) { const d = durReal(S, t); if (d > 0) return d; } return calDur(t); };
export const finOf = (S, t) => {
  if (esGrupo(S, t)) { const fs = S.tareas.filter(x => x.parentId === t.id).map(c => finOf(S, c)).filter(Boolean).sort(); return fs[fs.length - 1] || null; }
  if (conFinReal(t)) return t.finReal;
  return t.inicio ? addWork(S, t.inicio, calDur(t), t.turno, t.ops).end : null;
};

// ---- Datos derivados de todas las tareas ----
// Estado de un padre: las piezas de 0 h sin nada cargado no frenan el "terminado" (no tienen trabajo que hacer)
// (si quedan piezas de 0 h sin finalizar, el padre igual se finaliza pero con aviso: sin0 = cuántas son)
const sinTrabajo = c => !(c.hh > 0) && c.estado !== 'terminada';
export const estadoDe = lst => { const l = lst.filter(c => !sinTrabajo(c)); const b = l.length ? l : lst;
  return b.every(c => c.estado === 'terminada') ? 'terminada' : b.every(c => c.estado === 'pendiente') ? 'pendiente' : 'en proceso'; };
export function derive(S) {
  const kids = {}; S.tareas.forEach(t => { (kids[t.parentId || ''] = kids[t.parentId || ''] || []).push(t); });
  const byId = {}; S.tareas.forEach(t => { byId[t.id] = t; });
  const D = {};
  const SUB = {};   // resumen de todo el subárbol (trabajo propio + descendientes)
  const junta = (lst) => { const hh = lst.reduce((a, c) => a + c.hh, 0); const inis = lst.map(c => c.inicio).filter(Boolean).sort(), fins = lst.map(c => c.fin).filter(Boolean).sort();
    return { hh, inicio: inis[0] || null, fin: fins[fins.length - 1] || null, avance: hh ? lst.reduce((a, c) => a + c.hh * c.avance, 0) / hh : (lst.length ? lst.reduce((a, c) => a + c.avance, 0) / lst.length : 0), hhReal: lst.reduce((a, c) => a + c.hhReal, 0),
      estado: estadoDe(lst), ops: [...new Set(lst.flatMap(c => c.ops))], ok: lst.every(c => c.ok), sin0: lst.reduce((a, c) => a + (c.sin0 || 0), 0) }; };
  const calc = t => {
    if (D[t.id]) return D[t.id];
    const ch = kids[t.id] || []; let r;
    const grupo = ch.length > 0 && (!!t.partes || !!t.agrupa || !t.parentId);
    if (grupo) {
      ch.forEach(calc); const sub = junta(ch.map(c => SUB[c.id]));
      r = { parent: true, ...sub, segs: [], durCal: null }; SUB[t.id] = sub;
    } else {
      const real = conFinReal(t), dur = durDe(S, t);
      const w = t.inicio ? addWork(S, t.inicio, dur, t.turno, t.ops) : { end: null, segs: [], ok: true };
      if (real) w.ok = true;
      r = { parent: false, conHijos: ch.length > 0, finRealOk: real, hh: Number(t.hh) || 0, inicio: t.inicio, fin: real ? t.finReal : w.end, avance: t.estado === 'terminada' ? 100 : (Number(t.avance) || 0), hhReal: Number(t.hhReal) || 0, estado: t.estado, ops: t.ops, segs: w.segs, durCal: dur, ok: w.ok, falta: w.falta, sin0: !(Number(t.hh) > 0) && t.estado !== 'terminada' && !ch.length ? 1 : 0 };
      ch.forEach(calc);
      SUB[t.id] = ch.length ? junta([r, ...ch.map(c => SUB[c.id])]) : r;
    }
    return D[t.id] = r;
  };
  S.tareas.forEach(calc);
  // carga por celda del calendario
  const load = {};
  S.tareas.forEach(t => {
    const r = D[t.id]; if (r.parent) return;
    t.ops.forEach(op => r.segs.forEach(s => {
      const add = (turno, h, sigue) => { if (h <= 0.001) return; const k = `${op}|${s.d}|${turno}`; const c = load[k] = load[k] || { h: 0, items: [] }; c.h += h; c.items.push({ id: t.id, h, sigue }); };
      add(t.turno === 'ambos' ? 'normal' : t.turno, s.h, false);
      if (s.xe > 0 && t.turno === 'ambos') add('extra', s.xe, false);
      else if (s.xe > 0) { const eq = eqSigue(S, s.d, t.ops); add('extra', eq > 0 ? sigueDe(S, op, s.d) * s.xe / eq : 0, true); }
    }));
  });
  const rootOf = t => { let x = t, g = 0; while (x && x.parentId && byId[x.parentId] && g++ < 50) x = byId[x.parentId]; return x; };
  return { D, SUB, kids, byId, load, rootOf };
}

const PALETA = ['#5cc8c0', '#e59a57', '#b08cf0', '#e37fa7', '#8fbf5a', '#6f9df5', '#d9c15a', '#d98a8a'];
export function chipOf(S, V, t) {
  if (t.tipo === 'proy') { const p = S.proyectos.find(p => p.id === t.proyId); return { txt: p ? p.ini : '?', color: p ? p.color : '#888' }; }
  const r = V.rootOf(t); const o = r.orden || 'S/N'; let h = 0; for (const c of o) h = (h * 31 + c.charCodeAt(0)) % 997;
  return { txt: o, color: PALETA[h % PALETA.length] };
}

// ---- Empuje: reacomoda lo que choca con la tarea cambiada y lo deja marcado ----
export function reflow(S, id) {
  let tareas = S.tareas; const cur = () => ({ ...S, tareas });
  const leaf = x => !esGrupo({ tareas }, tareas.find(y => y.id === x));
  const queue = [id]; let n = 0;
  const mover = (x, desde) => {
    const ni = normStart(cur(), desde, x.turno, x.ops);
    if (ni <= x.inicio) return finOf(cur(), x);
    tareas = tareas.map(t => t.id === x.id ? { ...t, inicio: ni, empuje: t.empuje || t.inicio } : t);
    queue.push(x.id);
    return finOf(cur(), tareas.find(t => t.id === x.id));
  };
  while (queue.length && n++ < 400) {
    const aid = queue.shift(); const a = tareas.find(t => t.id === aid);
    if (!a || !a.inicio || (a.estado === 'terminada' && !conFinReal(a)) || !leaf(a.id)) continue;
    const fin = finOf(cur(), a);
    tareas.filter(x => (x.preds || []).includes(a.id) && x.inicio && x.estado !== 'terminada' && x.inicio < fin).forEach(x => mover(x, fin));
    etapaSucesoras(cur(), a).forEach(x0 => { const x = tareas.find(t => t.id === x0.id); if (x && x.inicio && x.estado !== 'terminada' && x.inicio < fin) mover(x, fin); });
    { let p = tareas.find(t => t.id === a.parentId), g = 0; while (p && p.partes && g++ < 20) p = tareas.find(t => t.id === p.parentId);   // la pieza padre que la usa espera a que termine
      if (p && p.parentId !== undefined && !esGrupo({ tareas }, p) && p.inicio && p.estado !== 'terminada') { const fp = finOf(cur(), tareas.find(t => t.id === a.parentId)) || fin; if (p.inicio < fp) mover(p, fp); } }
    for (const op of a.ops) {
      const pisadas = tareas.filter(x => x.id !== a.id && choque(x.turno, a.turno) && x.ops.includes(op) && x.inicio && x.estado !== 'terminada' && leaf(x.id) && x.inicio >= a.inicio && x.inicio < fin)
        .sort((p, q) => p.inicio < q.inicio ? -1 : 1);
      let cursor = fin;
      for (const x of pisadas) cursor = mover(tareas.find(t => t.id === x.id), cursor) || cursor;
    }
  }
  return { ...S, tareas };
}

// ---- Mutaciones puras ----
export function patchTask(S, id, patch, mover = false) {
  let S2 = { ...S, tareas: S.tareas.map(t => t.id === id ? { ...t, ...patch } : t) };
  if (!mover) return S2;
  const t = S2.tareas.find(x => x.id === id);
  if (t && t.inicio && isLeaf(S2, id)) {
    let ini = t.inicio;
    predsDe(S2, t).forEach(p => { const pt = S2.tareas.find(x => x.id === p); const f = pt && pt.estado !== 'terminada' ? finOf(S2, pt) : finTerc(pt); if (f && f > ini) ini = f; });
    ini = normStart(S2, ini, t.turno, t.ops);
    if (ini !== t.inicio) S2 = { ...S2, tareas: S2.tareas.map(x => x.id === id ? { ...x, inicio: ini } : x) };
    S2 = reflow(S2, id);
  }
  return S2;
}
export function acomodarEtapas(S, proyId) {
  const c = idx(S); if (!c.on.has(proyId)) return { S, n: 0 };
  const l = S.tareas.filter(t => t.proyId === proyId && t.inicio && t.estado !== 'terminada' && isLeaf(S, t.id) && t.operacionId).sort((a, b) => (c.et[a.operacionId] - c.et[b.operacionId]) || (a.inicio < b.inicio ? -1 : 1));
  let S2 = S, n = 0;
  l.forEach(t0 => { const t = S2.tareas.find(x => x.id === t0.id); const S3 = patchTask(S2, t.id, {}, true); if (S3.tareas.find(x => x.id === t.id).inicio !== t.inicio) n++; S2 = S3; });
  return { S: S2, n };
}
export function descendants(S, id) { const out = []; const go = p => S.tareas.filter(t => t.parentId === p).forEach(t => { out.push(t.id); go(t.id); }); go(id); return out; }
export function delTask(S, id) {
  const ids = new Set([id, ...descendants(S, id)]);
  return { ...S, tareas: S.tareas.filter(t => !ids.has(t.id)).map(t => (t.preds || []).some(p => ids.has(p)) ? { ...t, preds: t.preds.filter(p => !ids.has(p)) } : t) };
}
export function dupTask(S, id) {
  const ids = [id, ...descendants(S, id)]; const map = {}; ids.forEach(i => { map[i] = uid(); });
  const copies = S.tareas.filter(t => ids.includes(t.id)).map(t => ({ ...t, id: map[t.id], parentId: t.id === id ? t.parentId : map[t.parentId], nombre: t.id === id ? t.nombre + ' (copia)' : t.nombre, estado: 'pendiente', avance: 0, hhReal: 0, finReal: null, empuje: null, preds: (t.preds || []).map(p => map[p]).filter(Boolean) }));
  return { ...S, tareas: [...S.tareas, ...copies] };
}
// Primer momento libre: después de la última tarea sin terminar de CUALQUIERA de los operarios.
// Si una tarea ya tendría que haber terminado (atrasada) y sigue abierta, se cuenta lo que le falta desde ahora.
export function nextFree(S, op, turno, ops) {
  const los = ops && ops.length ? ops : [op]; let c = nowDT();
  const cola = S.tareas.filter(t => t.ops.some(o => los.includes(o)) && choque(t.turno, turno) && t.inicio && t.estado !== 'terminada' && isLeaf(S, t.id)).sort((a, b) => a.inicio < b.inicio ? -1 : 1);
  cola.forEach(t => { const f = finOf(S, t); if (!f) return;
    if (f > c) { c = f; return; }
    const falta = Math.max(0, (Number(t.hh) || 0) - llevado(S, t)) / Math.max(1, t.ops.length);   // atrasada: lo que le falta, desde ahora
    if (falta > 0) { const w = addWork(S, normStart(S, c, t.turno, t.ops), falta, t.turno, t.ops); if (w.end && w.end > c) c = w.end; } });
  return normStart(S, c, turno, los);
}
// Hueco siguiente para una tarea nueva: detrás de lo que el operario tiene abierto (pendiente o en proceso);
// si no tiene nada abierto, pegada al fin de la última que finalizó (aunque ya haya pasado: se carga después).
export function pegadoA(S, ops, turno, sinId) {
  const los = (ops || []).filter(Boolean); if (!los.length) return null;
  const S2 = sinId ? { ...S, tareas: S.tareas.filter(x => x.id !== sinId) } : S;
  const mias = S2.tareas.filter(t => t.ops.some(o => los.includes(o)) && choque(t.turno, turno) && t.inicio && isLeaf(S2, t.id));
  const abiertas = mias.filter(t => t.estado !== 'terminada');
  if (abiertas.length) { const tras = abiertas.reduce((a, t) => (finOf(S2, t) || '') > (finOf(S2, a) || '') ? t : a); return { ini: nextFree(S2, los[0], turno, los), tras }; }
  const hechas = mias.filter(t => finOf(S2, t)); if (!hechas.length) return { ini: nextFree(S2, los[0], turno, los), tras: null };
  const tras = hechas.reduce((a, t) => finOf(S2, t) > finOf(S2, a) ? t : a);
  return { ini: normStart(S2, finOf(S2, tras), turno, los), tras };
}
// Asignar una tarea a un operario; con día = celda del calendario, sin día = primer hueco libre
export function assignTo(S, id, op, d, turno, fromOp) {
  const t = S.tareas.find(x => x.id === id); if (!t) return S;
  let ops = t.ops.filter(o => o !== fromOp); if (!ops.includes(op)) ops = [...ops, op];
  const tu = turno || t.turno || 'normal'; let inicio;
  if (d) {
    let c = `${d}T00:00`;
    S.tareas.forEach(x => { if (x.id !== id && x.ops.includes(op) && choque(x.turno, tu) && x.inicio && x.estado !== 'terminada' && isLeaf(S, x.id)) { const f = finOf(S, x); if (f.slice(0, 10) === d && f > c) c = f; } });
    inicio = normStart(S, c, tu, ops);
    if (inicio.slice(0, 10) !== d) inicio = normStart(S, `${d}T00:00`, tu, ops);
  } else inicio = t.inicio && t.ops.length ? t.inicio : nextFree(S, op, tu, ops);
  return patchTask(S, id, { ops, turno: tu, inicio }, true);
}
export function unassign(S, id, op) {
  const t = S.tareas.find(x => x.id === id); if (!t) return S;
  const ops = t.ops.filter(o => o !== op);
  return patchTask(S, id, { ops, inicio: ops.length ? t.inicio : null, empuje: ops.length ? t.empuje : null }, false);
}
export const blankTask = (tipo, proyId, pv) => ({ id: uid(), tipo, proyId: proyId || null, parentId: null, orden: '', cliente: '', entrega: '', creada: today(), codigo: '', nombre: '', cant: 1, prioridad: 'media', operacionId: '', ops: [], turno: 'normal', inicio: null, hh: 9, estado: 'pendiente', avance: 0, hhReal: 0, finReal: null, preds: [], empuje: null, ...(pv ? { origen: 'fabricada', motivo: '', cantEnv: 0, fechaEnvio: '', remito: '', destinatario: '', remitoOk: false } : {}) });

// Habilita horas extra (para trabajo aparte) a los operarios de una tarea en turno extra, día por día desde su inicio, hasta que entre
export function habilitarExtras(S, id, h, soloDias) {
  let S2 = S; const dias = []; const t0 = S.tareas.find(x => x.id === id); if (!t0 || !t0.inicio || !t0.ops.length) return { S, dias };
  let d = t0.inicio.slice(0, 10);
  for (let g = 0; g < 90; g++) {
    const t = S2.tareas.find(x => x.id === id); if (addWork(S2, t.inicio, calDur(t), 'extra', t.ops).ok) break;
    if (isWork(S2, d) && (!soloDias || soloDias.includes(d))) { let cambio = false;
      t.ops.forEach(op => { if (extraDe(S2, op, d) <= 0 && !ausenciaDe(S2, op, d)) { S2 = setExtraDia(S2, op, d, h, 'aparte'); cambio = true; } });
      if (cambio) dias.push(d); }
    d = addDays(d, 1);
  }
  S2 = patchTask(S2, id, {}, true);
  return { S: S2, dias };
}
// Cambia las extras de un operario en un día y arrastra la cola: todo lo que venía detrás de una tarea
// que ahora termina a otra hora se mueve con ella (conserva la separación que tenía y respeta sus predecesoras).
export function setExtraDia(S, op, d, horas, modo) {
  const k = op + '|' + d;
  return arrastrarCola(S, { ...S, extras: { ...S.extras, [k]: Math.max(0, Number(horas) || 0) }, extraModo: { ...(S.extraModo || {}), [k]: modo || modoExtra(S, op, d) } });
}
// Cambia las ausencias: los días en que falta un operario sus tareas no avanzan (terminan más tarde y ese día no suma horas).
// Las pendientes que caían en esos días pasan al primer momento libre y la cola de detrás se corre con ellas.
export function setAusencias(S, ausencias) {
  let S2 = arrastrarCola(S, { ...S, ausencias });
  const cambio = new Set((S.ausencias || []).concat(ausencias).map(a => a.opId));
  S2.tareas.filter(t => t.inicio && t.ops.length && t.estado === 'pendiente' && t.ops.some(o => cambio.has(o)) && isLeaf(S2, t.id)).forEach(t => {
    const ni = normStart(S2, t.inicio, t.turno, t.ops); if (ni !== t.inicio) S2 = patchTask(S2, t.id, { inicio: ni }, true); });
  return S2;
}
// Después de un cambio de calendario (extras, ausencias), lo que venía detrás de una tarea que ahora termina a otra hora se mueve con ella
function arrastrarCola(S, S2) {
  const cls = t => t.turno === 'extra' ? 'extra' : 'normal';
  const vivas = S.tareas.filter(t => t.inicio && t.ops.length && t.estado !== 'terminada' && isLeaf(S, t.id)).sort((a, b) => a.inicio < b.inicio ? -1 : a.inicio > b.inicio ? 1 : 0);
  const finAntes = {}; vivas.forEach(t => { finAntes[t.id] = finOf(S, t); });
  const ult = {}, prevs = {};   // anterior de cada tarea en la cola de cada uno de sus operarios
  vivas.forEach(t => { prevs[t.id] = []; t.ops.forEach(o => { const key = o + '|' + cls(t); if (ult[key]) prevs[t.id].push({ id: ult[key], gap: Math.max(0, workBetween(S, finAntes[ult[key]], t.inicio, t.turno, t.ops)) }); ult[key] = t.id; }); });
  const cambio = new Set(); const get = id => S2.tareas.find(x => x.id === id);
  vivas.forEach(t0 => { let t = get(t0.id);
    const mov = prevs[t.id].filter(p => cambio.has(p.id));
    if (mov.length) {
      let ni = ''; prevs[t.id].forEach(p => { const f = finOf(S2, get(p.id)); const c = p.gap > 0.001 ? addWork(S2, f, p.gap, t.turno, t.ops).end : f; if (c > ni) ni = c; });
      predsDe(S2, t).forEach(pid => { const pt = get(pid); const f = pt && pt.estado !== 'terminada' ? finOf(S2, pt) : finTerc(pt); if (f && f > ni) ni = f; });
      ni = normStart(S2, ni, t.turno, t.ops);
      if (ni !== t.inicio) { S2 = { ...S2, tareas: S2.tareas.map(x => x.id === t.id ? { ...x, inicio: ni, empuje: null } : x) }; t = get(t.id); }
    }
    if (finOf(S2, t) !== finAntes[t.id] || t.inicio !== t0.inicio) cambio.add(t.id);
  });
  return S2;
}

// ---- Cronómetro de la tarea: iniciar, pausar, retomar y finalizar ----
const r2 = h => Math.round(h * 100) / 100;
export const corriendo = t => !!(t.crono && t.crono.desde);
// Horas-hombre hechas hasta ahora (o hasta "hasta", una fecha y hora anterior)
export function llevado(S, t, hasta) {
  const c = t.crono || {}; let h = Number(c.acum) || 0; const fin = hasta || nowDT();
  if (c.desde && c.desde < fin) { let w = workBetween(S, c.desde, fin, t.turno, t.ops); if (w <= 0) w = Math.max(0, (new Date(fin) - new Date(c.desde)) / 36e5); h += w * Math.max(1, t.ops.length); }
  return h;
}
// Parte una tarea en dos: lo hecho hasta ahora (terminado, con su tiempo real) y el resto, que vuelve a la cola.
// La primera vez la tarea original pasa a ser el "resumen" de sus partes; las siguientes suman una parte más.
// corte: fecha y hora en que se cierra lo hecho (por ejemplo, el cierre de ayer si el operario faltó hoy). Sin corte, es ahora.
export function partir(S, id, { ops, correr, turno, desde, corte } = {}) {
  const t = S.tareas.find(x => x.id === id); if (!t || !isLeaf(S, id)) return S;
  const ahora = nowDT(), now = corte && corte < ahora ? corte : ahora, H = Number(t.hh) || 0, av = Number(t.avance) || 0;
  let L = r2(llevado(S, t, now));
  if (corte && L < 0.05 && !t.crono && t.estado === 'en proceso' && t.inicio && t.inicio < now)   // en proceso sin cronómetro: lo hecho sale del calendario
    L = r2(Math.min(H, workBetween(S, t.inicio, now, t.turno, t.ops) * Math.max(1, t.ops.length)));
  const tu = turno || t.turno, ini0 = desde || ahora;
  if (!hojaReal(S, id)) return { ...S, tareas: S.tareas.map(x => x.id === id ? { ...x, ops: ops || x.ops, turno: tu, estado: 'en proceso', pausada: !correr, hhReal: L, crono: { acum: L, desde: correr ? ahora : null }, ...(tu !== t.turno ? { inicio: normStart(S, ini0, tu, ops || x.ops) } : {}) } : x) };   // pieza padre con trabajo propio: se pausa sin partirse
  if (L < 0.05 && av <= 0) return { ...S, tareas: S.tareas.map(x => x.id === id ? { ...x, estado: correr ? 'en proceso' : 'pendiente', pausada: !correr, ops: ops || x.ops, crono: correr ? { acum: 0, desde: ahora } : null, ...(tu !== t.turno ? { turno: tu, inicio: normStart(S, ini0, tu, ops || x.ops) } : {}) } : x) };
  const resto = r2(Math.max(0.25, av > 0 ? H * (1 - av / 100) : H - L)), hecho = r2(Math.max(0.05, H - resto));
  const par = t.parentId && S.tareas.find(x => x.id === t.parentId), cont = par && par.partes;
  const base = cont ? par.nombre : t.nombre, k = cont ? S.tareas.filter(x => x.parentId === par.id).length : 1;
  const nOps = ops || t.ops, rid = uid();
  const hechaP = { hh: hecho, estado: 'terminada', avance: 100, hhReal: L, finReal: now, crono: { acum: L, desde: null }, pausada: false, empuje: null, parte: true };
  const restoT = { ...t, id: rid, parentId: cont ? par.id : t.id, nombre: `${base} (parte ${k + 1})`, hh: resto, estado: correr ? 'en proceso' : 'pendiente', pausada: !correr, crono: correr ? { acum: 0, desde: ahora } : null, avance: 0, hhReal: 0, finReal: null, ops: nOps, turno: tu, inicio: nOps.length ? normStart(S, ini0, tu, nOps) : null, preds: [], empuje: null, parte: true, partes: false, frenada: null, frenoHist: null };
  let tareas;
  if (cont) tareas = S.tareas.map(x => x.id === id ? { ...x, ...hechaP } : x).concat(restoT);
  else tareas = S.tareas.map(x => x.id === id ? { ...x, partes: true, crono: null, pausada: false } : x).concat({ ...t, id: uid(), parentId: t.id, nombre: `${t.nombre} (parte 1)`, preds: [], partes: false, ...hechaP }, restoT);
  const S2 = { ...S, tareas };
  return restoT.inicio ? reflow(S2, rid) : S2;
}
export const pausar = (S, id) => partir(S, id);
// Uno de los operarios deja la tarea: se parte y el resto sigue en curso con los que quedan
export function salir(S, id, op) {
  const t = S.tareas.find(x => x.id === id); if (!t || t.ops.length < 2 || !t.ops.includes(op)) return S;
  return partir(S, id, { ops: t.ops.filter(o => o !== op), correr: corriendo(t) });
}
// ---- Frenar una tarea por días (otra prioridad, falta de material…) y retomarla después ----
export const MOTIVOS_FRENO = ['Cambio de prioridad', 'Falta de material', 'Máquina', 'Operario'];
export const estaFrenada = t => !!(t && t.frenada && t.estado !== 'terminada');
// ---- Tercerizar: la pieza se hace afuera (por capacidad de planta) ----
// Queda "terminada" para el calendario, el Taller y los padres, pero con la marca tercerizada: no suma horas reales ni entra al promedio de Tiempos.
// fecha (opcional) = cuándo vuelve del proveedor: lo que depende de ella (Predecesoras) no empieza antes.
export const finTerc = t => (t && t.tercerizada && t.tercFecha) ? t.tercFecha + 'T00:00' : null;
export function tercerizar(S, id, { proveedor, fecha, nota, cant } = {}) {
  const t = S.tareas.find(x => x.id === id); if (!t || t.estado === 'terminada' || !isLeaf(S, id)) return { S, n: 0 };
  const total = Math.max(1, Number(t.cant) || 1), q = Math.floor(Number(cant) || total);
  const parcial = q >= 1 && q < total && !(Number(t.cantEnv) > 0);   // solo parte de la cantidad: la pieza se divide en dos
  const marca = { estado: 'terminada', avance: 100, proximo: null, hhReal: 0, finReal: nowDT(), realFin: false, crono: { acum: 0, desde: null }, pausada: false, empuje: null, tercerizada: true, proveedor: (proveedor || '').trim(), tercFecha: fecha || null, tercNota: (nota || '').trim() };
  const finPlan = t.inicio && t.ops.length ? finOf(S, t) : null;
  let S1, n = 0, nid = id;
  if (!parcial) {
    S1 = { ...S, tareas: S.tareas.map(x => x.id === id ? { ...x, ...marca } : x) };
    if (finPlan && (S.cfg || {}).adelantarCola !== false) { const a = adelantarCola(S1, id, finPlan); S1 = a.S; n = a.n; }   // el lugar que deja libre lo aprovecha lo que venía detrás
  } else {
    const hh = Number(t.hh) || 0, mit = v => hh > 0 ? Math.max(0.5, Math.round(v * 2) / 2) : 0;
    const hhT = mit(hh * q / total), hhR = mit(hh * (total - q) / total); nid = uid();
    const nueva = { ...t, ...marca, id: nid, cant: q, hh: hhT, frenada: null, ...(t.cantEnv !== undefined ? { cantEnv: 0, fechaEnvio: '', remito: '', remitoOk: false } : {}) };
    const tareas = []; S.tareas.forEach(x => { if (x.id === id) { tareas.push({ ...x, cant: total - q, hh: hhR }, nueva); } else tareas.push((x.preds || []).includes(id) ? { ...x, preds: [...x.preds, nid] } : x); });   // lo que dependía de la pieza espera también a la parte tercerizada
    S1 = patchTask({ ...S, tareas }, id, {}, true);
    if (finPlan && (S.cfg || {}).adelantarCola !== false) t.ops.forEach(o => { const c = compactar(S1, o); S1 = c.S; n += c.n; });   // el tiempo que libera la parte tercerizada lo aprovecha lo que venía detrás
  }
  S1.tareas.filter(x => (x.preds || []).includes(nid) && x.inicio && x.estado !== 'terminada').forEach(x => { S1 = patchTask(S1, x.id, {}, true); });   // lo que depende de ella espera a la fecha de retorno
  return { S: S1, n };
}
// Se arrepintieron: la pieza vuelve a planta como pendiente
export function volverAPlanta(S, id) {
  const t = S.tareas.find(x => x.id === id); if (!t || !t.tercerizada) return S;
  const S1 = { ...S, tareas: S.tareas.map(x => x.id === id ? { ...x, estado: 'pendiente', avance: 0, hhReal: 0, finReal: null, realFin: false, crono: null, pausada: false, tercerizada: false, proveedor: '', tercFecha: null, tercNota: '' } : x) };
  const r = S1.tareas.find(x => x.id === id);
  if (!r.ops.length) return S1;
  const ini = r.inicio && r.inicio > nowDT() ? r.inicio : nextFree(S1, r.ops[0], r.turno, r.ops);
  return patchTask({ ...S1, tareas: S1.tareas.map(x => x.id === id ? { ...x, inicio: ini } : x) }, id, {}, true);
}
// ---- Próximo a realizar: piezas que se marcan para hacer primero (la marca guarda cuándo se puso, para ordenarlas) ----
// Solo cuenta mientras la pieza está pendiente: al iniciarla o finalizarla la marca se quita sola.
export const esProximo = t => !!(t && t.proximo && t.estado === 'pendiente');
export function setProximo(S, id, on) { return { ...S, tareas: S.tareas.map(x => x.id === id ? { ...x, proximo: on ? nowDT() : null } : x) }; }
export const proximas = (S, filtro) => S.tareas.filter(t => esProximo(t) && (!filtro || filtro(t))).sort((a, b) => a.proximo < b.proximo ? -1 : a.proximo > b.proximo ? 1 : 0);
const soltarFreno = (x, now) => x.frenada ? { ...x, frenada: null, frenoHist: [...(x.frenoHist || []), { ...x.frenada, retomada: now }] } : x;
// Lo hecho queda cerrado como una parte (si había algo hecho) y lo que falta queda como una tarea nueva, frenada.
// Sin fecha no ocupa el calendario; con fecha queda en el primer hueco desde ese día.
// Lo que venía pegado detrás en el operario se adelanta (si está activado "adelantar las que vienen detrás").
// desde: fecha y hora en que se frenó (puede ser anterior a ahora: lo hecho se cierra ahí y lo de después no cuenta)
export function frenar(S, id, { motivo, nota, hasta, desde } = {}) {
  const t0 = S.tareas.find(x => x.id === id); if (!t0 || t0.estado === 'terminada' || !isLeaf(S, id)) return { S, id, n: 0 };
  const now = nowDT(), corte = desde && desde < now ? desde : now; let S1 = partir(S, id, { corte });
  const nueva = S1.tareas.find(x => !S.tareas.some(y => y.id === x.id) && x.estado !== 'terminada'), rid = nueva ? nueva.id : id;
  const r = S1.tareas.find(x => x.id === rid), ini0 = r.inicio, finPlan = ini0 && r.ops.length ? finOf(S1, r) : null;
  const fr = { motivo: motivo || 'Otro', nota: (nota || '').trim(), desde: corte, hasta: hasta || null };
  S1 = { ...S1, tareas: S1.tareas.map(x => x.id === rid ? { ...x, pausada: true, crono: x.crono ? { acum: Number(x.crono.acum) || 0, desde: null } : null, empuje: null, inicio: null, frenada: fr } : x) };
  let n = 0;
  if (finPlan && (S.cfg || {}).adelantarCola !== false) {   // el lugar que deja libre lo aprovecha lo que venía detrás
    const libre = ini0 > now ? ini0 : now;
    const tmp = { ...S1, tareas: S1.tareas.map(x => x.id === rid ? { ...x, inicio: ini0, finReal: libre } : x) };
    const a = adelantarCola(tmp, rid, finPlan); n = a.n;
    if (n) S1 = { ...a.S, tareas: a.S.tareas.map(x => x.id === rid ? { ...x, inicio: null, finReal: r.finReal ?? null } : x) };
  }
  if (hasta && r.ops.length) {
    const t1 = S1.tareas.find(x => x.id === rid);
    const ini = primerHueco(S1, { ...t1, inicio: normStart(S1, hasta + 'T00:00', t1.turno, t1.ops) });
    S1 = patchTask(S1, rid, { inicio: ini }, true);
  }
  return { S: S1, id: rid, n };
}
// Fin de la jornada de un día para esa tarea (para frenar "al terminar el último día trabajado"); null si ese día no se trabaja
export function finJornada(S, t, d) {
  const iv = dayIv(S, d, t.turno || 'normal', t.ops || []);
  return iv.length ? join(d, Math.max(...iv.map(v => v[1]))) : null;
}
// Retomar: elige quiénes la siguen y desde cuándo. ya = arranca en esa fecha y corre lo que tengan; si no, va al primer hueco libre.
export function retomar(S, id, { ops, desde, ya, turno } = {}) {
  const t = S.tareas.find(x => x.id === id); if (!t || !t.frenada) return S;
  const now = nowDT(), nOps = ops && ops.length ? ops : t.ops, tu = turno || t.turno || 'normal';
  const S2 = { ...S, tareas: S.tareas.map(x => x.id === id ? { ...soltarFreno(x, now), ops: nOps, turno: tu, inicio: null, empuje: null } : x) };
  if (!nOps.length) return S2;
  const base = desde && desde > now.slice(0, 10) ? desde + 'T00:00' : now;
  let ini = normStart(S2, base, tu, nOps);
  if (!ya) ini = primerHueco(S2, { ...S2.tareas.find(x => x.id === id), inicio: ini });
  return patchTask(S2, id, { inicio: ini }, true);
}
// Desde un día dado, lo que falta de una tarea sigue en el otro turno: lo programado antes de ese día queda como parte 1
export function partirEnDia(S, id, d, turno) {
  const t = S.tareas.find(x => x.id === id); if (!t || !isLeaf(S, id)) return S;
  const ini = normStart(S, d + 'T00:00', turno, t.ops);
  if (!hojaReal(S, id)) return patchTask(S, id, { turno, inicio: ini, empuje: null }, true);
  const n = Math.max(1, t.ops.length), H = Number(t.hh) || 0;
  let antes = 0;
  if (t.inicio && t.inicio.slice(0, 10) < d) antes = addWork(S, t.inicio, calDur(t), t.turno, t.ops).segs.filter(x => x.d < d).reduce((a, x) => a + x.h + x.xe, 0) * n;
  antes = r2(Math.min(H, Math.max(antes, llevado(S, t))));
  if (antes < 0.05) return patchTask(S, id, { turno, inicio: ini, empuje: null }, true);
  if (antes >= H - 0.05) return S;
  const par = t.parentId && S.tareas.find(x => x.id === t.parentId), cont = par && par.partes;
  const base = cont ? par.nombre : t.nombre, k = cont ? S.tareas.filter(x => x.parentId === par.id).length : 1;
  const resto = { ...t, id: uid(), parentId: cont ? par.id : t.id, nombre: `${base} (parte ${k + 1})`, hh: r2(H - antes), turno, inicio: ini, estado: 'pendiente', pausada: false, crono: null, avance: 0, hhReal: 0, finReal: null, preds: [], empuje: null, parte: true, partes: false, frenada: null, frenoHist: null };
  const primera = { hh: antes, parte: true, avance: Math.min(100, Math.round((Number(t.avance) || 0) * H / antes)) };
  const tareas = cont ? S.tareas.map(x => x.id === id ? { ...x, ...primera } : x).concat(resto)
    : S.tareas.map(x => x.id === id ? { ...x, partes: true, crono: null, pausada: false } : x).concat({ ...t, id: uid(), parentId: t.id, nombre: `${t.nombre} (parte 1)`, preds: [], partes: false, ...primera }, resto);
  return reflow({ ...S, tareas }, resto.id);
}
// En qué turno está trabajando ahora ese grupo de operarios (null si están fuera de horario)
export function turnoAhora(S, ops, dt) {
  const [d, m] = split(dt || nowDT());
  for (const tu of ['normal', 'extra']) for (const [a, b] of dayIv(S, d, tu, ops)) if (m >= a && m < b) return tu;   // la extra que "sigue" cuenta como turno normal
  return null;
}
// Sigue una tarea en el otro turno: lo hecho queda cerrado en su turno y el resto pasa al turno elegido
export function pasarTurno(S, id, turno, { correr } = {}) {
  const t = S.tareas.find(x => x.id === id); if (!t || t.turno === turno || !isLeaf(S, id)) return S;
  const S2 = partir(S, id, { turno, correr: correr === undefined ? corriendo(t) : correr });
  const nueva = S2.tareas.find(x => !S.tareas.some(y => y.id === x.id));
  return reflow(S2, nueva ? nueva.id : id);
}
export function iniciar(S, id) {
  if (S.tareas.some(x => x.id === id && x.frenada)) { const now = nowDT(); S = { ...S, tareas: S.tareas.map(x => x.id === id ? soltarFreno(x, now) : x) }; }   // arrancarla la saca de frenadas
  { const t = S.tareas.find(x => x.id === id), ta = t && t.ops.length ? turnoAhora(S, t.ops) : null;   // si arranca en el otro turno, el resto pasa a ese turno
    if (t && ta && t.turno !== 'ambos' && ta !== t.turno && !corriendo(t) && t.estado !== 'terminada') { const S2 = pasarTurno(S, id, ta); const nueva = S2.tareas.find(x => !S.tareas.some(y => y.id === x.id)); return iniciar(S2, nueva ? nueva.id : id); } }
  const t0 = S.tareas.find(x => x.id === id); if (!t0) return S; const now = nowDT(); let S1 = S;
  S.tareas.filter(x => x.id !== id && corriendo(x) && x.ops.some(o => t0.ops.includes(o))).forEach(x => { S1 = partir(S1, x.id); });   // una persona, una tarea a la vez
  const t = S1.tareas.find(x => x.id === id); const ini = t.ops.length ? normStart(S1, now, t.turno, t.ops) : t.inicio;
  S1 = { ...S1, tareas: S1.tareas.map(x => x.id === id ? { ...x, estado: 'en proceso', pausada: false, proximo: null, finReal: null, inicio: !x.inicio || x.inicio > now || x.estado === 'pendiente' ? ini : x.inicio, crono: { acum: x.crono ? Number(x.crono.acum) || 0 : Number(x.hhReal) || 0, desde: now } } : x) };
  return t.ops.length ? reflow(S1, id) : S1;
}
// real = se finaliza en el momento (desde el taller): el fin real es ahora y la barra pasa a mostrar lo que duró
export function finalizar(S, id, hh, real = false) { const h = r2(Math.max(0, Number(hh) || 0)); const now = nowDT(); return { ...S, tareas: S.tareas.map(x => x.id === id ? { ...x, estado: 'terminada', avance: 100, proximo: null, hhReal: h, finReal: now, realFin: !!(real && x.inicio && x.inicio < now), crono: { acum: h, desde: null } } : x) }; }
export function setEstado(S, id, e) {
  const t = S.tareas.find(x => x.id === id); if (!t || t.estado === e) return S;
  if (e === 'en proceso') return iniciar(S, id);
  if (e === 'terminada') { const l = llevado(S, t); return finalizarYEncadenar(S, id, l > 0 ? l : t.hhReal).S; }
  return { ...S, tareas: S.tareas.map(x => x.id === id ? { ...x, estado: 'pendiente', finReal: null, crono: null, pausada: false, tercerizada: false } : x) };
}
// ---- Cadena de un operario: cuando una tarea termina antes, las que venían pegadas detrás se adelantan ----
// Solo mueve pendientes que estaban una detrás de la otra (si había un hueco a propósito o una tarea fijada a mano 📌, la cadena se corta).
export function adelantarCola(S, id, finPlan) {
  const t = S.tareas.find(x => x.id === id); if (!t || !t.finReal || !finPlan || t.finReal >= finPlan) return { S, n: 0 };
  const cls = x => x.turno === 'extra' ? 'extra' : 'normal'; let S2 = S, n = 0;
  const viva = x => x.id !== id && x.inicio && x.ops.length && x.estado !== 'terminada' && isLeaf(S2, x.id);
  for (const op of t.ops) {
    let cursor = t.finReal, finAnt = finPlan;
    const cola = S2.tareas.filter(x => viva(x) && x.ops.includes(op) && cls(x) === cls(t) && x.inicio >= (t.inicio || '')).sort((a, b) => a.inicio < b.inicio ? -1 : 1);
    for (const x0 of cola) {
      const x = S2.tareas.find(y => y.id === x0.id);
      if (x.estado !== 'pendiente' || x.manual || x.inicio > normStart(S2, finAnt, x.turno, x.ops)) break;
      const finViejo = finOf(S2, x); let ni = cursor;
      predsDe(S2, x).forEach(pid => { const pt = S2.tareas.find(y => y.id === pid); const f = pt && pt.estado !== 'terminada' && pt.inicio ? finOf(S2, pt) : finTerc(pt); if (f && f > ni) ni = f; });
      x.ops.filter(o => o !== op).forEach(o => S2.tareas.forEach(y => { if (viva(y) && y.id !== x.id && y.ops.includes(o) && choque(y.turno, x.turno) && y.inicio < x.inicio) { const f = finOf(S2, y); if (f > ni) ni = f; } }));   // los otros operarios de la tarea también tienen que estar libres
      ni = normStart(S2, ni, x.turno, x.ops);
      if (ni >= x.inicio) break;
      S2 = { ...S2, tareas: S2.tareas.map(y => y.id === x.id ? { ...y, inicio: ni, empuje: y.empuje === ni ? null : (y.empuje || y.inicio) } : y) }; n++;
      cursor = finOf(S2, S2.tareas.find(y => y.id === x.id)); finAnt = finViejo;
    }
  }
  return { S: S2, n };
}
// Después de cerrar una tarea: si terminó más tarde, corre lo que viene; si terminó antes (y está activado), adelanta la cadena
export function trasCerrar(S, S0, id, finPlan) {
  const t = S.tareas.find(x => x.id === id); if (!t || !finPlan || !t.realFin || !t.finReal) return { S, n: 0, dir: 0 };
  let S2 = S, dir = 0;
  if (t.finReal > finPlan) { S2 = reflow(S, id); dir = 1; }
  else if (t.finReal < finPlan && (S.cfg || {}).adelantarCola !== false) { S2 = adelantarCola(S, id, finPlan).S; dir = -1; }
  const antes = {}; S0.tareas.forEach(x => { antes[x.id] = x.inicio; });
  const n = S2.tareas.filter(x => x.id !== id && antes[x.id] !== undefined && antes[x.id] !== x.inicio).length;
  return { S: S2, n, dir: n ? dir : 0 };
}
// Finalizar y que la cadena siga. vivo = desde el Taller (se cierra en el momento).
// Desde la tabla o el editor solo se toma "ahora" como fin real si es antes de lo planificado: si es después,
// puede ser que la estén marcando tarde, y entonces la barra sigue con lo planificado (el fin real se carga en el editor).
export function finalizarYEncadenar(S, id, hh, vivo = false) {
  const t = S.tareas.find(x => x.id === id); if (!t) return { S, n: 0, dir: 0 };
  const finPlan = t.inicio && isLeaf(S, id) && t.estado !== 'terminada' ? finOf(S, t) : null;
  const real = vivo || (!!finPlan && nowDT() < finPlan);
  return trasCerrar(finalizar(S, id, hh, real), S, id, finPlan);
}
// ---- Con quién se pisa una tarea: mismo operario y turno, en el horario que ocupa ----
export function pisadasDe(S, t) {
  if (!t || !t.inicio || !t.ops.length || t.estado === 'terminada') return [];
  const fin = addWork(S, t.inicio, calDur(t), t.turno, t.ops).end; if (!fin) return [];
  const out = [];
  S.tareas.forEach(x => { if (x.id === t.id || !x.inicio || x.estado === 'terminada' || !isLeaf(S, x.id) || !choque(x.turno, t.turno)) return;
    const op = t.ops.find(o => x.ops.includes(o)); if (!op) return;
    const fx = finOf(S, x); if (x.inicio < fin && fx > t.inicio) out.push({ op, tarea: x, fin: fx }); });
  return out.sort((a, b) => a.fin < b.fin ? 1 : -1);
}
// Primer horario desde el inicio pedido en el que la tarea entra entera sin pisar a nadie
export function primerHueco(S, t) {
  let cur = t.inicio, g = 0;
  while (g++ < 60) { const p = pisadasDe(S, { ...t, inicio: cur }); if (!p.length) return cur;
    const f = p.reduce((a, x) => x.fin > a ? x.fin : a, cur); const ni = normStart(S, f, t.turno, t.ops); if (ni <= cur) return cur; cur = ni; }
  return cur;
}
// ---- Orden manual de las filas (▲▼ en la tabla, arrastrar en el Gantt) ----
export function ordenarHermanos(S, ids) { const pos = {}; ids.forEach((x, k) => { pos[x] = (k + 1) * 10; });
  return { ...S, tareas: S.tareas.map(x => pos[x.id] !== undefined && x.pos !== pos[x.id] ? { ...x, pos: pos[x.id] } : x) }; }
// ---- Juntar tareas: adelanta las pendientes para cerrar huecos, sin pasar por delante de lo que esperan ----
export function compactar(S, op) {
  const now = nowDT(); const cls = t => t.turno === 'extra' ? 'extra' : 'normal';
  const viva = (St, t) => t.inicio && t.ops.length && t.estado !== 'terminada' && isLeaf(St, t.id);
  const orden = S.tareas.filter(t => viva(S, t)).sort((a, b) => a.inicio < b.inicio ? -1 : a.inicio > b.inicio ? 1 : 0); const pos = {}; orden.forEach((t, i) => { pos[t.id] = i; });
  let S2 = S, n = 0;
  orden.forEach(t0 => {
    if ((op && !t0.ops.includes(op)) || t0.estado !== 'pendiente') return;
    const t = S2.tareas.find(x => x.id === t0.id); if (t.inicio <= now) return;
    let ni = now;
    S2.tareas.forEach(x => { if (x.id === t.id || pos[x.id] == null || pos[x.id] > pos[t.id] || cls(x) !== cls(t) || !x.ops.some(o => t.ops.includes(o))) return; const f = finOf(S2, x); if (f > ni) ni = f; });
    predsDe(S2, t).forEach(pid => { const pt = S2.tareas.find(x => x.id === pid); const f = pt && pt.estado !== 'terminada' && pt.inicio ? finOf(S2, pt) : finTerc(pt); if (f && f > ni) ni = f; });
    ni = normStart(S2, ni, t.turno, t.ops);
    if (ni >= t.inicio || !addWork(S2, ni, Math.min(0.1, calDur(t) || 0.1), t.turno, t.ops).ok) return;
    const marca = t.empuje === ni ? null : (t.empuje || t.inicio);
    S2 = { ...S2, tareas: S2.tareas.map(x => x.id === t.id ? { ...x, inicio: ni, empuje: marca } : x) }; n++;
  });
  return { S: S2, n };
}

// ---- Códigos TPFR / TPFD: los 3 primeros números indican la operación ----
export function codOp(S, nombre) {
  const m = /TPF[RD]\s*[-_. ]?\s*(\d{3})/i.exec(nombre || ''); if (!m) return null;
  const c = (S.codigos || []).find(x => String(x.num).trim() === m[1]);
  return { num: m[1], operacionId: c ? c.operacionId : null };
}
// clave para reconocer la misma pieza en otras órdenes: el código completo, o el nombre si no tiene código
// también reconoce los códigos TPF-XXXX-0000 (TPF-AMCL, TPF-FP, TPF-PF…), que van a la sub-pestaña "Otros"
export const claveCod = nombre => { const m = /TPF(?:[RD]|-[A-Z]{2,})[\w\-./]*/i.exec(nombre || ''); return m ? m[0].toUpperCase().replace(/\.SLDPRT$/, '').replace(/[-./]+$/, '') : (nombre || '').replace(/\s*\(parte \d+\)\s*$/i, '').trim().toLowerCase(); };
// serie del código (TPFR, TPFD u Otros) y número único de pieza: los últimos dígitos de TPFR-111-222-333-4444
export const serieCod = k => { const m = /^TPF([RD])/i.exec(k || ''); return m ? 'TPF' + m[1].toUpperCase() : /^TPF-/i.test(k || '') ? 'Otros' : ''; };
export const numPieza = k => { if (!serieCod(k)) return null; const m = /(\d+)\D*$/.exec(k); return m ? Number(m[1]) : null; };
// tiempo estándar de una pieza: promedio de horas reales por unidad de las veces que se fabricó (sin las descartadas)
export function historial(S, nombre) {
  const k = claveCod(nombre); if (!k) return null;
  const l = fabricaciones(S).filter(f => f.k === k && !f.fuera);
  if (!l.length) return null;
  const pu = l.reduce((a, f) => a + f.hu, 0) / l.length;
  const cnt = {}; l.forEach(f => { if (f.operacionId) cnt[f.operacionId] = (cnt[f.operacionId] || 0) + 1; });
  return { n: l.length, porUnidad: pu, operacionId: Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0] || null };
}

// ===== Tiempos y costos =====
// Cada vez que se fabricó una pieza: tareas finalizadas con horas reales. Si la tarea se partió en partes, cuenta la pieza entera (suma de las partes).
const _fab = new WeakMap();
export function fabricaciones(S) {
  let c0 = _fab.get(S.tareas); if (c0 && c0.h === S.historico) return c0.l;
  let c;
  const hijos = {}; S.tareas.forEach(t => { if (t.parentId) (hijos[t.parentId] = hijos[t.parentId] || []).push(t); });
  c = [];
  S.tareas.forEach(t => {
    if (t.parte) return;
    const ps = t.partes ? (hijos[t.id] || []).filter(x => x.parte) : null;
    if (ps && ps.length) {   // pieza hecha en partes
      if (!ps.every(x => x.estado === 'terminada')) return;
      const hh = ps.reduce((a, x) => a + (Number(x.hhReal) || 0), 0); if (!(hh > 0)) return;
      const fin = ps.map(x => x.finReal || x.inicio || '').sort().pop();
      c.push(regFab(t, hh, fin, [...new Set(ps.flatMap(x => x.ops || []))]));
      return;
    }
    if (t.estado !== 'terminada' || t.tercerizada || !(Number(t.hhReal) > 0) || hijos[t.id]) return;   // las tercerizadas no se fabricaron en planta: no entran al promedio ni al costo
    c.push(regFab(t, Number(t.hhReal), t.finReal || t.inicio || t.creada, t.ops || []));
  });
  // historial importado de la planilla de tiempos: cuenta en el promedio igual que una tarea finalizada
  (S.historico || []).forEach(h => { const hh = Number(h.hh) || 0; if (!(hh > 0)) return; const cant = Math.max(1, Number(h.cant) || 1);
    c.push({ id: h.id, k: claveCod(h.nombre), nombre: h.nombre, tipo: 'hist', hist: true, fila: h.fila, operacionId: h.operacionId || '', cant, hh, hu: hh / cant, plan: 0, fecha: h.fecha || '',
      ops: [], opsTxt: h.opsTxt || '', material: h.material || '', peso: h.peso, hhCat: h.hhCat || null, det: h.det || '', obs: h.obs || '', fuera: !!h.tiempoFuera }); });
  _fab.set(S.tareas, { h: S.historico, l: c }); return c;
}
const regFab = (t, hh, fecha, ops) => { const cant = Math.max(1, Number(t.cant) || 1);
  return { id: t.id, k: claveCod(t.nombre), nombre: t.nombre.replace(/\s*\(parte \d+\)\s*$/i, ''), tipo: t.tipo, proyId: t.proyId, parentId: t.parentId, orden: t.orden, cliente: t.cliente,
    operacionId: t.operacionId, cant, hh, hu: hh / cant, plan: Number(t.hh) || 0, fecha: (fecha || '').slice(0, 10), ops, material: t.material || '', peso: t.peso, fuera: !!t.tiempoFuera }; };

// ---- Costos en USD ----
// Tarifas de mano de obra por categoría (Mecanizado, Corte Láser, Armado y Soldado, Ensamble): cada operación se asocia a una tarifa
export const tarifaDe = (S, id) => (S.tarifas || []).find(x => x.id === id) || null;
const vhDe = x => x && Number(x.valor) > 0 ? { valor: Number(x.valor), fecha: x.fecha || '', nombre: x.nombre, id: x.id } : null;
// valor hora de la operación de la pieza (la cargada o la que sale del código)
export function valorHora(S, nombre, operacionId) {
  const op = operacionId || (codOp(S, nombre) || {}).operacionId; const o = op && (S.operaciones || []).find(x => x.id === op);
  return vhDe(o && tarifaDe(S, o.tarifaId));
}
export const materialDe = (S, id) => (S.materiales || []).find(m => m.id === id) || null;
// costo de una fabricación o cotización: material (peso total × USD/kg) + mano de obra.
// Mano de obra: si viene el detalle por tarifa (historial importado), suma cada parte × su tarifa; si no, HH × la tarifa de la operación.
export function costo(S, r) {
  const m = materialDe(S, r.material), peso = Number(r.peso) || 0, hh = Number(r.hh) || 0, cant = Math.max(1, Number(r.cant) || 1);
  let mo = 0, vh = null, det = null; const falta = [];
  if (r.hhCat && Object.keys(r.hhCat).length) {
    det = Object.entries(r.hhCat).map(([id, h]) => { const t = vhDe(tarifaDe(S, id)); return { id, h: Number(h) || 0, t, nombre: (tarifaDe(S, id) || {}).nombre || '?' }; });
    if (det.some(d => !d.t)) falta.push('tarifa'); mo = det.reduce((a, d) => a + (d.t ? d.h * d.t.valor : 0), 0); vh = det.find(d => d.t) ? det.find(d => d.t).t : null;
  } else { vh = valorHora(S, r.nombre, r.operacionId); if (vh) mo = hh * vh.valor; else falta.push('tarifa'); }
  const mat = m && peso > 0 ? peso * (Number(m.precio) || 0) : 0, total = mo + mat;
  if (!m) falta.push('material'); else if (!(peso > 0)) falta.push('peso'); else if (!(Number(m.precio) > 0)) falta.push('precio del material');
  return { mo, mat, total, unit: total / cant, vh, det, m, falta };
}
// a qué tarifa corresponde una operación por su nombre (para vincular solas las operaciones al importar)
export function tarifaSugerida(S, nombreOp) {
  const n = (nombreOp || '').toLowerCase(), T = S.tarifas || [], f = re => T.find(t => re.test(t.nombre.toLowerCase()));
  if (/l[aá]ser/.test(n)) return f(/l[aá]ser/); if (/sold|armad/.test(n)) return f(/sold|armad/); if (/ensam|mont/.test(n)) return f(/ensam/);
  if (/torn|fres|router|centro|mecan|cnc|rectif/.test(n)) return f(/mecan/); return null;
}
// todas las piezas con su historial y sus cotizaciones, agrupadas por código (padre) con cada vez que se hizo (hijos)
export function tiempos(S) {
  const G = new Map();
  const g = (k, nombre) => { let x = G.get(k); if (!x) { x = { k, nombre, regs: [] }; G.set(k, x); } return x; };
  fabricaciones(S).forEach(f => { g(f.k, f.nombre).regs.push({ ...f, cot: false }); });
  (S.cotizaciones || []).forEach(q => { const k = claveCod(q.nombre); if (!k) return; const cant = Math.max(1, Number(q.cant) || 1), hh = Number(q.hh) || 0;
    g(k, q.nombre).regs.push({ ...q, k, cot: true, cant, hh, hu: hh / cant, fecha: q.fecha || '', ops: [] }); });
  return [...G.values()].map(x => {
    x.regs.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
    const v = x.regs.filter(r => !r.cot && !r.fuera), ult = x.regs.find(r => !r.cot) || x.regs[0];
    x.nombre = ult.nombre; x.operacionId = (v[0] || ult).operacionId || (codOp(S, x.nombre) || {}).operacionId || '';
    x.n = v.length; x.nCot = x.regs.filter(r => r.cot).length; x.prom = v.length ? v.reduce((a, r) => a + r.hu, 0) / v.length : null;
    x.ult = (x.regs.find(r => !r.cot) || {}).fecha || ''; x.serie = serieCod(x.k); x.num = numPieza(x.k);
    return x;
  }).sort((a, b) => (a.num == null) - (b.num == null) || (a.num || 0) - (b.num || 0) || a.k.localeCompare(b.k));
}
// completa operación (por código o historial) y, si se pide, las horas según lo que llevó antes
export function autoCompletar(S, t, conHoras) {
  const r = {}; const c = codOp(S, t.nombre);
  if (c && c.operacionId && (!t.operacionId || t.opAuto)) { r.operacionId = c.operacionId; r.opAuto = true; }
  const h = historial(S, t.nombre);
  if (h) {
    if (conHoras) r.hh = Math.max(0.5, Math.round(h.porUnidad * Math.max(1, Number(t.cant) || 1) * 2) / 2);
    if (!r.operacionId && !t.operacionId && h.operacionId) { r.operacionId = h.operacionId; r.opAuto = true; }
  }
  return r;
}
// a quién darle la tarea: operarios con esa operación como principal o secundaria, y desde cuándo podrían
export function recomendar(S, t) {
  if (!t.operacionId) return [];
  const sin = { ...S, tareas: S.tareas.filter(x => x.id !== t.id) }, tu = t.turno || 'normal', out = [];
  S.operarios.filter(o => o.activo).forEach(o => {
    const nivel = o.op1 === t.operacionId ? 1 : o.op2 === t.operacionId ? 2 : 0; if (!nivel) return;
    const ini = nextFree(sin, o.id, tu, [o.id]); const w = addWork(S, ini, Number(t.hh) || 0, tu, [o.id]);
    out.push({ op: o.id, nombre: o.nombre, nivel, ini, fin: w.ok ? w.end : null });
  });
  return out.sort((a, b) => a.nivel - b.nivel || (a.ini < b.ini ? -1 : a.ini > b.ini ? 1 : 0));
}
export const darA = (S, id, op, ini) => patchTask(S, id, { ops: [op], inicio: ini }, true);
// ---- Reprogramar lo atrasado desde ahora, respetando la cola de cada operario ----
export function reprogramar(S) {
  const now = nowDT(); let S2 = S, n = 0; const cls = t => t.turno === 'extra' ? 'extra' : 'normal';
  const hojas = St => St.tareas.filter(t => t.inicio && t.ops.length && t.estado !== 'terminada' && isLeaf(St, t.id));
  // 1) en proceso que ya debían haber terminado: se parte (lo hecho queda cerrado, el resto arranca ahora)
  hojas(S).filter(t => t.estado === 'en proceso' && (finOf(S, t) || '') < now).forEach(t => {
    if (llevado(S2, t) >= 0.05 || Number(t.avance) > 0) { S2 = partir(S2, t.id, { correr: corriendo(t) }); n++; }
  });
  // 2) pendientes (y restos en pausa) que ya debían haber empezado
  const venc = hojas(S2).filter(t => t.estado !== 'en proceso' && t.inicio < now).sort((a, b) => a.inicio < b.inicio ? -1 : 1);
  if (!venc.length) return { S: S2, n };
  const cur = {}; hojas(S2).filter(t => t.estado === 'en proceso').forEach(t => { const f = finOf(S2, t); t.ops.forEach(o => { const k = o + '|' + cls(t); if (f > (cur[k] || '')) cur[k] = f; }); });
  venc.forEach(t0 => {
    const t = S2.tareas.find(x => x.id === t0.id); let c = now;
    t.ops.forEach(o => { const k = o + '|' + cls(t); if (cur[k] && cur[k] > c) c = cur[k]; });
    predsDe(S2, t).forEach(pid => { const pt = S2.tareas.find(x => x.id === pid); const f = pt && pt.estado !== 'terminada' && pt.inicio ? finOf(S2, pt) : finTerc(pt); if (f && f > c) c = f; });
    const ni = normStart(S2, c, t.turno, t.ops);
    S2 = { ...S2, tareas: S2.tareas.map(x => x.id === t.id ? { ...x, inicio: ni, empuje: x.empuje || x.inicio } : x) }; n++;
    const f = finOf(S2, S2.tareas.find(x => x.id === t.id)); t.ops.forEach(o => { cur[o + '|' + cls(t)] = f; });
  });
  venc.forEach(t => { S2 = reflow(S2, t.id); });
  return { S: S2, n };
}

// ---- Métricas ----
export function monthHH(S, V, filtro, mes) {
  let h = 0; S.tareas.forEach(t => { const r = V.D[t.id]; if (r.parent || !filtro(t)) return; const n = Math.max(1, t.ops.length); r.segs.forEach(s => { if (s.d.startsWith(mes)) h += (s.h + (s.xe || 0)) * n; }); });
  return h;
}
export function monthCap(S, mes) {
  const [y, m] = mes.split('-').map(Number); const dias = new Date(y, m, 0).getDate(); let h = 0;
  S.operarios.filter(o => o.activo).forEach(o => { for (let i = 1; i <= dias; i++) h += capN(S, o.id, `${mes}-${pad(i)}`); });
  return h;
}

export const usuariosEjemplo = () => [{ id: 'u1', nombre: 'Dueño', email: '', admin: true, rep: 'editar', proy: 'editar' }, { id: 'u2', nombre: 'Carga de repuestos', email: 'repuestos@ejemplo.com', admin: false, rep: 'editar', proy: 'ver' }, { id: 'u3', nombre: 'Oficina técnica', email: 'tecnica@ejemplo.com', admin: false, rep: 'ver', proy: 'editar' }, { id: 'u4', nombre: 'Solo consulta', email: 'consulta@ejemplo.com', admin: false, rep: 'ver', proy: 'ver' }];
// ===== Datos de ejemplo =====
export function sample() {
  const t0 = today(); const g = dow(t0);
  const B = g === 6 ? addDays(t0, 2) : g === 0 ? addDays(t0, 1) : monday(t0);
  const day = n => addDays(B, n + (n >= 5 ? 2 : 0) + (n >= 10 ? 2 : 0));
  const nombres = ['Raúl', 'Matías', 'Hugo', 'Diego', 'Sergio', 'Nahuel', 'Lucas', 'Emanuel', 'Walter', 'Brian'];
  const opers = ['Corte láser', 'Plegado', 'Torneado', 'Fresado', 'Soldadura TIG', 'Armado', 'Pulido'];
  let S = {
    v: 1, ejemplo: true,
    cfg: { accent: '#4fb0ff', temporadas: [{ desde: '2026-01-01', t: 'invierno' }],
      horarios: { invierno: { entrada: '07:00', salida: '17:00', descansoIni: '12:00', descansoMin: 60 }, verano: { entrada: '06:00', salida: '15:30', descansoIni: '10:30', descansoMin: 30 } } },
    operarios: nombres.map((n, i) => ({ id: 'o' + (i + 1), nombre: n, activo: true, op1: ['k5', 'k5', 'k3', 'k1', 'k2', 'k6', 'k7', 'k5', 'k3', 'k4'][i], op2: ['k6', 'k2', 'k4', 'k2', 'k1', 'k5', 'k6', 'k6', 'k4', 'k3'][i] })),
    operaciones: opers.map((n, i) => ({ id: 'k' + (i + 1), nombre: n, tarifaId: ['tf2', 'tf3', 'tf1', 'tf1', 'tf3', 'tf3', 'tf4'][i] })),
    codigos: [['110', 'k1'], ['120', 'k2'], ['200', 'k3'], ['210', 'k4'], ['300', 'k5'], ['400', 'k6'], ['500', 'k7']].map(([num, operacionId], i) => ({ id: 'c' + i, num, operacionId })),
    tarifas: [{ id: 'tf1', nombre: 'Mecanizado', valor: 28, fecha: '2026-10-01' }, { id: 'tf2', nombre: 'Corte Láser', valor: 28, fecha: '2026-10-01' }, { id: 'tf3', nombre: 'Armado y Soldado', valor: 13, fecha: '2026-10-01' }, { id: 'tf4', nombre: 'Ensamble', valor: 9.5, fecha: '2026-10-01' }],
    materiales: [{ id: 'm1', nombre: 'Macizo AISI 304', precio: 4.4, fecha: '2026-10-01' }, { id: 'm2', nombre: 'Macizo SAE 1045', precio: 1.9, fecha: '2026-10-01' }, { id: 'm3', nombre: 'Buje Bronce SAE 64', precio: 29, fecha: '2026-10-01' }, { id: 'm4', nombre: 'Placa UMHW', precio: 10.19, fecha: '2026-10-01' }],
    cotizaciones: [], historico: [],
    feriados: [{ fecha: '2026-10-12', nombre: 'Diversidad Cultural' }, { fecha: '2026-12-08', nombre: 'Inmaculada Concepción' }, { fecha: '2026-12-25', nombre: 'Navidad' }],
    ausencias: [{ id: 'a1', opId: 'o10', desde: day(3), hasta: day(4), motivo: 'Vacaciones' }],
    extras: {}, extraModo: {},
    usuarios: usuariosEjemplo(),
    proyectos: [{ id: 'p1', nombre: 'Escaldadora 6000 aves/h', ini: 'ESC', color: '#e59a57', entrega: day(13) }, { id: 'p2', nombre: 'Transportador aéreo 120 m', ini: 'TRA', color: '#b08cf0', entrega: day(11) }],
    tareas: []
  };
  ['o8', 'o9'].forEach(o => [0, 1, 2, 3].forEach(n => { S.extras[o + '|' + day(n)] = 2; }));
  S.extras['o8|' + addDays(B, 5)] = 4;
  S.extras['o1|' + day(3)] = 2; S.extraModo['o1|' + day(3)] = 'sigue';
  const T = [];
  const mk = (id, base, x) => { T.push({ ...blankTask(base.tipo, base.proyId), id, ...x }); };
  const at = (n, h = '07:00') => `${day(n)}T${h}`;
  const P1 = { tipo: 'proy', proyId: 'p1' }, P2 = { tipo: 'proy', proyId: 'p2' }, R = { tipo: 'rep' };
  // Proyecto ESC
  mk('e1', P1, { codigo: 'ESC-100', nombre: 'Estructura', cant: 1, prioridad: 'alta' });
  mk('e11', P1, { parentId: 'e1', codigo: 'ESC-110', nombre: 'Bastidor inox 304', cant: 1, operacionId: 'k5', ops: ['o1', 'o2'], inicio: at(0), hh: 36, estado: 'en proceso', avance: 35, hhReal: 14, prioridad: 'alta' });
  mk('e12', P1, { parentId: 'e1', codigo: 'ESC-120', nombre: 'Patas regulables', cant: 6, operacionId: 'k3', ops: ['o3'], inicio: at(0), hh: 14, estado: 'en proceso', avance: 20, hhReal: 3 });
  mk('e13', P1, { parentId: 'e1', codigo: 'ESC-130', nombre: 'Soporte de motor soldado', cant: 2, operacionId: 'k5', hh: 6 });
  mk('e131', P1, { parentId: 'e13', codigo: 'ESC-131', nombre: 'Eje torneado', cant: 2, operacionId: 'k3', ops: ['o3'], inicio: at(2), hh: 4 });
  mk('e132', P1, { parentId: 'e13', codigo: 'ESC-132', nombre: 'Buje torneado', cant: 4, operacionId: 'k3', ops: ['o3'], inicio: at(2, '11:00'), hh: 3, preds: ['e131'] });
  mk('e2', P1, { codigo: 'ESC-200', nombre: 'Batea de escaldado', cant: 1, prioridad: 'alta' });
  mk('e21', P1, { parentId: 'e2', codigo: 'ESC-210', nombre: 'Corte de chapas laterales', cant: 4, operacionId: 'k1', ops: ['o4'], inicio: at(0), hh: 9 });
  mk('e22', P1, { parentId: 'e2', codigo: 'ESC-220', nombre: 'Plegado de laterales', cant: 4, operacionId: 'k2', ops: ['o5'], inicio: at(1), hh: 12, preds: ['e21'] });
  mk('e23', P1, { parentId: 'e2', codigo: 'ESC-230', nombre: 'Soldadura de batea', cant: 1, operacionId: 'k5', ops: ['o1', 'o2'], inicio: at(2), hh: 40, preds: ['e22', 'e11'], prioridad: 'alta' });
  mk('e24', P1, { parentId: 'e2', codigo: 'ESC-132', nombre: 'Buje torneado', cant: 6, operacionId: 'k3', hh: 4 });
  mk('e3', P1, { codigo: 'ESC-300', nombre: 'Sistema de agitación', cant: 1, operacionId: 'k6', ops: ['o6'], inicio: at(1), hh: 27 });
  mk('e4', P1, { codigo: 'ESC-400', nombre: 'Armado final y prueba de estanqueidad', cant: 1, operacionId: 'k6', ops: ['o6', 'o7'], inicio: at(6), hh: 36, preds: ['e23', 'e3'] });
  // Proyecto TRA (lo habitual: en horas extra)
  mk('t1', P2, { codigo: 'TRA-010', nombre: 'Soportes de riel', cant: 40, operacionId: 'k5', ops: ['o8'], turno: 'extra', inicio: at(0, '17:00'), hh: 8, estado: 'en proceso', avance: 25, hhReal: 2 });
  mk('t2', P2, { codigo: 'TRA-020', nombre: 'Curvas de riel 90°', cant: 8, operacionId: 'k2', ops: ['o9'], turno: 'extra', inicio: at(0, '17:00'), hh: 6 });
  mk('t3', P2, { codigo: 'TRA-030', nombre: 'Ganchos de colgado', cant: 600 });
  mk('t31', P2, { parentId: 't3', codigo: 'TRA-031', nombre: 'Corte de varilla Ø8', cant: 600, operacionId: 'k1', ops: ['o10'], inicio: at(5), hh: 9 });
  mk('t32', P2, { parentId: 't3', codigo: 'TRA-032', nombre: 'Doblado y pulido', cant: 600, operacionId: 'k7', hh: 18, preds: ['t31'] });
  // Repuestos
  mk('r1', R, { orden: 'OV-4512', cliente: 'Avícola del Litoral', nombre: 'Porta dedos desplumadores', cant: 200, prioridad: 'alta', entrega: day(3) });
  mk('r11', R, { parentId: 'r1', nombre: 'Corte láser', operacionId: 'k1', ops: ['o4'], inicio: at(1), hh: 6, prioridad: 'alta', cant: 200 });
  mk('r12', R, { parentId: 'r1', nombre: 'Plegado', operacionId: 'k2', ops: ['o5'], inicio: at(2, '13:00'), hh: 5, prioridad: 'alta', cant: 200, preds: ['r11'] });
  mk('r13', R, { parentId: 'r1', nombre: 'Pulido', operacionId: 'k7', ops: ['o7'], inicio: at(3), hh: 14, prioridad: 'alta', cant: 200, preds: ['r12'] });
  mk('r2', R, { orden: 'OV-4512', cliente: 'Avícola del Litoral', nombre: 'TPFR-200-110-020-0015 Eje pelador de mollejas', cant: 4, operacionId: 'k3', ops: ['o3'], inicio: at(1, '14:00'), hh: 12, prioridad: 'media', entrega: day(4) });
  mk('r3', R, { orden: 'OV-4520', cliente: 'Granja San Benito', nombre: 'TPFD-200-140-030-0022 Cuchilla circular Ø150', cant: 30, operacionId: 'k3', ops: ['o9'], inicio: at(0), hh: 18, estado: 'en proceso', avance: 50, hhReal: 10, prioridad: 'media', entrega: day(6) });
  mk('r4', R, { orden: 'OC-0231', cliente: 'Stock', nombre: 'TPFR-210-130-010-0008 Piñón Z18 de transportador', cant: 20, operacionId: 'k4', hh: 16, prioridad: 'baja' });
  mk('r5', R, { orden: 'OC-0232', cliente: 'Stock', nombre: 'TPFR-200-110-020-0040 Buje de bronce Ø40', cant: 50, operacionId: 'k3', hh: 9, prioridad: 'baja' });
  mk('r6', R, { orden: 'OV-4521', cliente: 'Frigorífico El Ceibo', nombre: 'TPFR-120-150-010-0031 Guía de cuello inox', cant: 12, operacionId: 'k2', hh: 7, prioridad: 'alta', entrega: day(5) });
  mk('r7', R, { orden: 'OV-4498', cliente: 'Frigorífico El Ceibo', nombre: 'Tolva de descarga inox', cant: 1, operacionId: 'k5', ops: ['o8'], inicio: `${addDays(B, -5)}T07:00`, hh: 18, estado: 'terminada', avance: 100, hhReal: 21, finReal: `${addDays(B, -4)}T17:00`, entrega: addDays(B, -3) });
  mk('r8', R, { orden: 'OC-0229', cliente: 'Stock', nombre: 'TPFR-200-110-020-0040 Buje de bronce Ø40', cant: 50, operacionId: 'k3', ops: ['o10'], inicio: `${addDays(B, -4)}T07:00`, hh: 9, estado: 'terminada', avance: 100, hhReal: 8, finReal: `${addDays(B, -4)}T16:00` });
  mk('r10', R, { orden: 'OV-4521', cliente: 'Frigorífico El Ceibo', nombre: 'TPFR-200-110-020-0040 Buje de bronce Ø40', cant: 8, operacionId: 'k3', hh: 3, prioridad: 'media', entrega: day(5) });
  mk('t4', P2, { codigo: 'TPFR-200-110-020-0040', nombre: 'Buje de bronce Ø40', cant: 16, operacionId: 'k3', hh: 4 });
  mk('r9', R, { orden: 'OC-0229', cliente: 'Stock', nombre: 'TPFR-210-130-010-0008 Piñón Z18 de transportador', cant: 20, operacionId: 'k4', ops: ['o10'], inicio: `${addDays(B, -3)}T07:00`, hh: 16, estado: 'terminada', avance: 100, hhReal: 19, finReal: `${addDays(B, -2)}T15:00` });
  // historial de meses anteriores, para que las métricas tengan qué mostrar
  const prods = [['TPFR-500-160-010-0112 Dedo desplumador de goma', 'k7', 'm4', 0.08], ['TPFR-200-110-020-0031 Eje de transportador', 'k3', 'm2', 2.4], ['TPFD-210-140-030-0017 Cuchilla de corte de cloaca', 'k4', 'm1', 0.6], ['TPFR-120-150-010-0044 Guía de patas inox', 'k2', 'm1', 1.1], ['TPFD-200-140-030-0052 Rodillo tensor', 'k3', 'm2', 3.2], ['TPFR-300-170-010-0009 Bandeja de goteo', 'k5', 'm1', 4.5]];
  const clis = ['Avícola del Litoral', 'Granja San Benito', 'Frigorífico El Ceibo'];
  let nro = 4400, nst = 200;
  [[5, 3], [4, 5], [3, 4], [2, 6], [1, 5]].forEach(([atras, n]) => { const b = pd(B); const m0 = ds(new Date(b.getFullYear(), b.getMonth() - atras, 1));
    for (let i = 0; i < n; i++) { const oc = i % 3 === 2, c = addDays(m0, 2 + i * 4), [nom, k, mat, kg] = prods[(atras + i) % prods.length], hh = 6 + ((atras * 3 + i * 5) % 13), f = addDays(c, 6 + ((atras + i * 3) % 5) * 6);
      mk('h' + atras + i, R, { orden: oc ? 'OC-0' + (nst++) : 'OV-' + (nro++), cliente: oc ? 'Stock' : clis[(atras + i) % 3], nombre: nom, cant: 5 + i * 10, operacionId: k, ops: ['o' + (1 + (atras + i) % 10)], inicio: `${addDays(c, 1)}T07:00`, hh, estado: 'terminada', avance: 100, hhReal: Math.round(hh * (0.85 + ((atras + i) % 4) * 0.12) * 2) / 2, finReal: `${f}T15:00`, creada: c, material: mat, peso: Math.round(kg * (5 + i * 10) * 10) / 10 }); } });
  T.forEach(t => { if (!t.id.startsWith('h')) t.creada = t.estado === 'terminada' ? addDays(B, -7) : t.tipo === 'rep' ? addDays(B, -(2 + T.indexOf(t) % 5)) : addDays(B, -10); });
  T.forEach(t => { if (t.codigo) { t.nombre = `${t.codigo} ${t.nombre}`; t.codigo = ''; } });
  S.tareas = T;
  // acomodar el ejemplo sin choques y dejar un empuje a la vista
  [...T].filter(t => t.inicio && t.estado !== 'terminada').sort((a, b) => a.inicio < b.inicio ? -1 : 1).forEach(t => { S = patchTask(S, t.id, {}, true); });
  S.tareas = S.tareas.map(t => ({ ...t, empuje: null }));
  S = patchTask(S, 'e21', { hh: 14 }, true);
  S.tareas = S.tareas.map(t => t.estado === 'en proceso' ? { ...t, crono: { acum: Number(t.hhReal) || 0, desde: nowDT() } } : t);
  return S;
}
