import React, { useState, useMemo, useEffect, useRef, useCallback, createContext, useContext } from 'react';
import * as E from './engine.js';
const { fD, fDT, fDia, fH, fN } = E;

const Ctx = createContext(null);
const useApp = () => useContext(Ctx);
const KEY = 'produccionapp-preview-v2';
const PRI = { alta: 0, media: 1, baja: 2 };
const ACCENTS = ['#4fb0ff', '#5cc8c0', '#f08a4b', '#b08cf0', '#e37fa7', '#9bd05a'];
export const loadState = () => { try { const r = JSON.parse(localStorage.getItem(KEY)); if (r && r.v === 1 && r.tareas) return { ...r, tareas: r.tareas.map(t => t.codigo ? { ...t, nombre: `${t.codigo} ${t.nombre}`.trim(), codigo: '' } : t).map(t => t.estado === 'en proceso' && !t.crono ? { ...t, crono: { acum: Number(t.hhReal) || 0, desde: E.nowDT() } } : t), usuarios: r.usuarios || E.usuariosEjemplo() }; } catch (e) { } return E.sample(); };
const semOf = (h, cap) => h <= 0.01 ? 'n' : h > cap + 0.01 ? 'r' : h >= cap - 0.01 ? 'y' : 'g';
const opName = (S, id) => (S.operarios.find(o => o.id === id) || {}).nombre || '¿?';
const operName = (S, id) => (S.operaciones.find(o => o.id === id) || {}).nombre || '—';

async function saveFile(filename, data, toast) {
  try {
    const dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
    if (!dl) { const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data])); const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); toast('Archivo descargado'); return; }
    await dl.save({ filename, data }); toast('Archivo guardado');
  } catch (e) { if (!e || e.code !== 'declined') toast('No se pudo guardar el archivo'); }
}

function Chip({ t, small }) {
  const { S, V } = useApp(); const c = E.chipOf(S, V, t);
  return <span className={'chip' + (small ? ' sm' : '')} style={{ '--c': c.color }}>{c.txt}</span>;
}
const Pri = ({ p }) => <span className={'pri pri-' + p}>{p}</span>;
function etiqueta(V, t) { const p = t.parentId && V.byId[t.parentId]; return p && !p.partes ? `${t.nombre} · ${p.nombre}` : t.nombre; }
function Modal({ title, onClose, children, wide, foot }) {
  useEffect(() => { const k = e => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return <div className="ovl" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-label={title}>
      <header><h2>{title}</h2><button className="btn ghost" onClick={onClose} aria-label="Cerrar">Cerrar</button></header>
      <div className="modal-b">{children}</div>
      {foot && <footer>{foot}</footer>}
    </div>
  </div>;
}
function Bar({ v, color }) { return <span className="pbar"><i style={{ width: Math.min(100, Math.max(0, v)) + '%', background: color || 'var(--accent)' }} /></span>; }
const fHM = h => { const tm = Math.round((Number(h) || 0) * 60); return tm < 60 ? `${tm} min` : `${Math.floor(tm / 60)} h${tm % 60 ? ` ${tm % 60} min` : ''}`; };
function HM({ value, onChange }) { const tm = Math.round((Number(value) || 0) * 60), h = Math.floor(tm / 60), m = tm % 60;
  return <span className="hm"><input type="number" min="0" value={h} aria-label="Horas" onChange={e => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)) + m / 60)} /><small>h</small>
    <input type="number" min="0" max="59" value={m} aria-label="Minutos" onChange={e => onChange(h + Math.min(59, Math.max(0, Math.round(Number(e.target.value) || 0))) / 60)} /><small>min</small></span>; }
function Desvio({ real, plan }) { const d = real - plan; if (!(plan > 0)) return null; return <span className={Math.abs(d) < 0.02 ? 'mut' : d > 0 ? 'c-bad' : 'c-ok'}>{Math.abs(d) < 0.02 ? 'igual a lo proyectado' : `${d > 0 ? '+' : '−'}${fHM(Math.abs(d))} (${d > 0 ? '+' : '−'}${Math.round(Math.abs(d) / plan * 100)}%)`}</span>; }
// Qué puede cambiar cada usuario. En la etapa 2 las mismas reglas van también en Firebase.
function permiso(p, n, pm) {
  if (pm.admin) return null;
  if (['cfg', 'operarios', 'operaciones', 'feriados', 'usuarios', 'codigos'].some(k => p[k] !== n[k])) return 'Solo un administrador puede cambiar la configuración.';
  const DEF = ['nombre', 'cant', 'prioridad', 'operacionId', 'hh', 'preds', 'parentId', 'entrega', 'proyId'];
  const old = Object.fromEntries(p.tareas.map(t => [t.id, t])); const seen = new Set(); let rep = false, proyDef = p.proyectos !== n.proyectos, proyProg = false;
  n.tareas.forEach(t => { seen.add(t.id); const o = old[t.id]; if (o === t) return;
    if (t.tipo === 'rep') { rep = true; return; }
    if (!o) { if (t.parte) proyProg = true; else proyDef = true; return; }
    if (!t.parte && DEF.some(k => JSON.stringify(o[k]) !== JSON.stringify(t[k]))) proyDef = true; else proyProg = true; });
  p.tareas.forEach(t => { if (!seen.has(t.id)) { if (t.tipo === 'rep') rep = true; else proyDef = true; } });
  if (p.extras !== n.extras || p.extraModo !== n.extraModo || p.ausencias !== n.ausencias) rep = true;
  if (rep && !pm.rep) return 'Este usuario no puede editar Repuestos ni Producción.';
  if (proyDef && !pm.proy) return 'Este usuario no puede editar Proyectos.';
  if (proyProg && !pm.rep && !pm.proy) return 'Este usuario es solo de consulta.';
  return null;
}
const CAMPOS = { nombre: 'pieza', cant: 'cantidad', prioridad: 'prioridad', estado: 'estado', operacionId: 'operación', ops: 'operarios', turno: 'turno', inicio: 'inicio', hh: 'duración', hhReal: 'horas reales', avance: 'avance', entrega: 'entrega', orden: 'OV/OC', cliente: 'cliente', creada: 'fecha de carga' };
const FER2026 = [['01-01', 'Año Nuevo'], ['02-16', 'Carnaval'], ['02-17', 'Carnaval'], ['03-24', 'Día de la Memoria'], ['04-02', 'Veteranos y Caídos en Malvinas'], ['04-03', 'Viernes Santo'], ['05-01', 'Día del Trabajador'], ['05-25', 'Revolución de Mayo'], ['06-15', 'Paso a la Inmortalidad de Güemes'], ['06-20', 'Paso a la Inmortalidad de Belgrano'], ['07-09', 'Día de la Independencia'], ['08-17', 'Paso a la Inmortalidad de San Martín'], ['10-12', 'Respeto a la Diversidad Cultural'], ['11-23', 'Soberanía Nacional'], ['12-08', 'Inmaculada Concepción'], ['12-25', 'Navidad']];
const NOLAB2026 = [['03-23', 'Día no laborable'], ['07-10', 'Día no laborable'], ['12-07', 'Día no laborable']];
function describir(p, n) {
  const out = []; let k = '';
  const val = (S, f, v) => f === 'ops' ? ((v || []).map(o => opName(S, o)).join(', ') || 'sin asignar') : f === 'operacionId' ? operName(S, v) : f === 'inicio' ? fDT(v) : f === 'avance' ? `${Math.round(v || 0)}%` : (v === '' || v == null ? '—' : String(v));
  const dif = (o, t) => Object.keys(CAMPOS).filter(f => JSON.stringify(o[f]) !== JSON.stringify(t[f]));
  if (p.tareas !== n.tareas) { const old = Object.fromEntries(p.tareas.map(t => [t.id, t])), neu = new Set(n.tareas.map(t => t.id));
    const add = n.tareas.filter(t => !old[t.id]), del = p.tareas.filter(t => !neu.has(t.id)), chg = n.tareas.filter(t => old[t.id] && old[t.id] !== t && dif(old[t.id], t).length);
    const lista = l => l.length > 3 ? `${l.length} tareas` : l.map(t => `"${t.nombre}"`).join(', ');
    if (add.length) out.push('Agregó ' + lista(add)); if (del.length) out.push('Borró ' + lista(del));
    if (chg.length) out.push(chg.slice(0, 3).map(t => `"${t.nombre}": ${dif(old[t.id], t).map(f => `${CAMPOS[f]} ${val(p, f, old[t.id][f])} → ${val(n, f, t[f])}`).join(', ')}`).join(' · ') + (chg.length > 3 ? ` · y ${chg.length - 3} tareas más` : ''));
    if (out.length) k = 't:' + [...add, ...del, ...chg].slice(0, 4).map(t => t.id).join() + ':' + (chg[0] ? dif(old[chg[0].id], chg[0]).join() : ''); }
  [['proyectos', 'Cambió proyectos'], ['extras', 'Cambió horas extra'], ['extraModo', 'Cambió el uso de una extra'], ['ausencias', 'Cambió ausencias'], ['operarios', 'Cambió operarios'], ['operaciones', 'Cambió operaciones'], ['codigos', 'Cambió códigos de operación'], ['feriados', 'Cambió feriados'], ['usuarios', 'Cambió usuarios o permisos'], ['cfg', 'Cambió horarios o apariencia']]
    .forEach(([key, txt]) => { if (p[key] !== n[key] && !(key === 'extraModo' && p.extras !== n.extras)) { out.push(txt); k += '|' + key; } });
  return out.length ? { k, txt: out.join(' · ') } : null;
}
function espera(S, V, t) { const pr = E.predsDe(S, t); if (t.estado === 'terminada' || !pr.length) return null; let best = null;
  pr.forEach(pid => { const p = V.byId[pid], r = p && V.D[pid]; if (!p || r.estado === 'terminada') return; if (!best || (r.fin || '') > (best.fin || '')) best = { nombre: p.nombre, fin: r.fin }; }); return best; }
function juntar(up, ui, op, nombre) { let n = 0; up(s => { const r = E.compactar(s, op); n = r.n; return r.n ? r.S : s; });
  ui.toast(n ? `${n} ${n === 1 ? 'tarea adelantada' : 'tareas adelantadas'}${nombre ? ' de ' + nombre : ''}. Quedan marcadas en el cartel de Producción.` : 'No hay huecos para cerrar: las tareas ya están juntas o esperan a otra.'); }
function Kpi({ l, v, s, tone, onClick, on }) { const c = 'kpi' + (tone ? ' ' + tone : '') + (onClick ? ' click' : '') + (on ? ' on' : ''); const inner = <><span>{l}{onClick && <i className="kar">{on ? '▴' : '▾'}</i>}</span><b>{v}</b>{s && <em>{s}</em>}</>;
  return onClick ? <button type="button" className={c} aria-expanded={!!on} onClick={onClick}>{inner}</button> : <div className={c}>{inner}</div>; }

function riesgos(S, V) {
  const out = [];
  S.tareas.forEach(t => { if (t.tipo === 'rep' && !t.parentId && t.entrega) { const r = V.D[t.id]; if (r.estado !== 'terminada' && r.fin && r.fin.slice(0, 10) > t.entrega) out.push({ id: t.id, txt: `${t.orden} ${t.nombre}`, dias: E.diffDays(t.entrega, r.fin.slice(0, 10)) }); } });
  S.proyectos.forEach(p => { if (!p.entrega) return; const f = S.tareas.filter(t => t.proyId === p.id).map(t => V.D[t.id].fin).filter(Boolean).sort().pop(); if (f && f.slice(0, 10) > p.entrega) out.push({ proy: p.id, txt: p.nombre, dias: E.diffDays(p.entrega, f.slice(0, 10)) }); });
  return out;
}
function flatten(roots, V, collapsed, vis, orden) {
  const so = orden || (l => l);
  const out = []; const go = (t, depth) => { if (vis && !vis(t)) return; const ch = V.kids[t.id] || []; out.push({ t, depth, hasKids: ch.length > 0 }); if (!collapsed.has(t.id)) so(ch).forEach(c => go(c, depth + 1)); };
  so(roots).forEach(r => go(r, 0)); return out;
}
// Orden de las piezas de un proyecto: el que fijaste a mano (▲▼) o, si no, por etapa de fabricación
const ordenProy = S => l => l.map((t, i) => [t, i]).sort((a, b) => ((a[0].pos ?? 1e9) - (b[0].pos ?? 1e9)) || ((E.etapaDe(S, a[0]) ?? 999) - (E.etapaDe(S, b[0]) ?? 999)) || (a[1] - b[1])).map(x => x[0]);
const useSet = () => { const [s, set] = useState(() => new Set()); const tog = id => set(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; }); return [s, tog, set]; };

