// Entrada de la vista previa: guarda en este navegador
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App, loadState } from './App.jsx';
const KEY = 'produccionapp-preview-v2';
const db = { inicial: loadState, escribir: (p, n) => { try { localStorage.setItem(KEY, JSON.stringify(n)); } catch (e) { } } };
createRoot(document.getElementById('root')).render(<App db={db} />);
