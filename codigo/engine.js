// ===== Motor de fechas, cargas y empuje (sin React: reutilizable en la etapa 2) =====
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
export const ausenciaDe = (S, op, d) => S.ausencias.find(a => a.opId === op && a.desde <= d && d <= a.hasta);
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
export const esGrupo = (S, t) => !!t && (!!t.partes || !t.parentId) && S.tareas.some(x => x.parentId === t.id);
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
const grupoI = (c, x) => !!(c.kids[x.id] && c.kids[x.id].length && (!x.parentId || x.partes));
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
export const finOf = (S, t) => {
  if (esGrupo(S, t)) { const fs = S.tareas.filter(x => x.parentId === t.id).map(c => finOf(S, c)).filter(Boolean).sort(); return fs[fs.length - 1] || null; }
  return t.inicio ? addWork(S, t.inicio, calDur(t), t.turno, t.ops).end : null;
};

// ---- Datos derivados de todas las tareas ----
export function derive(S) {
  const kids = {}; S.tareas.forEach(t => { (kids[t.parentId || ''] = kids[t.parentId || ''] || []).push(t); });
  const byId = {}; S.tareas.forEach(t => { byId[t.id] = t; });
  const D = {};
  const SUB = {};   // resumen de todo el subárbol (trabajo propio + descendientes)
  const junta = (lst) => { const hh = lst.reduce((a, c) => a + c.hh, 0); const inis = lst.map(c => c.inicio).filter(Boolean).sort(), fins = lst.map(c => c.fin).filter(Boolean).sort();
    return { hh, inicio: inis[0] || null, fin: fins[fins.length - 1] || null, avance: hh ? lst.reduce((a, c) => a + c.hh * c.avance, 0) / hh : (lst.length ? lst.reduce((a, c) => a + c.avance, 0) / lst.length : 0), hhReal: lst.reduce((a, c) => a + c.hhReal, 0),
      estado: lst.every(c => c.estado === 'terminada') ? 'terminada' : lst.every(c => c.estado === 'pendiente') ? 'pendiente' : 'en proceso', ops: [...new Set(lst.flatMap(c => c.ops))], ok: lst.every(c => c.ok) }; };
  const calc = t => {
    if (D[t.id]) return D[t.id];
    const ch = kids[t.id] || []; let r;
    const grupo = ch.length > 0 && (!!t.partes || !t.parentId);
    if (grupo) {
      ch.forEach(calc); const sub = junta(ch.map(c => SUB[c.id]));
      r = { parent: true, ...sub, segs: [], durCal: null }; SUB[t.id] = sub;
    } else {
      const w = t.inicio ? addWork(S, t.inicio, calDur(t), t.turno, t.ops) : { end: null, segs: [], ok: true };
      r = { parent: false, conHijos: ch.length > 0, hh: Number(t.hh) || 0, inicio: t.inicio, fin: w.end, avance: t.estado === 'terminada' ? 100 : (Number(t.avance) || 0), hhReal: Number(t.hhReal) || 0, estado: t.estado, ops: t.ops, segs: w.segs, durCal: calDur(t), ok: w.ok, falta: w.falta };
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
    if (!a || !a.inicio || a.estado === 'terminada' || !leaf(a.id)) continue;
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
    predsDe(S2, t).forEach(p => { const pt = S2.tareas.find(x => x.id === p); const f = pt && pt.estado !== 'terminada' ? finOf(S2, pt) : null; if (f && f > ini) ini = f; });
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
export function nextFree(S, op, turno, ops) {
  let c = nowDT();
  S.tareas.forEach(t => { if (t.ops.includes(op) && choque(t.turno, turno) && t.inicio && t.estado !== 'terminada' && isLeaf(S, t.id)) { const f = finOf(S, t); if (f > c) c = f; } });
  return normStart(S, c, turno, ops || [op]);
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
export function applyRoute(S, id, plantilla) {
  const t = S.tareas.find(x => x.id === id); if (!t) return S; let prev = null;
  const nuevos = plantilla.pasos.map(p => { const o = S.operaciones.find(x => x.id === p.operacionId); const n = { ...blankTask(t.tipo, t.proyId), id: uid(), parentId: id, nombre: o ? o.nombre : 'Paso', operacionId: p.operacionId, hh: Number(p.hh) || 1, prioridad: t.prioridad, preds: prev ? [prev] : [] }; prev = n.id; return n; });
  return { ...S, tareas: [...S.tareas, ...nuevos] };
}
export const blankTask = (tipo, proyId) => ({ id: uid(), tipo, proyId: proyId || null, parentId: null, orden: '', cliente: '', entrega: '', creada: today(), codigo: '', nombre: '', cant: 1, prioridad: 'media', operacionId: '', ops: [], turno: 'normal', inicio: null, hh: 9, estado: 'pendiente', avance: 0, hhReal: 0, finReal: null, preds: [], empuje: null });

// Cambia las extras de un operario en un día y arrastra la cola: todo lo que venía detrás de una tarea
// que ahora termina a otra hora se mueve con ella (conserva la separación que tenía y respeta sus predecesoras).
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
export function setExtraDia(S, op, d, horas, modo) {
  const k = op + '|' + d;
  let S2 = { ...S, extras: { ...S.extras, [k]: Math.max(0, Number(horas) || 0) }, extraModo: { ...(S.extraModo || {}), [k]: modo || modoExtra(S, op, d) } };
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
      predsDe(S2, t).forEach(pid => { const pt = get(pid); const f = pt && pt.estado !== 'terminada' ? finOf(S2, pt) : null; if (f && f > ni) ni = f; });
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
export function llevado(S, t) {
  const c = t.crono || {}; let h = Number(c.acum) || 0;
  if (c.desde) { const now = nowDT(); let w = workBetween(S, c.desde, now, t.turno, t.ops); if (w <= 0) w = Math.max(0, (new Date(now) - new Date(c.desde)) / 36e5); h += w * Math.max(1, t.ops.length); }
  return h;
}
// Parte una tarea en dos: lo hecho hasta ahora (terminado, con su tiempo real) y el resto, que vuelve a la cola.
// La primera vez la tarea original pasa a ser el "resumen" de sus partes; las siguientes suman una parte más.
export function partir(S, id, { ops, correr, turno, desde } = {}) {
  const t = S.tareas.find(x => x.id === id); if (!t || !isLeaf(S, id)) return S;
  const now = nowDT(), L = r2(llevado(S, t)), H = Number(t.hh) || 0, av = Number(t.avance) || 0;
  const tu = turno || t.turno, ini0 = desde || now;
  if (!hojaReal(S, id)) return { ...S, tareas: S.tareas.map(x => x.id === id ? { ...x, ops: ops || x.ops, turno: tu, estado: 'en proceso', pausada: !correr, hhReal: L, crono: { acum: L, desde: correr ? now : null }, ...(tu !== t.turno ? { inicio: normStart(S, ini0, tu, ops || x.ops) } : {}) } : x) };   // pieza padre con trabajo propio: se pausa sin partirse
  if (L < 0.05 && av <= 0) return { ...S, tareas: S.tareas.map(x => x.id === id ? { ...x, estado: correr ? 'en proceso' : 'pendiente', pausada: !correr, ops: ops || x.ops, crono: correr ? { acum: 0, desde: now } : null, ...(tu !== t.turno ? { turno: tu, inicio: normStart(S, ini0, tu, ops || x.ops) } : {}) } : x) };
  const resto = r2(Math.max(0.25, av > 0 ? H * (1 - av / 100) : H - L)), hecho = r2(Math.max(0.05, H - resto));
  const par = t.parentId && S.tareas.find(x => x.id === t.parentId), cont = par && par.partes;
  const base = cont ? par.nombre : t.nombre, k = cont ? S.tareas.filter(x => x.parentId === par.id).length : 1;
  const nOps = ops || t.ops, rid = uid();
  const hechaP = { hh: hecho, estado: 'terminada', avance: 100, hhReal: L, finReal: now, crono: { acum: L, desde: null }, pausada: false, empuje: null, parte: true };
  const restoT = { ...t, id: rid, parentId: cont ? par.id : t.id, nombre: `${base} (parte ${k + 1})`, hh: resto, estado: correr ? 'en proceso' : 'pendiente', pausada: !correr, crono: correr ? { acum: 0, desde: now } : null, avance: 0, hhReal: 0, finReal: null, ops: nOps, turno: tu, inicio: nOps.length ? normStart(S, ini0, tu, nOps) : null, preds: [], empuje: null, parte: true, partes: false };
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
  const resto = { ...t, id: uid(), parentId: cont ? par.id : t.id, nombre: `${base} (parte ${k + 1})`, hh: r2(H - antes), turno, inicio: ini, estado: 'pendiente', pausada: false, crono: null, avance: 0, hhReal: 0, finReal: null, preds: [], empuje: null, parte: true, partes: false };
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
  { const t = S.tareas.find(x => x.id === id), ta = t && t.ops.length ? turnoAhora(S, t.ops) : null;   // si arranca en el otro turno, el resto pasa a ese turno
    if (t && ta && t.turno !== 'ambos' && ta !== t.turno && !corriendo(t) && t.estado !== 'terminada') { const S2 = pasarTurno(S, id, ta); const nueva = S2.tareas.find(x => !S.tareas.some(y => y.id === x.id)); return iniciar(S2, nueva ? nueva.id : id); } }
  const t0 = S.tareas.find(x => x.id === id); if (!t0) return S; const now = nowDT(); let S1 = S;
  S.tareas.filter(x => x.id !== id && corriendo(x) && x.ops.some(o => t0.ops.includes(o))).forEach(x => { S1 = partir(S1, x.id); });   // una persona, una tarea a la vez
  const t = S1.tareas.find(x => x.id === id); const ini = t.ops.length ? normStart(S1, now, t.turno, t.ops) : t.inicio;
  S1 = { ...S1, tareas: S1.tareas.map(x => x.id === id ? { ...x, estado: 'en proceso', pausada: false, finReal: null, inicio: !x.inicio || x.inicio > now || x.estado === 'pendiente' ? ini : x.inicio, crono: { acum: x.crono ? Number(x.crono.acum) || 0 : Number(x.hhReal) || 0, desde: now } } : x) };
  return t.ops.length ? reflow(S1, id) : S1;
}
export function finalizar(S, id, hh) { const h = r2(Math.max(0, Number(hh) || 0)); return { ...S, tareas: S.tareas.map(x => x.id === id ? { ...x, estado: 'terminada', avance: 100, hhReal: h, finReal: nowDT(), crono: { acum: h, desde: null } } : x) }; }
export function setEstado(S, id, e) {
  const t = S.tareas.find(x => x.id === id); if (!t || t.estado === e) return S;
  if (e === 'en proceso') return iniciar(S, id);
  if (e === 'terminada') { const l = llevado(S, t); return finalizar(S, id, l > 0 ? l : t.hhReal); }
  return { ...S, tareas: S.tareas.map(x => x.id === id ? { ...x, estado: 'pendiente', finReal: null, crono: null, pausada: false } : x) };
}
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
    predsDe(S2, t).forEach(pid => { const pt = S2.tareas.find(x => x.id === pid); const f = pt && pt.estado !== 'terminada' && pt.inicio ? finOf(S2, pt) : null; if (f && f > ni) ni = f; });
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
export const claveCod = nombre => { const m = /TPF[RD][\w\-./]*/i.exec(nombre || ''); return m ? m[0].toUpperCase().replace(/[-./]+$/, '') : (nombre || '').replace(/\s*\(parte \d+\)\s*$/i, '').trim().toLowerCase(); };
export function historial(S, nombre) {
  const k = claveCod(nombre); if (!k) return null;
  const l = S.tareas.filter(t => t.estado === 'terminada' && Number(t.hhReal) > 0 && !t.parte && claveCod(t.nombre) === k && !esGrupo(S, t));
  if (!l.length) return null;
  const pu = l.reduce((a, t) => a + Number(t.hhReal) / Math.max(1, Number(t.cant) || 1), 0) / l.length;
  const cnt = {}; l.forEach(t => { if (t.operacionId) cnt[t.operacionId] = (cnt[t.operacionId] || 0) + 1; });
  return { n: l.length, porUnidad: pu, operacionId: Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0] || null };
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
    predsDe(S2, t).forEach(pid => { const pt = S2.tareas.find(x => x.id === pid); const f = pt && pt.estado !== 'terminada' && pt.inicio ? finOf(S2, pt) : null; if (f && f > c) c = f; });
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
    operaciones: opers.map((n, i) => ({ id: 'k' + (i + 1), nombre: n })),
    codigos: [['110', 'k1'], ['120', 'k2'], ['200', 'k3'], ['210', 'k4'], ['300', 'k5'], ['400', 'k6'], ['500', 'k7']].map(([num, operacionId], i) => ({ id: 'c' + i, num, operacionId })),
    feriados: [{ fecha: '2026-10-12', nombre: 'Diversidad Cultural' }, { fecha: '2026-12-08', nombre: 'Inmaculada Concepción' }, { fecha: '2026-12-25', nombre: 'Navidad' }],
    ausencias: [{ id: 'a1', opId: 'o10', desde: day(3), hasta: day(4), motivo: 'Vacaciones' }],
    extras: {}, extraModo: {},
    usuarios: usuariosEjemplo(),
    proyectos: [{ id: 'p1', nombre: 'Escaldadora 6000 aves/h', ini: 'ESC', color: '#e59a57', entrega: day(13) }, { id: 'p2', nombre: 'Transportador aéreo 120 m', ini: 'TRA', color: '#b08cf0', entrega: day(11) }],
    plantillas: [{ id: 'r1', nombre: 'Pieza de chapa inox', pasos: [{ operacionId: 'k1', hh: 3 }, { operacionId: 'k2', hh: 4 }, { operacionId: 'k5', hh: 8 }, { operacionId: 'k7', hh: 4 }] }, { id: 'r2', nombre: 'Eje torneado', pasos: [{ operacionId: 'k3', hh: 6 }, { operacionId: 'k4', hh: 3 }] }],
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
  mk('r2', R, { orden: 'OV-4512', cliente: 'Avícola del Litoral', nombre: 'TPFR-200-015 Eje pelador de mollejas', cant: 4, operacionId: 'k3', ops: ['o3'], inicio: at(1, '14:00'), hh: 12, prioridad: 'media', entrega: day(4) });
  mk('r3', R, { orden: 'OV-4520', cliente: 'Granja San Benito', nombre: 'TPFR-200-022 Cuchilla circular Ø150', cant: 30, operacionId: 'k3', ops: ['o9'], inicio: at(0), hh: 18, estado: 'en proceso', avance: 50, hhReal: 10, prioridad: 'media', entrega: day(6) });
  mk('r4', R, { orden: 'OC-0231', cliente: 'Stock', nombre: 'TPFR-210-008 Piñón Z18 de transportador', cant: 20, operacionId: 'k4', hh: 16, prioridad: 'baja' });
  mk('r5', R, { orden: 'OC-0232', cliente: 'Stock', nombre: 'TPFR-200-040 Buje de bronce Ø40', cant: 50, operacionId: 'k3', hh: 9, prioridad: 'baja' });
  mk('r6', R, { orden: 'OV-4521', cliente: 'Frigorífico El Ceibo', nombre: 'TPFR-120-031 Guía de cuello inox', cant: 12, operacionId: 'k2', hh: 7, prioridad: 'alta', entrega: day(5) });
  mk('r7', R, { orden: 'OV-4498', cliente: 'Frigorífico El Ceibo', nombre: 'Tolva de descarga inox', cant: 1, operacionId: 'k5', ops: ['o8'], inicio: `${addDays(B, -5)}T07:00`, hh: 18, estado: 'terminada', avance: 100, hhReal: 21, finReal: `${addDays(B, -4)}T17:00`, entrega: addDays(B, -3) });
  mk('r8', R, { orden: 'OC-0229', cliente: 'Stock', nombre: 'TPFR-200-040 Buje de bronce Ø40', cant: 50, operacionId: 'k3', ops: ['o10'], inicio: `${addDays(B, -4)}T07:00`, hh: 9, estado: 'terminada', avance: 100, hhReal: 8, finReal: `${addDays(B, -4)}T16:00` });
  mk('r10', R, { orden: 'OV-4521', cliente: 'Frigorífico El Ceibo', nombre: 'TPFR-200-040 Buje de bronce Ø40', cant: 8, operacionId: 'k3', hh: 3, prioridad: 'media', entrega: day(5) });
  mk('t4', P2, { codigo: 'TPFR-200-040', nombre: 'Buje de bronce Ø40', cant: 16, operacionId: 'k3', hh: 4 });
  mk('r9', R, { orden: 'OC-0229', cliente: 'Stock', nombre: 'TPFR-210-008 Piñón Z18 de transportador', cant: 20, operacionId: 'k4', ops: ['o10'], inicio: `${addDays(B, -3)}T07:00`, hh: 16, estado: 'terminada', avance: 100, hhReal: 19, finReal: `${addDays(B, -2)}T15:00` });
  // historial de meses anteriores, para que las métricas tengan qué mostrar
  const prods = [['Dedo desplumador de goma', 'k7'], ['Eje de transportador', 'k3'], ['Cuchilla de corte de cloaca', 'k4'], ['Guía de patas inox', 'k2'], ['Rodillo tensor', 'k3'], ['Bandeja de goteo', 'k5']];
  const clis = ['Avícola del Litoral', 'Granja San Benito', 'Frigorífico El Ceibo'];
  let nro = 4400, nst = 200;
  [[5, 3], [4, 5], [3, 4], [2, 6], [1, 5]].forEach(([atras, n]) => { const b = pd(B); const m0 = ds(new Date(b.getFullYear(), b.getMonth() - atras, 1));
    for (let i = 0; i < n; i++) { const oc = i % 3 === 2, c = addDays(m0, 2 + i * 4), [nom, k] = prods[(atras + i) % prods.length], hh = 6 + ((atras * 3 + i * 5) % 13), f = addDays(c, 6 + ((atras + i * 3) % 5) * 6);
      mk('h' + atras + i, R, { orden: oc ? 'OC-0' + (nst++) : 'OV-' + (nro++), cliente: oc ? 'Stock' : clis[(atras + i) % 3], nombre: nom, cant: 5 + i * 10, operacionId: k, ops: ['o' + (1 + (atras + i) % 10)], inicio: `${addDays(c, 1)}T07:00`, hh, estado: 'terminada', avance: 100, hhReal: Math.round(hh * (0.85 + ((atras + i) % 4) * 0.12) * 2) / 2, finReal: `${f}T15:00`, creada: c }); } });
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
