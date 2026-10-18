// Entrada de la versión web: inicio de sesión + datos en Firebase
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App, Login, Inicio, Pantalla, Cargando } from '../App.jsx';
import * as FB from './datos-firebase.js';

function Gate() {
  const [u, setU] = useState(undefined); const [st, setSt] = useState({ fase: 'cargando' });
  useEffect(() => FB.onAuth(x => { setU(x || null); if (x) FB.iniciar(); else FB.detener(); }), []);
  useEffect(() => FB.onEstado(setSt), []);
  const email = u && (u.email || '').toLowerCase(), dueno = email === FB.DUENO;
  const yo = u && { email, nombre: u.displayName || email.split('@')[0] };
  useEffect(() => { if (dueno && st.fase === 'listo' && !st.S.usuarios.some(x => x.email === email)) FB.asegurarDueno(yo); }, [dueno, st]);
  if (u === undefined) return <Cargando txt="Cargando…" />;
  if (!u) return <Login google={FB.google} entrar={FB.entrar} reset={FB.reset} />;
  if (st.fase === 'cargando') return <Cargando />;
  if (st.fase === 'sinacceso') return <Pantalla><p>El mail <b>{email}</b> no tiene acceso a ProducciónApp.</p><p className="mut">Pedile al administrador que te agregue en Configuración → Usuarios.</p><button className="btn big" onClick={FB.salir}>Salir y entrar con otro usuario</button></Pantalla>;
  if (st.fase === 'error') return <Pantalla><p>No se pudieron cargar los datos.</p><p className="mut">{st.error}</p><button className="btn big" onClick={() => location.reload()}>Reintentar</button><button className="btn big" onClick={FB.salir}>Cerrar sesión</button></Pantalla>;
  if (st.fase === 'sinconfig') return <Inicio dueno={dueno} elegir={S => FB.inicializar(S, yo)} />;
  const ses = { email, dueno, nombre: yo.nombre, salir: FB.salir, crearCuenta: FB.crearCuenta, reset: FB.reset };
  return <App S0={st.S} db={{ escribir: FB.escribir, escuchar: FB.escuchar }} ses={ses} />;
}
createRoot(document.getElementById('root')).render(<Gate />);
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { }));