/* ================= RESUMEN ================= */
function OpStrip() {
  const { S, V, ui } = useApp(); const hoy = E.today(), now = E.nowDT();
  if (!S.operarios.some(o => o.activo)) return <p className="note">Todavía no hay operarios cargados. Agregalos en Configuración para empezar a programar.</p>;
  return <div className="opstrip">
    {S.operarios.filter(o => o.activo).map((o, oi) => {
      const mine = S.tareas.filter(t => t.ops.includes(o.id) && !V.D[t.id].parent && t.estado !== 'terminada');
      const curDe = l => l.find(t => E.corriendo(t)) || l.find(t => t.estado === 'en proceso' || t.pausada) || l.find(t => t.inicio && t.inicio <= now && V.D[t.id].fin > now); const nom = t => t.nombre + (t.pausada || (t.estado === 'en proceso' && !E.corriendo(t)) ? ' (en pausa)' : '');
      const ex = mine.filter(t => t.turno === 'extra'), cn = curDe(mine.filter(t => t.turno !== 'extra')), ce = curDe(ex);
      const aus = E.ausenciaDe(S, o.id, hoy);
      return <button key={o.id} className={'opchip' + (aus ? ' aus' : cn || ce ? ' busy' : '')} onClick={() => ui.modal({ k: 'op', id: o.id })}>
        <Av o={o} i={S.operarios.indexOf(o)} /><b>{o.nombre}</b>
        {aus ? <span>{aus.motivo}</span> : <>
          <span><em>N</em>{cn ? nom(cn) : 'Libre'}</span>
          {ex.length > 0 && <span><em>E</em>{ce ? nom(ce) : ex[0].nombre + ' (en cola)'}</span>}</>}
        {!aus && (() => { const c = E.capN(S, o.id, hoy) + E.extraDe(S, o.id, hoy), l = ((V.load[`${o.id}|${hoy}|normal`] || {}).h || 0) + ((V.load[`${o.id}|${hoy}|extra`] || {}).h || 0); return <span className="opload"><Bar v={c ? l / c * 100 : 0} color={l > c + 0.01 ? 'var(--bad)' : undefined} /><small>{fN(l)}/{fN(c)} h hoy</small></span>; })()}
      </button>;
    })}
  </div>;
}
function PushBanner() {
  const { S, V, up } = useApp(); const [open, setOpen] = useState(false);
  const ps = S.tareas.filter(t => t.empuje); if (!ps.length) return null;
  const ok = id => up(s => ({ ...s, tareas: s.tareas.map(t => (!id || t.id === id) && t.empuje ? { ...t, empuje: null } : t) }));
  const rev = id => up(s => ({ ...s, tareas: s.tareas.map(t => (!id || t.id === id) && t.empuje ? { ...t, inicio: t.empuje, empuje: null } : t) }));
  const ade = ps.filter(t => t.inicio < t.empuje).length, emp = ps.length - ade;
  return <div className="push">
    <div className="push-h">
      <b>{[emp && `${emp} ${emp === 1 ? 'tarea empujada' : 'tareas empujadas'}`, ade && `${ade} ${ade === 1 ? 'tarea adelantada' : 'tareas adelantadas'}`].filter(Boolean).join(' · ')}</b>
      <span>Quedan marcadas hasta que des el OK.</span>
      <button className="btn" onClick={() => setOpen(!open)}>{open ? 'Ocultar' : 'Ver detalle'}</button>
      <button className="btn pri-b" onClick={() => ok()}>Dar OK a todas</button>
      <button className="btn" onClick={() => rev()}>Volver todas atrás</button>
    </div>
    {open && <ul>{ps.map(t => <li key={t.id}><Chip t={t} small /> <b>{etiqueta(V, t)}</b><span className={'tag ' + (t.inicio < t.empuje ? 'ok' : 'warn')}>{t.inicio < t.empuje ? '↤ adelantada' : '↦ empujada'}</span><span className="mut">{fDT(t.empuje)} → {fDT(t.inicio)}</span>
      <button className="btn sm" onClick={() => ok(t.id)}>OK</button><button className="btn sm" onClick={() => rev(t.id)}>Volver atrás</button></li>)}</ul>}
  </div>;
}
// Carga de las próximas 6 semanas por operario (normal + extra)
function Capacidad({ w0, irA }) {
  const { S, V } = useApp(); const sems = [0, 1, 2, 3, 4, 5].map(i => E.addDays(w0, i * 7)); const ops = S.operarios.filter(o => o.activo);
  const celda = (o, w) => { let c = 0, l = 0; for (let i = 0; i < 7; i++) { const d = E.addDays(w, i); c += E.capN(S, o.id, d) + E.extraDe(S, o.id, d); l += ((V.load[`${o.id}|${d}|normal`] || {}).h || 0) + ((V.load[`${o.id}|${d}|extra`] || {}).h || 0); } return { c, l }; };
  const tono = (l, c) => { const p = c ? l / c : (l > 0 ? 2 : 0); return p > 1.001 ? 'r' : p >= 0.85 ? 'y' : p > 0.01 ? 'g' : 'n'; };
  const caja = (x, k, onClick) => <td key={k} className={'cap-' + tono(x.l, x.c)} onClick={onClick} title={`${fN(x.l)} h ocupadas de ${fN(x.c)} h disponibles`}>
    <b>{x.c ? Math.round(x.l / x.c * 100) + '%' : x.l > 0 ? 'sin horas' : '—'}</b><small>{fN(x.l)}/{fN(x.c)} h</small><span className="pbar"><i style={{ width: Math.min(100, x.c ? x.l / x.c * 100 : 0) + '%' }} /></span></td>;
  const tot = sems.map(w => ops.reduce((a, o) => { const x = celda(o, w); return { c: a.c + x.c, l: a.l + x.l }; }, { c: 0, l: 0 }));
  return <><div className="scroll"><table className="capt">
    <thead><tr><th className="stk">Operario</th>{sems.map(w => <th key={w}><button className="lnk" onClick={() => irA(w)}>Semana del {fD(w)}</button></th>)}</tr></thead>
    <tbody>{ops.map(o => <tr key={o.id}><th className="stk">{o.nombre}</th>{sems.map(w => caja(celda(o, w), w, () => irA(w)))}</tr>)}
      <tr className="tot"><th className="stk">Todo el taller</th>{tot.map((x, i) => caja(x, i, () => irA(sems[i])))}</tr></tbody></table></div>
    <p className="legend"><i className="lg g" />con lugar <i className="lg y" />85% o más <i className="lg r" />sobrecargado · cuenta turno normal y horas extra habilitadas · tocá una semana para verla en detalle</p></>;
}
function Resumen() {
  const { S, V, up, ui } = useApp();
  const [w0, setW0] = useState(() => { const t = E.today(), g = E.dow(t); return E.monday(g === 6 ? E.addDays(t, 2) : g === 0 ? E.addDays(t, 1) : t); });
  const [fp, setFp] = useState(''); const [fo, setFo] = useState(''); const [vista, setVista] = useState('sem');
  const days = [0, 1, 2, 3, 4, 5, 6].map(i => E.addDays(w0, i)); const hoy = E.today();
  const ops = S.operarios.filter(o => o.activo);
  const setExtra = (op, d, v, modo) => up(s => E.setExtraDia(s, op, d, v, modo));
  const nuevaExtra = (op, d) => up(s => E.setExtraDia(s, op, d, 2, s.tareas.some(t => t.ops.includes(op) && t.turno === 'extra' && t.estado !== 'terminada') ? 'aparte' : 'sigue'));
  const drop = (e, op, d, turno) => { e.preventDefault(); e.currentTarget.classList.remove('over'); try { const x = JSON.parse(e.dataTransfer.getData('text/plain')); up(s => E.assignTo(s, x.id, op, d, turno, x.from)); } catch (err) { } };
  const dnd = (op, d, turno) => ({ onDragOver: e => { e.preventDefault(); e.currentTarget.classList.add('over'); }, onDragLeave: e => e.currentTarget.classList.remove('over'), onDrop: e => drop(e, op, d, turno) });
  let capSem = 0, loadSem = 0, rojas = 0;
  const wk = {};
  ops.forEach(o => { let c = 0, l = 0; days.forEach(d => { const cn = E.capN(S, o.id, d), ce = E.extraDe(S, o.id, d); const ln = (V.load[`${o.id}|${d}|normal`] || {}).h || 0, le = (V.load[`${o.id}|${d}|extra`] || {}).h || 0; c += cn + ce; l += ln + le; if (semOf(ln, cn) === 'r') rojas++; if (semOf(le, ce) === 'r') rojas++; }); wk[o.id] = { c, l }; capSem += c; loadSem += l; });
  const rs = riesgos(S, V);
  const chips = (op, d, turno) => ((V.load[`${op}|${d}|${turno}`] || {}).items || []).map(it => {
    const t = V.byId[it.id]; const c = E.chipOf(S, V, t);
    if (it.sigue) return <div key={it.id + 's'} className="cchip sig" style={{ '--c': c.color }} onClick={() => ui.modal({ k: 'task', id: t.id })} title={`Sigue en la extra lo del turno normal · ${c.txt} · ${etiqueta(V, t)}`}><b>{c.txt}</b><span>↪ {t.nombre}</span><i>{fN(it.h)} h</i></div>;
    return <div key={it.id} className={'cchip' + (t.empuje ? ' pushed' : '') + (t.estado === 'terminada' ? ' done' : '')} style={{ '--c': c.color }} draggable
      onDragStart={e => e.dataTransfer.setData('text/plain', JSON.stringify({ id: t.id, from: op }))} onClick={() => ui.modal({ k: 'task', id: t.id })}
      title={`${c.txt} · ${etiqueta(V, t)} · ${fDT(t.inicio)} → ${fDT(V.D[t.id].fin)}`}>
      <b>{c.txt}</b><span>{t.empuje ? (t.inicio < t.empuje ? '↤ ' : '↦ ') : ''}{t.nombre}</span><i>{fN(it.h)} h</i>
      <button aria-label="Quitar del operario" onClick={e => { e.stopPropagation(); up(s => E.unassign(s, t.id, op)); }}>×</button>
    </div>;
  });
  const cell = (o, d) => {
    const cn = E.capN(S, o.id, d), ce = E.extraDe(S, o.id, d);
    const ln = (V.load[`${o.id}|${d}|normal`] || {}).h || 0, le = (V.load[`${o.id}|${d}|extra`] || {}).h || 0;
    const fer = E.feriadoDe(S, d), aus = E.ausenciaDe(S, o.id, d), wd = E.isWork(S, d);
    const motivo = aus ? aus.motivo : fer ? 'Feriado' : !wd ? '' : null;
    return <td key={d} className={d === hoy ? 'hoy' : ''}>
      <div className={`half sem-${semOf(ln, cn)}${motivo !== null ? ' blk' : ''}`} {...dnd(o.id, d, 'normal')}>
        <div className="half-h"><span className="tn">N</span>
          {motivo !== null ? <span className="ld">{motivo}</span> : <span className="ld">{fN(ln)}/{fN(cn)} h</span>}
          {motivo === null && <button className="mini" aria-label="Asignar tarea" onClick={() => ui.modal({ k: 'pick', op: o.id, d, turno: 'normal' })}>+</button>}
        </div>
        {chips(o.id, d, 'normal')}
      </div>
      {ce > 0 || le > 0 ? <div className={`half ex sem-${semOf(le, ce)}`} {...dnd(o.id, d, 'extra')}>
        <div className="half-h"><span className="tn">E</span>
          <span className="ld">{fN(le)}/</span>
          <input className="xh" type="number" min="0" step="0.5" value={ce} aria-label="Horas extra habilitadas" onChange={e => setExtra(o.id, d, e.target.value)} /><span className="ld">h</span>
          <button className={'modo' + (E.modoExtra(S, o.id, d) === 'sigue' ? ' on' : '')} title={E.modoExtra(S, o.id, d) === 'sigue' ? 'Esta extra sigue con lo del turno normal. Tocá para usarla en un trabajo aparte.' : 'Esta extra es para un trabajo aparte. Tocá para que siga con lo del turno normal.'} onClick={() => setExtra(o.id, d, ce, E.modoExtra(S, o.id, d) === 'sigue' ? 'aparte' : 'sigue')}>{E.modoExtra(S, o.id, d) === 'sigue' ? 'sigue' : 'aparte'}</button>
          {E.modoExtra(S, o.id, d) !== 'sigue' && <button className="mini" aria-label="Asignar tarea en extra" onClick={() => ui.modal({ k: 'pick', op: o.id, d, turno: 'extra' })}>+</button>}
        </div>
        {chips(o.id, d, 'extra')}
      </div> : !aus && <button className="addx" {...dnd(o.id, d, 'extra')} onClick={() => nuevaExtra(o.id, d)}>+ extra</button>}
    </td>;
  };
  const pend = tipo => S.tareas.filter(t => t.tipo === tipo && !V.D[t.id].parent && t.estado === 'pendiente' && (!fp || t.prioridad === fp) && (!fo || (fo === '_' ? !t.ops.length : t.ops.includes(fo))))
    .sort((a, b) => PRI[a.prioridad] - PRI[b.prioridad] || ((a.inicio || '9') < (b.inicio || '9') ? -1 : 1));
  const lista = (tit, tipo) => { const l = pend(tipo); return <div className="pcol">
    <h3>{tit} <span className="cnt">{l.length}</span></h3>
    {l.length === 0 && <p className="mut">No hay tareas pendientes con este filtro.</p>}
    {l.map(t => <div key={t.id} className="pitem" draggable onDragStart={e => e.dataTransfer.setData('text/plain', JSON.stringify({ id: t.id }))} onClick={() => ui.modal({ k: 'task', id: t.id })}>
      <Chip t={t} small /><span className="pn">{etiqueta(V, t)}</span><Pri p={t.prioridad} />
      <span className="mut">{fH(t.hh)} · {t.ops.length ? t.ops.map(o => opName(S, o)).join(', ') + ' · ' + fDT(t.inicio) : 'Sin asignar'}</span>
      {!t.ops.length && (() => { const r = E.recomendar(S, t)[0]; return r && <span className="sug">Sugerido: <b>{r.nombre}</b> desde {fDT(r.ini)} <button className="btn sm" onClick={e => { e.stopPropagation(); up(s => E.darA(s, t.id, r.op, r.ini)); ui.toast(`Asignada a ${r.nombre}`); }}>Dársela</button></span>; })()}
    </div>)}
  </div>; };
  return <div className="view">
    <section>
      <div className="sec-h"><h2>Operarios</h2><span className="mut">Tocá uno para ver qué está haciendo, finalizarle la tarea o darle otra.</span></div>
      <OpStrip />
    </section>
    <PushBanner />
    <section>
      <div className="sec-h">
        <div className="row"><h2>{vista === 'sem' ? `Semana del ${fD(w0)} al ${fD(days[6])}` : 'Carga de las próximas semanas'}</h2>
          <div className="seg"><button className={vista === 'sem' ? 'on' : ''} onClick={() => setVista('sem')}>Semana</button><button className={vista === 'cap' ? 'on' : ''} onClick={() => setVista('cap')}>6 semanas</button></div></div>
        <div className="row">
          <button className="btn" onClick={() => setW0(E.addDays(w0, -7))} aria-label="Semana anterior">←</button>
          <button className="btn" onClick={() => setW0(E.monday(hoy))}>Hoy</button>
          <button className="btn" onClick={() => setW0(E.addDays(w0, 7))} aria-label="Semana siguiente">→</button>
          <button className="btn" onClick={() => ui.modal({ k: 'hoy' })}>Parte del día</button>
          <button className="btn" title="Adelanta las tareas pendientes de todos para cerrar los huecos libres" onClick={() => juntar(up, ui, null)}>Juntar tareas</button>
          <button className="btn" title="Corre desde ahora lo que quedó atrasado según el avance real. Queda marcado en el cartel para dar el OK." onClick={() => { let n = 0; up(s => { const r = E.reprogramar(s); n = r.n; return r.n ? r.S : s; }); ui.toast(n ? `${n} ${n === 1 ? 'tarea reprogramada' : 'tareas reprogramadas'} desde ahora. Revisalas en el cartel.` : 'No hay tareas atrasadas.'); }}>Reprogramar atrasadas</button>
        </div>
      </div>
      <div className="kpis">
        <Kpi l="Carga de la semana" v={capSem ? Math.round(loadSem / capSem * 100) + '%' : '—'} s={`${fN(loadSem)} de ${fN(capSem)} h`} />
        <Kpi l="Celdas sobrecargadas" v={rojas} tone={rojas ? 'bad' : ''} />
        <Kpi l="Empujes sin OK" v={S.tareas.filter(t => t.empuje).length} tone={S.tareas.some(t => t.empuje) ? 'warn' : ''} />
        <Kpi l="Entregas en riesgo" v={rs.length} tone={rs.length ? 'bad' : ''} s={rs[0] ? `${rs[0].txt}: +${rs[0].dias} d` : ''} />
      </div>
      {vista === 'sem' ? <>
      <div className="scroll"><table className="cal">
        <thead><tr><th className="stk">Operario</th>{days.map(d => { const f = E.feriadoDe(S, d); return <th key={d} className={(d === hoy ? 'hoy ' : '') + (E.isWork(S, d) ? '' : 'off')}>{fDia(d)}{f && <small>{f.nombre}</small>}</th>; })}</tr></thead>
        <tbody>{ops.map(o => <tr key={o.id}>
          <th className="stk"><button className="oplink" onClick={() => ui.modal({ k: 'op', id: o.id })}><Av o={o} i={S.operarios.indexOf(o)} sm />{o.nombre}</button>
            <button className="jbtn" title={`Adelanta las tareas pendientes de ${o.nombre} para cerrar los huecos libres`} onClick={() => juntar(up, ui, o.id, o.nombre)}>juntar</button>
            <small>{fN(wk[o.id].l)}/{fN(wk[o.id].c)} h</small><Bar v={wk[o.id].c ? wk[o.id].l / wk[o.id].c * 100 : 0} color={wk[o.id].l > wk[o.id].c + .01 ? 'var(--bad)' : undefined} /></th>
          {days.map(d => cell(o, d))}</tr>)}</tbody>
      </table></div>
      <p className="legend"><i className="lg g" />con lugar <i className="lg y" />completo <i className="lg r" />sobrecargado · N turno normal · E horas extra (sigue: continúa lo del turno normal ese día; aparte: otro trabajo) · arrastrá una tarea para moverla de día, de turno o de operario</p>
      </> : <Capacidad w0={w0} irA={d => { setW0(d); setVista('sem'); }} />}
    </section>
    <section>
      <div className="sec-h"><h2>Tareas pendientes</h2>
        <div className="row">
          <select id="f-pri" value={fp} onChange={e => setFp(e.target.value)} aria-label="Prioridad"><option value="">Toda prioridad</option><option value="alta">Alta</option><option value="media">Media</option><option value="baja">Baja</option></select>
          <select id="f-op" value={fo} onChange={e => setFo(e.target.value)} aria-label="Operario"><option value="">Todos los operarios</option><option value="_">Sin asignar</option>{ops.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select>
        </div></div>
      <div className="pcols">{lista('Repuestos', 'rep')}{lista('Proyectos', 'proy')}</div>
    </section>
  </div>;
}

/* ================= TABLA DE TAREAS ================= */
function EdIn({ value, onCommit, type = 'text', className = '', ...rest }) {
  const base = value == null ? '' : value; const [v, setV] = useState(base); const fresh = useRef(false); const cur = useRef(base); cur.current = base;
  useEffect(() => { setV(base); }, [base]);
  return <input className={'ci ' + className} type={type} value={v} data-sucio={String(v) !== String(base) ? '1' : undefined} onChange={e => setV(e.target.value)} onBlur={() => { if (String(v) !== String(base)) { onCommit(v); setTimeout(() => setV(cur.current), 0); } }}
    onFocus={e => { if (type !== 'datetime-local') { fresh.current = true; e.target.select(); } }} onMouseUp={e => { if (fresh.current) { e.preventDefault(); fresh.current = false; } }}
    onKeyDown={e => { fresh.current = false; if (e.key === 'Enter') e.currentTarget.blur(); }} {...rest} />;
}
function OpsCell({ t }) {
  const { S, up } = useApp(); const [pos, setPos] = useState(null);
  useEffect(() => { if (!pos) return; const h = e => { if (!e.target.closest('.opspop') && !e.target.closest('.opsbtn')) setPos(null); }; const c = () => setPos(null);
    window.addEventListener('mousedown', h); window.addEventListener('scroll', c, true); return () => { window.removeEventListener('mousedown', h); window.removeEventListener('scroll', c, true); }; }, [pos]);
  const tog = o => up(s => { const cur = s.tareas.find(x => x.id === t.id); if (!cur) return s; if (cur.ops.includes(o)) return cur.ops.length === 1 ? E.unassign(s, t.id, o) : E.patchTask(s, t.id, { ops: cur.ops.filter(x => x !== o) }, true); return E.assignTo(s, t.id, o, null, cur.turno); });
  return <>
    <button className={'ci opsbtn' + (t.ops.length ? '' : ' mut')} onClick={e => { const r = e.currentTarget.getBoundingClientRect(); setPos(pos ? null : { x: Math.min(r.left, window.innerWidth - 190), y: r.bottom + 2 }); }}>{t.ops.length ? t.ops.map(o => opName(S, o)).join(', ') : 'Sin asignar'}</button>
    {pos && <div className="opspop" style={{ left: pos.x, top: pos.y }}>{S.operarios.filter(o => o.activo || t.ops.includes(o.id)).map(o => <label key={o.id}><input type="checkbox" checked={t.ops.includes(o.id)} onChange={() => tog(o.id)} /> {o.nombre}</label>)}</div>}
  </>;
}
const colsDe = tipo => [...(tipo === 'rep' ? [['orden', 'OV/OC', 148], ['cliente', 'Cliente', 160]] : []), ['nombre', 'Pieza', 300], ['cant', 'Cant.', 66], ['prioridad', 'Prioridad', 108], ['estado', 'Estado', 118], ['operacion', 'Operación', 130], ['ops', 'Operarios', 150], ['turno', 'Turno', 92], ['hh', 'Duración', 132], ['inicio', 'Inicio', 190], ['fin', 'Fin', 190], ['real', 'HH real', 80], ['avance', 'Avance %', 86], ['acts', '', 124]];
function TaskTable({ roots, tipo, vis, collapsed, toggle, orden }) {
  const { S, V, up, ui } = useApp(); const own = useSet();
  const col = collapsed || own[0], tog = toggle || own[1];
  const cols = colsDe(tipo), WK = 'produccionapp-cols5-' + tipo;
  const [W, setW] = useState(() => { const d = Object.fromEntries(cols.map(c => [c[0], c[2]])); try { return { ...d, ...JSON.parse(localStorage.getItem(WK) || '{}') }; } catch (e) { return d; } });
  useEffect(() => { try { localStorage.setItem(WK, JSON.stringify(W)); } catch (e) { } }, [W]);
  const resize = (e, k) => { e.preventDefault(); const x0 = e.clientX, w0 = W[k];
    const mv = ev => setW(p => ({ ...p, [k]: Math.max(44, w0 + ev.clientX - x0) })); const end = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', end); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', end); };
  const rows = flatten(roots, V, col, vis, orden);
  const [sel, setSel] = useState(() => new Set()); const togSel = id => setSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const vivos = [...sel].filter(id => V.byId[id]); const todos = rows.length > 0 && rows.every(r => sel.has(r.t.id));
  const hojasSel = () => { const set_ = new Set(); vivos.forEach(id => { if (V.D[id].parent) E.descendants(S, id).forEach(d => { if (!V.D[d].parent) set_.add(d); }); else set_.add(id); }); return S.tareas.filter(t => set_.has(t.id)).sort((a, b) => (a.inicio || '9') < (b.inicio || '9') ? -1 : 1).map(t => t.id); };
  const enBloque = (que, val) => { if (!val) return; const ids = hojasSel(); let n = 0;
    up(s => { let s2 = s;
      if (que === 'prioridad') { const all = new Set([...vivos, ...ids]); n = all.size; return { ...s2, tareas: s2.tareas.map(t => all.has(t.id) ? { ...t, prioridad: val } : t) }; }
      ids.forEach(id => { const t = s2.tareas.find(x => x.id === id); if (!t || t.estado === 'terminada') return; n++;
        if (que === 'op') s2 = E.darA(s2, id, val, E.nextFree({ ...s2, tareas: s2.tareas.filter(x => x.id !== id) }, val, t.turno || 'normal', [val]));
        else if (que === 'operacion') s2 = E.patchTask(s2, id, { operacionId: val, opAuto: false });
        else if (que === 'turno') s2 = E.patchTask(s2, id, { turno: val }, true); });
      return s2; });
    ui.toast(n ? `Cambiadas ${n} ${n === 1 ? 'tarea' : 'tareas'}` : 'Nada para cambiar: las seleccionadas están terminadas'); };
  const borrarSel = () => { const ids = vivos; up(s => ids.reduce((a, id) => a.tareas.some(t => t.id === id) ? E.delTask(a, id) : a, s)); setSel(new Set()); ui.toast(`Borradas ${ids.length}. Podés deshacerlo arriba.`); };
  const set = (t, patch, mover) => up(s => E.patchTask(s, t.id, patch, !!mover));
  const mover = (t, dir) => { const sib = orden(S.tareas.filter(x => x.parentId === t.parentId && x.tipo === t.tipo && x.proyId === t.proyId)); const i = sib.findIndex(x => x.id === t.id), j = i + dir;
    if (j < 0 || j >= sib.length) return; const l = sib.slice(); [l[i], l[j]] = [l[j], l[i]]; const pos = {}; l.forEach((x, k) => { pos[x.id] = (k + 1) * 10; });
    up(s => ({ ...s, tareas: s.tareas.map(x => pos[x.id] !== undefined && x.pos !== pos[x.id] ? { ...x, pos: pos[x.id] } : x) })); };
  const setEstado = (t, e) => up(s => E.setEstado(s, t.id, e));
  const setFin = (t, v) => { if (!t.inicio || !v) return; const h = E.workBetween(S, t.inicio, v, t.turno, t.ops) * Math.max(1, t.ops.length); if (h > 0) set(t, { hh: Math.round(h * 100) / 100 }, true); else ui.toast('El fin tiene que caer en horario de trabajo, después del inicio'); };
  const num = v => Math.max(0, Number(String(v).replace(',', '.')) || 0);
  const nav = e => { const k = e.key, el = e.target, td = el.closest('td'); if (!td || e.altKey || e.ctrlKey || e.metaKey) return;
    const tr = td.parentElement, rid = tr.dataset.id, chk = el.classList && el.classList.contains('selc');
    // Selección como en Excel: Mayús+Espacio marca la fila; en la casilla de la primera columna alcanza con Espacio; Mayús+↑/↓ va sumando filas
    if (k === ' ' && rid && (e.shiftKey || chk || el === td)) { e.preventDefault(); togSel(rid); return; }
    if (chk && (k === 'ArrowRight' || k === 'Enter' || k === 'F2')) { const n = td.querySelector('input.ci:not(.selc):not(:disabled)'); if (n) { e.preventDefault(); n.focus(); try { n.select(); } catch (err) { } } return; }
    if (e.shiftKey && rid && (k === 'ArrowDown' || k === 'ArrowUp')) { const o = (k === 'ArrowDown' ? tr.nextElementSibling : tr.previousElementSibling); const oid = o && o.dataset.id; setSel(p => { const n = new Set(p); n.add(rid); if (oid) n.add(oid); return n; }); }
    if (k === 'ArrowLeft' && td.cellIndex === 0 && !chk && el.tagName === 'INPUT' && el.selectionStart === 0) { const c = td.querySelector('input.selc'); if (c) { e.preventDefault(); c.focus(); return; } }
    const enter = k === 'Enter' && (el.tagName === 'INPUT' || el === td) && !chk; if (!k.startsWith('Arrow') && !enter) return;
    const ir = c => { if (!c) return false; const f = (chk && c.cellIndex === 0 && c.querySelector('input.selc')) || c.querySelector('input.ci:not(:disabled),select.ci,button.opsbtn') || c; f.focus(); if (f.tagName === 'INPUT' && f.type !== 'datetime-local') { try { f.select(); } catch (err) { } }
      const w = c.closest('.xlw'), h = w.querySelector('thead'), p = c.parentElement.firstElementChild, cr = c.getBoundingClientRect(), wr = w.getBoundingClientRect();
      if (c !== p && cr.left < wr.left + p.offsetWidth) w.scrollLeft -= wr.left + p.offsetWidth - cr.left; if (cr.top < wr.top + h.offsetHeight) w.scrollTop -= wr.top + h.offsetHeight - cr.top; return true; };
    if (enter || k === 'ArrowUp' || k === 'ArrowDown') { e.preventDefault(); const r = k === 'ArrowUp' ? td.parentElement.previousElementSibling : td.parentElement.nextElementSibling; if (r && r.children[td.cellIndex]) ir(r.children[td.cellIndex]); else if (enter && el !== td) ir(td); return; }
    if (el.tagName === 'INPUT' && el.type === 'text') { const a = el.selectionStart, b = el.selectionEnd, n = el.value.length, todo = a === 0 && b === n; if (k === 'ArrowLeft' && !todo && !(a === 0 && b === 0)) return; if (k === 'ArrowRight' && !todo && !(a === n && b === n)) return; }
    e.preventDefault(); ir(k === 'ArrowLeft' ? td.previousElementSibling : td.nextElementSibling); };
  const marcas = (t, hasKids, r) => { const esp = !r.parent && espera(S, V, t); const late = !t.parentId && t.entrega && r.estado !== 'terminada' && r.fin && r.fin.slice(0, 10) > t.entrega; return <>
    {t.manual && r.estado !== 'terminada' && <button className="mk pin" title="Fecha fijada a mano: no se corre por etapas. Tocá para soltarla." onClick={() => set(t, { manual: false }, true)}>📌</button>}
    {r.estado === 'terminada' && <span className="mk ok" title={t.finReal ? 'Terminada el ' + fDT(t.finReal) : 'Terminada'}>✓</span>}
    {late && <span className="mk bad" title={`Se pasa ${E.diffDays(t.entrega, r.fin.slice(0, 10))} días de la entrega del ${fD(t.entrega)}`}>+{E.diffDays(t.entrega, r.fin.slice(0, 10))}d</span>}
    {!late && !t.parentId && t.entrega && r.estado !== 'terminada' && <span className="mk" title={`Entrega comprometida: ${fD(t.entrega)}`}>{fD(t.entrega)}</span>}
    {t.empuje && <span className="mk warn" title={`Empujada: estaba para ${fDT(t.empuje)}. Dale el OK en Producción.`}>↦</span>}
    {!r.ok && !r.parent && <span className="mk bad" title={`Faltan ${fN(r.falta)} h extra por habilitar en el calendario`}>!h</span>}
    {esp && <span className="mk" title={`Espera a "${esp.nombre}"${esp.fin ? ', que termina ' + fDT(esp.fin) : ', que todavía no está programada'}. Por eso no se adelanta.`}>⧖</span>}</>; };
  const cell = (k, t, depth, hasKids, r) => {
    switch (k) {
      case 'orden': return !t.parentId ? <EdIn value={t.orden} placeholder="OV-0000" onCommit={v => set(t, { orden: v.trim() })} /> : null;
      case 'cliente': return !t.parentId ? <EdIn value={t.cliente} onCommit={v => set(t, { cliente: v.trim() })} /> : null;
      case 'nombre': return <div className="tname" style={{ paddingLeft: depth * 14 }}>{hasKids ? <button className="tog" onClick={() => tog(t.id)} aria-label="Desplegar">{col.has(t.id) ? '▸' : '▾'}</button> : <span className="tog" />}<EdIn value={t.nombre} placeholder="(sin nombre)" onCommit={v => set(t, { nombre: v, ...(r.parent ? {} : E.autoCompletar(S, { ...t, nombre: v }, false)) })} /></div>;
      case 'cant': return <EdIn className="num" type="number" min="0" value={t.cant} onCommit={v => set(t, { cant: num(v) })} />;
      case 'prioridad': return <select className={'ci p-' + t.prioridad} value={t.prioridad} onChange={e => set(t, { prioridad: e.target.value })} aria-label="Prioridad"><option>alta</option><option>media</option><option>baja</option></select>;
      case 'estado': return r.parent ? <span className={'est e-' + r.estado.replace(' ', '')}>{r.estado}</span> : <select className={'ci est e-' + t.estado.replace(' ', '')} value={t.estado} onChange={e => setEstado(t, e.target.value)} aria-label="Estado"><option>pendiente</option><option>en proceso</option><option>terminada</option></select>;
      case 'operacion': return r.parent ? null : <select className={'ci' + (t.opAuto ? ' auto' : '')} title={t.opAuto ? 'Asignada automáticamente por el código o por las veces anteriores' : undefined} value={t.operacionId} onChange={e => set(t, { operacionId: e.target.value, opAuto: false })} aria-label="Operación"><option value="">—</option>{S.operaciones.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select>;
      case 'ops': return r.parent ? <span className="ro">{r.ops.map(o => opName(S, o)).join(', ')}</span> : <OpsCell t={t} />;
      case 'turno': return r.parent ? null : <select className="ci" value={t.turno} onChange={e => set(t, { turno: e.target.value }, true)} aria-label="Turno"><option value="normal">Normal</option><option value="extra">Extra</option></select>;
      case 'hh': return r.parent ? <span className="ro num">{fN(r.hh)}</span> : <div className="hhc"><EdIn className="num" type="number" min="0" step="0.5" value={t.hh} onCommit={v => set(t, { hh: num(v) }, true)} />{t.ops.length > 1 && <small title="Duración en calendario: horas-hombre dividido la cantidad de operarios">÷{t.ops.length} = {fN(r.durCal)}</small>}</div>;
      case 'inicio': return r.parent ? <span className="ro">{fDT(r.inicio)}</span> : <EdIn type="datetime-local" value={t.inicio || ''} onCommit={v => set(t, { inicio: v || null }, true)} />;
      case 'fin': return r.parent ? <span className="ro">{fDT(r.fin)}</span> : <EdIn type="datetime-local" value={r.fin || ''} disabled={!t.inicio} onCommit={v => setFin(t, v)} />;
      case 'real': { if (r.parent) return <span className="ro num">{r.hhReal > 0 ? fN(r.hhReal) : '—'}</span>; const dif = r.hhReal > 0 ? r.hhReal - (r.estado === 'terminada' ? r.hh : r.hh * r.avance / 100) : 0; return <EdIn className={'num ' + (dif > 0.05 ? 'c-bad' : dif < -0.05 ? 'c-ok' : '')} type="number" min="0" step="0.5" value={t.hhReal || ''} placeholder="—" onCommit={v => set(t, { hhReal: num(v) })} />; }
      case 'avance': return r.parent ? <span className="ro num">{Math.round(r.avance)}</span> : <EdIn className="num" type="number" min="0" max="100" step="5" value={Math.round(r.avance)} disabled={t.estado === 'terminada'} onCommit={v => { const a = Math.min(100, num(v)); if (a >= 100) { up(s => E.setEstado(s, t.id, 'terminada')); ui.toast('Terminada: pasó a la lista de terminadas'); return; } set(t, { avance: a, estado: a > 0 && t.estado === 'pendiente' ? 'en proceso' : t.estado }); }} />;
      default: return <div className="acts">
        {orden && <><button title="Subir (orden manual)" aria-label="Subir" onClick={() => mover(t, -1)}>▲</button><button title="Bajar (orden manual)" aria-label="Bajar" onClick={() => mover(t, 1)}>▼</button></>}
        <button title="Editar todos los datos" aria-label="Editar" onClick={() => ui.modal({ k: 'task', id: t.id })}>✎</button>
        <button title="Agregar hijo" aria-label="Agregar hijo" onClick={() => ui.modal({ k: 'task', draft: { ...E.blankTask(t.tipo, t.proyId), parentId: t.id, prioridad: t.prioridad } })}>＋</button>
        <button title="Duplicar" aria-label="Duplicar" onClick={() => { up(s => E.dupTask(s, t.id)); ui.toast('Duplicada'); }}>⧉</button>
        <button title="Borrar" aria-label="Borrar" onClick={() => { up(s => E.delTask(s, t.id)); ui.toast('Borrada. Podés deshacerlo arriba.'); }}>✕</button></div>;
    }
  };
  return <>{vivos.length > 0 && <div className="bulk"><b>{vivos.length} {vivos.length === 1 ? 'seleccionada' : 'seleccionadas'}</b>
      <select value="" onChange={e => enBloque('op', e.target.value)} aria-label="Asignar operario"><option value="">Dar a operario…</option>{S.operarios.filter(o => o.activo).map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select>
      <select value="" onChange={e => enBloque('operacion', e.target.value)} aria-label="Operación"><option value="">Operación…</option>{S.operaciones.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select>
      <select value="" onChange={e => enBloque('prioridad', e.target.value)} aria-label="Prioridad"><option value="">Prioridad…</option><option>alta</option><option>media</option><option>baja</option></select>
      <select value="" onChange={e => enBloque('turno', e.target.value)} aria-label="Turno"><option value="">Turno…</option><option value="normal">Normal</option><option value="extra">Extra</option></select>
      <button className="btn sm pri-b" onClick={() => { const ids = vivos.filter(id => !V.D[id].parent); if (!ids.length) { ui.toast('Elegí piezas con trabajo propio (no ensamblajes generales)'); return; } ui.modal({ k: 'lote', ids }); }}>✎ Editar en lote</button>
      <span className="sp" /><button className="btn sm danger" onClick={borrarSel}>Borrar</button><button className="btn sm" onClick={() => setSel(new Set())}>Quitar selección</button></div>}
    <div className="scroll xlw"><table className="tt xl" onKeyDown={nav} style={{ width: cols.reduce((a, c) => a + W[c[0]], 0) }}>
    <colgroup>{cols.map(c => <col key={c[0]} style={{ width: W[c[0]] }} />)}</colgroup>
    <thead><tr>{cols.map((c, i) => <th key={c[0]}>{i === 0 && <input type="checkbox" className="selc" aria-label="Seleccionar todas" checked={todos} onChange={() => setSel(todos ? new Set() : new Set(rows.map(r => r.t.id)))} />}<span>{c[1]}</span><i className="rz" title="Arrastrá para ajustar el ancho. Doble clic para volver al ancho original." onPointerDown={e => resize(e, c[0])} onDoubleClick={() => setW(p => ({ ...p, [c[0]]: c[2] }))} /></th>)}</tr></thead>
    <tbody>
      {rows.length === 0 && <tr><td colSpan={cols.length} className="mut pad">No hay tareas para mostrar. Cargá una a mano o importá una planilla.</td></tr>}
      {rows.map(({ t, depth, hasKids }) => { const r = V.D[t.id]; const oc = tipo === 'rep' && !t.parentId ? E.chipOf(S, V, t).color : null;
        return <tr key={t.id} data-id={t.id} className={(hasKids ? 'par ' : '') + (r.parent ? 'grp ' : hasKids ? 'trab ' : '') + (r.estado === 'terminada' ? 'done ' : '') + (sel.has(t.id) ? 'selr' : '')}>{cols.map((c, i) => <td key={c[0]} tabIndex={-1} style={i === 0 && oc ? { boxShadow: `inset 3px 0 ${oc}` } : undefined}>{i === 0 ? <div className="c0"><input type="checkbox" className="selc" aria-label="Seleccionar" checked={sel.has(t.id)} onChange={() => togSel(t.id)} />{cell(c[0], t, depth, hasKids, r)}{marcas(t, hasKids, r)}</div> : cell(c[0], t, depth, hasKids, r)}</td>)}</tr>; })}
    </tbody></table></div></>;
}

function OrdChart({ ord, mes }) {
  const { S, V } = useApp(); const [f, setF] = useState(''); const [tabla, setTabla] = useState(false); const [hov, setHov] = useState(null);
  const [y, m] = mes.split('-').map(Number);
  const ms = [5, 4, 3, 2, 1, 0].map(i => { const d = new Date(y, m - 1 - i, 1); return `${d.getFullYear()}-${E.pad(d.getMonth() + 1)}`; });
  const data = ms.map(k => ({ k, c: 0, t: 0 }));
  Object.entries(ord).forEach(([o, rs]) => { const oc = /^\s*OC/i.test(o); if (f && (f === 'OC') !== oc) return;
    const cre = rs.map(r => r.creada || (r.inicio || '').slice(0, 10)).filter(Boolean).sort()[0]; const dc = cre && data.find(d => cre.startsWith(d.k)); if (dc) dc.c++;
    if (rs.every(r => V.D[r.id].estado === 'terminada')) { const fin = rs.flatMap(r => [r.id, ...E.descendants(S, r.id)]).map(id => V.byId[id].finReal || V.D[id].fin).filter(Boolean).sort().pop(); const dt = fin && data.find(d => fin.startsWith(d.k)); if (dt) dt.t++; } });
  const top = Math.max(4, Math.ceil(Math.max(...data.map(d => Math.max(d.c, d.t))) / 2) * 2), H = 150;
  const lab = k => `${E.MESES[Number(k.slice(5)) - 1]} ${k.slice(2, 4)}`;
  return <div className="chart">
    <div className="sec-h"><h3>Órdenes cargadas y terminadas por mes</h3>
      <div className="row"><div className="seg">{[['', 'Todas'], ['OV', 'OV'], ['OC', 'OC']].map(([k, l]) => <button key={k} className={f === k ? 'on' : ''} onClick={() => setF(k)}>{l}</button>)}</div>
        <button className="btn sm" onClick={() => setTabla(!tabla)}>{tabla ? 'Ver gráfico' : 'Ver tabla'}</button></div></div>
    <div className="lgd"><span><i style={{ background: 'var(--s1)' }} />Cargadas</span><span><i style={{ background: 'var(--s2)' }} />Terminadas</span></div>
    {tabla ? <div className="scroll"><table className="tt"><thead><tr><th>Mes</th><th className="num">Cargadas</th><th className="num">Terminadas</th><th className="num">Diferencia</th></tr></thead>
      <tbody>{data.map(d => <tr key={d.k}><td>{lab(d.k)}</td><td className="num">{d.c}</td><td className="num">{d.t}</td><td className="num">{d.c - d.t > 0 ? '+' : ''}{d.c - d.t}</td></tr>)}</tbody></table></div>
      : <div className="bc"><div className="bc-y" style={{ height: H }}>{[top, top / 2, 0].map(v => <span key={v} style={{ bottom: v / top * H }}>{v}</span>)}</div>
        <div className="bc-main"><div className="bc-plot" style={{ height: H }}>
          {[top, top / 2].map(v => <i key={v} className="bc-grid" style={{ bottom: v / top * H }} />)}
          {data.map(d => <div key={d.k} className={'bc-g' + (hov === d.k ? ' on' : '')} onMouseEnter={() => setHov(d.k)} onMouseLeave={() => setHov(null)} onFocus={() => setHov(d.k)} onBlur={() => setHov(null)} tabIndex="0" aria-label={`${lab(d.k)}: ${d.c} cargadas, ${d.t} terminadas`}>
            <div className="bc-b" style={{ height: d.c / top * H, background: 'var(--s1)' }}><b>{d.c}</b></div>
            <div className="bc-b" style={{ height: d.t / top * H, background: 'var(--s2)' }}><b>{d.t}</b></div>
            {hov === d.k && <div className="bc-tip"><b>{lab(d.k)}</b><span><i style={{ background: 'var(--s1)' }} />Cargadas <em>{d.c}</em></span><span><i style={{ background: 'var(--s2)' }} />Terminadas <em>{d.t}</em></span><span className="mut">{d.c - d.t > 0 ? `Quedaron ${d.c - d.t} sin cerrar` : d.c - d.t < 0 ? `Se cerraron ${d.t - d.c} más de las que entraron` : 'Entraron y salieron las mismas'}</span></div>}
          </div>)}</div>
          <div className="bc-x">{data.map(d => <span key={d.k} className={d.k === mes ? 'cur' : ''}>{lab(d.k)}</span>)}</div></div></div>}
  </div>;
}
/* ================= REPUESTOS ================= */
function Repuestos() {
  const { S, V, ui } = useApp();
  const [mes, setMes] = useState(E.today().slice(0, 7)); const [f, setF] = useState({ e: '', c: '', o: '', p: '', q: '' }); const [hist, setHist] = useState(false);
  const [plg, setPlg] = useState(() => prefG('rep-grupos', { terminada: true })); const togG = k => { const n = { ...plg, [k]: !plg[k] }; setPlg(n); guardaG('rep-grupos', n); };
  const roots = S.tareas.filter(t => t.tipo === 'rep' && !t.parentId);
  const ord = {}; roots.forEach(r => { (ord[r.orden || 'S/N'] = ord[r.orden || 'S/N'] || []).push(r); });
  const C = { OV: { p: 0, e: 0, t: 0 }, OC: { p: 0, e: 0, t: 0 } };
  Object.entries(ord).forEach(([o, rs]) => { const c = C[/^\s*OC/i.test(o) ? 'OC' : 'OV'], es = rs.map(r => V.D[r.id].estado);
    if (es.every(e => e === 'terminada')) { const fin = rs.flatMap(r => [r.id, ...E.descendants(S, r.id)]).map(id => V.byId[id].finReal || V.D[id].fin).filter(Boolean).sort().pop(); if (fin && fin.startsWith(mes)) c.t++; }
    else if (es.every(e => e === 'pendiente')) c.p++; else c.e++; });
  const mesTxt = `${E.MESES[Number(mes.slice(5)) - 1]} ${mes.slice(0, 4)}`;
  const hh = E.monthHH(S, V, t => t.tipo === 'rep', mes), cap = E.monthCap(S, mes);
  const match = t => (!f.e || (f.e === 'activas' ? t.estado !== 'terminada' : t.estado === f.e)) && (!f.o || t.ops.includes(f.o)) && (!f.p || t.prioridad === f.p);
  const q = f.q.trim().toLowerCase();
  const vis = t => { const rt = V.rootOf(t); if (f.c && rt.cliente !== f.c) return false; if (q && !t.parentId && ![rt.orden, rt.cliente, rt.nombre, ...E.descendants(S, rt.id).map(i => V.byId[i].nombre)].join(' ').toLowerCase().includes(q)) return false; const ch = V.kids[t.id] || []; return ch.length ? ch.some(vis) : match(t); };
  const clientes = [...new Set(roots.map(r => r.cliente).filter(Boolean))].sort();
  const sel = (k, opts, lab) => <select id={'rf-' + k} value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} aria-label={lab}><option value="">{lab}</option>{opts.map(o => <option key={o[0]} value={o[0]}>{o[1]}</option>)}</select>;
  const H = {}; S.tareas.forEach(t => { if (t.tipo !== 'rep' || V.D[t.id].parent || t.estado !== 'terminada' || !(t.hhReal > 0)) return; const k = V.rootOf(t).nombre + '|' + operName(S, t.operacionId); const h = H[k] = H[k] || { n: 0, p: 0, r: 0, c: 0 }; h.n++; h.p += t.hh; h.r += t.hhReal; h.c += Number(V.rootOf(t).cant) || 0; });
  return <div className="view">
    <section>
      <div className="sec-h"><h2>Repuestos</h2><div className="row"><label className="mut" htmlFor="rep-mes">Mes</label><input id="rep-mes" type="month" value={mes} onChange={e => e.target.value && setMes(e.target.value)} /></div></div>
      <div className="mcards">
        <div className="mcard"><span className="mt">Órdenes de venta · OV</span><div className="mpair"><div><b>{C.OV.p}</b><em>Pendientes</em></div><div className="m-acc"><b>{C.OV.e}</b><em>En proceso</em></div></div></div>
        <div className="mcard"><span className="mt">Órdenes de stock · OC</span><div className="mpair"><div><b>{C.OC.p}</b><em>Pendientes</em></div><div className="m-acc"><b>{C.OC.e}</b><em>En proceso</em></div></div></div>
        <div className="mcard"><span className="mt">Terminadas en {mesTxt}</span><div className="mpair m-ok"><div><b>{C.OV.t}</b><em>OV</em></div><div><b>{C.OC.t}</b><em>OC</em></div></div></div>
        <div className="mcard"><span className="mt">Horas dedicadas a repuestos · {mesTxt}</span><div className="mpair"><div><b>{fN(hh)}<small> h</small></b><em>{cap ? `${Math.round(hh / cap * 100)}% de las ${fN(cap)} h disponibles` : 'Sin horas disponibles en el mes'}</em></div></div>
          <span className="pbar big"><i style={{ width: Math.min(100, cap ? hh / cap * 100 : 0) + '%' }} /></span></div>
      </div>
      <OrdChart ord={ord} mes={mes} />
    </section>
    <section>
      <div className="sec-h"><div className="row">
        {sel('e', [['activas', 'Sin las terminadas'], ['pendiente', 'Pendiente'], ['en proceso', 'En proceso'], ['terminada', 'Terminada']], 'Todo estado')}<button className="btn sm" onClick={() => { const todos = ['curso', 'pausa', 'pendiente', 'terminada'].every(k => plg[k]); const n = Object.fromEntries(['curso', 'pausa', 'pendiente', 'terminada'].map(k => [k, !todos])); setPlg(n); guardaG('rep-grupos', n); }}>{['curso', 'pausa', 'pendiente', 'terminada'].every(k => plg[k]) ? 'Abrir grupos' : 'Cerrar grupos'}</button>
        {sel('c', clientes.map(c => [c, c]), 'Todo cliente')}
        {sel('o', S.operarios.map(o => [o.id, o.nombre]), 'Todo operario')}
        <input id="rf-q" type="search" placeholder="Buscar OV, pieza o cliente" value={f.q} onChange={e => setF({ ...f, q: e.target.value })} />
        {sel('p', [['alta', 'Alta'], ['media', 'Media'], ['baja', 'Baja']], 'Toda prioridad')}
      </div><div className="row">
        <button className="btn" onClick={() => setHist(!hist)}>{hist ? 'Ver tareas' : 'Historial de tiempos'}</button>
        <button className="btn" onClick={() => ui.modal({ k: 'imp', mode: 'rep' })}>Importar .xlsx</button>
        <button className="btn pri-b" onClick={() => ui.modal({ k: 'task', draft: E.blankTask('rep') })}>+ Repuesto</button>
      </div></div>
      {hist ? <div className="scroll"><table className="tt"><thead><tr><th>Producto</th><th>Operación</th><th className="num">Veces</th><th className="num">HH plan (prom.)</th><th className="num">HH real (prom.)</th><th className="num">Desvío</th></tr></thead>
        <tbody>{Object.keys(H).length === 0 && <tr><td colSpan="6" className="mut pad">Todavía no hay tareas terminadas con horas reales cargadas.</td></tr>}
          {Object.entries(H).map(([k, h]) => { const [p, o] = k.split('|'); const d = (h.r - h.p) / h.p * 100; return <tr key={k}><td>{p}</td><td>{o}</td><td className="num">{h.n}</td><td className="num">{fN(h.p / h.n)}</td><td className="num">{fN(h.r / h.n)}</td><td className={'num ' + (d > 0 ? 'c-bad' : 'c-ok')}>{d > 0 ? '+' : ''}{Math.round(d)}%</td></tr>; })}</tbody></table></div>
        : (() => { const corre = id => E.corriendo(V.byId[id]) || (V.kids[id] || []).some(c => corre(c.id));
            const grupo = r => { const e = V.D[r.id].estado; return e === 'terminada' ? 'terminada' : e === 'pendiente' ? 'pendiente' : corre(r.id) ? 'curso' : 'pausa'; };
            const G = [['curso', 'En proceso', 'var(--accent)'], ['pausa', 'En pausa', 'var(--warn)'], ['pendiente', 'Pendientes', 'var(--mut)'], ['terminada', 'Terminadas', 'var(--ok)']];
            const ord_ = roots.slice().sort((a, b) => PRI[a.prioridad] - PRI[b.prioridad]);
            return G.map(([k, l, c]) => { const rs = ord_.filter(r => grupo(r) === k && vis(r)); if (!rs.length && k !== 'curso') return null;
              return <div key={k} className={'repg' + (plg[k] ? '' : ' on')} style={{ '--c': c }}>
                <button className="dgrp-t repg-t" onClick={() => togG(k)}><span className="car">{plg[k] ? '▸' : '▾'}</span><b>{l}</b><span className="cnt">{rs.length}</span>{k === 'pausa' && <span className="mut">empezadas que no se están haciendo ahora</span>}</button>
                {!plg[k] && (rs.length ? <TaskTable roots={rs} tipo="rep" vis={vis} /> : <p className="mut pad">Ningún repuesto en curso en este momento.</p>)}</div>; }); })()}
    </section>
  </div>;
}

/* ================= PROYECTOS ================= */
const LETRA = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const prefG = (k, d) => { try { const v = localStorage.getItem('produccionapp-gantt-' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const guardaG = (k, v) => { try { localStorage.setItem('produccionapp-gantt-' + k, JSON.stringify(v)); } catch (e) { } };
function Gantt({ rows, entrega, color, collapsed, toggle, alto, todo }) {
  const { S, V, ui, up } = useApp(); const [arr, setArr] = useState(null); const t0 = E.today(), W = 28;
  const [lw, setLw] = useState(() => prefG('lw', 320)); const [mas, setMas] = useState(0);
  const box = useRef(null); const [ancho, setAncho] = useState(1200); const yaCentrado = useRef(false);
  useEffect(() => { const el = box.current; if (!el || !window.ResizeObserver) return; const ro = new ResizeObserver(([e]) => setAncho(e.contentRect.width)); ro.observe(el); return () => ro.disconnect(); }, []);
  useEffect(() => { guardaG('lw', lw); }, [lw]);
  const inis = rows.map(r => V.D[r.t.id].inicio).filter(Boolean).sort(), fins = rows.map(r => V.D[r.t.id].fin).filter(Boolean).sort();
  const a = E.monday([inis[0] && inis[0].slice(0, 10), t0].filter(Boolean).sort()[0]);
  const ult = [fins.length && fins[fins.length - 1].slice(0, 10), E.addDays(t0, 13), entrega].filter(Boolean).sort().pop();
  let N = E.diffDays(a, ult) + 1; N = Math.ceil(N / 14) * 14;                                  // de a 2 semanas
  N = Math.max(N, Math.ceil(Math.max(0, ancho - lw) / W / 14) * 14) + mas * 14; N = Math.min(N, 1092);  // llena el ancho de la pantalla
  const days = Array.from({ length: N }, (_, i) => E.addDays(a, i));
  const x = dt => { const [d, m] = E.split(dt); const s = E.schedAt(S, d); return (E.diffDays(a, d) + Math.min(1, Math.max(0, (m - s.in) / (s.out - s.in)))) * W; };
  const bg = 'linear-gradient(90deg,' + days.map((d, i) => { const c = E.isWork(S, d) ? 'transparent' : 'var(--stripe)'; return `${c} ${i * W}px,${c} ${(i + 1) * W}px`; }).join(',') + ')';
  const semanas = 'repeating-linear-gradient(90deg, transparent 0, transparent ' + (7 * W - 1) + 'px, var(--line) ' + (7 * W - 1) + 'px, var(--line) ' + 7 * W + 'px)';
  const xHoy = x(E.nowDT()), xEnt = entrega ? (E.diffDays(a, entrega) + 1) * W : null;
  const irHoy = () => { const el = box.current; if (el) el.scrollLeft = Math.max(0, E.diffDays(a, E.monday(t0)) * W); };
  useEffect(() => { if (!yaCentrado.current && box.current) { yaCentrado.current = true; irHoy(); } }, []);
  const resize = e => { e.preventDefault(); const x0 = e.clientX, w0 = lw; const mv = ev => setLw(Math.min(900, Math.max(140, w0 + ev.clientX - x0))); const fin = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', fin); }; window.addEventListener('pointermove', mv); window.addEventListener('pointerup', fin); };
  const arrastrar = (e, t, r) => { if (e.button !== undefined && e.button !== 0) return; const x0 = e.clientX; let d = 0, movio = false;
    const puede = !r.parent && r.estado !== 'terminada' && t.inicio;
    const mv = ev => { const dx = ev.clientX - x0; if (Math.abs(dx) > 4) movio = true; if (!puede || !movio) return; d = Math.round(dx / W); setArr({ id: t.id, d }); };
    const fin = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', fin); setArr(null);
      if (!movio) { ui.modal({ k: 'task', id: t.id }); return; }
      if (puede && d !== 0) { const ni = E.addDays(t.inicio.slice(0, 10), d) + t.inicio.slice(10); up(s => E.patchTask(s, t.id, { inicio: ni, manual: true }, true)); ui.toast(`Movida ${d > 0 ? '+' : ''}${d} ${Math.abs(d) === 1 ? 'día' : 'días'} y fijada a mano (📌)`); } };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', fin); };
  return <>
    <div className="row gbar"><button className="btn sm" onClick={irHoy}>Ir a hoy</button><button className="btn sm" onClick={() => setMas(mas + 1)}>+2 semanas</button>{todo && <><button className="btn sm" onClick={() => todo(true)} title="Deja a la vista solo los ensamblajes principales">⊟ Contraer todo</button><button className="btn sm" onClick={() => todo(false)}>⊞ Expandir todo</button></>}{mas > 0 && <button className="btn sm" onClick={() => setMas(0)}>Volver al largo normal</button>}
      <span className="mut">Arrastrá una barra para moverla de día (queda fijada a mano 📌). El borde de la columna Pieza cambia su ancho.</span></div>
    <div ref={box} className={'scroll gantt' + (alto === 'compacto' ? ' compacto' : '')} style={{ '--lw': lw + 'px' }}><div style={{ minWidth: 'max-content' }}>
    <div className="g-row g-head"><div className="g-left"><span>Pieza</span><span className="num">Cant.</span><i className="rz" title="Arrastrá para cambiar el ancho. Doble clic: ancho original." onPointerDown={resize} onDoubleClick={() => setLw(320)} /></div>
      <div className="g-right" style={{ width: N * W, backgroundImage: semanas }}>{days.map((d, i) => { const g = E.dow(d); return <span key={d} className={'g-day' + (d === t0 ? ' hoy' : '') + (E.isWork(S, d) ? '' : ' off')} style={{ left: i * W, width: W }}>
        {(g === 1 || (d.slice(8) === '01' && g >= 2 && g <= 5)) && <em>{E.MESES[Number(d.slice(5, 7)) - 1]}{(i === 0 || d.slice(5) === '01-01' || (g === 1 && d.slice(8) <= '07' && d.slice(5, 7) === '01')) ? ' ' + d.slice(0, 4) : ''}</em>}<small>{LETRA[g]}</small>{Number(d.slice(8))}</span>; })}</div></div>
    {rows.length === 0 && <p className="mut pad">Este proyecto todavía no tiene piezas. Agregá una o importá el árbol desde una planilla.</p>}
    {rows.map(({ t, depth, hasKids }) => { const r = V.D[t.id]; const ok = r.estado === 'terminada'; return <div key={t.id} className={'g-row' + (hasKids ? ' par' : '') + (ok ? ' done' : '')}>
      <div className="g-left"><div className="tname" style={{ paddingLeft: depth * 14 }}>
        {hasKids ? <button className="tog" onClick={() => toggle(t.id)} aria-label="Desplegar">{collapsed.has(t.id) ? '▸' : '▾'}</button> : <span className="tog" />}
        {ok && <span className="g-ok" title="Terminada">✓</span>}<button className="tlink" title={t.nombre} onClick={() => ui.modal({ k: 'task', id: t.id })}>{t.nombre}</button><button className="g-add" title={'Agregar hijo a ' + t.nombre} aria-label="Agregar hijo" onClick={() => ui.modal({ k: 'task', draft: { ...E.blankTask(t.tipo, t.proyId), parentId: t.id, prioridad: t.prioridad } })}>＋</button></div><span className="num">{t.cant}</span></div>
      <div className="g-right" style={{ width: N * W, backgroundImage: semanas + ',' + bg }}>
        <i className="g-today" style={{ left: xHoy }} />{xEnt !== null && <i className="g-due" style={{ left: xEnt }} />}
        {r.inicio && r.fin && <div className={'g-bar' + (r.parent ? ' par' : '') + (t.empuje && !ok ? ' pushed' : '') + (ok ? ' ok' : '') + (t.manual ? ' manual' : '') + (arr && arr.id === t.id ? ' drag' : '')} style={{ left: x(r.inicio) + (arr && arr.id === t.id ? arr.d * W : 0), width: Math.max(6, x(r.fin) - x(r.inicio)), '--c': color }}
          title={`${t.nombre}: ${fDT(r.inicio)} → ${fDT(r.fin)}${r.parent || ok ? '' : ' · arrastrala para moverla de día'}`} onPointerDown={e => arrastrar(e, t, r)}><span style={{ width: r.avance + '%' }} /></div>}
        {arr && arr.id === t.id && arr.d !== 0 && <span className="g-mov" style={{ left: x(r.inicio) + arr.d * W }}>{arr.d > 0 ? '+' : ''}{arr.d} d · {fD(E.addDays(t.inicio.slice(0, 10), arr.d))}</span>}
        {r.inicio && r.fin && <span className={'g-lab' + (ok ? ' ok' : '')} style={{ left: Math.max(x(r.fin), x(r.inicio) + 6) + 6 }}>{ok ? '✓ terminada' : Math.round(r.avance) + '%'}{t.empuje && !ok ? ' · ↦' : ''}</span>}
      </div></div>; })}
  </div></div></>;
}
// Desglose de las métricas del proyecto: avance por pieza principal, horas por pieza principal o por operación
// Tareas empezadas o terminadas que todavía no tienen horas reales: se completan acá mismo
function SinHoras({ ts }) {
  const { S, V, up } = useApp(); const [ver, setVer] = useState(true);
  const l = ts.filter(t => !V.D[t.id].parent && !(Number(t.hhReal) > 0) && !(t.crono && Number(t.crono.acum) > 0) && !E.corriendo(t) && (t.estado === 'terminada' || Number(t.avance) > 0 || t.estado === 'en proceso'));
  const g = {}; l.forEach(t => { const r = V.rootOf(t); (g[r.id] = g[r.id] || { r, l: [] }).l.push(t); });
  return <div className="sinh"><button className="dgrp-t" onClick={() => setVer(!ver)}><span className="car">{ver ? '▾' : '▸'}</span><b>Tareas sin horas reales cargadas</b><span className={'cnt' + (l.length ? ' warn' : ' ok')}>{l.length}</span><span className="mut">terminadas o empezadas</span></button>
    {ver && (l.length === 0 ? <p className="mut">Todas las tareas terminadas o empezadas tienen horas reales.</p> : Object.values(g).map(({ r, l }) => <div key={r.id} className="sinh-g"><b>{r.nombre}</b>
      {l.map(t => <div key={t.id} className="sinh-r"><span className={'est e-' + t.estado.replace(' ', '')}>{t.estado === 'terminada' ? 'terminada' : Math.round(V.D[t.id].avance) + '%'}</span><span className="sn" title={t.nombre}>{t.nombre}</span><span className="mut">{operName(S, t.operacionId)} · plan {fN(t.hh)} h</span>
        <label className="inl">Reales<EdIn className="num w5" type="number" min="0" step="0.25" value="" placeholder="h" onCommit={v => { const h = Math.max(0, Number(String(v).replace(',', '.')) || 0); if (h > 0) up(s => E.patchTask(s, t.id, { hhReal: h, crono: { acum: h, desde: null } })); }} /></label></div>)}</div>))}</div>;
}
function Desglose({ roots, ts, vista, hhv, setHhv, color, cerrar }) {
  const { S, V } = useApp();
  const filasPadre = roots.map(t => { const r = V.D[t.id]; return { k: t.id, nom: t.nombre, plan: r.hh, real: r.hhReal, av: r.avance, est: r.estado }; });
  const ops = {}; ts.forEach(t => { const r = V.D[t.id]; if (r.parent) return; const k = t.operacionId || '_'; const o = ops[k] = ops[k] || { k, nom: k === '_' ? 'Sin operación' : operName(S, k), plan: 0, real: 0, hecho: 0, n: 0 }; o.plan += r.hh; o.real += r.hhReal; o.hecho += r.hh * r.avance / 100; o.n++; });
  const filasOp = Object.values(ops).map(o => ({ ...o, av: o.plan ? o.hecho / o.plan * 100 : 0 })).sort((a, b) => b.plan - a.plan);
  const filas = vista === 'av' ? filasPadre : hhv === 'padre' ? filasPadre : filasOp;
  const max = Math.max(1, ...filas.map(f => Math.max(f.plan, f.real)));
  const tot = filas.reduce((a, f) => ({ plan: a.plan + f.plan, real: a.real + f.real }), { plan: 0, real: 0 });
  return <section className="desg">
    <div className="sec-h"><h3>{vista === 'av' ? 'Avance por pieza principal' : 'Horas-hombre del proyecto'}</h3>
      <div className="row">{vista === 'hh' && <div className="seg"><button className={hhv === 'padre' ? 'on' : ''} onClick={() => setHhv('padre')}>Por pieza principal</button><button className={hhv === 'oper' ? 'on' : ''} onClick={() => setHhv('oper')}>Por operación</button></div>}
        <button className="btn sm" onClick={cerrar}>Cerrar</button></div></div>
    {filas.length === 0 && <p className="mut">Este proyecto todavía no tiene piezas.</p>}
    {vista === 'av' ? <div className="dlist">{filas.map(f => <div key={f.k} className="drow">
        <span className="dnom" title={f.nom}>{f.nom}</span>
        <span className="dbar"><i style={{ width: Math.min(100, f.av) + '%', background: color }} /></span>
        <b className="dpct">{Math.round(f.av)}%</b>
        <span className="mut dsub">{fN(f.plan * f.av / 100)} de {fN(f.plan)} HH · {f.est}</span></div>)}</div>
    : <>
      <div className="dleg"><span><i className="lg-plan" />Total planificado (la barra completa)</span><span><i style={{ background: 'var(--ok)' }} />Real cargado</span><span><i style={{ background: 'var(--bad)' }} />Real por encima de lo esperado</span><span><i className="lg-tick" />Lo que debería llevar según el avance</span></div>
      <div className="dlist">{filas.map(f => { const esp = f.plan * (f.av || 0) / 100, pasa = f.real > Math.max(esp, 0.01) * 1.05 && f.real > 0, pr = f.plan ? Math.min(100, f.real / f.plan * 100) : (f.real ? 100 : 0);
        return <div key={f.k} className="drow hh1">
          <span className="dnom" title={f.nom}>{f.nom}{f.n ? <small className="mut"> · {f.n} {f.n === 1 ? 'tarea' : 'tareas'}</small> : null}</span>
          <span className="dtrack" title={`Real ${fN(f.real)} h de ${fN(f.plan)} h planificadas · avance ${Math.round(f.av || 0)}%`}><i className={pasa ? 'over' : ''} style={{ width: pr + '%' }} />{f.plan > 0 && <em style={{ left: Math.min(100, f.av || 0) + '%' }} />}{f.real > f.plan && f.plan > 0 && <b className="dmas">+{fN(f.real - f.plan)}</b>}</span>
          <span className="dnum1"><b>{fN(f.real)}</b> / {fN(f.plan)} h</span>
          <span className="dsub">{f.real > 0 ? <Desvio real={f.real} plan={esp || f.plan} /> : <span className="mut">sin horas reales</span>}</span></div>; })}
        <div className="drow hh1 tot"><span className="dnom">Total</span><span className="dtrack"><i style={{ width: (tot.plan ? Math.min(100, tot.real / tot.plan * 100) : 0) + '%' }} /></span><span className="dnum1"><b>{fN(tot.real)}</b> / {fN(tot.plan)} h</span><span /></div></div>
      <p className="mut">La barra completa es lo planificado; lo pintado, las horas reales cargadas. La rayita marca lo que debería haberse usado según el avance: si lo real la pasa, se pinta en rojo.</p>
      <SinHoras ts={ts} /></>}
  </section>;
}
function useTopH() { useEffect(() => { const top = document.querySelector('.top'); if (!top) return; const f = () => document.documentElement.style.setProperty('--toph', top.offsetHeight + 'px'); f(); const ro = new ResizeObserver(f); ro.observe(top); return () => ro.disconnect(); }, []); }
function ProyTabs({ pid, setPid, info }) {
  const { S } = useApp(); const ref = useRef(null);
  useTopH();
  useEffect(() => { const b = ref.current && ref.current.querySelector('.ptab.on'); if (b && b.scrollIntoView) b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [pid]);
  if (!S.proyectos.length) return null;
  return <div className="ptabs" ref={ref}>
    <button className={'ptab todos' + (!pid ? ' on' : '')} onClick={() => setPid(null)} title="Ver todos los proyectos">▦ Todos</button>
    {S.proyectos.map((pr, k) => { const i = info(pr); const late = pr.entrega && i.fin && i.fin.slice(0, 10) > pr.entrega;
      return <button key={pr.id} className={'ptab' + (pr.id === pid ? ' on' : '')} style={{ '--c': pr.color }} onClick={() => setPid(pr.id)} title={`${pr.nombre} · ${Math.round(i.av)}%${k < 9 ? ` · Alt+${k + 1}` : ''}`}>
        <span className="chip">{pr.ini}</span><span className="pt-n">{pr.nombre}</span>
        <span className="pt-av"><i style={{ width: Math.round(i.av) + '%' }} /></span><small>{Math.round(i.av)}%</small>{late && <em className="pt-late" title="Se pasa de la entrega">!</em>}
      </button>; })}
  </div>;
}
function Proyectos() {
  const { S, V, up, ui } = useApp(); const [pid, setPid0] = useState(() => { try { return localStorage.getItem('produccionapp-proy-actual') || null; } catch (e) { return null; } });
  const setPid = id => { setPid0(id); try { id ? localStorage.setItem('produccionapp-proy-actual', id) : localStorage.removeItem('produccionapp-proy-actual'); } catch (e) { } if (typeof window.scrollTo === 'function') window.scrollTo({ top: 0 }); };
  useEffect(() => { const k = e => { if (!e.altKey || e.ctrlKey || e.metaKey) return; const n = Number(e.key); if (n >= 1 && n <= 9 && S.proyectos[n - 1]) { e.preventDefault(); setPid(S.proyectos[n - 1].id); } else if (e.key === '0') { e.preventDefault(); setPid(null); } }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [S.proyectos]); const [col, tog, setCol] = useSet(); const [det, setDet] = useState(null); const [hhv, setHhv] = useState('padre'); const [altoG, setAltoG] = useState('completo'); const [q, setQ] = useState(''); const [verFin, setVerFin] = useState(() => prefG('verfin', false));
  useEffect(() => { if (pid) setAltoG(prefG('alto-' + pid, 'completo')); }, [pid]);
  const p = S.proyectos.find(x => x.id === pid);
  const info = pr => { const ts = S.tareas.filter(t => t.proyId === pr.id), rs = ts.filter(t => !t.parentId).map(t => V.D[t.id]); const hh = rs.reduce((a, r) => a + r.hh, 0);
    return { ts, hh, av: hh ? rs.reduce((a, r) => a + r.hh * r.avance, 0) / hh : 0, real: rs.reduce((a, r) => a + r.hhReal, 0), ini: rs.map(r => r.inicio).filter(Boolean).sort()[0], fin: rs.map(r => r.fin).filter(Boolean).sort().pop() }; };
  const nuevo = () => { const id = E.uid(); up(s => ({ ...s, proyectos: [...s.proyectos, { id, nombre: 'Proyecto nuevo', ini: 'NVO', color: ACCENTS[s.proyectos.length % ACCENTS.length], entrega: '' }] })); setPid(id); };
  const tabs = <ProyTabs pid={p ? pid : null} setPid={setPid} info={info} />;
  if (!p) return <div className="view">{tabs}<section>
    <div className="sec-h"><h2>Proyectos</h2><button className="btn pri-b" onClick={nuevo}>+ Proyecto</button></div>
    <div className="pcards">{S.proyectos.map(pr => { const i = info(pr); const late = pr.entrega && i.fin && i.fin.slice(0, 10) > pr.entrega; return <button key={pr.id} className="pcard" style={{ '--c': pr.color }} onClick={() => setPid(pr.id)}>
      <span className="chip">{pr.ini}</span><b>{pr.nombre}</b>
      <span className="pline"><Bar v={i.av} color={pr.color} /> {Math.round(i.av)}%</span>
      <span className="mut">{fD(i.ini && i.ini.slice(0, 10))} → {fD(i.fin && i.fin.slice(0, 10))} · {fN(i.hh)} HH</span>
      {pr.entrega && <span className={'tag ' + (late ? 'bad' : '')}>{late ? `se pasa ${E.diffDays(pr.entrega, i.fin.slice(0, 10))} d de la entrega` : `entrega ${fD(pr.entrega)}`}</span>}
    </button>; })}
      {S.proyectos.length === 0 && <p className="mut">Todavía no hay proyectos. Creá el primero.</p>}</div>
  </section></div>;
  const i = info(p); const setP = (k, v) => up(s => ({ ...s, proyectos: s.proyectos.map(x => x.id === p.id ? { ...x, [k]: v } : x) }));
  const roots = i.ts.filter(t => !t.parentId);
  const qn = q.trim().toLowerCase(); let visQ = null, nQ = 0;
  if (qn) { const ok = new Set(); i.ts.forEach(t => { if (((t.codigo || '') + ' ' + t.nombre).toLowerCase().includes(qn)) { nQ++; ok.add(t.id); let x = t, g = 0; while (x.parentId && g++ < 50) { ok.add(x.parentId); x = V.byId[x.parentId] || {}; } E.descendants(S, t.id).forEach(d => ok.add(d)); } }); visQ = t => ok.has(t.id); }
  const lotes = []; if (qn) { const gs = {}; i.ts.forEach(t => { if (V.D[t.id].parent || !((t.codigo || '') + ' ' + t.nombre).toLowerCase().includes(qn)) return; const k = claveP(t); (gs[k] = gs[k] || { k, nom: t.codigo || claveP(t).replace(/^N:/, ''), ids: [] }).ids.push(t.id); }); Object.values(gs).filter(g => g.ids.length > 1).slice(0, 6).forEach(g => lotes.push(g)); }
  const colV = qn ? new Set() : col; const ord = ordenProy(S); const rows = flatten(roots, V, colV, visQ, ord);
  const fin = id => V.D[id].estado === 'terminada';
  const conFin = id => fin(id) || (V.kids[id] || []).some(c => conFin(c.id));
  const visAct = t => (!visQ || visQ(t)) && !fin(t.id), visFin = t => (!visQ || visQ(t)) && conFin(t.id);
  const nFin = i.ts.filter(t => !V.D[t.id].parent && fin(t.id)).length, nAct = i.ts.filter(t => !V.D[t.id].parent && !fin(t.id)).length;
  const meses = {}; i.ts.forEach(t => { const r = V.D[t.id]; if (r.parent) return; const n = Math.max(1, t.ops.length); r.segs.forEach(s => { const m = s.d.slice(0, 7); meses[m] = (meses[m] || 0) + (s.h + (s.xe || 0)) * n; }); });
  const mk = Object.keys(meses).sort(), mmax = Math.max(1, ...Object.values(meses));
  const late = p.entrega && i.fin && i.fin.slice(0, 10) > p.entrega;
  return <div className="view">{tabs}
    <section>
      <div className="sec-h"><div className="row"><span className="chip" style={{ '--c': p.color }}>{p.ini}</span><h2>{p.nombre}</h2></div>
        <div className="row"><button className="btn" onClick={() => ui.modal({ k: 'imp', mode: 'proy', proyId: p.id })}>Importar árbol .xlsx</button><button className="btn pri-b" onClick={() => ui.modal({ k: 'task', draft: E.blankTask('proy', p.id) })}>+ Pieza</button></div></div>
      <div className="form inline">
        <label>Nombre<input id="p-nom" value={p.nombre} onChange={e => setP('nombre', e.target.value)} /></label>
        <label>Iniciales<input id="p-ini" className="w4" maxLength="4" value={p.ini} onChange={e => setP('ini', e.target.value.toUpperCase())} /></label>
        <label>Color<input id="p-col" type="color" value={p.color} onChange={e => setP('color', e.target.value)} /></label>
        <label>Entrega comprometida<input id="p-ent" type="date" value={p.entrega || ''} onChange={e => setP('entrega', e.target.value)} /></label>
        <label className="chk etp" title="Dentro de cada ensamblaje, cada etapa (corte, lijado, plegado, mecanizado, soldadura…) espera a que terminen las anteriores. El orden de las etapas se define en Configuración → Operaciones."><input type="checkbox" checked={!!p.etapas} onChange={e => setP('etapas', e.target.checked)} /> Desplazar por etapas de fabricación</label>
        {p.etapas && <button className="btn" onClick={() => { let n = 0; up(s => { const r = E.acomodarEtapas(s, p.id); n = r.n; return r.S; }); ui.toast(n ? `${n} ${n === 1 ? 'tarea corrida' : 'tareas corridas'} para respetar el orden de las etapas` : 'Ya estaba todo en orden de etapas'); }}>Acomodar por etapas</button>}
        {i.ts.some(t => t.pos !== undefined && t.pos !== null) && <button className="btn" title="Borra el orden manual (▲▼) y vuelve a ordenar por etapa" onClick={() => up(s => ({ ...s, tareas: s.tareas.map(t => t.proyId === p.id && t.pos !== undefined && t.pos !== null ? { ...t, pos: null } : t) }))}>Ordenar por etapa</button>}
        <button className="btn danger" onClick={() => { up(s => ({ ...s, proyectos: s.proyectos.filter(x => x.id !== p.id), tareas: s.tareas.filter(t => t.proyId !== p.id) })); setPid(null); ui.toast('Proyecto borrado. Podés deshacerlo arriba.'); }}>Borrar proyecto</button>
      </div>
      <div className="kpis">
        <Kpi l="Avance" v={Math.round(i.av) + '%'} s={`${fN(i.hh * i.av / 100)} de ${fN(i.hh)} HH`} onClick={() => setDet(det === 'av' ? null : 'av')} on={det === 'av'} />
        <Kpi l="Inicio proyectado" v={fD(i.ini && i.ini.slice(0, 10))} /><Kpi l="Fin proyectado" v={fD(i.fin && i.fin.slice(0, 10))} tone={late ? 'bad' : ''} s={late ? `${E.diffDays(p.entrega, i.fin.slice(0, 10))} d después de la entrega` : p.entrega ? `entrega ${fD(p.entrega)}` : ''} />
        <Kpi l="HH reales cargadas" v={fH(i.real)} s={`plan a la fecha ${fN(i.hh * i.av / 100)} h`} onClick={() => setDet(det === 'hh' ? null : 'hh')} on={det === 'hh'} />
        <div className="kpi grow"><span>Horas-hombre por mes</span><div className="mbars">{mk.length === 0 && <em>Sin tareas programadas</em>}{mk.map(m => <div key={m} title={`${fN(meses[m])} HH`}><i style={{ height: Math.max(4, meses[m] / mmax * 44), background: p.color }} /><small>{E.MESES[Number(m.slice(5)) - 1]}</small><small className="v">{Math.round(meses[m])}</small></div>)}</div></div>
      </div>
    </section>
    <div className="pbusca"><input type="search" placeholder="Buscar pieza por código o descripción" value={q} onChange={e => setQ(e.target.value)} aria-label="Buscar pieza" />{qn && <span className="mut">{nQ ? `${nQ} ${nQ === 1 ? 'pieza encontrada' : 'piezas encontradas'}` : 'Ninguna pieza coincide'}</span>}{qn && <button className="btn sm" onClick={() => setQ('')}>Limpiar</button>}
      {lotes.map(g => <button key={g.k} className="btn sm pri-b" title="Editar a la vez todas las veces que aparece esta pieza en el proyecto" onClick={() => ui.modal({ k: 'lote', ids: g.ids, titulo: g.nom })}>✎ Editar en lote: {g.nom} (×{g.ids.length})</button>)}</div>
    {det && <Desglose roots={roots} ts={i.ts} vista={det} hhv={hhv} setHhv={setHhv} color={p.color} cerrar={() => setDet(null)} />}
    <section><div className="sec-h"><div className="row"><h2>Árbol de piezas y Gantt</h2><div className="seg">{[['oculto', 'Oculto', 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c5 0 9 4.5 10 7a13 13 0 0 1-3 4M6.6 6.6C4.4 8 2.8 10 2 12c1 2.5 5 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2'], ['compacto', 'Compacto', 'M4 9h16M4 15h16M12 3v3l-2-2M12 3l2 2M12 21v-3l-2 2M12 21l2-2'], ['completo', 'Completo', 'M4 4h16v16H4zM4 9h16M4 14h16']].map(([k, l, d]) => <button key={k} className={altoG === k ? 'on' : ''} onClick={() => { setAltoG(k); guardaG('alto-' + p.id, k); }}><svg viewBox="0 0 24 24"><path d={d} /></svg>{l}</button>)}</div></div>
        {altoG !== 'oculto' && <span className="mut legend"><i className="lg t" />hoy <i className="lg d" />entrega</span>}</div>
      {altoG === 'oculto' ? <p className="mut">Oculto ({rows.length} {rows.length === 1 ? 'fila' : 'filas'}). Elegí Compacto o Completo para verlo.</p>
        : <Gantt rows={rows} entrega={p.entrega} color={p.color} collapsed={colV} toggle={tog} alto={altoG} todo={c => setCol(c ? new Set(i.ts.filter(t => (V.kids[t.id] || []).length).map(t => t.id)) : new Set())} />}</section>
    <section><div className="sec-h"><h2>Pendientes y en proceso <span className="cnt">{nAct}</span></h2><span className="mut">Mayús + Espacio (Shift + Space) marca la fila · en la casilla alcanza con Espacio</span></div><TaskTable roots={roots} tipo="proy" vis={visAct} collapsed={colV} toggle={tog} orden={ord} /></section>
    <section className="finsec"><div className="sec-h"><button className="dgrp-t fin-t" onClick={() => { setVerFin(!verFin); guardaG('verfin', !verFin); }}><span className="car">{verFin ? '▾' : '▸'}</span><h2>Terminadas <span className="cnt ok">{nFin}</span></h2></button></div>
      {verFin && (nFin ? <TaskTable roots={roots} tipo="proy" vis={visFin} collapsed={colV} toggle={tog} orden={ord} /> : <p className="mut">Todavía no hay piezas terminadas en este proyecto.</p>)}</section>
  </div>;
}

/* ================= EDITOR DE TAREA ================= */
function TaskEditor({ id, draft, onClose }) {
  const { S, V, up, ui } = useApp();
  const orig = id ? S.tareas.find(t => t.id === id) : draft;
  const [hhTocado, setHhTocado] = useState(!!id); const [t, setT] = useState(orig); const [predOpen, setPredOpen] = useState(false); const [pq, setPq] = useState('');
  if (!orig || !t) return null;
  const isNew = !id, parent = !!id && !!V.D[id] && V.D[id].parent, root = !t.parentId;
  const set = (k, v) => setT(p => ({ ...p, [k]: v }));
  const n = Math.max(1, t.ops.length), hh = Number(t.hh) || 0;
  const w = t.inicio ? E.addWork(S, t.inicio, hh / n, t.turno, t.ops) : null;
  const setFin = v => { if (!t.inicio || !v) return; const h = E.workBetween(S, t.inicio, v, t.turno, t.ops) * n; if (h > 0) set('hh', Math.round(h * 100) / 100); };
  const togOp = o => set('ops', t.ops.includes(o) ? t.ops.filter(x => x !== o) : [...t.ops, o]);
  const togPred = p => set('preds', (t.preds || []).includes(p) ? t.preds.filter(x => x !== p) : [...(t.preds || []), p]);
  const scope = S.tareas.filter(x => x.id !== t.id && !V.D[x.id].parent && x.id !== t.parentId && (t.tipo === 'proy' ? x.proyId === t.proyId : x.tipo === 'rep' && V.rootOf(x).orden === V.rootOf(t).orden));
  const cod = E.codOp(S, t.nombre), hist = !parent ? E.historial(S, t.nombre) : null, recs = !parent ? E.recomendar(S, { ...t, hh }) : [];
  const alSalirNombre = () => { if (parent) return; const a = E.autoCompletar(S, t, !hhTocado); if (Object.keys(a).length) setT(p => ({ ...p, ...a })); };
  const save = () => {
    if (!t.nombre.trim()) { ui.toast('Poné el nombre de la pieza'); return; }
    const x = { ...t, hh, cant: Number(t.cant) || 0, avance: Math.min(100, Math.max(0, Number(t.avance) || 0)), hhReal: Number(t.hhReal) || 0 };
    if (x.estado === 'terminada') { x.avance = 100; if (!x.finReal) x.finReal = E.nowDT(); } else x.finReal = null;
    if (x.estado !== orig.estado || isNew) x.crono = x.estado === 'en proceso' ? { acum: orig.crono ? Number(orig.crono.acum) || 0 : x.hhReal, desde: E.nowDT() } : x.estado === 'terminada' ? { acum: x.hhReal, desde: null } : null;
    if (!x.ops.length) x.inicio = x.inicio || null; else if (!x.inicio) x.inicio = E.nextFree(S, x.ops[0], x.turno, x.ops);
    const mover = !parent && (isNew || ['inicio', 'hh', 'turno'].some(k => x[k] !== orig[k]) || x.ops.join() !== orig.ops.join() || (x.preds || []).join() !== (orig.preds || []).join());
    up(s => E.patchTask(isNew ? { ...s, tareas: [...s.tareas, x] } : s, x.id, x, mover)); onClose();
  };
  const foot = <>
    {!isNew && <button className="btn danger" onClick={() => { up(s => E.delTask(s, id)); onClose(); ui.toast('Borrada. Podés deshacerlo arriba.'); }}>Borrar</button>}
    {!isNew && <button className="btn" onClick={() => { up(s => E.dupTask(s, id)); onClose(); ui.toast('Duplicada'); }}>Duplicar</button>}
    <span className="sp" /><button className="btn" onClick={onClose}>Cancelar</button><button className="btn pri-b" onClick={save}>Guardar</button></>;
  return <Modal title={isNew ? (t.parentId ? 'Nueva tarea hija' : t.tipo === 'rep' ? 'Nuevo repuesto' : 'Nueva pieza') : 'Editar tarea'} onClose={onClose} foot={foot}>
    <div className="form">
      <label className="g2">Pieza<input id="te-nom" value={t.nombre} onChange={e => set('nombre', e.target.value)} onBlur={alSalirNombre} autoFocus /></label>
      <label>Cantidad<input id="te-cant" type="number" min="0" value={t.cant} onChange={e => set('cant', e.target.value)} onBlur={alSalirNombre} /></label>
      {t.tipo === 'rep' && root && <><label>N° de OV/OC<input id="te-ord" value={t.orden} placeholder="OV-0000" onChange={e => set('orden', e.target.value)} /></label>
        <label>Cliente<input id="te-cli" value={t.cliente} onChange={e => set('cliente', e.target.value)} /></label>
        <label>Entrega comprometida<input id="te-ent" type="date" value={t.entrega || ''} onChange={e => set('entrega', e.target.value)} /></label>
        <label>Fecha de carga de la orden<input id="te-cre" type="date" value={t.creada || ''} max={E.today()} onChange={e => set('creada', e.target.value)} /></label></>}
      <label>Prioridad<select id="te-pri" value={t.prioridad} onChange={e => set('prioridad', e.target.value)}><option>alta</option><option>media</option><option>baja</option></select></label>
      {parent ? <p className="note g2">{t.partes ? 'Esta tarea está partida en partes' : 'Es un ensamblaje general (primer nivel)'}: sus fechas, horas y avance salen del resumen de todo lo que tiene adentro ({fDT(V.D[id].inicio)} → {fDT(V.D[id].fin)}, {fN(V.D[id].hh)} HH, {Math.round(V.D[id].avance)}%).</p> : <>
        {!!id && (V.kids[id] || []).length > 0 && <p className="note g2">Esta pieza tiene {(V.kids[id] || []).length} {(V.kids[id] || []).length === 1 ? 'hija' : 'hijas'} y lleva su propio trabajo (por ejemplo, soldarlas o armarlas): las horas, el operario y el avance son solo de este paso. Empieza cuando terminan sus hijas.</p>}
        {t.tipo === 'proy' && !isNew && <label className="chk g2"><input type="checkbox" checked={!!t.manual} onChange={e => set('manual', e.target.checked)} /> Fecha fijada a mano 📌 (no se corre por las etapas anteriores)</label>}
        <label>Operación<select id="te-op" value={t.operacionId} onChange={e => setT(p => ({ ...p, operacionId: e.target.value, opAuto: false }))}><option value="">—</option>{S.operaciones.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select>
          {cod && (cod.operacionId ? <small className={t.operacionId === cod.operacionId ? 'hint ok' : 'hint'}>Código {cod.num} → {operName(S, cod.operacionId)}{t.operacionId !== cod.operacionId && t.operacionId ? ' (la cambiaste a mano)' : ''}</small> : <small className="hint">El código {cod.num} no tiene operación asignada. Se carga en Configuración → Códigos de operación.</small>)}</label>
        <label>Turno<select id="te-tur" value={t.turno} onChange={e => set('turno', e.target.value)}><option value="normal">Normal</option><option value="extra">Horas extra</option></select></label>
        {t.estado !== 'terminada' && <div className="g2 fld recs"><span>Recomendado para {t.operacionId ? operName(S, t.operacionId) : 'esta tarea'}</span>
          {!t.operacionId ? <small className="mut">Elegí la operación para ver a quién conviene dársela.</small>
            : recs.length === 0 ? <small className="mut">Ningún operario tiene {operName(S, t.operacionId)} como operación principal o secundaria. Se carga en Configuración → Operarios.</small>
            : <div className="reclist">{recs.slice(0, 4).map((r, i) => <div key={r.op} className={'rec' + (t.ops.length === 1 && t.ops[0] === r.op ? ' on' : '') + (i === 0 ? ' top' : '')}>
                <b>{r.nombre}</b><span className={'tag' + (r.nivel === 1 ? ' ok' : '')}>{r.nivel === 1 ? 'principal' : 'secundaria'}</span>
                <span className="mut">entra {fDT(r.ini)}{r.fin ? ` · termina ${fDT(r.fin)}` : ''}</span>
                <button type="button" className="btn sm" onClick={() => setT(p => ({ ...p, ops: [r.op], inicio: r.ini }))}>{t.ops.length === 1 && t.ops[0] === r.op ? 'Elegido' : 'Dársela'}</button></div>)}</div>}</div>}
        <div className="g2 fld"><span>Operarios</span><div className="togs">{S.operarios.filter(o => o.activo || t.ops.includes(o.id)).map(o => <button key={o.id} type="button" className={'togb' + (t.ops.includes(o.id) ? ' on' : '')} onClick={() => togOp(o.id)}>{o.nombre}</button>)}</div></div>
        <label>Inicio<input id="te-ini" type="datetime-local" value={t.inicio || ''} onChange={e => set('inicio', e.target.value || null)} /></label>
        <label>Horas-hombre (trabajo total)<input id="te-hh" type="number" min="0" step="0.5" value={t.hh} onChange={e => { setHhTocado(true); set('hh', e.target.value); }} />
          {hist && <small className="hint">Se hizo {hist.n} {hist.n === 1 ? 'vez' : 'veces'}: {fHM(hist.porUnidad)} reales por unidad{(() => { const sug = Math.max(0.5, Math.round(hist.porUnidad * Math.max(1, Number(t.cant) || 1) * 2) / 2); return Math.abs(sug - hh) > 0.01 ? <> → <button type="button" className="lnk sm" onClick={() => { setHhTocado(true); set('hh', sug); }}>usar {fN(sug)} h</button></> : ' (ya aplicado)'; })()}</small>}</label>
        <label>Fin<input id="te-fin" type="datetime-local" value={w ? w.end : ''} disabled={!t.inicio} onChange={e => setFin(e.target.value)} /></label>
        <div className="fld"><span>Duración en calendario</span><b className="big">{fH(hh / n)}</b><small className="mut">{fN(hh)} HH ÷ {n} operario{n > 1 ? 's' : ''}</small></div>
        {w && !w.ok && <p className="note bad g2">Faltan {fN(w.falta)} h extra por habilitar en el calendario para poder calcular el fin.</p>}
        <label>Estado<select id="te-est" value={t.estado} onChange={e => set('estado', e.target.value)}><option>pendiente</option><option>en proceso</option><option>terminada</option></select></label>
        <label>Avance %<input id="te-av" type="number" min="0" max="100" step="5" value={t.estado === 'terminada' ? 100 : t.avance} disabled={t.estado === 'terminada'} onChange={e => set('avance', e.target.value)} /></label>
        <label>Horas-hombre reales<input id="te-real" type="number" min="0" step="0.5" value={t.hhReal} onChange={e => set('hhReal', e.target.value)} /></label>
        <div className="g2 fld preds"><button type="button" className="predh" aria-expanded={predOpen} onClick={() => setPredOpen(!predOpen)}>
            <span className="car">{predOpen ? '▾' : '▸'}</span><span>Empieza después de (predecesoras)</span><span className="cnt">{(t.preds || []).length}</span></button>
          {(t.preds || []).length > 0 && <div className="togs">{t.preds.map(pid => V.byId[pid] && <button key={pid} type="button" className="togb on" title="Tocá para quitarla" onClick={() => togPred(pid)}>{etiqueta(V, V.byId[pid])} ✕</button>)}</div>}
          {predOpen && <div className="predbox">
            {scope.length === 0 ? <small className="mut">No hay otras tareas en este {t.tipo === 'proy' ? 'proyecto' : 'pedido'}.</small> : <>
              <input id="te-pq" type="search" placeholder={`Buscar entre ${scope.length} piezas`} value={pq} onChange={e => setPq(e.target.value)} autoFocus />
              <div className="predlist">{scope.filter(x => !(t.preds || []).includes(x.id) && (!pq.trim() || etiqueta(V, x).toLowerCase().includes(pq.trim().toLowerCase()))).map(x => <button key={x.id} type="button" className="predit" onClick={() => togPred(x.id)}><span>+</span>{etiqueta(V, x)}</button>)}
                {scope.filter(x => !(t.preds || []).includes(x.id) && (!pq.trim() || etiqueta(V, x).toLowerCase().includes(pq.trim().toLowerCase()))).length === 0 && <small className="mut">Ninguna pieza coincide con "{pq}".</small>}</div></>}
          </div>}</div></>}
    </div>
  </Modal>;
}

/* ================= PANEL DE OPERARIO ================= */
function OpTask({ t, op }) {
  const { S, V, up } = useApp(); const r = V.D[t.id]; const run = E.corriendo(t), pausa = !!t.pausada || (t.estado === 'en proceso' && !run), llev = E.llevado(S, t);
  const [av, setAv] = useState(r.avance); const [fin, setFin] = useState(false); const [real, setReal] = useState(0);
  useEffect(() => { setAv(r.avance); }, [r.avance]);
  const commit = () => { if (Number(av) !== r.avance) up(s => E.patchTask(s, t.id, { avance: Number(av) })); };
  return <div className={'optask' + (run ? ' run' : '')}>
    <div className="row"><Chip t={t} small /><b>{etiqueta(V, t)}</b><span className={'est e-' + (pausa ? 'pausa' : t.estado.replace(' ', ''))}>{run ? 'en curso' : pausa ? 'en pausa' : t.estado}</span></div>
    <span className="mut">{operName(S, t.operacionId)} · {fH(t.hh)} HH{t.ops.length > 1 ? ` entre ${t.ops.length} (${fH(r.durCal)} en calendario)` : ''} · {t.turno === 'extra' ? 'extra · ' : ''}{fDT(t.inicio)} → {fDT(r.fin)}</span>
    {(() => { const esp = espera(S, V, t); return esp && <span className="tag">⧖ Espera a {esp.nombre}{esp.fin ? ` (termina ${fDT(esp.fin)})` : ''}</span>; })()}
    {t.estado === 'en proceso' && <div className="row crono"><Bar v={t.hh ? llev / t.hh * 100 : 0} color={llev > t.hh + 0.01 ? 'var(--bad)' : undefined} /><span>Llevado <b>{fHM(llev)}</b> de {fHM(t.hh)} proyectadas{t.ops.length > 1 ? ' (suma de los operarios)' : ''}</span></div>}
    {fin ? <div className="finbox">
      <div className="row"><span className="mut">Tiempo real (horas-hombre)</span><HM value={real} onChange={setReal} /></div>
      <div className="row"><span className="mut">Proyectado {fHM(t.hh)} ·</span><Desvio real={real} plan={t.hh} /></div>
      <div className="row"><button className="btn pri-b" onClick={() => up(s => E.finalizar(s, t.id, real))}>Confirmar</button><button className="btn" onClick={() => setFin(false)}>Cancelar</button></div></div>
      : <div className="row">
        <input className="rng" type="range" min="0" max="100" step="5" value={av} aria-label="Avance" onChange={e => setAv(e.target.value)} onPointerUp={commit} onKeyUp={commit} onBlur={commit} /><span className="pct">{Math.round(av)}%</span>
        {run && t.ops.length > 1 && <button className="btn" title="La tarea se parte: lo hecho queda cerrado y el resto sigue con los demás" onClick={() => up(s => E.salir(s, t.id, op))}>{opName(S, op)} sale</button>}
        {run ? <button className="btn" title="Parte la tarea: cierra lo hecho hasta ahora y deja el resto en pausa" onClick={() => up(s => E.pausar(s, t.id))}>Pausar</button> : <button className="btn" onClick={() => up(s => E.iniciar(s, t.id))}>{pausa ? 'Reanudar' : 'Iniciar'}</button>}
        <button className="btn pri-b" onClick={() => { setReal(llev > 0 ? llev : t.hh); setFin(true); }}>Finalizar</button>
        <button className="btn" onClick={() => up(s => E.unassign(s, t.id, op))}>Quitar</button></div>}
  </div>;
}
function DoneRow({ t }) {
  const { V, up } = useApp(); const [ed, setEd] = useState(false); const [real, setReal] = useState(t.hhReal || 0);
  return <div className="optask done">
    <div className="row"><Chip t={t} small /><b>{etiqueta(V, t)}</b><span className="mut">terminada {(t.finReal || '').slice(11, 16)}</span></div>
    {ed ? <div className="row"><HM value={real} onChange={setReal} /><button className="btn sm pri-b" onClick={() => { up(s => E.patchTask(s, t.id, { hhReal: Math.round(real * 100) / 100, crono: { acum: real, desde: null } })); setEd(false); }}>Guardar</button><button className="btn sm" onClick={() => setEd(false)}>Cancelar</button></div>
      : <div className="row"><span>Real <b>{fHM(t.hhReal)}</b> · proyectado {fHM(t.hh)} ·</span><Desvio real={t.hhReal} plan={t.hh} /><button className="btn sm" onClick={() => { setReal(t.hhReal || 0); setEd(true); }}>Corregir</button></div>}
  </div>;
}
// Tareas sin asignar para darle a un operario: agrupadas por proyecto / OV-OC o por pieza, con filtros
const claveP = t => { const c = (t.codigo || '').trim().toUpperCase(); if (c) return c; const n = (t.nombre || '').trim(); const m = n.match(/^[A-Z]{2,6}-?\d[\w.-]*/i); return m ? m[0].toUpperCase() : 'N:' + n.toLowerCase(); };
const nomP = (V, t) => (t.codigo ? t.codigo + ' ' : '') + etiqueta(V, t);
function DarTareas({ op, grande }) {
  const { S, V, up, ui } = useApp(); const o = S.operarios.find(x => x.id === op) || {};
  const [vista, setVista] = useState('origen'); const [fOp, setFOp] = useState(''); const [q, setQ] = useState(''); const [fp, setFp] = useState('');
  const [sel, setSel] = useState(() => new Set()); const [ab, setAb] = useState({});
  useEffect(() => { setSel(new Set()); }, [op]);
  const todas = S.tareas.filter(t => !t.ops.length && !V.D[t.id].parent && t.estado !== 'terminada');
  const rep = {}; todas.forEach(t => { const k = claveP(t); rep[k] = (rep[k] || 0) + 1; });
  const suyas = [o.op1, o.op2].filter(Boolean);
  const ql = q.trim().toLowerCase();
  const libres = todas.filter(t => (!fp || t.prioridad === fp) && (!fOp || (fOp === '*' ? suyas.includes(t.operacionId) : t.operacionId === fOp)) && (!ql || (nomP(V, t) + ' ' + E.chipOf(S, V, t).txt).toLowerCase().includes(ql)))
    .sort((a, b) => PRI[a.prioridad] - PRI[b.prioridad] || ((a.inicio || a.creada || '') < (b.inicio || b.creada || '') ? -1 : 1));
  const grupos = []; const gi = {};
  libres.forEach(t => {
    let k, g;
    if (vista === 'pieza') { k = claveP(t); g = () => ({ k, tit: nomP(V, t).split(' · ')[0], color: 'var(--accent)', ini: '' }); }
    else if (t.tipo === 'proy') { const p = S.proyectos.find(x => x.id === t.proyId) || {}; k = 'p:' + t.proyId; g = () => ({ k, tit: p.nombre || 'Proyecto', color: p.color, ini: p.ini, orden: 0 }); }
    else { k = 'rep'; g = () => ({ k, tit: 'Repuestos', sub: 'todas las OV y OC', color: 'var(--accent)', ini: 'REP', orden: 1 }); }
    if (!gi[k]) { gi[k] = { ...g(), items: [] }; grupos.push(gi[k]); } gi[k].items.push(t);
  });
  if (vista === 'pieza') grupos.sort((a, b) => b.items.length - a.items.length);
  else { // siempre un desplegable por proyecto (aunque no tenga nada para darle) y uno con todos los repuestos
    const out = S.proyectos.map(p => gi['p:' + p.id] || { k: 'p:' + p.id, tit: p.nombre, color: p.color, ini: p.ini, items: [] });
    out.push(gi.rep || { k: 'rep', tit: 'Repuestos', sub: 'todas las OV y OC', color: 'var(--accent)', ini: 'REP', items: [] });
    grupos.splice(0, grupos.length, ...out);
  }
  const filtrando = !!(ql || fOp || fp);
  const abierto = g => ab[g.k] !== undefined ? ab[g.k] : (filtrando && g.items.length > 0) || (vista === 'pieza' && g.items.length > 1);
  const orden = grupos.flatMap(g => g.items.map(t => t.id));
  const tog = id => setSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const togG = g => setSel(p => { const n = new Set(p); const all = g.items.every(t => n.has(t.id)); g.items.forEach(t => all ? n.delete(t.id) : n.add(t.id)); return n; });
  const dar = (ids, turno) => { if (!ids.length) return; up(s => ids.reduce((a, id) => E.assignTo(a, id, op, null, turno), s)); setSel(new Set()); ui.toast(`${ids.length === 1 ? 'Asignada' : ids.length + ' tareas asignadas, una detrás de la otra,'} a ${o.nombre} en ${turno === 'extra' ? 'horas extra' : 'turno normal'}`); };
  const elegidas = orden.filter(id => sel.has(id)); const hhSel = elegidas.reduce((a, id) => a + (Number(V.byId[id].hh) || 0), 0);
  const repetidas = Object.values(rep).filter(n => n > 1).length;
  return <div className={'dart' + (grande ? ' grande' : '')}>
    <div className="sec-h"><h3>Tareas para darle <span className="cnt">{libres.length}{libres.length !== todas.length ? ' de ' + todas.length : ''}</span></h3>
      <div className="seg"><button className={vista === 'origen' ? 'on' : ''} onClick={() => setVista('origen')}>Por proyecto / Repuestos</button><button className={vista === 'pieza' ? 'on' : ''} onClick={() => setVista('pieza')}>Por pieza{repetidas ? ` (${repetidas} repetidas)` : ''}</button></div></div>
    <div className="dart-f">
      <input type="search" className="dq" placeholder="Buscar pieza, código, OV o proyecto" value={q} onChange={e => setQ(e.target.value)} aria-label="Buscar pieza" />
      <select value={fOp} onChange={e => setFOp(e.target.value)} aria-label="Operación"><option value="">Toda operación</option>{suyas.length > 0 && <option value="*">★ Las suyas ({suyas.map(x => operName(S, x)).join(' / ')})</option>}{S.operaciones.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select>
      <select value={fp} onChange={e => setFp(e.target.value)} aria-label="Prioridad"><option value="">Toda prioridad</option><option value="alta">Alta</option><option value="media">Media</option><option value="baja">Baja</option></select>
      {filtrando && <button className="btn sm" onClick={() => { setQ(''); setFOp(''); setFp(''); }}>Limpiar filtros</button>}
    </div>
    {todas.length === 0 ? <p className="mut">No quedan tareas sin asignar.</p> : libres.length === 0 && <p className="mut">Ninguna tarea coincide con los filtros.</p>}
    {grupos.map(g => { const op_ = abierto(g); const n = g.items.filter(t => sel.has(t.id)).length; const hh = g.items.reduce((a, t) => a + (Number(t.hh) || 0), 0);
      return <div key={g.k} className={'dgrp' + (op_ ? ' on' : '') + (g.items.length ? '' : ' vacio')} style={{ '--c': g.color }}>
        <div className="dgrp-h">
          <input type="checkbox" disabled={!g.items.length} checked={n > 0 && n === g.items.length} ref={el => { if (el) el.indeterminate = n > 0 && n < g.items.length; }} onChange={() => togG(g)} aria-label={'Elegir todas de ' + g.tit} />
          <button className="dgrp-t" onClick={() => setAb({ ...ab, [g.k]: !op_ })}>
            <span className="car">{op_ ? '▾' : '▸'}</span>{vista === 'pieza' ? <span className="dpz">{g.items.length > 1 ? '×' + g.items.length : '·'}</span> : <span className="chip" style={{ '--c': g.color }}>{g.ini}</span>}
            <b>{g.tit}</b>{g.sub && <span className="mut">({g.sub})</span>}<span className="cnt">{g.items.length}</span><span className="mut">{fN(hh)} HH{vista === 'pieza' ? ` · ${g.items.reduce((a, t) => a + (Number(t.cant) || 0), 0)} unid.` : ''}</span></button>
          {vista === 'pieza' && g.items.length > 1 && <button className="btn sm pri-b" onClick={() => dar(g.items.map(t => t.id), 'normal')} title="Se las da una detrás de la otra">Darle las {g.items.length} juntas</button>}
        </div>
        {op_ && <div className="dgrp-b">{g.items.length === 0 && <p className="mut">{filtrando ? 'Nada coincide con los filtros.' : 'No tiene tareas sin asignar.'}</p>}{g.items.map(t => { const k = claveP(t); const mia = suyas.includes(t.operacionId);
          return <div key={t.id} className={'ditem' + (sel.has(t.id) ? ' sel' : '')}>
            <input type="checkbox" checked={sel.has(t.id)} onChange={() => tog(t.id)} aria-label={'Elegir ' + nomP(V, t)} />
            <div className="dn"><span className="drow"><Chip t={t} small /><b>{nomP(V, t)}</b><Pri p={t.prioridad} />
              {vista === 'origen' && rep[k] > 1 && <button className="tag rep" title="Ver todas juntas" onClick={() => { setVista('pieza'); setQ(t.codigo || t.nombre); }}>se repite ×{rep[k]}</button>}</span>
              <span className="mut">{mia ? <b className="suya">★ {operName(S, t.operacionId)}</b> : operName(S, t.operacionId)} · cant. {t.cant} · {fH(t.hh)}{t.entrega ? ` · entrega ${fD(t.entrega)}` : ''}</span></div>
            <span className="row dbt"><button className="btn sm" onClick={() => dar([t.id], 'normal')}>Normal</button><button className="btn sm" onClick={() => dar([t.id], 'extra')}>Extra</button></span>
          </div>; })}</div>}
      </div>; })}
    {elegidas.length > 0 && <div className="dbar"><b>{elegidas.length} elegidas</b><span className="mut">{fN(hhSel)} HH · se las da una detrás de la otra</span><span className="sp" />
      <button className="btn pri-b" onClick={() => dar(elegidas, 'normal')}>Dar en normal</button><button className="btn" onClick={() => dar(elegidas, 'extra')}>Dar en extra</button><button className="btn ghost" onClick={() => setSel(new Set())}>Cancelar</button></div>}
  </div>;
}
// Edición en lote: la misma pieza repetida en varios ensamblajes. Las horas se reparten según la cantidad de cada uno.
function LoteEditor({ ids, titulo, onClose }) {
  const { S, V, up, ui } = useApp();
  const ts = ids.map(id => V.byId[id]).filter(t => t && !V.D[t.id].parent);
  const cantT = ts.reduce((a, t) => a + (Number(t.cant) || 0), 0) || ts.length;
  const peso = t => cantT ? (Number(t.cant) || (cantT === ts.length ? 1 : 0)) / cantT : 1 / ts.length;
  const hhAct = ts.reduce((a, t) => a + (Number(t.hh) || 0), 0), realAct = ts.reduce((a, t) => a + (Number(t.hhReal) || 0), 0);
  const [f, setF] = useState({ operacionId: '', prioridad: '', turno: '', ops: null, inicio: '', seguidas: true, hh: '', real: '', estado: '' });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const n2 = v => Math.round(v * 100) / 100;
  const nuevoHH = t => f.hh !== '' ? n2(Number(f.hh) * peso(t)) : Number(t.hh) || 0;
  const nuevoReal = t => f.real !== '' ? n2(Number(f.real) * peso(t)) : Number(t.hhReal) || 0;
  const cambia = f.operacionId || f.prioridad || f.turno || f.ops || f.inicio || f.hh !== '' || f.real !== '' || f.estado;
  const aplicar = () => {
    const orden = ts.slice().sort((a, b) => (a.inicio || '9') < (b.inicio || '9') ? -1 : 1).map(t => t.id);
    up(s0 => { let s = s0; let cursor = f.inicio || null;
      orden.forEach(id => { const t = s.tareas.find(x => x.id === id); if (!t) return; const p = {};
        if (f.operacionId) { p.operacionId = f.operacionId; p.opAuto = false; } if (f.prioridad) p.prioridad = f.prioridad; if (f.turno) p.turno = f.turno;
        if (f.ops) p.ops = f.ops; if (f.hh !== '') p.hh = nuevoHH(t);
        if (cursor) p.inicio = cursor;
        s = E.patchTask(s, id, p, !!(cursor || f.ops || f.turno || f.hh !== ''));
        if (cursor && f.seguidas) { const t2 = s.tareas.find(x => x.id === id); cursor = E.finOf(s, t2) || cursor; }
        if (f.estado === 'terminada') s = E.finalizar(s, id, nuevoReal(t));
        else { if (f.estado) s = E.setEstado(s, id, f.estado); if (f.real !== '') s = E.patchTask(s, id, { hhReal: nuevoReal(t), crono: { acum: nuevoReal(t), desde: null } }); }
      }); return s; });
    ui.toast(`${ts.length} piezas actualizadas en lote`); onClose(); };
  const ops = S.operarios.filter(o => o.activo);
  return <Modal title={'Editar en lote' + (titulo ? ' · ' + titulo : '')} onClose={onClose} wide foot={<><span className="mut">{ts.length} piezas · {fN(cantT)} unidades en total</span><span className="sp" /><button className="btn" onClick={onClose}>Cancelar</button><button className="btn pri-b" disabled={!cambia} onClick={aplicar}>Aplicar a las {ts.length}</button></>}>
    <p className="mut">Lo que dejes vacío no se cambia. Las horas totales se reparten entre las piezas según la cantidad que usa cada ensamblaje, así cada equipo lleva el tiempo que le corresponde.</p>
    <div className="form lote">
      <label>Horas-hombre totales (plan)<input type="number" min="0" step="0.5" placeholder={'hoy suman ' + fN(hhAct)} value={f.hh} onChange={e => set('hh', e.target.value)} /></label>
      <label>Horas reales totales<input type="number" min="0" step="0.25" placeholder={'hoy suman ' + fN(realAct)} value={f.real} onChange={e => set('real', e.target.value)} /></label>
      <label>Estado<select value={f.estado} onChange={e => set('estado', e.target.value)}><option value="">— no cambiar —</option><option value="pendiente">Pendiente</option><option value="en proceso">En proceso</option><option value="terminada">Terminada</option></select></label>
      <label>Operación<select value={f.operacionId} onChange={e => set('operacionId', e.target.value)}><option value="">— no cambiar —</option>{S.operaciones.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></label>
      <label>Prioridad<select value={f.prioridad} onChange={e => set('prioridad', e.target.value)}><option value="">— no cambiar —</option><option>alta</option><option>media</option><option>baja</option></select></label>
      <label>Turno<select value={f.turno} onChange={e => set('turno', e.target.value)}><option value="">— no cambiar —</option><option value="normal">Normal</option><option value="extra">Extra</option></select></label>
      <label>Inicio<input type="datetime-local" value={f.inicio} onChange={e => set('inicio', e.target.value)} /></label>
      <label className="chk lote-seg"><input type="checkbox" checked={f.seguidas} onChange={e => set('seguidas', e.target.checked)} /> Una detrás de la otra (si no, todas arrancan a esa hora)</label>
      <div className="g2 lote-ops"><span className="mut">Operarios {f.ops ? '' : '(no cambiar)'}</span><div className="row wrap">{ops.map(o => { const on = f.ops && f.ops.includes(o.id); return <button key={o.id} className={'togb' + (on ? ' on' : '')} onClick={() => set('ops', on ? (f.ops.filter(x => x !== o.id).length ? f.ops.filter(x => x !== o.id) : null) : [...(f.ops || []), o.id])}>{o.nombre}</button>; })}</div></div>
    </div>
    <div className="scroll"><table className="tt lote-t"><thead><tr><th>Ensamblaje</th><th>Dentro de</th><th className="num">Cant.</th><th className="num">% del total</th><th className="num">HH plan</th><th className="num">HH real</th><th>Estado</th><th>Inicio</th></tr></thead>
      <tbody>{ts.map(t => { const rt = V.rootOf(t), pa = t.parentId && V.byId[t.parentId]; const h0 = Number(t.hh) || 0, h1 = nuevoHH(t), r0 = Number(t.hhReal) || 0, r1 = nuevoReal(t);
        return <tr key={t.id}><td>{rt.id === t.id ? '—' : rt.nombre}</td><td>{pa && pa.id !== rt.id ? pa.nombre : '—'}</td><td className="num">{t.cant}</td><td className="num">{Math.round(peso(t) * 100)}%</td>
          <td className="num">{h1 !== h0 ? <><s className="mut">{fN(h0)}</s> → <b>{fN(h1)}</b></> : fN(h0)}</td><td className="num">{r1 !== r0 ? <><s className="mut">{fN(r0)}</s> → <b>{fN(r1)}</b></> : (r0 ? fN(r0) : '—')}</td>
          <td>{f.estado || V.D[t.id].estado}</td><td>{fDT(t.inicio)}</td></tr>; })}</tbody></table></div>
  </Modal>;
}
function OperarioPanel({ id, onClose }) {
  const { S, V, up, ui } = useApp(); const [, setTick] = useState(0);
  useEffect(() => { const i = setInterval(() => setTick(x => x + 1), 30000); return () => clearInterval(i); }, []);
  const o = S.operarios.find(x => x.id === id); if (!o) return null;
  const hoy = E.today();
  const mine = S.tareas.filter(t => t.ops.includes(id) && !V.D[t.id].parent && t.estado !== 'terminada').sort((a, b) => (a.inicio || '9') < (b.inicio || '9') ? -1 : 1);
  const hechas = S.tareas.filter(t => t.ops.includes(id) && t.estado === 'terminada' && (t.finReal || '').startsWith(hoy) && !V.D[t.id].parent);
  const aus = E.ausenciaDe(S, id, hoy);
  const prox = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map(i => E.addDays(hoy, i)).filter(d => E.extraDe(S, id, d) > 0);
  const camino = (turno, tit) => {
    const l = mine.filter(t => turno === 'extra' ? t.turno === 'extra' : t.turno !== 'extra'), en = l.filter(t => E.corriendo(t)), pau = l.filter(t => t.pausada || (t.estado === 'en proceso' && !E.corriendo(t))), sig = l.filter(t => t.estado === 'pendiente' && !t.pausada);
    const ld = (V.load[`${id}|${hoy}|${turno}`] || {}).h || 0, cap = turno === 'extra' ? E.extraDe(S, id, hoy) : E.capN(S, id, hoy);
    const cola = l.reduce((a, t) => a + V.D[t.id].durCal * (1 - V.D[t.id].avance / 100), 0), fin = l.map(t => V.D[t.id].fin).filter(Boolean).sort().pop();
    return <div className={'opcol' + (turno === 'extra' ? ' ex' : '')}>
      <div className="opcol-h"><b>{tit}</b><span className="mut">Hoy {fN(ld)} de {fN(cap)} h</span></div>
      <p className="mut">{l.length ? `${fN(cola)} h por delante · se libera ${fDT(fin)}` : 'Sin tareas en este turno.'}{turno === 'extra' ? (prox.length ? ` · Extras habilitadas: ${prox.map(d => `${fDia(d)} (${fN(E.extraDe(S, id, d))} h, ${E.modoExtra(S, id, d) === 'sigue' ? 'sigue lo normal' : 'aparte'})`).join(', ')}` : ' · No tiene horas extra habilitadas en los próximos 14 días.') : ''}</p>
      <h3>Está haciendo</h3>
      {en.length === 0 && <p className="mut">Nada en curso.</p>}
      {en.map(t => <OpTask key={t.id} t={t} op={id} />)}
      {pau.length > 0 && <h3>En pausa <span className="cnt">{pau.length}</span></h3>}
      {pau.map(t => <OpTask key={t.id} t={t} op={id} />)}
      <h3>Le sigue <span className="cnt">{sig.length}</span></h3>
      {sig.length === 0 && <p className="mut">Sin tareas en cola.</p>}
      {sig.slice(0, 6).map(t => <OpTask key={t.id} t={t} op={id} />)}
    </div>;
  };
  return <Modal title={o.nombre} onClose={onClose} wide>
    {aus && <p className="note bad">Hoy ausente: {aus.motivo}.</p>}
    <div className="row"><button className="btn" onClick={() => juntar(up, ui, id, o.nombre)}>Juntar sus tareas</button><span className="mut">Adelanta lo pendiente para cerrar huecos libres. Al pausar, la tarea se parte: lo hecho queda cerrado con su tiempo y el resto vuelve a la cola.</span></div>
    <div className="opcols">{camino('normal', 'Turno normal')}{camino('extra', 'Horas extra')}</div>
    {hechas.length > 0 && <><h3>Terminadas hoy <span className="cnt">{hechas.length}</span></h3>{hechas.map(t => <DoneRow key={t.id} t={t} />)}</>}
    <DarTareas op={id} />
  </Modal>;
}
function Picker({ op, d, turno, onClose }) {
  const { S, V, up } = useApp(); const [q, setQ] = useState('');
  const l = S.tareas.filter(t => !V.D[t.id].parent && t.estado !== 'terminada' && !t.ops.includes(op) && (etiqueta(V, t) + ' ' + E.chipOf(S, V, t).txt).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (a.ops.length - b.ops.length) || PRI[a.prioridad] - PRI[b.prioridad]);
  return <Modal title={`Asignar a ${opName(S, op)} · ${fDia(d)} · turno ${turno}`} onClose={onClose}>
    <input id="pk-q" className="full" placeholder="Buscar por nombre, OV/OC o proyecto" value={q} onChange={e => setQ(e.target.value)} autoFocus />
    {l.length === 0 && <p className="mut">No hay tareas para asignar.</p>}
    {l.map(t => <div key={t.id} className="pitem st" onClick={() => { up(s => E.assignTo(s, t.id, op, d, turno)); onClose(); }}>
      <Chip t={t} small /><span className="pn">{etiqueta(V, t)}</span><Pri p={t.prioridad} /><span className="mut">{fH(t.hh)} · {t.ops.length ? 'ya la tiene ' + t.ops.map(o => opName(S, o)).join(', ') + ' (se suma)' : 'sin asignar'}</span></div>)}
  </Modal>;
}
function Hoy({ onClose }) {
  const { S, V, ui } = useApp(); const [man, setMan] = useState(false);
  let d = E.today(); if (man) { let g = 0; do { d = E.addDays(d, 1); } while (!E.isWork(S, d) && g++ < 14); }
  const data = S.operarios.filter(o => o.activo).map(o => ({ o, aus: E.ausenciaDe(S, o.id, d), n: (V.load[`${o.id}|${d}|normal`] || {}).items || [], e: (V.load[`${o.id}|${d}|extra`] || {}).items || [] }));
  const linea = it => { const t = V.byId[it.id]; return `[${E.chipOf(S, V, t).txt}] ${etiqueta(V, t)} (${fN(it.h)} h${it.sigue ? ', sigue lo del turno normal' : ''})`; };
  const texto = `PARTE DEL DÍA · ${fDia(d)}\n\n` + data.map(x => `${x.o.nombre.toUpperCase()}\n` + (x.aus ? `  Ausente: ${x.aus.motivo}\n` : (x.n.length ? x.n.map(i => '  ' + linea(i)).join('\n') + '\n' : '  Sin tareas\n') + (x.e.length ? x.e.map(i => '  Extra: ' + linea(i)).join('\n') + '\n' : ''))).join('\n');
  const copiar = () => { navigator.clipboard.writeText(texto).then(() => ui.toast('Copiado'), () => ui.toast('No se pudo copiar: seleccioná el texto a mano')); };
  return <Modal title={`Parte del día · ${fDia(d)}`} onClose={onClose} wide foot={<><span className="sp" /><button className="btn" onClick={() => saveFile(`parte-${d}.txt`, texto, ui.toast)}>Guardar .txt</button><button className="btn pri-b" onClick={copiar}>Copiar texto</button></>}>
    <div className="seg">{[[false, 'Hoy'], [true, 'Próximo día hábil']].map(([k, l]) => <button key={l} className={man === k ? 'on' : ''} onClick={() => setMan(k)}>{l}</button>)}</div>
    <div className="hoygrid">{data.map(x => <div key={x.o.id} className="hoyc"><b>{x.o.nombre}</b>
      {x.aus ? <span className="mut">Ausente: {x.aus.motivo}</span> : x.n.length + x.e.length === 0 ? <span className="mut">Sin tareas</span> :
        [...x.n.map(i => ({ ...i, x: 0 })), ...x.e.map(i => ({ ...i, x: 1 }))].map(i => <span key={i.id + i.x} className="hl"><Chip t={V.byId[i.id]} small /> {etiqueta(V, V.byId[i.id])} <em>{i.x ? 'extra · ' : ''}{fN(i.h)} h</em></span>)}</div>)}</div>
  </Modal>;
}

/* ================= TALLER (pantalla simple para el operario) ================= */
function TallerTask({ t }) {
  const { S, V, up } = useApp(); const r = V.D[t.id]; const run = E.corriendo(t), pausa = !!t.pausada || (t.estado === 'en proceso' && !run), llev = E.llevado(S, t), esp = espera(S, V, t);
  const [fin, setFin] = useState(false); const [real, setReal] = useState(0);
  return <div className={'ttask' + (run ? ' run' : '')}>
    <div className="row"><Chip t={t} /><Pri p={t.prioridad} /><span className={'est e-' + (pausa ? 'pausa' : run ? 'enproceso' : t.estado.replace(' ', ''))}>{run ? 'en curso' : pausa ? 'en pausa' : t.estado}</span></div>
    <b className="tnom">{etiqueta(V, t)}</b>
    <span className="mut">{operName(S, t.operacionId)} · cantidad {t.cant} · {fHM(t.hh)} proyectadas{t.ops.length > 1 ? ` · con ${t.ops.length - 1} más` : ''}{t.turno === 'extra' ? ' · en horas extra' : ''}</span>
    <span className="mut">{fDT(t.inicio)} → {fDT(r.fin)}</span>
    {esp && <span className="tag">⧖ Espera a {esp.nombre}{esp.fin ? ` (termina ${fDT(esp.fin)})` : ''}</span>}
    {(run || llev > 0) && <div className="tcrono"><b>{fHM(llev)}</b><span className="mut">de {fHM(t.hh)}</span><Bar v={t.hh ? llev / t.hh * 100 : 0} color={llev > t.hh + 0.01 ? 'var(--bad)' : undefined} /></div>}
    {fin ? <div className="finbox">
      <div className="row"><span className="mut">Tiempo real</span><HM value={real} onChange={setReal} /></div>
      <div className="row"><span className="mut">Proyectado {fHM(t.hh)} ·</span><Desvio real={real} plan={t.hh} /></div>
      <div className="tbtns"><button className="btn big pri-b" onClick={() => up(s => E.finalizar(s, t.id, real))}>Confirmar</button><button className="btn big" onClick={() => setFin(false)}>Cancelar</button></div></div>
      : <div className="tbtns">
        {run ? <button className="btn big" onClick={() => up(s => E.pausar(s, t.id))}>Pausar</button> : <button className="btn big pri-b" onClick={() => up(s => E.iniciar(s, t.id))}>{pausa ? 'Reanudar' : 'Iniciar'}</button>}
        <button className={'btn big' + (run ? ' pri-b' : '')} onClick={() => { setReal(llev > 0 ? llev : t.hh); setFin(true); }}>Finalizar</button></div>}
  </div>;
}
function Taller() {
  const { S, V } = useApp(); const [, setTick] = useState(0);
  const [oid, setOid] = useState(() => { try { return localStorage.getItem(KEY + '-taller') || ''; } catch (e) { return ''; } });
  useEffect(() => { const i = setInterval(() => setTick(x => x + 1), 30000); return () => clearInterval(i); }, []);
  const ops = S.operarios.filter(o => o.activo), o = ops.find(x => x.id === oid), hoy = E.today();
  const elegir = id => { setOid(id); try { localStorage.setItem(KEY + '-taller', id); } catch (e) { } };
  useTopH(); const tref = useRef(null);
  useEffect(() => { const b = tref.current && tref.current.querySelector('.tq.on'); if (b && b.scrollIntoView) b.scrollIntoView({ block: 'nearest', inline: 'center' }); }, [oid]);
  const tira = <div className="ttira" ref={tref}>{ops.map(x => { const run = S.tareas.some(t => t.ops.includes(x.id) && E.corriendo(t)); const au = E.ausenciaDe(S, x.id, hoy);
    return <button key={x.id} className={'tq' + (o && x.id === o.id ? ' on' : '') + (au ? ' aus' : '')} onClick={() => elegir(o && x.id === o.id ? '' : x.id)} title={au ? 'Ausente: ' + au.motivo : run ? 'Trabajando' : 'Sin tarea en curso'}>
      <Av o={x} i={S.operarios.indexOf(x)} /><b>{x.nombre}</b><i className={'dot ' + (au ? 'aus' : run ? 'run' : '')} /></button>; })}</div>;
  if (!o) return <div className="view taller"><section><div className="sec-h"><h2>¿Quién sos?</h2><span className="mut">Tocá tu nombre</span></div>
    {ops.length === 0 && <p className="note">Todavía no hay operarios cargados. Se agregan en Configuración.</p>}
    {tira}</section></div>;
  const mine = S.tareas.filter(t => t.ops.includes(o.id) && !V.D[t.id].parent && t.estado !== 'terminada').sort((a, b) => (a.inicio || '9') < (b.inicio || '9') ? -1 : 1);
  const en = mine.filter(t => E.corriendo(t)), pau = mine.filter(t => t.pausada || (t.estado === 'en proceso' && !E.corriendo(t))), sig = mine.filter(t => t.estado === 'pendiente' && !t.pausada);
  const hechas = S.tareas.filter(t => t.ops.includes(o.id) && t.estado === 'terminada' && (t.finReal || '').startsWith(hoy) && !V.D[t.id].parent);
  const aus = E.ausenciaDe(S, o.id, hoy);
  return <div className="view taller">{tira}<section>
    <div className="sec-h"><div className="row"><Av o={o} i={S.operarios.indexOf(o)} /><h2>{o.nombre}</h2></div></div>
    <p className="mut">{fDia(hoy)}{aus ? ` · hoy figura ausente (${aus.motivo})` : ` · ${fN(((V.load[`${o.id}|${hoy}|normal`] || {}).h || 0) + ((V.load[`${o.id}|${hoy}|extra`] || {}).h || 0))} h programadas hoy`}</p>
    <h3>Ahora</h3>
    {en.length === 0 && <p className="note">No hay ninguna tarea en curso. Iniciá una de la lista de abajo.</p>}
    {en.map(t => <TallerTask key={t.id} t={t} />)}
    {pau.length > 0 && <h3>En pausa <span className="cnt">{pau.length}</span></h3>}
    {pau.map(t => <TallerTask key={t.id} t={t} />)}
    <h3>Lo que sigue <span className="cnt">{sig.length}</span></h3>
    {sig.length === 0 && <p className="mut">No hay más tareas asignadas.</p>}
    {sig.slice(0, 6).map(t => <TallerTask key={t.id} t={t} />)}
    {hechas.length > 0 && <><h3>Terminadas hoy <span className="cnt">{hechas.length}</span></h3>{hechas.map(t => <DoneRow key={t.id} t={t} />)}</>}
  </section><section><DarTareas op={o.id} grande /></section></div>;
}

/* ================= IMPORTADOR ================= */
function Importer({ mode, proyId, onClose }) {
  const { S, up, ui } = useApp();
  const campos = mode === 'rep' ? [['orden', 'OV/OC'], ['codigo', 'Código (opcional)'], ['nombre', 'Descripción'], ['cant', 'Cantidad'], ['cliente', 'Cliente']] : [['n', 'N° (1, 1.1, 1.2…)'], ['codigo', 'Código'], ['cant', 'Cantidad'], ['nombre', 'Descripción (opcional)']];
  const [rows, setRows] = useState(null); const [fecha, setFecha] = useState(E.today()); const [head, setHead] = useState(true); const [map, setMap] = useState({}); const [txt, setTxt] = useState('');
  const cargar = rs => { rs = rs.filter(r => r && r.some(c => String(c == null ? '' : c).trim() !== '')); if (!rs.length) { ui.toast('La planilla está vacía'); return; }
    const h = rs[0].map(c => String(c == null ? '' : c).toLowerCase()); const m = {};
    const pista = { orden: ['ov', 'oc', 'orden'], nombre: ['prod', 'desc', 'nombre'], cant: ['cant'], cliente: ['client'], codigo: ['cod', 'cód'], n: ['n°', 'nº', 'nro', 'item', 'ítem', 'n'] };
    campos.forEach(([k], i) => { const j = h.findIndex(c => pista[k].some(p => k === 'n' && p === 'n' ? c.trim() === 'n' : c.includes(p))); m[k] = j >= 0 ? j : (i < rs[0].length && !k.match(/codigo/) ? i : ''); });
    setRows(rs); setMap(m); };
  const file = e => { const f = e.target.files[0]; if (!f) return; if (!window.XLSX) { ui.toast('No se pudo cargar el lector de Excel. Probá pegando las celdas.'); return; }
    const fr = new FileReader(); fr.onload = () => { try { const wb = window.XLSX.read(fr.result, { type: 'array' }); cargar(window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' })); } catch (err) { ui.toast('No se pudo leer el archivo. Tiene que ser .xlsx, .xls o .csv'); } }; fr.readAsArrayBuffer(f); };
  const cols = rows ? Array.from({ length: Math.max(...rows.map(r => r.length)) }, (_, i) => i) : [];
  const data = rows ? rows.slice(head ? 1 : 0) : [];
  const val = (r, k) => map[k] === '' || map[k] == null ? '' : String(r[map[k]] == null ? '' : r[map[k]]).trim();
  const importar = () => {
    let nuevos;
    if (mode === 'rep') nuevos = data.map(r => ({ ...E.blankTask('rep'), orden: val(r, 'orden'), nombre: [val(r, 'codigo'), val(r, 'nombre')].filter(Boolean).join(' '), cant: Number(val(r, 'cant')) || 1, cliente: val(r, 'cliente'), creada: fecha || E.today() })).filter(t => t.nombre);
    else { const ids = {}; nuevos = data.map(r => { const n = val(r, 'n'); const t = { ...E.blankTask('proy', proyId), nombre: [val(r, 'codigo'), val(r, 'nombre')].filter(Boolean).join(' '), cant: Number(val(r, 'cant')) || 1, _n: n }; if (n) ids[n] = t.id; return t; }).filter(t => t.nombre);
      nuevos = nuevos.map(({ _n, ...t }) => { const i = _n.lastIndexOf('.'); return { ...t, parentId: i > 0 && ids[_n.slice(0, i)] ? ids[_n.slice(0, i)] : null }; }); }
    nuevos = nuevos.map(t => ({ ...t, ...E.autoCompletar(S, t, true) }));
    if (!nuevos.length) { ui.toast('No encontré filas para importar. Revisá las columnas elegidas.'); return; }
    up(s => ({ ...s, tareas: [...s.tareas, ...nuevos] })); ui.toast(nuevos.length === 1 ? "1 fila importada" : `${nuevos.length} filas importadas`); onClose();
  };
  return <Modal title={mode === 'rep' ? 'Importar repuestos' : 'Importar árbol de piezas'} onClose={onClose} wide foot={rows && <><button className="btn" onClick={() => setRows(null)}>Elegir otra planilla</button><span className="sp" /><button className="btn pri-b" onClick={importar}>Importar {data.length} filas</button></>}>
    {!rows ? <div className="form">
      <label className="g2">Archivo de Excel (.xlsx)<input id="imp-file" type="file" accept=".xlsx,.xls,.csv" onChange={file} /></label>
      <label className="g2">O pegá acá las celdas copiadas desde Excel<textarea id="imp-txt" rows="6" value={txt} onChange={e => setTxt(e.target.value)} placeholder={campos.map(c => c[1]).join('\t')} /></label>
      <div className="g2"><button className="btn" disabled={!txt.trim()} onClick={() => cargar(txt.split(/\r?\n/).map(l => l.split('\t')))}>Usar lo pegado</button></div>
    </div> : <>
      <p className="mut">Elegí qué columna de tu planilla corresponde a cada campo.</p>
      <div className="form">{campos.map(([k, l]) => <label key={k}>{l}<select id={'imp-' + k} value={map[k]} onChange={e => setMap({ ...map, [k]: e.target.value === '' ? '' : Number(e.target.value) })}><option value="">No usar</option>{cols.map(i => <option key={i} value={i}>{head && rows[0][i] !== '' && rows[0][i] != null ? String(rows[0][i]) : 'Columna ' + (i + 1)}</option>)}</select></label>)}
        {mode === 'rep' && <label>Fecha de carga de estas órdenes<input id="imp-fecha" type="date" value={fecha} max={E.today()} onChange={e => setFecha(e.target.value)} /></label>}
        <label className="chk g2"><input id="imp-head" type="checkbox" checked={head} onChange={e => setHead(e.target.checked)} /> La primera fila tiene los títulos</label></div>
      <div className="scroll"><table className="tt"><thead><tr>{campos.map(c => <th key={c[0]}>{c[1]}</th>)}</tr></thead><tbody>{data.slice(0, 6).map((r, i) => <tr key={i}>{campos.map(c => <td key={c[0]}>{val(r, c[0])}</td>)}</tr>)}</tbody></table></div>
      {data.length > 6 && <p className="mut">…y {data.length - 6} filas más.</p>}</>}
  </Modal>;
}

/* ================= CONFIGURACIÓN ================= */
function ListEdit({ title, items, onAdd, onDel, render, addLabel, extra }) {
  const PL = useContext(PlCtx);
  return <section className={'card' + PL.c(title)}><div className="sec-h"><h2>{PL.h(title)}</h2><div className="row">{extra}<button className="btn" onClick={onAdd}>{addLabel || '+ Agregar'}</button></div></div>
    {items.length === 0 && <p className="mut">Nada cargado todavía.</p>}
    {items.map((it, i) => <div key={it.id || i} className="lrow">{render(it, i)}<button className="btn sm danger" onClick={() => onDel(it, i)}>Borrar</button></div>)}</section>;
}
const PlCtx = createContext({ c: () => '', h: t => t });
const CFG_SECS = ['Atajos de teclado', 'Operarios', 'Ausencias', 'Operaciones', 'Códigos de operación', 'Horarios laborales', 'Feriados', 'Usuarios y permisos', 'Color de énfasis', 'Datos', 'Registro de cambios', 'Sesión'];
function Atajos() {
  const PL = useContext(PlCtx);
  const G = [['En todas las pantallas', [['Esc', 'Cierra la ventana abierta (editar tarea, operario, parte del día…)'], ['Ctrl + Z', 'Deshace el último cambio (si estás escribiendo en una celda, deshace lo escrito)'], ['Ctrl + Y  /  Ctrl + Mayús + Z', 'Rehace lo que deshiciste']]],
    ['Proyectos', [['Alt + 1 … 9', 'Abre el proyecto 1 al 9, en el orden de la barra de proyectos'], ['Alt + 0', 'Vuelve a "Todos" (la lista de proyectos)'], ['Doble clic en el borde de la columna Pieza del Gantt', 'Vuelve al ancho original'], ['Arrastrar una barra del Gantt', 'Mueve la tarea de día y la deja fijada a mano 📌 (no la corren las etapas)'], ['▲ ▼ en la tabla de tareas', 'Cambia el orden de la pieza dentro de su ensamblaje']]],
    ['Tablas de Repuestos y Proyectos: moverse', [['↑ ↓ ← →', 'Pasa de celda en celda, como en Excel'], ['Enter', 'Confirma lo escrito y baja a la celda de abajo'], ['Clic en una celda', 'Selecciona todo el texto: lo que escribas lo reemplaza'], ['Doble clic en el borde de un título de columna', 'Vuelve la columna a su ancho original']]],
    ['Tablas de Repuestos y Proyectos: seleccionar filas', [['Espacio (Space)', 'En la casilla de la primera columna: marca o desmarca la fila'], ['Mayús + Espacio (Shift + Space)', 'Marca o desmarca la fila desde cualquier columna'], ['Mayús + ↑ / ↓ (Shift + flechas)', 'Va sumando filas a la selección mientras subís o bajás'], ['← al principio del nombre', 'Vuelve a la casilla de selección'], ['→, Enter o F2 desde la casilla', 'Entra al nombre de la pieza para editarlo']]]];
  return <section className={'card full' + PL.c('Atajos de teclado')}><div className="sec-h"><h2>{PL.h('Atajos de teclado')}</h2></div>
    <div className="atajos">{G.map(([g, l]) => <div key={g} className="atg"><h3>{g}</h3>{l.map(([k, d]) => <div key={k} className="atr"><span className="kbd">{k}</span><span>{d}</span></div>)}</div>)}</div>
    <p className="mut">En la Mac, Alt es la tecla Opción (Option).</p></section>;
}
function Config() {
  const { S, V, up, ui, ses } = useApp(); const [conf, setConf] = useState(false); const [prueba, setPrueba] = useState('');
  const [ab, setAb] = useState(() => prefG('cfg-abiertas', [])); useEffect(() => { guardaG('cfg-abiertas', ab); }, [ab]);
  const PL = { c: t => ab.includes(t) ? ' plg on' : ' plg', h: t => <button className="plg-t" aria-expanded={ab.includes(t)} onClick={() => setAb(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t])}><span className="car">{ab.includes(t) ? '▾' : '▸'}</span>{t}</button> };
  const aplicarCod = () => { let n = 0; up(s => ({ ...s, tareas: s.tareas.map(t => { if (s.tareas.some(x => x.parentId === t.id) || t.estado === 'terminada') return t; const a = E.autoCompletar(s, t, false); if (a.operacionId && a.operacionId !== t.operacionId) { n++; return { ...t, ...a }; } return t; }) })); ui.toast(n ? `Operación asignada a ${n} ${n === 1 ? 'pieza' : 'piezas'}` : 'No había piezas sin operación con código reconocido'); }; const [lq, setLq] = useState(''); const [ln, setLn] = useState(40);
  const cargarFer = l => { let n = 0; up(s => { const ya = new Set(s.feriados.map(f => f.fecha)); const nu = l.map(([d, nombre]) => ({ fecha: '2026-' + d, nombre })).filter(f => !ya.has(f.fecha)); n = nu.length; return n ? { ...s, feriados: [...s.feriados, ...nu] } : s; }); ui.toast(n ? `${n} ${n === 1 ? 'fecha agregada' : 'fechas agregadas'}` : 'Esas fechas ya estaban cargadas'); };
  const log = (S.log || []).filter(e => !lq || e.uid === lq);
  const setL = (k, id, patch) => up(s => ({ ...s, [k]: s[k].map(x => x.id === id ? { ...x, ...patch } : x) }));
  const act = E.seasonNow(S); const otra = act === 'invierno' ? 'verano' : 'invierno';
  const setH = (t, k, v) => up(s => ({ ...s, cfg: { ...s.cfg, horarios: { ...s.cfg.horarios, [t]: { ...s.cfg.horarios[t], [k]: v } } } }));
  const cambiar = () => { up(s => ({ ...s, cfg: { ...s.cfg, temporadas: [...s.cfg.temporadas.filter(x => x.desde !== E.today()), { desde: E.today(), t: otra }] } })); ui.toast(`Horario de ${otra} activo desde hoy`); };
  const fila = t => { const r = V.D[t.id], root = V.rootOf(t); const p = S.proyectos.find(x => x.id === t.proyId);
    return { Tipo: t.tipo === 'rep' ? 'Repuesto' : 'Proyecto', Proyecto: p ? p.nombre : '', 'OV/OC': t.tipo === 'rep' ? root.orden : '', Cliente: t.tipo === 'rep' ? root.cliente : '', Pieza: t.nombre, 'Depende de': t.parentId ? V.byId[t.parentId].nombre : '', Cantidad: Number(t.cant) || 0, Prioridad: t.prioridad, Operación: r.parent ? '' : operName(S, t.operacionId), Operarios: r.ops.map(o => opName(S, o)).join(', '), Turno: r.parent ? '' : t.turno, Inicio: r.inicio ? r.inicio.replace('T', ' ') : '', Fin: r.fin ? r.fin.replace('T', ' ') : '', 'Horas-hombre': r.hh, 'Duración calendario (h)': r.parent ? '' : r.durCal, Estado: r.estado, 'Avance %': Math.round(r.avance), 'HH reales': r.hhReal }; };
  const exportar = () => { if (!window.XLSX) { ui.toast('No se pudo cargar el generador de Excel'); return; } const X = window.XLSX, wb = X.utils.book_new();
    const orden = tipo => { const out = []; const go = t => { out.push(fila(t)); (V.kids[t.id] || []).forEach(go); }; S.tareas.filter(t => t.tipo === tipo && !t.parentId).forEach(go); return out; };
    X.utils.book_append_sheet(wb, X.utils.json_to_sheet(orden('rep')), 'Repuestos'); X.utils.book_append_sheet(wb, X.utils.json_to_sheet(orden('proy')), 'Proyectos');
    saveFile(`produccion-${E.today()}.xlsx`, X.write(wb, { type: 'array', bookType: 'xlsx' }), ui.toast); };
  const restaurar = e => { const f = e.target.files[0]; if (!f) return; const fr = new FileReader(); fr.onload = () => { try { const d = JSON.parse(fr.result); if (!d.tareas || !d.cfg) throw 0; up(s => ({ ...d, usuarios: ses ? s.usuarios : (d.usuarios || s.usuarios), log: s.log })); ui.toast('Copia restaurada'); } catch (err) { ui.toast('Ese archivo no es una copia de ProducciónApp'); } }; fr.readAsText(f); e.target.value = ''; };
  return <PlCtx.Provider value={PL}><div className="view cfg"><div className="cfg-top"><span className="mut">Tocá el título de cada sección para abrirla o cerrarla.</span><span className="sp" /><button className="btn sm" onClick={() => setAb(CFG_SECS)}>Abrir todas</button><button className="btn sm" onClick={() => setAb([])}>Cerrar todas</button></div>
    <Atajos />
    <ListEdit title="Operarios" items={S.operarios} addLabel="+ Operario" onAdd={() => up(s => ({ ...s, operarios: [...s.operarios, { id: E.uid(), nombre: 'Nuevo operario', activo: true }] }))}
      onDel={o => up(s => ({ ...s, operarios: s.operarios.filter(x => x.id !== o.id), ausencias: s.ausencias.filter(a => a.opId !== o.id), tareas: s.tareas.map(t => t.ops.includes(o.id) ? { ...t, ops: t.ops.filter(x => x !== o.id) } : t) }))}
      render={o => <><input aria-label="Nombre" value={o.nombre} onChange={e => setL('operarios', o.id, { nombre: e.target.value })} /><label className="inl">Principal<select value={o.op1 || ''} onChange={e => setL('operarios', o.id, { op1: e.target.value })}><option value="">—</option>{S.operaciones.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></label><label className="inl">Secundaria<select value={o.op2 || ''} onChange={e => setL('operarios', o.id, { op2: e.target.value })}><option value="">—</option>{S.operaciones.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></label><label className="chk"><input type="checkbox" checked={o.activo} onChange={e => setL('operarios', o.id, { activo: e.target.checked })} /> Activo</label></>} />
    <ListEdit title="Ausencias" items={S.ausencias} addLabel="+ Ausencia" onAdd={() => up(s => ({ ...s, ausencias: [...s.ausencias, { id: E.uid(), opId: s.operarios[0] ? s.operarios[0].id : '', desde: E.today(), hasta: E.today(), motivo: 'Vacaciones' }] }))}
      onDel={a => up(s => ({ ...s, ausencias: s.ausencias.filter(x => x.id !== a.id) }))}
      render={a => <><select aria-label="Operario" value={a.opId} onChange={e => setL('ausencias', a.id, { opId: e.target.value })}>{S.operarios.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select>
        <input aria-label="Desde" type="date" value={a.desde} onChange={e => setL('ausencias', a.id, { desde: e.target.value, hasta: e.target.value > a.hasta ? e.target.value : a.hasta })} /><input aria-label="Hasta" type="date" value={a.hasta} min={a.desde} onChange={e => setL('ausencias', a.id, { hasta: e.target.value })} />
        <input aria-label="Motivo" value={a.motivo} onChange={e => setL('ausencias', a.id, { motivo: e.target.value })} /></>} />
    <ListEdit title="Operaciones" items={S.operaciones} addLabel="+ Operación" onAdd={() => up(s => ({ ...s, operaciones: [...s.operaciones, { id: E.uid(), nombre: 'Nueva operación' }] }))}
      onDel={o => up(s => ({ ...s, operaciones: s.operaciones.filter(x => x.id !== o.id) }))}
      render={(o, i) => <><label className="inl" title="Orden de fabricación: las de etapa menor se hacen primero. 0 = en paralelo: no espera a otras etapas ni las frena (las piezas que la necesitan igual esperan a sus hijas).">Etapa<input className="w4" type="number" min="0" aria-label="Etapa" value={E.etapaOp(o)} onChange={e => setL('operaciones', o.id, { etapa: e.target.value === '' ? null : Number(e.target.value) })} /></label><input aria-label="Nombre" value={o.nombre} onChange={e => setL('operaciones', o.id, { nombre: e.target.value })} />{E.etapaOp(o) === 0 && <span className="tag">en paralelo</span>}</>} />
    <section className={'card' + PL.c('Códigos de operación')}><div className="sec-h"><h2>{PL.h('Códigos de operación')}</h2><div className="row"><button className="btn" onClick={aplicarCod}>Aplicar a las piezas cargadas</button><button className="btn" onClick={() => up(s => ({ ...s, codigos: [...(s.codigos || []), { id: E.uid(), num: '', operacionId: s.operaciones[0] ? s.operaciones[0].id : '' }] }))}>+ Código</button></div></div>
      <p className="mut">En los códigos TPFR y TPFD, los 3 primeros números indican la operación. Al cargar o importar una pieza, la operación se completa sola y después la podés cambiar.</p>
      {(S.codigos || []).length === 0 && <p className="mut">Todavía no hay códigos cargados.</p>}
      {(S.codigos || []).slice().sort((a, b) => String(a.num).localeCompare(String(b.num))).map(c => <div key={c.id} className="lrow">
        <input aria-label="Número" className="w4" inputMode="numeric" maxLength="3" placeholder="000" value={c.num} onChange={e => setL('codigos', c.id, { num: e.target.value.replace(/\D/g, '').slice(0, 3) })} />
        <span className="mut">→</span><select aria-label="Operación" value={c.operacionId} onChange={e => setL('codigos', c.id, { operacionId: e.target.value })}>{S.operaciones.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select>
        {(S.codigos || []).filter(x => x.num && x.num === c.num).length > 1 && <span className="tag bad">número repetido</span>}
        <span className="sp" /><button className="btn sm danger" onClick={() => up(s => ({ ...s, codigos: s.codigos.filter(x => x.id !== c.id) }))}>Borrar</button></div>)}
      <div className="lrow prueba"><label className="inl">Probar un código<input value={prueba} placeholder="TPFR-120-045-01" onChange={e => setPrueba(e.target.value)} /></label>
        {prueba.trim() && (() => { const r = E.codOp(S, prueba); return <span className={r && r.operacionId ? 'c-ok' : 'c-bad'}>{!r ? 'No reconozco un código TPFR o TPFD con 3 números' : r.operacionId ? `${r.num} → ${operName(S, r.operacionId)}` : `${r.num} → sin operación asignada`}</span>; })()}</div></section>
    <section className={'card' + PL.c('Horarios laborales')}><div className="sec-h"><h2>{PL.h('Horarios laborales')}</h2><button className="btn pri-b" onClick={cambiar}>Pasar a horario de {otra}</button></div>
      <p className="mut">Activo: <b className="acc">{act}</b> desde el {fD(S.cfg.temporadas[S.cfg.temporadas.length - 1].desde)}. Queda así hasta que lo cambies.</p>
      <div className="hor">{['invierno', 'verano'].map(t => { const h = S.cfg.horarios[t], net = E.netOf(h); return <div key={t} className={'horc' + (t === act ? ' on' : '')}><b>{t}</b>
        <label>Entrada<input type="time" value={h.entrada} onChange={e => setH(t, 'entrada', e.target.value)} /></label><label>Salida<input type="time" value={h.salida} onChange={e => setH(t, 'salida', e.target.value)} /></label>
        <label>Descanso desde<input type="time" value={h.descansoIni} onChange={e => setH(t, 'descansoIni', e.target.value)} /></label><label>Minutos de descanso<input type="number" min="0" step="5" value={h.descansoMin} onChange={e => setH(t, 'descansoMin', e.target.value)} /></label>
        <span className={Math.abs(net - 9) > 0.01 ? 'c-bad' : 'mut'}>Jornada neta: {fH(net)}{Math.abs(net - 9) > 0.01 ? ' (la jornada normal es de 9 h)' : ''}</span></div>; })}</div>
      <p className="mut">Cambios registrados: {S.cfg.temporadas.map(x => `${x.t} desde ${fD(x.desde)}/${x.desde.slice(0, 4)}`).join(' · ')}</p></section>
    <ListEdit title="Feriados" items={S.feriados.slice().sort((a, b) => a.fecha < b.fecha ? -1 : 1)} extra={<><button className="btn" onClick={() => cargarFer(FER2026)}>Nacionales 2026</button><button className="btn" title="23/3, 10/7 y 7/12: días no laborables con fines turísticos, optativos para el empleador" onClick={() => cargarFer(NOLAB2026)}>No laborables 2026</button></>} addLabel="+ Feriado" onAdd={() => up(s => ({ ...s, feriados: [...s.feriados, { fecha: E.today(), nombre: 'Feriado' }] }))}
      onDel={f => up(s => ({ ...s, feriados: s.feriados.filter(x => x !== f) }))}
      render={(f, i) => <><input aria-label="Fecha" type="date" value={f.fecha} onChange={e => up(s => ({ ...s, feriados: s.feriados.map(x => x === f ? { ...x, fecha: e.target.value } : x) }))} /><input aria-label="Nombre" value={f.nombre} onChange={e => up(s => ({ ...s, feriados: s.feriados.map(x => x === f ? { ...x, nombre: e.target.value } : x) }))} /></>} />
    {ses ? <UsuariosFB /> : <ListEdit title="Usuarios y permisos" items={S.usuarios} addLabel="+ Usuario" onAdd={() => up(s => ({ ...s, usuarios: [...s.usuarios, { id: E.uid(), nombre: 'Usuario nuevo', email: '', admin: false, rep: 'ver', proy: 'ver' }] }))}
      onDel={u => { if (u.admin && S.usuarios.filter(x => x.admin).length === 1) { ui.toast('Tiene que quedar al menos un administrador'); return; } up(s => ({ ...s, usuarios: s.usuarios.filter(x => x.id !== u.id) })); }}
      render={u => <div className="urow"><input aria-label="Nombre" value={u.nombre} onChange={e => setL('usuarios', u.id, { nombre: e.target.value })} /><input aria-label="Mail de Google" type="email" placeholder="mail@gmail.com" value={u.email} onChange={e => setL('usuarios', u.id, { email: e.target.value.trim().toLowerCase() })} />
        <label className="inl">Repuestos y Producción<select value={u.admin ? 'editar' : u.rep} disabled={u.admin} onChange={e => setL('usuarios', u.id, { rep: e.target.value })}><option value="ver">Ver</option><option value="editar">Editar</option></select></label>
        <label className="inl">Proyectos<select value={u.admin ? 'editar' : u.proy} disabled={u.admin} onChange={e => setL('usuarios', u.id, { proy: e.target.value })}><option value="ver">Ver</option><option value="editar">Editar</option></select></label>
        <label className="chk"><input type="checkbox" checked={!!u.admin} onChange={e => { if (!e.target.checked && S.usuarios.filter(x => x.admin).length === 1) { ui.toast('Tiene que quedar al menos un administrador'); return; } setL('usuarios', u.id, { admin: e.target.checked }); }} /> Administrador</label></div>} />}
    <section className={'card' + PL.c('Color de énfasis')}><div className="sec-h"><h2>{PL.h('Color de énfasis')}</h2></div>
      <div className="row">{ACCENTS.map(c => <button key={c} className={'sw' + (S.cfg.accent === c ? ' on' : '')} style={{ background: c }} aria-label={'Color ' + c} onClick={() => up(s => ({ ...s, cfg: { ...s.cfg, accent: c } }))} />)}
        <label className="inl">Otro<input id="cfg-acc" type="color" value={S.cfg.accent} onChange={e => up(s => ({ ...s, cfg: { ...s.cfg, accent: e.target.value } }))} /></label></div></section>
    <section className={'card' + PL.c('Datos')}><div className="sec-h"><h2>{PL.h('Datos')}</h2></div>
      <div className="row"><button className="btn" onClick={exportar}>Exportar repuestos y proyectos a .xlsx</button>
        <button className="btn" onClick={() => saveFile(`produccionapp-copia-${E.today()}.json`, JSON.stringify(S), ui.toast)}>Guardar copia de seguridad</button>
        <label className="btn filebtn">Restaurar una copia<input id="cfg-rest" type="file" accept=".json" onChange={restaurar} /></label>
        {!ses && <button className="btn danger" onClick={() => { up(() => E.sample()); ui.toast('Datos de ejemplo restablecidos'); }}>Restablecer datos de ejemplo</button>}</div>
      <div className="blanco">{conf ? <><b>Se borran todas las tareas, proyectos, operarios, ausencias y horas extra.</b><span className="mut">Quedan las operaciones, los horarios, los feriados y los usuarios.</span>
        <div className="row"><button className="btn danger" onClick={() => { up(s => ({ ...s, ejemplo: false, tareas: [], proyectos: [], operarios: [], ausencias: [], extras: {}, extraModo: {} })); setConf(false); ui.toast('Lista para cargar tus datos. Si fue un error, tocá Deshacer.'); }}>Sí, empezar en blanco</button><button className="btn" onClick={() => setConf(false)}>Cancelar</button></div></>
        : <><button className="btn pri-b" onClick={() => setConf(true)}>Empezar en blanco con mis datos</button><span className="mut">Saca los datos de ejemplo para que cargues los tuyos.</span></>}</div>
      <p className="mut">{ses ? 'Los datos se guardan en la nube y se comparten con todos los usuarios. Bajá una copia de seguridad cada tanto.' : 'En esta vista previa los cambios se guardan solo en este navegador.'}</p></section>
    <section className={'card full' + PL.c('Registro de cambios')}><div className="sec-h"><h2>{PL.h('Registro de cambios')}</h2>
        <select id="log-q" value={lq} onChange={e => setLq(e.target.value)} aria-label="Usuario"><option value="">Todos los usuarios</option>{S.usuarios.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}</select></div>
      {log.length === 0 && <p className="mut">Todavía no hay cambios registrados. Cada cambio queda acá con fecha, hora y usuario.</p>}
      <div className="logl">{log.slice(0, ln).map((e, i) => { const d = new Date(e.ts); return <div key={e.ts + '-' + i} className="logr"><span className="mut">{E.pad(d.getDate())}/{E.pad(d.getMonth() + 1)} {E.pad(d.getHours())}:{E.pad(d.getMinutes())}</span><b>{e.quien}</b><span>{e.txt}</span></div>; })}</div>
      {log.length > ln && <button className="btn" onClick={() => setLn(ln + 80)}>Ver más ({log.length - ln})</button>}
      <p className="mut">Guarda los últimos 300 cambios.</p></section>
    <section className={'card' + PL.c('Sesión')}><div className="sec-h"><h2>{PL.h('Sesión')}</h2></div>{ses ? <><p>Entraste como <b>{ses.email}</b>.</p><button className="btn" onClick={ses.salir}>Cerrar sesión</button></> : <><button className="btn" disabled>Cerrar sesión</button><p className="mut">Se activa en la etapa 2, junto con el inicio de sesión.</p></>}</section>
  </div></PlCtx.Provider>;
}

/* ================= USUARIOS (versión web con Firebase) ================= */
function UsuariosFB() {
  const PL = useContext(PlCtx);
  const { S, up, ui, ses } = useApp(); const vacio = { nombre: '', email: '', pass: '', rep: 'ver', proy: 'ver', admin: false };
  const [f, setF] = useState(vacio); const [busy, setBusy] = useState(false); const [ver, setVer] = useState(false);
  const setU = (u, patch) => up(s => ({ ...s, usuarios: s.usuarios.map(x => x.id === u.id ? { ...x, ...patch } : x) }));
  const crear = async () => {
    const email = f.email.trim().toLowerCase();
    if (!f.nombre.trim() || !/^\S+@\S+\.\S+$/.test(email)) { ui.toast('Completá el nombre y un mail válido'); return; }
    if (S.usuarios.some(u => u.email === email)) { ui.toast('Ese mail ya está cargado'); return; }
    if (f.pass && f.pass.length < 6) { ui.toast('La contraseña tiene que tener al menos 6 caracteres'); return; }
    setBusy(true); const r = await ses.crearCuenta(email, f.pass); setBusy(false);
    if (r.error) { ui.toast(r.error); return; }
    up(s => ({ ...s, usuarios: [...s.usuarios, { id: email, email, nombre: f.nombre.trim(), admin: f.admin, rep: f.rep, proy: f.proy }] }));
    ui.toast(r.existia ? 'Agregado. Ese mail ya tenía cuenta en las apps de la empresa: entra con la contraseña que ya usa.' : f.pass ? 'Usuario creado. Pasale su mail y la contraseña.' : 'Agregado. Va a entrar con su cuenta de Google.');
    setF(vacio);
  };
  return <section className={'card' + PL.c('Usuarios y permisos')}><div className="sec-h"><h2>{PL.h('Usuarios y permisos')}</h2></div>
    <p className="mut">Solo entran los mails de esta lista. Vos entrás siempre como administrador.</p>
    {S.usuarios.map(u => { const yoMismo = u.email === ses.email; return <div key={u.id} className="lrow"><div className="urow">
      <input aria-label="Nombre" defaultValue={u.nombre} onBlur={e => e.target.value.trim() && e.target.value !== u.nombre && setU(u, { nombre: e.target.value.trim() })} />
      <span className="mail">{u.email}</span>
      <label className="inl">Repuestos y Producción<select value={u.admin ? 'editar' : u.rep} disabled={u.admin} onChange={e => setU(u, { rep: e.target.value })}><option value="ver">Ver</option><option value="editar">Editar</option></select></label>
      <label className="inl">Proyectos<select value={u.admin ? 'editar' : u.proy} disabled={u.admin} onChange={e => setU(u, { proy: e.target.value })}><option value="ver">Ver</option><option value="editar">Editar</option></select></label>
      <label className="chk"><input type="checkbox" checked={!!u.admin} disabled={yoMismo} onChange={e => setU(u, { admin: e.target.checked })} /> Administrador</label>
      <button className="btn sm" onClick={async () => { const r = await ses.reset(u.email); ui.toast(r.error || `Le mandamos a ${u.email} un mail para elegir una contraseña nueva`); }}>Mail para cambiar contraseña</button></div>
      {!yoMismo && <button className="btn sm danger" onClick={() => up(s => ({ ...s, usuarios: s.usuarios.filter(x => x.id !== u.id) }))}>Quitar acceso</button>}</div>; })}
    <div className="alta"><b>Nuevo usuario</b>
      <div className="urow"><input id="nu-nom" placeholder="Nombre (el que se ve en la app)" value={f.nombre} onChange={e => setF({ ...f, nombre: e.target.value })} />
        <input id="nu-mail" type="email" placeholder="mail@ejemplo.com" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} />
        <span className="pw"><input id="nu-pass" type={ver ? 'text' : 'password'} placeholder="Contraseña (vacía si entra con Google)" value={f.pass} onChange={e => setF({ ...f, pass: e.target.value })} /><button className="btn sm" type="button" onClick={() => setVer(!ver)}>{ver ? 'Ocultar' : 'Ver'}</button></span>
        <label className="inl">Repuestos y Producción<select value={f.rep} onChange={e => setF({ ...f, rep: e.target.value })}><option value="ver">Ver</option><option value="editar">Editar</option></select></label>
        <label className="inl">Proyectos<select value={f.proy} onChange={e => setF({ ...f, proy: e.target.value })}><option value="ver">Ver</option><option value="editar">Editar</option></select></label>
        <label className="chk"><input type="checkbox" checked={f.admin} onChange={e => setF({ ...f, admin: e.target.checked })} /> Administrador</label>
        <button className="btn pri-b" disabled={busy} onClick={crear}>{busy ? 'Creando…' : 'Crear usuario'}</button></div>
      <p className="mut">Con contraseña: se le crea la cuenta y entra con mail y contraseña. Sin contraseña: entra con su cuenta de Google (sirve para Gmail).</p></div>
  </section>;
}
/* ================= PANTALLAS DE ENTRADA (versión web) ================= */
const Logo = () => <svg className="logo" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l8.66 5v10L12 22l-8.66-5V7z" /><circle cx="12" cy="12" r="3.4" /></svg>;
export function Pantalla({ children }) { return <div className="pant"><div className="pcaja"><h1 className="pmarca"><Logo />Producción<span>App</span></h1>{children}</div></div>; }
export function Login({ google, entrar, reset }) {
  const [mail, setMail] = useState(''); const [pass, setPass] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const run = async f => { setBusy(true); setMsg(''); const r = await f(); setBusy(false); if (r && r.error) setMsg(r.error); else if (r && r.ok) setMsg(r.ok); };
  return <Pantalla>
    <p className="mut">Control de producción del taller. Entrá con tu usuario.</p>
    <button className="btn big pri-b" disabled={busy} onClick={() => run(google)}>Entrar con Google</button>
    <div className="osep"><span>o con mail y contraseña</span></div>
    <form className="pform" onSubmit={e => { e.preventDefault(); run(() => entrar(mail.trim().toLowerCase(), pass)); }}>
      <input id="l-mail" type="email" autoComplete="username" placeholder="Mail" value={mail} onChange={e => setMail(e.target.value)} />
      <input id="l-pass" type="password" autoComplete="current-password" placeholder="Contraseña" value={pass} onChange={e => setPass(e.target.value)} />
      <button className="btn big" disabled={busy || !mail || !pass} type="submit">Entrar</button>
    </form>
    <button className="lnk" disabled={busy} onClick={() => mail ? run(() => reset(mail.trim().toLowerCase())) : setMsg('Escribí tu mail arriba y tocá de nuevo')}>Me olvidé la contraseña</button>
    {msg && <p className="pmsg">{msg}</p>}
  </Pantalla>;
}
export function Inicio({ elegir, dueno }) {
  const [busy, setBusy] = useState(false);
  if (!dueno) return <Pantalla><p>La app todavía no está configurada. Avisale al administrador.</p></Pantalla>;
  const go = async ej => { setBusy(true); const S = E.sample(); const base = ej ? S : { ...S, ejemplo: false, tareas: [], proyectos: [], operarios: [], ausencias: [], extras: {}, extraModo: {}, feriados: FER2026.map(([d, nombre]) => ({ fecha: '2026-' + d, nombre })) }; await elegir({ ...base, usuarios: [], log: [] }); };
  return <Pantalla>
    <h2>Primera vez</h2><p className="mut">La base de datos está vacía. ¿Cómo querés arrancar?</p>
    <button className="btn big pri-b" disabled={busy} onClick={() => go(false)}>Empezar en blanco</button>
    <p className="mut">Con los horarios, las operaciones típicas y los feriados nacionales 2026. Cargás tus operarios, repuestos y proyectos.</p>
    <button className="btn big" disabled={busy} onClick={() => go(true)}>Con datos de ejemplo</button>
    <p className="mut">Para probar con todo cargado. Después los sacás desde Configuración → Datos → Empezar en blanco.</p>
  </Pantalla>;
}

/* ================= APP ================= */
const TABS = [['resumen', 'Producción', 'M4 5h16v15H4zM4 10h16M9 5v15M15 5v15'], ['repuestos', 'Repuestos', 'M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9zM12 9a3 3 0 100 6 3 3 0 000-6z'], ['proyectos', 'Proyectos', 'M4 6h9M8 12h11M5 18h8'], ['taller', 'Taller', 'M14.5 5.5a4 4 0 00-5.2 5.2L4 16l4 4 5.3-5.3a4 4 0 005.2-5.2l-2.7 2.7-2.3-.7-.7-2.3z'], ['config', 'Configuración', 'M4 7h10M18 7h2M4 17h2M10 17h10M16 5v4M8 15v4', 'Config.']];
const AVC = ['#5cc8c0', '#e59a57', '#b08cf0', '#e37fa7', '#8fbf5a', '#6f9df5', '#d9c15a', '#d98a8a', '#58b7e8', '#c9a0dc'];
const Av = ({ o, i, sm }) => <span className={'av' + (sm ? ' sm' : '')} style={{ '--c': AVC[i % AVC.length] }}>{(o.nombre || '?').trim().slice(0, 2).toUpperCase()}</span>;
export function App({ db, ses, S0 }) {
  const [S, setS] = useState(() => S0 || db.inicial()); const ref = useRef(S); const hist = useRef([]); const fut = useRef([]); const [nh, setNh] = useState(0); const [nf, setNf] = useState(0);
  const [tab, setTab] = useState(() => { const h = (location.hash || '').slice(1); return TABS.some(t => t[0] === h) ? h : 'resumen'; });
  const [modal, setModal] = useState(null); const [toast, setToast] = useState(null);
  const [uid, setUid] = useState(() => { try { return localStorage.getItem(KEY + '-uid') || 'u1'; } catch (e) { return 'u1'; } });
  const yo = ses ? (S.usuarios.find(u => u.email === ses.email) || (ses.dueno ? { id: ses.email, email: ses.email, nombre: ses.nombre || 'Dueño', admin: true } : { id: ses.email, email: ses.email, nombre: ses.email, admin: false, rep: 'ver', proy: 'ver' }))
    : (S.usuarios.find(u => u.id === uid) || S.usuarios.find(u => u.admin) || S.usuarios[0]);
  if (ses && ses.dueno) yo.admin = true;
  const pm = { admin: !!yo.admin, rep: !!yo.admin || yo.rep === 'editar', proy: !!yo.admin || yo.proy === 'editar' }; const pmRef = useRef(pm); pmRef.current = pm; const yoRef = useRef(yo); yoRef.current = yo;
  const V = useMemo(() => E.derive(S), [S]);
  const up = useCallback(fn => { const p = ref.current, n = fn(p); if (n === p) return; const err = permiso(p, n, pmRef.current); if (err) { setToast(err); return; } const d = describir(p, n); let n2 = n.log === p.log ? n : { ...n, log: p.log };
    if (d) { const yo = yoRef.current, now = Date.now(), log = p.log || [], junta = log[0] && log[0].uid === yo.id && log[0].k === d.k && now - log[0].ts < 90000, e = { id: junta ? log[0].id : now + '-' + E.uid(), ts: now, uid: yo.id, email: yo.email || '', quien: yo.nombre, k: d.k, txt: d.txt }; n2 = { ...n2, log: junta ? [e, ...log.slice(1)] : [e, ...log].slice(0, 300) }; }
    hist.current = [...hist.current.slice(-39), { s: p, txt: d ? d.txt : 'último cambio' }]; fut.current = []; setNf(0); ref.current = n2; setS(n2); setNh(hist.current.length); db.escribir(p, n2, setToast); }, []);
  const undo = useCallback(() => { const h = hist.current.pop(); if (!h) return; const p = ref.current; fut.current.push({ s: p, txt: h.txt }); ref.current = h.s; setS(h.s); setNh(hist.current.length); setNf(fut.current.length); db.escribir(p, h.s, setToast); setToast('Deshecho: ' + h.txt.slice(0, 120)); }, []);
  const redo = useCallback(() => { const h = fut.current.pop(); if (!h) return; const p = ref.current; hist.current.push({ s: p, txt: h.txt }); ref.current = h.s; setS(h.s); setNh(hist.current.length); setNf(fut.current.length); db.escribir(p, h.s, setToast); setToast('Rehecho: ' + h.txt.slice(0, 120)); }, []);
  // Ctrl+Z / Ctrl+Y (y Ctrl+Mayús+Z). Mientras escribís en un campo, deshace lo escrito en ese campo, como siempre.
  useEffect(() => { const k = e => { if (!(e.ctrlKey || e.metaKey) || e.altKey) return; const key = e.key.toLowerCase(); if (key !== 'z' && key !== 'y') return;
      const el = e.target; const campo = el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'file'].includes(el.type) && (!el.classList.contains('ci') || el.dataset.sucio)));
      if (campo) return; e.preventDefault(); if (document.activeElement && document.activeElement.blur && el.tagName === 'INPUT') document.activeElement.blur();
      if (key === 'y' || (key === 'z' && e.shiftKey)) redo(); else undo(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [undo, redo]);
  // cambios que llegan de otros usuarios (Firebase): se muestran al instante; el deshacer se reinicia para no pisar lo ajeno
  useEffect(() => db.escuchar ? db.escuchar((R, remoto) => { ref.current = R; setS(R); if (remoto) { hist.current = []; fut.current = []; setNh(0); setNf(0); } }) : undefined, []);
  useEffect(() => { document.documentElement.style.setProperty('--accent', S.cfg.accent); }, [S.cfg.accent]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3200); return () => clearTimeout(t); }, [toast]);
  const ui = useMemo(() => ({ modal: setModal, toast: setToast }), []);
  const close = useCallback(() => setModal(null), []);
  const act = E.seasonNow(S), h = S.cfg.horarios[act];
  return <Ctx.Provider value={{ S, V, up, ui, ses }}>
    <div className="app" style={{ '--accent': S.cfg.accent }}>
      <header className="top">
        <h1><svg className="logo" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l8.66 5v10L12 22l-8.66-5V7z" /><circle cx="12" cy="12" r="3.4" /></svg>Producción<span>App</span></h1>
        <nav className="tabs">{TABS.map(([k, l, d, c]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); try { history.replaceState(null, '', '#' + k); } catch (e) { } }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg><span className="tl">{l}</span><span className="ts">{c || l}</span></button>)}</nav>
        <div className="top-r">{S.ejemplo !== false && <span className="tag ej">Datos de ejemplo</span>}
          {ses ? <span className="tag yo" title={yo.email}>{yo.nombre}</span> : <label className="inl vercomo" title="En esta vista previa elegís el usuario a mano para probar los permisos. En la etapa 2 lo decide el mail con el que cada uno inicia sesión.">Ver como<select id="ver-como" value={yo.id} onChange={e => { setUid(e.target.value); try { localStorage.setItem(KEY + '-uid', e.target.value); } catch (err) { } }}>{S.usuarios.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}</select></label>}
          {!pm.admin && <span className="tag warn">{pm.rep && pm.proy ? 'Edita todo, sin configuración' : pm.rep ? 'Edita Repuestos y Producción' : pm.proy ? 'Edita Proyectos' : 'Solo consulta'}</span>}<span className="tag">Horario de {act} · {h.entrada}–{h.salida}</span>
          <span className="undo"><button className="btn" onClick={undo} disabled={!nh} title={nh ? 'Deshacer (Ctrl+Z): ' + hist.current[hist.current.length - 1].txt : 'Nada para deshacer'}>↶ Deshacer</button><button className="btn" onClick={redo} disabled={!nf} title={nf ? 'Rehacer (Ctrl+Y): ' + fut.current[fut.current.length - 1].txt : 'Nada para rehacer'} aria-label="Rehacer">↷</button></span></div>
      </header>
      <main>{tab === 'resumen' ? <Resumen /> : tab === 'repuestos' ? <Repuestos /> : tab === 'proyectos' ? <Proyectos /> : tab === 'taller' ? <Taller /> : <Config />}</main>
      {modal && modal.k === 'task' && <TaskEditor key={modal.id || modal.draft.id} id={modal.id} draft={modal.draft} onClose={close} />}
      {modal && modal.k === 'op' && <OperarioPanel id={modal.id} onClose={close} />}
      {modal && modal.k === 'pick' && <Picker {...modal} onClose={close} />}
      {modal && modal.k === 'hoy' && <Hoy onClose={close} />}
      {modal && modal.k === 'lote' && <LoteEditor ids={modal.ids} titulo={modal.titulo} onClose={close} />}
      {modal && modal.k === 'imp' && <Importer mode={modal.mode} proyId={modal.proyId} onClose={close} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  </Ctx.Provider>;
}
