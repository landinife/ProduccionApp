// Entrada de la vista previa: guarda en este navegador
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App, loadState } from './App.jsx';
const KEY = 'produccionapp-preview-v2';
// Vista previa del aviso de material: ítems de ejemplo con el formato de StockApp y fichas para algunas piezas de ejemplo
const STOCK = [
  { id: 's1', codigo: 'AC-0012', descripcion: 'Macizo Ø50 SAE 1045', area: 'aceros', formato: 'Barra redonda', medidas: { diametro: 50, largo: 6000 }, unidad: 'm', kgm: 15.41, costo: 21.5, moneda: 'USD', costoInfo: { origen: 'ComprasApp', oc: 'OC 0153', fecha: Date.parse('2026-11-20') }, stock: 1.2, reservas: [{ id: 'rv1', destino: 'Transportador aéreo 120 m', cantidad: 0.5 }] },
  { id: 's2', codigo: 'NF-0003', descripcion: 'Buje bronce SAE 64 Ø45', area: 'noferrosos', formato: 'Barra redonda', medidas: { diametro: 45, largo: 3000 }, unidad: 'm', kgm: 13.9, costo: 165000, moneda: 'ARS', costoInfo: { origen: 'StockApp', fecha: Date.parse('2026-11-10') }, stock: 2, reservas: [], pedidoCurso: { fecha: '2026-11-12' } },
  { id: 's3', codigo: 'AC-0031', descripcion: 'Macizo Ø60 SAE 1045', area: 'aceros', formato: 'Barra redonda', medidas: { diametro: 60, largo: 6000 }, unidad: 'm', stock: 0.8, reservas: [{ id: 'rv2', destino: 'Escaldadora 6000 aves/h', cantidad: 0.3 }] },
  { id: 's4', codigo: 'AC-0040', descripcion: 'Macizo Ø30 AISI 304', area: 'aceros', formato: 'Barra redonda', medidas: { diametro: 30, largo: 6000 }, unidad: 'un', kgm: 5.61, costo: 168.3, moneda: 'USD', stock: 3, reservas: [] },
  { id: 's5', codigo: 'AC-0007', descripcion: 'Macizo Ø20 AISI 304', area: 'aceros', formato: 'Barra redonda', medidas: { diametro: 20, largo: 6000 }, unidad: 'm', kgm: 2.49, costo: 11.2, moneda: 'USD', costoInfo: { origen: 'ComprasApp', oc: 'OC 0149', fecha: Date.parse('2026-11-05') }, stock: 14, reservas: [] },
  { id: 's6', codigo: 'AC-0101', descripcion: 'Chapa AISI 304 2 mm', area: 'aceros', formato: 'Chapa', medidas: { espesor: 2, ancho: 1500, largo: 3000 }, unidad: 'un', kgUn: 71.4, costo: 420, moneda: 'USD', stock: 6, reservas: [] }
];
const FICHAS = {
  'TPFR-200-110-020-0015': { stockId: 's4', largoU: 450 }, 'TPFR-200-110-020-0040': { stockId: 's2', largoU: 60 }, 'TPFR-210-130-010-0008': { stockId: 's3', largoU: 30 },
  'TPFR-120-150-010-0031': { chapa: true, stockId: 's6', pesoU: 1.8 }, 'esc-131 eje torneado': { stockId: 's1', largoU: 220 }, 'esc-132 buje torneado': { stockId: 's5', largoU: 35 }, 'esc-220 plegado de laterales': { noMat: true }
};
const conMaterial = S => {
  const fichas = { ...(S.fichas || {}) }; Object.entries(FICHAS).forEach(([k, f]) => { if (!fichas[k] || !fichas[k].stockId && !fichas[k].chapa) fichas[k] = { ...(fichas[k] || {}), ...f }; });
  return { ...S, fichas, cfg: { ...S.cfg, corte: S.cfg.corte || { def: 3, rangos: [{ hasta: 50, mm: 3 }, { hasta: 200, mm: 5 }] } } };
};
const db = { inicial: () => conMaterial(loadState()), escribir: (p, n) => { try { localStorage.setItem(KEY, JSON.stringify(n)); } catch (e) { } }, stock: cb => { cb({ items: STOCK, dolar: 1200, ts: Date.now() }); return () => { }; } };
createRoot(document.getElementById('root')).render(<App db={db} />);
