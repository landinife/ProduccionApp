import React, { useState, useMemo, useEffect, useRef, useCallback, createContext, useContext } from 'react';
import { createPortal } from 'react-dom';
import * as E from './engine.js';
const { fD, fDT, fDia, fH, fN } = E;

const Ctx = createContext(null);
const useApp = () => useContext(Ctx);
const KEY = 'produccionapp-preview-v2';
const PRI = { alta: 0, media: 1, baja: 2 };
/* tema claro u oscuro: se recuerda en este navegador y se aplica antes de dibujar, así la pantalla de carga ya sale con el tema elegido */
const TEMA_K = 'produccionapp-tema';
const leerTema = () => { try { return localStorage.getItem(TEMA_K) === 'claro' ? 'claro' : 'oscuro'; } catch (e) { return 'oscuro'; } };
const ponerTema = t => { try { document.documentElement.dataset.theme = t === 'claro' ? 'light' : 'glass'; /* glass = tema oscuro de vidrio (sección 8 de styles.css) */ const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = t === 'claro' ? '#eef2f6' : '#0f1319'; } catch (e) { } };
ponerTema(leerTema());
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
const estTxt = e => e === 'terminada' ? 'finalizada' : e === 'proximo' ? 'próximo a realizar' : e;
const estDe = t => E.esProximo(t) ? 'proximo' : t.estado;   // estado a mostrar (las marcadas antes del 10/11 son 'pendiente' con fecha de próximo)
// Secciones por estado (Producción, Repuestos, Proyectos, Post Venta y Taller): en proceso = con el cronómetro corriendo;
// en pausa = empezada y parada, pausada o frenada; después próximo a realizar y pendientes.
const SECC = [['curso', 'En proceso', 'var(--accent)'], ['pausa', 'En pausa', 'var(--warn)'], ['proximo', 'Próximo a realizar', 'var(--prox)'], ['pendiente', 'Pendientes', 'var(--mut)']];
const claseT = t => t.estado === 'terminada' ? 'terminada' : E.corriendo(t) ? 'curso' : (t.pausada || t.estado === 'en proceso' || E.estaFrenada(t)) ? 'pausa' : E.esProximo(t) ? 'proximo' : 'pendiente';
// ---- Piezas compartidas por Producción, Repuestos, Proyectos, Post Venta y Taller: secciones por estado y tablero por proceso ----
const ORD_CLASE = { curso: 0, pausa: 1, proximo: 2, pendiente: 3 };
// Piezas con trabajo propio (hojas) y sin finalizar de un conjunto de raíces, respetando el filtro vis
function hojasActivas(V, roots, vis) { const h = []; const junta = t => { if (!vis || vis(t)) { if (!V.D[t.id].parent && t.estado !== 'terminada') h.push(t); (V.kids[t.id] || []).forEach(junta); } }; roots.forEach(junta); return h; }
// Plegado de los grupos de estado; se recuerda en este equipo con la clave de cada pestaña
function usePlegados(clave, inicial = {}) { const [plg, setPlg] = useState(() => prefG(clave, inicial)); const tog = k => { const n = { ...plg, [k]: !plg[k] }; setPlg(n); guardaG(clave, n); }; return [plg, tog, n => { setPlg(n); guardaG(clave, n); }]; }
// Un grupo plegable de estado (En proceso, En pausa, Próximo a realizar, Pendientes...)
function GrupoEstado({ k, l, c, n, plg, tog, nota, children }) {
  return <div className={'repg' + (plg[k] ? '' : ' on')} style={{ '--c': c }}>
    <button className="dgrp-t repg-t" onClick={() => tog(k)}><span className="car">{plg[k] ? '▸' : '▾'}</span><b>{l}</b><span className="cnt">{n}</span>{nota}</button>
    {!plg[k] && children}</div>;
}
// Vista por proceso (25/11): un grupo plegable por operación (más "Sin operación"), con el mismo aspecto que la vista por estado.
// render(lista, k) dibuja lo de adentro de cada grupo (la tabla o las tarjetas de cada pestaña).
const opOkS = (S, id) => id && S.operaciones.some(o => o.id === id) ? id : '_';
const colOpS = (S, id) => { const i = S.operaciones.findIndex(o => o.id === id); return id === '_' || i < 0 ? 'var(--mut)' : PP_PAL[i % PP_PAL.length]; };
function GruposProc({ hojas, render, vacio }) {
  const { S } = useApp(); const [plg, tog] = usePlegados('proc-grupos'); const g = {};
  hojas.forEach(t => { const k = opOkS(S, t.operacionId); (g[k] = g[k] || []).push(t); });
  const cols = [...S.operaciones.map(o => [o.id, o.nombre]), ['_', 'Sin operación']].filter(([k]) => g[k]);
  if (!cols.length) return vacio;
  const LBL = Object.fromEntries(SECC.map(x => [x[0], x[1]]));
  return cols.map(([k, nom]) => { const l = g[k], cnt = {}; l.forEach(t => { const c = claseT(t); cnt[c] = (cnt[c] || 0) + 1; });
    return <GrupoEstado key={k} k={k} l={nom} c={colOpS(S, k)} n={l.length} plg={plg} tog={tog} nota={<span className="mut">{fH(l.reduce((a, t) => a + (Number(t.hh) || 0), 0))} plan · {SECC.filter(x => cnt[x[0]]).map(x => `${cnt[x[0]]} ${LBL[x[0]].toLowerCase()}`).join(' · ')}</span>}>
      {render(l, k)}</GrupoEstado>; });
}
// Filtro para una tabla: se ven las piezas del conjunto ids y los padres que las contienen (respetando vis)
const visEn = (V, ids, vis) => { const memo = new Map(); const ok = t => { if (memo.has(t.id)) return memo.get(t.id); const ch = V.kids[t.id] || [];
  const r = (!vis || vis(t)) && (ch.length ? ch.some(ok) : ids.has(t.id)); memo.set(t.id, r); return r; }; return ok; };
// Tercerizada: pieza hecha por un proveedor (capacidad de planta). Cuenta como finalizada pero no ocupa operarios ni horas de planta.
const esTerc = t => !!(t && t.tercerizada && t.estado === 'terminada');
// Finalizada sin día ni hora puntual (datos migrados de una planilla): tilde verde + signo de admiración amarillo
const sinF = t => !!(t && t.sinFecha && t.estado === 'terminada');
const SINF_TXT = 'Finalizada sin día ni hora puntual (dato cargado de una planilla)';
const tercTxt = t => '↗ Tercerizada' + (t.proveedor ? ' · ' + t.proveedor : '') + (t.tercFecha ? ' · vuelve ' + fD(t.tercFecha) : '');
const aviso0 = r => `Finalizada, pero adentro ${r.sin0 === 1 ? 'queda 1 pieza' : `quedan ${r.sin0} piezas`} sin tiempo cargado (0 h) y sin finalizar`;
const Pri = ({ p }) => <span className={'pri pri-' + p}>{p}</span>;
/* lista vacía: ícono + mensaje + pista, en vez de un texto gris suelto */
const ICV = { ok: 'M5 12.5l4.5 4.5L19 7.5', reloj: 'M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z', caja: 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8', gente: 'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.5 3.5 0 010 6.5M18 14c2 .6 3.5 2.8 3.5 6', buscar: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4' };
export function Vacio({ ic = 'caja', t, children, chico }) {
  return <div className={'evacio' + (chico ? ' chico' : '')} role="status"><svg viewBox="0 0 24 24" aria-hidden="true"><path d={ICV[ic] || ICV.caja} /></svg><div><b>{t}</b>{children && <span>{children}</span>}</div></div>;
}
/* pantalla de carga con la forma de la app (barra, indicadores y filas) mientras llegan los datos */
export function Cargando({ txt = 'Cargando datos…' }) {
  return <div className="app esq-app" aria-busy="true" aria-label={txt}>
    <header className="top"><h1><Logo />Producción<span>App</span></h1><nav className="tabs">{[0, 1, 2, 3, 4].map(i => <span key={i} className="esq esq-tab" />)}</nav></header>
    <main><div className="view"><section><span className="esq esq-h" /><div className="kpis">{[0, 1, 2, 3].map(i => <span key={i} className="esq esq-kpi" />)}</div></section>
      <section><span className="esq esq-h" />{[0, 1, 2, 3, 4, 5].map(i => <span key={i} className="esq esq-fila" style={{ width: (96 - i * 7) + '%' }} />)}</section>
      <p className="mut esq-txt">{txt}</p></div></main></div>;
}
function etiqueta(V, t) { const p = t.parentId && V.byId[t.parentId]; return p && !p.partes ? `${t.nombre} · ${p.nombre}` : t.nombre; }
// Enter en una ventana = el botón principal del pie (Guardar, Aplicar, Agregar…): el que tiene data-enter o, si no, el último pri-b / terc-b / warn-b habilitado.
// También desde una lista (por ejemplo el ítem de StockApp en la ficha). No actúa en textos de varias líneas, botones, tablas ni cuando otro control ya usó el Enter.
function enterGuarda(e) {
  if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.defaultPrevented || e.nativeEvent.isComposing) return;
  const el = e.target; if (!el || !el.closest || el.closest('textarea, button, a, table, [contenteditable="true"]')) return;
  const m = e.currentTarget, f = m.querySelector(':scope > footer'); if (!f) return;
  const b = f.querySelector('button[data-enter]:not(:disabled)') || [...f.querySelectorAll('button.pri-b:not(:disabled), button.terc-b:not(:disabled), button.warn-b:not(:disabled)')].pop();
  if (!b) return; e.preventDefault(); e.stopPropagation(); if (el.blur) el.blur(); setTimeout(() => b.click(), 0);   // blur primero: los campos que guardan al salir llegan a guardar
}
function Modal({ title, onClose, children, wide, foot, arriba, footCls }) {
  // arriba: ventana que se abre encima de otra (por ejemplo la ficha sobre el editor); Esc cierra solo esta
  useEffect(() => { const k = e => { if (e.key === 'Escape') { if (arriba) e.stopImmediatePropagation(); onClose(); } }; window.addEventListener('keydown', k, !!arriba); return () => window.removeEventListener('keydown', k, !!arriba); }, [onClose]);
  return <div className={'ovl' + (arriba ? ' ovl-arriba' : '')} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-label={title} onKeyDown={enterGuarda}>
      <header><h2>{title}</h2><button className="btn ghost" onClick={onClose} aria-label="Cerrar">Cerrar</button></header>
      <div className="modal-b">{children}</div>
      {foot && <footer className={footCls}>{foot}</footer>}
    </div>
  </div>;
}
function ConfirmarDlg({ titulo, texto, si = 'Sí', peligro, fecha, onSi, no, onNo, onClose }) {   // no + onNo: segunda opción (por ejemplo "No, solo guardar")
  const [f, setF] = useState(fecha || '');
  useEffect(() => { const k = e => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose(); } }; window.addEventListener('keydown', k, true); return () => window.removeEventListener('keydown', k, true); }, [onClose]);
  return <div className="ovl ovl-conf" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="modal conf" role="alertdialog" aria-label={titulo}>
      <header><h2>{titulo}</h2></header>
      <div className="modal-b"><p>{texto}</p>{fecha !== undefined && <label className="fld">¿Qué día terminó?<input type="date" value={f} max={E.today()} onChange={e => setF(e.target.value)} /></label>}</div>
      <footer><button className="btn canc-b" autoFocus={!!peligro} onClick={onClose}>Cancelar</button>{no && <button className="btn" onClick={() => { onClose(); onNo(); }}>{no}</button>}<button className={'btn ' + (peligro ? 'danger' : 'ok-b')} autoFocus={!peligro} onClick={() => { onClose(); onSi(fecha !== undefined ? (f || E.today()) : undefined); }}>{si}</button></footer>
    </div>
  </div>;
}
function Bar({ v, color }) { return <span className="pbar"><i style={{ width: Math.min(100, Math.max(0, v)) + '%', background: color || 'var(--accent)' }} /></span>; }
const fHM = h => { const tm = Math.round((Number(h) || 0) * 60); return tm < 60 ? `${tm} min` : `${Math.floor(tm / 60)} h${tm % 60 ? ` ${tm % 60} min` : ''}`; };
// importes en dólares (USD), con 2 decimales
const fPlata = n => 'US$ ' + (Number(n) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fFecha = d => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}` : '—';
function HM({ value, onChange, cant, titulo }) { const tm = Math.round((Number(value) || 0) * 60), h = Math.floor(tm / 60), m = tm % 60;
  return <span className="hm"><input type="number" min="0" value={h} aria-label="Horas" onChange={e => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)) + m / 60)} /><small>h</small>
    <input type="number" min="0" max="59" value={m} aria-label="Minutos" onChange={e => onChange(h + Math.min(59, Math.max(0, Math.round(Number(e.target.value) || 0))) / 60)} /><small>min</small><CalcBtn cant={cant} titulo={titulo} onUse={onChange} /></span>; }
/* ===== Calculadora para los campos de horas ===== */
// Evalúa + − × ÷ y paréntesis respetando el orden de las operaciones (sin eval)
function calcular(ex) {
  const s = String(ex).replace(/,/g, '.').replace(/×|x/gi, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/\s/g, ''); let i = 0;
  const num = () => { const m = /^\d*\.?\d+|^\d+\./.exec(s.slice(i)); if (!m) throw 0; i += m[0].length; return Number(m[0]); };
  const fac = () => { if (s[i] === '-') { i++; return -fac(); } if (s[i] === '(') { i++; const v = sum(); if (s[i] === ')') i++; return v; } return num(); };
  const prod = () => { let v = fac(); while (s[i] === '*' || s[i] === '/') { const o = s[i++]; if (i >= s.length) break; const w = fac(); v = o === '*' ? v * w : v / w; } return v; };
  const sum = () => { let v = prod(); while (s[i] === '+' || s[i] === '-') { const o = s[i++]; if (i >= s.length) break; const w = prod(); v = o === '+' ? v + w : v - w; } return v; };
  if (!s) return null; try { const v = sum(); return isFinite(v) ? v : null; } catch (e) { return null; }
}
let calcUnidad = (() => { try { return localStorage.getItem('calc-unidad') || 'h'; } catch (e) { return 'h'; } })();
function Calculadora({ cant, titulo, onUse, onClose }) {
  const [ex, setEx] = useState(''); const [un, setUn] = useState(calcUnidad); const [hist, setHist] = useState(null);
  const v = calcular(ex); const horas = v === null ? null : Math.max(0, un === 'min' ? v / 60 : v);
  const cambiarU = u => { setUn(u); calcUnidad = u; try { localStorage.setItem('calc-unidad', u); } catch (e) { } };
  const tecla = k => setEx(e => { if (k === 'C') return ''; if (k === '⌫') return e.slice(0, -1); if (k === '=') { const r = calcular(e); if (r === null) return e; setHist(e); return String(Math.round(r * 10000) / 10000).replace('.', ','); }
    const op = '+−×÷'.includes(k); if (op && !e && k !== '−') return e; if (op && '+−×÷'.includes(e.slice(-1))) return e.slice(0, -1) + k; if (k === ',' && e.split(/[+−×÷()]/).pop().includes(',')) return e; return e + k; });
  const usar = () => { if (horas === null) return; onUse(Math.round(horas * 10000) / 10000); onClose(); };
  const ref = useRef({}); ref.current = { tecla, usar, onClose };
  useEffect(() => { const k = e => { const r = ref.current; let t = null;
      if (/^[0-9]$/.test(e.key)) t = e.key; else if (e.key === ',' || e.key === '.') t = ','; else if (e.key === '+') t = '+'; else if (e.key === '-') t = '−'; else if (e.key === '*' || e.key === 'x') t = '×'; else if (e.key === '/') t = '÷';
      else if (e.key === '(' || e.key === ')') t = e.key; else if (e.key === 'Backspace') t = '⌫'; else if (e.key === 'Delete') t = 'C'; else if (e.key === '=') t = '=';
      else if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); r.usar(); return; } else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); r.onClose(); return; }
      if (t !== null && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); e.stopImmediatePropagation(); r.tecla(t); } };
    window.addEventListener('keydown', k, true); return () => window.removeEventListener('keydown', k, true); }, []);
  const teclas = ['C', '(', ')', '÷', '7', '8', '9', '×', '4', '5', '6', '−', '1', '2', '3', '+', '0', ',', '⌫', '='];
  return createPortal(<div className="calc-ovl" onMouseDown={e => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }} onClick={e => e.stopPropagation()}>
    <div className="calc" role="dialog" aria-label="Calculadora">
      <div className="calc-h"><b>🧮 Calculadora</b>{titulo && <span className="mut">{titulo}</span>}<button className="btn ghost sm" onClick={onClose} aria-label="Cerrar">✕</button></div>
      <div className="calc-d"><small className="mut">{hist ? hist + ' =' : ' '}</small><div className="calc-ex">{ex || '0'}</div>
        <small className={horas === null && ex ? 'c-bad' : 'mut'}>{horas === null ? (ex ? 'Cuenta incompleta' : 'Escribí la cuenta, por ejemplo 0,75 × ' + (cant || 12)) : '= ' + fHM(horas) + (un === 'min' ? ` (${fN(Math.round(horas * 100) / 100)} h)` : '')}</small></div>
      <div className="calc-u"><span className="mut">La cuenta da</span><div className="seg"><button className={un === 'h' ? 'on' : ''} onClick={() => cambiarU('h')}>horas</button><button className={un === 'min' ? 'on' : ''} onClick={() => cambiarU('min')}>minutos</button></div></div>
      {cant > 1 && <button className="btn sm calc-cant" onClick={() => setEx(e => { const b = e && !'+−×÷('.includes(e.slice(-1)) ? e : e.replace(/[+−×÷]$/, ''); return b ? (/[+−]/.test(b) ? '(' + b + ')' : b) + '×' + cant : e; })} disabled={!ex}>× cantidad de la pieza ({cant})</button>}
      <div className="calc-k">{teclas.map(k => <button key={k} className={'ck' + ('÷×−+'.includes(k) ? ' op' : k === '=' ? ' eq' : k === 'C' || k === '⌫' ? ' fn' : '')} onClick={() => tecla(k)}>{k}</button>)}</div>
      <div className="calc-f"><button className="btn canc-b" onClick={onClose}>Cancelar</button><button className="btn pri-b" disabled={horas === null} onClick={usar}>Usar {horas === null ? '' : fHM(horas)}</button></div>
      <small className="mut calc-tip">Podés usar el teclado: números, + − * /, Enter para usar el resultado, Esc para cerrar.</small>
    </div></div>, document.body);
}
function CalcBtn({ onUse, cant, titulo, className = '' }) {
  const [ab, setAb] = useState(false);
  return <><button type="button" className={'calcb ' + className} title="Calculadora (por ejemplo tiempo unitario × cantidad)" aria-label="Abrir calculadora" onClick={e => { e.preventDefault(); e.stopPropagation(); setAb(true); }}>🧮</button>
    {ab && <Calculadora cant={cant} titulo={titulo} onUse={onUse} onClose={() => setAb(false)} />}</>;
}
function Desvio({ real, plan }) { const d = real - plan; if (!(plan > 0)) return null; return <span className={Math.abs(d) < 0.02 ? 'mut' : d > 0 ? 'c-bad' : 'c-ok'}>{Math.abs(d) < 0.02 ? 'igual a lo proyectado' : `${d > 0 ? '+' : '−'}${fHM(Math.abs(d))} (${d > 0 ? '+' : '−'}${Math.round(Math.abs(d) / plan * 100)}%)`}</span>; }
// Qué puede cambiar cada usuario. Las mismas reglas están también en Firebase (codigo/reglas-produccionapp.txt).
function permiso(p, n, pm) {
  if (pm.admin) return null;
  if (['cfg', 'operarios', 'operaciones', 'feriados', 'usuarios', 'codigos', 'materiales', 'cotizaciones', 'tarifas', 'historico', 'fichas', 'motivosAus'].some(k => p[k] !== n[k])) return 'Solo un administrador puede cambiar la configuración.';
  if (p.asignaciones !== n.asignaciones) return 'Solo un administrador puede cargar horas globales.';
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
const CAMPOS = { nombre: 'pieza', cant: 'cantidad', restan: 'lo que resta', material: 'material', peso: 'peso', tiempoFuera: 'descartada del promedio', prioridad: 'prioridad', estado: 'estado', operacionId: 'operación', ops: 'operarios', turno: 'turno', inicio: 'inicio', hh: 'duración', hhReal: 'horas reales', avance: 'avance', entrega: 'entrega', orden: 'OV/OC', cliente: 'cliente', creada: 'fecha de carga', frenada: 'freno', origen: 'origen', motivo: 'motivo', cantEnv: 'cantidad enviada', fechaEnvio: 'fecha de envío', remito: 'N° de remito', destinatario: 'destinatario', remitoOk: 'remito verificado' };
const FER2026 = [['01-01', 'Año Nuevo'], ['02-16', 'Carnaval'], ['02-17', 'Carnaval'], ['03-24', 'Día de la Memoria'], ['04-02', 'Veteranos y Caídos en Malvinas'], ['04-03', 'Viernes Santo'], ['05-01', 'Día del Trabajador'], ['05-25', 'Revolución de Mayo'], ['06-15', 'Paso a la Inmortalidad de Güemes'], ['06-20', 'Paso a la Inmortalidad de Belgrano'], ['07-09', 'Día de la Independencia'], ['08-17', 'Paso a la Inmortalidad de San Martín'], ['10-12', 'Respeto a la Diversidad Cultural'], ['11-23', 'Soberanía Nacional'], ['12-08', 'Inmaculada Concepción'], ['12-25', 'Navidad']];
const NOLAB2026 = [['03-23', 'Día no laborable'], ['07-10', 'Día no laborable'], ['12-07', 'Día no laborable']];
function describir(p, n) {
  const out = []; let k = '';
  const val = (S, f, v) => f === 'turno' ? ({ normal: 'normal', extra: 'horas extra', ambos: 'normal + extra' }[v] || v) : f === 'ops' ? ((v || []).map(o => opName(S, o)).join(', ') || 'sin asignar') : f === 'operacionId' ? operName(S, v) : f === 'inicio' ? fDT(v) : f === 'avance' ? `${Math.round(v || 0)}%` : f === 'frenada' ? (v ? `frenada (${v.motivo})` : 'sin frenar') : (v === '' || v == null ? '—' : String(v));
  const dif = (o, t) => Object.keys(CAMPOS).filter(f => JSON.stringify(o[f]) !== JSON.stringify(t[f]));
  if (p.tareas !== n.tareas) { const old = Object.fromEntries(p.tareas.map(t => [t.id, t])), neu = new Set(n.tareas.map(t => t.id));
    const add = n.tareas.filter(t => !old[t.id]), del = p.tareas.filter(t => !neu.has(t.id)), chg = n.tareas.filter(t => old[t.id] && old[t.id] !== t && dif(old[t.id], t).length);
    const lista = l => l.length > 3 ? `${l.length} tareas` : l.map(t => `"${t.nombre}"`).join(', ');
    if (add.length) out.push('Agregó ' + lista(add)); if (del.length) out.push('Borró ' + lista(del));
    if (chg.length) out.push(chg.slice(0, 3).map(t => `"${t.nombre}": ${dif(old[t.id], t).map(f => `${CAMPOS[f]} ${val(p, f, old[t.id][f])} → ${val(n, f, t[f])}`).join(', ')}`).join(' · ') + (chg.length > 3 ? ` · y ${chg.length - 3} tareas más` : ''));
    if (out.length) k = 't:' + [...add, ...del, ...chg].slice(0, 4).map(t => t.id).join() + ':' + (chg[0] ? dif(old[chg[0].id], chg[0]).join() : ''); }
  [['proyectos', 'Cambió proyectos'], ['asignaciones', 'Cambió cargas globales de horas'], ['extras', 'Cambió horas extra'], ['extraModo', 'Cambió el uso de una extra'], ['ausencias', 'Cambió ausencias'], ['motivosAus', 'Cambió motivos de ausencia'], ['operarios', 'Cambió operarios'], ['operaciones', 'Cambió operaciones'], ['codigos', 'Cambió códigos de operación'], ['materiales', 'Cambió materiales'], ['tarifas', 'Cambió tarifas de mano de obra'], ['historico', 'Cambió el historial importado'], ['fichas', 'Cambió la ficha de una pieza (material y peso)'], ['cotizaciones', 'Cambió cotizaciones'], ['feriados', 'Cambió feriados'], ['usuarios', 'Cambió usuarios o permisos'], ['cfg', 'Cambió horarios o apariencia']]
    .forEach(([key, txt]) => { if (p[key] !== n[key] && !(key === 'extraModo' && p.extras !== n.extras)) { out.push(txt); k += '|' + key; } });
  return out.length ? { k, txt: out.join(' · ') } : null;
}
function espera(S, V, t) { const pr = E.predsDe(S, t); if (t.estado === 'terminada' || !pr.length) return null; let best = null;
  pr.forEach(pid => { const p = V.byId[pid], r = p && V.D[pid]; if (!p) return; if (r.estado === 'terminada') { const f = E.finTerc(p); if (f && f > E.nowDT() && (!best || f > (best.fin || ''))) best = { nombre: p.nombre + ' (tercerizada, vuelve ' + fD(p.tercFecha) + ')', fin: f }; return; } if (!best || (r.fin || '') > (best.fin || '')) best = { nombre: p.nombre, fin: r.fin }; }); return best; }
function juntar(up, ui, op, nombre) { let n = 0; up(s => { const r = E.compactar(s, op); n = r.n; return r.n ? r.S : s; });
  ui.toast(n ? `${n} ${n === 1 ? 'tarea adelantada' : 'tareas adelantadas'}${nombre ? ' de ' + nombre : ''}. Quedan marcadas en el cartel de Producción.` : 'No hay huecos para cerrar: las tareas ya están juntas o esperan a otra.'); }
// Avisa cómo se movió la cadena del operario al cerrar una tarea
const avisoCadena = r => r && r.n ? (r.dir < 0
  ? `Terminó antes de lo planificado: ${r.n === 1 ? 'la tarea que venía detrás se adelantó' : r.n + ' tareas que venían detrás se adelantaron'}. Quedan marcadas en el cartel de Producción.`
  : `Terminó después de lo planificado: ${r.n === 1 ? 'la tarea que venía detrás se corrió' : r.n + ' tareas que venían detrás se corrieron'}. Quedan marcadas en el cartel de Producción.`) : '';
// Finalizar una tarea y que la cadena siga (vivo = desde el Taller, en el momento)
function cerrarTarea(up, ui, id, hh, vivo, msg) { let r = null;
  up(s => { const t = s.tareas.find(x => x.id === id); if (!t) return s; const l = E.llevado(s, t); r = E.finalizarYEncadenar(s, id, hh !== undefined ? hh : (l > 0 ? l : t.hhReal), vivo); return r.S; });
  const a = avisoCadena(r); if (a || msg) ui.toast(a || msg); }
// ---- Frenar y retomar (trabajos que se paran por días) ----
const diasFrenada = t => Math.max(0, E.diffDays((t.frenada.desde || '').slice(0, 10), E.today()));
const txtFreno = t => { const f = t.frenada, d = diasFrenada(t); return `${f.motivo}${f.hasta ? ` · hasta el ${fD(f.hasta)}${f.hastaHora ? ' ' + f.hastaHora : ''}` : ' · sin fecha'} · ${d === 0 ? 'desde hoy' : `hace ${d} ${d === 1 ? 'día' : 'días'}`}`; };
function FrenoTag({ t }) { if (!E.estaFrenada(t)) return null;
  return <><span className="tag fren">⏸ Frenada · {txtFreno(t)}</span>{t.frenada.nota && <span className="fren-nota">{t.frenada.nota}</span>}</>; }
// Pausar o frenar: "sigue en la cola" es la pausa de siempre; frenar deja lo que falta afuera del calendario (o desde una fecha)
function TercerizarDlg({ id, ids, onClose }) {
  const { S, up, ui } = useApp();
  const lista = (ids || [id]).filter(i => { const x = S.tareas.find(y => y.id === i); return x && x.estado !== 'terminada' && !S.tareas.some(c => c.parentId === i); });   // solo piezas sin hijos y sin finalizar
  const multi = lista.length > 1, t = S.tareas.find(x => x.id === lista[0]);
  const [prov, setProv] = useState(''); const [fecha, setFecha] = useState(''); const [nota, setNota] = useState(''); const [q, setQ] = useState(() => String(Math.max(1, Number(t && t.cant) || 1)));
  if (!t) return null;
  const total = Math.max(1, Number(t.cant) || 1), elige = !multi && total > 1 && !(Number(t.cantEnv) > 0), c = elige ? Math.min(total, Math.max(1, Math.floor(Number(q)) || total)) : total;
  const ok = () => { let n = 0; up(s => { let S2 = s; lista.forEach(i => { const r = E.tercerizar(S2, i, { proveedor: prov, fecha, nota, cant: multi ? undefined : c }); S2 = r.S; n += r.n; }); return S2; });
    ui.toast((multi ? `${lista.length} piezas tercerizadas` : c < total ? `${c} de ${total} unidades tercerizadas` : 'Tercerizada') + (prov.trim() ? ' en ' + prov.trim() : '') + (fecha ? ` · vuelve el ${fD(fecha)}` : '') + (n ? `. ${n === 1 ? 'La tarea que venía detrás se adelantó' : n + ' tareas que venían detrás se adelantaron'}.` : '.')); onClose(); };
  return createPortal(<Modal title={multi ? `Tercerizar · ${lista.length} piezas` : 'Tercerizar · ' + t.nombre} onClose={onClose} foot={<><span className="sp" /><button className="btn canc-b" onClick={onClose}>Cancelar</button><button className="btn terc-b" onClick={ok}>↗ Tercerizar{multi ? ` (${lista.length})` : ''}</button></>}>
    {multi && <p className="mut">{lista.map(i => S.tareas.find(x => x.id === i).nombre).join(' · ')}</p>}
    {elige && <label className="fld">Cantidad a tercerizar (de {total})<input type="number" min="1" max={total} step="1" value={q} onChange={e => setQ(e.target.value)} />{c < total && <small className="hint">Se divide la pieza: {c} {c === 1 ? 'unidad queda' : 'unidades quedan'} tercerizadas y {total - c} siguen en planta (con las horas repartidas en proporción).</small>}</label>}
    <label className="fld">Proveedor (opcional)<input type="text" value={prov} placeholder="Ej.: Plegados Rossi" onChange={e => setProv(e.target.value)} /></label>
    <label className="fld">Vuelve el (opcional)<input type="date" value={fecha} onChange={e => setFecha(e.target.value)} /></label>
    <label className="fld">Notas (opcional)<textarea rows="2" value={nota} placeholder="Ej.: se retira el lunes con el plano rev. B" onChange={e => setNota(e.target.value)} /></label>
    <p className="mut">{multi ? 'Las piezas quedan' : 'La pieza queda'} como finalizada{multi ? 's' : ''} y tercerizada{multi ? 's' : ''}: no ocupan operarios ni horas de planta. Si cargás la fecha de regreso, las tareas que dependen de {multi ? 'ellas' : 'ella'} (Predecesoras) esperan hasta ese día. Después podés usar "Volver a planta" en cada una.</p>
  </Modal>, document.body);
}
// Si algún operario de la tarea ya tiene otra en curso, avisa antes de pausarla (la pausa deja lo hecho registrado y lo que falta sigue en la cola)
function avisarOcupado(S, ui, otras, ops, nombre, onSi) {
  const quien = [...new Set(otras.flatMap(x => x.ops.filter(o => ops.includes(o))))].map(o => opName(S, o)).join(' y ');
  const cuales = otras.map(x => `"${x.nombre}"`).join(' y ');
  ui.confirmar({ titulo: '¿Pausar la tarea en curso?', texto: `${quien} ya está con ${cuales} en curso. Si seguís, ${otras.length === 1 ? 'esa tarea se pausa' : 'esas tareas se pausan'} (lo hecho queda registrado y lo que falta sigue en la cola) y arranca "${nombre}".`, si: 'Sí, pausar y arrancar', onSi });
}
// Alguno de los operarios no trabaja el día de inicio (ausencia, "Activo desde" o ocasional que no viene): la tarea no avanzaría ese día
function faltaDia(S, x) {
  if (!x.inicio || !x.ops.length) return null; const d = x.inicio.slice(0, 10);
  const ni = E.normStart(S, x.inicio, x.turno, x.ops); if (ni.slice(0, 10) === d) return null;
  const quien = x.ops.map(o => ({ o, a: E.ausenciaDe(S, o, d) })).filter(z => z.a);
  return quien.length && quien.length < x.ops.length ? { d, ni, quien } : quien.length ? { d, ni, quien, todos: true } : null;
}
const txtAus = (S, f) => f.quien.map(z => `${opName(S, z.o)} (${z.a.motivo || 'ausente'})`).join(', ');
function avisarAusente(S, ui, f, t, onSacar, onIgual) {
  const varios = f.quien.length > 1, nom = f.quien.map(z => opName(S, z.o)).join(' y ');
  ui.confirmar({ titulo: varios ? 'Hay operarios que no estaban ese día' : 'Un operario no estaba ese día',
    texto: `${txtAus(S, f)} no ${varios ? 'figuran' : 'figura'} trabajando el ${fDia(f.d)}. Con un operario ausente la tarea no avanza ese día, así que "${t.nombre.trim()}" se correría al ${fDT(f.ni)}. Si no trabajó en esta tarea, sacalo; si sí estuvo, corregí su ausencia, "Activo desde" u "Ocasional" en Configuración.`,
    ...(f.todos ? { si: 'Guardar igual', onSi: onIgual } : { si: `Sacar a ${nom} y guardar`, onSi: onSacar, no: `Guardar igual (se corre al ${fDia(f.ni.slice(0, 10))})`, onNo: onIgual }) });
}
// La tarea se puso en medio de otra que el operario tenía en curso: pausarla a la hora de inicio de la nueva (o guardar sin tocarla)
function avisarInterrumpe(S, ui, otras, t, retoma, onSi, onNo) {
  const quien = [...new Set(otras.flatMap(x => x.ops.filter(o => t.ops.includes(o))))].map(o => opName(S, o)).join(' y ');
  const cuales = otras.map(x => `"${x.nombre}"`).join(' y '), una = otras.length === 1;
  ui.confirmar({ titulo: `¿Pausar ${una ? 'la tarea' : 'las tareas'} en curso?`,
    texto: `${quien} ya estaba con ${cuales} en curso a las ${fDT(t.inicio)}. Si la pausás a esa hora para meter "${t.nombre.trim()}", lo hecho hasta ahí queda registrado y lo que falta ${retoma ? `sigue en curso desde el fin real (${fDT(retoma)})` : `sigue detrás de "${t.nombre.trim()}"`}.`,
    si: `Sí, pausar a las ${t.inicio.slice(11, 16)}`, onSi, no: 'No, solo guardar', onNo });
}
// Al soltar una tarea en la Semana sobre un día en que el operario tenía otra en curso: meterla a una hora y pausar la otra, o ponerla al final del día
function MeterDlg({ id, op, d, turno, from, onClose }) {
  const { S, up, ui } = useApp(); const t = S.tareas.find(x => x.id === id);
  const ahora = E.nowDT(), hoy = E.today();
  const [hora, setHora] = useState(() => { if (d === hoy) return ahora.slice(11, 16); const m = E.schedAt(S, d).in; return `${E.pad(Math.floor(m / 60))}:${E.pad(m % 60)}`; });
  if (!t) return null;
  let nOps = t.ops.filter(o => o !== from); if (!nOps.includes(op)) nOps = [...nOps, op];
  const tt = { ...t, ops: nOps, turno }, ini = hora ? d + 'T' + hora : '';
  const futuro = !!ini && ini > ahora, lst = ini && !futuro ? E.interrumpidas(S, tt, ini) : [];
  const enc = E.interrumpidas(S, tt, d === hoy ? ahora : d + 'T23:59');   // las que estaban en curso ese día (para el texto)
  const fin = t.estado === 'terminada' && !t.sinFecha && t.finReal ? t.finReal : null, finMal = !!fin && !!ini && fin <= ini;
  const retoma = fin && !finMal && fin <= ahora ? fin : null;
  const alFinal = () => { up(s => E.assignTo(s, id, op, d, turno, from)); onClose(); };
  const meter = () => {
    if (!ini || futuro) return;
    up(s => { const s1 = E.interrumpir(s, tt, ini, retoma); const patch = { ops: nOps, turno, inicio: ini };
      if (fin && !finMal) { patch.realFin = true; if (!(Number(t.hhReal) > 0)) patch.hhReal = Math.round(E.workBetween(s1, ini, fin, turno, nOps) * nOps.length * 100) / 100; }
      return E.patchTask(s1, id, patch, true); });
    ui.toast(lst.length ? `"${t.nombre}" entra a las ${hora}; ${lst.map(x => `"${x.nombre}"`).join(' y ')} quedó pausada a esa hora` : `"${t.nombre}" entra a las ${hora}`); onClose();
  };
  return <Modal title="¿Meterla en medio?" onClose={onClose} foot={<><button className="btn canc-b" onClick={onClose}>Cancelar</button><button className="btn" onClick={alFinal}>Ponerla al final del día</button><span className="sp" /><button className="btn pri-b" disabled={!ini || futuro} onClick={meter}>{lst.length ? `Pausar y meterla a las ${hora}` : `Meterla a las ${hora || '—'}`}</button></>}>
    <p><b>{opName(S, op)}</b> tenía en curso {enc.map(x => <span key={x.id}><b>{x.nombre}</b> (desde {fDT(x.crono.desde)}) </span>)}el {fDia(d)}.</p>
    <label className="fld">¿A qué hora empezó "{t.nombre}"?<input type="time" value={hora} onChange={e => setHora(e.target.value)} /></label>
    {futuro ? <small className="hint bad">Para pausar lo que está en curso, la hora tiene que ser ahora o antes.</small>
      : lst.length ? <p className="note">Lo hecho hasta las {hora} queda registrado y lo que falta {retoma ? `sigue en curso desde el fin real (${fDT(retoma)})` : `sigue detrás de "${t.nombre}"`}.</p>
      : ini ? <p className="note">A esa hora no había nada en curso: la tarea se ubica a las {hora} sin pausar nada.</p> : null}
    {ini && (f => f && <small className="hint bad">{txtAus(S, f)} no figura trabajando el {fDia(d)}: la tarea se correría al {fDT(f.ni)}. Abrila en el editor para sacarlo o corregí su ausencia en Configuración.</small>)(faltaDia(S, { ...tt, inicio: ini }))}
    {finMal && <small className="hint bad">El fin real ({fDT(fin)}) queda antes de ese inicio: corregilo después en el editor.</small>}
  </Modal>;
}
const iniciarConAviso = (S, up, ui, id) => { const t = S.tareas.find(x => x.id === id); if (!t) return;
  const otras = E.enCurso(S, t.ops, id), go = () => up(s => E.iniciar(s, id));
  if (otras.length) avisarOcupado(S, ui, otras, t.ops, t.nombre, go); else go(); };
function FrenarDlg({ id, pausa, onClose }) {
  const { S, up, ui } = useApp(); const t = S.tareas.find(x => x.id === id);
  const [modo, setModo] = useState(pausa ? '' : 'sin'); const [motivo, setMotivo] = useState(''); const [nota, setNota] = useState(''); const [hasta, setHasta] = useState(() => { let d = E.addDays(E.today(), 1), g = 0; while (!E.isWork(S, d) && g++ < 14) d = E.addDays(d, 1); return d; });
  const [horaH, setHoraH] = useState('');   // hora desde la que se retoma (vacía = al empezar la jornada)
  const [ultDia, setUltDia] = useState(() => E.today());   // último día trabajado: hoy = se frena ahora; antes = a la hora elegida de ese día
  const [hora, setHora] = useState(() => E.nowDT().slice(11, 16));   // hora en que se cierra lo hecho
  if (!t) return null;
  const ahoraDT = E.nowDT(), hoyD = E.today(), ini0 = (t.crono && t.crono.desde) || t.inicio || '';   // inicio registrado en la app (la app lo puede haber movido: no limita la fecha)
  const finJ = ultDia < hoyD ? E.finJornada(S, t, ultDia) : null;   // fin de la jornada de ese día (null si no se trabaja)
  const cuando = ultDia && hora ? ultDia + 'T' + hora : null;   // fecha y hora en que se cierra lo hecho
  const elegirDia = d => { setUltDia(d); setHora(d >= hoyD ? E.nowDT().slice(11, 16) : (E.finJornada(S, t, d) || '').slice(11, 16)); };   // por defecto: ahora, o el cierre de la jornada de ese día
  const diaAnt = () => { let d = E.addDays(hoyD, -1), g = 0; while (!E.isWork(S, d) && g++ < 14) d = E.addDays(d, -1); return d; };
  const valida = () => {
    if (ultDia > hoyD) { ui.toast('El último día trabajado no puede ser posterior a hoy'); return false; }
    if (ultDia < hoyD && !finJ) { ui.toast(`El ${fDia(ultDia)} no es día de trabajo: elegí el último día que se trabajó`); return false; }
    if (!cuando) { ui.toast('Elegí la hora'); return false; }
    if (cuando > ahoraDT) { ui.toast('La hora no puede ser posterior a ahora'); return false; }
    return true; };
  const cola = () => { if (!valida()) return; up(s => E.partir(s, id, { corte: cuando })); ui.toast(`En pausa desde ${fDT(cuando)}: lo que falta sigue en la cola`); onClose(); };
  const ok = () => { if (!motivo) { ui.toast('Elegí el motivo'); return; } if (!valida()) return; const h = modo === 'fecha' ? hasta : null; let n = 0;
    up(s => { const r = E.frenar(s, id, { motivo, nota, hasta: h, desde: cuando, horaHasta: h ? horaH : '' }); n = r.n; return r.S; });
    ui.toast((h ? `Frenada hasta el ${fD(h)}${horaH ? ' ' + horaH : ''}` : 'Frenada sin fecha: no ocupa el calendario') + (n ? `. ${n === 1 ? 'La tarea que venía detrás se adelantó' : n + ' tareas que venían detrás se adelantaron'}.` : '.')); onClose(); };
  return createPortal(<Modal title={(pausa ? 'Pausar · ' : 'Frenar · ') + t.nombre} onClose={onClose} foot={modo ? <><span className="sp" /><button className="btn canc-b" onClick={onClose}>Cancelar</button><button className="btn warn-b" onClick={ok}>Frenar</button></> : null}>
    <div className="fld"><span>Último día y hora trabajados</span><div className="row">
      <input type="date" value={ultDia} max={hoyD} onChange={e => elegirDia(e.target.value)} />
      <input type="time" value={hora} max={ultDia === hoyD ? ahoraDT.slice(11, 16) : undefined} aria-label="Hora" onChange={e => setHora(e.target.value)} />
      <button type="button" className={'btn sm' + (ultDia === hoyD && hora === ahoraDT.slice(11, 16) ? ' pri-b' : '')} onClick={() => elegirDia(hoyD)}>Hoy (ahora)</button>
      <button type="button" className={'btn sm' + (ultDia === diaAnt() ? ' pri-b' : '')} onClick={() => elegirDia(diaAnt())}>{fDia(diaAnt())}</button></div>
      {cuando && <small className={'hint' + (ultDia < hoyD && !finJ ? ' bad' : '')}>{ultDia < hoyD && !finJ ? 'Ese día no se trabaja: elegí otro.' : `Lo hecho se cierra el ${fDT(cuando)}.${ultDia < hoyD ? ' Los días siguientes no cuentan como trabajados.' : ''}`}</small>}
      {cuando && ini0 && ini0 > cuando && <small className="hint">En la app esta tarea figura desde el {fDT(ini0)}: lo trabajado antes no quedó registrado acá, y lo registrado desde esa fecha no se cuenta. Si una parte anterior ya cerró incluyendo el día de la ausencia, corregí sus horas reales en el editor de esa parte.</small>}</div>
    <div className="fld"><span>¿Cómo sigue?</span><div className="frmodos">
      {pausa && <button type="button" className="frmodo" onClick={cola}><b>Sigue en la cola</b><small>Pausa corta: lo que falta queda a continuación, como siempre</small></button>}
      <button type="button" className={'frmodo' + (modo === 'fecha' ? ' on' : '')} onClick={() => setModo('fecha')}><b>Frenada hasta una fecha</b><small>Lo que falta se programa desde ese día</small></button>
      <button type="button" className={'frmodo' + (modo === 'sin' ? ' on' : '')} onClick={() => setModo('sin')}><b>Frenada sin fecha</b><small>No ocupa el calendario hasta que la retomes</small></button></div></div>
    {modo && <>
      {modo === 'fecha' && <label className="fld">Se retoma desde<span className="row"><input type="date" value={hasta} min={E.today()} onChange={e => setHasta(e.target.value)} /><input type="time" value={horaH} aria-label="Hora desde la que se retoma" onChange={e => setHoraH(e.target.value)} /></span><small className="hint">La hora es opcional: sin hora, se programa desde que empieza la jornada de ese día.</small></label>}
      <div className="fld"><span>Motivo</span><div className="togs">{E.MOTIVOS_FRENO.map(m => <button key={m} type="button" className={'togb' + (motivo === m ? ' on' : '')} onClick={() => setMotivo(m)}>{m}</button>)}</div></div>
      <label className="fld">Notas<textarea rows="2" value={nota} placeholder="Ej.: falta chapa inox 3 mm, llega el jueves" onChange={e => setNota(e.target.value)} /></label>
      <p className="mut">Lo hecho hasta ahora queda cerrado con su tiempo. Lo que falta queda como una parte nueva de la misma pieza: la pieza suma las horas de todas sus partes para el promedio y el costo.</p></>}
  </Modal>, document.body);
}
// Corte de material (24/11): suma una parte "(corte)" a la misma pieza, sin código nuevo (E.agregarCorte)
function CorteDlg({ id, onClose }) {
  const { S, up, ui } = useApp();
  const t0 = S.tareas.find(x => x.id === id), t = t0 && t0.parte ? S.tareas.find(x => x.id === t0.parentId) : t0;
  const sug = t ? E.corteSug(S, t) : null;
  const [ops, setOps] = useState([]); const [hh, setHh] = useState(() => sug ? sug.hh : 0.5);
  const [hecho, setHecho] = useState(false); const [dia, setDia] = useState(E.today()); const [hora, setHora] = useState('');
  const abierta = t && (t.partes ? S.tareas.some(x => x.parentId === t.id && !x.corte && x.estado !== 'terminada' && Number(x.hh) > hh) : t.estado !== 'terminada' && Number(t.hh) > hh);
  const [restar, setRestar] = useState(true);
  if (!t || !E.puedeCorte(S, t)) return null;
  const base = E.nomBase(t.nombre), cant = Math.max(1, Number(t.cant) || 1);
  const tog = o => setOps(p => p.includes(o) ? p.filter(x => x !== o) : [...p, o]);
  const ok = () => {
    if (!(hh > 0)) { ui.toast('Poné las horas del corte'); return; }
    if (hecho && !ops.length) { ui.toast('Elegí quién hizo el corte'); return; }
    if (hecho && !dia) { ui.toast('Elegí el día del corte'); return; }
    const inicio = dia && (hecho || hora || dia !== E.today()) ? dia + 'T' + (hora || '00:00') : null;
    let ini = null; up(s => { const s2 = E.agregarCorte(s, t.id, { ops, hh, inicio, hecho, restar: restar && !!abierta }); const c = s2.tareas.find(x => x.corte && x.parentId === t.id && !s.tareas.some(y => y.id === x.id)); ini = c && c.inicio; return s2; });
    ui.toast(hecho ? `Corte cargado: ${fHM(hh)} de ${ops.map(o => opName(S, o)).join(', ')}` : ini ? `Corte agregado: empieza ${fDT(ini)}` : 'Corte agregado sin operario: queda en "Tareas para darle"'); onClose(); };
  return createPortal(<Modal title={'✂ Agregar corte · ' + base} onClose={onClose} foot={<><span className="sp" /><button className="btn canc-b" onClick={onClose}>Cancelar</button><button className="btn pri-b" onClick={ok}>✂ Agregar corte</button></>}>
    <p className="mut">El corte queda como una parte más de esta pieza (mismo código, sin codificar nada nuevo), con su operario y su tiempo. Las horas de la pieza son la suma del corte y el resto del trabajo. No hace falta que el corte termine para que arranque el torno.</p>
    <div className="fld"><span>¿Ya se hizo?</span><div className="seg"><button type="button" className={!hecho ? 'on' : ''} onClick={() => setHecho(false)}>Por hacer</button><button type="button" className={hecho ? 'on' : ''} onClick={() => setHecho(true)}>Ya se hizo</button></div></div>
    <div className="fld"><span>¿Quién corta?{!hecho && <small className="mut"> (opcional)</small>}</span><div className="togs">{S.operarios.filter(o => o.activo || ops.includes(o.id)).map(o => <button key={o.id} type="button" className={'togb' + (ops.includes(o.id) ? ' on' : '')} onClick={() => tog(o.id)}>{o.nombre}</button>)}</div></div>
    <div className="fld"><span>{hecho ? 'Horas reales del corte (horas-hombre)' : 'Horas planificadas del corte (horas-hombre)'}</span><HM value={hh} onChange={setHh} cant={cant} titulo="Horas del corte" />
      <small className="hint">{sug ? `Promedio de ${sug.n} ${sug.n === 1 ? 'corte' : 'cortes'} anteriores de esta pieza: ${fHM(sug.porUnidad)} por unidad × ${fN(cant)} = ${fHM(sug.hh)}.` : `Para ${fN(cant)} ${cant === 1 ? 'unidad' : 'unidades'}. Todavía no hay cortes anteriores de esta pieza.`}</small></div>
    {(hecho || ops.length > 0) && <label className="fld">{hecho ? 'Día del corte' : 'Desde (opcional)'}<span className="row"><input type="date" value={dia} max={hecho ? E.today() : undefined} onChange={e => setDia(e.target.value)} /><input type="time" value={hora} aria-label="Hora" onChange={e => setHora(e.target.value)} /></span>
      <small className="hint">{hecho ? 'La hora es opcional: sin hora, desde que empieza la jornada.' : 'Si lo dejás en hoy y sin hora, se pega detrás de lo que el operario tiene abierto. Podés poner un día anterior para cortar antes de que arranque el torno.'}</small></label>}
    {abierta && <label className="chk"><input type="checkbox" checked={restar} onChange={e => setRestar(e.target.checked)} /> Restar estas horas de lo planificado de la pieza (si su tiempo ya incluía el corte, como el tiempo estándar del historial)</label>}
  </Modal>, document.body);
}
function RetomarDlg({ id, onClose }) {
  const { S, up, ui } = useApp(); const t = S.tareas.find(x => x.id === id);
  const [ops, setOps] = useState(t ? t.ops : []); const [desde, setDesde] = useState(() => t && t.frenada && t.frenada.hasta > E.today() ? t.frenada.hasta : E.today()); const [ya, setYa] = useState(false);
  const [hora, setHora] = useState(() => t && t.frenada && (t.frenada.hasta > E.today() || (t.frenada.hasta === E.today() && (t.frenada.hastaHora || '') > E.nowDT().slice(11, 16))) ? (t.frenada.hastaHora || '') : '');   // vacía = desde que empieza la jornada
  const [pisar, setPisar] = useState(false);   // pausar la tarea que el operario tiene en curso y arrancar esta ahora
  const [programar, setProgramar] = useState(false);   // con hora pasada: programarla en la cola en vez de contarla como ya retomada
  if (!t) return null;
  const tog = o => setOps(p => p.includes(o) ? p.filter(x => x !== o) : [...p, o]);
  const ahoraDT = E.nowDT(), hoyD = E.today(), minD = t.frenada && t.frenada.desde ? t.frenada.desde.slice(0, 10) : hoyD;
  const cuandoDT = desde && hora ? desde + 'T' + hora : null;   // fecha y hora elegidas
  const retro = !!cuandoDT && cuandoDT < ahoraDT, yaRetomo = retro && !programar;   // hora pasada: ya estaba trabajando desde ahí
  const otras = ops.length ? E.enCurso(S, ops, id) : [], pisa = pisar && !yaRetomo && otras.length > 0;
  const quien = [...new Set(otras.flatMap(x => x.ops.filter(o => ops.includes(o))))].map(o => opName(S, o)).join(' y '), cuales = otras.map(x => `"${x.nombre}"`).join(' y ');
  const ok = () => {
    if (yaRetomo) {
      if (!ops.length) { ui.toast('Elegí quiénes la retoman'); return; }
      if (t.frenada && t.frenada.desde && cuandoDT < t.frenada.desde) { ui.toast(`No puede ser antes de que se frenó (${fDT(t.frenada.desde)})`); return; }
      if (E.workBetween(S, cuandoDT, ahoraDT, t.turno, ops) <= 0) { ui.toast('Entre esa hora y ahora no hay horas de trabajo (jornada, ausencia o feriado): elegí otra'); return; }
      up(s => E.iniciar(E.retomar(s, id, { ops, retomada: cuandoDT }), id, { desde: cuandoDT }));
      ui.toast(`Retomada desde ${fDT(cuandoDT)}: lleva ${fHM(E.workBetween(S, cuandoDT, ahoraDT, t.turno, ops) * Math.max(1, ops.length))} trabajadas${otras.length ? `. ${otras.length === 1 ? 'Se pausó' : 'Se pausaron'} ${cuales} a esa hora` : ''}`); onClose(); return; }
    if (pisa) { up(s => E.iniciar(E.retomar(s, id, { ops }), id)); ui.toast(`Retomada y en curso. ${otras.length === 1 ? 'Se pausó' : 'Se pausaron'} ${cuales}: lo que falta sigue en la cola`); onClose(); return; }
    let ini = null; up(s => { const s2 = E.retomar(s, id, { ops, desde, ya, hora }); ini = (s2.tareas.find(x => x.id === id) || {}).inicio; return s2; });
    ui.toast(ini ? `Retomada: empieza ${fDT(ini)}` : 'Retomada sin operario: queda en "Tareas para darle"'); onClose(); };
  return createPortal(<Modal title={'Retomar · ' + t.nombre} onClose={onClose} foot={<><span className="sp" /><button className="btn canc-b" onClick={onClose}>Cancelar</button><button className="btn pri-b" onClick={ok}>{yaRetomo ? 'Retomar desde esa hora' : pisa ? 'Pausar y retomar ahora' : 'Retomar'}</button></>}>
    {t.frenada && <p className="note">⏸ {txtFreno(t)}{t.frenada.nota ? ` · ${t.frenada.nota}` : ''}</p>}
    <p className="mut">Faltan {fHM(t.hh)} (horas-hombre).</p>
    <div className="fld"><span>¿Quiénes la retoman?</span><div className="togs">{S.operarios.filter(o => o.activo || ops.includes(o.id)).map(o => <button key={o.id} type="button" className={'togb' + (ops.includes(o.id) ? ' on' : '')} onClick={() => tog(o.id)}>{o.nombre}</button>)}</div></div>
    {otras.length > 0 && !yaRetomo && <div className="fld"><p className="note">⚠ {quien} ya está con {cuales} en curso.</p>
      <div className="seg"><button type="button" className={!pisar ? 'on' : ''} onClick={() => setPisar(false)}>Que siga con esa (esta va a la cola)</button><button type="button" className={pisar ? 'on' : ''} onClick={() => { setPisar(true); setDesde(hoyD); setHora(''); }}>Pausar esa y arrancar esta ahora</button></div>
      {pisa && <small className="hint">{otras.length === 1 ? 'La que está en curso se pausa' : 'Las que están en curso se pausan'}: lo hecho queda registrado y lo que falta sigue en la cola.</small>}</div>}
    {!pisa && <>
      <label className="fld">Desde<span className="row"><input type="date" value={desde} min={minD} onChange={e => setDesde(e.target.value)} /><input type="time" value={hora} aria-label="Hora desde la que se retoma" onChange={e => setHora(e.target.value)} /></span><small className="hint">La hora es opcional: sin hora, empieza al comenzar la jornada (o ahora, si es hoy). Si es una hora que ya pasó, podés contarla como ya retomada.</small></label>
      {retro && <div className="fld"><div className="seg"><button type="button" className={yaRetomo ? 'on' : ''} onClick={() => setProgramar(false)}>Ya retomó a esa hora</button><button type="button" className={!yaRetomo ? 'on' : ''} onClick={() => setProgramar(true)}>Solo programarla (desde ahora)</button></div>
        {yaRetomo ? <small className="hint">Queda en proceso con el cronómetro corriendo desde el {fDT(cuandoDT)}: las horas hasta ahora cuentan como trabajadas (según la jornada){otras.length ? `, y se ${otras.length === 1 ? 'pausa' : 'pausan'} ${cuales} a esa hora (${quien})` : ''}.</small>
          : <small className="hint">No se cuentan horas trabajadas: se programa desde ahora en la cola.</small>}</div>}
      {!yaRetomo && <div className="seg"><button type="button" className={!ya ? 'on' : ''} onClick={() => setYa(false)}>En el primer hueco libre</button><button type="button" className={ya ? 'on' : ''} onClick={() => setYa(true)}>Arranca ese día (corre lo que tengan)</button></div>}</>}
  </Modal>, document.body);
}
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
// Calendario general de cargas: mes por mes o tira de días por operario (pasado = lo que se hizo, futuro = lo planificado)
const tonoCarga = (l, c) => { const p = c ? l / c : (l > 0 ? 2 : 0); return p > 1.001 ? 'r' : p >= 0.85 ? 'y' : p > 0.01 ? 'g' : 'n'; };
function CalGeneral() {
  const { S, V, ui } = useApp(); const hoy = E.today(); const ops = S.operarios.filter(o => o.activo);
  const [modo, setModo] = useState(() => prefG('calgen-modo', 'mes')); const [mes, setMes] = useState(hoy.slice(0, 7)); const [dsel, setDsel] = useState(null);
  const cambiaModo = m => { setModo(m); guardaG('calgen-modo', m); };
  const movMes = n => { const [y, m] = mes.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); setMes(`${d.getFullYear()}-${E.pad(d.getMonth() + 1)}`); };
  const lc = (o, d) => ({ c: E.capN(S, o.id, d) + E.extraDe(S, o.id, d), l: ((V.load[`${o.id}|${d}|normal`] || {}).h || 0) + ((V.load[`${o.id}|${d}|extra`] || {}).h || 0) });
  const dia = d => ops.reduce((a, o) => { const x = lc(o, d); return { c: a.c + x.c, l: a.l + x.l }; }, { c: 0, l: 0 });
  const [y, m] = mes.split('-').map(Number); const dias = new Date(y, m, 0).getDate(); const d1 = `${mes}-01`;
  const mesTxt = `${E.MESES[m - 1]} ${y}`;
  const pct = x => x.c ? Math.round(x.l / x.c * 100) + '%' : x.l > 0 ? 'sin horas' : '';
  const detalle = dsel && (() => { const data = ops.map(o => ({ o, aus: E.ausenciaDe(S, o.id, dsel), it: [...((V.load[`${o.id}|${dsel}|normal`] || {}).items || []).map(i => ({ ...i, x: 0 })), ...((V.load[`${o.id}|${dsel}|extra`] || {}).items || []).map(i => ({ ...i, x: 1 }))], ...lc(o, dsel) })); const tot = dia(dsel);
    return <div className="calg-det"><div className="sec-h"><h3>{fDia(dsel)}{dsel < hoy ? ' · lo que se hizo' : dsel === hoy ? ' · hoy' : ' · lo planificado'}</h3><span className="mut">{fN(tot.l)} de {fN(tot.c)} h en todo el taller</span><button className="btn sm" onClick={() => setDsel(null)}>Cerrar</button></div>
      <div className="hoygrid">{data.map(x => <div key={x.o.id} className={'hoyc cap-' + tonoCarga(x.l, x.c)}><b>{x.o.nombre} <small className="mut">{fN(x.l)}/{fN(x.c)} h</small></b>
        {x.aus ? <span className="mut">Ausente: {x.aus.motivo}</span> : x.it.length === 0 ? <span className="mut">Sin tareas</span> : x.it.map(i => V.byId[i.id] && <button key={i.id + i.x} className="hl al-t" onClick={() => ui.modal({ k: 'task', id: i.id })}><Chip t={V.byId[i.id]} small /> {etiqueta(V, V.byId[i.id])} <em>{i.x ? 'extra · ' : ''}{fN(i.h)} h</em></button>)}</div>)}</div></div>; })();
  let cuerpo;
  if (modo === 'mes') {
    const blancos = (E.dow(d1) + 6) % 7; const celdas = [...Array(blancos).fill(null), ...Array.from({ length: dias }, (_, i) => `${mes}-${E.pad(i + 1)}`)];
    let tl = 0, tc = 0; celdas.forEach(d => { if (d) { const x = dia(d); tl += x.l; tc += x.c; } });
    cuerpo = <><p className="mut">{mesTxt}: {fN(tl)} h cargadas de {fN(tc)} h disponibles ({tc ? Math.round(tl / tc * 100) : 0}%) · tocá un día para ver el detalle</p>
      <div className="calg-mes">{['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'].map(n => <span key={n} className="calg-dn">{n}</span>)}
        {celdas.map((d, i) => { if (!d) return <span key={'b' + i} />; const x = dia(d), f = E.feriadoDe(S, d);
          return <button key={d} className={'calg-d cap-' + tonoCarga(x.l, x.c) + (d === hoy ? ' hoy' : '') + (d < hoy ? ' pas' : '') + (E.isWork(S, d) ? '' : ' off') + (dsel === d ? ' sel' : '')} onClick={() => setDsel(dsel === d ? null : d)} title={`${fDia(d)}: ${fN(x.l)} de ${fN(x.c)} h${f ? ' · ' + f.nombre : ''}`}>
            <b>{Number(d.slice(8))}</b>{f && <small className="calg-fer">{f.nombre}</small>}{(x.l > 0 || x.c > 0) && <><span className="calg-p">{pct(x)}</span><small className="mut">{fN(x.l)}/{fN(x.c)} h</small><span className="pbar"><i style={{ width: Math.min(100, x.c ? x.l / x.c * 100 : 0) + '%' }} /></span></>}</button>; })}</div></>;
  } else {
    const N = 92; const ds0 = Array.from({ length: N }, (_, i) => E.addDays(d1, i));
    cuerpo = <><p className="mut">Tres meses desde el 1 de {mesTxt} · cada cuadro es la carga del operario ese día · tocá uno para ver el detalle</p>
      <div className="scroll calg-tw"><table className="calg-tira"><thead><tr><th className="stk">Operario</th>{ds0.map(d => <th key={d} className={(d === hoy ? 'hoy ' : '') + (E.isWork(S, d) ? '' : 'off')} title={fDia(d)}>{d.slice(8) === '01' || d === ds0[0] ? <em>{E.MESES[Number(d.slice(5, 7)) - 1]}</em> : null}{LETRA[E.dow(d)]}<br />{Number(d.slice(8))}</th>)}</tr></thead>
        <tbody>{ops.map(o => <tr key={o.id}><th className="stk">{o.nombre}</th>{ds0.map(d => { const x = lc(o, d); return <td key={d} className={'cap-' + tonoCarga(x.l, x.c) + (d === hoy ? ' hoy' : '') + (dsel === d ? ' sel' : '')} title={`${o.nombre} · ${fDia(d)}: ${fN(x.l)} de ${fN(x.c)} h`} onClick={() => setDsel(dsel === d ? null : d)}>{x.l > 0 ? Math.round(x.l) : ''}</td>; })}</tr>)}
          <tr className="tot"><th className="stk">Todo el taller</th>{ds0.map(d => { const x = dia(d); return <td key={d} className={'cap-' + tonoCarga(x.l, x.c) + (d === hoy ? ' hoy' : '')} title={`${fDia(d)}: ${fN(x.l)} de ${fN(x.c)} h`} onClick={() => setDsel(dsel === d ? null : d)}>{x.c ? Math.round(x.l / x.c * 100) : ''}</td>; })}</tr></tbody></table></div></>;
  }
  return <div className="calg">
    <div className="row"><div className="seg">{[['mes', 'Mes por mes'], ['tira', 'Por operario']].map(([k, l]) => <button key={k} className={modo === k ? 'on' : ''} onClick={() => cambiaModo(k)}>{l}</button>)}</div>
      <span className="sp" /><button className="btn" onClick={() => movMes(-1)} aria-label="Mes anterior">←</button><b className="calg-t">{mesTxt}</b><button className="btn" onClick={() => movMes(1)} aria-label="Mes siguiente">→</button><button className="btn" onClick={() => setMes(hoy.slice(0, 7))}>Este mes</button></div>
    {cuerpo}{detalle}
    <p className="legend"><i className="lg g" />con lugar <i className="lg y" />85% o más <i className="lg r" />sobrecargado · cuenta turno normal y horas extra habilitadas · los días pasados muestran lo hecho y los futuros lo planificado{modo === 'tira' ? ' · en las filas: horas cargadas; en "Todo el taller": % de ocupación' : ''}</p>
  </div>;
}
// Alertas de Producción: cada indicador se abre con su lista y la forma de corregirlo
function Alertas({ tipo, days, ops, wk, cerrar }) {
  const { S, V, up, ui } = useApp(); const hoy = E.today(), now = E.nowDT();
  const abrir = id => ui.modal({ k: 'task', id });
  const fila = (k, cuerpo, acciones, tono) => <div key={k} className={'al-r' + (tono ? ' ' + tono : '')}><div className="al-b">{cuerpo}</div><div className="al-a">{acciones}</div></div>;
  let tit = '', cont = null;
  if (tipo === 'carga') {
    tit = 'Carga de la semana por operario';
    const l = ops.map(o => ({ o, ...wk[o.id], p: wk[o.id].c ? wk[o.id].l / wk[o.id].c * 100 : 0 })).sort((a, b) => b.p - a.p);
    cont = l.map(x => fila(x.o.id, <><b>{x.o.nombre}</b><span className="al-bar"><i className={x.p > 100 ? 'r' : x.p >= 85 ? 'y' : 'g'} style={{ width: Math.min(100, x.p) + '%' }} /></span><span className="mut">{fN(x.l)} de {fN(x.c)} h · {Math.round(x.p)}% {x.p > 100 ? '· sobrecargado' : x.p < 50 ? '· tiene lugar' : ''}</span></>,
      <><button className="btn sm" onClick={() => ui.modal({ k: 'op', id: x.o.id })}>{x.p < 60 ? 'Darle tareas' : 'Ver'}</button><button className="btn sm" title="Adelanta lo pendiente para cerrar huecos" onClick={() => juntar(up, ui, x.o.id, x.o.nombre)}>Juntar</button></>, x.p > 100 ? 'bad' : x.p < 50 ? 'ok' : ''));
  } else if (tipo === 'rojas') {
    tit = 'Celdas sobrecargadas';
    const l = []; ops.forEach(o => days.forEach(d => ['normal', 'extra'].forEach(tu => { const c = V.load[`${o.id}|${d}|${tu}`] || { h: 0, items: [] }, cap = tu === 'extra' ? E.extraDe(S, o.id, d) : E.capN(S, o.id, d); if (c.h > cap + 0.01) l.push({ o, d, tu, c, cap }); })));
    cont = l.length ? l.map(x => { const ts = [...new Set(x.c.items.map(i => i.id))].map(id => V.byId[id]).filter(Boolean); const sobra = x.c.h - x.cap;
      return fila(x.o.id + x.d + x.tu, <><b>{x.o.nombre} · {fDia(x.d)} · {x.tu === 'extra' ? 'horas extra' : 'turno normal'}</b><span className="mut">{fN(x.c.h)} h cargadas de {fN(x.cap)} h (sobran {fN(sobra)} h)</span>
        <span className="al-ts">{ts.map(t => <button key={t.id} className="al-t" onClick={() => abrir(t.id)}><Chip t={t} small /> {t.nombre}</button>)}</span></>,
        <>{ts.length > 0 && <button className="btn sm pri-b" title="Corre hacia adelante lo que no entra en ese día" onClick={() => { up(s => { const prim = ts.slice().sort((a, b) => (a.inicio || '') < (b.inicio || '') ? -1 : 1)[0]; return E.reflow(s, prim.id); }); ui.toast('Acomodado: lo que no entraba se corrió y quedó marcado para dar el OK'); }}>Acomodar</button>}
          {x.tu === 'normal' && <button className="btn sm" title="Habilita las horas que sobran como extra que sigue lo del turno normal" onClick={() => { up(s => E.setExtraDia(s, x.o.id, x.d, Math.ceil((E.extraDe(s, x.o.id, x.d) + sobra) * 2) / 2, 'sigue')); ui.toast(`${x.o.nombre}: ${fN(Math.ceil(sobra * 2) / 2)} h extra el ${fDia(x.d)}`); }}>Cubrir con extra</button>}
          <button className="btn sm" onClick={() => ui.modal({ k: 'op', id: x.o.id })}>Operario</button></>, 'bad'); }) : <p className="mut">No hay celdas sobrecargadas esta semana.</p>;
  } else if (tipo === 'empujes') {
    tit = 'Empujes sin OK';
    const l = S.tareas.filter(t => t.empuje);
    const ok = id => up(s => ({ ...s, tareas: s.tareas.map(t => (!id || t.id === id) && t.empuje ? { ...t, empuje: null } : t) }));
    const rev = id => up(s => ({ ...s, tareas: s.tareas.map(t => (!id || t.id === id) && t.empuje ? { ...t, inicio: t.empuje, empuje: null } : t) }));
    cont = l.length ? <>{l.length > 1 && <div className="row al-top"><button className="btn sm pri-b" onClick={() => ok()}>Dar OK a todas</button><button className="btn sm" onClick={() => rev()}>Volver todas atrás</button></div>}
      {l.map(t => fila(t.id, <><button className="al-t" onClick={() => abrir(t.id)}><Chip t={t} small /> <b>{etiqueta(V, t)}</b></button><span className="mut">{t.inicio < t.empuje ? 'adelantada' : 'empujada'}: {fDT(t.empuje)} → {fDT(t.inicio)} · {t.ops.map(o => opName(S, o)).join(', ') || 'sin operario'}</span></>,
        <><button className="btn sm pri-b" onClick={() => ok(t.id)}>OK</button><button className="btn sm" onClick={() => rev(t.id)}>Volver atrás</button></>, 'warn'))}</> : <p className="mut">No hay empujes pendientes de OK.</p>;
  } else if (tipo === 'riesgo') {
    tit = 'Entregas en riesgo';
      const rs = riesgos(S, V);
    const ultima = ids => ids.map(id => V.byId[id]).filter(t => t && !V.D[t.id].parent && t.estado !== 'terminada').sort((a, b) => (V.D[b.id].fin || '') < (V.D[a.id].fin || '') ? -1 : 1)[0];
    cont = rs.length ? rs.map(x => { const ids = x.proy ? S.tareas.filter(t => t.proyId === x.proy).map(t => t.id) : [x.id, ...E.descendants(S, x.id)]; const u = ultima(ids); const ent = x.proy ? (S.proyectos.find(p => p.id === x.proy) || {}).entrega : V.byId[x.id].entrega;
      return fila(x.id || x.proy, <><b>{x.txt}</b><span className="mut">entrega {fD(ent)} · termina {fD((x.proy ? ids.map(i => V.D[i].fin).filter(Boolean).sort().pop() : V.D[x.id].fin || '').slice(0, 10))} · <span className="c-bad">+{x.dias} {x.dias === 1 ? 'día' : 'días'}</span></span>
        {u && <span className="mut">La que termina más tarde: <button className="al-t" onClick={() => abrir(u.id)}><Chip t={u} small /> {etiqueta(V, u)}</button> · {u.ops.map(o => opName(S, o)).join(', ') || 'sin operario'} · {u.turno === 'extra' ? 'horas extra' : u.turno === 'ambos' ? 'normal + extra' : 'turno normal'} · fin {fDT(V.D[u.id].fin)}</span>}</>,
        <>{x.proy ? <button className="btn sm" onClick={() => { try { const cl = E.claseP(S.proyectos.find(p => p.id === x.proy)); localStorage.setItem('produccionapp-' + cl + '-actual', x.proy); ui.tab(cl === 'pv' ? 'postventa' : cl === 'tl' ? 'internos' : 'proyectos'); } catch (e) { } }}>Ver proyecto</button> : <button className="btn sm" onClick={() => abrir(x.id)}>Abrir</button>}
          {u && u.ops.length > 0 && u.turno === 'normal' && <button className="btn sm" title="Que la última tarea use también las horas extra de cada día" onClick={() => { up(s => E.patchTask(s, u.id, { turno: 'ambos' }, true)); ui.toast('Ahora usa el turno normal y las horas extra. Habilitá extras en el operario si hace falta.'); }}>Sumarle horas extra</button>}
          {u && u.ops.length > 0 && <button className="btn sm" onClick={() => ui.modal({ k: 'op', id: u.ops[0] })}>Extras de {opName(S, u.ops[0])}</button>}
          <button className="btn sm" title="Pone en prioridad alta todas sus tareas" onClick={() => up(s => ({ ...s, tareas: s.tareas.map(t => ids.includes(t.id) && t.prioridad !== 'alta' ? { ...t, prioridad: 'alta' } : t) }))}>Prioridad alta</button></>, 'bad'); }) : <p className="mut">No hay entregas en riesgo.</p>;
  } else if (tipo === 'atraso') {
    tit = 'Tareas atrasadas';
    const l = S.tareas.filter(t => t.ops.length && t.inicio && t.estado !== 'terminada' && !V.D[t.id].parent && ((t.estado === 'en proceso' && V.D[t.id].sigueProc && !E.corriendo(t)) || (E.esPend(t) && t.inicio < now))).sort((a, b) => a.inicio < b.inicio ? -1 : 1);
    cont = l.length ? <><div className="row al-top"><button className="btn sm pri-b" onClick={() => { let n = 0; up(s => { const r = E.reprogramar(s); n = r.n; return r.n ? r.S : s; }); ui.toast(n ? `${n} ${n === 1 ? 'tarea reprogramada' : 'tareas reprogramadas'} desde ahora` : 'Nada para reprogramar'); }}>Reprogramar todas desde ahora</button></div>
      {l.slice(0, 60).map(t => fila(t.id, <><button className="al-t" onClick={() => abrir(t.id)}><Chip t={t} small /> <b>{etiqueta(V, t)}</b></button><span className="mut">{E.esPend(t) ? `debía empezar ${fDT(t.inicio)}` : `debía terminar ${fDT(V.D[t.id].fin)} · ${Math.round(V.D[t.id].avance)}%`} · {t.ops.map(o => opName(S, o)).join(', ')}</span></>,
        <><button className="btn sm" onClick={() => ui.modal({ k: 'op', id: t.ops[0] })}>Operario</button><button className="btn sm" onClick={() => abrir(t.id)}>Editar</button></>, 'warn'))}{l.length > 60 && <p className="mut">y {l.length - 60} más.</p>}</> : <p className="mut">No hay tareas atrasadas.</p>;
  } else if (tipo === 'frenadas') {
    tit = 'Tareas frenadas';
    const l = S.tareas.filter(t => E.estaFrenada(t) && !V.D[t.id].parent).sort((a, b) => (a.frenada.desde || '') < (b.frenada.desde || '') ? -1 : 1);
    cont = l.length ? l.map(t => fila(t.id, <><button className="al-t" onClick={() => abrir(t.id)}><Chip t={t} small /> <b>{etiqueta(V, t)}</b></button>
      <span className="mut">⏸ {txtFreno(t)} · faltan {fHM(t.hh)} · {t.ops.map(o => opName(S, o)).join(', ') || 'sin operario'}{t.inicio ? ` · programada ${fDT(t.inicio)}` : ''}</span>{t.frenada.nota && <span className="fren-nota">{t.frenada.nota}</span>}</>,
      <><button className="btn sm pri-b" onClick={() => ui.modal({ k: 'retomar', id: t.id })}>Retomar</button><button className="btn sm" onClick={() => abrir(t.id)}>Editar</button></>, 'warn')) : <p className="mut">No hay tareas frenadas.</p>;
  }
  return <section className="alertas"><div className="sec-h"><h3>{tit}</h3><button className="btn sm" onClick={cerrar}>Cerrar</button></div><div className="al-l">{cont}</div></section>;
}
/* Próximo a realizar: lista numerada (en el orden en que se marcaron). Desde el 10/11 solo queda en la vista "Todos" de Proyectos, Post Venta y Taller;
   en el resto de las pantallas está como sección "Próximo a realizar" dentro de las secciones por estado. */
function Proximas({ filtro, donde }) {
  const { S, V, up, ui } = useApp();
  const l = E.proximas(S, t => V.D[t.id] && !V.D[t.id].parent && (!filtro || filtro(t)));
  return <section className="proxsec"><div className="sec-h"><h2>Próximo a realizar <span className="cnt">{l.length}</span></h2><span className="mut">Estado "próximo a realizar" (tabla, menú ⋮ o editor). Sale solo al iniciarlas.</span></div>
    {l.length === 0 ? <Vacio ic="ok" chico t={`No hay piezas marcadas${donde ? ' ' + donde : ''}`} />
      : <div className="proxl">{l.map((t, i) => <div key={t.id} className="proxi">
        <b className="proxn">{i + 1}</b>
        <div className="proxd"><span className="drow"><Chip t={t} small /><button className="tlink" title="Abrir" onClick={() => ui.modal({ k: 'task', id: t.id })}>{etiqueta(V, t)}</button><Pri p={t.prioridad} />{E.estaFrenada(t) && <span className="mk warn" title={txtFreno(t)}>⏸ frenada</span>}</span>
          <span className="mut">{operName(S, t.operacionId)} · cant. {cantTxt(t)} · {fH(t.hh)} · {t.ops.length ? t.ops.map(o => opName(S, o)).join(', ') + (t.inicio ? ' · ' + fDT(t.inicio) : '') : 'sin operario'}</span></div>
        <button className="btn sm" title="Sacarla de Próximo a realizar" onClick={() => { up(s => E.setProximo(s, t.id, false)); ui.toast('Quitada de Próximo a realizar'); }}>Quitar</button>
      </div>)}</div>}
  </section>;
}

function Resumen() {
  const { S, V, up, ui } = useApp();
  const [w0, setW0] = useState(() => E.today());   // la semana arranca siempre en hoy (primera columna)
  const [fp, setFp] = useState(''); const [fo, setFo] = useState(''); const [vista, setVista] = useState('sem'); const [vp, setVp] = useVistaProc();
  const days = [0, 1, 2, 3, 4, 5, 6].map(i => E.addDays(w0, i)); const hoy = E.today();
  const ops = S.operarios.filter(o => o.activo);
  const setExtra = (op, d, v, modo) => up(s => E.setExtraDia(s, op, d, v, modo));
  const nuevaExtra = (op, d) => up(s => E.setExtraDia(s, op, d, 2, s.tareas.some(t => t.ops.includes(op) && t.turno === 'extra' && t.estado !== 'terminada') ? 'aparte' : 'sigue'));
  const drop = (e, op, d, turno) => { e.preventDefault(); e.currentTarget.classList.remove('over'); try { const x = JSON.parse(e.dataTransfer.getData('text/plain'));
    if (x.tu && x.tu !== turno && x.from === op) { up(s => E.partirEnDia(s, x.id, d, turno)); ui.toast(`Desde el ${fDia(d)} sigue en ${turno === 'extra' ? 'horas extra' : 'turno normal'}; lo anterior queda en ${x.tu === 'extra' ? 'horas extra' : 'turno normal'}`); return; }
    const tx = S.tareas.find(y => y.id === x.id);
    if (tx && d <= hoy && E.interrumpidas(S, { ...tx, ops: [op], turno }, d === hoy ? E.nowDT() : d + 'T23:59').length) { ui.modal({ k: 'meter', id: x.id, op, d, turno, from: x.from }); return; }   // el operario tenía otra en curso ese día: preguntar
    up(s => E.assignTo(s, x.id, op, d, turno, x.from)); } catch (err) { } };
  const dnd = (op, d, turno) => ({ onDragOver: e => { e.preventDefault(); e.currentTarget.classList.add('over'); }, onDragLeave: e => e.currentTarget.classList.remove('over'), onDrop: e => drop(e, op, d, turno) });
  let capSem = 0, loadSem = 0, rojas = 0;
  const wk = {};
  ops.forEach(o => { let c = 0, l = 0; days.forEach(d => { const cn = E.capN(S, o.id, d), ce = E.extraDe(S, o.id, d); const ln = (V.load[`${o.id}|${d}|normal`] || {}).h || 0, le = (V.load[`${o.id}|${d}|extra`] || {}).h || 0; c += cn + ce; l += ln + le; if (semOf(ln, cn) === 'r') rojas++; if (semOf(le, ce) === 'r') rojas++; }); wk[o.id] = { c, l }; capSem += c; loadSem += l; });
  const rs = riesgos(S, V); const [al, setAl] = useState(null); const nowR = E.nowDT();
  const atr = S.tareas.filter(t => t.ops.length && t.inicio && t.estado !== 'terminada' && !V.D[t.id].parent && ((t.estado === 'en proceso' && V.D[t.id].sigueProc && !E.corriendo(t)) || (E.esPend(t) && t.inicio < nowR))).length;
  const chips = (op, d, turno) => ((V.load[`${op}|${d}|${turno}`] || {}).items || []).map(it => {
    const t = V.byId[it.id]; const c = E.chipOf(S, V, t);
    if (it.sigue) return <div key={it.id + 's'} className="cchip sig" style={{ '--c': c.color }} onClick={() => ui.modal({ k: 'task', id: t.id })} title={`Sigue en la extra lo del turno normal · ${c.txt} · ${etiqueta(V, t)}`}><b>{c.txt}</b><span>↪ {t.nombre}</span><i>{fN(it.h)} h</i></div>;
    return <div key={it.id} className={'cchip' + (t.empuje ? ' pushed' : '') + (t.estado === 'terminada' ? ' done' : '')} style={{ '--c': c.color }} draggable
      onDragStart={e => e.dataTransfer.setData('text/plain', JSON.stringify({ id: t.id, from: op, tu: turno, d }))} onClick={() => ui.modal({ k: 'task', id: t.id })}
      title={`${c.txt} · ${etiqueta(V, t)} · ${fDT(t.inicio)} → ${fDT(V.D[t.id].fin)}`}>
      <b>{c.txt}</b><span>{t.empuje ? (t.inicio < t.empuje ? '↤ ' : '↦ ') : ''}{t.nombre}</span><i>{fN(it.h)} h</i>
      <button aria-label="Quitar del operario" onClick={e => { e.stopPropagation(); up(s => E.unassign(s, t.id, op)); }}>×</button>
    </div>;
  });
  const cell = (o, d) => {
    const cn = E.capN(S, o.id, d), ce = E.extraDe(S, o.id, d);
    const ln = (V.load[`${o.id}|${d}|normal`] || {}).h || 0, le = (V.load[`${o.id}|${d}|extra`] || {}).h || 0;
    const fer = E.feriadoDe(S, d), aus = E.ausenciaDe(S, o.id, d), wd = E.isWork(S, d);
    const motivo = aus ? aus.motivo : fer ? 'Feriado' : !wd ? '' : null, par = !aus && wd ? ausParcial(S, o.id, d) : null;
    return <td key={d} className={d === hoy ? 'hoy' : ''}>
      <div className={`half sem-${semOf(ln, cn)}${motivo !== null ? ' blk' : ''}${aus ? ' aus' : ''}`} style={par ? { ...E.ausStyle(S, par.a), ...PARC_ST } : E.ausStyle(S, aus)} title={par ? `${par.txt} (${fN(par.h)} h fuera)` : undefined} {...dnd(o.id, d, 'normal')}>
        <div className="half-h"><span className="tn">N</span>
          {motivo !== null ? <span className="ld">{motivo}</span> : <span className="ld">{fN(ln)}/{fN(cn)} h</span>}
          {motivo === null && <button className="mini" aria-label="Asignar tarea" onClick={() => ui.modal({ k: 'pick', op: o.id, d, turno: 'normal' })}>+</button>}
        </div>
        {par && <small style={PARC_TX}>{par.txt}</small>}
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
  const [plgP, togP] = usePlegados('prod-grupos');
  const base = S.tareas.filter(t => !V.D[t.id].parent && t.estado !== 'terminada' && (!fp || t.prioridad === fp) && (!fo || (fo === '_' ? !t.ops.length : t.ops.includes(fo))));
  const deClase = (k, tipo) => base.filter(t => t.tipo === tipo && claseT(t) === k)
    .sort(k === 'proximo' ? (a, b) => ((a.proximo || '9') < (b.proximo || '9') ? -1 : (a.proximo || '9') > (b.proximo || '9') ? 1 : 0)
      : (a, b) => PRI[a.prioridad] - PRI[b.prioridad] || ((a.inicio || '9') < (b.inicio || '9') ? -1 : 1));
  const pitem = (t, k, n, ver) => <div key={t.id} className={'pitem' + (k === 'proximo' ? ' prx' : '') + (k === 'curso' ? ' crs' : '')} draggable={k === 'pendiente' || k === 'proximo'} onDragStart={e => e.dataTransfer.setData('text/plain', JSON.stringify({ id: t.id }))} onClick={() => ui.modal({ k: 'task', id: t.id })}>
      {k === 'proximo' ? <b className="proxn">{n}</b> : <Chip t={t} small />}<span className="pn">{k === 'proximo' && <Chip t={t} small />} {etiqueta(V, t)}</span><Pri p={t.prioridad} />
      {k === 'proximo' && <button className="btn sm" title="Sacarla de Próximo a realizar (vuelve a pendiente)" onClick={e => { e.stopPropagation(); up(s => E.setProximo(s, t.id, false)); ui.toast('Volvió a pendiente'); }}>Quitar</button>}
      <span className="mut">{ver && <span className="tabp-e" style={{ '--c': (SECC.find(x => x[0] === k) || [])[2] }}><i>{k === 'curso' ? '● ' : k === 'proximo' ? '⏭ ' : ''}{(SECC.find(x => x[0] === k) || [])[1]}</i></span>}{k === 'curso' || k === 'pausa' ? `${fHM(E.llevado(S, t))} de ${fH(t.hh)}` : fH(t.hh)} · {t.ops.length ? t.ops.map(o => opName(S, o)).join(', ') + (k === 'curso' ? '' : ' · ' + fDT(t.inicio)) : 'Sin asignar'}{E.estaFrenada(t) ? ' · ⏸ frenada: ' + txtFreno(t) : ''}</span>
      {(k === 'pendiente' || k === 'proximo') && !t.ops.length && (() => { const r = E.recomendar(S, t)[0]; return r && <span className="sug">Sugerido: <b>{r.nombre}</b> desde {fDT(r.ini)} <button className="btn sm" onClick={e => { e.stopPropagation(); up(s => E.darA(s, t.id, r.op, r.ini)); ui.toast(`Asignada a ${r.nombre}`); }}>Dársela</button></span>; })()}
    </div>;
  const lista = (k, tit, tipo) => { const l = deClase(k, tipo); return <div className="pcol">
    <h3>{tit} <span className="cnt">{l.length}</span></h3>
    {l.length === 0 ? <p className="mut">Ninguna.</p> : l.map((t, i) => pitem(t, k, i + 1))}
  </div>; };
  // Vista "Por proceso" (25/11): un grupo por operación, como la vista por estado, con las mismas tarjetas (y acciones) separadas en Repuestos y Proyectos
  const prxL = base.filter(t => claseT(t) === 'proximo').sort((a, b) => ((a.proximo || '9') < (b.proximo || '9') ? -1 : (a.proximo || '9') > (b.proximo || '9') ? 1 : 0));
  const ordP = (a, b) => ORD_CLASE[claseT(a)] - ORD_CLASE[claseT(b)] || PRI[a.prioridad] - PRI[b.prioridad] || ((a.inicio || '9') < (b.inicio || '9') ? -1 : 1);
  const listaP = (l, tit) => <div className="pcol"><h3>{tit} <span className="cnt">{l.length}</span></h3>{l.length === 0 ? <p className="mut">Ninguna.</p> : l.slice().sort(ordP).map(t => pitem(t, claseT(t), prxL.indexOf(t) + 1, true))}</div>;
  const porProc = <GruposProc hojas={base} vacio={<Vacio ic="buscar" chico t="No hay tareas pendientes con este filtro" />} render={l => <div className="pcols pgp">{listaP(l.filter(t => t.tipo === 'rep'), 'Repuestos')}{listaP(l.filter(t => t.tipo !== 'rep'), 'Proyectos, Post Venta y Taller')}</div>} />;
  const grupos = SECC.map(([k, l, c]) => { const n = deClase(k, 'rep').length + deClase(k, 'proy').length; if (!n && k !== 'pendiente') return null;
    return <GrupoEstado key={k} k={k} l={l} c={c} n={n} plg={plgP} tog={togP} nota={<>{k === 'proximo' && <span className="mut">en el orden en que se marcaron · salen solas al iniciarlas</span>}{k === 'pausa' && <span className="mut">empezadas que no se están haciendo ahora, pausadas o frenadas</span>}</>}>
      {n ? <div className="pcols">{lista(k, 'Repuestos', 'rep')}{lista(k, 'Proyectos, Post Venta y Taller', 'proy')}</div> : <Vacio ic="buscar" chico t="No hay tareas pendientes con este filtro" />}</GrupoEstado>; });
  return <div className="view">
    <PushBanner />
    <section>
      <div className="sec-h">
        <div className="row"><h2>{vista === 'sem' ? `Del ${fDia(w0)} al ${fDia(days[6])}` : vista === 'cap' ? 'Carga de las próximas semanas' : 'Calendario de cargas'}</h2>
          <div className="seg"><button className={vista === 'sem' ? 'on' : ''} onClick={() => setVista('sem')}>Semana</button><button className={vista === 'cap' ? 'on' : ''} onClick={() => setVista('cap')}>6 semanas</button><button className={vista === 'cal' ? 'on' : ''} onClick={() => setVista('cal')}>Calendario</button></div></div>
        <div className="row">
          {vista !== 'cal' && <><button className="btn" onClick={() => setW0(E.addDays(w0, -7))} aria-label="Semana anterior" title="Semana anterior">«</button>
          {vista === 'sem' && <button className="btn" onClick={() => setW0(E.addDays(w0, -1))} aria-label="Día anterior" title="Día anterior">‹</button>}
          <button className={'btn' + (w0 === hoy ? ' pri-b' : '')} onClick={() => setW0(hoy)}>Hoy</button>
          {vista === 'sem' && <input type="date" value={w0} title="Ir a una fecha" aria-label="Ir a una fecha" onChange={e => e.target.value && setW0(e.target.value)} />}
          {vista === 'sem' && <button className="btn" onClick={() => setW0(E.addDays(w0, 1))} aria-label="Día siguiente" title="Día siguiente">›</button>}
          <button className="btn" onClick={() => setW0(E.addDays(w0, 7))} aria-label="Semana siguiente" title="Semana siguiente">»</button></>}
          <button className="btn" onClick={() => ui.modal({ k: 'hoy' })}>Parte del día</button>
          <button className="btn" title="Adelanta las tareas pendientes de todos para cerrar los huecos libres" onClick={() => juntar(up, ui, null)}>Juntar tareas</button>
          <label className="chk cadena" title="Cuando una tarea se finaliza antes de lo planificado (desde Operarios, la tabla o el editor), las pendientes que venían pegadas detrás en el mismo operario se adelantan solas. Si había un hueco a propósito o una tarea fijada a mano 📌, ahí se corta."><input type="checkbox" checked={S.cfg.adelantarCola !== false} onChange={e => up(s => ({ ...s, cfg: { ...s.cfg, adelantarCola: e.target.checked } }))} /> Si una tarea termina antes, adelantar las que vienen detrás</label>
          <button className="btn" title="Corre desde ahora lo que quedó atrasado según el avance real. Queda marcado en el cartel para dar el OK." onClick={() => { let n = 0; up(s => { const r = E.reprogramar(s); n = r.n; return r.n ? r.S : s; }); ui.toast(n ? `${n} ${n === 1 ? 'tarea reprogramada' : 'tareas reprogramadas'} desde ahora. Revisalas en el cartel.` : 'No hay tareas atrasadas.'); }}>Reprogramar atrasadas</button>
        </div>
      </div>
      <div className="kpis">
        <Kpi l="Carga de la semana" v={capSem ? Math.round(loadSem / capSem * 100) + '%' : '—'} s={`${fN(loadSem)} de ${fN(capSem)} h`} onClick={() => setAl(al === 'carga' ? null : 'carga')} on={al === 'carga'} />
        <Kpi l="Celdas sobrecargadas" v={rojas} tone={rojas ? 'bad' : ''} onClick={() => setAl(al === 'rojas' ? null : 'rojas')} on={al === 'rojas'} />
        <Kpi l="Empujes sin OK" v={S.tareas.filter(t => t.empuje).length} tone={S.tareas.some(t => t.empuje) ? 'warn' : ''} onClick={() => setAl(al === 'empujes' ? null : 'empujes')} on={al === 'empujes'} />
        <Kpi l="Entregas en riesgo" v={rs.length} tone={rs.length ? 'bad' : ''} s={rs[0] ? `${rs[0].txt}: +${rs[0].dias} d` : ''} onClick={() => setAl(al === 'riesgo' ? null : 'riesgo')} on={al === 'riesgo'} />
        {(() => { const fr = S.tareas.filter(t => E.estaFrenada(t) && !V.D[t.id].parent); return <Kpi l="Tareas frenadas" v={fr.length} tone={fr.length ? 'warn' : ''} s={fr.length ? `${fN(fr.reduce((a, t) => a + (Number(t.hh) || 0), 0))} HH paradas` : ''} onClick={() => setAl(al === 'frenadas' ? null : 'frenadas')} on={al === 'frenadas'} />; })()}
        <Kpi l="Tareas atrasadas" v={atr} tone={atr ? 'warn' : ''} s={atr ? 'debían haber empezado o terminado' : ''} onClick={() => setAl(al === 'atraso' ? null : 'atraso')} on={al === 'atraso'} />
      </div>
      {al && <Alertas tipo={al} days={days} ops={ops} wk={wk} cerrar={() => setAl(null)} />}
      {vista === 'sem' ? <>
      <div className="scroll calw"><table className="cal">
        <thead><tr><th className="stk">Operario</th>{days.map(d => { const f = E.feriadoDe(S, d); return <th key={d} className={(d === hoy ? 'hoy ' : '') + (E.isWork(S, d) ? '' : 'off')}>{fDia(d)}{f && <small>{f.nombre}</small>}</th>; })}</tr></thead>
        <tbody>{ops.map(o => <tr key={o.id}>
          <th className="stk"><button className="oplink" onClick={() => ui.modal({ k: 'op', id: o.id })}><Av o={o} i={S.operarios.indexOf(o)} sm />{o.nombre}</button>
            <button className="jbtn" title={`Adelanta las tareas pendientes de ${o.nombre} para cerrar los huecos libres`} onClick={() => juntar(up, ui, o.id, o.nombre)}>juntar</button>
            <small>{fN(wk[o.id].l)}/{fN(wk[o.id].c)} h</small><Bar v={wk[o.id].c ? wk[o.id].l / wk[o.id].c * 100 : 0} color={wk[o.id].l > wk[o.id].c + .01 ? 'var(--bad)' : undefined} /></th>
          {days.map(d => cell(o, d))}</tr>)}</tbody>
      </table></div>
      <p className="legend"><i className="lg g" />con lugar <i className="lg y" />completo <i className="lg r" />sobrecargado · N turno normal · E horas extra (sigue: continúa lo del turno normal ese día; aparte: otro trabajo) · arrastrá una tarea para moverla de día o de operario · si la pasás de extra a normal (o al revés) en el mismo operario, lo anterior queda y sigue desde ese día; también con el + de la celda</p>
      </> : vista === 'cap' ? <Capacidad w0={w0} irA={d => { setW0(d); setVista('sem'); }} /> : <CalGeneral />}
    </section>
    <MaterialCard />
    {(() => { const repA = new Set(S.tareas.filter(t => t.tipo === 'rep' && !t.parentId && V.D[t.id].estado !== 'terminada').map(t => t.id)), proyA = new Set(S.proyectos.filter(x => !x.terminado).map(x => x.id));
      return <PendProc donde={'en lo abierto (repuestos, proyectos, post venta y taller)' + (fp || fo ? ' · con los filtros de abajo' : '')} ts={S.tareas.filter(t => (t.tipo === 'rep' ? repA.has(V.rootOf(t).id) : proyA.has(t.proyId)) && (!fp || t.prioridad === fp) && (!fo || (fo === '_' ? !t.ops.length : t.ops.includes(fo))))} />; })()}
    <section>
      <div className="sec-h"><h2>{vp === 'proceso' ? 'Tareas por proceso' : 'Tareas por estado'}</h2>
        <div className="row">
          <VistaSel v={vp} set={setVp} />
          <select id="f-pri" value={fp} onChange={e => setFp(e.target.value)} aria-label="Prioridad"><option value="">Toda prioridad</option><option value="alta">Alta</option><option value="media">Media</option><option value="baja">Baja</option></select>
          <select id="f-op" value={fo} onChange={e => setFo(e.target.value)} aria-label="Operario"><option value="">Todos los operarios</option><option value="_">Sin asignar</option>{ops.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select>
        </div></div>
      {vp === 'proceso' ? porProc : grupos}
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
/* ================= Filtros tipo Excel en las tablas (Repuestos, Proyectos, Post Venta y Taller) =================
   Cada tabla tiene su juego de filtros y orden, que se recuerda en esta PC. Las tablas de la misma sección
   (por ejemplo, los grupos de Repuestos o Pendientes y Finalizadas de un proyecto) comparten los mismos filtros. */
const VACIO = '(vacías)';
const FSTORE = {}, FLIS = new Set();
const leerF = k => { if (!FSTORE[k]) { let v = null; try { v = JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { } FSTORE[k] = v && v.f ? v : { f: {}, s: null }; } return FSTORE[k]; };
function useFiltros(k) {
  const [, f] = useState(0);
  useEffect(() => { const l = () => f(x => x + 1); FLIS.add(l); return () => FLIS.delete(l); }, []);
  const set = fn => { FSTORE[k] = fn(leerF(k)); try { localStorage.setItem(k, JSON.stringify(FSTORE[k])); } catch (e) { } FLIS.forEach(l => l()); };
  return [leerF(k), set];
}
const FILTRABLES = new Set(['orden', 'cliente', 'nombre', 'cant', 'restan', 'prioridad', 'estado', 'operacion', 'ops', 'turno', 'inicio', 'fin', 'real', 'avance']);
const TURNOS = { normal: 'Normal', extra: 'Extra', ambos: 'Normal + extra' };
// Valores de una fila para el filtro (texto que se ve en la lista). Operarios devuelve uno por operario.
const valF = (S, V, k, t) => { const r = V.D[t.id] || {}; const rt = V.rootOf(t) || t;
  switch (k) {
    case 'orden': return [rt.orden || VACIO];
    case 'cliente': return [rt.cliente || VACIO];
    case 'nombre': return [t.nombre || VACIO];
    case 'cant': return [t.cant === '' || t.cant == null ? VACIO : String(t.cant)];
    case 'restan': return [String(restanVis(t))];
    case 'prioridad': return [t.prioridad || VACIO];
    case 'estado': return [esTerc(t) ? 'tercerizada' : sinF(t) ? 'finalizada, sin fecha' : estTxt(r.parent ? r.estado : estDe(t))];
    case 'operacion': return [r.parent ? VACIO : t.operacionId ? operName(S, t.operacionId) : VACIO];
    case 'ops': { const l = r.parent ? (r.ops || []) : t.ops; return l.length ? l.map(o => opName(S, o)) : ['Sin asignar']; }
    case 'turno': return [r.parent ? VACIO : TURNOS[t.turno] || t.turno || VACIO];
    case 'inicio': return [r.inicio ? fD(r.inicio.slice(0, 10)) : VACIO];
    case 'fin': return [r.fin ? fD(r.fin.slice(0, 10)) : VACIO];
    case 'real': return [r.hhReal > 0 ? fN(r.hhReal) : VACIO];
    case 'avance': return [Math.round(r.avance || 0) + ' %'];
    default: return [VACIO];
  } };
// Valor para ordenar (números como números y fechas por fecha)
const ordV = (S, V, k, t) => { const r = V.D[t.id] || {};
  switch (k) {
    case 'cant': return Number(t.cant) || 0;
    case 'restan': return restanVis(t);
    case 'real': return r.hhReal || 0;
    case 'avance': return r.avance || 0;
    case 'prioridad': return PRI[t.prioridad] ?? 9;
    case 'inicio': return r.inicio || '9999';
    case 'fin': return r.fin || '9999';
    default: return valF(S, V, k, t)[0].toLowerCase();
  } };
// Orden de la lista de valores: números y fechas en orden natural, "(vacías)" al final
const cmpVal = k => (a, b) => { if (a === VACIO) return 1; if (b === VACIO) return -1;
  if (k === 'inicio' || k === 'fin') { const d = x => x.split('/').reverse().join(''); return d(a) < d(b) ? -1 : 1; }
  const na = parseFloat(String(a).replace(',', '.')), nb = parseFloat(String(b).replace(',', '.'));
  if (!isNaN(na) && !isNaN(nb) && /^[\d.,\s%]+$/.test(a + b)) return na - nb;
  return String(a).localeCompare(String(b), 'es', { numeric: true }); };

function FiltroPop({ titulo, k, valores, elegidos, orden, pos, onOk, onOrden, onClose }) {
  const [q, setQ] = useState(''); const [m, setM] = useState(() => new Set(elegidos || valores.map(v => v.v)));
  const ref = useRef(null);
  useEffect(() => { const h = e => { if (ref.current && !ref.current.contains(e.target) && !e.target.closest('.fbtn')) onClose(); };
    const esc = e => { if (e.key === 'Escape') onClose(); };
    const sc = e => { if (!ref.current || !ref.current.contains(e.target)) onClose(); };   // si se mueve la tabla o la página, se cierra (como en Excel)
    window.addEventListener('mousedown', h); window.addEventListener('keydown', esc); window.addEventListener('scroll', sc, true); return () => { window.removeEventListener('mousedown', h); window.removeEventListener('keydown', esc); window.removeEventListener('scroll', sc, true); }; }, []);
  const ql = q.trim().toLowerCase(); const vis = valores.filter(v => !ql || v.v.toLowerCase().includes(ql));
  const todosVis = vis.length > 0 && vis.every(v => m.has(v.v));
  const togTodos = () => setM(p => { const n = new Set(p); vis.forEach(v => todosVis ? n.delete(v.v) : n.add(v.v)); return n; });
  const tog = v => setM(p => { const n = new Set(p); n.has(v) ? n.delete(v) : n.add(v); return n; });
  // Como en Excel: si hay texto en el buscador, "Aceptar" deja solo lo que coincide y está tildado
  const aceptar = () => { const elig = (ql ? vis.filter(v => m.has(v.v)) : valores.filter(v => m.has(v.v))).map(v => v.v);
    onOk(elig.length === valores.length ? null : elig); };
  const az = k === 'cant' || k === 'restan' || k === 'real' || k === 'avance' ? ['Ordenar de menor a mayor', 'Ordenar de mayor a menor'] : k === 'inicio' || k === 'fin' ? ['Ordenar de más antigua a más nueva', 'Ordenar de más nueva a más antigua'] : k === 'prioridad' ? ['Ordenar de alta a baja', 'Ordenar de baja a alta'] : ['Ordenar de A a Z', 'Ordenar de Z a A'];
  const H = Math.min(450, window.innerHeight - 16), x = Math.max(8, Math.min(pos.x, window.innerWidth - 290)), y = Math.max(8, Math.min(pos.y, window.innerHeight - H - 8));   // que entre siempre en la pantalla
  return createPortal(<div className="fpop" ref={ref} style={{ left: x, top: y, maxHeight: H }} role="dialog" aria-label={'Filtro de ' + titulo}>
    <div className="fpop-t">{titulo}</div>
    <button className={'fpop-o' + (orden === 1 ? ' on' : '')} onClick={() => onOrden(orden === 1 ? 0 : 1)}>↑ {az[0]}</button>
    <button className={'fpop-o' + (orden === -1 ? ' on' : '')} onClick={() => onOrden(orden === -1 ? 0 : -1)}>↓ {az[1]}</button>
    <hr />
    <input type="search" autoFocus placeholder="Buscar…" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); aceptar(); } }} />
    <div className="fpop-l">
      <label className="fpop-all"><input type="checkbox" checked={todosVis} onChange={togTodos} /> {ql ? '(Seleccionar todos los resultados)' : '(Seleccionar todo)'}</label>
      {vis.map(v => <label key={v.v} title={v.v}><input type="checkbox" checked={m.has(v.v)} onChange={() => tog(v.v)} /><span className={v.v === VACIO ? 'mut' : ''}>{v.v}</span><small>{v.n}</small></label>)}
      {vis.length === 0 && <p className="mut">Nada coincide con "{q}"</p>}
    </div>
    <div className="fpop-b">
      <button className="btn sm" disabled={!elegidos} onClick={() => onOk(null)}>Borrar filtro</button><span className="sp" />
      <button className="btn sm" onClick={onClose}>Cancelar</button>
      <button className="btn sm pri-b" disabled={m.size === 0 || (ql && !vis.some(v => m.has(v.v)))} onClick={aceptar}>Aceptar</button>
    </div>
  </div>, document.body);
}

/* Menú de acciones de una fila (botón ⋮ al principio de la fila): editar, próximo a realizar, agregar hijo, subir/bajar, duplicar y borrar */
function FilaMenu({ pos, items, onClose }) {
  const ref = useRef(null);
  useEffect(() => { const h = e => { if (ref.current && !ref.current.contains(e.target) && !e.target.closest('.fmenu-b')) onClose(); };
    const k = e => { if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const bs = [...ref.current.querySelectorAll('button:not(:disabled)')]; const i = bs.indexOf(document.activeElement); const n = bs[(i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length]; n && n.focus(); } };
    const sc = e => { if (!ref.current || !ref.current.contains(e.target)) onClose(); };
    window.addEventListener('mousedown', h); window.addEventListener('keydown', k); window.addEventListener('scroll', sc, true);
    const b = ref.current && ref.current.querySelector('button'); b && b.focus();
    return () => { window.removeEventListener('mousedown', h); window.removeEventListener('keydown', k); window.removeEventListener('scroll', sc, true); }; }, []);
  const H = items.length * 38 + 12, x = Math.max(8, Math.min(pos.x, window.innerWidth - 250)), y = pos.y + H > window.innerHeight - 8 ? Math.max(8, pos.top - H - 2) : pos.y;
  return createPortal(<div className="fmenu" ref={ref} role="menu" style={{ left: x, top: y }}>
    {items.map((it, i) => it === '-' ? <hr key={i} /> : <button key={i} role="menuitem" className={it.peligro ? 'danger' : it.on ? 'on' : ''} disabled={it.disabled} onClick={() => { if (!it.queda) onClose(); it.fn(); }}><span className="fmenu-i">{it.ic}</span>{it.txt}</button>)}
  </div>, document.body);
}

// Colores de los grupos de piezas que van juntas (distintos de los de las órdenes)
const GJ_PAL = ['#2F9E9E', '#C17D11', '#7A6FCB', '#D4589A', '#6A9F2E', '#C9A227'];
// Alineación (25/11): estas columnas a la izquierda; el resto de los datos centrados en la celda
const COL_IZQ = new Set(['orden', 'cliente', 'nombre', 'inicio', 'fin', 'ops']);
const colsDe = tipo => [...(tipo === 'rep' ? [['orden', 'OV/OC', 148], ['cliente', 'Cliente', 160]] : []), ['nombre', 'Pieza', 300], ['cant', 'Cant.', 66], ...(tipo === 'rep' ? [['restan', 'Restan', 84]] : []), ['prioridad', 'Prioridad', 108], ['estado', 'Estado', 118], ['operacion', 'Operación', 130], ['ops', 'Operarios', 150], ['turno', 'Turno', 92], ['hh', 'Duración', 132], ['inicio', 'Inicio', 190], ['fin', 'Fin', 190], ['real', 'HH real', 80], ['tot', 'Hijos plan / real', 160], ['avance', 'Avance %', 86]];
// Suma de los hijos de un padre (plan y real de todo lo que tiene adentro), sin el trabajo propio del padre
// ---- Restan (25/11): lo que falta fabricar de un repuesto (entregas parciales) ----
const conRest = t => E.conRestan(t);
const restanVis = t => t.estado === 'terminada' ? 0 : E.restanDe(t);
const cantTxt = t => E.conRestan(t) && t.estado !== 'terminada' ? `${E.restanDe(t)} de ${t.cant}` : t.cant;
// No resta nada: con horas hechas se finaliza ahora; sin horas, como finalizada sin día puntual (se entregó de otro lado)
const finRestan = (s, id) => { const x = s.tareas.find(y => y.id === id); if (!x || x.estado === 'terminada') return s; const h = E.llevado(s, x); return h > 0 ? E.finalizar(s, id, h, true) : E.setEstado(s, id, 'sinfecha'); };
function aplicarRestan(S, up, ui, id, v, op = {}) {
  const t = S.tareas.find(x => x.id === id); if (!t) return;
  let sep = 0; up(s => { const r = E.ponerRestan(s, id, v, op); sep = r.sep; return r.S; });
  const n = v === '' || v == null ? null : Number(String(v).replace(',', '.'));
  if (sep) ui.toast(`Entrega parcial: ${sep} ${sep === 1 ? 'unidad quedó finalizada' : 'unidades quedaron finalizadas'} con las horas hechas y ${n === 1 ? 'resta 1' : 'restan ' + n}. Podés deshacerlo arriba.`);
  if (n === 0 && t.estado !== 'terminada') ui.confirmar({ titulo: '¿Pasarla a finalizada?', texto: `No resta nada por fabricar de "${t.nombre}". ${E.llevado(S, t) > 0 ? 'Se finaliza ahora con las horas que lleva.' : 'Queda como finalizada sin día puntual, sin horas.'} Podés deshacerlo arriba.`, si: 'Sí, finalizar', onSi: () => { up(s => finRestan(s, id)); ui.toast('Finalizada'); } });
}
const hijosDe = (V, id) => (V.kids[id] || []).reduce((a, c) => { const x = V.SUB[c.id] || V.D[c.id]; return { hh: a.hh + (x.hh || 0), hhReal: a.hhReal + (x.hhReal || 0) }; }, { hh: 0, hhReal: 0 });
function TaskTable({ roots, tipo, vis, collapsed, toggle, orden, universo }) {
  const { S, V, up, ui } = useApp(); const own = useSet();
  const col = collapsed || own[0], tog = toggle || own[1];
  const cols = colsDe(tipo), WK = 'produccionapp-cols5-' + tipo;
  const [W, setW] = useState(() => { const d = Object.fromEntries(cols.map(c => [c[0], c[2]])); try { return { ...d, ...JSON.parse(localStorage.getItem(WK) || '{}') }; } catch (e) { return d; } });
  useEffect(() => { try { localStorage.setItem(WK, JSON.stringify(W)); } catch (e) { } }, [W]);
  const resize = (e, k) => { e.preventDefault(); const x0 = e.clientX, w0 = W[k];
    const mv = ev => setW(p => ({ ...p, [k]: Math.max(44, w0 + ev.clientX - x0) })); const end = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', end); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', end); };
  // Filtros: uno por sección (Repuestos, Proyectos, Post Venta o Taller)
  const pr0 = tipo === 'proy' && roots[0] ? S.proyectos.find(p => p.id === roots[0].proyId) : null;
  const FK = 'produccionapp-filtros-' + (tipo === 'rep' ? 'rep' : pr0 && pr0.pv ? 'pv' : pr0 && pr0.tl ? 'tl' : 'proy');
  const [FL, setFL] = useFiltros(FK); const [fpop, setFpop] = useState(null); const [menu, setMenu] = useState(null);
  const activos = Object.keys(FL.f).filter(k => FL.f[k] && cols.some(c => c[0] === k));
  const pasa = (t, sin) => activos.every(k => k === sin || valF(S, V, k, t).some(v => FL.f[k].includes(v)));
  // Una fila se ve si cumple los filtros o si tiene adentro alguna pieza que los cumple (así no se pierde el árbol)
  const visCon = sin => { const memo = new Map(); const ok = t => { if (memo.has(t.id)) return memo.get(t.id); let r = !vis || vis(t);
      if (r && activos.some(k => k !== sin)) r = pasa(t, sin) || (V.kids[t.id] || []).some(ok); memo.set(t.id, r); return r; }; return ok; };
  const visF = activos.length ? visCon(null) : vis;
  const so = FL.s && cols.some(c => c[0] === FL.s.k) ? FL.s : null;
  const ordenF = so ? l => (orden || (x => x))(l).map((t, i) => [t, ordV(S, V, so.k, t), i]).sort((a, b) => (a[1] < b[1] ? -so.d : a[1] > b[1] ? so.d : 0) || a[2] - b[2]).map(x => x[0]) : orden;
  const rows = flatten(roots, V, col, visF, ordenF);
  const verIds = new Set(rows.map(r => r.t.id));
  // Lista de valores de una columna: lo que queda visible con los demás filtros (como en Excel).
  // En Repuestos, "universo" son todas las órdenes (de todos los grupos), porque los grupos comparten el filtro.
  const valoresDe = k => { const cnt = new Map(); flatten(universo || roots, V, new Set(), visCon(k)).forEach(({ t }) => valF(S, V, k, t).forEach(v => cnt.set(v, (cnt.get(v) || 0) + 1)));
    (FL.f[k] || []).forEach(v => { if (!cnt.has(v)) cnt.set(v, 0); });
    return [...cnt.keys()].sort(cmpVal(k)).map(v => ({ v, n: cnt.get(v) })); };
  const abrirF = (e, c) => { e.stopPropagation(); if (fpop && fpop.k === c[0]) { setFpop(null); return; } const r = e.currentTarget.closest('th').getBoundingClientRect(); setFpop({ k: c[0], titulo: c[1], x: r.left, y: r.bottom + 2 }); };
  const ponerF = (k, v) => setFL(p => ({ ...p, f: { ...p.f, [k]: v } }));
  const borrarTodo = () => setFL(() => ({ f: {}, s: null }));
  const [sel, setSel] = useState(() => new Set()); const togSel = id => setSel(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const vivos = [...sel].filter(id => V.byId[id]); const todos = rows.length > 0 && rows.every(r => sel.has(r.t.id));
  // con filtros activos, de un ensamblaje elegido solo se toman las piezas que se ven
  const hojasSel = () => { const set_ = new Set(); vivos.forEach(id => { if (V.D[id].parent) E.descendants(S, id).forEach(d => { if (!V.D[d].parent && (!activos.length || verIds.has(d))) set_.add(d); }); else set_.add(id); }); return S.tareas.filter(t => set_.has(t.id)).sort((a, b) => (a.inicio || '9') < (b.inicio || '9') ? -1 : 1).map(t => t.id); };
  const enBloque = (que, val) => { if (!val) return; const ids = hojasSel(); let n = 0;
    up(s => { let s2 = s;
      if (que === 'prioridad') { const all = new Set([...vivos, ...ids]); n = all.size; return { ...s2, tareas: s2.tareas.map(t => all.has(t.id) ? { ...t, prioridad: val } : t) }; }
      ids.forEach(id => { const t = s2.tareas.find(x => x.id === id); if (!t || t.estado === 'terminada') return; n++;
        if (que === 'op') s2 = E.darA(s2, id, val, E.nextFree({ ...s2, tareas: s2.tareas.filter(x => x.id !== id) }, val, t.turno || 'normal', [val], t));
        else if (que === 'operacion') s2 = E.patchTask(s2, id, { operacionId: val, opAuto: false });
        else if (que === 'turno') s2 = E.patchTask(s2, id, { turno: val }, true); });
      return s2; });
    ui.toast(n ? `Cambiadas ${n} ${n === 1 ? 'tarea' : 'tareas'}` : 'Nada para cambiar: las seleccionadas están finalizadas'); };
  // Estado en bloque: sobre las piezas con trabajo propio de lo seleccionado (igual que operario, operación y turno).
  // "En proceso" no está: iniciar corta lo que ese operario tenga corriendo, así que se sigue haciendo de a una (Taller o fila).
  const estadoEnBloque = val => { if (!val) return;
    const cambia = t => !esTerc(t) && (val === 'proximo' ? !E.esProximo(t) && t.estado !== 'terminada' : val === 'pendiente' ? estDe(t) !== 'pendiente' : val === 'terminada' ? (t.estado !== 'terminada' || t.sinFecha) : !sinF(t));
    const ids = hojasSel().filter(id => { const t = S.tareas.find(x => x.id === id); return t && cambia(t); });
    if (!ids.length) { ui.toast('Nada para cambiar: las piezas elegidas ya están en ese estado (las tercerizadas se vuelven a planta desde su editor)'); return; }
    const txt = val === 'pendiente' ? 'pendiente' : val === 'proximo' ? 'próximo a realizar' : val === 'terminada' ? 'finalizada' : 'finalizada, sin día puntual';
    const aplicar = () => { up(s => ids.reduce((a, id) => { const t = a.tareas.find(x => x.id === id); if (!t) return a;
        if (val === 'terminada' && t.estado === 'terminada') { const l = E.llevado(a, t); return E.finalizarYEncadenar(a, id, l > 0 ? l : t.hhReal).S; }   // era "sin día puntual": ahora con fin real
        return E.setEstado(a, id, val); }, s));
      ui.toast(`${ids.length} ${ids.length === 1 ? 'pieza pasó' : 'piezas pasaron'} a ${txt}. Podés deshacerlo arriba.`); };
    if (val === 'pendiente' || val === 'proximo') aplicar();
    else ui.confirmar({ titulo: `¿Pasar ${ids.length} ${ids.length === 1 ? 'pieza' : 'piezas'} a ${txt}?`, texto: 'Las horas reales quedan como están (o las que lleva el cronómetro). Podés deshacerlo arriba.', si: 'Sí, cambiar', onSi: aplicar }); };
  const borrarSel = () => { const ids = vivos; up(s => ids.reduce((a, id) => a.tareas.some(t => t.id === id) ? E.delTask(a, id) : a, s)); setSel(new Set()); ui.toast(`Borradas ${ids.length}. Podés deshacerlo arriba.`); };
  const set = (t, patch, mover) => up(s => E.patchTask(s, t.id, patch, !!mover));
  const mover = (t, dir) => { const sib = orden(S.tareas.filter(x => x.parentId === t.parentId && x.tipo === t.tipo && x.proyId === t.proyId)); const i = sib.findIndex(x => x.id === t.id), j = i + dir;
    if (j < 0 || j >= sib.length) return; const l = sib.slice(); [l[i], l[j]] = [l[j], l[i]]; const pos = {}; l.forEach((x, k) => { pos[x.id] = (k + 1) * 10; });
    up(s => ({ ...s, tareas: s.tareas.map(x => pos[x.id] !== undefined && x.pos !== pos[x.id] ? { ...x, pos: pos[x.id] } : x) })); };
  const setEstado = (t, e) => e === 'terminada' && (t.estado !== 'terminada' || t.sinFecha) ? cerrarTarea(up, ui, t.id) : e === 'en proceso' && t.estado !== 'en proceso' ? iniciarConAviso(S, up, ui, t.id) : up(s => E.setEstado(s, t.id, e));
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
    {!r.parent && E.esProximo(t) && <span className="mk prox" title="Próximo a realizar">⏭</span>}
    {t.corte && <span className="mk" title="Corte de material: parte de la misma pieza (suma sus horas)">✂</span>}
    {t.manual && r.estado !== 'terminada' && <button className="mk pin" title="Fecha fijada a mano: no se corre por etapas. Tocá para soltarla." onClick={() => set(t, { manual: false }, true)}>📌</button>}
    {t.entParcial && <span className="mk" title="Parte de este repuesto que ya se entregó: se separó al bajar Restan, con las horas que llevaba">entrega parcial</span>}
    {r.estado === 'terminada' && !esTerc(t) && <span className={'mk ok' + (r.sin0 ? ' w0' : '')} title={r.sin0 ? aviso0(r) : t.finReal ? 'Finalizada el ' + fDT(t.finReal) : 'Finalizada'}>✓</span>}
    {sinF(t) && !esTerc(t) && <span className="mk warn" title={SINF_TXT}>!</span>}
    {esTerc(t) && <span className="mk terc" title={tercTxt(t) + (t.tercNota ? ' · ' + t.tercNota : '')}>↗ Tercerizada{t.tercFecha ? ' · vuelve ' + fD(t.tercFecha) : ''}</span>}
    {late && <span className="mk bad" title={`Se pasa ${E.diffDays(t.entrega, r.fin.slice(0, 10))} días de la entrega del ${fD(t.entrega)}`}>+{E.diffDays(t.entrega, r.fin.slice(0, 10))}d</span>}
    {!late && !t.parentId && t.entrega && r.estado !== 'terminada' && <span className="mk" title={`Entrega comprometida: ${fD(t.entrega)}`}>{fD(t.entrega)}</span>}
    {E.estaFrenada(t) && <button className="mk warn" title={`Frenada · ${txtFreno(t)}${t.frenada.nota ? ' · ' + t.frenada.nota : ''}. Tocá para retomarla.`} onClick={() => ui.modal({ k: 'retomar', id: t.id })}>⏸</button>}
    {t.empuje && <span className="mk warn" title={`Empujada: estaba para ${fDT(t.empuje)}. Dale el OK en Producción.`}>↦</span>}
    {!r.ok && !r.parent && <button className="mk bad" title={`Faltan ${fN(r.falta)} h extra por habilitar en el calendario. Tocá para habilitarlas.`} onClick={() => ui.modal({ k: 'extras', ids: [t.id] })}>!h</button>}
    {esp && <span className="mk" title={`Espera a "${esp.nombre}"${esp.fin ? ', que termina ' + fDT(esp.fin) : ', que todavía no está programada'}. Por eso no se adelanta.`}>⧖</span>}</>; };
  const accionesDe = (t, r) => { const prox = E.esProximo(t);
    return [
      { ic: '✎', txt: 'Editar todos los datos', fn: () => ui.modal({ k: 'task', id: t.id }) },
      ...(!r.parent && E.esPend(t) ? [{ ic: '⏭', txt: prox ? 'Quitar de Próximo a realizar' : 'Marcar como Próximo a realizar', on: prox, fn: () => { up(s => E.setProximo(s, t.id, !prox)); ui.toast(!prox ? 'Marcada como Próximo a realizar' : 'Quitada de Próximo a realizar'); } }] : []),
      { ic: '＋', txt: 'Agregar hijo', fn: () => ui.modal({ k: 'task', draft: { ...E.blankTask(t.tipo, t.proyId), parentId: t.id, prioridad: t.prioridad } }) },
      { ic: '⧉', txt: 'Duplicar', fn: () => { up(s => E.dupTask(s, t.id)); ui.toast('Duplicada'); } },
      ...(E.puedeCorte(S, t) ? [{ ic: '✂', txt: 'Agregar corte de material', fn: () => ui.modal({ k: 'corte', id: t.id }) }] : []),
      ...(t.nombre && !E.esGrupo(S, t) ? [{ ic: '▦', txt: 'Ficha de material', fn: () => ui.ficha({ key: E.claveCod(t.nombre.replace(/\s*\(parte \d+\)\s*$/i, '')), nombre: t.nombre }) }] : []),
      ...(orden && !so ? ['-', { ic: '▲', txt: 'Subir (orden manual)', queda: true, fn: () => mover(t, -1) }, { ic: '▼', txt: 'Bajar (orden manual)', queda: true, fn: () => mover(t, 1) }] : []),
      '-',
      { ic: '✕', txt: 'Borrar', peligro: true, fn: () => ui.confirmar({ titulo: '¿Borrar esta tarea?', texto: `Se borra "${t.nombre || '(sin nombre)'}"${(V.kids[t.id] || []).length ? ' con todo lo que tiene adentro' : ''}. Podés deshacerlo arriba.`, si: 'Sí, borrar', peligro: true, onSi: () => { up(s => E.delTask(s, t.id)); ui.toast('Borrada. Podés deshacerlo arriba.'); } }) }]; };
  const abrirMenu = (e, t) => { e.stopPropagation(); if (menu && menu.id === t.id) { setMenu(null); return; } const b = e.currentTarget.getBoundingClientRect(); setMenu({ id: t.id, x: b.left, y: b.bottom + 2, top: b.top }); };
  // Piezas que van juntas (25/11): cada padre de primer nivel con lo que tiene adentro (hijas o partes) es un grupo,
  // con una barra de color a la izquierda que une sus filas y un fondo suave del mismo color; las partes dicen "parte 2 de 3".
  const GJ = {}; { let gi = -1, cur = null; rows.forEach(({ t, depth, hasKids }, i) => { if (depth === 0) cur = hasKids ? ++gi : null; if (cur === null) return;
    const sig = rows[i + 1]; GJ[t.id] = { c: GJ_PAL[cur % GJ_PAL.length], ini: depth === 0, fin: !sig || sig.depth === 0 }; }); }
  const marcaJunta = t => { if (t.parte && t.parentId) { const ps = (V.kids[t.parentId] || []).filter(x => x.parte); const i = ps.findIndex(x => x.id === t.id);
      return ps.length > 1 && i >= 0 ? <span className="tjun" title={`Parte ${i + 1} de ${ps.length} de la misma pieza: se suman para las horas, el promedio y el costo`}>{t.corte ? '✂ ' : ''}parte {i + 1} de {ps.length}</span> : null; }
    if (t.partes) { const n = (V.kids[t.id] || []).filter(x => x.parte).length; return n ? <span className="tjun tjun-p" title="Pieza partida (por una pausa, un cambio de turno o el corte de material): suma sus partes">partida en {n}</span> : null; }
    return null; };
  // Flechas de la pieza original a sus partes (26/11): al partirse (pausa, frenada, cambio de turno o corte de material)
  // una línea baja desde la pieza original y una flecha llega a cada parte; la última cierra la línea.
  const conector = (t, depth, hasKids) => {
    if (t.partes && hasKids && !col.has(t.id)) return <i className="tcon-ini" style={{ left: depth * 14 + 8 }} aria-hidden="true" />;
    const p = t.parte && t.parentId && V.byId[t.parentId]; if (!p || !p.partes || depth < 1) return null;
    const ps = (V.kids[p.id] || []).filter(x => x.parte), ult = ps[ps.length - 1] === t || !rows.some((x, i) => i > rows.findIndex(y => y.t.id === t.id) && x.t.parentId === p.id);
    return <i className={'tcon' + (ult ? ' ult' : '')} style={{ left: (depth - 1) * 14 + 8, width: 22 }} aria-hidden="true"><b /></i>; };
  const cell = (k, t, depth, hasKids, r) => {
    switch (k) {
      case 'orden': return !t.parentId ? <EdIn value={t.orden} placeholder="OV-0000" onCommit={v => set(t, { orden: v.trim() })} /> : null;
      case 'cliente': return !t.parentId ? <EdIn value={t.cliente} onCommit={v => set(t, { cliente: v.trim() })} /> : null;
      case 'nombre': return <div className="tname" style={{ paddingLeft: depth * 14 }}>{conector(t, depth, hasKids)}{hasKids ? <button className="tog" onClick={() => tog(t.id)} aria-label="Desplegar">{col.has(t.id) ? '▸' : '▾'}</button> : <span className="tog" />}<EdIn value={t.nombre} placeholder="(sin nombre)" onCommit={v => set(t, { nombre: v, ...(r.parent ? {} : E.autoCompletar(S, { ...t, nombre: v }, false)) })} />{marcaJunta(t)}</div>;
      case 'cant': return <EdIn className="num" type="number" min="0" value={t.cant} onCommit={v => conRest(t) ? aplicarRestan(S, up, ui, t.id, t.restan, { cant: num(v) }) : set(t, { cant: num(v) })} />;
      case 'restan': return r.parent ? <span className="ro num mut" title="Lo que resta se carga en cada pieza hija">—</span> : r.estado === 'terminada' ? <span className="ro num mut" title="Finalizada: no resta nada">0</span> : <EdIn className={'num' + (conRest(t) ? ' rest' : '')} type="number" min="0" value={conRest(t) ? t.restan : ''} placeholder={String(Number(t.cant) || 0)} title="Lo que falta fabricar (entregas parciales). Vacío = toda la cantidad." onCommit={v => aplicarRestan(S, up, ui, t.id, v)} />;
      case 'prioridad': return <select className={'ci p-' + t.prioridad} value={t.prioridad} onChange={e => set(t, { prioridad: e.target.value })} aria-label="Prioridad"><option>alta</option><option>media</option><option>baja</option></select>;
      case 'estado': return r.parent ? <span className={'est e-' + r.estado.replace(' ', '') + (r.estado === 'terminada' && r.sin0 ? ' w0' : '')} title={r.estado === 'terminada' && r.sin0 ? aviso0(r) : undefined}>{estTxt(r.estado)}{r.estado === 'terminada' && r.sin0 ? ' ⚠' : ''}</span> : esTerc(t) ? <span className="est e-terc" title={tercTxt(t) + (t.tercNota ? ' · ' + t.tercNota : '')}>↗ tercerizada</span> : <select className={'ci est e-' + estDe(t).replace(' ', '')} value={sinF(t) ? 'sinfecha' : estDe(t)} onChange={e => setEstado(t, e.target.value)} aria-label="Estado"><option>pendiente</option><option value="proximo">próximo a realizar</option><option>en proceso</option><option value="terminada">finalizada</option><option value="sinfecha">finalizada, sin fecha</option></select>;
      case 'operacion': return r.parent ? null : <select className={'ci' + (t.opAuto ? ' auto' : '')} title={t.opAuto ? 'Asignada automáticamente por el código o por las veces anteriores' : undefined} value={t.operacionId} onChange={e => set(t, { operacionId: e.target.value, opAuto: false })} aria-label="Operación"><option value="">—</option>{S.operaciones.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select>;
      case 'ops': return r.parent ? <span className="ro">{r.ops.map(o => opName(S, o)).join(', ')}</span> : <OpsCell t={t} />;
      case 'turno': return r.parent ? null : <select className="ci" value={t.turno} onChange={e => { const v = e.target.value; if ((E.llevado(S, t) > 0 || Number(t.avance) > 0) && t.estado !== 'terminada') { up(s => E.pasarTurno(s, t.id, v)); ui.toast(`Lo hecho quedó en ${t.turno === 'extra' ? 'horas extra' : 'turno normal'}; lo que falta sigue en ${v === 'extra' ? 'horas extra' : 'turno normal'}`); } else set(t, { turno: v }, true); }} aria-label="Turno"><option value="normal">Normal</option><option value="extra">Extra</option><option value="ambos">Normal + extra</option></select>;
      case 'hh': return r.parent ? <span className="ro num">{fN(r.hh)}</span> : <div className="hhc"><EdIn className="num" type="number" min="0" step="0.5" value={t.hh} onCommit={v => set(t, { hh: num(v) }, true)} /><CalcBtn className="tcalc" cant={E.unidadesDe(t)} titulo={t.nombre + ' · duración'} onUse={v => set(t, { hh: Math.round(v * 100) / 100 }, true)} />{t.ops.length > 1 && <small title="Duración en calendario: horas-hombre dividido la cantidad de operarios">÷{t.ops.length} = {fN(r.durCal)}</small>}</div>;
      case 'inicio': return r.parent ? <span className="ro">{fDT(r.inicio)}</span> : <EdIn type="datetime-local" value={t.inicio || ''} onCommit={v => { set(t, { inicio: v || null }, true); const p = v ? E.pisadasDe(S, { ...t, inicio: v }) : []; if (p.length) ui.toast(`Ojo: ${opName(S, p[0].op)} está ocupado con "${p[0].tarea.nombre}" hasta ${fDT(p[0].fin)}. Abrí la tarea para que empiece cuando se libere.`); }} />;
      case 'fin': return r.parent ? <span className="ro">{fDT(r.fin)}</span> : <EdIn type="datetime-local" value={r.fin || ''} disabled={!t.inicio} onCommit={v => setFin(t, v)} />;
      case 'real': { if (r.parent) return <span className="ro num">{r.hhReal > 0 ? fN(r.hhReal) : '—'}</span>; const dif = r.hhReal > 0 ? r.hhReal - (r.estado === 'terminada' ? r.hh : r.hh * r.avance / 100) : 0; return <div className="hhc"><EdIn className={'num ' + (dif > 0.05 ? 'c-bad' : dif < -0.05 ? 'c-ok' : '')} type="number" min="0" step="0.5" value={t.hhReal || ''} placeholder="—" onCommit={v => set(t, { hhReal: num(v) })} /><CalcBtn className="tcalc" cant={E.unidadesDe(t)} titulo={t.nombre + ' · horas reales'} onUse={v => set(t, { hhReal: Math.round(v * 100) / 100 })} /></div>; }
      case 'tot': { if (!hasKids) return null; const hj = hijosDe(V, t.id);   // padres: suma de sus hijos (el tiempo propio del padre queda en Duración y HH real)
        return <span className="ro num tot" title={`Suma de sus hijos: ${fN(hj.hh)} HH planificadas · ${hj.hhReal > 0 ? fN(hj.hhReal) : '0'} HH reales`}><b>{fN(hj.hh)}</b> / {hj.hhReal > 0 ? fN(hj.hhReal) : '—'}</span>; }
      case 'avance': return r.parent ? <span className="ro num">{Math.round(r.avance)}</span> : <EdIn className="num" type="number" min="0" max="100" step="5" value={Math.round(r.avance)} disabled={t.estado === 'terminada'} onCommit={v => { const a = Math.min(100, num(v)); if (a >= 100) { cerrarTarea(up, ui, t.id, undefined, false, 'Finalizada: pasó a la lista de finalizadas'); return; } set(t, { avance: a, estado: a > 0 && E.esPend(t) ? 'en proceso' : t.estado }); }} />;
      default: return null;
    }
  };
  return <>{vivos.length > 0 && <div className="bulk"><b>{vivos.length} {vivos.length === 1 ? 'seleccionada' : 'seleccionadas'}</b>
      <select value="" onChange={e => enBloque('op', e.target.value)} aria-label="Asignar operario"><option value="">Dar a operario…</option>{S.operarios.filter(o => o.activo).map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select>
      <select value="" onChange={e => enBloque('operacion', e.target.value)} aria-label="Operación"><option value="">Operación…</option>{S.operaciones.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select>
      <select value="" onChange={e => enBloque('prioridad', e.target.value)} aria-label="Prioridad"><option value="">Prioridad…</option><option>alta</option><option>media</option><option>baja</option></select>
      <select value="" onChange={e => enBloque('turno', e.target.value)} aria-label="Turno"><option value="">Turno…</option><option value="normal">Normal</option><option value="extra">Extra</option><option value="ambos">Normal + extra</option></select>
      <select value="" onChange={e => estadoEnBloque(e.target.value)} aria-label="Estado"><option value="">Estado…</option><option value="pendiente">Pendiente</option><option value="proximo">Próximo a realizar</option><option value="terminada">Finalizada</option><option value="sinfecha">Finalizada, sin día puntual</option></select>
      <button className="btn sm pri-b" onClick={() => { const ids = vivos.filter(id => !V.D[id].parent); if (!ids.length) { ui.toast('Elegí piezas con trabajo propio (no ensamblajes generales)'); return; } ui.modal({ k: 'lote', ids }); }}>✎ Editar en lote</button>
      <button className="btn sm terc-b" title="Las piezas elegidas las hace un proveedor: quedan finalizadas y tercerizadas" onClick={() => { const ids = vivos.filter(i => !V.D[i].parent && V.D[i].estado !== 'terminada'); if (!ids.length) { ui.toast('Elegí piezas sin finalizar y sin piezas hijas'); return; } ui.modal({ k: 'tercerizar', ids }); }}>↗ Tercerizar</button>
      <span className="sp" /><button className="btn sm danger" onClick={() => ui.confirmar({ titulo: '¿Borrar las tareas seleccionadas?', texto: `Se borran ${vivos.length} tarea${vivos.length === 1 ? '' : 's'}. Podés deshacerlo arriba.`, si: 'Sí, borrar', peligro: true, onSi: borrarSel })}>Borrar</button><button className="btn sm" onClick={() => setSel(new Set())}>Quitar selección</button></div>}
    {(activos.length > 0 || so) && <div className="fbar"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h12l-4.6 5.4V13l-2.8 1.4V8.4z" /></svg>
      {activos.map(k => { const c = cols.find(x => x[0] === k); const l = FL.f[k]; return <span key={k} className="fchip"><b>{c[1]}:</b> {l.length <= 2 ? l.join(', ') : `${l.slice(0, 2).join(', ')} y ${l.length - 2} más`}<button title="Quitar este filtro" aria-label={'Quitar filtro de ' + c[1]} onClick={() => ponerF(k, null)}>✕</button></span>; })}
      {so && <span className="fchip"><b>Orden:</b> {cols.find(x => x[0] === so.k)[1]} {so.d === 1 ? '↑' : '↓'}<button title="Volver al orden normal" aria-label="Quitar orden" onClick={() => setFL(p => ({ ...p, s: null }))}>✕</button></span>}
      <span className="mut">{rows.length} {rows.length === 1 ? 'fila' : 'filas'} a la vista</span><span className="sp" />
      <button className="btn sm" onClick={borrarTodo}>Borrar filtros y orden</button></div>}
    {menu && V.byId[menu.id] && <FilaMenu pos={menu} items={accionesDe(V.byId[menu.id], V.D[menu.id])} onClose={() => setMenu(null)} />}
    {fpop && <FiltroPop key={fpop.k} k={fpop.k} titulo={fpop.titulo} pos={fpop} valores={valoresDe(fpop.k)} elegidos={FL.f[fpop.k] || null} orden={so && so.k === fpop.k ? so.d : 0}
      onOk={v => { ponerF(fpop.k, v); setFpop(null); }} onOrden={d => { setFL(p => ({ ...p, s: d ? { k: fpop.k, d } : null })); setFpop(null); }} onClose={() => setFpop(null)} />}
    <div className="scroll xlw"><table className="tt xl" onKeyDown={nav} style={{ width: cols.reduce((a, c) => a + W[c[0]], 0) }}>
    <colgroup>{cols.map(c => <col key={c[0]} style={{ width: W[c[0]] }} />)}</colgroup>
    <thead><tr>{cols.map((c, i) => <th key={c[0]} className={COL_IZQ.has(c[0]) ? undefined : 'cc'}>{i === 0 && <input type="checkbox" className="selc" aria-label="Seleccionar todas" checked={todos} onChange={() => setSel(todos ? new Set() : new Set(rows.map(r => r.t.id)))} />}<span>{c[1]}</span>{FILTRABLES.has(c[0]) && <button className={'fbtn' + (FL.f[c[0]] ? ' on' : '') + (so && so.k === c[0] ? ' ord' : '')} title={FL.f[c[0]] ? `Filtrado: ${FL.f[c[0]].length} ${FL.f[c[0]].length === 1 ? 'valor' : 'valores'}. Tocá para cambiarlo.` : 'Filtrar u ordenar esta columna'} aria-label={'Filtrar ' + c[1]} onClick={e => abrirF(e, c)}>{so && so.k === c[0] ? (so.d === 1 ? '↑' : '↓') : ''}{FL.f[c[0]] ? <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h12l-4.6 5.4V13l-2.8 1.4V8.4z" /></svg> : '▾'}</button>}<i className="rz" title="Arrastrá para ajustar el ancho. Doble clic para volver al ancho original." onPointerDown={e => resize(e, c[0])} onDoubleClick={() => setW(p => ({ ...p, [c[0]]: c[2] }))} /></th>)}</tr></thead>
    <tbody>
      {rows.length === 0 && <tr><td colSpan={cols.length} className="mut pad">{activos.length ? <>Ninguna tarea cumple los filtros. <button className="lnk sm" onClick={borrarTodo}>Borrar filtros</button></> : 'No hay tareas para mostrar. Cargá una a mano o importá una planilla.'}</td></tr>}
      {rows.map(({ t, depth, hasKids }) => { const r = V.D[t.id]; const oc = tipo === 'rep' && !t.parentId ? E.chipOf(S, V, t).color : null;
        const gj = GJ[t.id];
        return <tr key={t.id} data-id={t.id} style={gj ? { '--gc': gj.c } : undefined} className={(hasKids ? 'par ' : '') + (r.parent ? 'grp ' : hasKids ? 'trab ' : '') + (gj ? 'gj ' + (gj.ini ? 'gj-i ' : '') + (gj.fin ? 'gj-f ' : '') : '') + (r.estado === 'terminada' ? 'done ' : '') + (esTerc(t) ? 'terc ' : '') + (sel.has(t.id) ? 'selr' : '')}>{cols.map((c, i) => <td key={c[0]} tabIndex={-1} className={COL_IZQ.has(c[0]) ? undefined : 'cc'} style={i === 0 && oc && !gj ? { boxShadow: `inset 3px 0 ${oc}` } : undefined}>{i === 0 ? <div className="c0"><input type="checkbox" className="selc" aria-label="Seleccionar" checked={sel.has(t.id)} onChange={() => togSel(t.id)} /><button className={'fmenu-b' + (menu && menu.id === t.id ? ' on' : '')} title="Acciones: editar, próximo a realizar, agregar hijo, duplicar, borrar…" aria-label="Acciones de la fila" aria-haspopup="menu" onClick={e => abrirMenu(e, t)}>⋮</button>{cell(c[0], t, depth, hasKids, r)}{marcas(t, hasKids, r)}</div> : cell(c[0], t, depth, hasKids, r)}</td>)}</tr>; })}
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
    <div className="sec-h"><h3>Órdenes cargadas y finalizadas por mes</h3>
      <div className="row"><div className="seg">{[['', 'Todas'], ['OV', 'OV'], ['OC', 'OC']].map(([k, l]) => <button key={k} className={f === k ? 'on' : ''} onClick={() => setF(k)}>{l}</button>)}</div>
        <button className="btn sm" onClick={() => setTabla(!tabla)}>{tabla ? 'Ver gráfico' : 'Ver tabla'}</button></div></div>
    <div className="lgd"><span><i style={{ background: 'var(--s1)' }} />Cargadas</span><span><i style={{ background: 'var(--s2)' }} />Finalizadas</span></div>
    {tabla ? <div className="scroll"><table className="tt"><thead><tr><th>Mes</th><th className="num">Cargadas</th><th className="num">Finalizadas</th><th className="num">Diferencia</th></tr></thead>
      <tbody>{data.map(d => <tr key={d.k}><td>{lab(d.k)}</td><td className="num">{d.c}</td><td className="num">{d.t}</td><td className="num">{d.c - d.t > 0 ? '+' : ''}{d.c - d.t}</td></tr>)}</tbody></table></div>
      : <div className="bc"><div className="bc-y" style={{ height: H }}>{[top, top / 2, 0].map(v => <span key={v} style={{ bottom: v / top * H }}>{v}</span>)}</div>
        <div className="bc-main"><div className="bc-plot" style={{ height: H }}>
          {[top, top / 2].map(v => <i key={v} className="bc-grid" style={{ bottom: v / top * H }} />)}
          {data.map(d => <div key={d.k} className={'bc-g' + (hov === d.k ? ' on' : '')} onMouseEnter={() => setHov(d.k)} onMouseLeave={() => setHov(null)} onFocus={() => setHov(d.k)} onBlur={() => setHov(null)} tabIndex="0" aria-label={`${lab(d.k)}: ${d.c} cargadas, ${d.t} finalizadas`}>
            <div className="bc-b" style={{ height: d.c / top * H, background: 'var(--s1)' }}><b>{d.c}</b></div>
            <div className="bc-b" style={{ height: d.t / top * H, background: 'var(--s2)' }}><b>{d.t}</b></div>
            {hov === d.k && <div className="bc-tip"><b>{lab(d.k)}</b><span><i style={{ background: 'var(--s1)' }} />Cargadas <em>{d.c}</em></span><span><i style={{ background: 'var(--s2)' }} />Finalizadas <em>{d.t}</em></span><span className="mut">{d.c - d.t > 0 ? `Quedaron ${d.c - d.t} sin cerrar` : d.c - d.t < 0 ? `Se cerraron ${d.t - d.c} más de las que entraron` : 'Entraron y salieron las mismas'}</span></div>}
          </div>)}</div>
          <div className="bc-x">{data.map(d => <span key={d.k} className={d.k === mes ? 'cur' : ''}>{lab(d.k)}</span>)}</div></div></div>}
  </div>;
}
/* ================= REPUESTOS ================= */
function Repuestos() {
  const { S, V, ui } = useApp();
  const [mes, setMes] = useState(E.today().slice(0, 7)); const [f, setF] = useState({ e: '', c: '', o: '', p: '', q: '' });
  const [vp, setVp] = useVistaProc(); const [plg, togG, setPlg] = usePlegados('rep-grupos', { terminada: true });
  const roots = S.tareas.filter(t => t.tipo === 'rep' && !t.parentId);
  const ord = {}; roots.forEach(r => { (ord[r.orden || 'S/N'] = ord[r.orden || 'S/N'] || []).push(r); });
  const C = { OV: { p: 0, e: 0, t: 0 }, OC: { p: 0, e: 0, t: 0 } };
  Object.entries(ord).forEach(([o, rs]) => { const c = C[/^\s*OC/i.test(o) ? 'OC' : 'OV'], es = rs.map(r => V.D[r.id].estado);
    if (es.every(e => e === 'terminada')) { const fin = rs.flatMap(r => [r.id, ...E.descendants(S, r.id)]).map(id => V.byId[id].finReal || V.D[id].fin).filter(Boolean).sort().pop(); if (fin && fin.startsWith(mes)) c.t++; }
    else if (es.every(e => e === 'pendiente' || e === 'proximo')) c.p++; else c.e++; });
  const mesTxt = `${E.MESES[Number(mes.slice(5)) - 1]} ${mes.slice(0, 4)}`;
  // Mismos números que la pestaña Estadísticas: HH reales de Repuestos del mes y horas disponibles (con ausencias y extras) hasta hoy
  const mm = useMemo(() => E.estadisticas(S, V), [S, V]).mes[mes] || {}, hh = mm.rep || 0, cap = mm.disp || 0;
  const match = (t, e = f.e) => (!e || (e === 'activas' ? t.estado !== 'terminada' : e === 'proximo' ? E.esProximo(t) : e === 'pendiente' ? estDe(t) === 'pendiente' : t.estado === e)) && (!f.o || t.ops.includes(f.o)) && (!f.p || t.prioridad === f.p);
  const q = f.q.trim().toLowerCase();
  const vis = (t, e = f.e) => { const rt = V.rootOf(t); if (f.c && rt.cliente !== f.c) return false; if (q && !t.parentId && ![rt.orden, rt.cliente, rt.nombre, ...E.descendants(S, rt.id).map(i => V.byId[i].nombre)].join(' ').toLowerCase().includes(q)) return false; const ch = V.kids[t.id] || []; return ch.length ? ch.some(c => vis(c, e)) : match(t, e); };
  const clientes = [...new Set(roots.map(r => r.cliente).filter(Boolean))].sort();
  const sel = (k, opts, lab) => <select id={'rf-' + k} value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} aria-label={lab}><option value="">{lab}</option>{opts.map(o => <option key={o[0]} value={o[0]}>{o[1]}</option>)}</select>;
  return <div className="view">
    <section>
      <div className="sec-h"><h2>Repuestos</h2><div className="row"><label className="mut" htmlFor="rep-mes">Mes</label><input id="rep-mes" type="month" value={mes} onChange={e => e.target.value && setMes(e.target.value)} /></div></div>
      <div className="mcards">
        <div className="mcard"><span className="mt">Órdenes de venta · OV</span><div className="mpair"><div><b>{C.OV.p}</b><em>Pendientes</em></div><div className="m-acc"><b>{C.OV.e}</b><em>En proceso</em></div></div></div>
        <div className="mcard"><span className="mt">Órdenes de stock · OC</span><div className="mpair"><div><b>{C.OC.p}</b><em>Pendientes</em></div><div className="m-acc"><b>{C.OC.e}</b><em>En proceso</em></div></div></div>
        <div className="mcard"><span className="mt">Finalizadas en {mesTxt}</span><div className="mpair m-ok"><div><b>{C.OV.t}</b><em>OV</em></div><div><b>{C.OC.t}</b><em>OC</em></div></div></div>
        <div className="mcard"><span className="mt">Horas dedicadas a repuestos · {mesTxt}</span><div className="mpair"><div><b>{fN(hh)}<small> h</small></b><em>{cap ? `${Math.round(hh / cap * 100)}% de las ${fN(cap)} h disponibles${mes === E.today().slice(0, 7) ? ' hasta hoy' : ''}` : 'Sin horas disponibles en el mes'}</em></div></div>
          <span className="pbar big"><i style={{ width: Math.min(100, cap ? hh / cap * 100 : 0) + '%' }} /></span></div>
      </div>
      <OrdChart ord={ord} mes={mes} />
    </section>
    {(() => { const abr = roots.filter(r => V.D[r.id].estado !== 'terminada'), por = {};
      abr.forEach(r => { const k = String(r.orden || '').toUpperCase().replace(/[^A-Z0-9]/g, '') || '#' + r.id; (por[k] = por[k] || { orden: r.orden, ts: [] }).ts.push(r, ...E.descendants(S, r.id).map(id => V.byId[id]).filter(Boolean)); });
      const ordenes = Object.values(por).map(o => ({ ...o, ts: o.ts.filter(t => vis(t, '')) }));
      return <PendProc donde={'en las órdenes abiertas' + (f.c || f.o || f.p || q ? ' · con los filtros de abajo, sin el de estado' : '')} ts={ordenes.flatMap(o => o.ts)} ordenes={ordenes} />; })()}
    <section>
      <div className="sec-h"><div className="row">
        {sel('e', [['activas', 'Sin las finalizadas'], ['pendiente', 'Pendiente'], ['proximo', 'Próximo a realizar'], ['en proceso', 'En proceso'], ['terminada', 'Finalizada']], 'Todo estado')}<button className="btn sm" onClick={() => { const todos = ['curso', 'pausa', 'proximo', 'pendiente', 'terminada'].every(k => plg[k]); const n = Object.fromEntries(['curso', 'pausa', 'proximo', 'pendiente', 'terminada'].map(k => [k, !todos])); setPlg(n); }}>{['curso', 'pausa', 'proximo', 'pendiente', 'terminada'].every(k => plg[k]) ? 'Abrir grupos' : 'Cerrar grupos'}</button>
        {sel('c', clientes.map(c => [c, c]), 'Todo cliente')}
        {sel('o', S.operarios.map(o => [o.id, o.nombre]), 'Todo operario')}
        <input id="rf-q" type="search" placeholder="Buscar OV, pieza o cliente" value={f.q} onChange={e => setF({ ...f, q: e.target.value })} />
        {sel('p', [['alta', 'Alta'], ['media', 'Media'], ['baja', 'Baja']], 'Toda prioridad')}
      </div><div className="row">
        <button className="btn" onClick={() => ui.tab('tiempos')}>Historial de tiempos →</button>
        <VistaSel v={vp} set={setVp} /><button className="btn" onClick={() => ui.modal({ k: 'imp', mode: 'rep' })}>Importar .xlsx</button><button className="btn" onClick={() => ui.modal({ k: 'plan', alcance: 'rep' })}>Planificar repuestos</button>
        <button className="btn pri-b" onClick={() => ui.modal({ k: 'task', draft: E.blankTask('rep') })}>+ Repuesto</button>
      </div></div>
      {(() => { const corre = id => E.corriendo(V.byId[id]) || (V.kids[id] || []).some(c => corre(c.id));
            const prx = id => E.esProximo(V.byId[id]) || (V.kids[id] || []).some(c => prx(c.id));
            const grupo = r => { const e = V.D[r.id].estado; return e === 'terminada' ? 'terminada' : e === 'pendiente' || e === 'proximo' ? (prx(r.id) ? 'proximo' : 'pendiente') : corre(r.id) ? 'curso' : 'pausa'; };
            const G = [...SECC, ['terminada', 'Finalizadas', 'var(--ok)']];
            const ord_ = roots.slice().sort((a, b) => PRI[a.prioridad] - PRI[b.prioridad]);
            return G.map(([k, l, c]) => { if (vp === 'proceso' && k !== 'terminada') return k === 'curso' ? <TableroProc key="tab" roots={ord_.filter(r => grupo(r) !== 'terminada')} vis={vis} tabla={(rs, v) => <TaskTable roots={rs} tipo="rep" vis={v} universo={ord_} />} /> : null; const rs = ord_.filter(r => grupo(r) === k && vis(r)); if (!rs.length && k !== 'curso') return null;
              return <GrupoEstado key={k} k={k} l={l} c={c} n={rs.length} plg={plg} tog={togG} nota={<>{k === 'pausa' && <span className="mut">empezadas que no se están haciendo ahora</span>}{k === 'proximo' && <span className="mut">órdenes con piezas marcadas para hacer primero</span>}</>}>
                {rs.length ? <TaskTable roots={rs} tipo="rep" vis={vis} universo={ord_} /> : <p className="mut pad">Ningún repuesto en curso en este momento.</p>}</GrupoEstado>; }); })()}
    </section>
  </div>;
}

/* ================= PROYECTOS ================= */
const LETRA = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const prefG = (k, d) => { try { const v = localStorage.getItem('produccionapp-gantt-' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const guardaG = (k, v) => { try { localStorage.setItem('produccionapp-gantt-' + k, JSON.stringify(v)); } catch (e) { } };
function Gantt({ rows, entrega, color, collapsed, toggle, alto, todo, ts }) {
  const { S, V, ui, up } = useApp(); const [arr, setArr] = useState(null); const t0 = E.today(), W = 28;
  const [fila, setFila] = useState(null);   // fila que se está arrastrando para cambiar el orden: { id, sobre, abajo }
  const pad = t => t.parentId || null, mismos = (a, b) => pad(a) === pad(b) && a.tipo === b.tipo && a.proyId === b.proyId;
  const hermanos = t => ordenProy(S)(S.tareas.filter(x => mismos(x, t)));
  const moverFila = (e, t) => { if (e.button !== undefined && e.button !== 0) return; e.preventDefault(); e.stopPropagation(); let dest = null; setFila({ id: t.id });
    const mv = ev => { const el = document.elementFromPoint(ev.clientX, ev.clientY), row = el && el.closest('.g-row[data-id]'); let o = row && V.byId[row.dataset.id], g = 0;
      while (o && !mismos(o, t) && g++ < 50) o = V.byId[o.parentId];   // sobre un hijo de otra pieza: cuenta la pieza del mismo nivel
      if (!o || o.id === t.id) { dest = null; setFila({ id: t.id }); return; }
      const b = row.getBoundingClientRect(); dest = { sobre: o.id, abajo: o.id !== row.dataset.id || ev.clientY > b.top + b.height / 2 }; setFila({ id: t.id, ...dest }); };
    const fin = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', fin); window.removeEventListener('pointercancel', fin); setFila(null); if (!dest) return;
      const l = hermanos(t).map(x => x.id).filter(x => x !== t.id); let k = l.indexOf(dest.sobre); if (k < 0) return; if (dest.abajo) k++; l.splice(k, 0, t.id);
      up(s => E.ordenarHermanos(s, l)); ui.toast('Fila movida. "Ordenar por etapa" (arriba) vuelve al orden automático.'); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', fin); window.addEventListener('pointercancel', fin); };
  // Ordena las filas de cada nivel por cuándo empiezan (lo que no tiene fecha queda al final, en el orden que tenía)
  const porFecha = () => { const lst = ts || rows.map(r => r.t); const g = {}; lst.forEach(t => { const k = (pad(t) || '') + '|' + t.tipo; (g[k] = g[k] || []).push(t); });
    const ini = t => { const r = V.SUB[t.id] || V.D[t.id]; return (r && r.inicio) || '9999'; }; const ord = ordenProy(S);
    let ids = []; Object.values(g).forEach(l => { ids = ids.concat(ord(l).map((t, i) => [t, i]).sort((a, b) => ini(a[0]) < ini(b[0]) ? -1 : ini(a[0]) > ini(b[0]) ? 1 : a[1] - b[1]).map(x => x[0].id)); });
    const grupos = {}; ids.forEach(id => { const t = V.byId[id]; const k = (pad(t) || '') + '|' + t.tipo; (grupos[k] = grupos[k] || []).push(id); });
    up(s => Object.values(grupos).reduce((a, l) => E.ordenarHermanos(a, l), s)); ui.toast('Filas ordenadas por fecha de inicio'); };
  const [lw, setLw] = useState(() => prefG('lw', 320)); const [mas, setMas] = useState(0);
  const box = useRef(null); const [ancho, setAncho] = useState(1200); const yaCentrado = useRef(false);
  useEffect(() => { const el = box.current; if (!el || !window.ResizeObserver) return; const ro = new ResizeObserver(([e]) => setAncho(e.contentRect.width)); ro.observe(el); return () => ro.disconnect(); }, []);
  useEffect(() => { guardaG('lw', lw); }, [lw]);
  const inis = rows.map(r => V.D[r.t.id].inicio).filter(Boolean).sort(), fins = rows.map(r => V.D[r.t.id].fin).filter(Boolean).sort();
  const a = E.monday([inis[0] && inis[0].slice(0, 10), t0].filter(Boolean).sort()[0]);
  const ult = [fins.length && fins[fins.length - 1].slice(0, 10), E.addDays(t0, 13), entrega, ...rows.filter(r => esTerc(r.t)).map(r => r.t.tercFecha)].filter(Boolean).sort().pop();   // incluye la fecha en que vuelven las tercerizadas
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
    <div className="row gbar"><button className="btn sm" onClick={irHoy}>Ir a hoy</button><button className="btn sm" onClick={() => setMas(mas + 1)}>+2 semanas</button><button className="btn sm" title="Ordena las filas de cada ensamblaje según cuándo empiezan. Útil cuando agregaste tareas que quedaron al final de la lista." onClick={porFecha}>↕ Ordenar filas por fecha</button>{todo && <><button className="btn sm" onClick={() => todo(true)} title="Deja a la vista solo los ensamblajes principales">⊟ Contraer todo</button><button className="btn sm" onClick={() => todo(false)}>⊞ Expandir todo</button></>}{mas > 0 && <button className="btn sm" onClick={() => setMas(0)}>Volver al largo normal</button>}
      <span className="mut">Arrastrá una barra para moverla de día (queda fijada a mano 📌). Arrastrá ⠿ para subir o bajar una fila. El borde de la columna Pieza cambia su ancho.</span></div>
    <div ref={box} className={'scroll gantt' + (alto === 'compacto' ? ' compacto' : '')} style={{ '--lw': lw + 'px' }}><div style={{ minWidth: 'max-content' }}>
    <div className="g-row g-head"><div className="g-left"><span>Pieza</span><span className="num">Cant.</span><i className="rz" title="Arrastrá para cambiar el ancho. Doble clic: ancho original." onPointerDown={resize} onDoubleClick={() => setLw(320)} /></div>
      <div className="g-right" style={{ width: N * W, backgroundImage: semanas }}>{days.map((d, i) => { const g = E.dow(d); return <span key={d} className={'g-day' + (d === t0 ? ' hoy' : '') + (E.isWork(S, d) ? '' : ' off')} style={{ left: i * W, width: W }}>
        {(g === 1 || (d.slice(8) === '01' && g >= 2 && g <= 5)) && <em>{E.MESES[Number(d.slice(5, 7)) - 1]}{(i === 0 || d.slice(5) === '01-01' || (g === 1 && d.slice(8) <= '07' && d.slice(5, 7) === '01')) ? ' ' + d.slice(0, 4) : ''}</em>}<small>{LETRA[g]}</small>{Number(d.slice(8))}</span>; })}</div></div>
    {rows.length === 0 && <p className="mut pad">Este proyecto todavía no tiene piezas. Agregá una o importá el árbol desde una planilla.</p>}
    {rows.map(({ t, depth, hasKids }) => { const r = V.D[t.id]; const ok = r.estado === 'terminada'; const xr = esTerc(t) && t.tercFecha ? (E.diffDays(a, t.tercFecha) + 0.5) * W : null; return <div key={t.id} data-id={t.id} className={'g-row' + (hasKids ? ' par' : '') + (ok ? ' done' : '') + (esTerc(t) ? ' terc' : '') + (fila && fila.id === t.id ? ' g-mueve' : '') + (fila && fila.sobre === t.id ? (fila.abajo ? ' g-drop-ab' : ' g-drop-ar') : '')}>
      <div className="g-left"><div className="tname" style={{ paddingLeft: `calc(var(--ind, 14px) * ${depth})` }}>
        <span className="g-grip" title="Arrastrá para subir o bajar la fila" aria-label="Mover fila" onPointerDown={e => moverFila(e, t)}>⠿</span>{hasKids ? <button className="tog" onClick={() => toggle(t.id)} aria-label="Desplegar">{collapsed.has(t.id) ? '▸' : '▾'}</button> : <span className="tog" />}
        {ok && <span className={'g-ok' + (r.sin0 ? ' w0' : '') + (t.tercerizada ? ' terc' : '')} title={t.tercerizada ? tercTxt(t) : r.sin0 ? aviso0(r) : 'Finalizada'}>{t.tercerizada ? '↗' : '✓'}</span>}{sinF(t) && !esTerc(t) && <span className="g-ok w0" title={SINF_TXT}>!</span>}{E.estaFrenada(t) && <span className="g-fren" title={`Frenada · ${txtFreno(t)}`}>⏸</span>}<button className="tlink" title={t.nombre} onClick={() => ui.modal({ k: 'task', id: t.id })}>{t.nombre}</button><button className="g-add" title={'Agregar hijo a ' + t.nombre} aria-label="Agregar hijo" onClick={() => ui.modal({ k: 'task', draft: { ...E.blankTask(t.tipo, t.proyId), parentId: t.id, prioridad: t.prioridad } })}>＋</button></div><span className="num">{t.cant}</span></div>
      <div className="g-right" style={{ width: N * W, backgroundImage: semanas + ',' + bg }}>
        <i className="g-today" style={{ left: xHoy }} />{xEnt !== null && <i className="g-due" style={{ left: xEnt }} />}
        {r.inicio && r.fin && <div className={'g-bar' + (r.parent ? ' par' : '') + (t.empuje && !ok ? ' pushed' : '') + (ok ? ' ok' : '') + (r.sigueProc ? ' sigue' : '') + (t.tercerizada ? ' terc' : '') + (t.manual ? ' manual' : '') + (arr && arr.id === t.id ? ' drag' : '')} style={{ left: x(r.inicio) + (arr && arr.id === t.id ? arr.d * W : 0), width: Math.max(6, x(r.fin) - x(r.inicio)), '--c': color }}
          title={`${t.nombre}: ${fDT(r.inicio)} → ${fDT(r.fin)}${r.parent || ok ? '' : ' · arrastrala para moverla de día'}`} onPointerDown={e => arrastrar(e, t, r)}><span style={{ width: r.avance + '%' }} /></div>}
        {E.estaFrenada(t) && !r.inicio && <span className="g-lab fren" style={{ left: xHoy + 6 }}>⏸ frenada sin fecha · {t.frenada.motivo}</span>}
        {arr && arr.id === t.id && arr.d !== 0 && <span className="g-mov" style={{ left: x(r.inicio) + arr.d * W }}>{arr.d > 0 ? '+' : ''}{arr.d} d · {fD(E.addDays(t.inicio.slice(0, 10), arr.d))}</span>}
        {r.inicio && r.fin && xr === null && <span className={'g-lab' + (ok ? ' ok' : '') + (ok && t.tercerizada ? ' terc' : '') + (ok && r.sin0 ? ' w0' : '')} style={{ left: Math.max(x(r.fin), x(r.inicio) + 6) + 6 }}>{ok ? (t.tercerizada ? '↗ tercerizada' + (t.proveedor ? ' · ' + t.proveedor : '') : t.sinFecha ? '✓ ! finalizada sin fecha' : '✓ finalizada') : Math.round(r.avance) + '%'}{r.sigueProc ? ' · sigue en proceso' : ''}{t.empuje && !ok ? ' · ↦' : ''}</span>}
        {xr !== null && (() => { const x0 = r.inicio && r.fin ? Math.max(x(r.fin), x(r.inicio) + 6) : x(t.finReal || E.nowDT()), pas = t.tercFecha < t0; return <>
          {xr > x0 && <i className="g-tr-line" style={{ left: x0, width: xr - x0 }} />}
          <span className={'g-tr-pin' + (pas ? ' pas' : '')} style={{ left: xr }} title={tercTxt(t) + (t.tercNota ? ' · ' + t.tercNota : '')}>◆</span>
          <span className="g-lab terc" style={{ left: Math.max(xr, x0) + 12 }}>↗ tercerizada{t.proveedor ? ' · ' + t.proveedor : ''} · {pas ? 'debía volver el' : 'vuelve'} {fD(t.tercFecha)}</span></>; })()}
      </div></div>; })}
  </div></div></>;
}
// Desglose de las métricas del proyecto: avance por pieza principal, horas por pieza principal o por operación
// Tareas empezadas o finalizadas que todavía no tienen horas reales: se completan acá mismo
function SinHoras({ ts, prev = 0 }) {
  const { S, V, up, ui } = useApp(); const [ver, setVer] = useState(true);
  const l = ts.filter(t => !V.D[t.id].parent && !t.tercerizada && !t.sinFecha && !(Number(t.hhReal) > 0) && !(t.crono && Number(t.crono.acum) > 0) && !E.corriendo(t) && (t.estado === 'terminada' || Number(t.avance) > 0 || t.estado === 'en proceso'));
  const g = {}; l.forEach(t => { const r = V.rootOf(t); (g[r.id] = g[r.id] || { r, l: [] }).l.push(t); });
  return <div className="sinh"><button className="dgrp-t" onClick={() => setVer(!ver)}><span className="car">{ver ? '▾' : '▸'}</span><b>Tareas sin horas reales cargadas</b><span className={'cnt' + (l.length ? ' warn' : ' ok')}>{l.length}</span><span className="mut">finalizadas o empezadas</span></button>
    {ver && (l.length === 0 ? <p className="mut">Todas las tareas finalizadas o empezadas tienen horas reales.</p> : Object.values(g).map(({ r, l }) => <div key={r.id} className="sinh-g"><b>{r.nombre}</b>
      {l.map(t => { const p = t.parentId && V.byId[t.parentId]; return <div key={t.id} className="sinh-r"><span className={'est e-' + t.estado.replace(' ', '')}>{t.estado === 'terminada' ? 'finalizada' : Math.round(V.D[t.id].avance) + '%'}</span>
        <button className="sn al-t" title="Abrir la tarea para editar todo" onClick={() => ui.modal({ k: 'task', id: t.id })}><b>{t.nombre}</b>{p && p.id !== V.rootOf(t).id && <small className="mut"> · {p.nombre}</small>}</button>
        <span className="mut">{operName(S, t.operacionId)} · {t.ops.map(o => opName(S, o)).join(', ') || 'sin operario'} · plan {fN(t.hh)} h</span>
        <span className="sinh-in"><HorasReales t={t} /><button className="btn sm" title="Abrir la tarea" onClick={() => ui.modal({ k: 'task', id: t.id })}>✎ Editar</button></span></div>; })}</div>))}</div>;
}
// Carga rápida de horas reales: horas y minutos, o "igual al plan"
function HorasReales({ t }) {
  const { up, ui } = useApp(); const [h, setH] = useState(''); const [m, setM] = useState('');
  const guardar = v => { const x = v !== undefined ? v : (Number(String(h).replace(',', '.')) || 0) + (Number(m) || 0) / 60; if (!(x > 0)) { ui.toast('Cargá las horas reales'); return; } const r = Math.round(x * 100) / 100;
    up(s => E.patchTask(s, t.id, { hhReal: r, crono: { acum: r, desde: null } })); ui.toast(`${t.nombre}: ${fHM(r)} reales cargadas`); };
  const enter = e => { if (e.key === 'Enter') { e.preventDefault(); guardar(); } };
  return <span className="hreal"><input className="num" type="number" min="0" step="0.5" placeholder="h" aria-label="Horas" value={h} onChange={e => setH(e.target.value)} onKeyDown={enter} /><span>h</span>
    <input className="num" type="number" min="0" max="59" step="5" placeholder="min" aria-label="Minutos" value={m} onChange={e => setM(e.target.value)} onKeyDown={enter} />
    <CalcBtn cant={E.unidadesDe(t)} titulo={t.nombre} onUse={x => { const tm = Math.round(x * 60); setH(String(Math.floor(tm / 60))); setM(String(tm % 60)); }} />
    <button className="btn sm pri-b" onClick={() => guardar()}>Guardar</button>{t.hh > 0 && <button className="btn sm" title="Cargar como reales las horas planificadas" onClick={() => guardar(Number(t.hh))}>= plan ({fN(t.hh)} h)</button>}</span>;
}
function Desglose({ roots, ts, vista, hhv, setHhv, color, prev = 0, cerrar }) {
  const { S, V } = useApp();
  const filasPadre = roots.map(t => { const r = V.D[t.id]; return { k: t.id, nom: t.nombre, plan: r.hh, real: r.hhReal, av: r.avance, est: r.estado, sin0: r.sin0 }; });
  const ops = {}; ts.forEach(t => { const r = V.D[t.id]; if (r.parent) return; const k = t.operacionId || '_'; const o = ops[k] = ops[k] || { k, nom: k === '_' ? 'Sin operación' : operName(S, k), plan: 0, real: 0, hecho: 0, n: 0 }; o.plan += r.hh; o.real += r.hhReal; o.hecho += r.hh * r.avance / 100; o.n++; });
  const filasOp = Object.values(ops).map(o => ({ ...o, av: o.plan ? o.hecho / o.plan * 100 : 0 })).sort((a, b) => b.plan - a.plan);
  const filas = vista === 'av' ? filasPadre : hhv === 'padre' ? filasPadre : filasOp;
  const max = Math.max(1, ...filas.map(f => Math.max(f.plan, f.real)));
  const tot = filas.reduce((a, f) => ({ plan: a.plan + f.plan, real: a.real + f.real }), { plan: 0, real: prev });   // el total arranca con las horas previas del proyecto
  return <section className="desg">
    <div className="sec-h"><h3>{vista === 'av' ? 'Avance por pieza principal' : 'Horas-hombre del proyecto'}</h3>
      <div className="row">{vista === 'hh' && <div className="seg"><button className={hhv === 'padre' ? 'on' : ''} onClick={() => setHhv('padre')}>Por pieza principal</button><button className={hhv === 'oper' ? 'on' : ''} onClick={() => setHhv('oper')}>Por operación</button></div>}
        <button className="btn sm" onClick={cerrar}>Cerrar</button></div></div>
    {filas.length === 0 && <p className="mut">Este proyecto todavía no tiene piezas.</p>}
    {vista === 'av' ? <div className="dlist">{filas.map(f => <div key={f.k} className="drow">
        <span className="dnom" title={f.nom}>{f.nom}</span>
        <span className={'dprog' + (f.est === 'terminada' ? (f.sin0 ? ' w0' : ' ok') : '')} role="progressbar" aria-valuenow={Math.round(f.av)} aria-valuemin="0" aria-valuemax="100" title={f.sin0 && f.est === 'terminada' ? aviso0(f) : `${Math.round(f.av)}% hecho`}><i style={{ width: Math.min(100, f.av) + '%', '--c': color }} /><em>{f.est === 'terminada' ? '✓ ' : ''}{Math.round(f.av)}%</em></span>
        <span className="mut dsub">{fN(f.plan * f.av / 100)} de {fN(f.plan)} HH · {estTxt(f.est)}</span></div>)}</div>
    : <>
      <div className="dleg"><span><i className="lg-plan" />Total planificado (la barra completa)</span><span><i style={{ background: 'var(--ok)' }} />Real cargado</span><span><i style={{ background: 'var(--bad)' }} />Real por encima de lo esperado</span><span><i className="lg-tick" />Lo que debería llevar según el avance</span></div>
      <div className="dlist">{filas.map(f => { const esp = f.plan * (f.av || 0) / 100, pasa = f.real > Math.max(esp, 0.01) * 1.05 && f.real > 0, pr = f.plan ? Math.min(100, f.real / f.plan * 100) : (f.real ? 100 : 0);
        return <div key={f.k} className="drow hh1">
          <span className="dnom" title={f.nom}>{f.nom}{f.n ? <small className="mut"> · {f.n} {f.n === 1 ? 'tarea' : 'tareas'}</small> : null}</span>
          <span className="dtrack" title={`Real ${fN(f.real)} h de ${fN(f.plan)} h planificadas · avance ${Math.round(f.av || 0)}%`}><i className={pasa ? 'over' : ''} style={{ width: pr + '%' }} />{f.plan > 0 && <em style={{ left: Math.min(100, f.av || 0) + '%' }} />}{f.real > f.plan && f.plan > 0 && <b className="dmas">+{fN(f.real - f.plan)}</b>}</span>
          <span className="dnum1"><b>{fN(f.real)}</b> / {fN(f.plan)} h</span>
          <span className="dsub">{f.real > 0 ? <Desvio real={f.real} plan={esp || f.plan} /> : <span className="mut">sin horas reales</span>}</span></div>; })}
        {prev > 0 && <div className="drow hh1"><span className="dnom" title="Cargadas a mano en Datos del proyecto">Horas previas a la app</span><span /><span className="dnum1"><b>{fN(prev)}</b> h</span><span className="dsub mut">punto de partida</span></div>}
        <div className="drow hh1 tot"><span className="dnom">Total</span><span className="dtrack"><i style={{ width: (tot.plan ? Math.min(100, tot.real / tot.plan * 100) : 0) + '%' }} /></span><span className="dnum1"><b>{fN(tot.real)}</b> / {fN(tot.plan)} h</span><span /></div></div>
      <p className="mut">La barra completa es lo planificado; lo pintado, las horas reales cargadas. La rayita marca lo que debería haberse usado según el avance: si lo real la pasa, se pinta en rojo.</p>
      <SinHoras ts={ts} prev={prev} /></>}
  </section>;
}
function useTopH() { useEffect(() => { const top = document.querySelector('.top'); if (!top) return; const f = () => document.documentElement.style.setProperty('--toph', top.offsetHeight + 'px'); f(); const ro = new ResizeObserver(f); ro.observe(top); return () => ro.disconnect(); }, []); }
function ProyTabs({ pid, setPid, info, lista }) {
  const { S } = useApp(); const L = lista || S.proyectos; const ref = useRef(null);
  const act = L.filter(x => !x.terminado);
  useTopH();
  useEffect(() => { const b = ref.current && ref.current.querySelector('.ptab.on'); if (b && b.scrollIntoView) b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [pid]);
  if (!L.length) return null;
  const tab = (pr, k) => { const i = info(pr); const late = !pr.terminado && pr.entrega && i.fin && i.fin.slice(0, 10) > pr.entrega;
    return <button key={pr.id} className={'ptab' + (pr.id === pid ? ' on' : '') + (pr.terminado ? ' term' : '')} style={{ '--c': pr.color }} onClick={() => setPid(pr.id)} title={`${pr.nombre} · ${Math.round(i.av)}%${k >= 0 && k < 9 ? ` · Alt+${k + 1}` : ''}${pr.terminado ? ' · terminado' : ''}`}>
      <span className="chip">{pr.ini}</span><span className="pt-n">{pr.nombre}</span>
      <span className="pt-av"><i style={{ width: Math.round(i.av) + '%' }} /></span><small>{Math.round(i.av)}%</small>{late && <em className="pt-late" title="Se pasa de la entrega">!</em>}
    </button>; };
  return <div className="ptabs" ref={ref}>
    <button className={'ptab todos' + (!pid ? ' on' : '')} onClick={() => setPid(null)} title="Ver todos los proyectos">▦ Todos</button>
    {act.map((pr, k) => tab(pr, k))}
  </div>;
}
/* ================= PROYECTOS EN EL TELÉFONO (21/10) ================= */
// true cuando la pantalla es angosta (teléfono): el mismo corte de 760 px que usa el diseño
const MQ_MOVIL = '(max-width: 760px)';
function useMovil() {
  const q = () => typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(MQ_MOVIL).matches : false;
  const [m, setM] = useState(q);
  useEffect(() => { if (!window.matchMedia) return; const mq = window.matchMedia(MQ_MOVIL), f = () => setM(mq.matches); f(); mq.addEventListener ? mq.addEventListener('change', f) : mq.addListener(f); return () => { mq.removeEventListener ? mq.removeEventListener('change', f) : mq.removeListener(f); }; }, []);
  return m;
}
// una tarea (sin hijas) está atrasada si debía haber empezado o terminado y no lo hizo (mismo criterio que en Producción)
const atrasadaT = (V, t, now) => t.ops.length && t.inicio && t.estado !== 'terminada' && !V.D[t.id].parent && ((t.estado === 'en proceso' && V.D[t.id].sigueProc && !E.corriendo(t)) || (E.esPend(t) && t.inicio < now));
// barrita de tiempo: dónde cae la tarea entre el inicio del proyecto y la entrega, con la línea de hoy y la de entrega
function MiniBarra({ r, rango, color, ok }) {
  const { a, dias, hoy, ent } = rango; if (!r.inicio || dias <= 0) return <span className="mlin vacia" />;
  const x = d => Math.min(100, Math.max(0, E.diffDays(a, d) / dias * 100));
  const i0 = x(r.inicio.slice(0, 10)), i1 = Math.max(i0 + 1.5, x((r.fin || r.inicio).slice(0, 10)) + 100 / dias);
  return <span className="mlin" aria-hidden="true">
    <i className={'mlin-b' + (ok ? ' ok' : '')} style={{ left: i0 + '%', width: Math.min(100, i1) - i0 + '%', '--c': color }}><b style={{ width: Math.round(r.avance || 0) + '%' }} /></i>
    <em className="mlin-hoy" style={{ left: x(hoy) + '%' }} />{ent && <em className="mlin-ent" style={{ left: x(ent) + '%' }} />}</span>;
}
// estado de una fila: atrasada / frenada / finalizada / en proceso, mirando también lo que tiene adentro
function marcasDe(S, V, t, now) {
  const ids = [t.id, ...E.descendants(S, t.id)], ts = ids.map(id => V.byId[id]).filter(Boolean);
  return { atr: ts.filter(x => atrasadaT(V, x, now)).length, fren: ts.filter(x => !V.D[x.id].parent && E.estaFrenada(x)).length };
}
function FilaLista({ t, depth, abierto, tog, rango, color, now, verFin }) {
  const { S, V, ui } = useApp(); const r = V.D[t.id], ok = r.estado === 'terminada';
  const kids = (V.kids[t.id] || []).filter(c => verFin || V.D[c.id].estado !== 'terminada' || (V.kids[c.id] || []).length);
  const m = marcasDe(S, V, t, now), hijas = (V.kids[t.id] || []).length > 0;
  const quien = !hijas && t.ops.length ? t.ops.map(o => opName(S, o)).join(', ') : '';
  return <div className={'lfila' + (ok ? ' done' : '') + (esTerc(t) ? ' terc' : '') + (hijas ? ' par' : '')} style={{ '--d': depth }}>
    <div className="lfila-h">
      {hijas ? <button className="tog" onClick={() => tog(t.id)} aria-label={abierto ? 'Plegar' : 'Desplegar'}>{abierto ? '▾' : '▸'}</button> : <span className="tog" />}
      <button className="lfila-t" onClick={() => ui.modal({ k: 'task', id: t.id })}>
        <span className="lfila-n">{ok && <span className="g-ok">✓ </span>}{sinF(t) && <span className="g-ok w0" title={SINF_TXT}>! </span>}{t.codigo && <span className="code">{t.codigo} </span>}{t.nombre}{t.cant > 1 && <span className="mut"> ×{t.cant}</span>}</span>
        <span className="lfila-s mut">{fD(r.inicio && r.inicio.slice(0, 10))} → {fD(r.fin && r.fin.slice(0, 10))}{quien && ` · ${quien}`}{hijas && ` · ${kids.length} ${kids.length === 1 ? 'pieza' : 'piezas'}`}</span>
      </button>
      <span className="lfila-m">{m.atr > 0 && <span className="mk bad" title="Atrasada">⚠{hijas ? ' ' + m.atr : ''}</span>}{m.fren > 0 && <span className="mk warn" title="Frenada">⏸{hijas ? ' ' + m.fren : ''}</span>}{!r.parent && E.esProximo(t) && <span className="mk prox" title="Próximo a realizar">⏭</span>}<b>{Math.round(r.avance || 0)}%</b></span>
    </div>
    <MiniBarra r={r} rango={rango} color={color} ok={ok} />
  </div>;
}
function ProyLista({ roots, ts, p, rango, visQ, q }) {
  const { S, V } = useApp(); const now = E.nowDT();
  const [ab, togAb, setAb] = useSet(); const [verFin, setVerFin] = useState(() => prefG('movil-verfin', false));
  useEffect(() => { if (visQ) setAb(new Set(ts.filter(t => (V.kids[t.id] || []).length && visQ(t)).map(t => t.id))); }, [q]);   // al buscar, abre lo que coincide
  const ord = ordenProy(S);
  const vis = t => (!visQ || visQ(t)) && (verFin || V.D[t.id].estado !== 'terminada' || (V.kids[t.id] || []).length);
  const filasDe = r0 => { const out = []; const go = (t, d) => { if (!vis(t)) return; out.push({ t, d }); if (ab.has(t.id)) ord(V.kids[t.id] || []).forEach(c => go(c, d + 1)); }; go(r0, 0); return out; };
  const rs = ord(roots).filter(vis);
  return <section className="plista">
    <div className="row"><button className="btn sm" onClick={() => setAb(new Set(ts.filter(t => (V.kids[t.id] || []).length).map(t => t.id)))}>⊞ Abrir todo</button><button className="btn sm" onClick={() => setAb(new Set())}>⊟ Cerrar todo</button>
      <label className="chk lchk"><input type="checkbox" checked={verFin} onChange={e => { setVerFin(e.target.checked); guardaG('movil-verfin', e.target.checked); }} /> Ver finalizadas</label></div>
    {rs.length === 0 && <Vacio ic="caja" chico t={roots.length ? 'No hay piezas para mostrar' : 'Este proyecto todavía no tiene piezas'}>{roots.length ? 'Probá con "Ver finalizadas" o limpiá la búsqueda.' : 'Agregá una con + Pieza.'}</Vacio>}
    {rs.map(r0 => <div key={r0.id} className="lcard" style={{ '--c': p.color }}>
      {filasDe(r0).map(({ t, d }) => <FilaLista key={t.id} t={t} depth={d} abierto={ab.has(t.id)} tog={togAb} rango={rango} color={p.color} now={now} verFin={verFin} />)}</div>)}
    <p className="mut legend"><i className="lg t" />hoy <i className="lg d" />entrega · Tocá una pieza para editarla</p>
  </section>;
}

// tabla del teléfono: cada pieza es un renglón con los datos rápidos; al tocarlo se despliega el resto
function TablaMovil({ roots, vis, orden }) {
  const { S, V, up, ui } = useApp(); const [col, tog] = useSet(); const [ab, togAb] = useSet(); const now = E.nowDT();
  const rows = flatten(roots, V, col, vis, orden);
  if (!rows.length) return <Vacio ic="caja" chico t="No hay piezas para mostrar" />;
  const turnoTxt = t => t.turno === 'extra' ? 'Horas extra' : t.turno === 'ambos' ? 'Normal + extra' : 'Normal';
  return <div className="tmov">{rows.map(({ t, depth, hasKids }) => { const r = V.D[t.id], ok = r.estado === 'terminada', on = ab.has(t.id);
    const ops = (r.parent ? r.ops : t.ops).map(o => opName(S, o)).join(', '), atr = !!atrasadaT(V, t, now), fren = !r.parent && E.estaFrenada(t);
    const dato = (l, v) => <div><span>{l}</span><b>{v || '—'}</b></div>;
    return <div key={t.id} className={'tmf' + (hasKids ? ' par' : '') + (ok ? ' done' : '') + (esTerc(t) ? ' terc' : '') + (on ? ' on' : '')} style={{ '--d': depth }}>
      <div className="tmf-h">
        {hasKids ? <button className="tog" onClick={() => tog(t.id)} aria-label={col.has(t.id) ? 'Desplegar' : 'Plegar'}>{col.has(t.id) ? '▸' : '▾'}</button> : <span className="tog" />}
        <button className="tmf-t" aria-expanded={on} onClick={() => togAb(t.id)}>
          <span className="tmf-n">{ok && <span className="g-ok">✓ </span>}{sinF(t) && <span className="g-ok w0" title={SINF_TXT}>! </span>}{t.codigo && <span className="code">{t.codigo} </span>}{t.nombre}{t.cant > 1 && <span className="mut"> ×{t.cant}</span>}</span>
          <span className="tmf-s">{esTerc(t) ? <span className="est e-terc">{tercTxt(t)}</span> : <span className={'est e-' + (r.parent ? r.estado : estDe(t)).replace(' ', '')}>{estTxt(r.parent ? r.estado : estDe(t))}</span>}{atr && <span className="mk bad">⚠ atrasada</span>}{fren && <span className="mk warn">⏸ frenada</span>}{!r.parent && E.esProximo(t) && <span className="mk prox">⏭ próximo</span>}<span className="mut">{ops || 'sin operario'}</span></span>
        </button>
        <b className="tmf-p">{Math.round(r.avance || 0)}%</b>
      </div>
      {on && <div className="tmf-d">
        <div className="tmf-g">{dato('Cantidad', cantTxt(t))}{dato('Prioridad', t.prioridad)}{!r.parent && dato('Operación', t.operacionId ? operName(S, t.operacionId) : '')}{dato('Operarios', ops)}{!r.parent && dato('Turno', turnoTxt(t))}
          {dato(r.conHijos ? 'Duración propia' : 'Duración', fN(r.hh) + ' HH')}{dato('Inicio', fDT(r.inicio))}{dato('Fin', fDT(r.fin))}{dato(r.conHijos ? 'HH real propia' : 'HH real', r.hhReal > 0 ? fN(r.hhReal) : '')}{dato('Avance', Math.round(r.avance || 0) + '%')}
          {hasKids && (() => { const hj = hijosDe(V, t.id); return <>{dato('Hijos · plan', fN(hj.hh) + ' HH')}{dato('Hijos · real', hj.hhReal > 0 ? fN(hj.hhReal) + ' HH' : '')}</>; })()}</div>
        {fren && <FrenoTag t={t} />}
        <div className="row"><button className="btn sm pri-b" onClick={() => ui.modal({ k: 'task', id: t.id })}>✎ Editar</button>
          {!r.parent && E.esPend(t) && <button className={'btn sm' + (E.esProximo(t) ? ' warn-b' : '')} onClick={() => { const on = !E.esProximo(t); up(s => E.setProximo(s, t.id, on)); ui.toast(on ? 'Marcada como Próximo a realizar' : 'Quitada de Próximo a realizar'); }}>{E.esProximo(t) ? '⏭ Quitar de próximos' : '⏭ Próximo a realizar'}</button>}</div>
      </div>}
    </div>; })}</div>;
}

/* ================= POST VENTA: estado y registro de envíos ================= */
const MOTIVOS_PV = ['Garantía', 'Repuesto vendido', 'Falla de diseño', 'Reclamo de cliente', 'Otro'];
const pvEstado = t => { const c = Number(t.cant) || 0, e = Number(t.cantEnv) || 0, rv = t.origen === 'reventa';
  if (e > 0 && e >= c) return ['Enviada', 'ok']; if (e > 0) return ['Envío parcial ' + e + '/' + c, 'warn'];
  if (esTerc(t)) return t.tercFecha && t.tercFecha <= E.today() ? ['Recibida del proveedor, lista para enviar', 'warn'] : ['Tercerizada' + (t.proveedor ? ' en ' + t.proveedor : '') + (t.tercFecha ? ' · vuelve ' + fD(t.tercFecha) : ''), 'terc'];
  if (t.estado === 'terminada') return [rv ? 'Recibida, lista para enviar' : 'Lista para enviar', 'warn'];
  if (t.estado === 'en proceso') return [rv ? 'En camino' : 'En fabricación', ''];
  return [rv ? 'Pedida al proveedor' : 'Programada', '']; };
const pvAvisos = t => { const a = [], e = Number(t.cantEnv) || 0;
  if (e > 0 && !t.remito) a.push('Enviada sin N° de remito');
  if (e > 0 && t.remito && !t.remitoOk) a.push('Remito sin verificar en depósito');
  if (e > (Number(t.cant) || 0)) a.push('Se envió más de lo pedido');
  if (t.estado === 'terminada' && !e && (t.tercerizada ? t.tercFecha : t.finReal)) { const d = E.diffDays((t.tercerizada ? t.tercFecha : t.finReal).slice(0, 10), E.today()); if (d >= 3) a.push('Lista hace ' + d + ' días sin enviar'); }
  return a; };
function RegistroPV({ ts, conCaso }) {
  const { S, V, up, ui } = useApp(); const [solo, setSolo] = useState(false);
  const todas = ts.filter(t => !V.D[t.id].parent);
  const con = todas.map(t => ({ t, est: pvEstado(t), av: pvAvisos(t) }));
  const nAv = con.filter(x => x.av.length).length, nPend = con.filter(x => x.est[0] !== 'Enviada').length;
  const vis = con.filter(x => !solo || x.av.length).sort((a, b) => (b.av.length > 0) - (a.av.length > 0) || (a.est[0] === 'Enviada') - (b.est[0] === 'Enviada'));
  return <section className="pvreg"><div className="sec-h"><h2>Registro de envíos <span className="cnt">{todas.length}</span></h2>
    <div className="row"><span className="mut">{nPend} sin enviar completas</span><button className={'btn sm' + (solo ? ' pri-b' : '')} disabled={!nAv && !solo} onClick={() => setSolo(!solo)} title="Muestra solo las piezas con diferencias que revisar">{nAv ? `⚠ ${nAv} con avisos` : 'Sin avisos'}{solo ? ' (viendo solo esas)' : ''}</button></div></div>
    {todas.length === 0 ? <Vacio ic="caja" chico t="Todavía no hay piezas cargadas">Agregá piezas con "+ Pieza" y completá los datos de envío al despacharlas.</Vacio>
      : <div className="pvwrap"><table className="pvtab"><thead><tr>{conCaso && <th>Caso</th>}<th>Pieza</th><th>Origen</th><th>Motivo</th><th>Cant.</th><th>Estado</th><th>Envío</th><th>Remito</th><th title="El remito fue verificado en depósito">Dep. ✓</th><th>Avisos</th></tr></thead>
        <tbody>{vis.map(({ t, est, av }) => { const pr = S.proyectos.find(x => x.id === t.proyId) || {};
          return <tr key={t.id} className={av.length ? 'pv-av' : ''}>
            {conCaso && <td><span className="chip" style={{ '--c': pr.color }}>{pr.ini}</span> {pr.nombre}</td>}
            <td><button className="tlink" onClick={() => ui.modal({ k: 'task', id: t.id })}>{t.nombre || '(sin nombre)'}</button></td>
            <td>{t.origen === 'reventa' ? 'Reventa' : 'Fabricada'}</td><td>{t.motivo || '—'}</td>
            <td>{Number(t.cantEnv) || 0} / {Number(t.cant) || 0}</td>
            <td><span className={'tag ' + (est[1] === 'ok' ? 'ok' : est[1] === 'warn' ? 'warn' : est[1] === 'terc' ? 'terc' : '')}>{est[0]}</span></td>
            <td>{t.fechaEnvio ? fD(t.fechaEnvio) : '—'}{t.destinatario ? <small className="mut"> · {t.destinatario}</small> : ''}</td>
            <td>{t.remito || '—'}</td>
            <td><input type="checkbox" aria-label="Remito verificado en depósito" checked={!!t.remitoOk} disabled={!t.remito} onChange={e => up(s => E.patchTask(s, t.id, { remitoOk: e.target.checked }))} /></td>
            <td>{av.length ? av.map(x => <span key={x} className="tag bad">{x}</span>) : <span className="mut">—</span>}</td></tr>; })}</tbody></table></div>}
  </section>;
}

/* Vista por proceso: selector "Por estado / Por proceso" y tablero con una columna por operación (tornería, centro de mecanizado, router, soldadura…). */
function useVistaProc() { const [v, setV] = useState(() => prefG('vista-proc', 'estado')); const set = x => { setV(x); guardaG('vista-proc', x); }; return [v, set]; }
function VistaSel({ v, set }) {
  return <div className="vsel" role="group" aria-label="Ver las piezas">
    <button className={'btn sm' + (v === 'estado' ? ' on' : '')} aria-pressed={v === 'estado'} onClick={() => set('estado')}>Por estado</button>
    <button className={'btn sm' + (v === 'proceso' ? ' on' : '')} aria-pressed={v === 'proceso'} onClick={() => set('proceso')} title="Una columna por operación">Por proceso</button>
  </div>;
}
function TableroProc({ roots, vis, tabla }) {
  const { V } = useApp();
  return <GruposProc hojas={hojasActivas(V, roots, vis)} vacio={<Vacio ic="ok" chico t="No hay piezas pendientes ni en proceso" />}
    render={l => { const v = visEn(V, new Set(l.map(t => t.id)), vis); return tabla(roots.filter(v), v); }} />;
}

/* Pendientes por proceso: por operación, piezas (tipos de pieza, sin mirar la cantidad) sin finalizar sobre el total, con el color de cada estado.
   Cuenta las piezas con trabajo propio (una pieza hecha en partes cuenta una vez); las tercerizadas no entran.
   Con "ordenes" (solo Repuestos) suma el selector Piezas | OV/OC: un anillo para las OV y otro para las OC abiertas, por el proceso en el que está cada orden. */
const PP_ORD = { curso: 0, pausa: 1, proximo: 2, pendiente: 3, terminada: 4 };
const PP_PAL = ['#4E79A7', '#F28E2B', '#59A14F', '#B07AA1', '#EDC948', '#76B7B2', '#E15759', '#9C755F', '#FF9DA7', '#2F9E9E', '#C17D11', '#7A6FCB'];
/* Estado y horas plan pendientes de una pieza con trabajo propio (null = no cuenta: tercerizada, parte suelta o ensamblaje). */
const ppHoja = (V, t) => {
  if (!t || !V.D[t.id] || t.tercerizada || t.parte || (V.D[t.id].parent && !t.partes)) return null;
  if (t.partes) { const ab = (V.kids[t.id] || []).filter(x => !x.tercerizada && x.estado !== 'terminada');
    return { k: ab.length ? ab.map(claseT).sort((a, b) => PP_ORD[a] - PP_ORD[b])[0] : 'terminada', hh: ab.reduce((a, x) => a + (Number(x.hh) || 0), 0) }; }
  const k = claseT(t); return { k, hh: k === 'terminada' ? 0 : Number(t.hh) || 0 };
};
/* Tipo de orden según cómo empieza el número: OV…, OC… u otra. */
const ppTipoOrd = o => { const x = String(o || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return x.startsWith('OV') ? 'OV' : x.startsWith('OC') ? 'OC' : 'otra'; };

function PendProc({ ts, donde, ordenes }) {
  const { S, V, ui } = useApp(); const [ab, setAb] = useState(() => prefG('pend-proc', true)); const tog = () => { setAb(!ab); guardaG('pend-proc', !ab); };
  const [ver, setVer_] = useState(null);   // lista abierta debajo de los anillos: { q: 'piezas' | 'OV' | 'OC' | 'otra', op: id o null }
  const K = ['curso', 'pausa', 'proximo', 'pendiente'];
  const COL = Object.fromEntries(SECC.map(x => [x[0], x[2]])), LBL = Object.fromEntries(SECC.map(x => [x[0], x[1]]));
  const opOk = id => id && S.operaciones.some(o => o.id === id) ? id : '_';
  const g = {}, tot = { n: 0, c: {}, hh: 0 };
  ts.forEach(t => { const h = ppHoja(V, t); if (!h) return;
    const x = g[opOk(t.operacionId)] = g[opOk(t.operacionId)] || { n: 0, c: {}, hh: 0 }; [x, tot].forEach(y => { y.n += 1; y.c[h.k] = (y.c[h.k] || 0) + 1; y.hh += h.hh; }); });
  const cols = [...S.operaciones.map(o => [o.id, o.nombre]), ['_', 'Sin operación']].filter(([k]) => g[k]);
  if (!cols.length && !ordenes) return null;
  const pend = y => K.reduce((a, k) => a + (y.c[k] || 0), 0);
  const fila = (nom, y, total) => { const p = pend(y), pc = !y.n ? 0 : p === y.n ? 100 : !p ? 0 : Math.min(99, Math.max(1, Math.round(p / y.n * 100)));   // 99,9 % no se muestra como 100 %
    return <div key={nom} className={'pproc-f' + (total ? ' tot' : '') + (p ? '' : ' listo')}>
      <div className="pproc-l"><span>{nom}</span><span className="mut"><b>{fN(p)}</b> de {fN(y.n)} {y.n === 1 ? 'pieza' : 'piezas'} · {pc}%{p ? ` · ${fH(y.hh)} plan` : ' · todo finalizado'}</span></div>
      <div className="pproc-b" role="img" aria-label={`${nom}: ${fN(p)} de ${fN(y.n)} piezas sin finalizar`}>{K.map(k => y.c[k] ? <i key={k} style={{ width: y.c[k] / y.n * 100 + '%', background: COL[k] }} title={`${LBL[k]}: ${fN(y.c[k])} ${y.c[k] === 1 ? 'pieza' : 'piezas'}`} /> : null)}</div>
    </div>; };

  /* OV/OC: cada orden abierta va al proceso en el que está ahora: el de una pieza en proceso; si no, en pausa; si no, próxima a realizar;
     si no, el primer proceso que tiene pendiente (orden de Configuración → Operaciones). */
  const opIx = id => { const i = S.operaciones.findIndex(o => o.id === id); return i < 0 ? 999 : i; };
  const colOp = id => id === '_' ? 'var(--mut)' : PP_PAL[opIx(id) % PP_PAL.length];
  const nomOp = id => id === '_' ? 'Sin operación' : (S.operaciones.find(o => o.id === id) || {}).nombre || 'Sin operación';
  /* Anillos (25/11): tocar el centro o el título muestra abajo la lista completa; tocar un color (o su fila de la leyenda) muestra solo las de ese proceso. */
  const setVer = (q, op) => setVer_(v => v && v.q === q && v.op === op ? null : { q, op });
  const anillo = ({ q, nombre, sub, centro, centroSub, cnt, lista }) => { const N = Object.values(cnt).reduce((a, n) => a + n, 0); if (!N) return null;
    const segs = Object.keys(cnt).sort((a, b) => opIx(a) - opIx(b)), R = 46, L = 2 * Math.PI * R; let acc = 0;
    const on = ver && ver.q === q, opSel = on ? ver.op : null;
    return <div key={q} className={'pproc-a' + (on ? ' on' : '')}>
      <button className="pproc-at" onClick={() => setVer(q, null)} aria-pressed={on && !opSel} title="Ver la lista completa abajo"><b>{nombre}</b><span className="mut">{sub}</span></button>
      <div className="pproc-ac">
        <svg viewBox="0 0 120 120" width="132" height="132" role="img" aria-label={`${nombre}: ${segs.map(k => `${nomOp(k)} ${cnt[k]}`).join(', ')}`}>
          <circle cx="60" cy="60" r={R} fill="none" stroke="var(--line)" strokeWidth="16" />
          {segs.map(k => { const f = cnt[k] / N * L, el = <circle key={k} className={'pproc-seg' + (opSel && opSel !== k ? ' apag' : '')} cx="60" cy="60" r={R} fill="none" stroke={colOp(k)} strokeWidth={opSel === k ? 20 : 16} strokeDasharray={`${Math.max(0, f - (segs.length > 1 ? 1.5 : 0))} ${L}`} strokeDashoffset={-acc} transform="rotate(-90 60 60)" onClick={() => setVer(q, k)}><title>{`${nomOp(k)}: ${cnt[k]}${lista && lista[k] ? ' — ' + lista[k].join(', ') : ''} · tocá para ver la lista`}</title></circle>; acc += f; return el; })}
          <circle className="pproc-cen" cx="60" cy="60" r="36" onClick={() => setVer(q, null)}><title>Ver la lista completa abajo</title></circle>
          <text x="60" y="58" textAnchor="middle" className="pproc-an">{fN(centro)}</text><text x="60" y="75" textAnchor="middle" className="pproc-as">{centroSub}</text>
        </svg>
        <ul className="pproc-al">{segs.map(k => <li key={k}><button className={opSel === k ? 'on' : ''} onClick={() => setVer(q, k)} title={lista && lista[k] ? lista[k].join(', ') : 'Ver la lista abajo'}><i style={{ background: colOp(k) }} /><span>{nomOp(k)}</span><b>{fN(cnt[k])}</b><span className="mut">{Math.round(cnt[k] / N * 100)}%</span></button></li>)}</ul>
      </div>
    </div>; };
  // Cada orden abierta, con el proceso en el que está ahora y sus datos para la lista
  const ordAb = () => (ordenes || []).map(o => { const hs = o.ts.map(t => ({ t, h: ppHoja(V, t) })).filter(x => x.h), ab = hs.filter(x => x.h.k !== 'terminada');
    if (!ab.length) return null;
    ab.sort((a, b) => PP_ORD[a.h.k] - PP_ORD[b.h.k] || opIx(opOk(a.t.operacionId)) - opIx(opOk(b.t.operacionId)));
    const rs = o.ts.filter(t => !t.parentId), fin = rs.map(r => V.D[r.id] && V.D[r.id].fin).filter(Boolean).sort().pop(), ent = rs.map(r => r.entrega).filter(Boolean).sort()[0];
    return { o, tp: ppTipoOrd(o.orden), op: opOk(ab[0].t.operacionId), k: ab[0].h.k, cab: V.rootOf(ab[0].t), cliente: (rs.find(r => r.cliente) || {}).cliente, n: hs.length, nAb: ab.length, hh: ab.reduce((a, x) => a + x.h.hh, 0), fin, ent }; }).filter(Boolean);
  // Piezas sin finalizar (una pieza hecha en partes cuenta una vez)
  const pzAb = () => ts.map(t => ({ t, h: ppHoja(V, t) })).filter(x => x.h && x.h.k !== 'terminada');
  const estTag = k => <span className="pproc-est" style={{ '--c': COL[k] }}>{LBL[k]}</span>;
  const listaVer = () => { if (!ver) return null; const { q, op } = ver; const tit = (op ? nomOp(op) + ' · ' : '') + (q === 'piezas' ? 'piezas sin finalizar' : (q === 'otra' ? 'otras órdenes' : q) + ' abiertas');
    const cerrar = <button className="btn sm" onClick={() => setVer_(null)}>Cerrar lista</button>;
    if (q === 'piezas') { const l = pzAb().filter(x => !op || opOk(x.t.operacionId) === op).sort((a, b) => PP_ORD[a.h.k] - PP_ORD[b.h.k] || PRI[a.t.prioridad] - PRI[b.t.prioridad] || ((a.t.inicio || '9') < (b.t.inicio || '9') ? -1 : 1));
      return <div className="pproc-lst"><div className="sec-h"><b>{tit} <span className="cnt">{l.length}</span></b><span className="mut">tocá una fila para abrir la pieza</span>{cerrar}</div>
        <div className="scroll"><table className="tt pproc-tt"><thead><tr><th>OV/OC</th><th>Cliente</th><th>Pieza</th><th className="cc">Cant.</th><th className="cc">Estado</th><th className="cc">Operación</th><th>Operarios</th><th className="cc">Duración</th><th>Inicio</th></tr></thead>
          <tbody>{l.map(({ t, h }) => { const r = V.rootOf(t); return <tr key={t.id} className="clk" tabIndex={0} onClick={() => ui.modal({ k: 'task', id: t.id })} onKeyDown={e => { if (e.key === 'Enter') ui.modal({ k: 'task', id: t.id }); }}>
            <td>{r.orden || '—'}</td><td>{r.cliente || '—'}</td><td>{t.nombre}</td><td className="cc">{cantTxt(t)}</td><td className="cc">{estTag(h.k)}</td><td className="cc">{nomOp(opOk(t.operacionId))}</td><td>{t.ops.length ? t.ops.map(o => opName(S, o)).join(', ') : <span className="mut">sin asignar</span>}</td><td className="cc">{fH(h.hh)}</td><td>{fDT(t.inicio)}</td></tr>; })}</tbody></table></div></div>; }
    const l = ordAb().filter(x => x.tp === q && (!op || x.op === op)).sort((a, b) => PP_ORD[a.k] - PP_ORD[b.k] || String(a.o.orden).localeCompare(String(b.o.orden), 'es', { numeric: true }));
    return <div className="pproc-lst"><div className="sec-h"><b>{tit} <span className="cnt">{l.length}</span></b><span className="mut">tocá una fila para abrir la orden</span>{cerrar}</div>
      <div className="scroll"><table className="tt pproc-tt"><thead><tr><th>OV/OC</th><th>Cliente</th><th className="cc">Piezas abiertas</th><th className="cc">Proceso actual</th><th className="cc">Estado</th><th className="cc">HH pendientes</th><th className="cc">Entrega</th><th>Fin previsto</th></tr></thead>
        <tbody>{l.map(x => <tr key={x.cab.id + x.o.orden} className="clk" tabIndex={0} onClick={() => ui.modal({ k: 'task', id: x.cab.id })} onKeyDown={e => { if (e.key === 'Enter') ui.modal({ k: 'task', id: x.cab.id }); }}>
          <td><b>{x.o.orden || '(sin número)'}</b></td><td>{x.cliente || '—'}</td><td className="cc">{fN(x.nAb)} de {fN(x.n)}</td><td className="cc"><i className="pproc-dot" style={{ background: colOp(x.op) }} />{nomOp(x.op)}</td><td className="cc">{estTag(x.k)}</td><td className="cc">{fH(x.hh)}</td>
          <td className={'cc' + (x.ent && x.fin && x.fin.slice(0, 10) > x.ent ? ' c-bad' : '')}>{x.ent ? fD(x.ent) : '—'}</td><td>{x.fin ? fDT(x.fin) : '—'}</td></tr>)}</tbody></table></div></div>; };
  /* Repuestos: los cuatro anillos juntos (Piezas, OV, OC y Otras órdenes), cada uno con su lista de abajo. */
  const anillosTodos = () => {
    const os = ordAb(), cnt = { OV: {}, OC: {}, otra: {} }, lista = { OV: {}, OC: {}, otra: {} };
    os.forEach(x => { cnt[x.tp][x.op] = (cnt[x.tp][x.op] || 0) + 1; (lista[x.tp][x.op] = lista[x.tp][x.op] || []).push(x.o.orden || '(sin número)'); });
    const hay = ['OV', 'OC', 'otra'].filter(tp => Object.keys(cnt[tp]).length);
    const pz = pzAb(), cntPz = {};
    pz.forEach(x => { const k = opOk(x.t.operacionId); cntPz[k] = (cntPz[k] || 0) + 1; });
    if (!pz.length && !hay.length) return <p className="mut">No hay piezas ni órdenes abiertas.</p>;
    return <>
      <div className="pproc-ag">
        {pz.length ? anillo({ q: 'piezas', nombre: 'Piezas sin finalizar', sub: `${fN(pz.length)} de ${fN(tot.n)} ${tot.n === 1 ? 'pieza' : 'piezas'} · ${fH(pz.reduce((a, x) => a + x.h.hh, 0))} plan`, centro: pz.length, centroSub: 'sin finalizar', cnt: cntPz }) : null}
        {hay.map(tp => { const N = Object.values(cnt[tp]).reduce((a, n) => a + n, 0), nombre = tp === 'otra' ? 'Otras órdenes' : tp;
          return anillo({ q: tp, nombre: nombre + ' abiertas', sub: `${fN(N)} ${N === 1 ? 'orden' : 'órdenes'} con piezas sin finalizar`, centro: N, centroSub: tp === 'otra' ? 'abiertas' : tp + ' abiertas', cnt: cnt[tp], lista: lista[tp] }); })}
      </div>
      {listaVer()}
      <p className="legend">Piezas: cada pieza cuenta una vez (sin importar la cantidad), en su operación. Órdenes: cada orden cuenta una vez, en el proceso en el que está ahora: el de una pieza en proceso; si no hay, en pausa; si no, próxima a realizar; si no, el primer proceso que tiene pendiente (orden de Configuración → Operaciones).{os.some(x => x.tp === 'otra') ? ' "Otras órdenes" son las que no empiezan con OV ni OC.' : ''} Tocá el centro de un anillo para ver su lista completa abajo, o un color para ver solo las de ese proceso.</p>
    </>;
  };
  const totOrd = ordenes ? ordenes.filter(o => o.ts.some(t => { const h = ppHoja(V, t); return h && h.k !== 'terminada'; })).length : 0;
  return <section className="pproc">
    <div className="sec-h"><button className="dgrp-t" onClick={tog} aria-expanded={ab}><span className="car">{ab ? '▾' : '▸'}</span><b>Pendientes por proceso</b></button>
      <span className="mut">{ordenes ? `${fN(pend(tot))} de ${fN(tot.n)} piezas · ${fN(totOrd)} ${totOrd === 1 ? 'orden abierta' : 'órdenes abiertas'} · ${donde}` : `${fN(pend(tot))} de ${fN(tot.n)} piezas sin finalizar ${donde}`}</span></div>
    {ab && (ordenes ? anillosTodos() : <><div className="pproc-g">{cols.map(([k, nom]) => fila(nom, g[k]))}{cols.length > 1 && fila('Total', tot, true)}</div>
      <p className="legend pproc-ley">{K.map(k => <span key={k}><i style={{ background: COL[k] }} />{LBL[k]}</span>)}<span><i className="fin" />Finalizadas</span> · la barra completa es el total de piezas de cada proceso (cada pieza cuenta una vez, sin importar la cantidad)</p></>)}
  </section>;
}

/* Pendientes y en proceso de un proyecto o caso, en secciones por estado. Cada sección muestra sus piezas con los ensamblajes que las contienen. */
function SeccEstado({ roots, vis, tabla }) {
  const { V } = useApp(); const [plg, tog] = usePlegados('proy-grupos');
  const hojas = hojasActivas(V, roots, vis);
  const secs = SECC.map(([k, l, c]) => { const n = hojas.filter(t => claseT(t) === k).length; if (!n) return null;
    const memo = new Map(); const tiene = t => { if (memo.has(t.id)) return memo.get(t.id); const r = (!vis || vis(t)) && ((!V.D[t.id].parent && t.estado !== 'terminada' && claseT(t) === k) || (V.kids[t.id] || []).some(tiene)); memo.set(t.id, r); return r; };
    return <GrupoEstado key={k} k={k} l={l} c={c} n={n} plg={plg} tog={tog} nota={k === 'pausa' && <span className="mut">empezadas que no se están haciendo ahora, pausadas o frenadas</span>}>{tabla(tiene)}</GrupoEstado>; }).filter(Boolean);
  return secs.length ? <>{secs}</> : <Vacio ic="ok" chico t="No hay piezas pendientes ni en proceso" />;
}

// Exportar un proyecto (o caso de Post Venta / Taller) a Excel para analizar tiempos y costos de fabricación.
// Hojas: Resumen, Piezas (el árbol con tiempos y costos), Por operación y Por operario. Costos en USD con las tarifas y precios vigentes.
function exportarProyecto(S, V, p, toast, STK) {
  if (!window.XLSX) { toast('No se pudo cargar el generador de Excel'); return; }
  const X = window.XLSX, wb = X.utils.book_new(), n2 = v => Math.round((Number(v) || 0) * 100) / 100, vacio = v => v > 0 ? n2(v) : '';
  const roots = S.tareas.filter(t => t.proyId === p.id && !t.parentId), filas = flatten(roots, V, new Set());
  if (!filas.length) { toast('El proyecto no tiene piezas para exportar'); return; }
  // costo del trabajo propio de cada pieza (sin las hijas), con las horas reales y con las planificadas
  const propio = {}; filas.forEach(({ t }) => { const r = V.D[t.id]; if (r.parent) return; const base = { nombre: t.nombre, cant: t.cant, operacionId: t.operacionId, material: t.material, peso: t.peso };
    const real = E.costo(S, { ...base, hh: esTerc(t) ? 0 : Number(t.hhReal) || 0 }, STK), vh = E.valorHora(S, t.nombre, t.operacionId);
    propio[t.id] = { hh: Number(t.hh) || 0, hhReal: esTerc(t) ? 0 : Number(t.hhReal) || 0, mo: real.mo, moPlan: vh ? (Number(t.hh) || 0) * vh.valor : 0, mat: real.mat, peso: real.peso, m: real.m, matNom: real.matNom, fuente: real.fuente, vh, falta: Number(t.hhReal) > 0 && !esTerc(t) ? real.falta : [], fin: t.estado === 'terminada' }; });
  const sumSub = id => { const own = propio[id] ? [propio[id]] : []; const ch = (V.kids[id] || []).map(c => sumSub(c.id)); const l = [...own, ...ch];
    return { hh: l.reduce((a, x) => a + x.hh, 0), hhReal: l.reduce((a, x) => a + x.hhReal, 0), mo: l.reduce((a, x) => a + x.mo, 0), moPlan: l.reduce((a, x) => a + x.moPlan, 0), mat: l.reduce((a, x) => a + x.mat, 0), peso: l.reduce((a, x) => a + (x.peso || 0), 0), falta: [...new Set(l.flatMap(x => x.falta))] }; };
  const piezas = filas.map(({ t, depth, hasKids }) => { const r = V.D[t.id], k = E.claveCod(t.nombre), cant = Math.max(1, Number(t.cant) || 1), x = hasKids ? sumSub(t.id) : propio[t.id];
    const fin = r.estado === 'terminada', h = !hasKids ? E.historial(S, t.nombre) : null, pr = propio[t.id], tot = x.mo + x.mat;
    return { Nivel: depth + 1, Pieza: '   '.repeat(depth) + t.nombre, Código: /^TPF/i.test(k) ? k : '', Fila: hasKids ? (r.parent ? 'Grupo (suma de hijas)' : 'Ensamblaje (propio + hijas)') : 'Pieza', Cantidad: cant,
      Operación: r.parent ? '' : operName(S, t.operacionId), Operarios: r.parent ? '' : (t.ops || []).map(o => opName(S, o)).join(', '), Estado: esTerc(t) ? 'tercerizada' : estTxt(r.estado),
      Inicio: r.inicio ? r.inicio.replace('T', ' ') : '', Fin: r.fin ? r.fin.replace('T', ' ') : '',
      'HH plan': n2(x.hh), 'HH reales': n2(x.hhReal), 'HH reales por unidad': x.hhReal > 0 ? n2(x.hhReal / cant) : '',
      'Diferencia real − plan (h)': fin && x.hh > 0 && x.hhReal > 0 ? n2(x.hhReal - x.hh) : '', 'Desvío %': fin && x.hh > 0 && x.hhReal > 0 ? Math.round((x.hhReal - x.hh) / x.hh * 100) : '',
      'Tiempo estándar (h/u)': h ? n2(h.porUnidad) : '', 'Veces fabricada': h ? h.n : '',
      'Valor hora (USD)': pr && pr.vh ? n2(pr.vh.valor) : '', 'Costo MO plan (USD)': vacio(x.moPlan), 'Costo MO real (USD)': vacio(x.mo),
      Material: pr && pr.matNom ? pr.matNom + (pr.fuente === 'generico' ? ' (precio genérico)' : '') : '', 'Peso (kg)': vacio(x.peso), 'Costo material (USD)': vacio(x.mat), 'Costo total (USD)': vacio(tot), 'Costo por unidad (USD)': tot > 0 ? n2(tot / cant) : '',
      'Falta para el costo': esTerc(t) ? 'tercerizada (sin costo de planta)' : x.falta.join(', ') }; });
  // por operación y por operario: solo trabajo propio (sin sumar dos veces los grupos)
  const own = filas.filter(({ t }) => propio[t.id]).map(({ t }) => ({ t, x: propio[t.id] }));
  const porOp = {}; own.forEach(({ t, x }) => { const g = porOp[t.operacionId || ''] = porOp[t.operacionId || ''] || { n: 0, nf: 0, hh: 0, hhReal: 0, hhF: 0, hhRF: 0, mo: 0 };
    g.n++; g.hh += x.hh; g.hhReal += x.hhReal; g.mo += x.mo; if (x.fin && x.hhReal > 0) { g.nf++; g.hhF += x.hh; g.hhRF += x.hhReal; } });
  const opsH = Object.entries(porOp).map(([id, g]) => ({ Operación: id ? operName(S, id) : 'Sin operación', Piezas: g.n, Finalizadas: g.nf, 'HH plan': n2(g.hh), 'HH reales': n2(g.hhReal),
    'HH plan (finalizadas)': n2(g.hhF), 'HH reales (finalizadas)': n2(g.hhRF), 'Desvío % (finalizadas)': g.hhF > 0 ? Math.round((g.hhRF - g.hhF) / g.hhF * 100) : '', 'Costo MO real (USD)': n2(g.mo) })).sort((a, b) => b['HH reales'] - a['HH reales']);
  const porOpe = {}; own.forEach(({ t, x }) => { const ops = (t.ops || []).length ? t.ops : ['']; ops.forEach(o => { const g = porOpe[o] = porOpe[o] || { n: 0, hh: 0, hhReal: 0 }; g.n++; g.hh += x.hh / ops.length; g.hhReal += x.hhReal / ops.length; }); });
  const opeH = Object.entries(porOpe).map(([id, g]) => ({ Operario: id ? opName(S, id) : 'Sin asignar', Piezas: g.n, 'HH plan': n2(g.hh), 'HH reales': n2(g.hhReal) })).sort((a, b) => b['HH reales'] - a['HH reales']);
  const T = own.reduce((a, { x }) => ({ hh: a.hh + x.hh, hhReal: a.hhReal + x.hhReal, mo: a.mo + x.mo, moPlan: a.moPlan + x.moPlan, mat: a.mat + x.mat }), { hh: 0, hhReal: 0, mo: 0, moPlan: 0, mat: 0 });
  const prev = Math.max(0, Number(p.hhPrevias) || 0), nFin = own.filter(o => o.x.fin).length, inco = own.filter(o => o.x.hhReal > 0 && o.x.falta.length).length;
  const ini = filas.map(f => V.D[f.t.id].inicio).filter(Boolean).sort()[0], finP = filas.map(f => V.D[f.t.id].fin).filter(Boolean).sort().pop();
  const res = [['Proyecto', p.nombre], ['Exportado', E.today()], ['Entrega', p.entrega || ''], ['Inicio', ini ? ini.slice(0, 10) : ''], ['Fin (real o planificado)', finP ? finP.slice(0, 10) : ''], [],
    ['Piezas con trabajo propio', own.length], ['Finalizadas', nFin], ['Avance %', Math.round((roots.reduce((a, t) => a + V.D[t.id].hh * V.D[t.id].avance, 0) / (roots.reduce((a, t) => a + V.D[t.id].hh, 0) || 1)))], [],
    ['HH planificadas', n2(T.hh)], ['HH reales cargadas en las piezas', n2(T.hhReal)], ['HH reales previas (del proyecto)', n2(prev)], ['HH reales totales', n2(T.hhReal + prev)], [],
    ['Costo mano de obra planificado (USD)', n2(T.moPlan)], ['Costo mano de obra real (USD)', n2(T.mo)], ['Costo material de las piezas con ficha (USD)', n2(T.mat)], ['Costo total calculado (USD)', n2(T.mo + T.mat)], [],
    ['Notas'], ['• Costos con las tarifas de Configuración y el precio de cada ítem de StockApp (el último de ComprasApp; los cargados en $ se pasan a USD con el dólar de StockApp).'], ['• "(precio genérico)": pieza sin ítem de StockApp con precio; usa el material genérico de Configuración × peso.'], ['• Las HH reales previas se exportan solo como dato (sin costo): asignales vos el valor que corresponda.'],
    ['• Las tercerizadas no suman horas ni costo de planta.'], ['• Una tarea con el cronómetro corriendo suma sus horas recién al pausarla o finalizarla.'], ['• En "Por operario", las horas de una pieza con varios operarios se reparten en partes iguales.'],
    ...(inco ? [[`• ${inco} pieza(s) con horas tienen el costo incompleto: ver la columna "Falta para el costo" en Piezas.`]] : [])];
  const hoja = (rows, anchos) => { const ws = X.utils.json_to_sheet(rows); ws['!cols'] = anchos.map(w => ({ wch: w })); ws['!autofilter'] = { ref: ws['!ref'] }; return ws; };
  const wr = X.utils.aoa_to_sheet(res); wr['!cols'] = [{ wch: 44 }, { wch: 22 }];
  X.utils.book_append_sheet(wb, wr, 'Resumen');
  X.utils.book_append_sheet(wb, hoja(piezas, [6, 48, 24, 24, 9, 20, 22, 14, 16, 16, 9, 9, 10, 12, 9, 12, 9, 10, 12, 12, 18, 9, 12, 12, 12, 30]), 'Piezas');
  X.utils.book_append_sheet(wb, hoja(opsH, [24, 8, 11, 10, 10, 14, 14, 14, 14]), 'Por operación');
  X.utils.book_append_sheet(wb, hoja(opeH, [26, 8, 10, 10]), 'Por operario');
  const nom = (p.nombre || 'proyecto').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 60) || 'proyecto';
  saveFile(`${nom} - tiempos y costos ${E.today()}.xlsx`, X.write(wb, { type: 'array', bookType: 'xlsx' }), toast);
}

function Proyectos({ pv = false, tl = false }) {
  const { S, V, up, ui, pm, STK } = useApp(); const clase = pv ? 'pv' : tl ? 'tl' : 'proy', caso = pv || tl; const lista = S.proyectos.filter(x => E.claseP(x) === clase), activos = lista.filter(x => !x.terminado), terminados = lista.filter(x => x.terminado), LK = 'produccionapp-' + clase + '-actual'; const movil = useMovil(); const [vistaM, setVistaM] = useState(() => prefG('movil-vista', 'lista')); const [masM, setMasM] = useState(false); const [pid, setPid0] = useState(() => { try { return localStorage.getItem(LK) || null; } catch (e) { return null; } });
  const setPid = id => { setPid0(id); try { id ? localStorage.setItem(LK, id) : localStorage.removeItem(LK); } catch (e) { } if (typeof window.scrollTo === 'function') window.scrollTo({ top: 0 }); };
  useEffect(() => { const k = e => { if (!e.altKey || e.ctrlKey || e.metaKey) return; const n = Number(e.key); if (n >= 1 && n <= 9 && activos[n - 1]) { e.preventDefault(); setPid(activos[n - 1].id); } else if (e.key === '0') { e.preventDefault(); setPid(null); } }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [S.proyectos, pv, tl]); const [vp, setVp] = useVistaProc(); const [col, tog, setCol] = useSet(); const [det, setDet] = useState(null); const [hhv, setHhv] = useState('padre'); const [altoG, setAltoG] = useState('completo'); const [q, setQ] = useState(''); const [verFin, setVerFin] = useState(() => prefG('verfin', false)); const [verTerm, setVerTerm] = useState(() => prefG('verterm' + (caso ? '-' + clase : ''), false));
  useEffect(() => { if (pid) setAltoG(prefG('alto-' + pid, 'completo')); }, [pid]);
  const p = lista.find(x => x.id === pid);
  const info = pr => { const ts = S.tareas.filter(t => t.proyId === pr.id), rs = ts.filter(t => !t.parentId).map(t => V.D[t.id]); const hh = rs.reduce((a, r) => a + r.hh, 0);
    return { ts, hh, av: hh ? rs.reduce((a, r) => a + r.hh * r.avance, 0) / hh : 0, prev: Math.max(0, Number(pr.hhPrevias) || 0), real: Math.max(0, Number(pr.hhPrevias) || 0) + rs.reduce((a, r) => a + r.hhReal, 0), ini: rs.map(r => r.inicio).filter(Boolean).sort()[0], fin: rs.map(r => r.fin).filter(Boolean).sort().pop() }; };
  const nuevo = () => { const id = E.uid(); up(s => ({ ...s, proyectos: [...s.proyectos, { id, nombre: caso ? 'Caso nuevo' : 'Proyecto nuevo', ini: pv ? 'PV' : tl ? 'TL' : 'NVO', color: ACCENTS[s.proyectos.length % ACCENTS.length], entrega: '', ...(pv ? { pv: true } : tl ? { tl: true } : {}) }] })); setPid(id); };
  const tabs = <ProyTabs pid={p ? pid : null} setPid={setPid} info={info} lista={lista} />;
  const tarjeta = pr => { const i = info(pr); const late = !pr.terminado && pr.entrega && i.fin && i.fin.slice(0, 10) > pr.entrega; return <button key={pr.id} className={'pcard' + (pr.terminado ? ' term' : '')} style={{ '--c': pr.color }} onClick={() => setPid(pr.id)}>
    <span className="chip">{pr.ini}</span><b>{pr.nombre}</b>
    <span className="pline"><Bar v={i.av} color={pr.color} /> {Math.round(i.av)}%</span>
    <span className="mut">{fD(i.ini && i.ini.slice(0, 10))} → {fD(i.fin && i.fin.slice(0, 10))} · {fN(i.hh)} HH</span>
    {pr.terminado ? <span className="tag ok">✓ terminado{pr.terminadoEl ? ` el ${fD(pr.terminadoEl)}` : ''}</span> : pr.entrega && <span className={'tag ' + (late ? 'bad' : '')}>{late ? `se pasa ${E.diffDays(pr.entrega, i.fin.slice(0, 10))} d de la entrega` : `entrega ${fD(pr.entrega)}`}</span>}
  </button>; };
  if (!p) return <div className="view">{tabs}<section>
    <div className="sec-h"><h2>{pv ? 'Post Venta' : tl ? 'Taller' : 'En proceso'}</h2><div className="row">{caso && <button className="btn" onClick={() => ui.modal({ k: 'plan', alcance: clase })}>Planificar todos los casos</button>}<button className="btn pri-b" onClick={nuevo}>{caso ? '+ Caso' : '+ Proyecto'}</button></div></div>
    <div className="pcards">{activos.map(tarjeta)}
      {lista.length === 0 && <Vacio ic="caja" t={pv ? 'Todavía no hay casos de post venta' : tl ? 'Todavía no hay trabajos de taller' : 'Todavía no hay proyectos'}>{pv ? 'Creá el primero con "+ Caso": puede ser un cliente, un equipo o un reclamo.' : tl ? 'Creá el primero con "+ Caso": trabajos para nuestro propio taller (mantenimiento, mejoras, orden), sin OV ni OC.' : 'Creá el primero con el botón de arriba.'}</Vacio>}
      {lista.length > 0 && activos.length === 0 && <Vacio ic="caja" chico t={caso ? 'Todos los casos están terminados' : 'Todos los proyectos están terminados'} />}</div>
    {terminados.length > 0 && <div className="termsec"><div className="sec-h"><button className="dgrp-t fin-t" onClick={() => { setVerTerm(!verTerm); guardaG('verterm' + (caso ? '-' + clase : ''), !verTerm); }}><span className="car">{verTerm ? '▾' : '▸'}</span><h2>Terminados <span className="cnt ok">{terminados.length}</span></h2></button></div>
      {verTerm && <div className="pcards">{terminados.map(tarjeta)}</div>}</div>}
  </section><PendProc donde={caso ? 'en los casos sin terminar' : 'en los proyectos sin terminar'} ts={S.tareas.filter(t => t.tipo === 'proy' && activos.some(x => x.id === t.proyId))} />{pv && <RegistroPV ts={S.tareas.filter(t => t.tipo === 'proy' && lista.some(x => x.id === t.proyId))} conCaso />}<Proximas filtro={t => t.tipo === 'proy' && lista.some(x => x.id === t.proyId)} donde={pv ? 'en post venta' : tl ? 'en el taller' : 'en proyectos'} /></div>;
  const i = info(p); const setP = (k, v) => up(s => ({ ...s, proyectos: s.proyectos.map(x => x.id === p.id ? { ...x, [k]: v } : x) }));
  const roots = i.ts.filter(t => !t.parentId);
  const qn = q.trim().toLowerCase(); let visQ = null, nQ = 0;
  if (qn) { const ok = new Set(); i.ts.forEach(t => { if (((t.codigo || '') + ' ' + t.nombre).toLowerCase().includes(qn)) { nQ++; ok.add(t.id); let x = t, g = 0; while (x.parentId && g++ < 50) { ok.add(x.parentId); x = V.byId[x.parentId] || {}; } E.descendants(S, t.id).forEach(d => ok.add(d)); } }); visQ = t => ok.has(t.id); }
  const lotes = []; if (qn) { const gs = {}; i.ts.forEach(t => { if (V.D[t.id].parent || !((t.codigo || '') + ' ' + t.nombre).toLowerCase().includes(qn)) return; const k = claveP(t); (gs[k] = gs[k] || { k, nom: t.codigo || claveP(t).replace(/^N:/, ''), ids: [] }).ids.push(t.id); }); Object.values(gs).filter(g => g.ids.length > 1).slice(0, 6).forEach(g => lotes.push(g)); }
  const colV = qn ? new Set() : col; const ord = ordenProy(S); const rows = flatten(roots, V, colV, visQ, ord);
  const fin = id => V.D[id].estado === 'terminada';
  const conFin = id => fin(id) || (V.kids[id] || []).some(c => conFin(c.id));
  const visAct = t => (!visQ || visQ(t)) && (!fin(t.id) || (V.kids[t.id] || []).length > 0), visFin = t => (!visQ || visQ(t)) && conFin(t.id);
  const nFin = i.ts.filter(t => !V.D[t.id].parent && fin(t.id)).length, nAct = i.ts.filter(t => !V.D[t.id].parent && !fin(t.id)).length;
  const meses = {}; i.ts.forEach(t => { const r = V.D[t.id]; if (r.parent) return; const n = Math.max(1, t.ops.length); r.segs.forEach(s => { const m = s.d.slice(0, 7); meses[m] = (meses[m] || 0) + (s.h + (s.xe || 0)) * n; }); });
  const mk = Object.keys(meses).sort(), mmax = Math.max(1, ...Object.values(meses));
  const late = p.entrega && i.fin && i.fin.slice(0, 10) > p.entrega;
  // teléfono: resumen corto, selector de vista y datos del proyecto plegados
  const hoyD = E.today(), nowM = E.nowDT();
  const hojas = i.ts.filter(t => !V.D[t.id].parent), nAtr = hojas.filter(t => atrasadaT(V, t, nowM)).length, nFren = hojas.filter(t => E.estaFrenada(t)).length;
  const rA = [i.ini && i.ini.slice(0, 10), hoyD].filter(Boolean).sort()[0], rB = [i.fin && i.fin.slice(0, 10), p.entrega, hoyD].filter(Boolean).sort().pop();
  const rango = { a: rA, dias: E.diffDays(rA, rB) + 1, hoy: hoyD, ent: p.entrega || null };
  const diasEnt = p.entrega ? E.diffDays(hoyD, p.entrega) : null;
  const pvForm = <><label>Cliente<input id="p-cli" value={p.cliente || ''} onChange={e => setP('cliente', e.target.value)} /></label><label>Equipo / N° de serie<input id="p-eq" value={p.equipo || ''} onChange={e => setP('equipo', e.target.value)} placeholder="equipo y serie" /></label><label>OV original<input id="p-ov" value={p.ov || ''} onChange={e => setP('ov', e.target.value)} /></label></>;
  const vistaMov = v => { setVistaM(v); guardaG('movil-vista', v); };
  const buscador = <div className="pbusca"><input type="search" placeholder="Buscar pieza por código o descripción" value={q} onChange={e => setQ(e.target.value)} aria-label="Buscar pieza" />{qn && <span className="mut">{nQ ? `${nQ} ${nQ === 1 ? 'pieza encontrada' : 'piezas encontradas'}` : 'Ninguna pieza coincide'}</span>}{qn && <button className="btn sm" onClick={() => setQ('')}>Limpiar</button>}
      {lotes.map(g => <button key={g.k} className="btn sm pri-b" title="Editar a la vez todas las veces que aparece esta pieza en el proyecto" onClick={() => ui.modal({ k: 'lote', ids: g.ids, titulo: g.nom })}>✎ Editar en lote: {g.nom} (×{g.ids.length})</button>)}</div>;
  const ganttSec = <section><div className="sec-h"><div className="row"><h2>Árbol de piezas y Gantt</h2><div className="seg">{[['oculto', 'Oculto', 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c5 0 9 4.5 10 7a13 13 0 0 1-3 4M6.6 6.6C4.4 8 2.8 10 2 12c1 2.5 5 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2'], ['compacto', 'Compacto', 'M4 9h16M4 15h16M12 3v3l-2-2M12 3l2 2M12 21v-3l-2 2M12 21l2-2'], ['completo', 'Completo', 'M4 4h16v16H4zM4 9h16M4 14h16']].map(([k, l, d]) => <button key={k} className={altoG === k ? 'on' : ''} onClick={() => { setAltoG(k); guardaG('alto-' + p.id, k); }}><svg viewBox="0 0 24 24"><path d={d} /></svg>{l}</button>)}</div></div>
        {altoG !== 'oculto' && <span className="mut legend"><i className="lg t" />hoy <i className="lg d" />entrega</span>}</div>
      {altoG === 'oculto' ? <p className="mut">Oculto ({rows.length} {rows.length === 1 ? 'fila' : 'filas'}). Elegí Compacto o Completo para verlo.</p>
        : <Gantt rows={rows} ts={i.ts} entrega={p.entrega} color={p.color} collapsed={colV} toggle={tog} alto={altoG} todo={c => setCol(c ? new Set(i.ts.filter(t => (V.kids[t.id] || []).length).map(t => t.id)) : new Set())} />}</section>;
  const tablas = <><section><div className="sec-h"><h2>Pendientes y en proceso <span className="cnt">{nAct}</span></h2><VistaSel v={vp} set={setVp} /><span className="mut">Mayús + Espacio (Shift + Space) marca la fila · en la casilla alcanza con Espacio</span></div>{vp === 'proceso' ? <TableroProc roots={roots} vis={visAct} tabla={(rs, v) => <TaskTable roots={rs} tipo="proy" vis={v} collapsed={colV} toggle={tog} orden={ord} />} /> : <SeccEstado roots={roots} vis={visAct} tabla={v => <TaskTable roots={roots} tipo="proy" vis={v} collapsed={colV} toggle={tog} orden={ord} />} />}</section>
    <section className="finsec"><div className="sec-h"><button className="dgrp-t fin-t" onClick={() => { setVerFin(!verFin); guardaG('verfin', !verFin); }}><span className="car">{verFin ? '▾' : '▸'}</span><h2>Finalizadas <span className="cnt ok">{nFin}</span></h2></button></div>
      {verFin && (nFin ? <TaskTable roots={roots} tipo="proy" vis={visFin} collapsed={colV} toggle={tog} orden={ord} /> : <Vacio ic="reloj" chico t="Todavía no hay piezas finalizadas en este proyecto" />)}</section></>;
  const kpis = <div className="kpis">
        <Kpi l="Avance" v={Math.round(i.av) + '%'} s={`${fN(i.hh * i.av / 100)} de ${fN(i.hh)} HH`} onClick={() => setDet(det === 'av' ? null : 'av')} on={det === 'av'} />
        <Kpi l="Inicio proyectado" v={fD(i.ini && i.ini.slice(0, 10))} /><Kpi l="Fin proyectado" v={fD(i.fin && i.fin.slice(0, 10))} tone={late ? 'bad' : ''} s={late ? `${E.diffDays(p.entrega, i.fin.slice(0, 10))} d después de la entrega` : p.entrega ? `entrega ${fD(p.entrega)}` : ''} />
        <Kpi l="HH reales cargadas" v={fH(i.real)} s={`plan a la fecha ${fN(i.hh * i.av / 100)} h${i.prev > 0 ? ` · incluye ${fN(i.prev)} h previas` : ''}`} onClick={() => setDet(det === 'hh' ? null : 'hh')} on={det === 'hh'} />
        <div className="kpi grow"><span>Horas-hombre por mes</span><div className="mbars">{mk.length === 0 && <em>Sin tareas programadas</em>}{mk.map(m => <div key={m} title={`${fN(meses[m])} HH`}><i style={{ height: Math.max(4, meses[m] / mmax * 44), background: p.color }} /><small>{E.MESES[Number(m.slice(5)) - 1]}</small><small className="v">{Math.round(meses[m])}</small></div>)}</div></div>
      </div>;
  const datosForm = <div className="form inline">
        <label>Nombre<input id="p-nom" value={p.nombre} onChange={e => setP('nombre', e.target.value)} /></label>
        <label>Iniciales<input id="p-ini" className="w4" maxLength="4" value={p.ini} onChange={e => setP('ini', e.target.value.toUpperCase())} /></label>
        <label>Color<input id="p-col" type="color" value={p.color} onChange={e => setP('color', e.target.value)} /></label>
        <label>{pv ? 'Fecha comprometida de envío' : 'Entrega comprometida'}<input id="p-ent" type="date" value={p.entrega || ''} onChange={e => setP('entrega', e.target.value)} /></label>
        {p.terminado && <label>Terminado el<input id="p-term" type="date" value={p.terminadoEl || ''} max={E.today()} onChange={e => setP('terminadoEl', e.target.value)} /></label>}
        <label title="Horas-hombre reales que el proyecto ya llevaba antes de cargarlas en la app (punto de partida). Se suman a las HH reales; las que cargues en las piezas se suman encima.">HH reales previas<input id="p-hprev" className="w4" style={{ width: 110 }} type="number" min="0" step="0.5" placeholder="0" value={p.hhPrevias ?? ''} onChange={e => setP('hhPrevias', e.target.value)} onBlur={e => { const n = Math.max(0, Number(e.target.value) || 0); if (typeof p.hhPrevias === 'string' || n !== (p.hhPrevias || 0)) setP('hhPrevias', n); }} /></label>
        {pv && pvForm}
        <label className="chk etp" title="Dentro de cada ensamblaje, cada etapa (corte, lijado, plegado, mecanizado, soldadura…) espera a que terminen las anteriores. El orden de las etapas se define en Configuración → Operaciones."><input type="checkbox" checked={!!p.etapas} onChange={e => setP('etapas', e.target.checked)} /> Desplazar por etapas de fabricación</label>
        {p.etapas && <button className="btn" onClick={() => { let n = 0; up(s => { const r = E.acomodarEtapas(s, p.id); n = r.n; return r.S; }); ui.toast(n ? `${n} ${n === 1 ? 'tarea corrida' : 'tareas corridas'} para respetar el orden de las etapas` : 'Ya estaba todo en orden de etapas'); }}>Acomodar por etapas</button>}
        {i.ts.some(t => t.pos !== undefined && t.pos !== null) && <button className="btn" title="Borra el orden manual (▲▼) y vuelve a ordenar por etapa" onClick={() => up(s => ({ ...s, tareas: s.tareas.map(t => t.proyId === p.id && t.pos !== undefined && t.pos !== null ? { ...t, pos: null } : t) }))}>Ordenar por etapa</button>}
        <button className={'btn ' + (p.terminado ? 'warn-b' : 'ok-b')} title={p.terminado ? 'Vuelve a mostrarlo en las pestañas' : 'Lo saca de las pestañas y lo guarda en Terminados; no se pierde ningún dato'} onClick={() => { const nt = !p.terminado; ui.confirmar({ titulo: nt ? (caso ? '¿Marcar el caso como terminado?' : '¿Marcar el proyecto como terminado?') : (caso ? '¿Reabrir el caso?' : '¿Reabrir el proyecto?'), texto: nt ? `“${p.nombre}” se va a la sección Terminados y deja de aparecer entre los activos. Los datos no se pierden y lo podés reabrir cuando quieras.` : `“${p.nombre}” vuelve a la lista de activos.`, si: nt ? 'Sí, marcar como terminado' : 'Sí, reabrir', fecha: nt ? E.today() : undefined, onSi: f => { up(s => ({ ...s, proyectos: s.proyectos.map(x => x.id === p.id ? { ...x, terminado: nt, terminadoEl: nt ? (f || E.today()) : '' } : x) })); if (nt) setPid(null); ui.toast(nt ? `${p.nombre} pasó a Terminados. Podés deshacerlo arriba.` : `${p.nombre} volvió a los activos.`); } }); }}>{p.terminado ? '↩ Reabrir' : '✓ Marcar como terminado'}</button>
        <button className="btn danger" onClick={() => { const nt = S.tareas.filter(t => t.proyId === p.id).length; ui.confirmar({ titulo: caso ? '¿Borrar el caso?' : '¿Borrar el proyecto?', texto: `Se borra “${p.nombre}”${nt ? ` y sus ${nt} tarea${nt === 1 ? '' : 's'}` : ''}. Si solo terminó, mejor usá “Marcar como terminado”. Podés deshacerlo arriba.`, si: 'Sí, borrar', peligro: true, onSi: () => { up(s => ({ ...s, proyectos: s.proyectos.filter(x => x.id !== p.id), tareas: s.tareas.filter(t => t.proyId !== p.id) })); setPid(null); ui.toast('Proyecto borrado. Podés deshacerlo arriba.'); } }); }}>Borrar proyecto</button>
      </div>;
  const tablasMovil = <><section><div className="sec-h"><h2>Pendientes y en proceso <span className="cnt">{nAct}</span></h2></div><SeccEstado roots={roots} vis={visAct} tabla={v => <TablaMovil roots={roots} vis={v} orden={ord} />} /></section>
    <section className="finsec"><div className="sec-h"><button className="dgrp-t fin-t" onClick={() => { setVerFin(!verFin); guardaG('verfin', !verFin); }}><span className="car">{verFin ? '▾' : '▸'}</span><h2>Finalizadas <span className="cnt ok">{nFin}</span></h2></button></div>
      {verFin && (nFin ? <TablaMovil roots={roots} vis={visFin} orden={ord} /> : <Vacio ic="reloj" chico t="Todavía no hay piezas finalizadas en este proyecto" />)}</section></>;
  if (movil) return <div className="view pmovil">{tabs}
    <section>
      <div className="sec-h"><div className="row"><span className="chip" style={{ '--c': p.color }}>{p.ini}</span><h2>{p.nombre}</h2>{p.terminado && <span className="tag ok">✓ Terminado{p.terminadoEl ? ` el ${fD(p.terminadoEl)}` : ''}</span>}</div>
        <button className="btn pri-b" onClick={() => ui.modal({ k: 'task', draft: E.blankTask('proy', p.id, pv) })}>+ Pieza</button></div>
      <button type="button" className={'presum' + (masM ? ' on' : '')} style={{ '--c': p.color }} aria-expanded={masM} onClick={() => setMasM(!masM)}>
        <span className="presum-av"><b>{Math.round(i.av)}%</b><Bar v={i.av} color={p.color} /></span>
        <span className={'presum-d' + (late ? ' c-bad' : '')}><b>{diasEnt === null ? fD(i.fin && i.fin.slice(0, 10)) : late ? `+${E.diffDays(p.entrega, i.fin.slice(0, 10))} d` : diasEnt < 0 ? 'vencida' : `${diasEnt} d`}</b><small>{diasEnt === null ? 'fin proyectado' : late ? 'pasada de la entrega' : diasEnt < 0 ? `entrega ${fD(p.entrega)}` : `a la entrega (${fD(p.entrega)})`}</small></span>
        <span className={'presum-n' + (nAtr ? ' c-bad' : '')}><b>⚠ {nAtr}</b><small>{nAtr === 1 ? 'atrasada' : 'atrasadas'}</small></span>
        <span className={'presum-n' + (nFren ? ' warn' : '')}><b>⏸ {nFren}</b><small>{nFren === 1 ? 'frenada' : 'frenadas'}</small></span>
        <i className="kar">{masM ? '▴' : '▾'}</i>
      </button>
      {masM && <div className="presum-mas">{kpis}<h3>Datos del proyecto</h3>{datosForm}<div className="row"><button className="btn" onClick={() => ui.modal({ k: 'imp', mode: 'proy', proyId: p.id })}>Importar árbol .xlsx</button><button className="btn" title="Descarga un Excel con los tiempos y costos de fabricación de cada pieza de este proyecto" onClick={() => exportarProyecto(S, V, p, ui.toast, STK)}>Exportar a Excel (.xlsx)</button><button className="btn pri-b" onClick={() => ui.modal({ k: 'plan', proyId: p.id })}>Planificar proyecto</button>{pv && pm.admin && <button className="btn" onClick={() => ui.modal({ k: 'salida', proyId: p.id })}>+ Salida de operario</button>}</div></div>}
    </section>
    {det && <Desglose roots={roots} ts={i.ts} vista={det} hhv={hhv} setHhv={setHhv} color={p.color} prev={i.prev} cerrar={() => setDet(null)} />}
    {buscador}
    <PendProc donde={(caso ? 'en este caso' : 'en este proyecto') + (qn ? ' · con la búsqueda' : '')} ts={visQ ? i.ts.filter(visQ) : i.ts} />
    <div className="seg vistam">{[['lista', 'Lista', 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01'], ['gantt', 'Gantt', 'M4 6h9M8 12h10M6 18h7'], ['tabla', 'Tabla', 'M4 4h16v16H4zM4 10h16M10 4v16']].map(([k, l, d]) => <button key={k} className={vistaM === k ? 'on' : ''} onClick={() => vistaMov(k)}><svg viewBox="0 0 24 24"><path d={d} /></svg>{l}</button>)}</div>
    {pv && <SalidasPV p={p} />}{pv && <RegistroPV ts={i.ts} />}
        {vistaM === 'lista' ? <ProyLista roots={roots} ts={i.ts} p={p} rango={rango} visQ={visQ} q={qn} /> : vistaM === 'gantt' ? ganttSec : tablasMovil}
  </div>;
  return <div className="view">{tabs}
    <section>
      <div className="sec-h"><div className="row"><span className="chip" style={{ '--c': p.color }}>{p.ini}</span><h2>{p.nombre}</h2>{p.terminado && <span className="tag ok">✓ Terminado{p.terminadoEl ? ` el ${fD(p.terminadoEl)}` : ''}</span>}</div>
        <div className="row"><button className="btn" onClick={() => ui.modal({ k: 'imp', mode: 'proy', proyId: p.id })}>Importar árbol .xlsx</button><button className="btn" title="Descarga un Excel con los tiempos y costos de fabricación de cada pieza de este proyecto" onClick={() => exportarProyecto(S, V, p, ui.toast, STK)}>Exportar a Excel (.xlsx)</button><button className="btn" onClick={() => ui.modal({ k: 'plan', proyId: p.id })}>Planificar proyecto</button>{pv && pm.admin && <button className="btn" onClick={() => ui.modal({ k: 'salida', proyId: p.id })}>+ Salida de operario</button>}<button className="btn pri-b" onClick={() => ui.modal({ k: 'task', draft: E.blankTask('proy', p.id, pv) })}>+ Pieza</button></div></div>
      {datosForm}
      {kpis}
    </section>
    <div className="pbusca"><input type="search" placeholder="Buscar pieza por código o descripción" value={q} onChange={e => setQ(e.target.value)} aria-label="Buscar pieza" />{qn && <span className="mut">{nQ ? `${nQ} ${nQ === 1 ? 'pieza encontrada' : 'piezas encontradas'}` : 'Ninguna pieza coincide'}</span>}{qn && <button className="btn sm" onClick={() => setQ('')}>Limpiar</button>}
      {lotes.map(g => <button key={g.k} className="btn sm pri-b" title="Editar a la vez todas las veces que aparece esta pieza en el proyecto" onClick={() => ui.modal({ k: 'lote', ids: g.ids, titulo: g.nom })}>✎ Editar en lote: {g.nom} (×{g.ids.length})</button>)}</div>
    {det && <Desglose roots={roots} ts={i.ts} vista={det} hhv={hhv} setHhv={setHhv} color={p.color} prev={i.prev} cerrar={() => setDet(null)} />}
    <section><div className="sec-h"><div className="row"><h2>Árbol de piezas y Gantt</h2><div className="seg">{[['oculto', 'Oculto', 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c5 0 9 4.5 10 7a13 13 0 0 1-3 4M6.6 6.6C4.4 8 2.8 10 2 12c1 2.5 5 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2'], ['compacto', 'Compacto', 'M4 9h16M4 15h16M12 3v3l-2-2M12 3l2 2M12 21v-3l-2 2M12 21l2-2'], ['completo', 'Completo', 'M4 4h16v16H4zM4 9h16M4 14h16']].map(([k, l, d]) => <button key={k} className={altoG === k ? 'on' : ''} onClick={() => { setAltoG(k); guardaG('alto-' + p.id, k); }}><svg viewBox="0 0 24 24"><path d={d} /></svg>{l}</button>)}</div></div>
        {altoG !== 'oculto' && <span className="mut legend"><i className="lg t" />hoy <i className="lg d" />entrega</span>}</div>
      {altoG === 'oculto' ? <p className="mut">Oculto ({rows.length} {rows.length === 1 ? 'fila' : 'filas'}). Elegí Compacto o Completo para verlo.</p>
        : <Gantt rows={rows} ts={i.ts} entrega={p.entrega} color={p.color} collapsed={colV} toggle={tog} alto={altoG} todo={c => setCol(c ? new Set(i.ts.filter(t => (V.kids[t.id] || []).length).map(t => t.id)) : new Set())} />}</section>
    {pv && <SalidasPV p={p} />}{pv && <RegistroPV ts={i.ts} />}
        <PendProc donde={(caso ? 'en este caso' : 'en este proyecto') + (qn ? ' · con la búsqueda' : '')} ts={visQ ? i.ts.filter(visQ) : i.ts} />
        <section><div className="sec-h"><h2>Pendientes y en proceso <span className="cnt">{nAct}</span></h2><VistaSel v={vp} set={setVp} /><span className="mut">Mayús + Espacio (Shift + Space) marca la fila · en la casilla alcanza con Espacio</span></div>{vp === 'proceso' ? <TableroProc roots={roots} vis={visAct} tabla={(rs, v) => <TaskTable roots={rs} tipo="proy" vis={v} collapsed={colV} toggle={tog} orden={ord} />} /> : <SeccEstado roots={roots} vis={visAct} tabla={v => <TaskTable roots={roots} tipo="proy" vis={v} collapsed={colV} toggle={tog} orden={ord} />} />}</section>
    <section className="finsec"><div className="sec-h"><button className="dgrp-t fin-t" onClick={() => { setVerFin(!verFin); guardaG('verfin', !verFin); }}><span className="car">{verFin ? '▾' : '▸'}</span><h2>Finalizadas <span className="cnt ok">{nFin}</span></h2></button></div>
      {verFin && (nFin ? <TaskTable roots={roots} tipo="proy" vis={visFin} collapsed={colV} toggle={tog} orden={ord} /> : <Vacio ic="reloj" chico t="Todavía no hay piezas finalizadas en este proyecto" />)}</section>
  </div>;
}

/* ================= EDITOR DE TAREA ================= */
function TaskEditor({ id, draft, onClose }) {
  const { S, V, up, ui } = useApp();
  const orig = id ? S.tareas.find(t => t.id === id) : draft;
  const [hhTocado, setHhTocado] = useState(!!id); const [t, setT] = useState(orig); const [predOpen, setPredOpen] = useState(false); const [pq, setPq] = useState('');
  if (!orig || !t) return null;
  const isNew = !id, parent = !!id && !!V.D[id] && V.D[id].parent, root = !t.parentId;
  const set = (k, v) => setT(p => ({ ...p, [k]: v })); const pvT = t.tipo === 'proy' && !!(S.proyectos.find(x => x.id === t.proyId) || {}).pv;
  const n = Math.max(1, t.ops.length), hh = Number(t.hh) || 0;
  const w = t.inicio ? E.addWork(S, t.inicio, hh / n, t.turno, t.ops) : null;
  const hhEntre = fin => t.inicio && fin && fin > t.inicio ? Math.round(E.workBetween(S, t.inicio, fin, t.turno, t.ops) * n * 100) / 100 : 0;
  const setFinReal = v => { if (!v) { setT(p => ({ ...p, realFin: false })); return; } const h = hhEntre(v); setT(p => ({ ...p, finReal: v, realFin: true, ...(h > 0 ? { hhReal: h } : {}) })); };
  const setFin = v => { if (!t.inicio || !v) return; const h = E.workBetween(S, t.inicio, v, t.turno, t.ops) * n; if (h > 0) set('hh', Math.round(h * 100) / 100); };
  const togOp = o => set('ops', t.ops.includes(o) ? t.ops.filter(x => x !== o) : [...t.ops, o]);
  const togPred = p => set('preds', (t.preds || []).includes(p) ? t.preds.filter(x => x !== p) : [...(t.preds || []), p]);
  const scope = S.tareas.filter(x => x.id !== t.id && !V.D[x.id].parent && x.id !== t.parentId && (t.tipo === 'proy' ? x.proyId === t.proyId : x.tipo === 'rep' && V.rootOf(x).orden === V.rootOf(t).orden));
  const cod = E.codOp(S, t.nombre), hist = !parent && !t.corte ? E.historial(S, t.nombre) : null, recs = !parent ? E.recomendar(S, { ...t, hh }) : [];
  const alSalirNombre = () => { if (parent) return; const a = E.autoCompletar(S, t, !hhTocado); if (Object.keys(a).length) setT(p => ({ ...p, ...a })); };
  const save = (conf, meter, aus) => {   // aus: { sin: [operarios a sacar] } o { ok: true } (respuesta al aviso de operario ausente); meter: true = pausar lo que estaba en curso a la hora de inicio, false = guardar sin pausar (sin dato: pregunta)
    if (!t.nombre.trim()) { ui.toast('Poné el nombre de la pieza'); return; }
    const pisa = t.estado === 'en proceso' && (isNew || orig.estado !== 'en proceso') && !t.frenada && t.ops.length ? E.enCurso(S, t.ops, t.id, t) : [];   // arranca ahora: avisa si el operario ya tiene otra en curso (las solapables de otra operación no cuentan)
    if (pisa.length && conf !== true) { avisarOcupado(S, ui, pisa, t.ops, t.nombre.trim(), () => save(true, meter, aus)); return; }
    // Restan (25/11): si cambió (y no se tocaron las horas a mano), se aplica después con la regla de entregas parciales
    const rOrig = orig.restan ?? null, rNuevo = t.restan === '' || t.restan == null ? null : Number(t.restan);
    const cambiaR = t.tipo === 'rep' && (rNuevo !== (rOrig == null ? null : Number(rOrig)) || (rNuevo != null && Number(t.cant) !== Number(orig.cant)));
    const viaR = cambiaR && !isNew && !parent && hh === (Number(orig.hh) || 0);
    const x = { ...t, hh, cant: Number(t.cant) || 0, restan: rNuevo != null && rNuevo < (Number(t.cant) || 0) ? rNuevo : null, ...(viaR ? { cant: orig.cant, restan: orig.restan ?? null } : {}), avance: Math.min(100, Math.max(0, Number(t.avance) || 0)), hhReal: Number(t.hhReal) || 0 };
    if (x.estado !== 'terminada') { x.tercerizada = false; x.sinFecha = false; }   // si deja de estar finalizada, deja de ser tercerizada
    if (!E.esPend(x)) x.proximo = null; else if (x.estado === 'proximo') x.proximo = x.proximo || E.nowDT(); else x.proximo = null;   // al iniciarla o finalizarla deja de estar en Próximo a realizar
    if (x.estado === 'terminada') { x.avance = 100; if (!x.finReal && !x.sinFecha) x.finReal = E.nowDT(); if (x.sinFecha) { x.finReal = null; x.realFin = false; } if (x.realFin && !(x.inicio && x.finReal > x.inicio)) x.realFin = false; } else { x.finReal = null; x.realFin = false; }
    if (x.estado !== orig.estado || isNew) x.crono = x.estado === 'en proceso' ? { acum: orig.crono ? Number(orig.crono.acum) || 0 : x.hhReal, desde: E.nowDT() } : x.estado === 'terminada' ? { acum: x.hhReal, desde: null } : null;
    if (x.estado === 'terminada' && !x.sinFecha && !x.realFin && x.finReal && x.inicio && x.finReal > x.inicio && x.inicio !== orig.inicio) { x.realFin = true; if (!(x.hhReal > 0) && x.ops.length) x.hhReal = Math.round(E.workBetween(S, x.inicio, x.finReal, x.turno, x.ops) * x.ops.length * 100) / 100; }   // se corrigió el inicio: el fin real que había quedado antes vuelve a valer
    if (aus && aus.sin) { x.ops = x.ops.filter(o => !aus.sin.includes(o)); if (x.realFin && x.finReal > x.inicio && x.ops.length) x.hhReal = Math.round(E.workBetween(S, x.inicio, x.finReal, x.turno, x.ops) * x.ops.length * 100) / 100; }
    if (!x.ops.length || (x.frenada && x.estado !== 'terminada')) x.inicio = x.inicio || null; else if (!x.inicio) { const pg = E.pegadoA(S, x.ops, x.turno, x.id, x); x.inicio = pg ? pg.ini : E.nextFree(S, x.ops[0], x.turno, x.ops, x); }   // frenada sin fecha: sigue sin ocupar el calendario
    // se finaliza acá: si es antes de lo planificado, el fin real es ahora y la cadena del operario sigue
    const cierra = !isNew && !parent && !x.sinFecha && x.estado === 'terminada' && orig.estado !== 'terminada' && orig.inicio && orig.ops.length;
    const finPlan = cierra ? E.finOf(S, orig) : null;
    if (cierra && !x.realFin && finPlan && x.finReal < finPlan && x.inicio < x.finReal) x.realFin = true;
    // un operario no trabaja ese día (ausencia, "Activo desde", ocasional): la tarea entera se correría al día siguiente → avisar quién es
    const fAus = !aus && !parent && !x.sinFecha && x.inicio && (isNew || x.inicio !== orig.inicio || x.ops.join() !== orig.ops.join()) ? faltaDia(S, x) : null;
    if (fAus) { avisarAusente(S, ui, fAus, x, () => save(conf, meter, { sin: fAus.quien.map(z => z.o) }), () => save(conf, meter, { ok: true })); return; }
    // puesta en medio de otra: si el inicio cae cuando el operario ya tenía otra en curso, ofrece pausarla a esa hora
    const corta = !parent && !pisa.length && !x.sinFecha && !(x.frenada && x.estado !== 'terminada') && (isNew || x.inicio !== orig.inicio || x.ops.join() !== orig.ops.join() || x.estado !== orig.estado) ? E.interrumpidas(S, x, x.inicio) : [];
    const retoma = x.estado === 'terminada' && x.realFin && x.finReal > x.inicio && x.finReal <= E.nowDT() ? x.finReal : null;   // ya terminó: lo interrumpido sigue en curso desde su fin real
    if (corta.length && meter === undefined) { avisarInterrumpe(S, ui, corta, x, retoma, () => save(true, true, aus), () => save(true, false, aus)); return; }
    const mover = !parent && (isNew || ['inicio', 'hh', 'turno'].some(k => x[k] !== orig[k]) || !!x.realFin !== !!orig.realFin || (x.realFin && x.finReal !== orig.finReal) || x.ops.join() !== orig.ops.join() || (x.preds || []).join() !== (orig.preds || []).join());
    let r = null;
    up(s => { const s0 = pisa.length ? E.pausarEnCurso(s, x.ops, x.id) : corta.length && meter ? E.interrumpir(s, x, x.inicio, retoma) : s; const s2 = E.patchTask(isNew ? { ...s0, tareas: [...s0.tareas, x] } : s0, x.id, x, mover); if (!cierra) return s2; r = E.trasCerrar(s2, s, x.id, finPlan); return r.S; });
    const a = avisoCadena(r); if (a) ui.toast(a); onClose();
    if (viaR && x.estado !== 'terminada') aplicarRestan({ ...S, tareas: S.tareas.map(y => y.id === x.id ? x : y) }, up, ui, x.id, rNuevo, { cant: Number(t.cant) || 0 });
  };
  const foot = <>
    {!isNew && <button className="btn danger" onClick={() => ui.confirmar({ titulo: '¿Borrar la tarea?', texto: 'Se borra esta tarea. Podés deshacerlo arriba.', si: 'Sí, borrar', peligro: true, onSi: () => { up(s => E.delTask(s, id)); onClose(); ui.toast('Borrada. Podés deshacerlo arriba.'); } })}>Borrar</button>}
    {!isNew && <button className="btn" onClick={() => { up(s => E.dupTask(s, id)); onClose(); ui.toast('Duplicada'); }}>Duplicar</button>}
    {!isNew && !parent && orig.estado !== 'terminada' && (orig.frenada ? <button className="btn pri-b" onClick={() => ui.modal({ k: 'retomar', id })}>Retomar</button> : <button className="btn warn-b" title="Para el trabajo por días: lo hecho queda cerrado y lo que falta queda frenado" onClick={() => ui.modal({ k: 'frenar', id })}>Frenar</button>)}
    {!isNew && E.puedeCorte(S, orig) && <button className="btn" title="Suma el corte de material como una parte más de esta pieza (mismo código), con su operario y su tiempo" onClick={() => ui.modal({ k: 'corte', id })}>✂ Agregar corte</button>}
    {!isNew && !parent && orig.estado !== 'terminada' && <button className="btn terc-b" title="La pieza la hace un proveedor: queda finalizada y tercerizada, sin ocupar planta" onClick={() => ui.modal({ k: 'tercerizar', id })}>↗ Tercerizar</button>}
    {!isNew && !parent && orig.tercerizada && <button className="btn" title="Deshace la tercerización: la pieza vuelve a pendiente y se reprograma en planta" onClick={() => { up(s => E.volverAPlanta(s, id)); ui.toast('Volvió a planta: quedó pendiente y reprogramada'); onClose(); }}>↩ Volver a planta</button>}
    <span className="sp" /><button className="btn canc-b" onClick={onClose}>Cancelar</button><button className="btn pri-b" data-enter onClick={() => save()}>Guardar</button></>;
  return <Modal title={isNew ? (t.parentId ? 'Nueva tarea hija' : t.tipo === 'rep' ? 'Nuevo repuesto' : 'Nueva pieza') : 'Editar tarea'} onClose={onClose} foot={foot} footCls="foot1">
    {orig.tercerizada && <p className="note terc">{tercTxt(orig)}{orig.tercNota ? ` · ${orig.tercNota}` : ''}. Cuenta como finalizada; no ocupa operarios ni horas de planta.</p>}
    {E.estaFrenada(orig) && <p className="note fren">⏸ Frenada · {txtFreno(orig)}{orig.frenada.nota ? ` · ${orig.frenada.nota}` : ''}. {orig.inicio ? `Programada para ${fDT(orig.inicio)}.` : 'No ocupa el calendario hasta que la retomes.'}</p>}
    {!isNew && (orig.frenoHist || []).length > 0 && <p className="mut">Estuvo frenada {orig.frenoHist.length === 1 ? 'una vez' : orig.frenoHist.length + ' veces'}: {orig.frenoHist.map(h => `${h.motivo} (${fD((h.desde || '').slice(0, 10))} → ${fD((h.retomada || '').slice(0, 10))}${h.nota ? ', ' + h.nota : ''})`).join(' · ')}</p>}
    <div className="form">
      <label className="g2">Pieza<input id="te-nom" value={t.nombre} onChange={e => set('nombre', e.target.value)} onBlur={alSalirNombre} autoFocus /></label>
      <label>Cantidad<input id="te-cant" type="number" min="0" value={t.cant} onChange={e => set('cant', e.target.value)} onBlur={alSalirNombre} /></label>
      {t.tipo === 'rep' && <label title="Lo que falta fabricar (entregas parciales). Vacío = toda la cantidad.">Restan<input id="te-rest" type="number" min="0" value={t.restan ?? ''} placeholder={String(Number(t.cant) || 0)} onChange={e => set('restan', e.target.value === '' ? null : e.target.value)} /></label>}
      {t.tipo === 'rep' && root && <><label>N° de OV/OC<input id="te-ord" value={t.orden} placeholder="OV-0000" onChange={e => set('orden', e.target.value)} /></label>
        <label>Cliente<input id="te-cli" value={t.cliente} onChange={e => set('cliente', e.target.value)} /></label>
        <label>Entrega comprometida<input id="te-ent" type="date" value={t.entrega || ''} onChange={e => set('entrega', e.target.value)} /></label>
        <label>Fecha de carga de la orden<input id="te-cre" type="date" value={t.creada || ''} max={E.today()} onChange={e => set('creada', e.target.value)} /></label></>}
      <label>Prioridad<select id="te-pri" value={t.prioridad} onChange={e => set('prioridad', e.target.value)}><option>alta</option><option>media</option><option>baja</option></select></label>
      {parent && t.agrupa && <label className="chk g2"><input type="checkbox" checked onChange={() => set('agrupa', false)} /> Es solo un grupo (destildá si este paso lleva trabajo propio)</label>}
      {parent ? <p className="note g2">{t.partes ? 'Esta tarea está partida en partes' : t.agrupa ? 'Es un grupo (por ejemplo Mecanizado o Soldadura)' : 'Es un ensamblaje general (primer nivel)'}: sus fechas, horas y avance salen del resumen de todo lo que tiene adentro ({fDT(V.D[id].inicio)} → {fDT(V.D[id].fin)}, {fN(V.D[id].hh)} HH, {Math.round(V.D[id].avance)}%).</p> : <>
        {!!id && (V.kids[id] || []).length > 0 && t.parentId && <label className="chk g2"><input type="checkbox" checked={!!t.agrupa} onChange={e => set('agrupa', e.target.checked)} /> Es solo un grupo (no lleva trabajo propio: suma lo que tiene adentro)</label>}
        {!!id && (V.kids[id] || []).length > 0 && <p className="note g2">Esta pieza tiene {(V.kids[id] || []).length} {(V.kids[id] || []).length === 1 ? 'hija' : 'hijas'} y lleva su propio trabajo (por ejemplo, soldarlas o armarlas): las horas, el operario y el avance son solo de este paso. Empieza cuando terminan sus hijas.{(() => { const hj = hijosDe(V, id); return <> Sus hijas suman <b>{fN(hj.hh)} HH planificadas</b> y <b>{hj.hhReal > 0 ? fN(hj.hhReal) : '0'} HH reales</b>.</>; })()}</p>}
        {t.tipo === 'proy' && !isNew && <label className="chk g2"><input type="checkbox" checked={!!t.manual} onChange={e => set('manual', e.target.checked)} /> Fecha fijada a mano 📌 (no se corre por las etapas anteriores)</label>}
        <label>Operación<select id="te-op" value={t.operacionId} onChange={e => setT(p => ({ ...p, operacionId: e.target.value, opAuto: false }))}><option value="">—</option>{S.operaciones.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select>
          {cod && (cod.operacionId ? <small className={t.operacionId === cod.operacionId ? 'hint ok' : 'hint'}>Código {cod.num} → {operName(S, cod.operacionId)}{t.operacionId !== cod.operacionId && t.operacionId ? ' (la cambiaste a mano)' : ''}</small> : <small className="hint">El código {cod.num} no tiene operación asignada. Se carga en Configuración → Códigos de operación.</small>)}</label>
        <label>Turno<select id="te-tur" value={t.turno} onChange={e => set('turno', e.target.value)}><option value="normal">Normal</option><option value="extra">Horas extra</option><option value="ambos">Normal + extra</option></select></label>
        {t.estado !== 'terminada' && <div className="g2 fld recs"><span>Recomendado para {t.operacionId ? operName(S, t.operacionId) : 'esta tarea'}</span>
          {!t.operacionId ? <small className="mut">Elegí la operación para ver a quién conviene dársela.</small>
            : recs.length === 0 ? <small className="mut">Ningún operario tiene {operName(S, t.operacionId)} como operación principal o secundaria. Se carga en Configuración → Operarios.</small>
            : <div className="reclist">{recs.slice(0, 4).map((r, i) => <div key={r.op} className={'rec' + (t.ops.length === 1 && t.ops[0] === r.op ? ' on' : '') + (i === 0 ? ' top' : '')}>
                <b>{r.nombre}</b><span className={'tag' + (r.nivel === 1 ? ' ok' : '')}>{r.nivel === 1 ? 'principal' : 'secundaria'}</span>
                <span className="mut">entra {fDT(r.ini)}{r.fin ? ` · termina ${fDT(r.fin)}` : ''}</span>
                <button type="button" className="btn sm" onClick={() => setT(p => ({ ...p, ops: [r.op], inicio: r.ini }))}>{t.ops.length === 1 && t.ops[0] === r.op ? 'Elegido' : 'Dársela'}</button></div>)}</div>}</div>}
        <div className="g2 fld"><span>Operarios</span><div className="togs">{S.operarios.filter(o => o.activo || t.ops.includes(o.id)).map(o => <button key={o.id} type="button" className={'togb' + (t.ops.includes(o.id) ? ' on' : '')} onClick={() => togOp(o.id)}>{o.nombre}</button>)}</div></div>
        <div className="g2 fila-ini"><label>{t.estado === 'terminada' ? 'Inicio (real)' : 'Inicio'}<span className="incalc ini-bts"><input id="te-ini" type="datetime-local" value={t.inicio || ''} onChange={e => set('inicio', e.target.value || null)} /><button type="button" className="btn sm" title="Poner la fecha y hora actual" onClick={() => set('inicio', E.nowDT())}>Ahora</button>{!parent && t.ops.length > 0 && <button type="button" className="btn sm" title="Pegarla detrás de la última tarea del operario: la que está en proceso o pendiente, o si no tiene ninguna, el fin de la última finalizada" onClick={() => { const pg = E.pegadoA(S, t.ops, t.turno, t.id); if (pg) set('inicio', pg.ini); }}>Pegar a la anterior</button>}</span>
          {!parent && t.estado !== 'terminada' && t.ops.length > 0 && (() => {
            if (!t.inicio) { const pg = E.pegadoA(S, t.ops, t.turno, t.id, t); return <small className="hint">Sin inicio: va a empezar {pg.tras ? <>pegada a «{pg.tras.nombre}», </> : 'cuando se libere, '}en {fDT(pg.ini)}.</small>; }
            const tt = { ...t, hh }, p = E.pisadasDe(S, tt);
            if (!p.length) return <small className="hint ok">✓ {t.ops.length === 1 ? opName(S, t.ops[0]) + ' está libre' : 'Los operarios están libres'} en ese horario.</small>;
            const hueco = E.primerHueco(S, tt);
            return <div className="pisa"><span>⚠ {p.slice(0, 2).map(x => <span key={x.tarea.id + x.op}><b>{opName(S, x.op)}</b> está ocupado con <b>{x.tarea.nombre}</b> hasta {fDT(x.fin)}. </span>)}{p.length > 2 && <span className="mut">y {p.length - 2} más. </span>}</span>
              <button type="button" className="btn sm pri-b" onClick={() => set('inicio', hueco)}>Empezar cuando se libere: {fDT(hueco)}</button></div>; })()}</label>
        <label className="hh-ch">Horas-hombre (trabajo total)<span className="incalc"><input id="te-hh" type="number" min="0" step="0.5" value={t.hh} onChange={e => { setHhTocado(true); set('hh', e.target.value); }} /><CalcBtn cant={E.unidadesDe(t)} titulo={(t.nombre || 'Pieza') + ' · duración'} onUse={v => { setHhTocado(true); set('hh', Math.round(v * 100) / 100); }} /></span>
          {!hist && !parent && !t.corte && <SugFam k={E.claveCod(t.nombre)} nombre={t.nombre} />}
          {hist && <small className="hint">{hist.n ? <>Se hizo {hist.n} {hist.n === 1 ? 'vez' : 'veces'}</> : 'Base medida, sin fabricaciones todavía'}{hist.fam ? <> <span className="tag fam">familia {hist.fam.nombre}</span>{hist.nPiezas > 1 ? ` (${hist.nPiezas} piezas)` : ''}</> : ''}: {fHM(hist.porUnidad)} reales por unidad{unTxt(hist)}{(() => { const sug = Math.max(0.5, Math.round(hist.porUnidad * Math.max(1, Number(t.cant) || 1) * 2) / 2); return Math.abs(sug - hh) > 0.01 ? <> → <button type="button" className="lnk sm" onClick={() => { setHhTocado(true); set('hh', sug); }}>usar {fN(sug)} h</button></> : ' (ya aplicado)'; })()}</small>}</label></div>
        <label>{t.estado === 'terminada' ? 'Fin planificado' : 'Fin'}<input id="te-fin" type="datetime-local" value={w ? w.end : ''} disabled={!t.inicio} onChange={e => setFin(e.target.value)} /></label>
        <div className="fld"><span>Duración en calendario</span><b className="big">{fH(hh / n)}</b><small className="mut">{fN(hh)} HH ÷ {n} operario{n > 1 ? 's' : ''}</small></div>
        {w && !w.ok && <p className="note bad g2">Faltan {fN(w.falta)} h extra por habilitar en el calendario para poder calcular el fin.</p>}
        <label>Estado<select id="te-est" value={sinF(t) ? 'sinfecha' : estDe(t)} onChange={e => { const v = e.target.value; setT(p => v === 'sinfecha' ? { ...p, estado: 'terminada', sinFecha: true, finReal: null, realFin: false } : { ...p, estado: v, sinFecha: false, proximo: v === 'proximo' ? (p.proximo || E.nowDT()) : null }); }}><option>pendiente</option><option value="proximo">próximo a realizar</option><option>en proceso</option><option value="terminada">finalizada</option><option value="sinfecha">finalizada, sin fecha puntual</option></select></label>
        <label>Avance %<input id="te-av" type="number" min="0" max="100" step="5" value={t.estado === 'terminada' ? 100 : t.avance} disabled={t.estado === 'terminada'} onChange={e => set('avance', e.target.value)} /></label>
        {sinF(t) && <div className="g2"><small className="hint">Finalizada sin día ni hora puntual: no tiene fecha de fin real y no corre lo que viene detrás. Las horas reales que cargues suman al proyecto, pero no entran al promedio de Tiempos.</small></div>}
        {t.estado === 'terminada' && !t.sinFecha && (() => { const h = t.realFin ? hhEntre(t.finReal) : 0, malo = t.realFin && t.finReal && t.inicio && t.finReal <= t.inicio;
          return <label>Fin real<span className="incalc"><input id="te-finr" type="datetime-local" value={t.realFin ? (t.finReal || '').slice(0, 16) : ''} min={t.inicio || undefined} onChange={e => setFinReal(e.target.value)} /><button type="button" className="btn sm" title="Poner la fecha y hora actual" onClick={() => setFinReal(E.nowDT())}>Ahora</button></span>
            {malo ? <small className="hint bad">Tiene que ser después del inicio ({fDT(t.inicio)}).</small>
              : t.realFin ? <small className="hint ok">Del {fDT(t.inicio)} al {fDT(t.finReal)}: {fN(h / n)} h trabajables{n > 1 ? ` × ${n} operarios` : ''} = {fN(h)} HH. El Gantt y el calendario muestran esto.{Math.abs(h - (Number(t.hhReal) || 0)) > 0.01 && <> <button type="button" className="lnk sm" onClick={() => set('hhReal', h)}>usar {fN(h)} h</button></>} <button type="button" className="lnk sm" onClick={() => setFinReal('')}>volver a lo planificado</button></small>
              : <small className="hint">Cargá cuándo terminó: te calculo las horas reales y el Gantt y el calendario pasan a mostrar lo que duró (hoy muestran lo planificado).</small>}</label>; })()}
        <label>Horas-hombre reales<span className="incalc"><input id="te-real" type="number" min="0" step="0.5" value={t.hhReal} onChange={e => set('hhReal', e.target.value)} /><CalcBtn cant={E.unidadesDe(t)} titulo={(t.nombre || 'Pieza') + ' · horas reales'} onUse={v => set('hhReal', Math.round(v * 100) / 100)} /></span></label>
        <label>Material<select id="te-mat" value={t.material || ''} onChange={e => set('material', e.target.value)}><option value="">—</option>{(S.materiales || []).map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}</select>
          {!(S.materiales || []).length && <small className="hint">Los materiales se cargan en Configuración → Materiales.</small>}</label>
        <label>Peso total (kg)<input id="te-peso" type="number" min="0" step="0.1" value={t.peso ?? ''} placeholder="de toda la cantidad" onChange={e => set('peso', e.target.value === '' ? null : Number(e.target.value))} /></label>
        {t.nombre && t.nombre.trim() && <div className="g2 tefi"><div><b>Ficha de la pieza</b> <small className="mut">· vale para todas las veces que se fabrica (ítem de StockApp, largo y material para el costo)</small></div><FichaStockLinea k={E.claveCod(t.nombre.replace(/\s*\(parte \d+\)\s*$/i, ''))} nombre={t.nombre} /></div>}
        {pvT && <><div className="g2 fld"><b>Post venta</b><small className="mut">Dejá acá el registro de lo que se hizo y se envió: sirve para cruzarlo con los remitos de depósito.</small></div>
          <label>Origen<select id="te-ori" value={t.origen || 'fabricada'} onChange={e => set('origen', e.target.value)}><option value="fabricada">Fabricada por nosotros</option><option value="reventa">Reventa (pasa mano)</option></select></label>
          <label>Motivo<select id="te-mot" value={t.motivo || ''} onChange={e => set('motivo', e.target.value)}><option value="">—</option>{MOTIVOS_PV.map(m => <option key={m}>{m}</option>)}</select></label>
          <label>Cantidad enviada<input id="te-cenv" type="number" min="0" value={t.cantEnv ?? ''} placeholder={'de ' + (Number(t.cant) || 0)} onChange={e => { set('cantEnv', e.target.value === '' ? '' : Number(e.target.value)); if (Number(e.target.value) > 0 && !t.fechaEnvio) set('fechaEnvio', E.today()); }} /></label>
          <label>Fecha de envío<input id="te-fenv" type="date" value={t.fechaEnvio || ''} onChange={e => set('fechaEnvio', e.target.value)} /></label>
          <label>N° de remito<input id="te-rem" value={t.remito || ''} onChange={e => set('remito', e.target.value)} /></label>
          <label>Destinatario / destino<input id="te-dest" value={t.destinatario || ''} onChange={e => set('destinatario', e.target.value)} /></label>
          <label className="chk g2"><input type="checkbox" checked={!!t.remitoOk} disabled={!t.remito} onChange={e => set('remitoOk', e.target.checked)} /> Remito verificado en depósito (doble check)</label></>}
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
  const { S, V, up, ui } = useApp(); const r = V.D[t.id]; const run = E.corriendo(t), pausa = !!t.pausada || (t.estado === 'en proceso' && !run), llev = E.llevado(S, t);
  const [av, setAv] = useState(r.avance); const [fin, setFin] = useState(false); const [real, setReal] = useState(0); const [dlg, setDlg] = useState(null);
  useEffect(() => { setAv(r.avance); }, [r.avance]);
  const fre = E.estaFrenada(t);
  const commit = () => { if (Number(av) !== r.avance) up(s => E.patchTask(s, t.id, { avance: Number(av) })); };
  return <div className={'optask' + (run ? ' run' : '')}>
    <div className="row"><Chip t={t} small /><b>{etiqueta(V, t)}</b><span className={'est e-' + (pausa ? 'pausa' : estDe(t).replace(' ', ''))}>{run ? 'en curso' : pausa ? 'en pausa' : estTxt(estDe(t))}</span></div>
    <span className="mut">{operName(S, t.operacionId)} · {fH(t.hh)} HH{t.ops.length > 1 ? ` entre ${t.ops.length} (${fH(r.durCal)} en calendario)` : ''} · {t.turno === 'extra' ? 'extra · ' : t.turno === 'ambos' ? 'normal + extra · ' : ''}{fDT(t.inicio)} → {fDT(r.fin)}</span>
    {(() => { const esp = espera(S, V, t); return esp && <span className="tag">⧖ Espera a {esp.nombre}{esp.fin ? ` (termina ${fDT(esp.fin)})` : ''}</span>; })()}
    <FrenoTag t={t} />
    {dlg === 'frenar' && <FrenarDlg id={t.id} pausa={run} onClose={() => setDlg(null)} />}{dlg === 'retomar' && <RetomarDlg id={t.id} onClose={() => setDlg(null)} />}
    {fre ? <div className="row"><button className="btn pri-b" onClick={() => setDlg('retomar')}>Retomar</button><button className="btn" title="Arranca ahora con los mismos operarios" onClick={() => iniciarConAviso(S, up, ui, t.id)}>Retomar ya</button><button className="btn" onClick={() => up(s => E.unassign(s, t.id, op))}>Quitar</button></div> : <>
    {t.estado === 'en proceso' && <div className="row crono"><Bar v={t.hh ? llev / t.hh * 100 : 0} color={llev > t.hh + 0.01 ? 'var(--bad)' : undefined} /><span>Llevado <b>{fHM(llev)}</b> de {fHM(t.hh)} proyectadas{t.ops.length > 1 ? ' (suma de los operarios)' : ''}</span></div>}
    {fin ? <div className="finbox">
      <div className="row"><span className="mut">Tiempo real (horas-hombre)</span><HM value={real} onChange={setReal} cant={E.unidadesDe(t)} titulo={t.nombre} /></div>
      <div className="row"><span className="mut">Proyectado {fHM(t.hh)} ·</span><Desvio real={real} plan={t.hh} /></div>
      <div className="row"><button className="btn pri-b" onClick={() => cerrarTarea(up, ui, t.id, real, true)}>Confirmar</button><button className="btn" onClick={() => setFin(false)}>Cancelar</button></div></div>
      : <div className="row">
        <input className="rng" type="range" min="0" max="100" step="5" value={av} aria-label="Avance" onChange={e => setAv(e.target.value)} onPointerUp={commit} onKeyUp={commit} onBlur={commit} /><span className="pct">{Math.round(av)}%</span>
        {run && t.ops.length > 1 && <button className="btn" title="La tarea se parte: lo hecho queda cerrado y el resto sigue con los demás" onClick={() => up(s => E.salir(s, t.id, op))}>{opName(S, op)} sale</button>}
        {run ? <button className="btn" title="Parte la tarea: cierra lo hecho hasta ahora. Elegís si lo que falta sigue en la cola o queda frenado" onClick={() => setDlg('frenar')}>Pausar</button> : <><button className="btn" onClick={() => iniciarConAviso(S, up, ui, t.id)}>{pausa ? 'Reanudar' : 'Iniciar'}</button><button className="btn" title="Para el trabajo por días: lo que falta queda frenado" onClick={() => setDlg('frenar')}>Frenar</button></>}
        <button className="btn pri-b" onClick={() => { setReal(llev > 0 ? llev : t.hh); setFin(true); }}>Finalizar</button>
        {run && t.turno !== 'ambos' && (() => { const ta = E.turnoAhora(S, t.ops); return ta && ta !== t.turno; })() && <button className="btn warn-b" title="La tarea sigue corriendo: lo hecho queda en su turno y desde ahora cuenta en el otro" onClick={() => up(s => E.pasarTurno(s, t.id, t.turno === 'extra' ? 'normal' : 'extra'))}>Ahora es turno {t.turno === 'extra' ? 'normal' : 'extra'}: seguir ahí</button>}
        {(llev > 0 || t.avance > 0 || t.pausada || t.parte) && !run && t.turno !== 'ambos' && <button className="btn" title={t.turno === 'extra' ? 'Lo hecho queda en horas extra; lo que falta pasa al turno normal' : 'Lo hecho queda en el turno normal; lo que falta pasa a horas extra'} onClick={() => up(s => E.pasarTurno(s, t.id, t.turno === 'extra' ? 'normal' : 'extra'))}>{t.turno === 'extra' ? 'Seguir en turno normal' : 'Seguir en horas extra'}</button>}
        <button className="btn" onClick={() => up(s => E.unassign(s, t.id, op))}>Quitar</button></div>}</>}
  </div>;
}
function DoneRow({ t }) {
  const { V, up } = useApp(); const [ed, setEd] = useState(false); const [real, setReal] = useState(t.hhReal || 0);
  return <div className="optask done">
    <div className="row"><Chip t={t} small /><b>{etiqueta(V, t)}</b><span className="mut">finalizada {(t.finReal || '').slice(11, 16)}</span></div>
    {ed ? <div className="row"><HM value={real} onChange={setReal} cant={E.unidadesDe(t)} titulo={t.nombre} /><button className="btn sm pri-b" onClick={() => { up(s => E.patchTask(s, t.id, { hhReal: Math.round(real * 100) / 100, crono: { acum: real, desde: null } })); setEd(false); }}>Guardar</button><button className="btn sm" onClick={() => setEd(false)}>Cancelar</button></div>
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
    .sort((a, b) => (E.esProximo(b) - E.esProximo(a)) || (E.esProximo(a) && a.proximo !== b.proximo ? (a.proximo < b.proximo ? -1 : 1) : 0) || PRI[a.prioridad] - PRI[b.prioridad] || ((a.inicio || a.creada || '') < (b.inicio || b.creada || '') ? -1 : 1));   // primero las marcadas como próximo a realizar
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
  const dar = (ids, turno) => { if (!ids.length) return; up(s => ids.reduce((a, id) => E.assignTo(a, id, op, null, turno), s)); setSel(new Set()); ui.toast(`${ids.length === 1 ? 'Asignada' : ids.length + ' tareas asignadas, una detrás de la otra,'} a ${o.nombre} en ${turno === 'extra' ? 'horas extra' : turno === 'ambos' ? 'turno normal + extras' : 'turno normal'}`); };
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
    {todas.length === 0 ? <Vacio ic="ok" t="No hay tareas para darle">Todas las tareas ya tienen operario asignado.</Vacio> : libres.length === 0 && <Vacio ic="buscar" chico t="Ninguna tarea coincide con los filtros" />}
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
            <div className="dn"><span className="drow"><Chip t={t} small /><b>{nomP(V, t)}</b><Pri p={t.prioridad} />{E.esProximo(t) && <span className="mk prox" title="Próximo a realizar">⏭</span>}
              {vista === 'origen' && rep[k] > 1 && <button className="tag rep" title="Ver todas juntas" onClick={() => { setVista('pieza'); setQ(t.codigo || t.nombre); }}>se repite ×{rep[k]}</button>}</span>
              <span className="mut">{mia ? <b className="suya">★ {operName(S, t.operacionId)}</b> : operName(S, t.operacionId)} · cant. {cantTxt(t)} · {fH(t.hh)}{t.entrega ? ` · entrega ${fD(t.entrega)}` : ''}</span></div>
            <span className="row dbt"><button className="btn sm" onClick={() => dar([t.id], 'normal')}>Normal</button><button className="btn sm" onClick={() => dar([t.id], 'extra')}>Extra</button><button className="btn sm" title="Usa el turno normal y también las horas extra de cada día" onClick={() => dar([t.id], 'ambos')}>N + E</button></span>
          </div>; })}</div>}
      </div>; })}
    {elegidas.length > 0 && <div className="dbar"><b>{elegidas.length} elegidas</b><span className="mut">{fN(hhSel)} HH · se las da una detrás de la otra</span><span className="sp" />
      <button className="btn pri-b" onClick={() => dar(elegidas, 'normal')}>Dar en normal</button><button className="btn" onClick={() => dar(elegidas, 'extra')}>Dar en extra</button><button className="btn" onClick={() => dar(elegidas, 'ambos')}>Normal + extra</button><button className="btn ghost" onClick={() => setSel(new Set())}>Cancelar</button></div>}
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
  const aplicar = () => {   // pasar piezas a "En proceso": avisa si sus operarios ya tienen otras tareas en curso (se pausan)
    const otras = f.estado === 'en proceso' ? [...new Map(ts.filter(t => t.estado !== 'en proceso').flatMap(t => E.enCurso(S, f.ops || t.ops, t.id)).filter(x => !ids.includes(x.id)).map(x => [x.id, x])).values()] : [];
    if (otras.length) { ui.confirmar({ titulo: '¿Pausar lo que está en curso?', texto: `Los operarios de estas piezas ya tienen en curso: ${otras.map(x => `"${x.nombre}"`).join(', ')}. Si seguís, ${otras.length === 1 ? 'esa tarea se pausa' : 'esas tareas se pausan'} (lo hecho queda registrado y lo que falta sigue en la cola) y arrancan las piezas elegidas.`, si: 'Sí, pausar y arrancar', onSi: hacer }); return; }
    hacer(); };
  const hacer = () => {
    const orden = ts.slice().sort((a, b) => (a.inicio || '9') < (b.inicio || '9') ? -1 : 1).map(t => t.id);
    up(s0 => { let s = s0; let cursor = f.inicio || null;
      orden.forEach(id => { const t = s.tareas.find(x => x.id === id); if (!t) return; const p = {};
        if (f.operacionId) { p.operacionId = f.operacionId; p.opAuto = false; } if (f.prioridad) p.prioridad = f.prioridad; if (f.turno) p.turno = f.turno;
        if (f.ops) p.ops = f.ops; if (f.hh !== '') p.hh = nuevoHH(t);
        if (cursor) p.inicio = cursor;
        s = E.patchTask(s, id, p, !!(cursor || f.ops || f.turno || f.hh !== ''));
        if (cursor && f.seguidas) { const t2 = s.tareas.find(x => x.id === id); cursor = E.finOf(s, t2) || cursor; }
        if (f.estado === 'sinfecha') s = E.finalizarSinFecha(s, id, nuevoReal(t));
        else if (f.estado === 'terminada') s = E.finalizar(s, id, nuevoReal(t));
        else { if (f.estado) s = E.setEstado(s, id, f.estado); if (f.real !== '') s = E.patchTask(s, id, { hhReal: nuevoReal(t), crono: { acum: nuevoReal(t), desde: null } }); }
      }); return s; });
    ui.toast(`${ts.length} piezas actualizadas en lote`); onClose(); };
  const ops = S.operarios.filter(o => o.activo);
  return <Modal title={'Editar en lote' + (titulo ? ' · ' + titulo : '')} onClose={onClose} wide foot={<><span className="mut">{ts.length} piezas · {fN(cantT)} unidades en total</span><span className="sp" /><button className="btn canc-b" onClick={onClose}>Cancelar</button><button className="btn pri-b" disabled={!cambia} onClick={aplicar}>Aplicar a las {ts.length}</button></>}>
    <p className="mut">Lo que dejes vacío no se cambia. Las horas totales se reparten entre las piezas según la cantidad que usa cada ensamblaje, así cada equipo lleva el tiempo que le corresponde.</p>
    <div className="form lote">
      <label>Horas-hombre totales (plan)<span className="incalc"><input type="number" min="0" step="0.5" placeholder={'hoy suman ' + fN(hhAct)} value={f.hh} onChange={e => set('hh', e.target.value)} /><CalcBtn cant={cantT} titulo="Horas-hombre totales del lote" onUse={v => set('hh', String(Math.round(v * 100) / 100))} /></span></label>
      <label>Horas reales totales<span className="incalc"><input type="number" min="0" step="0.25" placeholder={'hoy suman ' + fN(realAct)} value={f.real} onChange={e => set('real', e.target.value)} /><CalcBtn cant={cantT} titulo="Horas reales totales del lote" onUse={v => set('real', String(Math.round(v * 100) / 100))} /></span></label>
      <label>Estado<select value={f.estado} onChange={e => set('estado', e.target.value)}><option value="">— no cambiar —</option><option value="pendiente">Pendiente</option><option value="proximo">Próximo a realizar</option><option value="en proceso">En proceso</option><option value="terminada">Finalizada</option><option value="sinfecha">Finalizada, sin día puntual</option></select></label>
      <label>Operación<select value={f.operacionId} onChange={e => set('operacionId', e.target.value)}><option value="">— no cambiar —</option>{S.operaciones.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></label>
      <label>Prioridad<select value={f.prioridad} onChange={e => set('prioridad', e.target.value)}><option value="">— no cambiar —</option><option>alta</option><option>media</option><option>baja</option></select></label>
      <label>Turno<select value={f.turno} onChange={e => set('turno', e.target.value)}><option value="">— no cambiar —</option><option value="normal">Normal</option><option value="extra">Extra</option><option value="ambos">Normal + extra</option></select></label>
      <label>Inicio<input type="datetime-local" value={f.inicio} onChange={e => set('inicio', e.target.value)} /></label>
      <label className="chk lote-seg"><input type="checkbox" checked={f.seguidas} onChange={e => set('seguidas', e.target.checked)} /> Una detrás de la otra (si no, todas arrancan a esa hora)</label>
      <div className="g2 lote-ops"><span className="mut">Operarios {f.ops ? '' : '(no cambiar)'}</span><div className="row wrap">{ops.map(o => { const on = f.ops && f.ops.includes(o.id); return <button key={o.id} className={'togb' + (on ? ' on' : '')} onClick={() => set('ops', on ? (f.ops.filter(x => x !== o.id).length ? f.ops.filter(x => x !== o.id) : null) : [...(f.ops || []), o.id])}>{o.nombre}</button>; })}</div></div>
    </div>
    <div className="scroll"><table className="tt lote-t"><thead><tr><th>Ensamblaje</th><th>Dentro de</th><th className="num">Cant.</th><th className="num">% del total</th><th className="num">HH plan</th><th className="num">HH real</th><th>Estado</th><th>Inicio</th></tr></thead>
      <tbody>{ts.map(t => { const rt = V.rootOf(t), pa = t.parentId && V.byId[t.parentId]; const h0 = Number(t.hh) || 0, h1 = nuevoHH(t), r0 = Number(t.hhReal) || 0, r1 = nuevoReal(t);
        return <tr key={t.id}><td>{rt.id === t.id ? '—' : rt.nombre}</td><td>{pa && pa.id !== rt.id ? pa.nombre : '—'}</td><td className="num">{t.cant}</td><td className="num">{Math.round(peso(t) * 100)}%</td>
          <td className="num">{h1 !== h0 ? <><s className="mut">{fN(h0)}</s> → <b>{fN(h1)}</b></> : fN(h0)}</td><td className="num">{r1 !== r0 ? <><s className="mut">{fN(r0)}</s> → <b>{fN(r1)}</b></> : (r0 ? fN(r0) : '—')}</td>
          <td>{estTxt(f.estado || (V.D[t.id].parent ? V.D[t.id].estado : estDe(t)))}</td><td>{fDT(t.inicio)}</td></tr>; })}</tbody></table></div>
  </Modal>;
}
// Horas extra de un operario día por día: cuántas y para qué (seguir lo del turno normal u otra tarea aparte)
function ExtrasDias({ op }) {
  const { S, V, up, ui } = useApp(); const [n, setN] = useState(10);
  const hoy = E.today(); const dias = []; for (let d = hoy, g = 0; dias.length < n && g < 40; g++, d = E.addDays(d, 1)) if (E.isWork(S, d) || E.extraDe(S, op, d) > 0) dias.push(d);
  const items = (d, tu) => ((V.load[`${op}|${d}|${tu}`] || {}).items || []).map(i => V.byId[i.id]).filter(Boolean);
  const set = (d, h, m) => up(s => E.setExtraDia(s, op, d, h, m));
  return <div className="xdias">
    <div className="sec-h"><h3>Horas extra, día por día</h3><span className="mut">Elegí cuántas horas hace y si sigue con lo del turno normal o hace otra tarea.</span></div>
    <div className="xd-l">{dias.map(d => { const h = E.extraDe(S, op, d), m = E.modoExtra(S, op, d), aus = E.ausenciaDe(S, op, d); const norm = items(d, 'normal'), ext = items(d, 'extra');
      const ult = norm[norm.length - 1];
      return <div key={d} className={'xd' + (h > 0 ? ' on' : '') + (aus ? ' aus' : '')}>
        <span className="xd-d">{fDia(d)}</span>
        {aus ? <span className="mut">Ausente: {aus.motivo}</span> : <>
        <span className="xd-h"><button className="btn sm" onClick={() => set(d, Math.max(0, h - 1), m)} disabled={!h} aria-label="Menos">−</button><b>{fN(h)} h</b><button className="btn sm" onClick={() => set(d, h + 1, h ? m : (ult ? 'sigue' : 'aparte'))} aria-label="Más">+</button></span>
        {h > 0 ? <div className="seg sm"><button className={m === 'sigue' ? 'on' : ''} onClick={() => set(d, h, 'sigue')}>Sigue lo normal</button><button className={m !== 'sigue' ? 'on' : ''} onClick={() => set(d, h, 'aparte')}>Otra tarea</button></div> : <span className="mut">sin extra</span>}
        <span className="xd-q">{h > 0 && (m === 'sigue' ? (ult ? <>continúa <Chip t={ult} small /> {etiqueta(V, ult)}</> : <span className="c-bad">ese día no tiene tarea normal para continuar</span>)
          : ext.length ? ext.map(t => <span key={t.id} className="xd-t"><Chip t={t} small /> {etiqueta(V, t)}</span>) : <button className="btn sm" onClick={() => ui.modal({ k: 'pick', op, d, turno: 'extra' })}>+ Darle una tarea</button>)}</span></>}
      </div>; })}</div>
    {n < 30 && <button className="btn sm" onClick={() => setN(n + 10)}>Ver más días</button>}
  </div>;
}
// Aviso al programar en horas extra sin extras habilitadas: se habilitan desde acá
function ExtrasAviso({ ids, onClose }) {
  const { S, V, up, ui } = useApp(); const [h, setH] = useState(2);
  const ts = ids.map(id => V.byId[id]).filter(t => t && t.turno === 'extra' && !V.D[t.id].ok && t.ops.length && t.estado !== 'terminada');
  useEffect(() => { if (!ts.length) onClose(); });
  if (!ts.length) return null;
  const sim = t => E.habilitarExtras(S, t.id, Number(h) || 1).dias;
  const ok = () => { let n = 0; up(s => ids.reduce((a, id) => { const r = E.habilitarExtras(a, id, Number(h) || 1); n += r.dias.length; return r.S; }, s)); ui.toast(n ? 'Horas extra habilitadas' : 'No hizo falta habilitar días'); onClose(); };
  const normal = () => { up(s => ts.reduce((a, t) => E.patchTask(a, t.id, { turno: 'normal' }, true), s)); onClose(); };
  return <Modal title="Faltan horas extra habilitadas" onClose={onClose} foot={<><button className="btn" onClick={onClose}>Dejar así</button><button className="btn" onClick={normal}>Pasar a turno normal</button><span className="sp" /><button className="btn pri-b" onClick={ok}>Habilitar extras</button></>}>
    <p>{ts.length === 1 ? 'Esta tarea está' : 'Estas tareas están'} en <b>horas extra</b>, pero {ts.length === 1 ? 'su operario no tiene' : 'sus operarios no tienen'} extras habilitadas suficientes para hacerla.</p>
    <label className="inl">Horas extra por día<input className="w4" type="number" min="0.5" max="6" step="0.5" value={h} onChange={e => setH(e.target.value)} /></label>
    {ts.map(t => { const d = sim(t); return <div key={t.id} className="xav"><Chip t={t} small /><b>{etiqueta(V, t)}</b>
      <span className="mut">{t.ops.map(o => opName(S, o)).join(', ')} · faltan {fN(V.D[t.id].falta || 0)} h · se habilitarían {d.length} {d.length === 1 ? 'día' : 'días'}{d.length ? ': ' + d.map(fDia).join(', ') : ''}</span></div>; })}
    <p className="mut">Esas extras quedan para trabajo aparte (no siguen lo del turno normal). Las podés ajustar después en Producción, tocando al operario.</p>
  </Modal>;
}
// Cola de trabajo de un operario: la usan la ventana del operario (Producción) y Operarios → Trabajo del día
function colaOperario(S, V, id, hoy) {
  const todas = S.tareas.filter(t => t.ops.includes(id) && !V.D[t.id].parent && t.estado !== 'terminada').sort((a, b) => (a.inicio || '9') < (b.inicio || '9') ? -1 : 1);
  return { todas, mine: todas.filter(t => !E.estaFrenada(t)), frenadas: todas.filter(E.estaFrenada),
    hechas: S.tareas.filter(t => t.ops.includes(id) && t.estado === 'terminada' && !t.tercerizada && (t.finReal || '').startsWith(hoy) && !V.D[t.id].parent),
    aus: E.ausenciaDe(S, id, hoy) };
}
// Divide una lista de tareas en lo que está haciendo, en pausa y lo que sigue
const seccionesCola = l => ({ en: l.filter(t => E.corriendo(t)), pau: l.filter(t => t.pausada || (t.estado === 'en proceso' && !E.corriendo(t))), sig: l.filter(t => E.esPend(t) && !t.pausada) });
// Refresca la pantalla cada 30 s (cronómetros)
function useReloj() { const [, setTick] = useState(0); useEffect(() => { const i = setInterval(() => setTick(x => x + 1), 30000); return () => clearInterval(i); }, []); }
function OperarioPanel({ id, onClose }) {
  const { S, V, up, ui } = useApp(); useReloj();
  const o = S.operarios.find(x => x.id === id); if (!o) return null;
  const hoy = E.today();
  const { mine, frenadas, hechas, aus } = colaOperario(S, V, id, hoy);
  const prox = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map(i => E.addDays(hoy, i)).filter(d => E.extraDe(S, id, d) > 0);
  const camino = (turno, tit) => {
    const l = mine.filter(t => turno === 'extra' ? t.turno === 'extra' : t.turno !== 'extra'), { en, pau, sig } = seccionesCola(l);
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
      {sig.length === 0 && <Vacio ic="ok" chico t="Sin tareas en cola" />}
      {sig.slice(0, 6).map(t => <OpTask key={t.id} t={t} op={id} />)}
    </div>;
  };
  return <Modal title={o.nombre} onClose={onClose} wide>
    {aus && <p className="note bad">Hoy ausente: {aus.motivo}.</p>}
    <div className="row"><button className="btn" onClick={() => juntar(up, ui, id, o.nombre)}>Juntar sus tareas</button><span className="mut">Adelanta lo pendiente para cerrar huecos libres. Al pausar, la tarea se parte: lo hecho queda cerrado con su tiempo y lo que falta sigue en la cola o queda frenado.</span></div>
    <div className="opcols">{camino('normal', 'Turno normal')}{camino('extra', 'Horas extra')}</div>
    {frenadas.length > 0 && <><h3>Frenadas <span className="cnt">{frenadas.length}</span></h3>{frenadas.map(t => <OpTask key={t.id} t={t} op={id} />)}</>}
    <ExtrasDias op={id} />
    {hechas.length > 0 && <><h3>Finalizadas hoy <span className="cnt">{hechas.length}</span></h3>{hechas.map(t => <DoneRow key={t.id} t={t} />)}</>}
    <DarTareas op={id} />
  </Modal>;
}
function Picker({ op, d, turno, onClose }) {
  const { S, V, up, ui } = useApp(); const [q, setQ] = useState('');
  const okq = t => (etiqueta(V, t) + ' ' + E.chipOf(S, V, t).txt).toLowerCase().includes(q.toLowerCase());
  const suyas = S.tareas.filter(t => !V.D[t.id].parent && t.estado !== 'terminada' && t.ops.includes(op) && t.turno !== 'ambos' && (t.turno || 'normal') !== turno && okq(t)).sort((a, b) => (a.inicio || '9') < (b.inicio || '9') ? -1 : 1);
  const l = S.tareas.filter(t => !V.D[t.id].parent && t.estado !== 'terminada' && !t.ops.includes(op) && okq(t))
    .sort((a, b) => (a.ops.length - b.ops.length) || PRI[a.prioridad] - PRI[b.prioridad]);
  return <Modal title={`Asignar a ${opName(S, op)} · ${fDia(d)} · turno ${turno}`} onClose={onClose}>
    <input id="pk-q" className="full" placeholder="Buscar por nombre, OV/OC o proyecto" value={q} onChange={e => setQ(e.target.value)} autoFocus />
    {suyas.length > 0 && <><h3>Sus tareas en {turno === 'extra' ? 'turno normal' : 'horas extra'}: seguirlas acá</h3>
      {suyas.map(t => <div key={t.id} className="pitem st sig" onClick={() => { up(s => E.partirEnDia(s, t.id, d, turno)); ui.toast(`Desde el ${fDia(d)} sigue en ${turno === 'extra' ? 'horas extra' : 'turno normal'}`); onClose(); }}>
        <Chip t={t} small /><span className="pn">{etiqueta(V, t)}</span><Pri p={t.prioridad} /><span className="mut">{t.turno === 'extra' ? 'en horas extra' : 'en turno normal'} · {fDT(t.inicio)} → {fDT(V.D[t.id].fin)} · lo que falta sigue acá desde el {fDia(d)}</span></div>)}
      <h3>Otras tareas</h3></>}
    {l.length === 0 && <Vacio ic="ok" chico t="No hay tareas para asignar" />}
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
  const { S, V, up, ui } = useApp(); const r = V.D[t.id]; const run = E.corriendo(t), pausa = !!t.pausada || (t.estado === 'en proceso' && !run), llev = E.llevado(S, t), esp = espera(S, V, t);
  const [fin, setFin] = useState(false); const [real, setReal] = useState(0); const [dlg, setDlg] = useState(null); const fre = E.estaFrenada(t);
  return <div className={'ttask' + (run ? ' run' : '') + (fre ? ' fren' : '')}>
    {dlg === 'frenar' && <FrenarDlg id={t.id} pausa={run} onClose={() => setDlg(null)} />}{dlg === 'retomar' && <RetomarDlg id={t.id} onClose={() => setDlg(null)} />}
    <div className="row"><Chip t={t} /><Pri p={t.prioridad} /><span className={'est e-' + (fre ? 'fren' : pausa ? 'pausa' : run ? 'enproceso' : estDe(t).replace(' ', ''))}>{fre ? 'frenada' : run ? 'en curso' : pausa ? 'en pausa' : estTxt(estDe(t))}</span></div>
    <b className="tnom">{E.esProximo(t) && <span className="mk prox" title="Próximo a realizar">⏭</span>} {etiqueta(V, t)}</b>
    <span className="mut">{operName(S, t.operacionId)} · cantidad {cantTxt(t)} · {fHM(t.hh)} proyectadas{t.ops.length > 1 ? ` · con ${t.ops.length - 1} más` : ''}{t.turno === 'extra' ? ' · en horas extra' : t.turno === 'ambos' ? ' · en turno normal + extras' : ''}</span>
    <span className="mut">{fDT(t.inicio)} → {fDT(r.fin)}</span>
    {esp && <span className="tag">⧖ Espera a {esp.nombre}{esp.fin ? ` (termina ${fDT(esp.fin)})` : ''}</span>}
    <FrenoTag t={t} />
    {fre ? <div className="tbtns"><button className="btn big t-ini" title="Arranca ahora con los mismos operarios" onClick={() => iniciarConAviso(S, up, ui, t.id)}><svg className="bi" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>Retomar ya</button><button className="btn big" onClick={() => setDlg('retomar')}>Retomar con cambios</button></div> : <>
    {(run || llev > 0) && <div className="tcrono"><b>{fHM(llev)}</b><span className="mut">de {fHM(t.hh)}</span><Bar v={t.hh ? llev / t.hh * 100 : 0} color={llev > t.hh + 0.01 ? 'var(--bad)' : undefined} /></div>}
    {fin ? <div className="finbox">
      <div className="row"><span className="mut">Tiempo real</span><HM value={real} onChange={setReal} cant={E.unidadesDe(t)} titulo={t.nombre} /></div>
      <div className="row"><span className="mut">Proyectado {fHM(t.hh)} ·</span><Desvio real={real} plan={t.hh} /></div>
      <div className="tbtns"><button className="btn big t-fin" onClick={() => cerrarTarea(up, ui, t.id, real, true)}>Confirmar</button><button className="btn big" onClick={() => setFin(false)}>Cancelar</button></div></div>
      : <div className="tbtns">
        {run ? <button className="btn big t-pausa" onClick={() => setDlg('frenar')}><svg className="bi" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>Pausar</button> : <button className="btn big t-ini" onClick={() => iniciarConAviso(S, up, ui, t.id)}><svg className="bi" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>{pausa ? 'Reanudar' : 'Iniciar'}</button>}
        <button className="btn big t-fin" onClick={() => { setReal(llev > 0 ? llev : t.hh); setFin(true); }}>Finalizar</button>
        {run && t.turno !== 'ambos' && (() => { const ta = E.turnoAhora(S, t.ops); return ta && ta !== t.turno; })() && <button className="btn big warn-b" onClick={() => up(s => E.pasarTurno(s, t.id, t.turno === 'extra' ? 'normal' : 'extra'))}>Ahora es turno {t.turno === 'extra' ? 'normal' : 'extra'}: seguir ahí</button>}
        {(llev > 0 || t.avance > 0 || t.pausada || t.parte) && !run && t.turno !== 'ambos' && <button className="btn" onClick={() => up(s => E.pasarTurno(s, t.id, t.turno === 'extra' ? 'normal' : 'extra'))}>{t.turno === 'extra' ? 'Seguir en turno normal' : 'Seguir en horas extra'}</button>}
        {!run && <button className="btn" title="Para el trabajo por días: lo que falta queda frenado" onClick={() => setDlg('frenar')}>Frenar</button>}</div>}</>}
  </div>;
}
function Taller({ cab }) {
  const { S, V, ui, pm } = useApp(); useReloj();
  const [oid, setOid] = useState(() => { try { return localStorage.getItem(KEY + '-taller') || ''; } catch (e) { return ''; } });
  const ops = S.operarios.filter(o => o.activo), o = ops.find(x => x.id === oid), hoy = E.today();
  const elegir = id => { setOid(id); try { localStorage.setItem(KEY + '-taller', id); } catch (e) { } };
  useTopH(); const tref = useRef(null);
  useEffect(() => { const b = tref.current && tref.current.querySelector('.tq.on'); if (b && b.scrollIntoView) b.scrollIntoView({ block: 'nearest', inline: 'center' }); }, [oid]);
  const tira = <div className="ttira" ref={tref}>{ops.map(x => { const run = S.tareas.some(t => t.ops.includes(x.id) && E.corriendo(t)); const au = E.ausenciaDe(S, x.id, hoy);
    return <button key={x.id} className={'tq' + (o && x.id === o.id ? ' on' : '') + (au ? ' aus' : '')} onClick={() => elegir(o && x.id === o.id ? '' : x.id)} title={au ? 'Ausente: ' + au.motivo : run ? 'Trabajando' : 'Sin tarea en curso'}>
      <Av o={x} i={S.operarios.indexOf(x)} /><b>{x.nombre}</b><i className={'dot ' + (au ? 'aus' : run ? 'run' : '')} /></button>; })}</div>;
  if (!o) return <div className="view taller">{cab}<section><div className="sec-h"><h2>¿Quién sos?</h2><span className="mut">Tocá tu nombre</span></div>
    {ops.length === 0 && <Vacio ic="gente" t="Todavía no hay operarios cargados">Se agregan en Configuración.</Vacio>}
    {tira}</section></div>;
  const { mine, frenadas: fren, hechas, aus } = colaOperario(S, V, o.id, hoy);
  const { en, pau, sig: sigL } = seccionesCola(mine), sig = sigL.sort((a, b) => E.esProximo(b) - E.esProximo(a));   // las marcadas como próximo a realizar van primero
  return <div className="view taller">{cab}{tira}<section>
    <div className="sec-h"><div className="row"><Av o={o} i={S.operarios.indexOf(o)} /><h2>{o.nombre}</h2></div>{(pm.admin || pm.rep) && <button className="btn sm" title="Retiro antes, salida parcial o llegada tarde" onClick={() => ui.modal({ k: 'retiro', opId: o.id })}>Se retira antes (Leaves early)</button>}</div>
    <p className="mut">{fDia(hoy)}{aus ? ` · hoy figura ausente (${aus.motivo})` : ` · ${fN(((V.load[`${o.id}|${hoy}|normal`] || {}).h || 0) + ((V.load[`${o.id}|${hoy}|extra`] || {}).h || 0))} h programadas hoy`}{!aus && (S.ausencias || []).filter(x => x.opId === o.id && x.desde <= hoy && hoy <= x.hasta && !x.destino).map(x => ` · ${x.motivo}: ${x.desde === hoy && x.desdeHora ? 'sale ' + x.desdeHora : ''}${x.desde === hoy && x.desdeHora && x.hasta === hoy && x.hastaHora ? ', ' : ''}${x.hasta === hoy && x.hastaHora ? 'vuelve ' + x.hastaHora : ''}`).join('')}</p>
    <h3>Ahora</h3>
    {en.length === 0 && <Vacio ic="reloj" t="No hay ninguna tarea en curso">Iniciá una de la lista de abajo.</Vacio>}
    {en.map(t => <TallerTask key={t.id} t={t} />)}
    {pau.length > 0 && <h3>En pausa <span className="cnt">{pau.length}</span></h3>}
    {pau.map(t => <TallerTask key={t.id} t={t} />)}
    <h3>Lo que sigue <span className="cnt">{sig.length}</span></h3>
    {sig.length === 0 && <Vacio ic="ok" chico t="No hay más tareas asignadas" />}
    {sig.slice(0, 6).map(t => <TallerTask key={t.id} t={t} />)}
    {fren.length > 0 && <><h3>Frenadas <span className="cnt">{fren.length}</span></h3>{fren.map(t => <TallerTask key={t.id} t={t} />)}</>}
    {hechas.length > 0 && <><h3>Finalizadas hoy <span className="cnt">{hechas.length}</span></h3>{hechas.map(t => <DoneRow key={t.id} t={t} />)}</>}
  </section><section><DarTareas op={o.id} grande /></section></div>;
}

/* ================= OPERARIOS: trabajo del día y calendario mensual ================= */
// La pestaña se llamaba "Taller". Los que planifican ven además el calendario mensual de cada operario (control de carga).
function Operarios() {
  const { pm } = useApp(); const verCal = pm.admin || pm.rep || pm.proy;
  const [modo, setModo] = useState(() => { try { return localStorage.getItem(KEY + '-opmodo') || 'dia'; } catch (e) { return 'dia'; } });
  const cambiar = m => { setModo(m); try { localStorage.setItem(KEY + '-opmodo', m); } catch (e) { } };
  const cab = verCal && <div className="seg opmodos">{[['dia', 'Trabajo del día', 'M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z'], ['cal', 'Calendario mensual', 'M4 6h16v14H4zM4 10h16M9 3v4M15 3v4']].map(([k, l, d]) => <button key={k} className={modo === k ? 'on' : ''} onClick={() => cambiar(k)}><svg viewBox="0 0 24 24"><path d={d} /></svg>{l}</button>)}</div>;
  return verCal && modo === 'cal' ? <CalOperarios cab={cab} /> : <Taller cab={cab} />;
}
const TIPOS = ['proy', 'rep', 'pv', 'tl'];
const ABR_EST = { proy: 'Proy.', rep: 'Rep.', pv: 'PV', tl: 'Taller' };
// Cómo quedó cargado un día de un operario: disponible, horas por tipo, sin asignar, de más y si hay que revisarlo
// Las piezas sin finalizar cuentan con lo planificado (lo mismo que muestra la Semana de Producción); las finalizadas, con sus HH reales.
function diaOp(S, CD, op, d, hoy, PD = {}) {
  const dp = E.dispDia(S, op, d), c = CD[op + '|' + d] || { proy: 0, rep: 0, pv: 0, tl: 0, total: 0, glob: 0, items: [] };
  const p = PD[op + '|' + d] || { proy: 0, rep: 0, pv: 0, tl: 0, total: 0, items: [] };
  const fut = d > hoy, sin = fut ? 0 : Math.max(0, dp - c.total - p.total), exc = c.total + p.total - dp;
  const aus = E.ausenciaDe(S, op, d), fer = E.feriadoDe(S, d), finde = !E.isWork(S, d);
  const motivo = aus ? aus.motivo : fer ? fer.nombre : finde && dp <= 0 ? '' : '';
  const alerta = exc > 0.05 ? 'over' : !fut && d < hoy && dp > 0 && sin >= Math.max(0.5, dp * 0.25) ? 'falta' : '';
  return { d, dp, c, p, fut, sin, exc, aus, fer, finde, motivo, alerta };
}
function CalOperarios({ cab }) {
  const { S, V, ui, pm } = useApp(); const hoy = E.today();
  const ops = S.operarios.filter(o => o.activo !== false);
  const [oid, setOid] = useState(() => { try { return localStorage.getItem(KEY + '-calop') || ''; } catch (e) { return ''; } });
  const [mes, setMes] = useState(hoy.slice(0, 7)); const [sel, setSel] = useState(null);
  const CD = useMemo(() => E.cargaDiaria(S, V, true), [S, V]);
  const PD = useMemo(() => E.planDiaria(S, V), [S, V]);
  const o = ops.find(x => x.id === oid) || ops[0];
  const elegir = id => { setOid(id); setSel(null); try { localStorage.setItem(KEY + '-calop', id); } catch (e) { } };
  const antes = k => { const [y, m] = k.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${E.pad(m - 1)}`; };
  const irMes = k => { setMes(k); setSel(null); };
  const d1 = mes + '-01', dUlt = E.addDays(E.mesSig(mes) + '-01', -1);
  const delMes = []; for (let d = d1; d <= dUlt; d = E.addDays(d, 1)) delMes.push(d);
  // días a revisar de cada operario en el mes (para marcar la tira de nombres)
  const nAlertas = useMemo(() => { const r = {}; ops.forEach(x => { r[x.id] = delMes.filter(d => d <= hoy && diaOp(S, CD, x.id, d, hoy, PD).alerta).length; }); return r; }, [S, CD, PD, mes, hoy]);
  const tira = <div className="ttira">{ops.map(x => <button key={x.id} className={'tq' + (o && x.id === o.id ? ' on' : '')} onClick={() => elegir(x.id)} title={nAlertas[x.id] ? `${nAlertas[x.id]} ${nAlertas[x.id] === 1 ? 'día' : 'días'} para revisar este mes` : 'Sin días para revisar este mes'}>
    <Av o={x} i={S.operarios.indexOf(x)} /><b>{x.nombre}</b>{nAlertas[x.id] > 0 && <span className="oc-cnt">{nAlertas[x.id]}</span>}</button>)}</div>;
  if (!o) return <div className="view">{cab}<Vacio ic="gente" t="Todavía no hay operarios activos">Se agregan en Configuración.</Vacio></div>;
  const dias = delMes.map(d => diaOp(S, CD, o.id, d, hoy, PD));
  const lun = E.dow(d1) === 0 ? 6 : E.dow(d1) - 1;   // casillas vacías antes del día 1 (la semana arranca el lunes)
  const tot = dias.reduce((a, x) => { TIPOS.forEach(k => { a[k] += x.c[k]; }); a.total += x.c.total; a.glob += x.c.glob; a.disp += x.dp; a.plan += x.p.total; if (!x.fut) { a.dispH += x.dp; a.sin += x.sin; } if (x.exc > 0.05) a.exc += x.exc; if (x.alerta) a.rev++; return a; }, { proy: 0, rep: 0, pv: 0, tl: 0, total: 0, glob: 0, disp: 0, dispH: 0, sin: 0, exc: 0, rev: 0, plan: 0 });
  const asigs = (S.asignaciones || []).filter(a => a.opId === o.id && a.desde <= dUlt && (a.hasta || a.desde) >= d1).sort((a, b) => a.desde < b.desde ? -1 : 1);
  const xs = sel && dias.find(x => x.d === sel);
  const nuevaAsig = () => ui.modal({ k: 'asig', opId: o.id, desde: sel || (d1 <= hoy ? d1 : hoy), hasta: sel || (dUlt < hoy ? dUlt : hoy) });
  const celda = x => { const ancho = Math.max(x.dp, x.c.total + x.p.total, 0.0001), vac = x.dp <= 0 && x.c.total <= 0 && x.p.total <= 0; const par = !x.aus && !x.finde ? ausParcial(S, o.id, x.d) : null;
    return <button key={x.d} className={'oc-d' + (x.alerta ? ' ' + x.alerta : '') + (x.fut ? ' fut' : '') + (vac ? ' vac' : '') + (x.d === hoy ? ' hoy' : '') + (x.d === sel ? ' sel' : '') + (x.c.glob > 0 ? ' glob' : '') + (x.aus && E.colorAus(S, x.aus.motivo) ? ' aus-c' : '')} style={E.ausStyle(S, x.aus)} onClick={() => setSel(x.d === sel ? null : x.d)}
      aria-label={`${E.fDia(x.d)}: ${fN(x.c.total)} h cargadas${x.p.total > 0.05 ? ` y ${fN(x.p.total)} h planificadas` : ''} de ${fN(x.dp)} disponibles`}>
      <span className="oc-h"><b>{Number(x.d.slice(8))}</b><span className="oc-dn">{E.fDia(x.d).slice(0, 3)}</span>{x.dp > 0 && <small>{fN(x.dp)} h</small>}</span>
      {((x.aus && x.aus.auto) || (!x.aus && x.fer)) && <small className="oc-mot">{x.aus ? x.aus.motivo : x.fer.nombre}</small>}
      {((x.aus && !x.aus.auto) || par) && <span className="oc-l"><span style={AUS_BOX} title={par ? `${par.txt} (${fN(par.h)} h fuera)` : `Ausente todo el día: ${x.aus.motivo}`}><i style={{ background: 'var(--bad)' }} />{par ? par.txt : x.aus.motivo}<b style={{ color: 'var(--bad)' }}>{par ? fN(par.h) : 'día'}</b></span></span>}
      {!vac && <span className="oc-bar" title={`${fN(x.c.total)} h cargadas de ${fN(x.dp)} disponibles`}>{TIPOS.map(k => x.c[k] > 0 && <i key={k} style={{ width: x.c[k] / ancho * 100 + '%', background: COL_EST[k] }} />)}{TIPOS.map(k => x.p[k] > 0 && <i key={'p' + k} className="oc-pl" style={{ width: x.p[k] / ancho * 100 + '%', '--c': COL_EST[k] }} />)}{x.sin > 0 && <i className="oc-sin" style={{ width: x.sin / ancho * 100 + '%' }} />}</span>}
      {!vac && <span className="oc-l">{TIPOS.map(k => x.c[k] > 0.05 && <span key={k}><i style={{ background: COL_EST[k] }} />{ABR_EST[k]} <b>{fN(x.c[k])}</b></span>)}
        {TIPOS.map(k => x.p[k] > 0.05 && <span key={'p' + k} className="pl"><i className="oc-pl" style={{ '--c': COL_EST[k] }} />{ABR_EST[k]} plan. <b>{fN(x.p[k])}</b></span>)}
        {x.sin > 0.05 && <span className="sin"><i />Sin asig. <b>{fN(x.sin)}</b></span>}</span>}
      {x.exc > 0.05 && <small className="oc-exc">+{fN(x.exc)} h de más</small>}
    </button>; };
  return <div className="view oc-view">{cab}{tira}
    <section><div className="sec-h"><div className="row"><Av o={o} i={S.operarios.indexOf(o)} /><h2>{o.nombre}</h2></div>
      <div className="row"><button className="btn sm" onClick={() => irMes(antes(mes))} aria-label="Mes anterior">‹</button><input type="month" value={mes} onChange={e => e.target.value && irMes(e.target.value)} aria-label="Mes" /><button className="btn sm" onClick={() => irMes(E.mesSig(mes))} aria-label="Mes siguiente">›</button>{mes !== hoy.slice(0, 7) && <button className="btn sm" onClick={() => irMes(hoy.slice(0, 7))}>Este mes</button>}
        {pm.admin && <button className="btn pri-b" onClick={nuevaAsig} title="Asignar horas a mano a un destino (viajes, vacaciones, datos sin cargar)">+ Carga global</button>}</div></div>
      <div className="kpis oc-kpis">
        <div className="kpi"><span>Disponible</span><b>{fN(tot.disp)} h</b><em>{fN(tot.dispH)} h hasta hoy</em></div>
        {TIPOS.map(k => <div key={k} className="kpi"><span><i className="est-dot" style={{ background: COL_EST[k] }} />{NOM_EST[k]}</span><b>{fN(tot[k])} h</b><em>{pcE(tot.dispH > 0 ? tot[k] / tot.dispH * 100 : null)} de lo disponible</em></div>)}
        {tot.plan > 0.05 && <div className="kpi"><span><i className="est-dot oc-pl" style={{ '--c': 'var(--accent)' }} />Planificado</span><b>{fN(tot.plan)} h</b><em>piezas sin finalizar · {pcE(tot.disp > 0 ? tot.plan / tot.disp * 100 : null)} del mes</em></div>}
        <div className={'kpi' + (tot.sin > 0.05 ? ' warn' : '')}><span><i className="est-dot oc-sin" />Sin asignar</span><b>{fN(tot.sin)} h</b><em>hasta hoy{tot.exc > 0.05 ? ` · ${fN(tot.exc)} h cargadas de más` : ''}</em></div>
      </div>
      <p className="mut oc-ley"><span className="oc-k over" /> cargó más de lo disponible · <span className="oc-k falta" /> quedó un cuarto o más sin asignar · <span className="oc-k glob" /> incluye carga global · <i className="oc-k oc-pl" style={{ '--c': 'var(--accent)' }} /> planificado (sin finalizar) · {tot.rev ? <b className="c-bad">{tot.rev} {tot.rev === 1 ? 'día para revisar' : 'días para revisar'}</b> : <b className="c-ok">ningún día para revisar</b>}</p>
      <div className="oc-cal">{['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'].map(n => <span key={n} className="oc-dh">{n}</span>)}
        {Array.from({ length: lun }, (_, i) => <span key={'v' + i} className="oc-pad" />)}{dias.map(celda)}</div>
      {xs && <DiaOpDet x={xs} o={o} cerrar={() => setSel(null)} />}
      <p className="mut">Las horas de una pieza se reparten en partes iguales entre los días hábiles que duró y entre sus operarios: en piezas de varios días el reparto diario es aproximado (el total de la pieza es exacto). Una pieza sin finalizar cuenta con sus horas planificadas en los días que ocupa en la Semana de Producción (rayado, «plan.»); al finalizarla pasa a contar con sus HH reales. No entran las tercerizadas ni las finalizadas sin día puntual.</p>
    </section>
    <section><div className="sec-h"><h3>Cargas globales de {o.nombre} en el mes <span className="cnt">{asigs.length}</span></h3></div>
      {asigs.length === 0 ? <p className="mut">No hay cargas globales en este mes. Se usan cuando no se cargaron las tareas puntuales (viajes, vacaciones): elegís operario, fechas, destino y horas.</p>
        : <div className="al-l">{asigs.map(a => <div key={a.id} className="al-r"><div className="al-b"><b><i className="est-dot" style={{ background: COL_EST[E.destinoTipo(S, a.destino)] }} />{E.destinoNom(S, a.destino)} · {fN(Number(a.horas) || 0)} h</b><span className="mut">{fD(a.desde)} → {fD(a.hasta || a.desde)}{a.nota ? ' · ' + a.nota : ''}</span></div>
          {pm.admin && <div className="al-a"><button className="btn sm" onClick={() => ui.modal({ k: 'asig', id: a.id })}>Editar</button></div>}</div>)}</div>}
    </section></div>;
}
// Detalle de un día: qué suma esas horas
function DiaOpDet({ x, o, cerrar }) {
  const { S, V, ui, pm } = useApp(); const s0 = E.schedAt(S, x.d), jor = E.capN(S, o.id, x.d), ext = x.aus ? 0 : E.extraDe(S, o.id, x.d);
  return <div className="calg-det oc-det"><div className="sec-h"><h3>{E.fDia(x.d)} · {o.nombre}</h3><button className="btn sm" onClick={cerrar}>Cerrar</button></div>
    <p className="mut">{x.aus ? `Ausente: ${x.aus.motivo}. ` : ausParcial(S, o.id, x.d) ? `${ausParcial(S, o.id, x.d).txt} (${fN(ausParcial(S, o.id, x.d).h)} h fuera). ` : x.fer ? `Feriado: ${x.fer.nombre}. ` : x.finde && !ext ? 'Fin de semana. ' : ''}Disponible {fN(x.dp)} h{x.dp > 0 ? ` (jornada ${fN(jor)} h${ext ? ` + ${fN(ext)} h extra` : ''})` : ''} · cargadas {fN(x.c.total)} h{x.p.total > 0.05 ? ` · planificadas ${fN(x.p.total)} h` : ''}{x.fut ? '' : ` · sin asignar ${fN(x.sin)} h`}{x.exc > 0.05 ? ` · ${fN(x.exc)} h de más` : ''}</p>
    {x.alerta === 'over' && <p className="note bad">Se cargaron más horas de las que tenía disponibles. Revisá las horas reales de las piezas de abajo, si las extras están habilitadas ese día, o si una pieza quedó con un inicio o un fin equivocado (sus horas se reparten entre todos los días que duró).</p>}
    {x.c.solapado > 0.05 && <p className="note">Este día el operario llevó a la vez piezas de dos operaciones que se pueden solapar: se le cuentan {fN(x.c.solapado)} h menos (la operación que más horas llevó cuenta completa). Cada pieza conserva sus horas reales completas.</p>}
    {x.alerta === 'falta' && <p className="note">Quedaron {fN(x.sin)} h sin asignar. Puede faltar cargar una tarea o sus horas reales, o una ausencia.</p>}
    {x.p.items.length > 0 && <><h4 className="oc-st">Planificado <span className="cnt">{x.p.items.length}</span></h4><div className="al-l">{x.p.items.map(it => { const t = V.byId[it.t]; if (!t) return null;
      return <div key={'p' + it.t} className="al-r"><div className="al-b"><span className="row"><Chip t={t} small /><b>{etiqueta(V, t)}</b></span><span className="mut"><i className="est-dot oc-pl" style={{ '--c': COL_EST[it.tipo] }} />{NOM_EST[it.tipo]} · {fN(it.h)} h planificadas este día · {({ 'en proceso': 'En proceso', proximo: 'Próximo a realizar', pendiente: 'Pendiente' })[t.estado] || t.estado} · {fDT(t.inicio)} → {fDT(V.D[t.id].fin)}</span></div>
        <div className="al-a"><button className="btn sm" onClick={() => ui.modal({ k: 'task', id: t.id })}>Abrir</button></div></div>; })}</div>
      {x.c.items.length > 0 && <h4 className="oc-st">Finalizadas y cargas globales (horas reales)</h4>}</>}
    {x.c.items.length === 0 ? (x.p.items.length ? null : <p className="mut">No hay horas cargadas este día.</p>) : <div className="al-l">{x.c.items.map((it, i) => { const t = it.t && V.byId[it.t], a = it.a && !it.sal && (S.asignaciones || []).find(z => z.id === it.a), sa = it.sal && (S.ausencias || []).find(z => z.id === it.sal);
      return <div key={i} className="al-r"><div className="al-b">{t ? <><span className="row"><Chip t={t} small /><b>{etiqueta(V, t)}</b></span><span className="mut"><i className="est-dot" style={{ background: COL_EST[it.tipo] }} />{NOM_EST[it.tipo]} · {fN(it.h)} h este día{it.hCompleta ? ` (de ${fN(it.hCompleta)} h: corrió a la vez con otra operación)` : ''} · la pieza tiene {fN(it.real)} h reales{it.dias > 1 ? ` repartidas en ${it.dias} días` : ''}{t.ops.length > 1 ? ` entre ${t.ops.length} operarios` : ''} · {fDT(t.inicio)} → {fDT(t.finReal || V.D[t.id].fin)}</span></>
        : a ? <><b><i className="est-dot" style={{ background: COL_EST[it.tipo] }} />Carga global: {E.destinoNom(S, a.destino)}</b><span className="mut">{fN(it.h)} h este día · {fN(Number(a.horas) || 0)} h del {fD(a.desde)} al {fD(a.hasta || a.desde)}{a.nota ? ' · ' + a.nota : ''}</span></> : sa ? <><b><i className="est-dot" style={{ background: COL_EST[it.tipo] }} />Salida a Post Venta: {E.destinoNom(S, sa.destino)}</b><span className="mut">{fN(it.h)} h este día · sale {fD(sa.desde)}{sa.desdeHora ? ' ' + sa.desdeHora : ''} → vuelve {fD(sa.hasta)}{sa.hastaHora ? ' ' + sa.hastaHora : ''}{sa.nota ? ' · ' + sa.nota : ''}</span></> : null}</div>
        <div className="al-a">{t && <button className="btn sm" onClick={() => ui.modal({ k: 'task', id: t.id })}>Abrir</button>}{sa && pm.admin && <button className="btn sm" onClick={() => ui.modal({ k: 'salida', id: sa.id })}>Editar</button>}{a && pm.admin && <button className="btn sm" onClick={() => ui.modal({ k: 'asig', id: a.id })}>Editar</button>}</div></div>; })}</div>}
  </div>;
}
// Ventana para cargar horas a mano (carga global)
function AsigDlg({ id, opId, desde, hasta, onClose }) {
  const { S, V, up, ui } = useApp(); const prev = id ? (S.asignaciones || []).find(a => a.id === id) : null;
  const [f, setF] = useState(() => prev ? { ...prev, horas: String(prev.horas ?? '') } : { id: E.uid(), opId: opId || '', desde: desde || E.today(), hasta: hasta || desde || E.today(), destino: '', horas: '', nota: '' });
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const rangoOk = f.desde && f.hasta && f.hasta >= f.desde && E.diffDays(f.desde, f.hasta) <= 366;
  // ayuda: horas disponibles y ya cargadas en esas fechas (sin contar esta misma carga)
  const ay = useMemo(() => { if (!f.opId || !rangoOk) return null; const CD = E.cargaDiaria({ ...S, asignaciones: (S.asignaciones || []).filter(a => a.id !== f.id) }, V, true), PD = E.planDiaria(S, V); let disp = 0, carg = 0, libre = 0, dias = 0;
    for (let d = f.desde; d <= f.hasta; d = E.addDays(d, 1)) { const dp = E.dispDia(S, f.opId, d), c = ((CD[f.opId + '|' + d] || {}).total || 0) + ((PD[f.opId + '|' + d] || {}).total || 0); disp += dp; carg += c; libre += Math.max(0, dp - c); if (dp > 0) dias++; }
    return { disp, carg, libre, dias }; }, [S, V, f.opId, f.desde, f.hasta, f.id]);
  const h = Number(String(f.horas).replace(',', '.'));
  const ok = f.opId && f.destino && rangoOk && h > 0;
  const guardar = () => { if (!ok) return; const a = { id: f.id, opId: f.opId, desde: f.desde, hasta: f.hasta, destino: f.destino, horas: Math.round(h * 100) / 100, nota: (f.nota || '').trim() };
    up(s => ({ ...s, asignaciones: prev ? (s.asignaciones || []).map(x => x.id === a.id ? a : x) : [...(s.asignaciones || []), a] })); ui.toast(prev ? 'Carga global actualizada' : `Cargadas ${fN(a.horas)} h a ${opName(S, a.opId)} en ${E.destinoNom(S, a.destino)}`); onClose(); };
  const borrar = () => ui.confirmar({ titulo: '¿Borrar la carga global?', texto: `Se borran las ${fN(Number(prev.horas) || 0)} h de ${opName(S, prev.opId)} en ${E.destinoNom(S, prev.destino)} (${fD(prev.desde)} → ${fD(prev.hasta)}). Podés deshacerlo arriba.`, si: 'Sí, borrar', peligro: true, onSi: () => { up(s => ({ ...s, asignaciones: (s.asignaciones || []).filter(x => x.id !== prev.id) })); ui.toast('Carga global borrada'); onClose(); } });
  const grupo = (cl, tit) => { const l = S.proyectos.filter(p => E.claseP(p) === cl).sort((a, b) => (!!a.terminado - !!b.terminado) || a.nombre.localeCompare(b.nombre, 'es')); return l.length ? <optgroup label={tit}>{l.map(p => <option key={p.id} value={'p:' + p.id}>{p.nombre}{p.terminado ? ' (terminado)' : ''}</option>)}</optgroup> : null; };
  return <Modal title={prev ? 'Editar carga global' : 'Carga global de horas'} onClose={onClose} foot={<>{prev && <button className="btn danger" onClick={borrar}>Borrar</button>}<span className="sp" /><button className="btn canc-b" onClick={onClose}>Cancelar</button><button className="btn pri-b" disabled={!ok} onClick={guardar}>Guardar</button></>}>
    <p className="mut">Para cuando no se cargaron las tareas puntuales (viajes, vacaciones): indicás a qué se dedicó el operario en esas fechas y cuántas horas. Suma en Estadísticas y en el calendario del operario. No crea tareas ni cambia el Gantt ni Tiempos.</p>
    <div className="form">
      <label>Operario<select value={f.opId} onChange={e => set('opId', e.target.value)}><option value="">Elegí…</option>{S.operarios.slice().sort(porApellido).map(x => <option key={x.id} value={x.id}>{x.nombre}{x.activo === false ? ' (inactivo)' : ''}</option>)}</select></label>
      <label>A qué se dedicó<select value={f.destino} onChange={e => set('destino', e.target.value)}><option value="">Elegí…</option>
        <option value="rep">Repuestos (en general)</option>{grupo('proy', 'Proyectos')}
        <option value="pv">Post Venta (en general)</option>{grupo('pv', 'Casos de Post Venta')}
        <option value="tl">Taller (en general)</option>{grupo('tl', 'Trabajos de Taller')}</select></label>
      <label>Desde<input type="date" value={f.desde} onChange={e => set('desde', e.target.value)} /></label>
      <label>Hasta<input type="date" value={f.hasta} min={f.desde} onChange={e => set('hasta', e.target.value)} /></label>
      <label>Horas-hombre del período<input type="text" inputMode="decimal" value={f.horas} onChange={e => set('horas', e.target.value)} placeholder="por ejemplo 40" /></label>
      <label className="g2">Nota (opcional)<input value={f.nota || ''} onChange={e => set('nota', e.target.value)} placeholder="por ejemplo: viaje a Brasil, armado de la escaldadora" /></label>
    </div>
    {!rangoOk && f.desde && f.hasta && <p className="note bad">La fecha «Hasta» tiene que ser igual o posterior a «Desde» (y el rango, de un año como máximo).</p>}
    {ay && <div className="note">En esas fechas {opName(S, f.opId)} tenía <b>{fN(ay.disp)} h disponibles</b> en {ay.dias} {ay.dias === 1 ? 'día' : 'días'}, ya tiene <b>{fN(ay.carg)} h cargadas</b> y le quedan <b>{fN(ay.libre)} h libres</b>.
      {ay.libre > 0.05 && <> <button className="lnk sm" onClick={() => set('horas', String(Math.round(ay.libre * 10) / 10))}>Usar las {fN(ay.libre)} h libres</button></>}
      <span className="hint">Las horas se reparten en partes iguales entre los días con horas disponibles del rango.</span></div>}
    {ay && h > 0 && h > ay.libre + 0.05 && <p className="note bad">Supera las horas libres de esas fechas en {fN(h - ay.libre)} h. Se puede guardar igual, pero esos días van a quedar marcados en rojo en el calendario.</p>}
  </Modal>;
}

// Horas de jornada normal (sin el almuerzo) que una ausencia deja fuera en el día d (null si ese día lo cubre entero o no tiene hora)
const horasFuera = (S, a, d) => {
  if (!E.isWork(S, d)) return 0;
  const s = E.schedAt(S, d), [i, f] = E.tramoAus(a, d); if (i <= s.in && f >= s.out) return null;
  const jv = s.bm > 0 && s.bi > s.in && s.bi + s.bm < s.out ? [[s.in, s.bi], [s.bi + s.bm, s.out]] : [[s.in, s.out - s.bm]];
  return jv.reduce((t, [x, y]) => t + Math.max(0, Math.min(y, f) - Math.max(x, i)), 0) / 60;
};
// Ausencia de parte del día d (retiro antes, salida parcial, llegada tarde) de un operario: { a, h, txt } o null. No cuenta salidas a Post Venta.
const ausParcial = (S, op, d) => { const a = (S.ausencias || []).find(x => x.opId === op && x.desde <= d && d <= x.hasta && !x.destino && (horasFuera(S, x, d) || 0) > 0); if (!a) return null;
  const sale = d === a.desde && a.desdeHora, vuelve = d === a.hasta && a.hastaHora;
  return { a, h: horasFuera(S, a, d), txt: `${a.motivo} · ${sale && vuelve ? sale + ' a ' + vuelve : sale ? 'sale ' + sale : 'llega ' + vuelve}` }; };
const PARC_ST = { outline: '2px dashed var(--aus, var(--warn))', outlineOffset: -2 };   // borde punteado = falta solo unas horas ese día
const AUS_BOX = { border: '1px solid var(--bad)', borderRadius: 4, padding: '1px 4px', color: 'var(--bad)', fontWeight: 600, overflow: 'hidden' };   // ausencia en el calendario mensual: recuadro rojo como las otras actividades
const PARC_TX = { color: 'var(--aus, var(--warn))', fontWeight: 600, fontSize: 12, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
// Motivos de las ausencias por horas (se suman a la lista de motivos la primera vez que se usan, si quien guarda es administrador)
const TIPOS_RET = [
  { k: 'antes', l: 'Se retira antes (Leaves early)', motivo: 'Retiro anticipado', color: '#EF9F27' },
  { k: 'parcial', l: 'Sale y vuelve (Leaves and returns)', motivo: 'Salida parcial', color: '#D4537E' },
  { k: 'tarde', l: 'Llega tarde (Arrives late)', motivo: 'Llegada tarde', color: '#BA7517' },
];
const conMotivo = (s, nombre, color) => { const l = E.motivosAus(s), k = nombre.trim().toLowerCase(); return l.some(m => String(m.nombre || '').trim().toLowerCase() === k) ? s : { ...s, motivosAus: [...l, { id: E.uid(), nombre, color }] }; };
// Retiro antes, salida parcial o llegada tarde de un operario en un día: ausencia de un solo día con hora de salida y/o de regreso.
// El motor ya descuenta solo esas horas: sus tareas se corren lo justo y ese rato no suma horas.
function RetiroDlg({ opId, onClose }) {
  const { S, up, ui, pm } = useApp(); const hoy = E.today();
  const [f, setF] = useState(() => ({ tipo: 'antes', opId: opId || '', d: hoy, sale: '', vuelve: '', motivo: '', nota: '' }));
  const [pausa, setPausa] = useState(true);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const tp = TIPOS_RET.find(x => x.k === f.tipo), motivo = f.motivo || tp.motivo;
  const usaSale = f.tipo !== 'tarde', usaVuelve = f.tipo !== 'antes';
  const a = { id: E.uid(), opId: f.opId, desde: f.d, hasta: f.d, motivo, ...(usaSale && f.sale ? { desdeHora: f.sale } : {}), ...(usaVuelve && f.vuelve ? { hastaHora: f.vuelve } : {}), ...(f.nota.trim() ? { nota: f.nota.trim() } : {}) };
  const horasOk = (!usaSale || f.sale) && (!usaVuelve || f.vuelve) && !(usaSale && usaVuelve && f.vuelve <= f.sale);
  const h = f.d && horasOk ? horasFuera(S, a, f.d) : 0;
  const s = f.d ? E.schedAt(S, f.d) : null, jor = s ? `${E.pad(Math.floor(s.in / 60))}:${E.pad(s.in % 60)} a ${E.pad(Math.floor(s.out / 60))}:${E.pad(s.out % 60)}` : '';
  const ok = !!(f.opId && f.d && horasOk && E.isWork(S, f.d) && h !== 0);
  const choca = !!(f.opId && f.d && (S.ausencias || []).some(x => x.opId === f.opId && x.desde <= f.d && f.d <= x.hasta));
  const corte = ok && usaSale ? f.d + 'T' + f.sale : '';
  const enc = ok && usaSale ? E.enCurso(S, [f.opId]) : [], yaSalio = enc.length > 0 && corte <= E.nowDT();
  const guardar = () => { if (!ok) return;
    up(s0 => { let s1 = yaSalio && pausa ? E.pausarEnCurso(s0, [a.opId], null, corte) : s0; if (pm.admin) s1 = conMotivo(s1, motivo, tp.color); return E.setAusencias(s1, [...s1.ausencias, a]); });
    ui.toast(`${opName(S, a.opId)}: ${h === null ? 'todo el día' : fN(h) + ' h'} fuera el ${fD(a.desde)}${yaSalio && pausa ? ' · pausó lo que tenía en curso' : ''}`); onClose(); };
  return <Modal title="Retiro antes o salida parcial" onClose={onClose} foot={<><span className="sp" /><button className="btn canc-b" onClick={onClose}>Cancelar</button><button className="btn pri-b" disabled={!ok} onClick={guardar}>Guardar</button></>}>
    <div className="seg">{TIPOS_RET.map(x => <button key={x.k} className={f.tipo === x.k ? 'on' : ''} onClick={() => set('tipo', x.k)}>{x.l}</button>)}</div>
    <div className="form">
      <label>Operario<select value={f.opId} onChange={e => set('opId', e.target.value)}><option value="">Elegí…</option>{S.operarios.filter(o => o.activo !== false || o.id === f.opId).slice().sort(porApellido).map(x => <option key={x.id} value={x.id}>{nomApe(x)}</option>)}</select></label>
      <label>Día<input type="date" value={f.d} onChange={e => set('d', e.target.value)} /></label>
      {usaSale && <label>Sale a las<input type="time" value={f.sale} onChange={e => set('sale', e.target.value)} /></label>}
      {usaVuelve && <label>{f.tipo === 'tarde' ? 'Llega a las' : 'Vuelve a las'}<input type="time" value={f.vuelve} onChange={e => set('vuelve', e.target.value)} /></label>}
      <label>Motivo<select value={motivo} onChange={e => set('motivo', e.target.value)}>{!E.motivosAus(S).some(m => m.nombre === motivo) && <option value={motivo}>{motivo}</option>}{E.motivosAus(S).map(m => <option key={m.id} value={m.nombre}>{m.nombre}</option>)}</select></label>
      <label>Nota (opcional)<input value={f.nota} onChange={e => set('nota', e.target.value)} placeholder="por ejemplo: turno médico" /></label>
    </div>
    {f.d && !E.isWork(S, f.d) && <p className="note bad">Ese día no es laborable.</p>}
    {usaSale && usaVuelve && f.sale && f.vuelve && f.vuelve <= f.sale && <p className="note bad">La hora de regreso tiene que ser posterior a la de salida.</p>}
    {horasOk && h === 0 && E.isWork(S, f.d) && <p className="note bad">Ese horario queda fuera de la jornada ({jor}): no descuenta nada.</p>}
    {choca && <p className="note bad">Este operario ya tiene otra ausencia ese día. Revisá Configuración → Ausencias.</p>}
    {ok && <div className="note">{opName(S, f.opId)} queda fuera <b>{h === null ? 'toda la jornada' : fN(h) + ' h'}</b> (jornada de {jor}, sin el almuerzo). Ese rato sus tareas no avanzan: se corren lo justo.</div>}
    {yaSalio && <label className="chk"><input type="checkbox" checked={pausa} onChange={e => setPausa(e.target.checked)} /> Pausar a las {f.sale} lo que tenía en curso: {enc.map(t => t.nombre).join(', ')}</label>}
    {ok && f.tipo === 'parcial' && enc.length > 0 && <p className="note">Al volver, retomá su tarea con Retomar (Resume) y la hora de regreso.</p>}
  </Modal>;
}

// Salida de un operario a Post Venta: desde qué día y hora hasta qué día y hora (la hora es opcional: sin hora, días enteros).
// Mientras está afuera sus tareas no avanzan y se corren; el tiempo fuera cuenta como horas suyas cargadas a Post Venta, sin seguimiento fino.
function SalidaDlg({ id, proyId, opId, onClose }) {
  const { S, up, ui } = useApp(); const prev = id ? (S.ausencias || []).find(a => a.id === id) : null; const hoy = E.today();
  const [f, setF] = useState(() => prev ? { ...prev, desdeHora: prev.desdeHora || '', hastaHora: prev.hastaHora || '', nota: prev.nota || '' } : { id: E.uid(), opId: opId || '', destino: proyId ? 'p:' + proyId : 'pv', desde: hoy, desdeHora: '', hasta: hoy, hastaHora: '', nota: '' });
  const [pausa, setPausa] = useState(true);
  const set = (k, v) => setF(x => ({ ...x, [k]: v }));
  const horasOk = !(f.desde === f.hasta && f.desdeHora && f.hastaHora && f.hastaHora <= f.desdeHora);
  const rangoOk = !!(f.desde && f.hasta && f.hasta >= f.desde && E.diffDays(f.desde, f.hasta) <= 120 && horasOk);
  const ok = !!(f.opId && f.destino && rangoOk);
  const a = { id: f.id, opId: f.opId, desde: f.desde, hasta: f.hasta, motivo: 'Post Venta', destino: f.destino, ...(f.desdeHora ? { desdeHora: f.desdeHora } : {}), ...(f.hastaHora ? { hastaHora: f.hastaHora } : {}), ...((f.nota || '').trim() ? { nota: f.nota.trim() } : {}) };
  const horas = ok ? E.salidasComoCargas({ ...S, ausencias: [a] }).reduce((t, x) => t + x.horas, 0) : 0;
  const choca = !!(f.opId && rangoOk && (S.ausencias || []).some(x => x.id !== f.id && x.opId === f.opId && x.desde <= f.hasta && f.desde <= x.hasta));
  // lo que el operario tenía corriendo a la hora de salir: se puede pausar ahí (lo hecho queda registrado y lo que falta sigue en la cola)
  const corte = ok ? E.join(f.desde, f.desdeHora ? E.hm(f.desdeHora) : E.schedAt(S, f.desde).in) : '';
  const enc = ok ? E.enCurso(S, [f.opId]) : [], yaSalio = enc.length > 0 && corte <= E.nowDT();
  const guardar = () => { if (!ok) return;
    up(s => { const s1 = yaSalio && pausa ? E.pausarEnCurso(s, [a.opId], null, corte) : s; return E.setAusencias(s1, prev ? s1.ausencias.map(x => x.id === a.id ? a : x) : [...s1.ausencias, a]); });
    ui.toast(`${opName(S, a.opId)}: ${fN(horas)} h a ${E.destinoNom(S, a.destino)}${yaSalio && pausa ? ' · pausó lo que tenía en curso' : ''}`); onClose(); };
  const borrar = () => ui.confirmar({ titulo: '¿Borrar la salida?', texto: `${opName(S, prev.opId)} deja de figurar en Post Venta del ${fD(prev.desde)} al ${fD(prev.hasta)}. Sus tareas vuelven a avanzar esos días. Podés deshacerlo arriba.`, si: 'Sí, borrar', peligro: true, onSi: () => { up(s => E.setAusencias(s, s.ausencias.filter(x => x.id !== prev.id))); ui.toast('Salida borrada'); onClose(); } });
  const casos = S.proyectos.filter(p => E.claseP(p) === 'pv').sort((x, y) => (!!x.terminado - !!y.terminado) || x.nombre.localeCompare(y.nombre, 'es'));
  return <Modal title={prev ? 'Editar salida a Post Venta' : 'Salida de operario a Post Venta'} onClose={onClose} foot={<>{prev && <button className="btn danger" onClick={borrar}>Borrar</button>}<span className="sp" /><button className="btn canc-b" onClick={onClose}>Cancelar</button><button className="btn pri-b" disabled={!ok} onClick={guardar}>Guardar</button></>}>
    <p className="mut">Mientras el operario está afuera sus tareas no avanzan (se corren) y el tiempo fuera cuenta como horas suyas en Post Venta, sin seguimiento fino. Si no ponés hora, se toman días enteros. Al volver, retomá su tarea con Retomar y la hora de regreso.</p>
    <div className="form">
      <label>Operario<select value={f.opId} onChange={e => set('opId', e.target.value)}><option value="">Elegí…</option>{S.operarios.filter(o => o.activo !== false || o.id === f.opId).slice().sort(porApellido).map(x => <option key={x.id} value={x.id}>{nomApe(x)}</option>)}</select></label>
      <label>Caso de Post Venta<select value={f.destino} onChange={e => set('destino', e.target.value)}><option value="pv">Post Venta (en general)</option>{casos.length > 0 && <optgroup label="Casos">{casos.map(c => <option key={c.id} value={'p:' + c.id}>{c.nombre}{c.terminado ? ' (terminado)' : ''}</option>)}</optgroup>}</select></label>
      <label>Sale el<input type="date" value={f.desde} onChange={e => setF(x => ({ ...x, desde: e.target.value, hasta: e.target.value > x.hasta ? e.target.value : x.hasta }))} /></label>
      <label>Hora de salida (opcional)<input type="time" value={f.desdeHora} onChange={e => set('desdeHora', e.target.value)} /></label>
      <label>Vuelve el<input type="date" value={f.hasta} min={f.desde} onChange={e => set('hasta', e.target.value)} /></label>
      <label>Hora de regreso (opcional)<input type="time" value={f.hastaHora} onChange={e => set('hastaHora', e.target.value)} /></label>
      <label className="g2">Nota (opcional)<input value={f.nota || ''} onChange={e => set('nota', e.target.value)} placeholder="por ejemplo: instalación en la planta del cliente" /></label>
    </div>
    {!rangoOk && f.desde && f.hasta && <p className="note bad">{horasOk ? 'La fecha «Vuelve el» tiene que ser igual o posterior a «Sale el» (y la salida, de 120 días como máximo).' : 'La hora de regreso tiene que ser posterior a la de salida.'}</p>}
    {choca && <p className="note bad">Este operario ya tiene otra ausencia en esas fechas: se pisan. Revisá Configuración → Ausencias.</p>}
    {ok && <div className="note">{opName(S, f.opId)} cuenta <b>{fN(horas)} h</b> en {E.destinoNom(S, f.destino)} (la jornada que está afuera, sin el almuerzo). Esas horas figuran como disponibles y cargadas, así que no aparecen como «sin asignar».</div>}
    {yaSalio && <label className="chk"><input type="checkbox" checked={pausa} onChange={e => setPausa(e.target.checked)} /> Pausar a las {corte.slice(11)} lo que tenía en curso: {enc.map(t => t.nombre).join(', ')}</label>}
    {ok && enc.length > 0 && !yaSalio && <p className="note">Tiene en curso: {enc.map(t => t.nombre).join(', ')}. El cronómetro no cuenta las horas que está afuera; si no vuelve a esa tarea, pausala a mano.</p>}
  </Modal>;
}
// Salidas de operarios de un caso de Post Venta (ausencias con destino a ese caso)
function SalidasPV({ p }) {
  const { S, ui, pm } = useApp();
  const l = (S.ausencias || []).filter(a => a.destino === 'p:' + p.id).slice().sort((x, y) => x.desde < y.desde ? 1 : -1);
  if (!l.length && !pm.admin) return null;
  const fh = (d, h) => fD(d) + (h ? ' ' + h : '');
  return <section className="pvreg"><div className="sec-h"><h2>Salidas de operarios <span className="cnt">{l.length}</span></h2>{pm.admin && <button className="btn sm" onClick={() => ui.modal({ k: 'salida', proyId: p.id })}>+ Salida de operario</button>}</div>
    {l.length === 0 ? <p className="mut">Cuando un operario sale a este caso, cargá la salida: sus tareas esperan y el tiempo fuera cuenta como horas en este caso.</p>
      : <div className="al-l">{l.map(a => { const h = E.salidasComoCargas({ ...S, ausencias: [a] }).reduce((t, x) => t + x.horas, 0);
        return <div key={a.id} className="al-r"><div className="al-b"><b>{opName(S, a.opId)} · {fN(h)} h</b><span className="mut">Sale {fh(a.desde, a.desdeHora)} → vuelve {fh(a.hasta, a.hastaHora)}{a.nota ? ' · ' + a.nota : ''}</span></div>
          {pm.admin && <div className="al-a"><button className="btn sm" onClick={() => ui.modal({ k: 'salida', id: a.id })}>Editar</button></div>}</div>; })}</div>}
  </section>;
}

/* ================= IMPORTADOR ================= */
function Importer({ mode, proyId, onClose }) {
  const { S, V, up, ui } = useApp();
  const campos = mode === 'rep' ? [['orden', 'OV/OC'], ['codigo', 'Código (opcional)'], ['nombre', 'Descripción'], ['cant', 'Cantidad'], ['restan', 'Restan (opcional)'], ['cliente', 'Cliente']] : [['n', 'N° (1, 1.1, 1.2…)'], ['codigo', 'Código'], ['cant', 'Cantidad'], ['nombre', 'Descripción (opcional)']];
  const { stock } = useApp(); const [fichasH, setFichasH] = useState(null); const [conFichas, setConFichas] = useState(true);   // hoja Fichas del mismo archivo (la arma la skill de importación)
  const [rows, setRows] = useState(null); const [fecha, setFecha] = useState(E.today()); const [head, setHead] = useState(true); const [map, setMap] = useState({}); const [txt, setTxt] = useState('');
  const cargar = rs => { rs = rs.filter(r => r && r.some(c => String(c == null ? '' : c).trim() !== '')); if (!rs.length) { ui.toast('La planilla está vacía'); return; }
    const h = rs[0].map(c => String(c == null ? '' : c).toLowerCase()); const m = {};
    const pista = { orden: ['ov', 'oc', 'orden'], nombre: ['prod', 'desc', 'nombre'], cant: ['cant'], restan: ['rest', 'pend', 'falt'], cliente: ['client'], codigo: ['cod', 'cód'], n: ['n°', 'nº', 'nro', 'item', 'ítem', 'n'] };
    campos.forEach(([k], i) => { const j = h.findIndex(c => pista[k].some(p => k === 'n' && p === 'n' ? c.trim() === 'n' : c.includes(p))); m[k] = j >= 0 ? j : (i < rs[0].length && !k.match(/codigo|restan/) ? i : ''); });
    setRows(rs); setMap(m); };
  const file = e => { const f = e.target.files[0]; if (!f) return; if (!window.XLSX) { ui.toast('No se pudo cargar el lector de Excel. Probá pegando las celdas.'); return; }
    const fr = new FileReader(); fr.onload = () => { try { const wb = window.XLSX.read(fr.result, { type: 'array' }); const hf = mode !== 'rep' && wb.SheetNames.find(n => n.trim().toLowerCase() === 'fichas'); setFichasH(hf ? window.XLSX.utils.sheet_to_json(wb.Sheets[hf], { defval: '' }) : null); cargar(window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' })); } catch (err) { ui.toast('No se pudo leer el archivo. Tiene que ser .xlsx, .xls o .csv'); } }; fr.readAsArrayBuffer(f); };
  const cols = rows ? Array.from({ length: Math.max(...rows.map(r => r.length)) }, (_, i) => i) : [];
  const data = rows ? rows.slice(head ? 1 : 0) : [];
  const val = (r, k) => map[k] === '' || map[k] == null ? '' : String(r[map[k]] == null ? '' : r[map[k]]).trim();
  /* Filas ya cargadas: repuestos = misma OV/OC + misma pieza; árbol = misma pieza bajo el mismo padre en este proyecto.
     No distingue mayúsculas, espacios, el prefijo "------ " ni el "(parte N)" de las tareas frenadas. */
  const [saltar, setSaltar] = useState(true);
  const limpia = s => String(s || '').replace(/^-+\s*/, '').replace(/\s*\(parte \d+\)\s*$/i, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const clave = (ctx, nombre) => limpia(ctx) + '|' + limpia(nombre);
  const nomFila = r => [val(r, 'codigo'), val(r, 'nombre')].filter(Boolean).join(' ');
  const yaEstan = useMemo(() => { const porId = new Map(S.tareas.map(t => [t.id, t])); const m = new Map();
    S.tareas.forEach(t => { if (mode === 'rep' ? t.tipo !== 'rep' || !limpia(t.orden) : t.tipo !== 'proy' || t.proyId !== proyId) return;
      const ctx = mode === 'rep' ? t.orden : ((porId.get(t.parentId) || {}).nombre || ''); const k = clave(ctx, t.nombre); if (!m.has(k)) m.set(k, t.id); });
    return m; }, [S.tareas, mode, proyId]);
  const ctxFila = (r, nomPorN) => { if (mode === 'rep') return val(r, 'orden'); const n = val(r, 'n'), i = n.lastIndexOf('.'); return i > 0 ? (nomPorN[n.slice(0, i)] || '') : ''; };
  const repe = (() => { const nomPorN = {}; if (mode !== 'rep') data.forEach(r => { const n = val(r, 'n'); if (n) nomPorN[n] = nomFila(r); });
    const vis = new Set(); return data.map(r => { if (!limpia(nomFila(r)) || (mode === 'rep' && !val(r, 'orden'))) return '';
      const k = clave(ctxFila(r, nomPorN), nomFila(r)); const e = yaEstan.has(k) ? 'cargada' : vis.has(k) ? 'doble' : ''; vis.add(k); return e; }); })();
  const cuenta = { nueva: data.filter((r, i) => nomFila(r) && !repe[i] && !(mode === 'rep' && map.restan !== '' && map.restan != null && val(r, 'restan') !== '' && Number(val(r, 'restan').replace(',', '.')) === 0)).length, cargada: repe.filter(e => e === 'cargada').length, doble: repe.filter(e => e === 'doble').length };
  /* Restan (25/11): columna opcional con lo que falta fabricar. Filas nuevas con Restan 0 no se importan (no queda nada por hacer).
     Las ya cargadas sin finalizar actualizan Cant. y Restan (con la regla de entregas parciales); si restan 0 pasan a finalizada. */
  const conR = mode === 'rep' && map.restan !== '' && map.restan != null;
  const restF = r => { if (!conR) return null; const x = val(r, 'restan'); if (x === '') return null; const n = Number(x.replace(',', '.')); return isFinite(n) ? Math.max(0, n) : null; };
  const cantF = r => Number(String(val(r, 'cant')).replace(',', '.')) || 1;
  const cero = (r, i) => !repe[i] && restF(r) === 0;
  const [actR, setActR] = useState(true);
  const cambiosR = useMemo(() => { if (!conR || !rows) return [];
    const pend = new Map(); S.tareas.forEach(t => { if (t.tipo !== 'rep' || !limpia(t.orden) || t.entParcial || !V.D[t.id] || V.D[t.id].parent || t.estado === 'terminada') return; const k = clave(t.orden, t.nombre); if (!pend.has(k)) pend.set(k, t); });
    const vis = new Set(), out = [];
    data.forEach(r => { if (!val(r, 'orden') || !nomFila(r)) return; const k = clave(val(r, 'orden'), nomFila(r)), t = pend.get(k); if (!t || vis.has(k)) return; vis.add(k);
      const rN = restF(r), c = map.cant === '' || map.cant == null ? Number(t.cant) || 0 : cantF(r), rq = rN == null || rN >= c ? c : rN;
      if (c !== (Number(t.cant) || 0) || rq !== E.restanDe(t)) out.push({ id: t.id, orden: t.orden, nombre: t.nombre, cant0: Number(t.cant) || 0, rest0: E.restanDe(t), cant: c, restan: rN == null ? null : rN }); });
    return out; }, [conR, rows, head, map, S.tareas, V]);
  const nCR = actR ? cambiosR.length : 0;
  const aplicarCR = st => !nCR ? st : cambiosR.reduce((a, x) => { if (!a.tareas.some(y => y.id === x.id)) return a; const r = E.ponerRestan(a, x.id, x.restan, { cant: x.cant }).S; return x.restan === 0 ? finRestan(r, x.id) : r; }, st);
  const aImportar = data.filter((r, i) => nomFila(r) && !(saltar && repe[i]) && !cero(r, i)).length;
  /* Repuestos que están en la app sin finalizar pero no en la planilla (24/11). La planilla trae todos los pendientes de entrega
     y los finalizados se sacan de ella: puede que ya se entregaran, que se cancelaran o que cambiara la OV/OC o la descripción.
     Solo se avisa; no se toca nada salvo lo que se elija para cada uno (dejar, pasar a finalizada sin día puntual o borrar). */
  const [accF, setAccF] = useState({});
  const faltan = useMemo(() => { if (mode !== 'rep' || !rows) return [];
    const enPlanilla = new Set(data.filter(r => val(r, 'orden') && nomFila(r)).map(r => clave(val(r, 'orden'), nomFila(r)))); if (!enPlanilla.size) return [];
    return S.tareas.filter(t => t.tipo === 'rep' && !t.parentId && limpia(t.orden) && V.D[t.id] && V.D[t.id].estado !== 'terminada' && !enPlanilla.has(clave(t.orden, t.nombre)))
      .sort((a, b) => String(a.orden).localeCompare(String(b.orden), 'es', { numeric: true }) || String(a.nombre).localeCompare(String(b.nombre), 'es')); }, [mode, rows, head, map, S.tareas, V]);
  const ovNuevas = new Set(mode === 'rep' ? data.filter((r, i) => nomFila(r) && !repe[i] && val(r, 'orden')).map(r => limpia(val(r, 'orden'))) : []);   // misma OV/OC que una fila nueva: quizá cambió la descripción
  const nFin = faltan.filter(t => accF[t.id] === 'fin').length, nBor = faltan.filter(t => accF[t.id] === 'borrar').length, nAcc = nFin + nBor;
  const todas = a => setAccF(a === 'dejar' ? {} : Object.fromEntries(faltan.map(t => [t.id, a])));
  const aplicarFaltan = st => faltan.reduce((s, t) => { const a = accF[t.id]; if (!a || a === 'dejar' || !s.tareas.some(x => x.id === t.id)) return s;
    if (a === 'borrar') return E.delTask(s, t.id);
    // finalizar: la pieza (o, si tiene partes, cada parte sin finalizar) como "finalizada sin día puntual", con las horas que llevaba
    return [t.id, ...E.descendants(s, t.id)].filter(id => !s.tareas.some(x => x.parentId === id)).reduce((a2, id) => { const x = a2.tareas.find(y => y.id === id); return x && x.estado !== 'terminada' ? E.setEstado(a2, id, 'sinfecha') : a2; }, s); }, st);
  const txA = (nFin ? ` · ${nFin} ${nFin === 1 ? 'finalizada' : 'finalizadas'}` : '') + (nBor ? ` · ${nBor} ${nBor === 1 ? 'borrada' : 'borradas'}` : '');
  const RF = useMemo(() => fichasH ? leerFichas(S, fichasH, stock && stock.items) : null, [fichasH, S.fichas, stock]), nF = RF && conFichas ? RF.ok.length : 0;
  const ponFichas = st => nF ? RF.ok.reduce((a, x) => conFicha(a, x.k, x.patch), st) : st;
  const importar = () => {
    let nuevos;
    if (mode === 'rep') nuevos = data.filter((r, i) => !(saltar && repe[i]) && !cero(r, i)).map(r => { const c = Number(val(r, 'cant')) || 1, rN = restF(r); return { ...E.blankTask('rep'), orden: val(r, 'orden'), nombre: nomFila(r), cant: c, restan: rN != null && rN < c ? rN : null, cliente: val(r, 'cliente'), creada: fecha || E.today() }; }).filter(t => t.nombre);
    else { const ids = {}, nomPorN = {}; data.forEach(r => { const n = val(r, 'n'); if (n) nomPorN[n] = nomFila(r); });
      const porClave = new Map(yaEstan);
      nuevos = data.map((r, i) => { const n = val(r, 'n'), k = clave(ctxFila(r, nomPorN), nomFila(r));
        if (saltar && repe[i]) { const ya = porClave.get(k); if (n && ya) ids[n] = ya; return null; } /* las hijas nuevas se cuelgan de la pieza que ya estaba */
        const t = { ...E.blankTask('proy', proyId), nombre: nomFila(r), cant: Number(val(r, 'cant')) || 1, _n: n }; if (n) ids[n] = t.id; if (!porClave.has(k)) porClave.set(k, t.id); return t; }).filter(t => t && t.nombre);
      nuevos = nuevos.map(({ _n, ...t }) => { const i = _n.lastIndexOf('.'); return { ...t, parentId: i > 0 && ids[_n.slice(0, i)] ? ids[_n.slice(0, i)] : null }; }); }
    nuevos = nuevos.map(t => ({ ...t, ...E.autoCompletar(S, t, true) }));
    const txF = (nF ? ` · fichas de material: ${nF} ${nF === 1 ? 'pieza' : 'piezas'}` : '') + (nCR ? ` · ${nCR} con Cant./Restan ${nCR === 1 ? 'actualizado' : 'actualizados'}` : '');
    if (!nuevos.length) { if (nF || nAcc || nCR) { up(s => aplicarCR(aplicarFaltan(ponFichas(s)))); ui.toast((mode === 'rep' ? 'No había filas nuevas' : 'El árbol ya estaba cargado: no se repitió nada') + txF + txA); onClose(); return; }
      ui.toast(saltar && cuenta.cargada ? 'Todas las filas ya estaban cargadas. No hay nada nuevo.' : 'No encontré filas para importar. Revisá las columnas elegidas.'); return; }
    up(s => aplicarCR(aplicarFaltan(ponFichas({ ...s, tareas: [...s.tareas, ...nuevos] })))); ui.toast((nuevos.length === 1 ? "1 fila importada" : `${nuevos.length} filas importadas`) + txF + txA); onClose();
  };
  const pedir = () => !nAcc ? importar() : ui.confirmar({ titulo: '¿Aplicar los cambios a los repuestos que no están en la planilla?', texto: [nFin && `Pasan a finalizada (sin día puntual, con las horas que llevaban): ${nFin}.`, nBor && `Se borran: ${nBor}.`].filter(Boolean).join(' ') + ' Podés deshacerlo arriba.', si: 'Sí, aplicar', peligro: nBor > 0, onSi: importar });
  const lblBtn = [aImportar ? (aImportar === 1 ? 'Importar 1 fila nueva' : `Importar ${aImportar} filas${saltar ? ' nuevas' : ''}`) : '', nF ? `${aImportar ? '' : 'Cargar '}${nF} ${nF === 1 ? 'ficha' : 'fichas'}${aImportar ? '' : ' de material'}` : '', nAcc ? `${aImportar || nF ? '' : 'Aplicar '}${nAcc} ${nAcc === 1 ? 'cambio' : 'cambios'} en faltantes` : '', nCR ? `${aImportar || nF || nAcc ? '' : 'Actualizar '}Restan de ${nCR} ${nCR === 1 ? 'pieza' : 'piezas'}` : ''].filter(Boolean).join(' y ');
  return <Modal title={mode === 'rep' ? 'Importar repuestos' : 'Importar árbol de piezas'} onClose={onClose} wide foot={rows && <><button className="btn" onClick={() => setRows(null)}>Elegir otra planilla</button><span className="sp" />{RF && aImportar > 0 && RF.ok.length > 0 && <button className="btn" title="No agrega ninguna pieza al árbol: solo carga largo, sin material, etc. en las fichas" onClick={() => { up(st => RF.ok.reduce((x, f) => conFicha(x, f.k, f.patch), st)); ui.toast(`Fichas de material: ${RF.ok.length} ${RF.ok.length === 1 ? 'pieza' : 'piezas'} (el árbol no se tocó)`); onClose(); }}>Solo las fichas ({RF.ok.length})</button>}<button className="btn pri-b" disabled={!aImportar && !nF && !nAcc && !nCR} onClick={pedir}>{lblBtn || 'Importar'}</button></>}>
    {!rows ? <div className="form">
      <label className="g2">Archivo de Excel (.xlsx)<input id="imp-file" type="file" accept=".xlsx,.xls,.csv" onChange={file} /></label>
      <label className="g2">O pegá acá las celdas copiadas desde Excel<textarea id="imp-txt" rows="6" value={txt} onChange={e => setTxt(e.target.value)} placeholder={campos.map(c => c[1]).join('\t')} /></label>
      <div className="g2"><button className="btn" disabled={!txt.trim()} onClick={() => cargar(txt.split(/\r?\n/).map(l => l.split('\t')))}>Usar lo pegado</button></div>
    </div> : <>
      <p className="mut">Elegí qué columna de tu planilla corresponde a cada campo.</p>
      <div className="form">{campos.map(([k, l]) => <label key={k}>{l}<select id={'imp-' + k} value={map[k]} onChange={e => setMap({ ...map, [k]: e.target.value === '' ? '' : Number(e.target.value) })}><option value="">No usar</option>{cols.map(i => <option key={i} value={i}>{head && rows[0][i] !== '' && rows[0][i] != null ? String(rows[0][i]) : 'Columna ' + (i + 1)}</option>)}</select></label>)}
        {mode === 'rep' && <label>Fecha de carga de estas órdenes<input id="imp-fecha" type="date" value={fecha} max={E.today()} onChange={e => setFecha(e.target.value)} /></label>}
        <label className="chk g2"><input id="imp-head" type="checkbox" checked={head} onChange={e => setHead(e.target.checked)} /> La primera fila tiene los títulos</label>
        <label className="chk g2"><input id="imp-saltar" type="checkbox" checked={saltar} onChange={e => setSaltar(e.target.checked)} /> Saltear las filas que ya están cargadas{mode === 'rep' ? ' (misma OV/OC y misma pieza)' : ' (misma pieza bajo el mismo padre)'}</label></div>
      <p className="note"><b className="c-ok">{cuenta.nueva} nuevas</b> · {cuenta.cargada} ya cargadas{cuenta.doble ? ` · ${cuenta.doble} repetidas dentro de la planilla` : ''}{faltan.length ? <b> · {faltan.length} en la app y no en la planilla (ver abajo)</b> : null}{mode === 'rep' && data.some(r => !val(r, 'orden')) ? ' · las filas sin OV/OC se toman siempre como nuevas' : ''}</p>
      {RF && <div className="note impf"><label className="chk"><input type="checkbox" checked={conFichas} onChange={e => setConFichas(e.target.checked)} /> <b>Cargar también las fichas de material</b> (hoja Fichas del mismo archivo: largo del plano, sin material…)</label>
        <span className="mut">{RF.ok.length} {RF.ok.length === 1 ? 'pieza cambia' : 'piezas cambian'}{RF.iguales ? ` · ${RF.iguales} ya estaban iguales (no se tocan)` : ''}{RF.err.length ? ` · ${RF.err.length} con un ítem que no existe en StockApp (se saltean)` : ''}{RF.sinStock ? ` · ${RF.sinStock} traen ítem de StockApp pero no se puede leer StockApp con este usuario: se carga el resto y el ítem no` : ''}. Valen para la pieza en cualquier proyecto; las celdas vacías no tocan lo que ya tenía la ficha.</span></div>}
      <div className="scroll"><table className="tt"><thead><tr><th>Estado</th>{campos.map(c => <th key={c[0]}>{c[1]}</th>)}</tr></thead><tbody>{data.map((r, i) => ({ r, i })).sort((a, b) => !!repe[a.i] - !!repe[b.i]).slice(0, 8).map(({ r, i }) => <tr key={i} className={repe[i] && saltar ? 'done' : ''}><td>{repe[i] === 'cargada' ? <span className="tag">Ya cargada</span> : repe[i] === 'doble' ? <span className="tag warn">Repetida</span> : <span className="tag ok">Nueva</span>}</td>{campos.map(c => <td key={c[0]}>{val(r, c[0])}</td>)}</tr>)}</tbody></table></div>
      {data.length > 8 && <p className="mut">…y {data.length - 8} filas más (primero se muestran las nuevas).</p>}
      {conR && data.some((r, i) => cero(r, i)) && <p className="mut">{(n => n === 1 ? '1 fila nueva con Restan 0 no se importa' : n + ' filas nuevas con Restan 0 no se importan')(data.filter((r, i) => cero(r, i)).length)}: no queda nada por fabricar.</p>}
      {cambiosR.length > 0 && <div className="note impf">
        <label className="chk"><input type="checkbox" checked={actR} onChange={e => setActR(e.target.checked)} /> <b>Actualizar Cant. y Restan de {cambiosR.length} {cambiosR.length === 1 ? 'repuesto ya cargado' : 'repuestos ya cargados'}</b></label>
        <span className="mut">Si la pieza ya se empezó y bajó lo que resta, lo entregado queda como finalizado aparte con las horas hechas; si no, la duración se ajusta en proporción. Las que quedan en 0 pasan a finalizada.</span>
        <div className="scroll"><table className="tt"><thead><tr><th>OV/OC</th><th>Pieza</th><th className="num">Cant.</th><th className="num">Restan</th></tr></thead><tbody>{cambiosR.slice(0, 12).map(x => { const rq = x.restan == null || x.restan >= x.cant ? x.cant : x.restan; return <tr key={x.id}><td>{x.orden}</td><td>{x.nombre}{rq === 0 && <> <span className="tag ok">pasa a finalizada</span></>}</td><td className="num">{x.cant0 !== x.cant ? `${x.cant0} → ${x.cant}` : x.cant}</td><td className="num">{x.rest0 !== rq ? `${x.rest0} → ${rq}` : rq}</td></tr>; })}</tbody></table></div>
        {cambiosR.length > 12 && <span className="mut">…y {cambiosR.length - 12} más.</span>}</div>}
      {faltan.length > 0 && <div className="note fren impf">
        <b>⚠ {faltan.length} {faltan.length === 1 ? 'repuesto está' : 'repuestos están'} en la app sin finalizar pero no en la planilla</b>
        <span className="mut">Puede que ya se hayan entregado, que se cancelaran o que cambiara la OV/OC o la descripción (en ese caso la pieza figura también como «Nueva» arriba). No se toca nada salvo lo que elijas. «Pasar a finalizada» la deja como finalizada sin día puntual, con las horas que llevaba.</span>
        <div className="row"><span className="mut">Todos:</span><button className="btn sm" onClick={() => todas('dejar')}>Dejar como están</button><button className="btn sm" onClick={() => todas('fin')}>Pasar a finalizada</button><button className="btn sm danger" onClick={() => todas('borrar')}>Borrar</button></div>
        <div className="scroll"><table className="tt"><thead><tr><th>Qué hacer</th><th>OV/OC</th><th>Pieza</th><th>Estado</th><th>Cliente</th></tr></thead><tbody>{faltan.map(t => { const r = V.D[t.id];
          return <tr key={t.id}><td><select value={accF[t.id] || 'dejar'} onChange={e => setAccF({ ...accF, [t.id]: e.target.value })}><option value="dejar">Dejar como está</option><option value="fin">Pasar a finalizada</option><option value="borrar">Borrar</option></select></td><td>{t.orden}</td><td>{t.nombre}{ovNuevas.has(limpia(t.orden)) && <> <span className="tag warn" title="La planilla trae una fila nueva con la misma OV/OC: puede ser esta pieza con otra descripción">¿Cambió la descripción?</span></>}</td>
            <td><span className={'est e-' + r.estado.replace(' ', '')}>{estTxt(r.estado)}{r.estado === 'en proceso' ? ` ${Math.round(r.avance)}%` : ''}</span>{t.pausada ? <span className="mut"> (pausada)</span> : null}</td><td>{t.cliente || ''}</td>
</tr>; })}</tbody></table></div>
      </div>}</>}
  </Modal>;
}

/* ================= CONFIGURACIÓN ================= */
// Operario: nombre y apellido por separado. Si un operario viejo solo tiene "nombre", se parte: primera palabra = nombre, el resto = apellido.
const partesOp = o => (o.apellido !== undefined || o.nom !== undefined) ? { nom: o.nom || '', ape: o.apellido || '' } : (w => ({ nom: w[0] || '', ape: w.slice(1).join(' ') }))(String(o.nombre || '').trim().split(/\s+/));
const porApellido = (a, b) => { const x = partesOp(a), y = partesOp(b); return x.ape.localeCompare(y.ape, 'es') || x.nom.localeCompare(y.nom, 'es'); };
const nomApe = o => { const p = partesOp(o); return p.ape ? `${p.ape}, ${p.nom}` : p.nom; };
const fDM = d => d.slice(8) + '/' + d.slice(5, 7);
const MES_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const mesMas = (mes, n) => { const [y, m] = mes.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${E.pad(d.getMonth() + 1)}`; };
const habiles = (S, d1, d2) => { let h = 0; for (let d = d1, i = 0; d <= d2 && i < 800; d = E.addDays(d, 1), i++) if (E.isWork(S, d)) h++; return h; };

// Motivos de ausencia precargados (nombre + color). Los elige el desplegable de "Cargar ausencias" y se ven de su color en los calendarios.
// Si se cambia el nombre de un motivo, las ausencias ya cargadas con ese nombre se renombran para no perder el color.
function MotivosAusencia({ S, up }) {
  const lista = E.motivosAus(S);
  const set = nueva => up(s => ({ ...s, motivosAus: nueva }));
  const color = (id, c) => set(lista.map(m => m.id === id ? { ...m, color: c } : m));
  const renombrar = (m, nombre) => up(s => ({ ...s, motivosAus: lista.map(x => x.id === m.id ? { ...x, nombre } : x), ausencias: (s.ausencias || []).map(a => a.motivo === m.nombre ? { ...a, motivo: nombre } : a) }));
  return <div className="mot-l">
    {lista.map(m => <div className="lrow" key={m.id}>
      <input type="color" aria-label="Color" value={m.color} onChange={e => color(m.id, e.target.value)} />
      <input aria-label="Nombre del motivo" value={m.nombre} onChange={e => renombrar(m, e.target.value)} />
      <button className="btn sm danger" onClick={() => set(lista.filter(x => x.id !== m.id))}>Borrar</button></div>)}
    <div className="row"><button className="btn sm" onClick={() => set([...lista, { id: E.uid(), nombre: 'Nuevo motivo', color: '#BA7517' }])}>+ Motivo</button></div>
    <p className="mut">Cada motivo se ve de su color en los calendarios de ausencias. Si cambiás un nombre, las ausencias ya cargadas se renombran solas. Un motivo que no esté en la lista se ve en amarillo.</p>
  </div>;
}
// Carga de ausencias desde un calendario: clic en el primer día y clic en el último; los días del medio quedan marcados
function AusPicker({ S, onAdd }) {
  const hoy = E.today();
  const [op, setOp] = useState(''); const [mes, setMes] = useState(hoy.slice(0, 7)); const [ini, setIni] = useState(''); const [fin, setFin] = useState('');
  const motivos = E.motivosAus(S); const [motivo, setMotivo] = useState(() => (motivos[0] ? motivos[0].nombre : 'Vacaciones')); const [otro, setOtro] = useState(false);
  const colSel = E.colorAus(S, motivo);
  const [y, m] = mes.split('-').map(Number), nd = new Date(y, m, 0).getDate(), lead = (E.dow(`${mes}-01`) + 6) % 7;
  const celdas = [...Array(lead).fill(null), ...Array.from({ length: nd }, (_, i) => `${mes}-${E.pad(i + 1)}`)];
  const clic = d => { if (!ini || fin) { setIni(d); setFin(''); } else if (d < ini) setIni(d); else setFin(d); };
  const hasta = fin || ini;
  const choca = !!(op && ini && (S.ausencias || []).some(a => a.opId === op && a.desde <= hasta && ini <= a.hasta));
  const ops = S.operarios.filter(o => o.activo).slice().sort(porApellido);
  const agregar = () => { if (!op || !ini) return; onAdd({ id: E.uid(), opId: op, desde: ini, hasta, motivo: motivo.trim() || 'Ausencia' }); setIni(''); setFin(''); };
  return <div className="ausp">
    <div className="row"><select aria-label="Operario" value={op} onChange={e => setOp(e.target.value)}><option value="">Elegí el operario</option>{ops.map(o => <option key={o.id} value={o.id}>{nomApe(o)}</option>)}</select>
      <select aria-label="Motivo" value={otro ? '__otro' : motivo} onChange={e => { if (e.target.value === '__otro') { setOtro(true); setMotivo(''); } else { setOtro(false); setMotivo(e.target.value); } }}>{motivos.map(x => <option key={x.id} value={x.nombre}>{x.nombre}</option>)}<option value="__otro">Otro…</option></select>
      {otro && <input aria-label="Motivo (otro)" placeholder="Escribí el motivo" value={motivo} onChange={e => setMotivo(e.target.value)} />}</div>
    <div className="ausp-nav"><button className="btn sm" aria-label="Mes anterior" onClick={() => setMes(mesMas(mes, -1))}>◀</button><b>{MES_L[m - 1]} {y}</b><button className="btn sm" aria-label="Mes siguiente" onClick={() => setMes(mesMas(mes, 1))}>▶</button></div>
    <div className="ausp-cal" style={colSel ? { '--aus': colSel } : undefined}>{['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((x, i) => <span key={i} className="dh">{x}</span>)}
      {celdas.map((d, i) => { if (!d) return <span key={'v' + i} />; const mia = op && E.ausenciaReal(S, op, d); const enSel = ini && d >= ini && d <= hasta;
        return <button key={d} type="button" style={enSel ? undefined : E.ausStyle(S, mia)} className={(E.isWork(S, d) ? '' : 'off ') + (mia ? 'ya ' : '') + (enSel ? 'sel ' : '') + (d === ini || d === fin ? 'ext ' : '') + (d === hoy ? 'hoy' : '')} title={mia ? 'Ya tiene: ' + mia.motivo : ''} onClick={() => clic(d)}>{+d.slice(8)}</button>; })}</div>
    <p className="mut">{!ini ? 'Hacé clic en el primer día de la ausencia.' : !fin ? 'Ahora clic en el último día (o agregá solo este día).' : ''}{ini && <b className={choca ? 'c-bad' : ''}> Del {fDM(ini)} al {fDM(hasta)} · {habiles(S, ini, hasta)} días hábiles{choca ? ' · ⚠ se pisa con otra ausencia de este operario' : ''}</b>}</p>
    <div className="row"><button className="btn" disabled={!op || !ini} onClick={agregar}>Agregar ausencia</button>{ini && <button className="btn sm" onClick={() => { setIni(''); setFin(''); }}>Limpiar</button>}</div>
  </div>;
}

// Días que viene un operario ocasional: un clic prende o apaga cada día (solo lunes a viernes no feriados cuentan horas)
function DiasPicker({ S, onSet }) {
  const hoy = E.today();
  const [op, setOpId] = useState(''); const [mes, setMes] = useState(hoy.slice(0, 7));
  const ocas = S.operarios.filter(o => o.activo && o.ocasional).slice().sort(porApellido);
  const o = ocas.find(x => x.id === op), dias = (o && o.dias) || [];
  const [y, m] = mes.split('-').map(Number), nd = new Date(y, m, 0).getDate(), lead = (E.dow(`${mes}-01`) + 6) % 7;
  const celdas = [...Array(lead).fill(null), ...Array.from({ length: nd }, (_, i) => `${mes}-${E.pad(i + 1)}`)];
  const tog = d => o && onSet(o, { dias: (dias.includes(d) ? dias.filter(x => x !== d) : [...dias, d]).sort() });
  if (!ocas.length) return <p className="mut">Ningún operario está marcado como "Ocasional". Marcalo en la sección Operarios y después cargá acá los días que viene.</p>;
  return <div className="ausp">
    <div className="row"><select aria-label="Operario ocasional" value={op} onChange={e => setOpId(e.target.value)}><option value="">Elegí el operario</option>{ocas.map(x => <option key={x.id} value={x.id}>{nomApe(x)}</option>)}</select></div>
    <div className="ausp-nav"><button className="btn sm" aria-label="Mes anterior" onClick={() => setMes(mesMas(mes, -1))}>◀</button><b>{MES_L[m - 1]} {y}</b><button className="btn sm" aria-label="Mes siguiente" onClick={() => setMes(mesMas(mes, 1))}>▶</button></div>
    <div className="ausp-cal">{['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((x, i) => <span key={i} className="dh">{x}</span>)}
      {celdas.map((d, i) => { if (!d) return <span key={'v' + i} />; const lab = E.isWork(S, d); const aus = o && E.ausenciaReal(S, o.id, d);
        return <button key={d} type="button" disabled={!o || !lab} className={(lab ? '' : 'off ') + (dias.includes(d) ? 'sel ' : '') + (d === hoy ? 'hoy' : '')} title={aus ? 'Tiene una ausencia cargada: ' + aus.motivo : ''} onClick={() => tog(d)}>{+d.slice(8)}</button>; })}</div>
    <p className="mut">{o ? 'Tocá cada día en que viene (azul = viene). Tocalo de nuevo para sacarlo. Los demás días no suma horas ni se le asigna trabajo.' : 'Elegí un operario para marcar los días.'}{o && <b> {dias.filter(d => d.startsWith(mes)).length} días este mes</b>}</p>
  </div>;
}

// Todas las ausencias juntas: una fila por operario y una columna por día; arriba, cuántos faltan cada día
function AusResumen({ S }) {
  const hoy = E.today();
  const [desde, setDesde] = useState(() => { const f = (S.ausencias || []).filter(a => a.hasta >= hoy).map(a => a.desde).sort()[0]; return (f && f > hoy ? f : hoy).slice(0, 7); });
  const [n, setN] = useState(2);
  const dias = []; for (let k = 0; k < n; k++) { const mm = mesMas(desde, k), nd = new Date(+mm.slice(0, 4), +mm.slice(5), 0).getDate(); for (let i = 1; i <= nd; i++) dias.push(`${mm}-${E.pad(i)}`); }
  const ops = S.operarios.filter(o => o.activo).slice().sort(porApellido);
  const cuenta = d => ops.filter(o => E.ausenciaReal(S, o.id, d)).length;
  const cls = d => (E.isWork(S, d) ? '' : 'off ') + (d === hoy ? 'hoy' : '');
  return <div className="ausr-w">
    <div className="ausp-nav"><button className="btn sm" aria-label="Mes anterior" onClick={() => setDesde(mesMas(desde, -1))}>◀</button><b>Desde {MES_L[+desde.slice(5) - 1]} {desde.slice(0, 4)}</b><button className="btn sm" aria-label="Mes siguiente" onClick={() => setDesde(mesMas(desde, 1))}>▶</button>
      <label className="inl">Ver<select value={n} onChange={e => setN(+e.target.value)}><option value={1}>1 mes</option><option value={2}>2 meses</option><option value={3}>3 meses</option></select></label></div>
    <div className="ausr"><table><thead><tr><th className="nm" />{Array.from({ length: n }, (_, k) => { const mm = mesMas(desde, k); return <th key={mm} colSpan={dias.filter(d => d.startsWith(mm)).length} className="mh">{MES_L[+mm.slice(5) - 1]} {mm.slice(0, 4)}</th>; })}</tr>
      <tr><th className="nm" />{dias.map(d => <th key={d} className={cls(d)}><span className="dn">{'DLMMJVS'[E.dow(d)]}</span>{d.slice(8)}</th>)}</tr></thead>
      <tbody><tr className="cnt"><th className="nm">Ausentes por día</th>{dias.map(d => { const c = cuenta(d); return <td key={d} className={(c > 1 ? 'multi ' : '') + cls(d)}>{c || ''}</td>; })}</tr>
        {ops.map(o => <tr key={o.id}><th className="nm">{nomApe(o)}</th>{dias.map(d => { const a = E.ausenciaReal(S, o.id, d), hp = a ? horasFuera(S, a, d) : null, st = E.ausStyle(S, a);   // hp: horas si ese día falta solo un rato (medio casillero rayado)
          return <td key={d} style={hp > 0 && st ? { ...st, background: `repeating-linear-gradient(135deg, ${st['--aus']} 0 4px, transparent 4px 8px)` } : st} className={(a ? 'aus ' : '') + cls(d)} title={a ? `${nomApe(o)}: ${a.motivo} (${fDM(a.desde)}${a.desdeHora ? ' ' + a.desdeHora : ''} al ${fDM(a.hasta)}${a.hastaHora ? ' ' + a.hastaHora : ''})${hp > 0 ? ' · ' + fN(hp) + ' h fuera' : ''}` : ''}>{a ? (a.motivo || '?')[0].toUpperCase() : ''}</td>; })}</tr>)}
        {ops.length === 0 && <tr><td className="mut">No hay operarios activos.</td></tr>}</tbody></table></div>
    <div className="ausr-lg">{E.motivosAus(S).map(m => <span key={m.id}><i style={{ background: m.color }} />{m.nombre}</span>)}</div>
    <p className="mut">Cada letra es la inicial del motivo; el casillero rayado es un día en que falta solo unas horas. Pasá el cursor sobre un casillero para ver el detalle. Si un día aparece un número mayor a 1 en rojo, faltan varios operarios ese día.</p>
  </div>;
}
// Configuración → Corte de serrucho: lo que se lleva el corte, sumado al largo del plano de cada pieza (por defecto y por rangos de medida)
function CorteCfg() {
  const { S, up } = useApp(); const PL = useContext(PlCtx); const c = S.cfg.corte || {}, R = c.rangos || [], T = 'Corte de serrucho';
  const setC = p => up(s => ({ ...s, cfg: { ...s.cfg, corte: { ...(s.cfg.corte || {}), ...p } } }));
  const setR = (i, p) => setC({ rangos: R.map((x, j) => j === i ? { ...x, ...p } : x) });
  const nv = v => v === '' ? null : Number(v);
  return <section className={'card' + PL.c(T)}><div className="sec-h"><h2>{PL.h(T)}</h2><div className="row"><button className="btn" onClick={() => setC({ rangos: [...R, { hasta: null, mm: null }] })}>+ Rango</button></div></div>
    <p className="mut">Lo que se lleva el serrucho en cada corte. Se suma al largo del plano de cada pieza para saber cuánto material consume (aviso de material con StockApp). La medida es el diámetro del ítem de StockApp (o el ancho o espesor si no tiene diámetro). En la ficha de una pieza se puede poner otro valor.</p>
    <div className="lrow"><label className="inl">Corte por defecto (mm)<input className="vh" type="number" min="0" step="0.5" value={c.def ?? ''} placeholder="0" onChange={e => setC({ def: nv(e.target.value) })} /></label><span className="mut">para las medidas que no entran en ningún rango</span></div>
    {R.map((x, i) => <div key={i} className="lrow"><label className="inl">Hasta Ø (mm)<input className="vh" type="number" min="0" value={x.hasta ?? ''} onChange={e => setR(i, { hasta: nv(e.target.value) })} /></label>
      <label className="inl">Corte (mm)<input className="vh" type="number" min="0" step="0.5" value={x.mm ?? ''} onChange={e => setR(i, { mm: nv(e.target.value) })} /></label>
      <button className="btn sm danger" onClick={() => setC({ rangos: R.filter((_, j) => j !== i) })}>Borrar</button></div>)}
  </section>;
}
function ListEdit({ title, items, onAdd, onDel, render, addLabel, extra, nota, rowClass }) {
  const PL = useContext(PlCtx); const { ui } = useApp();
  return <section className={'card' + PL.c(title)}><div className="sec-h"><h2>{PL.h(title)}</h2><div className="row">{extra}<button className="btn" onClick={onAdd}>{addLabel || '+ Agregar'}</button></div></div>
    {nota && <p className="mut">{nota}</p>}
    {items.length === 0 && <p className="mut">Nada cargado todavía.</p>}
    {items.map((it, i) => <div key={it.id || i} className={'lrow' + (rowClass ? rowClass(it) : '')}>{render(it, i)}<button className="btn sm danger" onClick={() => { const nom = typeof it === 'string' ? it : (it.nombre || it.email || ''); ui.confirmar({ titulo: '¿Borrar' + (nom ? ` “${nom}”` : ' este elemento') + '?', texto: 'Se borra de la lista. Podés deshacerlo arriba.', si: 'Sí, borrar', peligro: true, onSi: () => onDel(it, i) }); }}>Borrar</button></div>)}</section>;
}
const PlCtx = createContext({ c: () => '', h: t => t });
const CFG_SECS = ['Atajos de teclado', 'Operarios', 'Días que viene (ocasionales)', 'Cargar ausencias (calendario)', 'Calendario de ausencias', 'Motivos de ausencia', 'Ausencias', 'Operaciones', 'Códigos de operación', 'Tarifas de mano de obra', 'Materiales', 'Corte de serrucho', 'Horarios laborales', 'Feriados', 'Usuarios y permisos', 'Color de énfasis', 'Datos', 'Registro de cambios', 'Sesión'];
function Atajos() {
  const PL = useContext(PlCtx);
  const G = [['En todas las pantallas', [['Esc', 'Cierra la ventana abierta (editar tarea, operario, parte del día…)'], ['Ctrl + Z', 'Deshace el último cambio (si estás escribiendo en una celda, deshace lo escrito)'], ['Ctrl + Y  /  Ctrl + Mayús + Z', 'Rehace lo que deshiciste']]],
    ['Proyectos', [['Alt + 1 … 9', 'Abre el proyecto 1 al 9, en el orden de la barra de proyectos'], ['Alt + 0', 'Vuelve a "Todos" (la lista de proyectos)'], ['Doble clic en el borde de la columna Pieza del Gantt', 'Vuelve al ancho original'], ['Arrastrar una barra del Gantt', 'Mueve la tarea de día y la deja fijada a mano 📌 (no la corren las etapas)'], ['▲ ▼ en la tabla de tareas', 'Cambia el orden de la pieza dentro de su ensamblaje'], ['Arrastrar ⠿ en el Gantt', 'Sube o baja la fila dentro de su ensamblaje'], ['↕ Ordenar filas por fecha', 'Ordena las filas del Gantt según cuándo empiezan']]],
    ['Tablas de Repuestos y Proyectos: moverse', [['↑ ↓ ← →', 'Pasa de celda en celda, como en Excel'], ['Enter', 'Confirma lo escrito y baja a la celda de abajo'], ['Clic en una celda', 'Selecciona todo el texto: lo que escribas lo reemplaza'], ['Doble clic en el borde de un título de columna', 'Vuelve la columna a su ancho original']]],
    ['Tablas de Repuestos y Proyectos: seleccionar filas', [['Espacio (Space)', 'En la casilla de la primera columna: marca o desmarca la fila'], ['Mayús + Espacio (Shift + Space)', 'Marca o desmarca la fila desde cualquier columna'], ['Mayús + ↑ / ↓ (Shift + flechas)', 'Va sumando filas a la selección mientras subís o bajás'], ['← al principio del nombre', 'Vuelve a la casilla de selección'], ['→, Enter o F2 desde la casilla', 'Entra al nombre de la pieza para editarlo']]]];
  return <section className={'card full' + PL.c('Atajos de teclado')}><div className="sec-h"><h2>{PL.h('Atajos de teclado')}</h2></div>
    <div className="atajos">{G.map(([g, l]) => <div key={g} className="atg"><h3>{g}</h3>{l.map(([k, d]) => <div key={k} className="atr"><span className="kbd">{k}</span><span>{d}</span></div>)}</div>)}</div>
    <p className="mut">En la Mac, Alt es la tecla Opción (Option).</p></section>;
}
function Config() {
  const { S, V, up, ui, ses, tema, cambiarTema } = useApp(); const [conf, setConf] = useState(false); const [prueba, setPrueba] = useState(''); const tempAct = E.seasonNow(S), horAct = S.cfg.horarios[tempAct];
  const [ab, setAb] = useState(() => prefG('cfg-abiertas', [])); useEffect(() => { guardaG('cfg-abiertas', ab); }, [ab]);
  const PL = { c: t => ab.includes(t) ? ' plg on' : ' plg', h: t => <button className="plg-t" aria-expanded={ab.includes(t)} onClick={() => setAb(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t])}><span className="car">{ab.includes(t) ? '▾' : '▸'}</span>{t}</button> };
  const aplicarCod = () => { let n = 0; up(s => ({ ...s, tareas: s.tareas.map(t => { if (s.tareas.some(x => x.parentId === t.id) || t.estado === 'terminada') return t; const a = E.autoCompletar(s, t, false); if (a.operacionId && a.operacionId !== t.operacionId) { n++; return { ...t, ...a }; } return t; }) })); ui.toast(n ? `Operación asignada a ${n} ${n === 1 ? 'pieza' : 'piezas'}` : 'No había piezas sin operación con código reconocido'); }; const [lq, setLq] = useState(''); const [ln, setLn] = useState(40);
  const cargarFer = l => { let n = 0; up(s => { const ya = new Set(s.feriados.map(f => f.fecha)); const nu = l.map(([d, nombre]) => ({ fecha: '2026-' + d, nombre })).filter(f => !ya.has(f.fecha)); n = nu.length; return n ? { ...s, feriados: [...s.feriados, ...nu] } : s; }); ui.toast(n ? `${n} ${n === 1 ? 'fecha agregada' : 'fechas agregadas'}` : 'Esas fechas ya estaban cargadas'); };
  const log = (S.log || []).filter(e => !lq || e.uid === lq);
  const setL = (k, id, patch) => up(s => ({ ...s, [k]: s[k].map(x => x.id === id ? { ...x, ...patch } : x) }));
  const setOp = (o, patch) => { const p = { ...partesOp(o), ...patch }; setL('operarios', o.id, { nom: p.nom, apellido: p.ape, nombre: `${p.nom} ${p.ape}`.trim() }); };
  const setDisp = (o, patch) => up(s => E.setDispOp(s, o.id, patch));   // activo desde / ocasional / días que viene: corre las tareas del operario
  const addAus = a => up(s => E.setAusencias(s, [...s.ausencias, a]));
  const setAus = (id, patch) => up(s => E.setAusencias(s, s.ausencias.map(x => x.id === id ? { ...x, ...patch } : x)));   // corre las tareas de los operarios afectados
  const setAusH = (id, k, v) => up(s => E.setAusencias(s, s.ausencias.map(x => { if (x.id !== id) return x; const n = { ...x }; if (v) n[k] = v; else delete n[k]; return n; })));   // hora de salida o de regreso; vacía = día entero
  // Resumen de una ausencia: días hábiles que cubre y aviso si incluye hoy
  const incluyeHoy = a => { const hoyD = E.today(); return !!a.opId && a.desde <= hoyD && hoyD <= a.hasta; };
  const resumenAus = a => {
    if (!a.desde || !a.hasta || a.hasta < a.desde) return null;
    const incl = incluyeHoy(a);
    const n = Math.round((new Date(a.hasta) - new Date(a.desde)) / 864e5) + 1;
    let txt = `${n} días corridos: revisá las fechas`;
    if (n <= 400) { let h = 0, d = a.desde; for (let i = 0; i < n; i++, d = E.addDays(d, 1)) if (E.isWork(S, d)) h++; txt = `${h} ${h === 1 ? 'día hábil' : 'días hábiles'}`; }
    if (n === 1 && (a.desdeHora || a.hastaHora)) { const hf = horasFuera(S, a, a.desde); if (hf !== null) txt = `${fN(hf)} h fuera`; }   // ausencia por horas en un solo día
    return <span className={incl ? 'c-bad' : 'mut'}>{incl ? '⚠ incluye hoy · ' : ''}{txt}</span>;
  };
  const act = E.seasonNow(S); const otra = act === 'invierno' ? 'verano' : 'invierno';
  const setH = (t, k, v) => up(s => ({ ...s, cfg: { ...s.cfg, horarios: { ...s.cfg.horarios, [t]: { ...s.cfg.horarios[t], [k]: v } } } }));
  const cambiar = () => { up(s => ({ ...s, cfg: { ...s.cfg, temporadas: [...s.cfg.temporadas.filter(x => x.desde !== E.today()), { desde: E.today(), t: otra }] } })); ui.toast(`Horario de ${otra} activo desde hoy`); };
  const fila = t => { const r = V.D[t.id], root = V.rootOf(t); const p = S.proyectos.find(x => x.id === t.proyId);
    return { Tipo: t.tipo === 'rep' ? 'Repuesto' : ({ pv: 'Post Venta', tl: 'Taller' })[E.claseP(p)] || 'Proyecto', Proyecto: p ? p.nombre : '', 'OV/OC': t.tipo === 'rep' ? root.orden : '', Cliente: t.tipo === 'rep' ? root.cliente : '', Pieza: t.nombre, 'Depende de': t.parentId ? V.byId[t.parentId].nombre : '', Cantidad: Number(t.cant) || 0, ...(t.tipo === 'rep' ? { Restan: t.estado === 'terminada' ? 0 : E.restanDe(t) } : {}), Prioridad: t.prioridad, Operación: r.parent ? '' : operName(S, t.operacionId), Operarios: r.ops.map(o => opName(S, o)).join(', '), Turno: r.parent ? '' : t.turno, Inicio: r.inicio ? r.inicio.replace('T', ' ') : '', Fin: r.fin ? r.fin.replace('T', ' ') : '', 'Horas-hombre': r.hh, 'Duración calendario (h)': r.parent ? '' : r.durCal, Estado: esTerc(t) ? 'tercerizada' : estTxt(r.estado), Proveedor: esTerc(t) ? (t.proveedor || '') : '', Vuelve: esTerc(t) && t.tercFecha ? t.tercFecha : '', 'Avance %': Math.round(r.avance), 'HH reales': r.hhReal }; };
  const exportar = () => { if (!window.XLSX) { ui.toast('No se pudo cargar el generador de Excel'); return; } const X = window.XLSX, wb = X.utils.book_new();
    const claseT = t => E.claseP(S.proyectos.find(x => x.id === t.proyId));
    const orden = (tipo, pv) => { const out = []; const go = t => { out.push(pv === true ? { ...fila(t), Origen: t.origen === 'reventa' ? 'Reventa' : 'Fabricada', Motivo: t.motivo || '', 'Cant. enviada': Number(t.cantEnv) || 0, 'Fecha de envío': t.fechaEnvio || '', Remito: t.remito || '', Destinatario: t.destinatario || '', 'Remito verificado': t.remitoOk ? 'Sí' : 'No', Avisos: pvAvisos(t).join(' / ') } : fila(t)); (V.kids[t.id] || []).forEach(go); }; S.tareas.filter(t => t.tipo === tipo && !t.parentId && (tipo !== 'proy' || claseT(t) === (pv === true ? 'pv' : pv || 'proy'))).forEach(go); return out; };
    X.utils.book_append_sheet(wb, X.utils.json_to_sheet(orden('rep')), 'Repuestos'); X.utils.book_append_sheet(wb, X.utils.json_to_sheet(orden('proy')), 'Proyectos'); X.utils.book_append_sheet(wb, X.utils.json_to_sheet(orden('proy', true)), 'Post Venta'); X.utils.book_append_sheet(wb, X.utils.json_to_sheet(orden('proy', 'tl')), 'Taller');
    saveFile(`produccion-${E.today()}.xlsx`, X.write(wb, { type: 'array', bookType: 'xlsx' }), ui.toast); };
  const [imp, setImp] = useState(null);
  const leerHist = e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; if (!window.XLSX) { ui.toast('No se pudo cargar el lector de Excel'); return; }
    const fr = new FileReader(); fr.onload = () => { try { const d = leerPlanillaHist(window.XLSX.read(fr.result, { type: 'array', cellDates: true })); d.archivo = f.name; setImp(d); } catch (err) { ui.toast(err && err.message ? err.message : 'No se pudo leer el archivo'); } }; fr.readAsArrayBuffer(f); };
  const restaurar = e => { const f = e.target.files[0]; if (!f) return; const fr = new FileReader(); fr.onload = () => { try { const d = JSON.parse(fr.result); if (!d.tareas || !d.cfg) throw 0; up(s => ({ ...d, usuarios: ses ? s.usuarios : (d.usuarios || s.usuarios), log: s.log })); ui.toast('Copia restaurada'); } catch (err) { ui.toast('Ese archivo no es una copia de ProducciónApp'); } }; fr.readAsText(f); e.target.value = ''; };
  return <PlCtx.Provider value={PL}><div className="view cfg"><div className="cfg-top"><span className="mut">Tocá el título de cada sección para abrirla o cerrarla.</span><span className="sp" /><button className="btn sm" onClick={() => setAb(CFG_SECS)}>Abrir todas</button><button className="btn sm" onClick={() => setAb([])}>Cerrar todas</button></div>
    <div className="card apar"><h3>Apariencia y horario</h3><div className="row"><span className="mut">Tema</span><div className="seg"><button className={tema === 'claro' ? '' : 'on'} onClick={() => cambiarTema('oscuro')}>☾ Oscuro</button><button className={tema === 'claro' ? 'on' : ''} onClick={() => cambiarTema('claro')} title="Mejor con mucha luz en el taller">☀ Claro</button></div></div>
      <div className="row"><span className="mut">Horario en uso</span><span className="tag">Horario de {tempAct} · {horAct.entrada}–{horAct.salida}</span></div></div>
    <Atajos />
    <ListEdit title="Operarios" items={S.operarios.slice().sort(porApellido)} addLabel="+ Operario" onAdd={() => up(s => ({ ...s, operarios: [...s.operarios, { id: E.uid(), nom: 'Nuevo', apellido: 'operario', nombre: 'Nuevo operario', activo: true }] }))}
      onDel={o => up(s => ({ ...s, operarios: s.operarios.filter(x => x.id !== o.id), ausencias: s.ausencias.filter(a => a.opId !== o.id), tareas: s.tareas.map(t => t.ops.includes(o.id) ? { ...t, ops: t.ops.filter(x => x !== o.id) } : t) }))}
      render={o => <><input aria-label="Apellido" placeholder="Apellido" key={'ap' + o.id + partesOp(o).ape} defaultValue={partesOp(o).ape} onBlur={e => e.target.value !== partesOp(o).ape && setOp(o, { ape: e.target.value.trim() })} /><input aria-label="Nombre" placeholder="Nombre" key={'no' + o.id + partesOp(o).nom} defaultValue={partesOp(o).nom} onBlur={e => e.target.value !== partesOp(o).nom && setOp(o, { nom: e.target.value.trim() })} /><label className="inl">Principal<select value={o.op1 || ''} onChange={e => setL('operarios', o.id, { op1: e.target.value })}><option value="">—</option>{S.operaciones.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></label><label className="inl">Secundaria<select value={o.op2 || ''} onChange={e => setL('operarios', o.id, { op2: e.target.value })}><option value="">—</option>{S.operaciones.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></label><label className="chk"><input type="checkbox" checked={o.activo} onChange={e => setL('operarios', o.id, { activo: e.target.checked })} /> Activo</label><label className="inl">Activo desde<input type="date" aria-label="Activo desde" value={o.desde || ''} onChange={e => setDisp(o, { desde: e.target.value })} /></label><label className="chk"><input type="checkbox" checked={!!o.ocasional} onChange={e => setDisp(o, { ocasional: e.target.checked })} /> Ocasional</label>{o.ocasional && <span className="mut">{(o.dias || []).filter(d => d >= E.today()).length} días próximos cargados</span>}</>} />
    <section className={'card' + PL.c('Días que viene (ocasionales)')}><div className="sec-h"><h2>{PL.h('Días que viene (ocasionales)')}</h2></div><DiasPicker S={S} onSet={setDisp} /></section>
    <section className={'card' + PL.c('Cargar ausencias (calendario)')}><div className="sec-h"><h2>{PL.h('Cargar ausencias (calendario)')}</h2></div><AusPicker S={S} onAdd={addAus} /></section>
    <section className={'card full' + PL.c('Calendario de ausencias')}><div className="sec-h"><h2>{PL.h('Calendario de ausencias')}</h2></div><AusResumen S={S} /></section>
    <section className={'card' + PL.c('Motivos de ausencia')}><div className="sec-h"><h2>{PL.h('Motivos de ausencia')}</h2></div><MotivosAusencia S={S} up={up} /></section>
    {/* Ausencias: los días en que falta un operario sus tareas no avanzan (se corren y ese día no suma horas). La fila nueva no tiene operario hasta que se elige. */}
    <ListEdit title="Ausencias" items={S.ausencias} addLabel="+ Ausencia" onAdd={() => up(s => ({ ...s, ausencias: [...s.ausencias, { id: E.uid(), opId: '', desde: E.today(), hasta: E.today(), motivo: 'Falta' }] }))}
      onDel={a => up(s => E.setAusencias(s, s.ausencias.filter(x => x.id !== a.id)))}
      render={a => <><select aria-label="Operario" value={a.opId} onChange={e => setAus(a.id, { opId: e.target.value })}><option value="">Elegí el operario</option>{S.operarios.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select>
        <input aria-label="Desde" type="date" value={a.desde} onChange={e => e.target.value && setAus(a.id, { desde: e.target.value, hasta: e.target.value > a.hasta ? e.target.value : a.hasta })} /><input aria-label="Hasta" type="date" value={a.hasta} min={a.desde} onChange={e => e.target.value && setAus(a.id, { hasta: e.target.value })} />
        <label className="inl" title="Opcional: hora en que se va el primer día (vacío = día entero)">Sale a las<input aria-label="Sale a las" type="time" value={a.desdeHora || ''} onChange={e => setAusH(a.id, 'desdeHora', e.target.value)} /></label><label className="inl" title="Opcional: hora en que llega o vuelve el último día (vacío = día entero)">Vuelve a las<input aria-label="Vuelve a las" type="time" value={a.hastaHora || ''} onChange={e => setAusH(a.id, 'hastaHora', e.target.value)} /></label>
        <select aria-label="Motivo" value={a.motivo} onChange={e => setL('ausencias', a.id, { motivo: e.target.value })}>{!E.motivosAus(S).some(m => m.nombre === a.motivo) && <option value={a.motivo}>{a.motivo}</option>}{E.motivosAus(S).map(m => <option key={m.id} value={m.nombre}>{m.nombre}</option>)}</select><span className="mot-sw" style={E.ausStyle(S, a)} />
        {resumenAus(a)}</>}
      rowClass={a => incluyeHoy(a) ? ' aus-hoy' : ''}
      nota="Los días de ausencia, las tareas de ese operario no avanzan: terminan más tarde y ese día no suma horas (tampoco en el cronómetro ni en Tiempos). Con «Sale a las» (el primer día) o «Vuelve a las» (el último día) se descuentan solo esas horas: sirve para un retiro antes, una salida parcial o una llegada tarde." />
    <ListEdit title="Operaciones" items={S.operaciones} addLabel="+ Operación" onAdd={() => up(s => ({ ...s, operaciones: [...s.operaciones, { id: E.uid(), nombre: 'Nueva operación' }] }))}
      onDel={o => up(s => ({ ...s, operaciones: s.operaciones.filter(x => x.id !== o.id) }))}
      render={(o, i) => <><label className="inl" title="Orden de fabricación: las de etapa menor se hacen primero. 0 = en paralelo: no espera a otras etapas ni las frena (las piezas que la necesitan igual esperan a sus hijas).">Etapa<input className="w4" type="number" min="0" aria-label="Etapa" value={E.etapaOp(o)} onChange={e => setL('operaciones', o.id, { etapa: e.target.value === '' ? null : Number(e.target.value) })} /></label><input aria-label="Nombre" value={o.nombre} onChange={e => setL('operaciones', o.id, { nombre: e.target.value })} />
        <label className="inl" title="Con qué tarifa de mano de obra se calcula el costo de esta operación">Tarifa<select aria-label="Tarifa" value={o.tarifaId || ''} onChange={e => setL('operaciones', o.id, { tarifaId: e.target.value })}><option value="">—</option>{(S.tarifas || []).map(t => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select></label>
        <label className="chk" title="Marcala en las máquinas automáticas (centro de mecanizado, router): un operario puede llevar a la vez una tarea de cada operación marcada. Dos tareas de la misma operación no se solapan, y las demás operaciones siguen de a una."><input type="checkbox" aria-label="Se puede solapar" checked={!!o.solapa} onChange={e => setL('operaciones', o.id, { solapa: e.target.checked })} />Se puede solapar</label>
        {E.etapaOp(o) === 0 && <span className="tag">en paralelo</span>}{o.solapa && <span className="tag">se solapa</span>}</>} />
    <section className={'card' + PL.c('Códigos de operación')}><div className="sec-h"><h2>{PL.h('Códigos de operación')}</h2><div className="row"><button className="btn" onClick={aplicarCod}>Aplicar a las piezas cargadas</button><button className="btn" onClick={() => up(s => ({ ...s, codigos: [...(s.codigos || []), { id: E.uid(), num: '', operacionId: s.operaciones[0] ? s.operaciones[0].id : '' }] }))}>+ Código</button></div></div>
      <p className="mut">En los códigos TPFR y TPFD, los 3 primeros números indican la operación. Al cargar o importar una pieza, la operación se completa sola y después la podés cambiar. El costo de la hora sale de la tarifa de cada operación (Configuración → Operaciones).</p>
      {(S.codigos || []).length === 0 && <p className="mut">Todavía no hay códigos cargados.</p>}
      {(S.codigos || []).slice().sort((a, b) => String(a.num).localeCompare(String(b.num))).map(c => <div key={c.id} className="lrow">
        <input aria-label="Número" className="w4" inputMode="numeric" maxLength="3" placeholder="000" value={c.num} onChange={e => setL('codigos', c.id, { num: e.target.value.replace(/\D/g, '').slice(0, 3) })} />
        <span className="mut">→</span><select aria-label="Operación" value={c.operacionId} onChange={e => setL('codigos', c.id, { operacionId: e.target.value })}>{S.operaciones.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select>
        {(S.codigos || []).filter(x => x.num && x.num === c.num).length > 1 && <span className="tag bad">número repetido</span>}
        <span className="sp" /><button className="btn sm danger" onClick={() => ui.confirmar({ titulo: '¿Borrar el código?', texto: `Se borra el código ${c.num || ''}. Podés deshacerlo arriba.`, si: 'Sí, borrar', peligro: true, onSi: () => up(s => ({ ...s, codigos: s.codigos.filter(x => x.id !== c.id) })) })}>Borrar</button></div>)}
      <div className="lrow prueba"><label className="inl">Probar un código<input value={prueba} placeholder="TPFR-120-045-01" onChange={e => setPrueba(e.target.value)} /></label>
        {prueba.trim() && (() => { const r = E.codOp(S, prueba); return <span className={r && r.operacionId ? 'c-ok' : 'c-bad'}>{!r ? 'No reconozco un código TPFR o TPFD con 3 números' : r.operacionId ? `${r.num} → ${operName(S, r.operacionId)}` : `${r.num} → sin operación asignada`}</span>; })()}</div></section>
    <ListEdit title="Tarifas de mano de obra" items={S.tarifas || []} addLabel="+ Tarifa" onAdd={() => up(s => ({ ...s, tarifas: [...(s.tarifas || []), { id: E.uid(), nombre: 'Tarifa nueva', valor: null, fecha: E.today() }] }))}
      onDel={t => up(s => ({ ...s, tarifas: s.tarifas.filter(x => x.id !== t.id), operaciones: s.operaciones.map(o => o.tarifaId === t.id ? { ...o, tarifaId: '' } : o) }))}
      extra={<span className="mut">Costo de la hora en USD. Cada operación se asocia a una tarifa.</span>}
      render={t => { const ops = S.operaciones.filter(o => o.tarifaId === t.id); return <><input aria-label="Nombre" value={t.nombre} onChange={e => setL('tarifas', t.id, { nombre: e.target.value })} />
        <label className="inl">USD/h<input aria-label="USD por hora" className="vh" type="number" min="0" step="0.5" value={t.valor ?? ''} placeholder="0" onChange={e => setL('tarifas', t.id, { valor: e.target.value === '' ? null : Number(e.target.value), fecha: E.today() })} /></label>
        <span className="mut fch">{t.valor > 0 ? 'al ' + fFecha(t.fecha) : ''}</span>
        <span className="mut tops-l">{ops.length ? ops.map(o => o.nombre).join(', ') : 'ninguna operación'}</span></>; }} />
    <ListEdit title="Materiales" items={S.materiales || []} addLabel="+ Material" onAdd={() => up(s => ({ ...s, materiales: [...(s.materiales || []), { id: E.uid(), nombre: 'Material nuevo', precio: null, fecha: E.today() }] }))}
      onDel={m => up(s => ({ ...s, materiales: s.materiales.filter(x => x.id !== m.id) }))}
      extra={<span className="mut">Precio por kg en USD. Es solo el respaldo: el costo de material sale del precio de cada ítem de StockApp (lo actualiza ComprasApp). Estos se usan mientras una pieza no tenga ítem de StockApp con precio.</span>}
      render={m => <><input aria-label="Nombre" value={m.nombre} onChange={e => setL('materiales', m.id, { nombre: e.target.value })} />
        <label className="inl">USD/kg<input aria-label="Precio por kg" className="vh" type="number" min="0" step="0.01" value={m.precio ?? ''} placeholder="0" onChange={e => setL('materiales', m.id, { precio: e.target.value === '' ? null : Number(e.target.value), fecha: E.today() })} /></label>
        <span className="mut fch">{m.precio > 0 ? 'al ' + fFecha(m.fecha) : ''}</span></>} />
    <CorteCfg />
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
        <label className="btn filebtn" title="Planilla de revisión con las hojas Importar, Tarifas y Materiales">Importar historial de tiempos (.xlsx)<input id="cfg-hist" type="file" accept=".xlsx,.xls" onChange={leerHist} /></label>
        {!ses && <button className="btn danger" onClick={() => { up(() => E.sample()); ui.toast('Datos de ejemplo restablecidos'); }}>Restablecer datos de ejemplo</button>}</div>
      <div className="blanco">{conf ? <><b>Se borran todas las tareas, proyectos, operarios, ausencias y horas extra.</b><span className="mut">Quedan las operaciones, los horarios, los feriados y los usuarios.</span>
        <div className="row"><button className="btn danger" onClick={() => { up(s => ({ ...s, ejemplo: false, tareas: [], proyectos: [], operarios: [], ausencias: [], extras: {}, extraModo: {} })); setConf(false); ui.toast('Lista para cargar tus datos. Si fue un error, tocá Deshacer.'); }}>Sí, empezar en blanco</button><button className="btn" onClick={() => setConf(false)}>Cancelar</button></div></>
        : <><button className="btn pri-b" onClick={() => setConf(true)}>Empezar en blanco con mis datos</button><span className="mut">Saca los datos de ejemplo para que cargues los tuyos.</span></>}</div>
      {(S.historico || []).length > 0 && <p className="mut">Historial importado: {S.historico.length} fabricaciones. Se ven en la pestaña Tiempos y Costos con origen "planilla".</p>}
      {imp && <ImportHist d={imp} onClose={() => setImp(null)} />}
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
      {!yoMismo && <button className="btn sm danger" onClick={() => ui.confirmar({ titulo: '¿Quitar el acceso?', texto: `${u.email || 'Este usuario'} ya no va a poder entrar a la app.`, si: 'Sí, quitar acceso', peligro: true, onSi: () => up(s => ({ ...s, usuarios: s.usuarios.filter(x => x.id !== u.id) })) })}>Quitar acceso</button>}</div>; })}
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
// Logo: tablero de producción con barras de Gantt
/* Accesos a las otras apps de trabajo: íconos reales (icon.svg de cada repositorio) dibujados acá para que funcionen sin conexión */
const IcStock = () => <svg viewBox="0 0 512 512" aria-hidden="true"><defs><radialGradient id="ha-sb" cx="30%" cy="15%" r="95%"><stop offset="0" stopColor="#22303d" /><stop offset="1" stopColor="#12161b" /></radialGradient><linearGradient id="ha-st" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#9fcdf3" /><stop offset="1" stopColor="#6fb1e8" /></linearGradient></defs><rect width="512" height="512" fill="url(#ha-sb)" /><g strokeLinejoin="round"><path d="M256 112l136 74-136 74-136-74z" fill="url(#ha-st)" /><path d="M120 186l136 74v158l-136-74z" fill="#2c4a66" /><path d="M392 186l-136 74v158l136-74z" fill="#1f364c" /><path d="M256 112l136 74v158l-136 74-136-74V186z M120 186l136 74 136-74 M256 260v158" fill="none" stroke="#cfe6fa" strokeWidth="10" strokeOpacity=".55" /><path d="M152 264l70 38M152 304l70 38M152 344l46 25" stroke="#6fb1e8" strokeWidth="16" strokeLinecap="round" /><path d="M300 318l26 26 44-58" fill="none" stroke="#4cc38a" strokeWidth="18" strokeLinecap="round" /></g></svg>;
const IcCompras = () => <svg viewBox="0 0 512 512" aria-hidden="true"><defs><linearGradient id="ha-cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#253040" /><stop offset="1" stopColor="#121820" /></linearGradient><linearGradient id="ha-ca" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#8fd0ff" /><stop offset="1" stopColor="#3d9be8" /></linearGradient></defs><rect width="512" height="512" rx="112" fill="url(#ha-cg)" /><path d="M156 84h140l96 96v224a24 24 0 0 1-24 24H156a24 24 0 0 1-24-24V108a24 24 0 0 1 24-24z" fill="#1c232b" stroke="#3d4a5a" strokeWidth="10" strokeLinejoin="round" /><path d="M296 84v72a24 24 0 0 0 24 24h72" fill="none" stroke="#3d4a5a" strokeWidth="10" strokeLinejoin="round" /><rect x="170" y="214" width="184" height="34" rx="13" fill="url(#ha-ca)" /><rect x="170" y="274" width="134" height="34" rx="13" fill="#efc145" /><rect x="170" y="334" width="92" height="34" rx="13" fill="#ff6f61" /><circle cx="372" cy="392" r="66" fill="#141a22" stroke="#3fca8b" strokeWidth="12" /><path d="M342 394l22 22 40-48" fill="none" stroke="#3fca8b" strokeWidth="18" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const Hermanas = () => <span className="happs"><a className="happ" href="https://landinife.github.io/StockApp/" target="_blank" rel="noopener" title="Abrir StockApp" aria-label="Abrir StockApp"><IcStock /></a><a className="happ" href="https://landinife.github.io/ComprasApp/" target="_blank" rel="noopener" title="Abrir ComprasApp" aria-label="Abrir ComprasApp"><IcCompras /></a></span>;
const Logo = () => <svg className="logo" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 4.5h17v15h-17zM3.5 8.5h17" /><rect x="6" y="10.6" width="7" height="1.8" rx=".9" /><rect x="10" y="13.4" width="8" height="1.8" rx=".9" /><rect x="7.5" y="16.2" width="5" height="1.8" rx=".9" /></svg>;
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

/* ================= IMPORTAR HISTORIAL DE TIEMPOS ================= */
// Lee la planilla de revisión (hojas Importar, Tarifas y Materiales). De "Importar" toma solo las filas con Estado = Importar.
const CATS_HIST = [['HH Mecanizado', 'Mecanizado'], ['HH Corte Láser', 'Corte Láser'], ['HH Armado y Soldado', 'Armado y Soldado'], ['HH Ensamble', 'Ensamble']];
const xFecha = v => { if (v instanceof Date && !isNaN(v)) return new Date(v.getTime() + 12 * 36e5).toISOString().slice(0, 10); const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(String(v).trim()); return m ? `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : ''; };
const xNum = v => { if (typeof v === 'number') return v; const n = Number(String(v).replace(',', '.')); return String(v).trim() !== '' && isFinite(n) ? n : null; };
function leerPlanillaHist(wb) {
  const X = window.XLSX, hoja = n => wb.Sheets[wb.SheetNames.find(x => x.trim().toLowerCase() === n.toLowerCase())];
  const H = hoja('Importar'); if (!H) throw new Error('El archivo no tiene la hoja "Importar". Usá la planilla de revisión de tiempos.');
  const rows = X.utils.sheet_to_json(H, { defval: '' });
  if (!rows.length || !('Estado' in rows[0]) || !('Código' in rows[0])) throw new Error('La hoja "Importar" no tiene las columnas esperadas (Estado, Código, …).');
  const filas = rows.filter(r => String(r.Estado).trim().toLowerCase() === 'importar').map(r => {
    const cats = {}; CATS_HIST.forEach(([col, n]) => { const h = xNum(r[col]); if (h > 0) cats[n] = h; });
    return { fila: r['Fila Datos'], nombre: `${String(r['Código']).trim()} ${String(r['Descripción']).trim()}`.trim(), cant: xNum(r['Cant.']) || 1, fecha: xFecha(r.Fecha),
      opsTxt: String(r.Operarios || '').trim(), mat: String(r['Materia prima'] || '').trim(), kg: xNum(r['kg MP']), cats, obs: String(r.Observaciones || '').trim() };
  }).filter(f => f.nombre && Object.keys(f.cats).length);
  const T = hoja('Tarifas'), M = hoja('Materiales');
  const tarifas = T ? X.utils.sheet_to_json(T, { defval: '' }).map(r => ({ nombre: String(r['Categoría de mano de obra'] || '').trim(), valor: xNum(r['USD/h']) })).filter(t => t.nombre) : [];
  const materiales = M ? X.utils.sheet_to_json(M, { defval: '' }).map(r => ({ nombre: String(r['Materia prima'] || '').trim(), precio: xNum(r['USD/kg']), fecha: xFecha(r['Fecha del precio']) })).filter(m => m.nombre) : [];
  return { filas, tarifas, materiales };
}
// Arma el estado nuevo: tarifas y materiales (actualiza por nombre o agrega), operaciones sin tarifa vinculadas solas, y el historial (reemplaza el importado antes)
function aplicarHist(s, d) {
  const eq = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase(), hoy = E.today();
  let tarifas = [...(s.tarifas || [])]; const tN = [], tA = [];
  [...d.tarifas, ...CATS_HIST.map(([, n]) => ({ nombre: n, valor: null }))].forEach(t => { const x = tarifas.find(y => eq(y.nombre, t.nombre));
    if (!x) { tarifas.push({ id: E.uid(), nombre: t.nombre, valor: t.valor, fecha: hoy }); tN.push(t.nombre); }
    else if (t.valor != null && Number(x.valor) !== t.valor) { tarifas = tarifas.map(y => y === x ? { ...y, valor: t.valor, fecha: hoy } : y); tA.push(t.nombre); } });
  let materiales = [...(s.materiales || [])]; const mN = [], mA = [];
  [...d.materiales, ...d.filas.filter(f => f.mat).map(f => ({ nombre: f.mat, precio: null, fecha: '' }))].forEach(m => { const x = materiales.find(y => eq(y.nombre, m.nombre));
    if (!x) { materiales.push({ id: E.uid(), nombre: m.nombre, precio: m.precio, fecha: m.fecha || hoy }); mN.push(m.nombre); }
    else if (m.precio != null && Number(x.precio) !== m.precio) { materiales = materiales.map(y => y === x ? { ...y, precio: m.precio, fecha: m.fecha || hoy } : y); mA.push(m.nombre); } });
  const s1 = { ...s, tarifas }; const vinc = [];
  const operaciones = s.operaciones.map(o => { if (o.tarifaId && tarifas.some(t => t.id === o.tarifaId)) return o; const t = E.tarifaSugerida(s1, o.nombre); if (!t) return o; vinc.push(`${o.nombre} → ${t.nombre}`); return { ...o, tarifaId: t.id }; });
  const idT = n => tarifas.find(t => eq(t.nombre, n)).id, idM = n => (materiales.find(m => eq(m.nombre, n)) || {}).id || '';
  const nuevos = d.filas.map(f => { const hhCat = {}; Object.entries(f.cats).forEach(([n, h]) => { hhCat[idT(n)] = h; });
    return { id: E.uid(), src: 'planilla', fila: f.fila, nombre: f.nombre, cant: f.cant, fecha: f.fecha, opsTxt: f.opsTxt, material: f.mat ? idM(f.mat) : '', peso: f.kg, hh: Object.values(f.cats).reduce((a, h) => a + h, 0), hhCat,
      det: Object.entries(f.cats).map(([n, h]) => `${n} ${fN(h)} h`).join(' · '), obs: f.obs, tiempoFuera: false }; });
  const antes = (s.historico || []).filter(h => h.src === 'planilla').length;
  const historico = [...(s.historico || []).filter(h => h.src !== 'planilla'), ...nuevos];
  return { S: { ...s, tarifas, materiales, operaciones, historico }, info: { tN, tA, mN, mA, vinc, antes, n: nuevos.length, piezas: new Set(nuevos.map(h => E.claveCod(h.nombre))).size, hh: nuevos.reduce((a, h) => a + h.hh, 0),
    sinPrecio: materiales.filter(m => !(Number(m.precio) > 0) && nuevos.some(h => h.material === m.id)).map(m => m.nombre) } };
}
function ImportHist({ d, onClose }) {
  const { S, up, ui } = useApp(); const { info } = useMemo(() => aplicarHist(S, d), [S, d]);
  const ok = () => { up(s => aplicarHist(s, d).S); ui.toast(`Historial importado: ${info.n} fabricaciones. Lo ves en la pestaña Tiempos y Costos.`); onClose(); };
  const L = (t, l) => l.length > 0 && <p><b>{t}:</b> {l.join(', ')}</p>;
  return <Modal title="Importar historial de tiempos" onClose={onClose} foot={<><span className="mut">{d.archivo}</span><span className="sp" /><button className="btn canc-b" onClick={onClose}>Cancelar</button><button className="btn pri-b" disabled={!info.n} onClick={ok}>Importar</button></>}>
    <div className="imph">
      <div className="cotres"><div><span className="mut">Fabricaciones</span><b>{info.n}</b><small className="mut">filas con Estado = Importar</small></div>
        <div><span className="mut">Piezas</span><b>{info.piezas}</b><small className="mut">códigos distintos</small></div>
        <div><span className="mut">Horas</span><b>{fN(Math.round(info.hh))}</b><small className="mut">horas en total</small></div></div>
      {info.antes > 0 && <p className="note">Ya había {info.antes} fabricaciones importadas de una planilla: se reemplazan por estas. Las tareas de la app no se tocan.</p>}
      {L('Tarifas nuevas', info.tN)}{L('Tarifas actualizadas', info.tA)}{L('Materiales nuevos', info.mN)}{L('Materiales con precio actualizado', info.mA)}
      {L('Operaciones que se vinculan a una tarifa', info.vinc)}
      {info.sinPrecio.length > 0 && <p className="mut">Sin precio por kg (completalos en Configuración → Materiales): {info.sinPrecio.join(', ')}.</p>}
      <p className="mut">Las fabricaciones importadas cuentan en el promedio por unidad. Si alguna está mal cargada, la podés descartar o borrar desde Tiempos.</p>
    </div>
  </Modal>;
}

/* ================= MATERIAL (cruce con StockApp, solo lectura) ================= */
// Ficha de la pieza: se conserva mientras tenga algún dato (material y peso para el costo; ítem, largo o chapa para el aviso de material)
const conFicha = (s, k, patch) => { const f = { ...((s.fichas || {})[k] || {}), ...patch }, fs = { ...(s.fichas || {}) };
  Object.keys(f).forEach(x => { if (f[x] === '' || f[x] === null || f[x] === undefined || f[x] === false) delete f[x]; });
  if (!Object.keys(f).length) delete fs[k]; else fs[k] = f; return { ...s, fichas: fs }; };
// Familias de tiempo: sumar piezas a una familia (nueva si fam no tiene id) o sacarlas (famId vacío)
const ponFam = (s, ks, famId) => ks.reduce((a, k) => conFicha(a, k, { familia: famId || '' }), s);
const nuevaFam = (s, nombre, ficha, tipo, extra) => { const id = E.uid(); return [{ ...s, familias: [...(s.familias || []), { id, nombre: nombre.trim(), ...(tipo === 'union' ? { tipo, ...(extra || {}) } : {}), ...(ficha ? { ficha } : {}) }] }, id]; };
// familias por unión (25/11): texto "0:20 por unión × 6 uniones" y elegir el tipo al crear una familia
const unTxt = h => h && h.porUnion != null ? ` (${fHM(h.porUnion)} por unión × ${h.uniones} ${h.uniones === 1 ? 'unión' : 'uniones'}${h.base ? ', con base medida' : ''})` : '';
// base medida de una familia por unión: "base 0,83 h × 3 + 2 medidas (0,75 h)"
const fH2 = v => (Number(v) || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 });
const baseTxt = fu => !fu ? '' : fu.base ? `base ${fH2(fu.base)} h × ${fu.basePeso}${fu.n ? ` + ${fu.n} ${fu.n === 1 ? 'medida' : 'medidas'} (${fH2(fu.medido)} h)` : ', sin medidas todavía'}` : `${fu.n} ${fu.n === 1 ? 'vez' : 'veces'}`;
const TIPOS_FAM = [['', 'Por pieza', 'el mismo tiempo por unidad'], ['union', 'Por unión (Per joint)', 'tiempo por unión soldada × uniones de cada pieza']];
function TipoFam({ v, set }) { return <div className="fichad-tipo" role="radiogroup" aria-label="Tipo de familia">{TIPOS_FAM.map(([x, l, d]) => <label key={x} className={'togb' + (v === x ? ' on' : '')} title={d}><input type="radio" name="tipofam" checked={v === x} onChange={() => set(x)} hidden />{l}</label>)}</div>; }
const fichaFam = f => { const b = {}; ['stockId', 'chapa', 'noMat', 'material'].forEach(x => { if (f[x]) b[x] = f[x]; }); if (f.corteU != null && f.corteU !== '') b.corteU = Number(f.corteU); return Object.keys(b).length ? b : null; };
// "¿Es de la familia X?": sugerencia para una pieza sin familia; solo la acepta un administrador
function SugFam({ k, nombre, chico }) {
  const { S, up, ui, pm } = useApp(); const sg = useMemo(() => k ? E.sugerirFamilia(S, k, nombre) : null, [k, nombre, S.fichas, S.familias]);
  if (!sg) return null; const h = E.historial(S, sg.como);
  return <small className={'hint sugfam' + (chico ? ' chico' : '')}>¿Es de la familia <b>{sg.fam.nombre}</b>?{E.porUnion(sg.fam) ? (() => { const fu = E.famUnion(S, sg.fam); return fu && fu.porUnion != null ? ` Lleva ${fHM(fu.porUnion)} por unión.` : ' Es por unión.'; })() : h ? ` Lleva ${fHM(h.porUnidad)} por unidad.` : ''} {pm.admin && <button type="button" className="lnk sm" onClick={e => { e.stopPropagation(); up(s => ponFam(s, [k], sg.fam.id)); ui.toast(`Sumada a la familia ${sg.fam.nombre}`); }}>Sumar a la familia</button>}</small>;
}
const fQ = q => (Math.round((Number(q) || 0) * 1000) / 1000).toLocaleString('es-AR');
const uIt = it => (it && it.unidad) || 'un';
const nomIt = it => it ? `${it.codigo ? it.codigo + ' · ' : ''}${it.descripcion || 'Ítem sin nombre'}` : '';
const EST_MAT = { falta: ['No alcanza', 'var(--bad)'], res: ['Usa material reservado', 'var(--warn)'], ok: ['Alcanza', 'var(--ok)'] };
// precio de StockApp de una ficha: "0,551 m × US$ 21,50/m · OC 0153 · 20/11/26" (y de cuántos $ salió si estaba en pesos)
const fMs = n => n ? new Date(n).toISOString().slice(0, 10) : '';
const precioTxt = ms => !ms || ms.usdU == null ? '' : `${fQ(ms.q)} ${ms.u} × ${fPlata(ms.pu)}/${ms.u}${ms.pr.ars ? ` (de $ ${fN(ms.pr.ars)} con dólar ${fN(ms.pr.dolar)})` : ''}${ms.pr.oc ? ' · ' + ms.pr.oc : ms.pr.mano ? ' · cargado a mano' : ''}${ms.pr.fecha ? ' · ' + fFecha(fMs(ms.pr.fecha)) : ''}`;
const consTxt = c => !c ? '' : c.modo === 'm' ? `${fN(c.L)} mm + ${fN(c.c)} mm de corte` : c.modo === 'barra' ? `${fN(c.L)} + ${fN(c.c)} mm de una barra de ${fN(c.lb)} mm` : c.modo === 'kg' ? 'peso por unidad de la ficha' : c.modo === 'man' ? 'escrito a mano' : '1 por pieza';
function dondeMat(S, V, p) { const t = V.byId[p.id]; if (!t) return '—'; if (p.tipo === 'rep') { const r = V.rootOf(t); return `${r.orden || 'S/N'} · ${r.cliente || ''}`; } const pr = S.proyectos.find(x => x.id === p.proyId); return pr ? pr.nombre : 'Proyecto'; }

// botón del encabezado: cantidad de ítems que no alcanzan (rojo) o que usan material reservado (ámbar)
function MatBtn() {
  const { stock, NE, ui } = useApp(); if (!stock) return null;
  const f = NE ? NE.n.falta : 0, r = NE ? NE.n.res : 0, sf = NE ? new Set(NE.sinFicha.map(p => p.k)).size : 0;
  const cls = stock.error ? 'gris' : f ? 'bad' : r ? 'warn' : 'ok';
  const tit = stock.error ? 'Material: no se puede leer el stock de StockApp con este usuario' : `Material para lo que falta fabricar: ${f} ${f === 1 ? 'ítem no alcanza' : 'ítems no alcanzan'}, ${r} ${r === 1 ? 'usa' : 'usan'} material reservado${sf ? `, ${sf} ${sf === 1 ? 'pieza' : 'piezas'} sin ficha` : ''}`;
  return <button className={'btn matb ' + cls} onClick={() => ui.modal({ k: 'material' })} title={tit} aria-label={tit}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h18M3 12h18M3 17h18M6 5v4M10 10v4M15 15v4" /></svg><b>{stock.error ? '—' : f || r || '✓'}</b></button>;
}
// Alerta flotante cuando algún ítem no alcanza: aparece sobre la app hasta que la veas o la pospongas.
// "Ahora no" la oculta hasta mañana o hasta que se sume otro ítem que no alcanza.
const MAT_AL_K = 'produccionapp-mat-alerta';
function MatAlerta() {
  const { NE, ui } = useApp(); const [, rep] = useState(0);
  if (!NE || !NE.n.falta) return null;
  const fl = NE.L.filter(r => r.est === 'falta'), sig = fl.map(r => r.it.id).sort().join('|'), hoy = E.today();
  let g = {}; try { g = JSON.parse(localStorage.getItem(MAT_AL_K) || '{}'); } catch (e) { }
  const vistos = new Set((g.sig || '').split('|'));
  if (g.dia === hoy && fl.every(r => vistos.has(r.it.id))) return null;
  const posponer = () => { try { localStorage.setItem(MAT_AL_K, JSON.stringify({ sig, dia: hoy })); } catch (e) { } rep(x => x + 1); };
  return <div className="matal" role="alert">
    <div className="matal-h"><span className="matal-ic" aria-hidden="true">!</span><b>Falta material</b><button className="btn ghost sm" onClick={posponer} aria-label="Cerrar la alerta">✕</button></div>
    <p>{fl.length === 1 ? 'Un ítem no alcanza' : `${fl.length} ítems no alcanzan`} para lo que está cargado para fabricar, aunque se use lo reservado:</p>
    <ul>{fl.slice(0, 4).map(r => <li key={r.it.id}><b>{nomIt(r.it)}</b> · faltan {fQ(r.nec - r.stock)} {uIt(r.it)}{r.ped ? ' · pedido en curso' : ''}</li>)}{fl.length > 4 && <li className="mut">y {fl.length - 4} más</li>}</ul>
    <div className="matal-b"><button className="btn" onClick={posponer}>Ahora no</button><button className="btn danger-b" onClick={() => { posponer(); ui.modal({ k: 'material' }); }}>Ver detalle</button></div>
  </div>;
}
function MaterialDlg({ onClose }) { return <Modal title="Material para lo que falta fabricar" wide onClose={onClose}><MaterialVista /></Modal>; }
// tarjeta plegable de Producción: solo los ítems con problemas y lo que falta cargar
function MaterialCard() {
  const { stock, NE, ui, pm } = useApp(); const [ab, setAb] = useState(() => prefG('mat-card', true)); const tog = () => { setAb(!ab); guardaG('mat-card', !ab); };
  if (!stock || !(pm.admin || pm.rep || pm.proy)) return null;
  return <section className="card matc"><div className="sec-h"><button className="dgrp-t" aria-expanded={ab} onClick={tog}><span className="car">{ab ? '▾' : '▸'}</span><h2>Material</h2></button>
    <div className="row"><button className="btn sm" onClick={() => ui.modal({ k: 'material' })}>Ver todo</button></div></div>
    {ab && <MaterialVista corta />}</section>;
}
function MaterialVista({ corta }) {
  const { S, V, ui, pm, stock, NE } = useApp(); const [fil, setFil] = useState('prob'); const [ab, setAb] = useState([]); const [imp, setImp] = useState(null); const [verSF, setVerSF] = useState(false);
  if (!stock) return null;
  if (stock.error) return <p className="note">{stock.error === 'sinacceso' ? 'Con este usuario no se puede leer el stock de StockApp. Para ver el aviso de material, pedí que te agreguen como usuario en StockApp (alcanza con un usuario de consulta).' : 'No se pudo leer el stock de StockApp: ' + (stock.msg || 'error de conexión')}</p>;
  if (!NE) return <p className="mut">Leyendo el stock de StockApp…</p>;
  const tog = id => setAb(a => a.includes(id) ? a.filter(x => x !== id) : [...a, id]);
  const L = NE.L.filter(r => fil === 'todo' || (fil === 'prob' ? r.est !== 'ok' : r.est === fil));
  const agrupa = l => { const m = new Map(); l.forEach(p => { let x = m.get(p.k); if (!x) { x = { k: p.k, nombre: p.nombre, cant: 0, donde: new Set(), it: p.it }; m.set(p.k, x); } x.cant += p.cant; x.donde.add(dondeMat(S, V, p)); }); return [...m.values()].sort((a, b) => a.k.localeCompare(b.k)); };
  const SF = agrupa(NE.sinFicha), SC = agrupa(NE.sinConsumo), NI = agrupa(NE.noIt);
  const cargar = x => ui.ficha({ key: x.k, nombre: x.nombre });   // se abre encima: al cerrarla sigue la ventana de material
  const lista = (tit, l, txt) => l.length > 0 && <div className="matsf"><b>{tit} <small className="mut">{l.length}</small></b><span className="mut">{txt}</span>
    <div className="matsf-l">{(verSF || corta ? l.slice(0, corta ? 6 : 999) : l.slice(0, 12)).map(x => <div key={x.k} className="matsf-f"><span><b>{x.nombre}</b><small className="mut"> · {fN(x.cant)} u. · {[...x.donde].join(', ')}</small></span>{pm.admin && <button className="btn sm" onClick={() => cargar(x)}>Cargar ficha</button>}</div>)}</div>
    {!corta && !verSF && l.length > 12 && <button className="lnk" onClick={() => setVerSF(true)}>Ver las {l.length}</button>}{corta && l.length > 6 && <span className="mut">y {l.length - 6} más (Ver todo)</span>}</div>;
  // planilla para completar: todas las piezas pendientes (una fila por código) con lo que ya tienen cargado, más la lista de ítems de StockApp
  const planilla = () => { if (!window.XLSX) { ui.toast('No se pudo cargar el generador de Excel'); return; } const X = window.XLSX, wb = X.utils.book_new(), IT = new Map(stock.items.map(i => [i.id, i]));
    const todas = agrupa([...NE.sinFicha, ...NE.sinConsumo, ...NE.noIt, ...NE.chapa, ...NE.L.flatMap(r => r.piezas)]);
    const filas = todas.map(x => { const f = E.fichaDe(S, x.k) || {}, it = IT.get(f.stockId); return { 'Código': x.k.toUpperCase(), 'Descripción': x.nombre.replace(/^TPF[\w\-./]*\s*/i, ''), 'Ítem StockApp': it ? it.codigo || '' : '', 'Largo plano (mm)': f.largoU ?? '', 'Corte (mm)': f.corteU ?? '', 'Chapa (nesting)': f.chapa ? 'Sí' : '', 'Sin material': f.noMat ? 'Sí' : '', 'Cant. pendiente': x.cant }; });
    X.utils.book_append_sheet(wb, X.utils.json_to_sheet(filas), 'Fichas');
    X.utils.book_append_sheet(wb, X.utils.json_to_sheet([...stock.items].sort((a, b) => (a.codigo || '').localeCompare(b.codigo || '')).map(i => ({ 'Código': i.codigo || '', 'Descripción': i.descripcion || '', Formato: i.formato || '', Unidad: i.unidad || '', Stock: i.stock }))), 'Ítems StockApp');
    saveFile(`fichas-material-${E.today()}.xlsx`, X.write(wb, { type: 'array', bookType: 'xlsx' }), ui.toast); };
  const leer = e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; if (!window.XLSX) { ui.toast('No se pudo cargar el lector de Excel'); return; }
    const fr = new FileReader(); fr.onload = () => { try { const wb = window.XLSX.read(fr.result, { type: 'array' }); const h = wb.Sheets[wb.SheetNames.find(n => n.trim().toLowerCase() === 'fichas') || wb.SheetNames[0]];
      setImp({ archivo: f.name, rows: window.XLSX.utils.sheet_to_json(h, { defval: '' }) }); } catch (err) { ui.toast('No se pudo leer el archivo. Tiene que ser .xlsx'); } }; fr.readAsArrayBuffer(f); };
  const n = NE.n;
  return <div className="matv">
    <div className="matk">
      <button className={'matk-i bad' + (fil === 'falta' ? ' on' : '')} onClick={() => setFil(fil === 'falta' ? 'prob' : 'falta')}><b>{n.falta}</b><span>No alcanza</span></button>
      <button className={'matk-i warn' + (fil === 'res' ? ' on' : '')} onClick={() => setFil(fil === 'res' ? 'prob' : 'res')}><b>{n.res}</b><span>Usa material reservado</span></button>
      <button className={'matk-i ok' + (fil === 'ok' ? ' on' : '')} onClick={() => setFil(fil === 'ok' ? 'prob' : 'ok')}><b>{n.ok}</b><span>Alcanza</span></button>
      <div className="matk-i gris"><b>{SF.length + SC.length + NI.length}</b><span>{SF.length + SC.length + NI.length === 1 ? 'Pieza sin verificar' : 'Piezas sin verificar'}</span></div>
    </div>
    {!corta && <p className="mut">Cuenta las piezas pendientes y próximas a realizar: cantidad × consumo por unidad (largo del plano + corte de serrucho). Las que ya están En proceso no suman: se toma que su material ya salió del depósito{NE.enCurso ? ` (hoy son ${NE.enCurso}; si alguna no tiene el egreso cargado en StockApp, el stock real es menor)` : ''}. No entran las piezas de chapa ({new Set(NE.chapa.map(p => p.k)).size}), que se controlan con el nesting, las marcadas "no consume material" ({NE.noMat}) ni las tercerizadas. Libre = stock − reservado en StockApp.</p>}
    {!corta && <div className="togs tops"><button className={'togb' + (fil === 'prob' ? ' on' : '')} onClick={() => setFil('prob')}>Con problemas <small>{n.falta + n.res}</small></button><button className={'togb' + (fil === 'todo' ? ' on' : '')} onClick={() => setFil('todo')}>Todos <small>{NE.L.length}</small></button></div>}
    {L.length === 0 ? <Vacio chico ic="ok" t={NE.L.length ? (fil === 'prob' ? 'Alcanza el material para todo lo cargado' : 'Ningún ítem en este grupo') : 'Todavía no hay piezas con ficha de material'}>{NE.L.length ? 'Según el stock actual de StockApp y las fichas cargadas.' : 'Cargá en cada pieza el ítem de StockApp y el largo del plano.'}</Vacio>
      : <div className="scroll"><table className="tt tmat"><thead><tr><th>Estado</th><th>Ítem de StockApp</th><th className="num">Necesita</th><th className="num">Stock</th><th className="num">Reservado</th><th className="num">Libre</th><th className="num">Diferencia</th></tr></thead>
        <tbody>{L.map(r => { const u = uIt(r.it), on = ab.includes(r.it.id); return <React.Fragment key={r.it.id}>
          <tr className={'matr ' + r.est} onClick={() => tog(r.it.id)}><td><span className="matdot" style={{ background: EST_MAT[r.est][1] }} />{EST_MAT[r.est][0]}</td>
            <td><span className="car">{on ? '▾' : '▸'}</span> <b>{nomIt(r.it)}</b>{r.ped && <span className="tag">pedido en curso</span>}<small className="mut"> · {r.piezas.length} {r.piezas.length === 1 ? 'pieza' : 'piezas'}</small></td>
            <td className="num" data-l="Necesita"><b>{fQ(r.nec)}</b> {u}</td><td className="num" data-l="Stock">{fQ(r.stock)}</td><td className="num" data-l="Reservado">{r.res ? fQ(r.res) : '—'}</td><td className="num" data-l="Libre">{fQ(r.libre)}</td>
            <td className={'num ' + (r.dif < 0 ? 'c-bad' : 'c-ok')} data-l="Diferencia"><b>{r.dif > 0 ? '+' : ''}{fQ(r.dif)}</b> {u}</td></tr>
          {on && <tr className="matdet"><td colSpan={7}>
            {r.est === 'res' && <p className="note">Alcanza solo usando material reservado en StockApp: {(r.it.reservas || []).map(x => `${fQ(x.cantidad)} ${u} para ${x.destino}`).join(' · ')}. Faltan {fQ(r.nec - r.libre)} {u} de material libre: si lo usás, hay que reponerlo.</p>}
            {r.est === 'falta' && <p className="note bad">Faltan {fQ(r.nec - r.stock)} {u} aunque se use todo lo reservado.{r.ped ? ' Hay un pedido en curso en StockApp.' : ''}</p>}
            <table className="tt tdg"><thead><tr><th>Pieza</th><th>Dónde</th><th>Estado</th><th className="num">Cant.</th><th>Consumo por unidad</th><th className="num">Total</th>{pm.admin && <th></th>}</tr></thead>
              <tbody>{r.piezas.map(p => <tr key={p.id}><td>{p.nombre}</td><td>{dondeMat(S, V, p)}</td><td className="mut">{p.estado === 'proximo' ? 'próximo a realizar' : 'pendiente'}</td><td className="num">{fN(p.cant)}</td><td>{fQ(p.c.q)} {u} <small className="mut">({consTxt(p.c)})</small></td><td className="num"><b>{fQ(p.tot)}</b> {u}</td>
                {pm.admin && <td><button className="btn sm" onClick={() => cargar(p)}>Ficha</button></td>}</tr>)}</tbody></table></td></tr>}
        </React.Fragment>; })}</tbody></table></div>}
    {lista('Piezas sin ficha de material', SF, 'Pendientes sin ítem de StockApp: no se puede saber si alcanza el material. Si una pieza no consume material de stock (plegado, pulido, armado…), marcalo en su ficha y deja de aparecer acá.')}
    {lista('Falta el largo', SC, 'Tienen el ítem pero no el largo del plano (o el peso, si el ítem va en kg).')}
    {lista('El ítem ya no existe en StockApp', NI, 'Se borró en StockApp: elegí otro en la ficha.')}
    {!corta && pm.admin && <div className="row matimp"><button className="btn" onClick={planilla} title="Planilla con todas las piezas pendientes para completar ítem y largo en Excel">Descargar planilla para completar (.xlsx)</button>
      <label className="btn">Importar fichas (.xlsx)<input type="file" accept=".xlsx,.xls" hidden onChange={leer} /></label></div>}
    {imp && <ImportFichas d={imp} onClose={() => setImp(null)} />}
  </div>;
}
// Importar fichas: columnas Código, Ítem StockApp (código de StockApp), Largo plano (mm), Corte (mm), Chapa (nesting) y Sin material. Solo cambia esos datos de la ficha.
// Lee la hoja Fichas (filas como objetos por título de columna). Columnas por el comienzo del título: Código, Ítem, Largo, Corte, Chapa, Sin material / No consume.
// Celda vacía = no se toca lo que ya tenía la ficha; "Sí" / "No" marcan o desmarcan. Devuelve solo las piezas en las que algo cambia (cambian) y cuántas ya estaban iguales.
function leerFichas(S, rows, items) {
  const IT = items ? new Map(items.map(i => [(i.codigo || '').trim().toUpperCase(), i])) : null, col = (r, ...ns) => { const k = Object.keys(r).find(x => ns.some(n => x.trim().toLowerCase().startsWith(n))); return k ? r[k] : ''; };
  const ok = [], err = [], vistos = new Set(); let iguales = 0, sinStock = 0;
  rows.forEach((r, i) => { const cod = String(col(r, 'código', 'codigo')).trim(); if (!cod) return; const k = E.claveCod(cod), ic = String(col(r, 'ítem', 'item')).trim().toUpperCase();
    const sn = v => { const x = String(v).trim(); return !x ? null : /^(s[ií]|x|1|true)$/i.test(x); }, largo = xNum(col(r, 'largo')), corte = xNum(col(r, 'corte')), chapa = sn(col(r, 'chapa')), noMat = sn(col(r, 'sin material', 'no consume'));
    if (!ic && largo == null && corte == null && chapa == null && noMat == null) return;
    let it = null; if (ic) { if (!IT) sinStock++; else { it = IT.get(ic); if (!it) { err.push(`Fila ${i + 2}: ${cod} → el ítem ${ic} no existe en StockApp`); return; } } }
    const ant = E.fichaDe(S, k) || {};
    const patch = { ...(it ? { stockId: it.id } : {}), ...(largo != null ? { largoU: largo } : {}), ...(corte != null ? { corteU: corte } : {}), ...(chapa != null ? { chapa } : {}), ...(noMat != null ? { noMat } : {}) };
    if (!Object.keys(patch).length) return;
    if (vistos.has(k)) return; vistos.add(k);
    if (Object.keys(patch).every(x => (ant[x] ?? (x === 'chapa' || x === 'noMat' ? false : null)) === patch[x])) { iguales++; return; }   // ya estaba igual: no se repite
    ok.push({ k, cod, patch, it, ya: !!(ant.stockId || ant.largoU || ant.chapa || ant.noMat) }); });
  return { ok, err, iguales, sinStock };
}
function ImportFichas({ d, onClose }) {
  const { S, up, ui, stock } = useApp();
  const R = useMemo(() => leerFichas(S, d.rows, stock && stock.items), [d, stock, S.fichas]);
  const aplicar = () => { up(s => R.ok.reduce((a, x) => conFicha(a, x.k, x.patch), s)); ui.toast(`Fichas actualizadas: ${R.ok.length} ${R.ok.length === 1 ? 'pieza' : 'piezas'}`); onClose(); };
  return <Modal title="Importar fichas de material" onClose={onClose} foot={<><span className="mut">{d.archivo}</span><span className="sp" /><button className="btn canc-b" onClick={onClose}>Cancelar</button><button className="btn pri-b" disabled={!R.ok.length} onClick={aplicar}>Aplicar a {R.ok.length} {R.ok.length === 1 ? 'pieza' : 'piezas'}</button></>}>
    <p><b>{R.ok.length}</b> {R.ok.length === 1 ? 'pieza cambia' : 'piezas cambian'}{R.ok.filter(x => x.ya).length ? ` (${R.ok.filter(x => x.ya).length} ya tenían datos: se actualizan)` : ''}{R.iguales ? ` · ${R.iguales} ya estaban iguales (no se tocan)` : ''}. Solo se cambian ítem, largo, corte, chapa y sin material; el material y el peso para el costo quedan como estaban. Se deshace con Ctrl+Z.</p>
    {R.err.length > 0 && <div className="note bad">{R.err.slice(0, 15).map(e => <div key={e}>{e}</div>)}{R.err.length > 15 && <div>y {R.err.length - 15} más</div>}</div>}
    <div className="scroll"><table className="tt"><thead><tr><th>Código</th><th>Ítem</th><th className="num">Largo mm</th><th className="num">Corte mm</th><th>Chapa</th><th>Sin material</th></tr></thead>
      <tbody>{R.ok.slice(0, 200).map(x => <tr key={x.k}><td>{x.cod}{x.ya && <small className="mut"> · reemplaza</small>}</td><td>{x.it ? nomIt(x.it) : <span className="mut">—</span>}</td><td className="num">{x.patch.largoU ?? '—'}</td><td className="num">{x.patch.corteU ?? <span className="mut">auto</span>}</td><td>{x.patch.chapa ? 'Sí' : ''}</td><td>{x.patch.noMat ? 'Sí' : ''}</td></tr>)}</tbody></table></div>
  </Modal>;
}
// línea de la ficha de Tiempos y Costos: a qué ítem de StockApp va y cuánto consume
function FichaStockLinea({ k, nombre }) {
  const { S, ui, pm, stock } = useApp(); const f = E.fichaDe(S, k) || {}; const it = stock && stock.items ? stock.items.find(i => i.id === f.stockId) : null, c = E.consumoU(S, f, it);
  return <span className="mut fstk">{f.chapa ? <>Material: sale de chapa (nesting){it ? <> · <b>{nomIt(it)}</b>{f.pesoU ? ` · ${fN(f.pesoU)} kg por unidad` : ' · falta el peso'}</> : ''}.</> : f.noMat ? 'No consume material de stock.' : f.stockId ? <>StockApp: <b>{it ? nomIt(it) : stock && stock.items ? 'ítem borrado en StockApp' : 'ítem vinculado'}</b>{c ? ` · consume ${fQ(c.q)} ${uIt(it)} por unidad (${consTxt(c)})` : f.largoU ? ` · largo ${fN(f.largoU)} mm` : ' · falta el largo'}</> : 'Sin ítem de StockApp (no entra al aviso de material).'}{f.deFam && <span className="tag fam">de la familia</span>}
    <button type="button" className="btn sm" onClick={() => ui.ficha({ key: k, nombre })}>{pm.admin ? '✎ Editar ficha' : 'Ver ficha'}</button></span>;
}
// Ficha de la pieza completa: ítem de StockApp, largo del plano, corte, chapa, y material y peso para el costo
function FichaDlg({ k, nombre, onClose }) {
  const { S, up, ui, pm, stock, STK } = useApp(); const f0 = E.fichaPropia(S, k) || {};
  const [f, setF] = useState({ stockId: f0.stockId || '', largoU: f0.largoU ?? '', corteU: f0.corteU ?? '', chapa: !!f0.chapa, noMat: !!f0.noMat, consumoU: f0.consumoU ?? '', material: f0.material || '', pesoU: f0.pesoU ?? '', uniones: f0.uniones ?? '' });
  const [q, setQ] = useState(''); const set = p => setF(x => ({ ...x, ...p }));
  // familia de tiempo: la pieza comparte el tiempo y, si no elige otro, el material de la familia (el largo y el peso son de cada pieza)
  const FAMS = S.familias || [], sgF = useMemo(() => !f0.familia ? E.sugerirFamilia(S, k, nombre) : null, []);
  const [famId, setFamId] = useState(f0.familia || ''); const [famNueva, setFamNueva] = useState(''); const [tipoNueva, setTipoNueva] = useState('');
  const fam = FAMS.find(x => x.id === famId) || null, esUn = famId === '+' ? tipoNueva === 'union' : E.porUnion(fam), fb = fam && fam.ficha && (fam.ficha.stockId || fam.ficha.chapa || fam.ficha.noMat) ? fam.ficha : null;
  const [usarFam, setUsarFam] = useState(() => !E.matPropio(f0)); const conFam = !!fb && usarFam;
  const [paraFam, setParaFam] = useState(false);
  const fv = conFam ? { ...f, stockId: fb.stockId || '', chapa: !!fb.chapa, noMat: !!fb.noMat, corteU: f.corteU === '' && fb.corteU != null ? fb.corteU : f.corteU } : f;   // lo que vale para la pieza
  const items = stock && stock.items ? stock.items : [], it = items.find(i => i.id === fv.stockId);
  const qq = q.trim().toLowerCase(), lst = items.filter(i => !qq || `${i.codigo} ${i.descripcion} ${i.formato || ''}`.toLowerCase().includes(qq)).sort((a, b) => (a.codigo || '').localeCompare(b.codigo || '')).slice(0, 80);
  const num = v => v === '' || v == null ? null : Number(v);
  const ff = { ...fv, uniones: num(f.uniones), largoU: num(f.largoU), corteU: fv.corteU === '' || fv.corteU == null ? null : Number(fv.corteU), consumoU: num(f.consumoU), pesoU: num(f.pesoU), material: f.material || (fam && fam.ficha && fam.ficha.material) || '' };
  const c = !fv.chapa && !fv.noMat && it ? E.consumoU(S, ff, it) : null, u = uIt(it);
  const ms = !fv.noMat ? E.matStock(S, ff, STK) : null, pU = E.pesoUDe(S, ff, it);
  // la chapa guarda su ítem solo para el costo (no entra al aviso de material)
  const guardar = () => {
    if (famId === '+' && !famNueva.trim()) { ui.toast('Poné el nombre de la familia nueva'); return; }
    if (esUn && !(Number(f.uniones) > 0)) { ui.toast('Cargá cuántas uniones tiene la pieza'); return; }
    const propio = { ...ff, material: f.material, corteU: f.corteU === '' ? null : Number(f.corteU), stockId: fv.noMat ? '' : fv.stockId, ...(fv.chapa || fv.noMat ? { largoU: null, corteU: null, consumoU: null } : {}) };
    if (conFam) Object.assign(propio, { stockId: '', chapa: false, noMat: false });   // hereda el material de la familia
    const aFam = !conFam && !!fichaFam(propio) && (famId === '+' || (!!famId && (paraFam || !fb)));   // el material de esta pieza pasa a ser el de la familia
    up(s => { let a = s, id = famId;
      if (famId === '+') [a, id] = nuevaFam(a, famNueva, aFam ? fichaFam(propio) : null, tipoNueva);
      else if (aFam) a = { ...a, familias: (a.familias || []).map(x => x.id === id ? { ...x, ficha: fichaFam(propio) } : x) };
      return conFicha(a, k, { ...propio, ...(aFam ? { stockId: '', chapa: false, noMat: false, material: '' } : {}), familia: id || '' }); });
    ui.toast(famId === '+' ? `Ficha guardada · familia ${famNueva.trim()} creada` : 'Ficha guardada'); onClose(); };
  return <Modal arriba title={'Ficha de ' + nombre} onClose={onClose} foot={<><span className="mut">Vale para todas las veces que se fabrica.</span><span className="sp" /><button className="btn canc-b" onClick={onClose}>Cancelar</button><button className="btn pri-b" disabled={!pm.admin} onClick={guardar}>Guardar</button></>}>
    <div className="fichad">
      <div className="fichad-fam">
        <label>Familia de tiempo <small className="mut">piezas que se fabrican igual y llevan el mismo tiempo</small>
          <select value={famId} disabled={!pm.admin} onChange={e => { setFamId(e.target.value); setParaFam(false); }}><option value="">— Sin familia (tiempo propio)</option>{FAMS.map(x => <option key={x.id} value={x.id}>{x.nombre} · {E.codsFamilia(S, x.id).length} piezas</option>)}<option value="+">+ Nueva familia…</option></select></label>
        {famId === '+' && <><input autoFocus placeholder="Nombre de la familia (por ejemplo Eje motor cinta, motor 1,5 HP)" value={famNueva} onChange={e => setFamNueva(e.target.value)} /><TipoFam v={tipoNueva} set={setTipoNueva} /></>}
        {esUn && <label className="fichad-un">Uniones (Joints) <small className="mut">uniones soldadas de esta pieza; el largo no cuenta</small><input type="number" min="1" step="1" disabled={!pm.admin} value={f.uniones} onChange={e => set({ uniones: e.target.value })} placeholder="por ejemplo 4" /></label>}
        {!famId && sgF && <small className="hint">¿Es de la familia <b>{sgF.fam.nombre}</b>? <button type="button" className="lnk sm" onClick={() => setFamId(sgF.fam.id)}>Elegirla</button></small>}
        {fam && esUn && (() => { const fu = E.famUnion(S, fam), un = Number(f.uniones) || 0; return <small className="mut">{fu && fu.porUnion != null ? <>Tiempo de la familia: <b>{fHM(fu.porUnion)}</b> por unión ({baseTxt(fu)}{fu.nPiezas ? `, ${fu.nPiezas} ${fu.nPiezas === 1 ? 'pieza' : 'piezas'}` : ''}){un > 0 ? <> → esta pieza: <b>{fHM(fu.porUnion * un)}</b> por unidad ({un} {un === 1 ? 'unión' : 'uniones'}).</> : '. Cargá las uniones para calcular el de esta pieza.'}{fu.sinUn > 0 ? ` ${fu.sinUn} ${fu.sinUn === 1 ? 'fabricación no cuenta' : 'fabricaciones no cuentan'}: a su pieza le faltan las uniones.` : ''}</> : 'La familia todavía no tiene fabricaciones con uniones ni base medida (cargala en Familias).'}</small>; })()}
        {fam && !esUn && (() => { const h = E.historial(S, nombre && E.claveCod(nombre) === k ? nombre : k); return <small className="mut">{h && h.fam && h.fam.id === fam.id ? <>Tiempo de la familia: <b>{fHM(h.porUnidad)}</b> por unidad (promedio de {h.n} {h.n === 1 ? 'vez' : 'veces'}, {h.nPiezas} {h.nPiezas === 1 ? 'pieza' : 'piezas'}).</> : famId !== f0.familia ? 'Al guardar, esta pieza toma el tiempo de la familia.' : 'La familia todavía no tiene fabricaciones.'}</small>; })()}
      </div>
      {conFam ? <div className="fichad-famat"><p>Material de la familia: <b>{fb.noMat ? 'no consume material de stock' : (fb.chapa ? 'sale de chapa · ' : '') + (it ? nomIt(it) : fb.stockId ? 'ítem de StockApp' : '—')}</b></p>
        {pm.admin && <button type="button" className="btn sm" onClick={() => { setUsarFam(false); set({ stockId: fb.stockId || '', chapa: !!fb.chapa, noMat: !!fb.noMat }); }}>Elegir otro material para esta pieza</button>}
        {!fb.chapa && !fb.noMat && <><div className="dos">
          <label>Largo del plano (mm)<input type="number" min="0" step="1" value={f.largoU} onChange={e => set({ largoU: e.target.value })} placeholder="pieza terminada" /></label>
          <label>Corte de serrucho (mm)<input type="number" min="0" step="0.5" value={f.corteU} onChange={e => set({ corteU: e.target.value })} placeholder={fb.corteU != null ? `${fN(fb.corteU)} (de la familia)` : it ? `${fN(E.corteDe(S, it))} (de Configuración)` : 'de Configuración'} /></label>
        </div>
        {it && <p className={c ? 'mut' : 'note'}>{c ? <>Consume <b>{fQ(c.q)} {u}</b> por unidad ({consTxt(c)}).</> : u.toLowerCase() === 'kg' ? 'Este ítem va en kg: cargá el peso por unidad abajo.' : 'Falta el largo del plano de esta pieza.'}</p>}</>}</div>
      : <>{fam && pm.admin && <label className="chk"><input type="checkbox" checked={paraFam || (!fb && famId !== '')} disabled={!fb} onChange={e => setParaFam(e.target.checked)} /> {fb ? 'Guardar este material también como el de la familia' : 'Este material queda como el de la familia (todavía no tiene)'}</label>}
        {fb && <button type="button" className="lnk sm" onClick={() => setUsarFam(true)}>Usar el material de la familia</button>}
      <div className="fichad-tipo" role="radiogroup" aria-label="Material de la pieza">{[['stock', 'Barra o material de StockApp'], ['chapa', 'Sale de chapa (nesting)'], ['no', 'No consume material de stock']].map(([v, l]) => { const on = v === 'chapa' ? f.chapa : v === 'no' ? f.noMat : !f.chapa && !f.noMat;
        return <label key={v} className={'togb' + (on ? ' on' : '')}><input type="radio" name="tipomat" checked={on} onChange={() => set({ chapa: v === 'chapa', noMat: v === 'no' })} hidden />{l}</label>; })}</div>
      {f.chapa && <p className="mut">Se controla con el programa de nesting: no entra al aviso de material. Elegí la chapa de StockApp y cargá el peso por unidad (Propiedades físicas / Mass Properties de SolidWorks) para el costo.</p>}
      {f.noMat && <p className="mut">Por ejemplo un plegado, pulido o armado sobre una pieza que ya salió de stock, o un servicio: no entra al aviso ni a "sin verificar".</p>}
      {!f.noMat && <>
        <h3>Material de StockApp</h3>
        {!items.length ? <p className="note">{stock && stock.error ? 'No se puede leer StockApp con este usuario.' : 'No hay ítems en StockApp.'}</p> : <>
          <input type="search" placeholder="Buscar en StockApp: código, descripción o diámetro (por ejemplo Ø20 304)" value={q} onChange={e => setQ(e.target.value)} />
          <select size={7} className="fichad-it" value={f.stockId} onChange={e => set({ stockId: e.target.value })} aria-label="Ítem de StockApp">{it && !lst.includes(it) && <option value={it.id}>{nomIt(it)} · {it.unidad}</option>}{lst.map(i => <option key={i.id} value={i.id}>{nomIt(i)} · {i.unidad}{E.esChapaIt(i) ? ' (chapa)' : ''}</option>)}</select>
          {it && <p className="mut">Elegido: <b>{nomIt(it)}</b> · se cuenta en <b>{u}</b> · stock {fQ(it.stock)} {u}{E.medidaIt(it) ? ` · medida ${fN(E.medidaIt(it))} mm` : ''}{Number(it.kgm) > 0 ? ` · ${fN(it.kgm)} kg/m` : ''}{E.esChapaIt(it) && !f.chapa ? ' · es una chapa: ¿no conviene tildar "Sale de chapa"?' : ''}</p>}</>}
        {!f.chapa && <><div className="dos">
          <label>Largo del plano (mm)<input type="number" min="0" step="1" value={f.largoU} onChange={e => set({ largoU: e.target.value })} placeholder="pieza terminada" /></label>
          <label>Corte de serrucho (mm)<input type="number" min="0" step="0.5" value={f.corteU} onChange={e => set({ corteU: e.target.value })} placeholder={it ? `${fN(E.corteDe(S, it))} (de Configuración)` : 'de Configuración'} /></label>
        </div>
        {it && u.toLowerCase() !== 'm' && <label>Consumo por unidad a mano ({u}) <small className="mut">opcional: manda sobre el largo</small><input type="number" min="0" step="0.001" value={f.consumoU} onChange={e => set({ consumoU: e.target.value })} /></label>}
        {it && <p className={c ? 'mut' : 'note'}>{c ? <>Consume <b>{fQ(c.q)} {u}</b> por unidad ({consTxt(c)}).</> : u.toLowerCase() === 'kg' ? 'Este ítem va en kg: cargá el peso por unidad abajo.' : 'Falta el largo del plano.'}</p>}</>}
      </>}
      </>}
      <h3>Para el costo</h3>
      {fv.noMat ? <p className="mut">Sin costo de material.</p> : <>
        {ms && ms.usdU != null ? <p className="mut">Material por unidad: <b>{fPlata(ms.usdU)}</b> ({precioTxt(ms)}). Precio de StockApp: lo actualiza ComprasApp con cada OC.</p>
          : ms ? <p className="note">StockApp: falta {ms.falta}. Mientras tanto se usa el material genérico de abajo (si lo tiene).</p>
          : <p className="note">Sin ítem de StockApp: se usa el material genérico de abajo (respaldo).</p>}
        <div className="dos">
          <label>Material genérico (respaldo, USD/kg)<select value={f.material} onChange={e => set({ material: e.target.value })}><option value="">—</option>{(S.materiales || []).map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}</select></label>
          <label>Peso por unidad (kg) {pU && pU.auto && <small className="mut">auto: {fN(pU.kgm)} kg/m</small>}{(() => { const pa = pU && !pU.auto && E.pesoUDe(S, { ...ff, pesoU: null }, it); return pa && Math.abs(pa.kg - pU.kg) / pa.kg > 0.05 ? <small className="tfal c-bad"> con el kg/m de StockApp da {fN(pa.kg)} kg: <button type="button" className="lnk sm" onClick={() => set({ pesoU: '' })}>usar ese</button></small> : null; })()}<input type="number" min="0" step="0.01" value={f.pesoU} placeholder={pU && pU.auto ? fN(pU.kg) : fv.chapa ? 'obligatorio en chapas' : ''} onChange={e => set({ pesoU: e.target.value })} /></label>
        </div></>}
      {!pm.admin && <p className="note">Solo un administrador edita las fichas.</p>}
    </div>
  </Modal>;
}

/* ================= TIEMPOS ================= */
// Historial de tiempos y costos por pieza: el padre es el código (con el promedio por unidad para planificar),
// los hijos son cada vez que se fabricó. Las cotizaciones manuales se ven junto a su pieza pero no entran en el promedio.
function Tiempos() {
  const { S, V, up, ui, pm, STK } = useApp();
  const [q, setQ] = useState(''); const [ab, setAb] = useState(() => prefG('tiempos-abiertas', [])); const [cot, setCot] = useState(null);
  useEffect(() => { guardaG('tiempos-abiertas', ab); }, [ab]);
  const G = useMemo(() => E.tiempos(S), [S.tareas, S.cotizaciones, S.codigos, S.historico, S.operaciones, S.fichas, S.familias]);
  const [sel, setSel] = useState([]); const [agr, setAgr] = useState(false); const [vfam, setVfam] = useState(false);   // familias de tiempo: piezas tildadas para agrupar
  // sub-pestañas TPFR / TPFD (y "Otros" y "Sin código" solo si hay piezas de ese tipo) y filtro por operación
  const [serie, setSerie] = useState(() => prefG('tiempos-serie', 'TPFR')); const [fop, setFop] = useState(() => prefG('tiempos-op', ''));
  useEffect(() => { guardaG('tiempos-serie', serie); guardaG('tiempos-op', fop); }, [serie, fop]);
  const [dab, setDab] = useState([]); const [ffich, setFfich] = useState(false);   // fabricaciones con el desglose de hijas abierto
  const [orden, setOrden] = useState(() => prefG('tiempos-orden', 'num')); const [soloInc, setSoloInc] = useState(false);
  useEffect(() => { guardaG('tiempos-orden', orden); }, [orden]);
  // costo por unidad de cada pieza: se recalcula solo al cambiar precios de materiales, tarifas o fichas
  const CG = useMemo(() => { const m = {}; G.forEach(g => { m[g.k] = E.costoGrupo(S, g, STK); }); return m; }, [G, S.materiales, S.tarifas, S.operaciones, S.codigos, S.fichas, S.cfg, STK]);
  const setFicha = (k, patch) => up(s => conFicha(s, k, patch));
  const series = [['TPFR', 'TPFR'], ['TPFD', 'TPFD'], ...(G.some(g => g.serie === 'Otros') ? [['Otros', 'Otros']] : []), ...(G.some(g => !g.serie) ? [['', 'Sin código']] : [])];
  const enSerie = G.filter(g => g.serie === serie);
  const opsSerie = S.operaciones.map(o => [o, enSerie.filter(g => g.operacionId === o.id).length]).filter(([, n]) => n > 0);
  const incompleto = g => g.n > 0 && (CG[g.k].cu == null || CG[g.k].parcial); const nInc = enSerie.filter(incompleto).length;
  const qq = q.trim().toLowerCase(); const vis0 = enSerie.filter(g => (!fop || g.operacionId === fop) && (!soloInc || incompleto(g)) && (!qq || g.nombre.toLowerCase().includes(qq) || g.k.toLowerCase().includes(qq)));
  const cuDe = g => CG[g.k].cu; const vis = orden === 'num' ? vis0 : [...vis0].sort((a, b) => orden === 'falta' ? (incompleto(b) - incompleto(a)) || a.k.localeCompare(b.k) : (cuDe(a) == null) - (cuDe(b) == null) || (orden === 'costo-d' ? cuDe(b) - cuDe(a) : cuDe(a) - cuDe(b)));
  const tog = k => setAb(a => a.includes(k) ? a.filter(x => x !== k) : [...a, k]);
  // cambiar material, peso o descarte: en la tarea (fabricación) o en la cotización
  const setReg = (r, patch) => r.hist ? up(s => ({ ...s, historico: (s.historico || []).map(x => x.id === r.id ? { ...x, ...patch } : x) })) : r.cot ? up(s => ({ ...s, cotizaciones: (s.cotizaciones || []).map(x => x.id === r.id ? { ...x, ...patch } : x) })) : up(s => ({ ...s, tareas: s.tareas.map(t => t.id === r.id ? { ...t, ...patch } : t) }));
  const borrarHist = r => { if (confirm(`¿Borrar del historial esta fabricación de "${r.nombre}" (fila ${r.fila} de la planilla)?`)) { up(s => ({ ...s, historico: (s.historico || []).filter(x => x.id !== r.id) })); ui.toast('Fabricación borrada del historial'); } };
  const borrarCot = r => { if (confirm(`¿Borrar la cotización de "${r.nombre}"?`)) { up(s => ({ ...s, cotizaciones: (s.cotizaciones || []).filter(x => x.id !== r.id) })); ui.toast('Cotización borrada'); } };
  const origen = r => { if (r.cot) return <span className="tag">cotización</span>; if (r.hist) return <span title={r.obs || undefined}><span className="tag">planilla</span><small className="mut"> · fila {r.fila}</small></span>; const t = V.byId[r.id]; if (!t) return '—';
    if (r.tipo === 'rep') { const rt = V.rootOf(t); return <span>{rt.orden || 'S/N'}<small className="mut"> · {rt.cliente}</small></span>; }
    const p = S.proyectos.find(x => x.id === r.proyId); return <span>{p ? p.nombre : 'Proyecto'}</span>; };
  const nFab = enSerie.reduce((a, g) => a + g.n, 0), conDatos = enSerie.filter(g => g.n > 0).length;
  const faltan = [!(S.tarifas || []).some(t => t.valor > 0) && 'las tarifas de mano de obra'].filter(Boolean);
  return <div className="view tiempos">
    <div className="ptabs tchips" role="tablist">{series.map(([k, l]) => <button key={k || 'sin'} role="tab" aria-selected={serie === k} className={'ptab' + (serie === k ? ' on' : '')} onClick={() => { setSerie(k); setFop(''); }}><b>{l}</b><small className="mut">{G.filter(g => g.serie === k).length}</small></button>)}</div>
    <section>
      <div className="sec-h"><h2>Tiempos y Costos</h2><div className="row">
        <input id="ti-q" type="search" placeholder="Buscar código o pieza" value={q} onChange={e => setQ(e.target.value)} />
        <button className="btn sm" onClick={() => setAb(ab.length ? [] : vis.map(g => g.k))}>{ab.length ? 'Cerrar todas' : 'Abrir todas'}</button>
        <select id="ti-ord" aria-label="Ordenar" value={orden} onChange={e => setOrden(e.target.value)}><option value="num">Orden: número correlativo</option><option value="costo-d">Orden: mayor costo</option><option value="costo-a">Orden: menor costo</option><option value="falta">Orden: costo incompleto primero</option></select>
        {pm.admin && sel.length > 0 && <button className="btn pri-b" onClick={() => setAgr(true)} title="Las piezas tildadas pasan a compartir el tiempo estándar">Agrupar en familia (Group) <small>{sel.length}</small></button>}
        {(S.familias || []).length > 0 && <button className="btn" onClick={() => setVfam(true)}>Familias <small>{(S.familias || []).length}</small></button>}
        {pm.admin && <button className="btn" onClick={() => setFfich(true)} title="Toma material y peso por unidad de las fabricaciones ya cargadas (historial del Costeador y tareas de la app)">Completar fichas desde el historial</button>}
        {pm.admin && <button className="btn pri-b" onClick={() => setCot({})}>+ Cotizar</button>}
      </div></div>
      {nInc > 0 && <div className="togs tops" aria-label="Filtrar por costo"><button className={'togb' + (soloInc ? ' on' : '')} onClick={() => setSoloInc(v => !v)}>Costo incompleto <small>{nInc}</small></button></div>}
      {opsSerie.length > 1 && <div className="togs tops" aria-label="Filtrar por operación"><button className={'togb' + (!fop ? ' on' : '')} onClick={() => setFop('')}>Todas <small>{enSerie.length}</small></button>
        {opsSerie.map(([o, n]) => <button key={o.id} className={'togb' + (fop === o.id ? ' on' : '')} onClick={() => setFop(fop === o.id ? '' : o.id)}>{o.nombre} <small>{n}</small></button>)}</div>}
      <p className="mut">{serie || 'Sin código'}: ordenadas por el número correlativo (la última parte del código, por ejemplo 0001, 0002, 0003…). {conDatos} {conDatos === 1 ? 'pieza' : 'piezas'} con historial · {nFab} {nFab === 1 ? 'vez fabricada' : 'veces fabricadas'}. El promedio por unidad es el que se sugiere al cargar la pieza de nuevo. Los costos se calculan con las tarifas de Configuración y el precio de cada ítem de StockApp (el último que cargó ComprasApp; si está en $, se pasa a USD con el dólar de StockApp): al cambiar, se actualizan solos. El material sale de la ficha de cada pieza (abrila con ▸): consumo por unidad × precio del ítem. Las piezas sin ítem con precio usan, por ahora, el material genérico de Configuración × peso ("precio genérico"). En las piezas con hijas (por ejemplo soldadas) el costo suma el trabajo propio más el de todas sus hijas, con el desglose.</p>
      {faltan.length > 0 && <p className="note">Para ver costos falta cargar en Configuración: {faltan.join(' y ')}.</p>}
      {vis.length === 0 ? <Vacio ic={qq ? 'buscar' : 'reloj'} t={qq || fop ? 'Ninguna pieza coincide con el filtro' : `Todavía no hay tiempos ${serie === 'Otros' ? 'de otros códigos' : serie ? 'de piezas ' + serie : 'de piezas sin código'}`}>{qq || fop ? 'Probá con otra búsqueda u otra operación.' : 'Aparecen solos cuando se finaliza una tarea con horas reales cargadas.'}</Vacio>
        : <div className="tgrupos">{vis.map(g => { const on = ab.includes(g.k) || (!!qq && vis.length <= 3);
          const { cu, parcial, falta: fl } = CG[g.k], fi = E.fichaDe(S, g.k) || {};
          return <div key={g.k} className={'dgrp tgrp' + (on ? ' on' : '')}>
            <div className="dgrp-h">{pm.admin && <input type="checkbox" className="tsel" aria-label={'Tildar ' + g.nombre} checked={sel.includes(g.k)} onChange={() => setSel(a => a.includes(g.k) ? a.filter(x => x !== g.k) : [...a, g.k])} />}<button className="dgrp-t" aria-expanded={on} onClick={() => tog(g.k)}><span className="car">{on ? '▾' : '▸'}</span><b>{g.nombre}</b></button></div>
            <div className="tg-res" onClick={() => tog(g.k)}>
              {g.n ? <span><b className="tg-prom">{fHM(g.prom)}</b> por unidad <span className="mut">· promedio de {g.n} {g.n === 1 ? 'vez' : 'veces'}</span></span> : <span className="mut">Sin fabricaciones todavía</span>}
              {g.n > 0 && g.n < 3 && !(g.fh && g.fh.n >= 3) && <span className="tag warn" title="Con 1 o 2 veces el promedio todavía no es confiable">pocos datos</span>}
              {g.fh ? <span className="tfam"><span className="tag fam">familia {g.fh.fam.nombre}</span> estándar <b>{fHM(g.fh.porUnidad)}</b>{g.fh.porUnion != null && <span className="mut">{unTxt(g.fh)}</span>} <span className="mut">· {g.fh.n} {g.fh.n === 1 ? 'vez' : 'veces'}, {g.fh.nPiezas} {g.fh.nPiezas === 1 ? 'pieza' : 'piezas'}</span>
                {g.prom > 0 && g.fh.nPiezas > 1 && Math.abs(g.prom - g.fh.porUnidad) / g.fh.porUnidad > 0.2 && <span className="tag warn" title="Su promedio propio se aleja más de 20 % del de la familia: revisá si de verdad se fabrica igual">se aleja {Math.round((g.prom - g.fh.porUnidad) / g.fh.porUnidad * 100)}% de la familia</span>}</span>
                : g.sinUn ? <span className="tfam"><span className="tag fam">familia {g.sinUn.nombre}</span> <span className="tag warn" title="Es una familia por unión: abrí la ficha (▸) y cargá cuántas uniones tiene">faltan las uniones</span></span>
                : <SugFam k={g.k} nombre={g.nombre} chico />}
              {(() => { const rc = g.regs.filter(r => r.hc > 0 && !r.fuera && !r.cot); return rc.length > 0 && <span className="mut" title={`Promedio del corte de material en las ${rc.length === 1 ? 'vez' : rc.length + ' veces'} que se cargó aparte (ya está incluido en el promedio de la pieza)`}>✂ corte ≈ {fHM(rc.reduce((a, r) => a + r.hc / Math.max(1, r.cant), 0) / rc.length)} por unidad</span>; })()}
              {cu != null && <span title={parcial ? `Costo parcial: falta ${fl.join(', ')}` : 'Material + mano de obra, con los precios y tarifas de hoy'}>≈ <b>{fPlata(cu)}</b>{parcial && '*'} <span className="mut">por unidad</span></span>}
              {g.n > 0 && parcial && <span className="tag warn" title="Completá la ficha de la pieza (abrila con ▸)">falta {fl.join(', ')}</span>}
              {g.n > 0 && cu == null && <span className="tag warn" title="Completá la ficha de la pieza (abrila con ▸)">sin costo: falta {fl.join(', ') || 'tarifa'}</span>}
              {g.nCot > 0 && <span className="tag">{g.nCot} {g.nCot === 1 ? 'cotización' : 'cotizaciones'}</span>}
              <span className="mut">{g.operacionId ? operName(S, g.operacionId) : [...new Set(g.regs.flatMap(r => r.hhCat ? Object.keys(r.hhCat).map(id => (E.tarifaDe(S, id) || {}).nombre).filter(Boolean) : []))].join(' + ') || '—'}{g.ult ? ` · última ${fFecha(g.ult)}` : ''}</span>
            </div>
            {on && <div className="ficha"><b>Ficha de la pieza</b>
              {(() => { const ms = fi.noMat ? null : E.matStock(S, fi, STK), pU = E.pesoUDe(S, fi, ms && ms.it);
                if (ms && ms.usdU != null) return <span className="mut">Material por unidad: <b>{fPlata(ms.usdU)}</b> ({precioTxt(ms)}){pU ? ` · ${fN(pU.kg)} kg por unidad${pU.auto ? ' (kg/m de StockApp)' : ''}` : ''}</span>;
                const m = E.materialDe(S, fi.material), pu = pU ? pU.kg : 0;
                return <>{ms && <span className="tag warn" title="Mientras tanto se usa el material genérico, si la ficha lo tiene">StockApp: falta {ms.falta}</span>}
                  <label>Material genérico (respaldo)<select className="ci" aria-label="Material genérico de la pieza" value={fi.material || ''} disabled={!pm.admin} onChange={e => setFicha(g.k, { material: e.target.value })}><option value="">—</option>{(S.materiales || []).map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}</select></label>
                  <label>Peso por unidad (kg)<EdIn className="num" type="number" min="0" step="0.01" value={fi.pesoU ?? ''} placeholder={pU && pU.auto ? fN(pU.kg) : undefined} disabled={!pm.admin} onCommit={v => setFicha(g.k, { pesoU: v === '' ? null : Number(v) })} /></label>
                  {m && pu > 0 ? <span className="mut">Material por unidad: <b>{fPlata(pu * (Number(m.precio) || 0))}</b> <span className="tag">precio genérico</span> ({fN(pu)} kg × {fPlata(m.precio)}/kg · al {fFecha(m.fecha)})</span> : <span className="mut">{fi.noMat ? 'No consume material de stock: sin costo de material.' : ms ? 'Mientras el ítem no tenga precio en StockApp, se usa el material genérico × peso.' : 'Elegí el ítem de StockApp en la ficha para tomar su precio.'}</span>}</>; })()}
              <FichaStockLinea k={g.k} nombre={g.nombre} />
            </div>}
            {on && <div className="scroll"><table className="tt ttiem"><thead><tr><th>Fecha</th><th>Origen</th><th className="num">Cant.</th><th>Operarios</th><th className="num">HH</th><th className="num">Por unidad</th><th>Material</th><th className="num">Peso total kg</th><th className="num">Costo total</th><th className="num">Costo unit.</th><th></th></tr></thead>
              <tbody>{g.regs.map(r => { const c = E.costo(S, r, STK), d = !r.cot && r.plan > 0 ? (r.hh - r.plan) / r.plan * 100 : null, abre = dab.includes(r.id);
                return <React.Fragment key={(r.cot ? 'q' : 't') + r.id}><tr className={(r.fuera ? 'fuera ' : '') + (r.cot ? 'cot' : '')}>
                  <td>{fFecha(r.fecha)}</td><td>{origen(r)}</td><td className="num">{fN(r.cant)}</td>
                  <td>{r.ops.length ? r.ops.map(o => opName(S, o)).join(', ') : r.opsTxt ? r.opsTxt : <span className="mut">—</span>}</td>
                  <td className="num" title={r.det || (r.hc ? `De estas, ${fN(r.hc)} HH de corte de material` : undefined)}>{fN(r.hh)}{r.hc > 0 && <small className="mut tcor">✂ {fN(r.hc)}</small>}{d != null && Math.abs(d) >= 1 && <small className={'tdes ' + (d > 0 ? 'c-bad' : 'c-ok')} title={`Planificado: ${fN(r.plan)} HH`}>{d > 0 ? '+' : ''}{Math.round(d)}%</small>}</td>
                  <td className="num"><b>{fHM(r.hu)}</b></td>
                  <td>{c.fuente === 'stock' || c.fuente === 'nomat' ? <span className="mut" title={c.fuente === 'stock' ? precioTxt(c.ms) : undefined}>{c.fuente === 'stock' ? c.ms.it.codigo || c.matNom : 'sin material'}<small> · {c.fuente === 'stock' ? 'StockApp' : 'ficha'}</small></span>
                    : <select className="ci" aria-label="Material" value={r.material || ''} disabled={(r.cot || r.hist) && !pm.admin} onChange={e => setReg(r, { material: e.target.value })}><option value="">{c.deFicha.material && c.m ? `${c.m.nombre} (de la ficha)` : '—'}</option>{(S.materiales || []).map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}</select>}</td>
                  <td className="num"><EdIn className="num" type="number" min="0" step="0.1" value={r.peso ?? ''} placeholder={c.deFicha.peso ? fN(c.peso) : undefined} title={c.deFicha.peso ? 'Peso total tomado de la ficha (por unidad × cantidad)' : undefined} disabled={(r.cot || r.hist) && !pm.admin} onCommit={v => setReg(r, { peso: v === '' ? null : Number(v) })} /></td>
                  <td className="num" title={`Material ${fPlata(c.mat)} + mano de obra ${fPlata(c.mo)}${c.det ? ` (${c.det.map(x => `${x.nombre} ${fN(x.h)} h × ${x.t ? fPlata(x.t.valor) : '?'}/h`).join(' + ')})` : c.vh ? ` (${fN(r.hh)} HH × ${fPlata(c.vh.valor)}/h)` : ''}`}>{c.total > 0 ? fPlata(c.total) : '—'}{c.falta.length > 0 && <small className="mut tfal">falta {c.falta.join(', ')}</small>}{c.hijas && <button type="button" className="lnk sm tdesg" aria-expanded={abre} onClick={() => setDab(a => a.includes(r.id) ? a.filter(x => x !== r.id) : [...a, r.id])}>{abre ? '▾' : '▸'} incluye {c.hijas.length} {c.hijas.length === 1 ? 'pieza hija' : 'piezas hijas'}</button>}</td>
                  <td className="num"><b>{c.total > 0 ? fPlata(c.unit) : '—'}</b></td>
                  <td><div className="acts">{r.hist ? <>{pm.admin && <button onClick={() => borrarHist(r)} title="Borrar esta fabricación del historial">🗑</button>}<button className={r.fuera ? 'on' : ''} onClick={() => { setReg(r, { tiempoFuera: !r.fuera }); ui.toast(r.fuera ? 'Vuelve a contar en el promedio' : 'Descartada: ya no cuenta en el promedio'); }} title={r.fuera ? 'Volver a contarla en el promedio' : 'Descartar del promedio (por ejemplo, si está mal cargada)'}>{r.fuera ? 'Incluir' : 'Descartar'}</button></>
                    : r.cot ? pm.admin && <><button onClick={() => setCot(r)} title="Editar la cotización">✎</button><button onClick={() => borrarCot(r)} title="Borrar la cotización">🗑</button></>
                    : <><button onClick={() => ui.modal({ k: 'task', id: r.id })} title="Abrir la tarea">✎</button><button className={r.fuera ? 'on' : ''} onClick={() => { setReg(r, { tiempoFuera: !r.fuera }); ui.toast(r.fuera ? 'Vuelve a contar en el promedio' : 'Descartada: ya no cuenta en el promedio'); }} title={r.fuera ? 'Volver a contarla en el promedio' : 'Descartar del promedio (por ejemplo, si salió mal)'}>{r.fuera ? 'Incluir' : 'Descartar'}</button></>}</div></td>
                </tr>
                </React.Fragment>; })}</tbody></table></div>}
            {on && g.regs.filter(r => dab.includes(r.id)).map(r => { const c = E.costo(S, r, STK); return c.hijas && <div key={'d' + r.id} className="desgbox"><div className="mut desgt">Desglose de {r.nombre} · {fFecha(r.fecha)} · {fN(r.cant)} u.</div><table className="tt tdg"><thead><tr><th>Pieza hija</th><th className="num">Cant.</th><th className="num">HH</th><th>Material</th><th className="num">Peso total kg</th><th className="num">Material US$</th><th className="num">Mano de obra US$</th><th className="num">Total US$</th></tr></thead>
                  <tbody><tr className="tdg-p"><td><b>Trabajo propio de {r.nombre.replace(/^TPF[\w\-./]*\s*/i, '') || 'la pieza'}</b></td><td className="num">{fN(r.cant)}</td><td className="num">{fN(r.hh)}</td><td>{c.matNom || <span className="mut">—</span>}</td><td className="num">{c.propio.mat > 0 ? fN(c.peso) : '—'}</td><td className="num">{fPlata(c.propio.mat)}</td><td className="num">{fPlata(c.propio.mo)}</td><td className="num"><b>{fPlata(c.propio.total)}</b></td></tr>
                    {c.hijas.map(h => <tr key={h.id}><td style={{ paddingLeft: 8 + h.nivel * 14 }}>{h.nombre}{h.terc && <small className="mut"> · tercerizada (sin costo)</small>}</td><td className="num">{fN(h.cant)}</td><td className="num">{fN(h.hh)}</td><td>{h.c.matNom || <span className="mut">—</span>}</td><td className="num">{h.c.mat > 0 ? fN(h.c.peso) : '—'}</td><td className="num">{fPlata(h.c.mat)}</td><td className="num">{fPlata(h.c.mo)}{h.c.falta.length > 0 && <small className="mut tfal">falta {h.c.falta.join(', ')}</small>}</td><td className="num">{fPlata(h.c.total)}</td></tr>)}
                    <tr className="tdg-t"><td colSpan={5}><b>Total del ensamblaje</b> <span className="mut">(propio + hijas) · {fPlata(c.unit)} por unidad</span></td><td className="num">{fPlata(c.mat)}</td><td className="num">{fPlata(c.mo)}</td><td className="num"><b>{fPlata(c.total)}</b></td></tr></tbody></table></div>; })}
          </div>; })}</div>}
    </section>
    {cot && <CotEditor r={cot} onClose={() => setCot(null)} />}
    {ffich && <FichasHist onClose={() => setFfich(false)} />}
    {agr && <AgruparDlg ks={sel} G={G} onClose={ok => { setAgr(false); if (ok) setSel([]); }} />}
    {vfam && <FamiliasDlg G={G} onClose={() => setVfam(false)} />}
  </div>;
}
// Agrupar en familia: las piezas tildadas van a una familia existente o a una nueva
function AgruparDlg({ ks, G, onClose }) {
  const { S, up, ui } = useApp(); const FAMS = S.familias || [];
  const ya = [...new Set(ks.map(k => (E.familiaDe(S, k) || {}).id).filter(Boolean))];
  const [id, setId] = useState(ya.length === 1 ? ya[0] : FAMS.length ? '' : '+'); const [nom, setNom] = useState(''); const [tipo, setTipo] = useState(''); const [base, setBase] = useState(''); const [peso, setPeso] = useState('3');
  const gs = ks.map(k => G.find(g => g.k === k)).filter(Boolean), ops = [...new Set(gs.map(g => g.operacionId).filter(Boolean))];
  // familia por unión (25/11): las uniones de cada pieza se cargan acá mismo (quedan en su ficha)
  const esUn = id === '+' ? tipo === 'union' : E.porUnion(FAMS.find(x => x.id === id));
  const [uns, setUns] = useState(() => Object.fromEntries(ks.map(k => [k, E.unionesDe(S, k) || ''])));
  const n = gs.reduce((a, g) => a + g.n, 0), pu = n ? gs.reduce((a, g) => a + (g.prom || 0) * g.n, 0) / n : null;
  const gu = gs.filter(g => g.n && Number(uns[g.k]) > 0), nu = gu.reduce((a, g) => a + g.n, 0), pj = nu ? gu.reduce((a, g) => a + g.prom / Number(uns[g.k]) * g.n, 0) / nu : null;
  const ok = () => { if (id === '+' && !nom.trim()) { ui.toast('Poné el nombre de la familia'); return; } if (!id) { ui.toast('Elegí la familia'); return; }
    up(s => { let a = s, fid = id; if (id === '+') [a, fid] = nuevaFam(a, nom, null, tipo, Number(base) > 0 ? { base: Math.round(Number(base) * 1000) / 1000, basePeso: Math.max(1, Math.round(Number(peso)) || 3) } : null); a = ponFam(a, ks, fid);
      if (esUn) ks.forEach(k => { const v = Number(uns[k]); a = conFicha(a, k, { uniones: v > 0 ? Math.round(v) : '' }); }); return a; });
    ui.toast(`${ks.length} ${ks.length === 1 ? 'pieza agrupada' : 'piezas agrupadas'} en la familia ${id === '+' ? nom.trim() : (FAMS.find(x => x.id === id) || {}).nombre}`); onClose(true); };
  return <Modal title="Agrupar en familia de tiempo" onClose={() => onClose(false)} foot={<><span className="sp" /><button className="btn canc-b" onClick={() => onClose(false)}>Cancelar</button><button className="btn pri-b" data-enter onClick={ok}>Agrupar</button></>}>
    <p className="mut">{esUn ? 'Familia por unión: el tiempo lo marcan las uniones soldadas, no el largo. La app saca las horas por unión de todas las fabricaciones y a cada pieza le da horas por unión × sus uniones.' : 'Estas piezas se fabrican igual: van a compartir el tiempo estándar (el promedio por unidad de todas juntas).'} El material, el largo y el peso siguen siendo de cada pieza.</p>
    <ul className="famlst">{gs.map(g => <li key={g.k}><b>{g.nombre}</b> <span className="mut">· {g.n ? `${fHM(g.prom)} por unidad (${g.n} ${g.n === 1 ? 'vez' : 'veces'})` : 'sin fabricaciones'}{E.familiaDe(S, g.k) ? ` · hoy en ${E.familiaDe(S, g.k).nombre}` : ''}</span>
      {esUn && <label className="famun">Uniones (Joints) <input type="number" min="1" step="1" value={uns[g.k]} onChange={e => setUns(u => ({ ...u, [g.k]: e.target.value }))} placeholder="—" /></label>}
      {esUn && g.n > 0 && Number(uns[g.k]) > 0 && <span className="mut"> · {fHM(g.prom / Number(uns[g.k]))} por unión</span>}</li>)}</ul>
    {esUn ? pj != null && <p>Medidas juntas: <b>{fHM(pj)}</b> por unión <span className="mut">(sin contar las otras piezas que ya tenga la familia)</span></p>
      : pu != null && <p>Juntas: <b>{fHM(pu)}</b> por unidad <span className="mut">(sin contar las otras piezas que ya tenga la familia)</span></p>}
    {esUn && gs.some(g => !(Number(uns[g.k]) > 0)) && <p className="note">Las piezas sin uniones quedan en la familia pero no cuentan en el promedio ni reciben tiempo estándar hasta que las cargues.</p>}
    {ops.length > 1 && <p className="note">Ojo: tienen operaciones distintas ({ops.map(o => operName(S, o)).join(', ')}). Una familia debería tener una sola.</p>}
    <label>Familia<select value={id} onChange={e => setId(e.target.value)}>{!FAMS.length ? null : <option value="">— Elegí —</option>}{FAMS.map(x => <option key={x.id} value={x.id}>{x.nombre} · {E.codsFamilia(S, x.id).length} piezas</option>)}<option value="+">+ Nueva familia…</option></select></label>
    {id === '+' && <><label>Nombre de la familia nueva<input autoFocus value={nom} onChange={e => setNom(e.target.value)} placeholder={tipo === 'union' ? 'por ejemplo Bastidor caño 40×40' : 'por ejemplo Eje motor cinta, motor 1,5 HP'} /></label><TipoFam v={tipo} set={setTipo} />
      {tipo === 'union' && <div className="row fambase"><label>Base medida (h por unión) <input type="number" min="0" step="0.01" value={base} onChange={e => setBase(e.target.value)} placeholder="opcional, por ejemplo 0,83" /></label>
        <label>vale como <input type="number" min="1" step="1" value={peso} disabled={!(Number(base) > 0)} onChange={e => setPeso(e.target.value)} /> fabricaciones</label></div>}</>}
  </Modal>;
}
// Familias: ver sus piezas, cambiarles el nombre, sacar piezas o borrar la familia (las piezas vuelven a su tiempo propio)
function FamiliasDlg({ G, onClose }) {
  const { S, up, ui, pm, stock } = useApp(); const NOM = useMemo(() => E.nombresPiezas(S), [S.tareas, S.historico, S.cotizaciones]);
  const ren = x => { const n = prompt('Nombre de la familia', x.nombre); if (n && n.trim()) up(s => ({ ...s, familias: (s.familias || []).map(f => f.id === x.id ? { ...f, nombre: n.trim() } : f) })); };
  const borrar = x => { if (!confirm(`¿Borrar la familia "${x.nombre}"? Sus piezas vuelven a tener su tiempo propio y su propio material.`)) return;
    up(s => ({ ...ponFam(s, E.codsFamilia(s, x.id), ''), familias: (s.familias || []).filter(f => f.id !== x.id) })); ui.toast('Familia borrada'); };
  const sacar = (x, k) => { up(s => ponFam(s, [k], '')); ui.toast('Pieza sacada de la familia ' + x.nombre); };
  const tipoFam = (x, t) => { if (!confirm(t === 'union' ? `¿Pasar "${x.nombre}" a familia por unión? Cada pieza va a necesitar sus uniones cargadas para tener tiempo estándar.` : `¿Pasar "${x.nombre}" a familia por pieza? Todas sus piezas van a llevar el mismo tiempo por unidad (las uniones quedan guardadas en las fichas).`)) return;
    up(s => ({ ...s, familias: (s.familias || []).map(f => { if (f.id !== x.id) return f; const r = { ...f }; if (t === 'union') r.tipo = 'union'; else delete r.tipo; return r; }) })); };
  const enterBlur = e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); e.target.blur(); } };
  const ponBase = (x, campo, v) => { const n = campo === 'basePeso' ? Math.round(Number(v)) : Math.round(Number(v) * 1000) / 1000; if ((Number(x[campo]) || 0) === (n > 0 ? n : 0)) return;
    up(s => ({ ...s, familias: (s.familias || []).map(f => { if (f.id !== x.id) return f; const r = { ...f }; if (n > 0) r[campo] = n; else delete r[campo]; return r; }) })); };
  const ponUn = (k, v) => { const n = Math.round(Number(v)); if (n === E.unionesDe(S, k) || (!(n > 0) && !E.unionesDe(S, k))) return; up(s => conFicha(s, k, { uniones: n > 0 ? n : '' })); };
  return <Modal title="Familias de tiempo" wide onClose={onClose} foot={<><span className="sp" /><button className="btn pri-b" data-enter onClick={onClose}>Listo</button></>}>
    <p className="mut">Cada familia junta piezas que se fabrican igual. Para sumar piezas: tildalas en Tiempos y Costos y tocá "Agrupar en familia", o elegí la familia en la ficha de la pieza. Para cambiar el material de la familia, abrí la ficha de una de sus piezas.</p>
    {(S.familias || []).map(x => { const ks = E.codsFamilia(S, x.id), un = E.porUnion(x), fu = un ? E.famUnion(S, x) : null, h = !un && ks.length ? E.historial(S, ks[0]) : null, fb = x.ficha || {}, it = fb.stockId && stock && stock.items ? stock.items.find(i => i.id === fb.stockId) : null;
      return <div key={x.id} className="famcard"><div className="row"><b>{x.nombre}</b>{un && <span className="tag fam">por unión</span>}<span className="mut">{un ? fu && fu.porUnion != null ? `${fHM(fu.porUnion)} (${fH2(fu.porUnion)} h) por unión · ${baseTxt(fu)}` : 'sin fabricaciones con uniones ni base' : h ? `${fHM(h.porUnidad)} por unidad · ${h.n} ${h.n === 1 ? 'vez' : 'veces'}` : 'sin fabricaciones'}</span><span className="sp" />
        {pm.admin && <><button className="btn sm" onClick={() => tipoFam(x, un ? '' : 'union')} title={un ? 'Todas las piezas con el mismo tiempo por unidad' : 'Tiempo por unión soldada × uniones de cada pieza'}>{un ? 'Pasar a por pieza' : 'Pasar a por unión'}</button><button className="btn sm" onClick={() => ren(x)}>✎ Nombre</button><button className="btn sm" onClick={() => borrar(x)}>🗑 Borrar</button></>}</div>
        {un && <div className="row fambase"><label>Base medida (h por unión) <input key={'b' + (x.base || '')} type="number" min="0" step="0.01" disabled={!pm.admin} defaultValue={x.base || ''} placeholder="por ejemplo 0,83" onBlur={e => ponBase(x, 'base', e.target.value)} onKeyDown={enterBlur} /></label>
          <label>vale como <input key={'p' + (x.basePeso || '')} type="number" min="1" step="1" disabled={!pm.admin || !x.base} defaultValue={x.basePeso || 3} onBlur={e => ponBase(x, 'basePeso', e.target.value)} onKeyDown={enterBlur} /> fabricaciones</label>
          <small className="mut">Las horas por unión arrancan en la base y cada fabricación medida las va corrigiendo.</small></div>}
        {un && fu && fu.sinK.length > 0 && <small className="tfal c-bad">{fu.sinK.length} {fu.sinK.length === 1 ? 'pieza sin uniones cargadas: no cuenta' : 'piezas sin uniones cargadas: no cuentan'} ni recibe{fu.sinK.length === 1 ? '' : 'n'} tiempo estándar.</small>}
        <small className="mut">Material de la familia: {fb.noMat ? 'no consume material de stock' : fb.stockId || fb.chapa ? (fb.chapa ? 'sale de chapa' : '') + (it ? (fb.chapa ? ' · ' : '') + nomIt(it) : fb.chapa ? '' : 'ítem de StockApp') : 'sin cargar (cada pieza el suyo)'}</small>
        <ul className="famlst">{ks.map(k => { const g = G.find(y => y.k === k); return <li key={k}><span>{NOM[k] || k.toUpperCase()}</span>{un && <label className="famun">Uniones <input key={E.unionesDe(S, k)} type="number" min="1" step="1" disabled={!pm.admin} defaultValue={E.unionesDe(S, k) || ''} placeholder="—" onBlur={e => ponUn(k, e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); e.target.blur(); } }} /></label>}
          {un && fu && fu.porUnion != null && E.unionesDe(S, k) > 0 && <span className="mut"> → {fHM(fu.porUnion * E.unionesDe(S, k))} por unidad</span>} <span className="mut">· {g && g.n ? `${fHM(g.prom)} propio (${g.n} ${g.n === 1 ? 'vez' : 'veces'})` : 'sin fabricaciones'}{E.matPropio(E.fichaPropia(S, k)) ? ' · material propio' : ''}</span>
          {pm.admin && <button className="lnk sm" onClick={() => sacar(x, k)}>sacar</button>} <button className="lnk sm" onClick={() => ui.ficha({ key: k, nombre: NOM[k] || k })}>ficha</button></li>; })}</ul></div>; })}
  </Modal>;
}
// Completar fichas desde el historial: vista previa por pieza y se aplica solo con "Aplicar"
function FichasHist({ onClose }) {
  const { S, up, ui } = useApp();
  const L = useMemo(() => E.fichasDesdeHist(S), [S]);
  const [pisar, setPisar] = useState(false); const [q, setQ] = useState(''); const [fuera, setFuera] = useState([]);
  const nueva = x => !x.actual, cambia = x => x.actual && (x.actual.material !== x.material || Number(x.actual.pesoU) !== Number(x.pesoU));
  const vale = x => (nueva(x) || (pisar && cambia(x))) && !fuera.includes(x.k);
  const nN = L.filter(x => nueva(x) && !fuera.includes(x.k)).length, nC = L.filter(x => pisar && cambia(x) && !fuera.includes(x.k)).length, nV = L.filter(x => x.varia && vale(x)).length;
  const qq = q.trim().toLowerCase(); const vis = L.filter(x => !qq || x.k.toLowerCase().includes(qq) || x.nombre.toLowerCase().includes(qq));
  const mN = id => (E.materialDe(S, id) || {}).nombre || '—';
  const fK = v => (Number(v) || 0).toLocaleString('es-AR', { maximumFractionDigits: 3 });
  const aplicar = () => { const ok = L.filter(vale); if (!ok.length) return;
    up(s => { const fs = { ...(s.fichas || {}) }; ok.forEach(x => { fs[x.k] = { ...(fs[x.k] || {}), material: x.material || (fs[x.k] || {}).material || '', pesoU: x.pesoU > 0 ? x.pesoU : (fs[x.k] || {}).pesoU ?? null }; }); return { ...s, fichas: fs }; });
    ui.toast(`Fichas completadas: ${ok.length} ${ok.length === 1 ? 'pieza' : 'piezas'}. Se deshace con Ctrl+Z.`); onClose(); };
  return <Modal title="Completar fichas desde el historial" wide onClose={onClose} foot={<><span className="mut">{nN} nuevas{pisar ? ` · ${nC} se reemplazan` : ''}{nV ? ` · ${nV} con pesos que varían` : ''}</span><span className="sp" /><button className="btn canc-b" onClick={onClose}>Cancelar</button><button className="btn pri-b" disabled={!(nN + nC)} onClick={aplicar}>Aplicar a {nN + nC} {nN + nC === 1 ? 'pieza' : 'piezas'}</button></>}>
    <p className="mut">Sale de las fabricaciones ya cargadas (historial del Costeador y tareas de la app): el material más usado y la mediana de kg ÷ cantidad como peso por unidad. Las descartadas no cuentan. Destildá las piezas que no quieras tomar; después se corrigen a mano en cada ficha.</p>
    <div className="row fhbar"><input type="search" placeholder="Buscar código o pieza" value={q} onChange={e => setQ(e.target.value)} />
      <label className="chk"><input type="checkbox" checked={pisar} onChange={e => setPisar(e.target.checked)} /> Reemplazar también las fichas ya cargadas ({L.filter(cambia).length} distintas)</label></div>
    {!L.length ? <p className="note">No hay fabricaciones con material o kg cargados.</p> : <div className="scroll"><table className="tt tfh"><thead><tr><th></th><th>Pieza</th><th className="num">Fabric.</th><th>Material</th><th className="num">Peso por unidad (kg)</th><th>Ficha actual</th></tr></thead>
      <tbody>{vis.map(x => { const v = vale(x), bloq = !nueva(x) && !(pisar && cambia(x));
        return <tr key={x.k} className={bloq ? 'fh-no' : ''}><td><input type="checkbox" aria-label={'Tomar ' + x.k} disabled={bloq} checked={v} onChange={() => setFuera(f => f.includes(x.k) ? f.filter(y => y !== x.k) : [...f, x.k])} /></td>
          <td>{x.nombre}</td><td className="num">{x.n}</td><td>{x.material ? mN(x.material) : <span className="mut">—</span>}</td>
          <td className="num">{x.pesoU > 0 ? fK(x.pesoU) : '—'}{x.varia && <small className="tfal c-bad" title="Las fabricaciones tienen pesos por unidad distintos o más de un material">varía {x.min != null && x.max != null && x.max > x.min ? `(${fK(x.min)} a ${fK(x.max)})` : ''}</small>}</td>
          <td>{x.actual ? <span className={cambia(x) ? '' : 'mut'}>{mN(x.actual.material)} · {x.actual.pesoU != null ? fK(x.actual.pesoU) + ' kg' : '—'}{!cambia(x) && ' (igual)'}</span> : <span className="mut">sin ficha</span>}</td></tr>; })}</tbody></table></div>}
  </Modal>;
}
// Cotizar una pieza no fabricada (o volver a cotizar una conocida): costos con los precios de hoy
function CotEditor({ r, onClose }) {
  const { S, up, ui, STK } = useApp(); const nueva = !r.id;
  const [c, setC] = useState(() => ({ nombre: r.nombre || '', cant: r.cant || 1, operacionId: r.operacionId || '', material: r.material || '', peso: r.peso ?? '', hh: r.hh ?? '' }));
  const set = (k, v) => setC(p => ({ ...p, [k]: v }));
  const cod = E.codOp(S, c.nombre), op = c.operacionId || (cod && cod.operacionId) || '', hist = c.nombre.trim() ? E.historial(S, c.nombre) : null;
  const sug = hist ? Math.round(hist.porUnidad * Math.max(1, Number(c.cant) || 1) * 100) / 100 : null;
  const k = E.costo(S, { ...c, operacionId: op }, STK);
  const guardar = () => { if (!c.nombre.trim()) { ui.toast('Cargá el ítem (código y descripción)'); return; }
    const d = { nombre: c.nombre.trim(), cant: Number(c.cant) || 1, operacionId: op, material: c.material, peso: c.peso === '' ? null : Number(c.peso), hh: Number(c.hh) || 0 };
    up(s => ({ ...s, cotizaciones: nueva ? [...(s.cotizaciones || []), { id: E.uid(), fecha: E.today(), ...d }] : (s.cotizaciones || []).map(x => x.id === r.id ? { ...x, ...d } : x) }));
    ui.toast(nueva ? 'Cotización guardada en Tiempos y Costos' : 'Cotización actualizada'); onClose(); };
  return <Modal title={nueva ? 'Cotizar' : 'Editar cotización'} onClose={onClose} foot={<><span className="mut">No entra en el promedio de tiempos.</span><span className="sp" /><button className="btn canc-b" onClick={onClose}>Cancelar</button><button className="btn pri-b" onClick={guardar}>Guardar</button></>}>
    <div className="form">
      <label className="g2">Ítem (código - descripción)<input id="co-nom" autoFocus value={c.nombre} placeholder="TPFR-200-040 Buje de bronce Ø40" onChange={e => set('nombre', e.target.value)} />
        {cod && <small className={cod.operacionId ? 'hint ok' : 'hint'}>Código {cod.num} → {cod.operacionId ? operName(S, cod.operacionId) : 'sin operación asignada'}</small>}</label>
      <label>Cantidad<input id="co-cant" type="number" min="1" step="1" value={c.cant} onChange={e => set('cant', e.target.value)} /></label>
      <label>Operación<select id="co-op" value={op} onChange={e => set('operacionId', e.target.value)}><option value="">—</option>{S.operaciones.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></label>
      <label>Material genérico <small className="mut">si la pieza no tiene ítem de StockApp</small><select id="co-mat" value={c.material} onChange={e => set('material', e.target.value)}><option value="">—</option>{(S.materiales || []).map(m => <option key={m.id} value={m.id}>{m.nombre}</option>)}</select></label>
      <label>Peso total (kg)<input id="co-peso" type="number" min="0" step="0.1" value={c.peso} placeholder="de toda la cantidad" onChange={e => set('peso', e.target.value)} /></label>
      <label className="g2">Horas-hombre totales<span className="incalc"><input id="co-hh" type="number" min="0" step="0.5" value={c.hh} onChange={e => set('hh', e.target.value)} /><CalcBtn cant={Number(c.cant) || 0} titulo="Horas-hombre de la cotización" onUse={v => set('hh', Math.round(v * 100) / 100)} /></span>
        {hist ? <small className="hint">{hist.n ? <>Se hizo {hist.n} {hist.n === 1 ? 'vez' : 'veces'}</> : 'Base medida, sin fabricaciones todavía'}{hist.fam ? ` (familia ${hist.fam.nombre})` : ''}: {fHM(hist.porUnidad)} por unidad{unTxt(hist)} × {fN(Number(c.cant) || 1)} = {fN(sug)} HH {Math.abs(sug - (Number(c.hh) || 0)) > 0.01 ? <button type="button" className="lnk sm" onClick={() => set('hh', sug)}>usar</button> : '(ya aplicado)'}</small>
          : c.nombre.trim() ? <small className="hint">Pieza sin historial: estimá las horas-hombre.</small> : null}</label>
    </div>
    <div className="cotres">
      <div><span className="mut">Material</span><b>{k.fuente ? fPlata(k.mat) : '—'}</b><small className="mut">{k.fuente === 'stock' ? `StockApp: ${precioTxt(k.ms)} × ${fN(Number(c.cant) || 1)} u.` : k.fuente === 'nomat' ? 'no consume material de stock' : k.m ? `precio genérico: ${fN(k.peso)} kg × ${fPlata(k.m.precio)}/kg · al ${fFecha(k.m.fecha)}` : 'elegí el material o cargale ítem de StockApp a la ficha'}</small></div>
      <div><span className="mut">Mano de obra</span><b>{k.vh ? fPlata(k.mo) : '—'}</b><small className="mut">{k.vh ? `${fN(Number(c.hh) || 0)} HH × ${fPlata(k.vh.valor)}/h · al ${fFecha(k.vh.fecha)}` : 'sin tarifa para esta operación'}</small></div>
      <div className="tot"><span className="mut">Costo total</span><b>{fPlata(k.total)}</b><small className="mut">{fPlata(k.unit)} por unidad</small></div>
    </div>
  </Modal>;
}

/* ================= APP ================= */
const TABS = [['resumen', 'Producción', 'M4 5h16v15H4zM4 10h16M9 5v15M15 5v15'], ['repuestos', 'Repuestos', 'M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9zM12 9a3 3 0 100 6 3 3 0 000-6z'], ['proyectos', 'Proyectos', 'M4 6h9M8 12h11M5 18h8'], ['postventa', 'Post Venta', 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10'], ['internos', 'Taller', 'M14.5 5.5a4 4 0 00-5.2 5.2L4 16l4 4 5.3-5.3a4 4 0 005.2-5.2l-2.7 2.7-2.3-.7-.7-2.3z'], ['operarios', 'Operarios', 'M9 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.5 3.5 0 010 6.5M18 14c1.8.8 3 2.6 3 4.7', 'Operar.'], ['tiempos', 'Tiempos y Costos', 'M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z', 'Tiempos'], ['estadisticas', 'Estadísticas', 'M4 20V10M10 20V4M16 20v-8M22 20H2', 'Estad.'], ['config', 'Configuración', 'M12 9a3 3 0 100 6 3 3 0 000-6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z', 'Config.']];
// Barra lateral (PC): cada sección con su color, como en StockApp y ComprasApp (Configuración queda gris, abajo de todo)
const TAB_COL = { resumen: '#f2b84b', repuestos: 'var(--s1)', proyectos: 'var(--s2)', postventa: 'var(--ext)', internos: 'var(--s3)', operarios: '#e37fa7', tiempos: '#8fbf5a', estadisticas: '#5ad1e8' };
// Teléfono: 4 pestañas fijas (las primeras de esta lista que el usuario puede ver) y el resto en "Más"
const TABS_TEL = ['resumen', 'repuestos', 'proyectos', 'estadisticas', 'operarios'];
const TAB_DESC = { postventa: 'Casos y envíos', internos: 'Trabajos propios', operarios: 'Trabajo del día', tiempos: 'Historial y costos', estadisticas: 'Uso de las horas', config: 'Datos, operarios y usuarios', resumen: 'Semana, carga y alertas', repuestos: 'Órdenes OV y OC', proyectos: 'Equipos y Gantt' };
const AVC = ['#5cc8c0', '#e59a57', '#b08cf0', '#e37fa7', '#8fbf5a', '#6f9df5', '#d9c15a', '#d98a8a', '#58b7e8', '#c9a0dc'];
const Av = ({ o, i, sm }) => <span className={'av' + (sm ? ' sm' : '')} style={{ '--c': AVC[i % AVC.length] }}>{(o.nombre || '?').trim().slice(0, 2).toUpperCase()}</span>;
// Planificar un proyecto completo: reparte las piezas pendientes entre los operarios respetando dependencias y promedios
function PlanificarDlg({ proyId, alcance, onClose }) {
  const { S, up, ui } = useApp(); const p = S.proyectos.find(x => x.id === proyId);
  const [hs, setHs] = useState({}); const [todas, setTodas] = useState(false); const [op, setOp] = useState(''); const [forz, setForz] = useState({});
  const run = (s, h) => alcance === 'rep' ? E.planificarRepuestos(s, h, { todas, op, forzar: forz }) : alcance === 'pv' ? E.planificarPV(s, h, { todas, op, forzar: forz }) : alcance === 'tl' ? E.planificarTL(s, h, { todas, op, forzar: forz }) : E.planificarProyecto(s, proyId, h, { todas, op, forzar: forz });
  const horas = useMemo(() => { const o = {}; Object.entries(hs).forEach(([k, v]) => { const n = Number(String(v).replace(',', '.')); if (n > 0) o[k] = n; }); return o; }, [hs]);
  const r = useMemo(() => run(S, horas), [S, proyId, alcance, horas, todas, op, forz]);
  const aplicar = () => { let n = 0; up(s => { const x = run(s, horas); n = x.plan.length; return n ? x.S : s; }); ui.toast(n ? `Plan aplicado: ${n} ${n === 1 ? 'pieza' : 'piezas'} en el Gantt. Podés deshacerlo.` : 'No había nada para planificar'); onClose(); };
  const lista = x => S.operarios.filter(o => o.activo).map(o => ({ o, n: o.op1 === x.opId ? 1 : o.op2 === x.opId ? 2 : 3 })).sort((a, b) => a.n - b.n || a.o.nombre.localeCompare(b.o.nombre));
  const orig = { cargada: 'cargada ahora', manual: 'cargada', promedio: 'promedio' };
  return <Modal title={alcance === 'rep' ? 'Planificar repuestos' : alcance === 'pv' ? 'Planificar todos los casos de Post Venta' : alcance === 'tl' ? 'Planificar todos los trabajos de Taller' : 'Planificar proyecto' + (p ? ' · ' + p.nombre : '')} onClose={onClose} wide foot={<><button className="btn canc-b" onClick={onClose}>Cancelar</button><button className="btn pri-b" disabled={!r.plan.length || r.faltan.length > 0} onClick={aplicar}>Aplicar plan</button></>}>
    <label className="row">Operación<select value={op} onChange={e => setOp(e.target.value)} aria-label="Operación a planificar"><option value="">Todas las operaciones</option>{S.operaciones.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select></label>
    <label className="row"><input type="checkbox" checked={todas} onChange={e => setTodas(e.target.checked)} /> Volver a planificar también las piezas que ya tienen día y operario</label>
    {r.avisos && r.avisos.length > 0 && <div className="aviso-b"><b>Ojo con las dependencias</b>{r.avisos.map((x, i) => <p key={i} className="mut">• {x.nombre} depende de «{x.pred}», que todavía no está planificada: el plan no la espera.</p>)}</div>}
    {r.faltan.length > 0 && <div className="aviso-b"><b>Piezas nuevas: cargales el tiempo antes de planificar</b>
      <p className="mut">No hay historial de estas piezas. Poné las horas-hombre (h) de cada una.</p>
      {r.faltan.map(f => <label key={f.id} className="row">{f.nombre}{f.cant > 1 ? ` (x${f.cant})` : ''}<input inputMode="decimal" style={{ width: 80 }} placeholder="horas" value={hs[f.id] || ''} onChange={e => setHs({ ...hs, [f.id]: e.target.value })} /></label>)}</div>}
    {r.noPudo.length > 0 && <div className="aviso-b"><b>{r.plan.length ? 'No se planificaron (el resto sí se puede aplicar):' : 'No se pueden planificar:'}</b>{r.noPudo.map(x => <p key={x.id} className="mut">• {x.nombre}: {x.motivo}</p>)}</div>}
    {r.plan.length > 0 && <><p className="mut">Cada pieza va al operario que la termine antes (operación principal o secundaria), detrás de lo que ya tiene en marcha. Termina el {fDT(r.fin)}. Podés cambiar el operario de una pieza y el resto se recalcula.</p>{Object.keys(forz).length > 0 && <p><button className="btn" onClick={() => setForz({})}>Volver a lo que sugiere el plan</button></p>}
      <div className="tbl-w"><table className="tbl"><thead><tr><th>Pieza</th><th>Operario</th><th>Inicio</th><th>Fin</th><th>Horas</th></tr></thead>
        <tbody>{r.plan.map(x => <tr key={x.id}><td>{x.nombre}</td><td><select value={x.op} onChange={e => setForz({ ...forz, [x.id]: e.target.value })} aria-label={'Operario de ' + x.nombre}>{lista(x).map(({ o, n }) => <option key={o.id} value={o.id}>{o.nombre}{n === 2 ? ' (sec.)' : n === 3 ? ' · sin esa operación' : ''}</option>)}</select>{forz[x.id] && <small className="mut"> a mano</small>}</td><td>{fDT(x.ini)}</td><td>{fDT(x.fin)}</td><td>{fN(x.hh)} <small className="mut">{orig[x.origen]}</small></td></tr>)}</tbody></table></div></>}
    {!r.plan.length && !r.faltan.length && !r.noPudo.length && <p className="mut">No hay piezas pendientes sin planificar{op ? ' de esa operación' : ''}{todas ? '' : ' (las que ya tienen día y operario no se tocan)'}.</p>}
  </Modal>;
}
/* ================= ESTADÍSTICAS ================= */
const COL_EST = { rep: 'var(--s1)', proy: 'var(--s2)', pv: 'var(--ext)', tl: 'var(--s3)', sin: 'var(--sinc)' };
const NOM_EST = { rep: 'Repuestos', proy: 'Proyectos', pv: 'Post Venta', tl: 'Taller', sin: 'Sin cargar' };
const pcE = v => v == null || isNaN(v) ? '—' : (Math.round(v * 10) / 10).toLocaleString('es-AR') + ' %';
const usdE = v => 'US$ ' + Math.round(v || 0).toLocaleString('es-AR');
const labMes = k => `${E.MESES[Number(k.slice(5)) - 1]} ${k.slice(2, 4)}`;
const TE = ['rep', 'proy', 'pv', 'tl'];
// Estadísticas → Horas por operario: por mes, cuánto dedicó cada operario a cada tipo y cuánto le quedó sin cargar (h y % de sus horas disponibles).
// Gráfico (por defecto) o tabla. "Todos": una barra por operario con el reparto del período. Un operario: su reparto del período y una barra por mes.
function EstOperarios({ R, ms }) {
  const { S } = useApp(); const [sel, setSel] = useState(''); const [tabla, setTabla] = useState(false); const [abierta, setAbierta] = useState(null); const [hov, setHov] = useState(null);
  const Z = { rep: 0, proy: 0, pv: 0, tl: 0, total: 0, disp: 0, sinCargar: 0, exceso: 0 }; const LS = [...TE, 'sin'];
  const hv = (d, k) => k === 'sin' ? d.sinCargar : d[k], base = d => d.total + d.sinCargar, pc = (d, k) => base(d) > 0 ? hv(d, k) / base(d) * 100 : null;
  const sumar = l => l.reduce((a, d) => { const r = {}; Object.keys(Z).forEach(x => { r[x] = a[x] + d[x]; }); return r; }, { ...Z });
  const ops = (S.operarios || []).map(o => { const pm = ms.map(k => ({ k, ...Z, ...((R.opMes || {})[o.id] || {})[k] })); return { o, pm, per: sumar(pm) }; }).filter(x => x.per.total > 0.005 || x.per.disp > 0.005);
  const uno = ops.find(x => x.o.id === sel); const ver = id => { setSel(id); setAbierta(null); setHov(null); };
  const filas = uno ? [...uno.pm.map(d => ({ ...d, id: d.k, nom: labMes(d.k) })), ...(uno.pm.length > 1 ? [{ ...uno.per, id: 'per', nom: 'Período', tot: true }] : [])] : [...ops.map(x => ({ ...x.per, id: x.o.id, nom: x.o.nombre, ir: true })), ...(ops.length > 1 ? [{ ...sumar(ops.map(x => x.per)), id: 'tot', nom: 'Todos', tot: true }] : [])];
  const color = k => k === 'sin' ? undefined : COL_EST[k];
  // detalle de una barra (se abre al tocarla): horas y % de cada tipo
  const detalle = d => <div className="est-ohdet">{LS.map(k => <span key={k}><i className={'est-dot' + (k === 'sin' ? ' est-sin' : '')} style={{ background: color(k) }} />{NOM_EST[k]} <b>{fN(hv(d, k))} h</b> {pcE(pc(d, k))}</span>)}{d.exceso > 0.05 && <span className="c-bad">Cargadas de más: {fN(d.exceso)} h</span>}</div>;
  // una fila de barra horizontal al 100 % de las disponibles
  const barra = d => <div key={d.id} className={'est-ohr' + (d.tot ? ' tot' : '')}>
    <span className="est-ohn">{d.ir ? <button className="lnk" onClick={() => ver(d.id)} title="Ver mes a mes">{d.nom}</button> : <b>{d.nom}</b>}</span>
    <button className="est-ohb" onClick={() => setAbierta(a => a === d.id ? null : d.id)} aria-expanded={abierta === d.id} aria-label={`${d.nom}: ` + LS.map(k => `${NOM_EST[k]} ${fN(hv(d, k))} h (${pcE(pc(d, k))})`).join(', ')}>
      {LS.map(k => hv(d, k) > 0.005 && <i key={k} className={k === 'sin' ? 'est-sin' : ''} style={{ width: pc(d, k) + '%', background: color(k) }}>{pc(d, k) >= 9 && <em>{Math.round(pc(d, k))} %</em>}</i>)}</button>
    <span className="est-ohd"><b>{d.disp > 0 ? fN(d.disp) : '—'}</b> h</span>
    {abierta === d.id && detalle(d)}</div>;
  // una barra por mes (un operario): altura = horas disponibles del mes
  const meses = () => { const pm = uno.pm, H = 170, top = Math.max(10, Math.ceil(Math.max(0, ...pm.map(d => Math.max(d.disp, base(d)))) / 20) * 20);
    return <div className="bc"><div className="bc-y" style={{ height: H }}>{[top, top / 2, 0].map(v => <span key={v} style={{ bottom: v / top * H }}>{v}</span>)}</div>
      <div className="bc-main"><div className="bc-plot" style={{ height: H }}>
        {[top, top / 2].map(v => <i key={v} className="bc-grid" style={{ bottom: v / top * H }} />)}
        {pm.map(d => { const alto = base(d); return <div key={d.k} className={'bc-g' + (hov === d.k ? ' on' : '')} onMouseEnter={() => setHov(d.k)} onMouseLeave={() => setHov(null)} onFocus={() => setHov(d.k)} onBlur={() => setHov(null)} tabIndex="0" aria-label={`${labMes(d.k)}: ${fN(d.disp)} h disponibles; ` + LS.map(k => `${NOM_EST[k]} ${fN(hv(d, k))} h`).join(', ')}>
          <div className="est-stack" style={{ height: alto / top * H }}><b className="est-tot">{d.disp > 0 ? fN(d.disp) : ''}</b>{d.sinCargar > 0 && <div className="est-sin" style={{ height: d.sinCargar / Math.max(alto, 0.0001) * 100 + '%' }} />}{[...TE].reverse().map(k => d[k] > 0 && <div key={k} style={{ height: d[k] / Math.max(alto, 0.0001) * 100 + '%', background: COL_EST[k] }} />)}</div>
          {d.disp > 0 && <i className="est-disp" style={{ bottom: d.disp / top * H }} />}
          {hov === d.k && <div className="bc-tip"><b>{labMes(d.k)}</b><span>Disponibles <em>{fN(d.disp)} h</em></span>{LS.map(k => <span key={k}><i className={k === 'sin' ? 'est-sin' : ''} style={{ background: color(k) }} />{NOM_EST[k]} <em>{fN(hv(d, k))} h · {pcE(pc(d, k))}</em></span>)}{d.exceso > 0.05 && <span className="c-bad">Cargadas de más: {fN(d.exceso)} h</span>}</div>}
        </div>; })}</div>
        <div className="bc-x">{pm.map(d => <span key={d.k}>{labMes(d.k)}</span>)}</div></div></div>; };
  return <section className="chart"><div className="sec-h"><h3>Horas por operario{uno ? ': ' + uno.o.nombre : ''}</h3>
    <div className="row"><label className="row">Operario<select value={uno ? sel : ''} onChange={e => ver(e.target.value)} aria-label="Operario"><option value="">Todos</option>{ops.map(x => <option key={x.o.id} value={x.o.id}>{x.o.nombre}</option>)}</select></label>
      <button className="btn sm" onClick={() => setTabla(!tabla)}>{tabla ? 'Ver gráfico' : 'Ver tabla'}</button></div></div>
    <div className="lgd">{TE.map(k => <span key={k}><i style={{ background: COL_EST[k] }} />{NOM_EST[k]}</span>)}<span><i className="est-sin" />Sin cargar</span>{uno && !tabla && <span><i className="est-dl" />Disponibles</span>}</div>
    {!ops.length ? <p className="mut">No hay horas ni disponibilidad de operarios en este período.</p>
      : tabla ? <div className="scroll"><table className="tt est-ot"><thead><tr><th>{uno ? 'Mes' : 'Operario'}</th><th>Reparto</th><th className="num">Disponibles</th>{LS.map(k => <th key={k} className="num">{NOM_EST[k]}</th>)}<th className="num">Cargadas de más</th></tr></thead>
        <tbody>{filas.map(d => <tr key={d.id} className={d.tot ? 'par' : ''}><td>{d.ir ? <button className="lnk" onClick={() => ver(d.id)} title="Ver mes a mes">{d.nom}</button> : d.tot ? <b>{d.nom}</b> : d.nom}</td>
          <td><span className="est-ob" role="img" aria-label={LS.map(k => `${NOM_EST[k]} ${pcE(pc(d, k))}`).join(', ')}>{LS.map(k => hv(d, k) > 0 && <i key={k} className={k === 'sin' ? 'est-sin' : ''} style={{ width: pc(d, k) + '%', background: color(k) }} title={`${NOM_EST[k]}: ${fN(hv(d, k))} h · ${pcE(pc(d, k))}`} />)}</span></td>
          <td className="num"><b>{d.disp > 0 ? fN(d.disp) : '—'}</b></td>{LS.map(k => <td key={k} className="num">{fN(hv(d, k))} h <small className="mut">{pcE(pc(d, k))}</small></td>)}
          <td className={'num' + (d.exceso > 0.05 ? ' c-bad' : '')}>{d.exceso > 0.05 ? fN(d.exceso) + ' h' : '—'}</td></tr>)}</tbody></table></div>
      : uno ? <><div className="est-oh"><div className="est-ohh"><span>Período</span><span /><span>Disponibles</span></div>{barra({ ...uno.per, id: 'per', nom: ms.length > 1 ? `${labMes(ms[0])} a ${labMes(ms[ms.length - 1])}` : labMes(ms[0] || '') , tot: false })}</div>
          {uno.pm.length > 1 ? <><h3 className="est-oh-t">Mes a mes</h3>{meses()}</> : null}</>
      : <div className="est-oh"><div className="est-ohh"><span>Operario</span><span>% de sus horas disponibles</span><span>Disponibles</span></div>{filas.map(barra)}</div>}
    <p className="mut">{uno ? <button className="lnk" onClick={() => ver('')}>← Volver a todos los operarios</button> : 'Tocá el nombre de un operario para verlo mes a mes, o su barra para ver las horas de cada tipo.'} El % es sobre las horas disponibles de cada operario (lo cargado más lo que quedó sin cargar). Son las mismas horas del calendario mensual de Operarios, donde se ven día por día.</p>
  </section>;
}
function Estadisticas() {
  const { S, V } = useApp(); const [n, setN] = useState(6); const [tabla, setTabla] = useState(false); const [hov, setHov] = useState(null); const [ft, setFt] = useState(''); const [mt, setMt] = useState(''); const [modo, setModo] = useState('pct');
  const R = useMemo(() => E.estadisticas(S, V), [S, V]); const [tabla2, setTabla2] = useState(false); const [hov2, setHov2] = useState(null);
  // meses seguidos (aunque alguno no tenga horas), los últimos n o todos
  const todos = []; if (R.meses.length) { let [y, m] = R.meses[0].split('-').map(Number); const fin = R.meses[R.meses.length - 1]; for (let g = 0; g < 120; g++) { const k = `${y}-${E.pad(m)}`; todos.push(k); if (k >= fin) break; m++; if (m > 12) { m = 1; y++; } } }
  const ms = n ? todos.slice(-n) : todos;
  const CERO = { rep: 0, proy: 0, pv: 0, tl: 0, total: 0, costo: 0, disp: 0, sinCargar: 0, exceso: 0, glob: 0 };
  const dm = ms.map(k => ({ k, ...CERO, ...R.mes[k] }));
  const per = dm.reduce((a, d) => { const r = {}; Object.keys(CERO).forEach(x => { r[x] = a[x] + d[x]; }); return r; }, { ...CERO });
  const pct = (v, t) => t > 0 ? v / t * 100 : null;
  const top = Math.max(10, Math.ceil(Math.max(0, ...dm.map(d => d.total)) / 20) * 20), H = 170;
  const opNom = k => k === '_' ? 'Sin operación' : k === '_glob' ? 'Carga global (sin operación)' : operName(S, k);
  const oper = k => (S.operarios.find(o => o.id === k) || {}).nombre || '—';
  const lista = (obj, nom) => { const l = Object.entries(obj).map(([k, h]) => ({ k, nom: nom(k), h })).sort((a, b) => b.h - a.h); const mx = Math.max(1, ...l.map(x => x.h)); return l.length ? l.map(x => <div key={x.k} className="est-bar"><span className="est-bn" title={x.nom}>{x.nom}</span><span className="pbar big"><i style={{ width: x.h / mx * 100 + '%', background: 'var(--accent)' }} /></span><b>{fN(x.h)} h</b></div>) : <p className="mut">Todavía no hay horas reales cargadas.</p>; };
  const gr = R.grupos.filter(g => !ft || g.tipo === ft);
  const totPl = R.totales.rep + R.totales.proy + R.totales.pv + R.totales.tl;
  if (!R.grupos.length) return <div className="view"><section><h2>Estadísticas</h2><p className="mut">Todavía no hay horas reales cargadas en las piezas. Las estadísticas se arman con las HH reales (Operarios, editor de la pieza, HH reales previas o carga global).</p></section></div>;
  return <div className="view">
    <section><div className="sec-h"><h2>Estadísticas de horas-hombre</h2>
      <div className="seg">{[[1, 'Último mes'], [3, '3 meses'], [6, '6 meses'], [12, '12 meses'], [0, 'Todo']].map(([k, l]) => <button key={k} className={n === k ? 'on' : ''} onClick={() => setN(k)}>{l}</button>)}</div></div>
      <div className="kpis">
        <div className="kpi grow"><span>Total del período</span><b>{fN(per.total)} h</b><em>{ms.length ? `${labMes(ms[0])} a ${labMes(ms[ms.length - 1])}` : ''}{per.disp > 0 ? ` · ${pcE(pct(per.total, per.disp))} de las horas disponibles` : ''}</em></div>
        {TE.map(k => <div key={k} className="kpi"><span><i className="est-dot" style={{ background: COL_EST[k] }} />{NOM_EST[k]}</span><b>{fN(per[k])} h</b><em>{pcE(pct(per[k], per.total))} del período · Total histórico {fN(R.totales[k])} h</em></div>)}
        <div className={'kpi' + (per.sinCargar > 0.05 ? ' warn' : '')}><span><i className="est-dot est-sin" />Sin cargar</span><b>{fN(per.sinCargar)} h</b><em>{pcE(pct(per.sinCargar, per.disp))} de las horas disponibles</em></div>
      </div>
      {per.glob > 0.05 && <p className="note">{fN(per.glob)} h del período vienen de cargas globales (horas asignadas a mano en Operarios → Calendario mensual).</p>}
      {R.sinFecha > 0 && <p className="note">{fN(R.sinFecha)} h no entran en los meses porque no tienen día: HH reales previas de proyectos viejos y piezas finalizadas sin día puntual. Sí suman en los totales de cada proyecto.</p>}</section>

    <section className="chart"><div className="sec-h"><h3>Mes a mes: cómo se usaron las horas disponibles</h3>
      <div className="seg">{[['pct', '% de las disponibles'], ['h', 'Horas']].map(([k, l]) => <button key={k} className={modo === k ? 'on' : ''} onClick={() => setModo(k)}>{l}</button>)}</div></div>
      <div className="lgd">{TE.map(k => <span key={k}><i style={{ background: COL_EST[k] }} />{NOM_EST[k]}</span>)}<span><i className="est-sin" />Sin cargar</span>{modo === 'h' && <span><i className="est-dl" />Disponibles</span>}</div>
      {dm.length < 2 ? <p className="mut est-uno">Con un solo mes no hay evolución para mostrar: el reparto de ese mes está en la torta de más abajo. Elegí 3 meses o más para ver las líneas.</p> : (() => { const W = 600, Hh = 200, L = 38, Rr = 12, T = 12, B = 24; const LS = [...TE, 'sin'], hv = (d, k) => k === 'sin' ? d.sinCargar : d[k], base = d => d.total + d.sinCargar;
        const val = (d, k) => modo === 'pct' ? (base(d) > 0 ? hv(d, k) / base(d) * 100 : 0) : hv(d, k);
        const mx = modo === 'pct' ? 100 : Math.max(10, Math.ceil(Math.max(0, ...dm.flatMap(d => [d.disp, ...LS.map(k => hv(d, k))])) / 50) * 50);
        const x = i => dm.length > 1 ? L + i * (W - L - Rr) / (dm.length - 1) : (W + L) / 2, y = v => T + (Hh - T - B) * (1 - Math.min(v, mx) / mx);
        return <svg className="est-line" viewBox={`0 0 ${W} ${Hh}`} role="img" aria-label="Evolución mensual de las horas disponibles">
          {[0, .5, 1].map(f => <g key={f}><line x1={L} x2={W - Rr} y1={y(mx * f)} y2={y(mx * f)} stroke="currentColor" strokeOpacity=".15" /><text x={L - 4} y={y(mx * f) + 3} textAnchor="end" fontSize="10" fill="currentColor" opacity=".7">{Math.round(mx * f)}{modo === 'pct' ? '%' : ''}</text></g>)}
          {modo === 'h' && <polyline fill="none" stroke="currentColor" strokeOpacity=".8" strokeWidth="1.5" strokeDasharray="5 4" points={dm.map((d, i) => `${x(i)},${y(d.disp)}`).join(' ')}><title>Horas disponibles</title></polyline>}
          {LS.map(k => <g key={k}><polyline fill="none" stroke={COL_EST[k]} strokeWidth="2.5" strokeDasharray={k === 'sin' ? '6 4' : undefined} points={dm.map((d, i) => `${x(i)},${y(val(d, k))}`).join(' ')} />
            {dm.map((d, i) => <circle key={d.k} cx={x(i)} cy={y(val(d, k))} r="3.5" fill={COL_EST[k]}><title>{labMes(d.k)} · {NOM_EST[k]}: {fN(hv(d, k))} h ({pcE(base(d) > 0 ? hv(d, k) / base(d) * 100 : null)} de las {fN(base(d))} h)</title></circle>)}</g>)}
          {dm.map((d, i) => <text key={d.k} x={x(i)} y={Hh - 8} textAnchor="middle" fontSize="10" fill="currentColor" opacity=".8">{labMes(d.k)}</text>)}</svg>; })()}
      <p className="mut">El 100 % son todas las horas disponibles del mes: lo cargado en cada tipo más lo que quedó sin cargar. Pasá el dedo o el mouse sobre un punto para ver las horas y el %.</p>
    </section>

    <section className="chart"><div className="sec-h"><h3>Horas-hombre por mes</h3><button className="btn sm" onClick={() => setTabla(!tabla)}>{tabla ? 'Ver gráfico' : 'Ver tabla'}</button></div>
      <div className="lgd">{TE.map(k => <span key={k}><i style={{ background: COL_EST[k] }} />{NOM_EST[k]}</span>)}</div>
      {tabla ? <div className="scroll"><table className="tt"><thead><tr><th>Mes</th><th className="num">Repuestos</th><th className="num">% Rep.</th><th className="num">Proyectos</th><th className="num">% Proy.</th><th className="num">Post Venta</th><th className="num">% PV</th><th className="num">Taller</th><th className="num">% Taller</th><th className="num">Total HH</th><th className="num">Disponibles</th><th className="num">Uso</th><th className="num">Mano de obra</th></tr></thead>
        <tbody>{dm.map(d => <tr key={d.k}><td>{labMes(d.k)}</td><td className="num">{fN(d.rep)}</td><td className="num">{pcE(pct(d.rep, d.total))}</td><td className="num">{fN(d.proy)}</td><td className="num">{pcE(pct(d.proy, d.total))}</td><td className="num">{fN(d.pv)}</td><td className="num">{pcE(pct(d.pv, d.total))}</td><td className="num">{fN(d.tl)}</td><td className="num">{pcE(pct(d.tl, d.total))}</td><td className="num"><b>{fN(d.total)}</b></td><td className="num">{d.disp > 0 ? fN(d.disp) : '—'}</td><td className="num">{pcE(pct(d.total, d.disp))}</td><td className="num">{usdE(d.costo)}</td></tr>)}
          <tr className="par"><td><b>Período</b></td><td className="num">{fN(per.rep)}</td><td className="num">{pcE(pct(per.rep, per.total))}</td><td className="num">{fN(per.proy)}</td><td className="num">{pcE(pct(per.proy, per.total))}</td><td className="num">{fN(per.pv)}</td><td className="num">{pcE(pct(per.pv, per.total))}</td><td className="num">{fN(per.tl)}</td><td className="num">{pcE(pct(per.tl, per.total))}</td><td className="num"><b>{fN(per.total)}</b></td><td className="num">{per.disp > 0 ? fN(per.disp) : '—'}</td><td className="num">{pcE(pct(per.total, per.disp))}</td><td className="num">{usdE(per.costo)}</td></tr></tbody></table></div>
        : <div className="bc"><div className="bc-y" style={{ height: H }}>{[top, top / 2, 0].map(v => <span key={v} style={{ bottom: v / top * H }}>{v}</span>)}</div>
          <div className="bc-main"><div className="bc-plot" style={{ height: H }}>
            {[top, top / 2].map(v => <i key={v} className="bc-grid" style={{ bottom: v / top * H }} />)}
            {dm.map(d => <div key={d.k} className={'bc-g' + (hov === d.k ? ' on' : '')} onMouseEnter={() => setHov(d.k)} onMouseLeave={() => setHov(null)} onFocus={() => setHov(d.k)} onBlur={() => setHov(null)} tabIndex="0" aria-label={`${labMes(d.k)}: ${fN(d.total)} horas-hombre`}>
              <div className="est-stack" style={{ height: d.total / top * H }}><b className="est-tot">{d.total > 0 ? fN(d.total) : ''}</b>{[...TE].reverse().map(k => d[k] > 0 && <div key={k} style={{ height: d[k] / d.total * 100 + '%', background: COL_EST[k] }} />)}</div>
              {hov === d.k && <div className="bc-tip"><b>{labMes(d.k)}</b>{TE.map(k => <span key={k}><i style={{ background: COL_EST[k] }} />{NOM_EST[k]} <em>{fN(d[k])} h · {pcE(pct(d[k], d.total))}</em></span>)}{d.disp > 0 && <span className="mut">Usó {pcE(pct(d.total, d.disp))} de {fN(d.disp)} h disponibles</span>}</div>}
            </div>)}</div>
            <div className="bc-x">{dm.map(d => <span key={d.k}>{labMes(d.k)}</span>)}</div></div></div>}
    </section>

    <section className="chart"><div className="sec-h"><h3>Horas disponibles: en qué se usaron</h3><button className="btn sm" onClick={() => setTabla2(!tabla2)}>{tabla2 ? 'Ver gráfico' : 'Ver tabla'}</button></div>
      <div className="lgd">{TE.map(k => <span key={k}><i style={{ background: COL_EST[k] }} />{NOM_EST[k]}</span>)}<span><i className="est-sin" />Sin cargar</span><span><i className="est-dl" />Disponibles</span></div>
      {(() => { const top2 = Math.max(10, Math.ceil(Math.max(0, ...dm.map(d => Math.max(d.disp, d.total + d.sinCargar))) / 50) * 50);
        if (tabla2) return <div className="scroll"><table className="tt"><thead><tr><th>Mes</th><th className="num">Disponibles</th>{TE.map(k => <th key={k} className="num">{NOM_EST[k]}</th>)}<th className="num">Sin cargar</th><th className="num">Cargadas de más</th></tr></thead>
          <tbody>{[...dm, { ...per, k: 'per' }].map(d => <tr key={d.k} className={d.k === 'per' ? 'par' : ''}><td>{d.k === 'per' ? <b>Período</b> : labMes(d.k)}</td><td className="num"><b>{d.disp > 0 ? fN(d.disp) : '—'}</b></td>{TE.map(k => <td key={k} className="num">{fN(d[k])} <small className="mut">{pcE(pct(d[k], d.disp))}</small></td>)}<td className="num">{fN(d.sinCargar)} <small className="mut">{pcE(pct(d.sinCargar, d.disp))}</small></td><td className={'num' + (d.exceso > 0.05 ? ' c-bad' : '')}>{d.exceso > 0.05 ? fN(d.exceso) : '—'}</td></tr>)}</tbody></table></div>;
        return <div className="bc"><div className="bc-y" style={{ height: H }}>{[top2, top2 / 2, 0].map(v => <span key={v} style={{ bottom: v / top2 * H }}>{v}</span>)}</div>
          <div className="bc-main"><div className="bc-plot" style={{ height: H }}>
            {[top2, top2 / 2].map(v => <i key={v} className="bc-grid" style={{ bottom: v / top2 * H }} />)}
            {dm.map(d => { const alto = d.total + d.sinCargar; return <div key={d.k} className={'bc-g' + (hov2 === d.k ? ' on' : '')} onMouseEnter={() => setHov2(d.k)} onMouseLeave={() => setHov2(null)} onFocus={() => setHov2(d.k)} onBlur={() => setHov2(null)} tabIndex="0" aria-label={`${labMes(d.k)}: ${fN(d.disp)} h disponibles, ${fN(d.sinCargar)} sin cargar`}>
              <div className="est-stack" style={{ height: alto / top2 * H }}><b className="est-tot">{d.disp > 0 ? fN(d.disp) : ''}</b>{d.sinCargar > 0 && <div className="est-sin" style={{ height: d.sinCargar / Math.max(alto, 0.0001) * 100 + '%' }} />}{[...TE].reverse().map(k => d[k] > 0 && <div key={k} style={{ height: d[k] / Math.max(alto, 0.0001) * 100 + '%', background: COL_EST[k] }} />)}</div>
              {d.disp > 0 && <i className="est-disp" style={{ bottom: d.disp / top2 * H }} />}
              {hov2 === d.k && <div className="bc-tip"><b>{labMes(d.k)}</b><span>Disponibles <em>{fN(d.disp)} h</em></span>{TE.map(k => <span key={k}><i style={{ background: COL_EST[k] }} />{NOM_EST[k]} <em>{fN(d[k])} h · {pcE(pct(d[k], d.disp))}</em></span>)}<span><i className="est-sin" />Sin cargar <em>{fN(d.sinCargar)} h · {pcE(pct(d.sinCargar, d.disp))}</em></span>{d.exceso > 0.05 && <span className="c-bad">Cargadas de más: {fN(d.exceso)} h</span>}</div>}
            </div>; })}</div>
            <div className="bc-x">{dm.map(d => <span key={d.k}>{labMes(d.k)}</span>)}</div></div></div>; })()}
      <p className="mut">El número de arriba y la raya son las horas disponibles del mes. «Sin cargar» es lo que cada operario tenía disponible y no tiene horas cargadas, sumado día por día (por ejemplo, un operario sin tarea asignada). Si la barra pasa la raya, hubo días con horas cargadas de más: revisalos en Operarios → Calendario mensual.</p>
    </section>

    <section className="chart"><div className="sec-h"><h3>Reparto de las horas disponibles</h3><span className="mut">{ms.length > 1 ? 'El período elegido y los últimos meses' : 'El mes elegido'}</span></div>
      <div className="est-pies">{[...(ms.length > 1 ? [{ ...per, k: 'per', tit: 'Período ' + (ms.length ? `${labMes(ms[0])} a ${labMes(ms[ms.length - 1])}` : '') }] : []), ...dm.slice(-3).reverse().map(d => ({ ...d, tit: labMes(d.k) }))].map(b => {
        const LS = [...TE, 'sin'], hv = k => k === 'sin' ? b.sinCargar : b[k], base = b.total + b.sinCargar; let acc = 0;
        const arcs = LS.map(k => { const v = base > 0 ? hv(k) / base * 100 : 0; const a = { k, v, off: 25 - acc }; acc += v; return a; });
        return <div key={b.k} className={'est-pc2' + (b.k === 'per' ? ' per' : '')}><b className="est-pt">{b.tit}</b>
          <svg viewBox="-1 -1 38 38" role="img" aria-label={`Reparto de ${b.tit}`}><circle cx="18" cy="18" r="15.9155" fill="none" stroke="var(--line, #8883)" strokeWidth="5" />
            {arcs.map(a => a.v > 0 && <circle key={a.k} cx="18" cy="18" r="15.9155" fill="none" stroke={a.k === 'sin' ? 'var(--sinc)' : COL_EST[a.k]} strokeOpacity={a.k === 'sin' ? .55 : 1} strokeWidth="5" strokeDasharray={`${a.v} ${100 - a.v}`} strokeDashoffset={a.off}><title>{NOM_EST[a.k]}: {fN(hv(a.k))} h · {pcE(a.v)}</title></circle>)}
            <text x="18" y="17.6" textAnchor="middle" fontSize="4.4" fontWeight="700" fill="currentColor">{fN(base)} h</text><text x="18" y="22" textAnchor="middle" fontSize="2.6" fill="currentColor" opacity=".7">disponibles</text></svg>
          <div className="est-pl">{arcs.map(a => <div key={a.k}><i className={'est-dot' + (a.k === 'sin' ? ' est-sin' : '')} style={a.k === 'sin' ? undefined : { background: COL_EST[a.k] }} /><span className="est-pn">{NOM_EST[a.k]}</span><span>{fN(hv(a.k))} h</span><em>{pcE(a.v)}</em></div>)}</div>
          {b.exceso > 0.05 && <p className="mut c-bad">{fN(b.exceso)} h cargadas de más</p>}</div>; })}</div>
    </section>

    <EstOperarios R={R} ms={ms} />

    <section><h3>Cómo leer estos gráficos</h3>
      <p className="mut"><b>Barras por mes:</b> cada barra es un mes y su altura son las horas-hombre (HH) de ese mes. Los colores muestran cuánto fue de cada tipo; el número de arriba es el total del mes. Si una barra es más alta que otra, se trabajó más ese mes; si cambian los colores, cambió el reparto.</p>
      <p className="mut"><b>Disponibles, en qué se usaron:</b> cada barra es todo lo que la planta podía trabajar en el mes, separado en lo que se dedicó a cada tipo y lo que quedó sin cargar. Sirve para ver cuánto se usó de la capacidad y si faltan horas por cargar.</p>
      <p className="mut"><b>Tortas:</b> la primera es el período elegido y las otras, los últimos meses. Cada una reparte el 100 % de las horas disponibles entre Repuestos, Proyectos, Post Venta, Taller y lo que quedó sin cargar.</p>
      <p className="mut"><b>Líneas (arriba de todo):</b> siguen cada tipo y las horas sin cargar mes a mes. En «% de las disponibles» las cinco suman 100 % en cada mes; en «Horas» muestran las horas absolutas y la línea punteada blanca son las disponibles.</p>
      <p className="mut"><b>Horas disponibles:</b> lo que los operarios activos podían trabajar en el mes (jornada normal más extras habilitadas, menos ausencias, feriados y días en que no vienen), hasta hoy. Las cargas globales suman como horas reales de su destino. <b>Uso</b> = HH reales ÷ horas disponibles. Ojo: las HH reales son horas-hombre, así que si dos operarios hacen una pieza juntos cuentan las dos.</p>
    </section>

    <section><div className="sec-h"><h2>Repuestos, proyectos, post venta y taller</h2>
      <div className="seg">{[['', 'Todos'], ['rep', 'Repuestos'], ['proy', 'Proyectos'], ['pv', 'Post Venta'], ['tl', 'Taller']].map(([k, l]) => <button key={k} className={ft === k ? 'on' : ''} onClick={() => setFt(k)}>{l}</button>)}</div></div>
      <p className="mut">El % es la parte de todas las horas de la planta que se llevó cada proyecto entre su primer inicio y su último fin. El desvío compara lo real contra lo proyectado, solo en piezas ya finalizadas.</p>
      <div className="scroll"><table className="tt"><thead><tr><th>Nombre</th><th>Período</th><th className="num">HH reales</th><th>% de la planta en su período</th><th className="num">Proyectado</th><th className="num">Desvío</th><th className="num">Mano de obra</th></tr></thead>
        <tbody>{gr.map(g => <tr key={g.k}><td><i className="est-dot" style={{ background: COL_EST[g.tipo] }} />{g.nombre}{g.previas > 0 && <small className="mut"> · incluye {fN(g.previas)} h previas</small>}{g.glob > 0 && <small className="mut"> · incluye {fN(g.glob)} h de carga global</small>}</td>
          <td>{g.ini ? `${E.fD(g.ini)} → ${E.fD(g.fin)}` : '—'}</td><td className="num"><b>{fN(g.total)}</b></td>
          <td>{g.pct == null ? <span className="mut">{g.tipo === 'rep' ? `${pcE(pct(g.total, totPl))} del total histórico` : '—'}</span> : <span className="est-pc"><span className="pbar big"><i style={{ width: Math.min(100, g.pct) + '%', background: COL_EST[g.tipo] }} /></span><b>{pcE(g.pct)}</b></span>}</td>
          <td className="num">{g.plan > 0 ? fN(g.plan) : '—'}</td><td className={'num ' + (g.desvio == null ? '' : g.desvio > 2 ? 'c-bad' : g.desvio < -2 ? 'c-ok' : '')}>{g.desvio == null ? '—' : (g.desvio > 0 ? '+' : '') + pcE(g.desvio)}</td>
          <td className="num">{usdE(g.costo)}{g.sinTarifa > 0 && <small className="mut" title="Horas de piezas sin operación o sin tarifa cargada"> *</small>}</td></tr>)}</tbody></table></div>
      {gr.some(g => g.sinTarifa > 0) && <p className="note">* Hay horas de piezas sin operación o sin tarifa cargada: no suman a la mano de obra. Se corrigen en Configuración → Tarifas y Operaciones.</p>}
    </section>

    <section className="cfg">
      <div className="card"><h3>HH por operación</h3>{lista(R.ops, opNom)}</div>
      <div className="card"><h3>HH por operario</h3><p className="mut">Cuando una pieza la hacen varios, sus horas se reparten en partes iguales.</p>{lista(R.opers, oper)}</div>
    </section>
  </div>;
}
export function App({ db, ses, S0 }) {
  const [S, setS] = useState(() => S0 || db.inicial()); const ref = useRef(S); const hist = useRef([]); const fut = useRef([]); const local = useRef(false); const malas = useRef(null); const prevT = useRef(null); const [nh, setNh] = useState(0); const [nf, setNf] = useState(0);
  const [tab, setTab] = useState(() => { let h = (location.hash || '').slice(1); if (h === 'taller') h = 'operarios'; /* la pestaña Taller de antes ahora es Operarios */ return TABS.some(t => t[0] === h) ? h : 'resumen'; });
  const [modal, setModal] = useState(null); const [toast, setToast] = useState(null); const [aviso, setAviso] = useState(null);
  const [uid, setUid] = useState(() => { try { return localStorage.getItem(KEY + '-uid') || 'u1'; } catch (e) { return 'u1'; } });
  const yo = ses ? (S.usuarios.find(u => u.email === ses.email) || (ses.dueno ? { id: ses.email, email: ses.email, nombre: ses.nombre || 'Dueño', admin: true } : { id: ses.email, email: ses.email, nombre: ses.email, admin: false, rep: 'ver', proy: 'ver' }))
    : (S.usuarios.find(u => u.id === uid) || S.usuarios.find(u => u.admin) || S.usuarios[0]);
  if (ses && ses.dueno) yo.admin = true;
  const pm = { admin: !!yo.admin, rep: !!yo.admin || yo.rep === 'editar', proy: !!yo.admin || yo.proy === 'editar' }; const pmRef = useRef(pm); pmRef.current = pm; const yoRef = useRef(yo); yoRef.current = yo;
  const [tk, setTk] = useState(0); useEffect(() => { const i = setInterval(() => setTk(x => x + 1), 60000); return () => clearInterval(i); }, []);
  const V = useMemo(() => E.derive(S), [S, tk]);   // tk: al pasar el tiempo, "sigue en proceso" se recalcula
  // una pieza en proceso que se pasó de hora sigue ocupando el día: corre lo que viene detrás (solo el admin; no entra al deshacer)
  useEffect(() => { if (!pmRef.current.admin) return; const p = ref.current, r = E.sostener(p); if (!r.n) return; ref.current = r.S; setS(r.S); db.escribir(p, r.S, setToast); }, [S, tk]);
  // si un cambio propio deja una tarea en horas extra sin extras habilitadas, se ofrece habilitarlas
  useEffect(() => { const ahora = new Set(S.tareas.filter(t => t.turno === 'extra' && t.ops.length && t.inicio && t.estado !== 'terminada' && V.D[t.id] && !V.D[t.id].parent && !V.D[t.id].ok).map(t => t.id));
    const antes = malas.current; malas.current = ahora; const tp = prevT.current; prevT.current = S.tareas; if (!antes || !local.current) { local.current = false; return; } local.current = false;
    if (tp) { const vie = new Set(tp); if (S.tareas.filter(t => !vie.has(t)).length > 30) return; } /* cambios masivos (restaurar, importar): no se pregunta */
    const nuevas = [...ahora].filter(i => !antes.has(i)); if (nuevas.length && nuevas.length <= 8) setAviso(nuevas); /* muchas de golpe (restaurar una copia, importar): se ven con la marca !h */ }, [V]);
  const up = useCallback(fn => { const p = ref.current, n = fn(p); if (n === p) return; const err = permiso(p, n, pmRef.current); if (err) { setToast(err); return; } const d = describir(p, n); let n2 = n.log === p.log ? n : { ...n, log: p.log };
    if (d) { const yo = yoRef.current, now = Date.now(), log = p.log || [], junta = log[0] && log[0].uid === yo.id && log[0].k === d.k && now - log[0].ts < 90000, e = { id: junta ? log[0].id : now + '-' + E.uid(), ts: now, uid: yo.id, email: yo.email || '', quien: yo.nombre, k: d.k, txt: d.txt }; n2 = { ...n2, log: junta ? [e, ...log.slice(1)] : [e, ...log].slice(0, 300) }; }
    local.current = true; hist.current = [...hist.current.slice(-39), { s: p, txt: d ? d.txt : 'último cambio' }]; fut.current = []; setNf(0); ref.current = n2; setS(n2); setNh(hist.current.length); db.escribir(p, n2, setToast); }, []);
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
  const [conf, setConf] = useState(null);
  const [fichaAb, setFichaAb] = useState(null);   // ficha de material abierta encima de cualquier ventana
  const ui = useMemo(() => ({ modal: setModal, toast: setToast, confirmar: setConf, ficha: setFichaAb, tab: k => { setTab(k); try { history.replaceState(null, '', '#' + k); } catch (e) { } } }), []);
  const close = useCallback(() => setModal(null), []);
  const [tema, setTema] = useState(leerTema); useEffect(() => { ponerTema(tema); }, [tema]);
  const cambiarTema = useCallback(n => { setTema(n); try { localStorage.setItem(TEMA_K, n); } catch (e) { } }, []); const [mas, setMas] = useState(false);
  const act = E.seasonNow(S), h = S.cfg.horarios[act];
  const verT = pm.admin || pm.rep || pm.proy;   // Tiempos: solo quienes planifican (no los de solo consulta)
  const soloT = k => k === 'tiempos' || k === 'estadisticas'; const tabs = TABS.filter(t => !soloT(t[0]) || verT); const tabV = soloT(tab) && !verT ? 'resumen' : tab;
  // stock de StockApp (solo lectura) para el aviso de material: solo para quienes planifican
  const [stock, setStock] = useState(null);
  useEffect(() => { if (!db.stock || !verT) { setStock(null); return; } return db.stock(setStock); }, [verT]);
  const NE = useMemo(() => stock && stock.items ? E.necesidades(S, stock.items) : null, [S.tareas, S.fichas, S.proyectos, S.cfg, stock]);
  const STK = useMemo(() => E.stkIdx(stock), [stock]);   // ítems de StockApp con su precio y el dólar, para el costo de material
  const fijas = TABS_TEL.filter(k => tabs.some(t => t[0] === k)).slice(0, 4); const irA = k => { setMas(false); setTab(k); try { history.replaceState(null, '', '#' + k); } catch (e) { } };
  return <Ctx.Provider value={{ S, V, up, ui, ses, pm, tema, cambiarTema, stock, NE, STK }}>
    <div className="app" style={{ '--accent': S.cfg.accent }}>
      <header className="top">
        <h1><Logo />Producción<span>App</span></h1>
        <nav className="tabs">{tabs.map(([k, l, d, c]) => <button key={k} className={(tabV === k ? 'on' : '') + (fijas.includes(k) ? '' : ' nf') + (k === 'config' ? ' cfg' : '')} style={TAB_COL[k] ? { '--c': TAB_COL[k] } : undefined} onClick={() => irA(k)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg><span className="tl">{l}</span><span className="ts">{c || l}</span></button>)}
          <button className={'mas' + (fijas.includes(tabV) ? '' : ' on') + (mas ? ' ab' : '')} onClick={() => setMas(m => !m)} aria-expanded={mas} aria-label="Más secciones"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h.01M12 6h.01M19 6h.01M5 12h.01M12 12h.01M19 12h.01M5 18h.01M12 18h.01M19 18h.01" /></svg><span className="tl">Más</span></button></nav>
        <div className="top-r">{S.ejemplo !== false && <span className="tag ej">Datos de ejemplo</span>}
          {ses ? <span className="tag yo" title={yo.email}>{yo.nombre}</span> : <label className="inl vercomo" title="En esta vista previa elegís el usuario a mano para probar los permisos. En la etapa 2 lo decide el mail con el que cada uno inicia sesión.">Ver como<select id="ver-como" value={yo.id} onChange={e => { setUid(e.target.value); try { localStorage.setItem(KEY + '-uid', e.target.value); } catch (err) { } }}>{S.usuarios.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}</select></label>}
          {!pm.admin && <span className="tag warn">{pm.rep && pm.proy ? 'Edita todo, sin configuración' : pm.rep ? 'Edita Repuestos y Producción' : pm.proy ? 'Edita Proyectos' : 'Solo consulta'}</span>}
          <span className="undo"><button className="btn" onClick={undo} disabled={!nh} title={nh ? 'Deshacer (Ctrl+Z): ' + hist.current[hist.current.length - 1].txt : 'Nada para deshacer'} aria-label="Deshacer">↶</button><button className="btn" onClick={redo} disabled={!nf} title={nf ? 'Rehacer (Ctrl+Y): ' + fut.current[fut.current.length - 1].txt : 'Nada para rehacer'} aria-label="Rehacer">↷</button></span>{verT && <MatBtn />}<Hermanas /></div>
      </header>
      {mas && <div className="mas-ovl" onClick={() => setMas(false)}><div className="mas-hoja" role="dialog" aria-label="Más secciones" onClick={e => e.stopPropagation()}><i className="mas-grab" /><h3>Más secciones</h3>
        {tabs.filter(t => !fijas.includes(t[0])).map(([k, l, d]) => <button key={k} className={'mas-it' + (tabV === k ? ' on' : '')} onClick={() => irA(k)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg><span><b>{l}</b><small>{TAB_DESC[k]}</small></span></button>)}</div></div>}
      <main>{tabV === 'resumen' ? <Resumen /> : tabV === 'repuestos' ? <Repuestos /> : tabV === 'proyectos' ? <Proyectos key="proy" /> : tabV === 'postventa' ? <Proyectos key="pv" pv /> : tabV === 'internos' ? <Proyectos key="tl" tl /> : tabV === 'operarios' ? <Operarios /> : tabV === 'tiempos' ? <Tiempos /> : tabV === 'estadisticas' ? <Estadisticas /> : <Config />}</main>
      {modal && modal.k === 'task' && <TaskEditor key={modal.id || modal.draft.id} id={modal.id} draft={modal.draft} onClose={close} />}
      {modal && modal.k === 'op' && <OperarioPanel id={modal.id} onClose={close} />}
      {modal && modal.k === 'pick' && <Picker {...modal} onClose={close} />}
      {modal && modal.k === 'hoy' && <Hoy onClose={close} />}
      {modal && modal.k === 'frenar' && <FrenarDlg id={modal.id} pausa={false} onClose={close} />}
      {modal && modal.k === 'tercerizar' && <TercerizarDlg id={modal.id} ids={modal.ids} onClose={close} />}
      {modal && modal.k === 'retomar' && <RetomarDlg id={modal.id} onClose={close} />}
      {modal && modal.k === 'corte' && <CorteDlg id={modal.id} onClose={close} />}
      {modal && modal.k === 'meter' && <MeterDlg {...modal} onClose={close} />}
      {modal && modal.k === 'extras' && <ExtrasAviso ids={modal.ids} onClose={close} />}
      {aviso && <ExtrasAviso ids={aviso} onClose={() => setAviso(null)} />}
      {modal && modal.k === 'lote' && <LoteEditor ids={modal.ids} titulo={modal.titulo} onClose={close} />}
      {modal && modal.k === 'imp' && <Importer mode={modal.mode} proyId={modal.proyId} onClose={close} />}
      {modal && modal.k === 'asig' && <AsigDlg {...modal} onClose={close} />}
      {modal && modal.k === 'salida' && <SalidaDlg key={modal.id || 'nueva'} {...modal} onClose={close} />}
      {modal && modal.k === 'retiro' && <RetiroDlg opId={modal.opId} onClose={close} />}
      {modal && modal.k === 'material' && <MaterialDlg onClose={close} />}
      {modal && modal.k === 'plan' && <PlanificarDlg proyId={modal.proyId} alcance={modal.alcance} onClose={close} />}
      {fichaAb && <FichaDlg k={fichaAb.key} nombre={fichaAb.nombre} onClose={() => setFichaAb(null)} />}
      {verT && !modal && !fichaAb && <MatAlerta />}
      {conf && <ConfirmarDlg {...conf} onClose={() => setConf(null)} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  </Ctx.Provider>;
}
