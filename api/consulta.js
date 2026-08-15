// Función serverless: la misma lógica que `server.js`, sin proceso permanente.
//
// Cada instancia fría vuelve a pedir la cookie de sesión de Cineplanet; las
// tibias la reutilizan porque el módulo queda en memoria entre invocaciones.

import { resolve as resolveQuery } from '../src/resolve.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ estado: 'error', mensaje: 'Método no permitido' });
  }
  try {
    const { texto, contexto } = req.body ?? {};
    if (typeof texto !== 'string' || !texto.trim()) {
      return res.status(400).json({ estado: 'error', mensaje: 'Escribe qué quieres ver.' });
    }
    const respuesta = await resolveQuery(texto.slice(0, 300), {
      contexto: contexto && typeof contexto === 'object' ? contexto : null,
    });
    contar(respuesta);
    return res.status(200).json(respuesta);
  } catch (err) {
    const caido = /cookie de sesión|rechazó/.test(err.message);
    return res.status(caido ? 503 : 500).json({
      estado: 'error',
      mensaje: caido
        ? 'Cineplanet no está respondiendo ahora mismo. Intenta en unos minutos.'
        : 'No pude resolver esa consulta.',
    });
  }
}

// Conteo en memoria de la instancia. Sin disco compartido no puede ser exacto —
// es para sugerir, no para medir, así que basta con que sea aproximado.
export const populares = new Map();

function contar(respuesta) {
  const p = respuesta?.pedido;
  if (!p?.pelicula || !p?.cine) return;
  const clave = `${p.pelicula} en ${p.cine}`;
  populares.set(clave, (populares.get(clave) ?? 0) + 1);
}
