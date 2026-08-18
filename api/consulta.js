// Función serverless: la misma lógica que `server.js`, sin proceso permanente.
//
// Cada instancia fría vuelve a pedir la cookie de sesión de Cineplanet; las
// tibias la reutilizan porque el módulo queda en memoria entre invocaciones.

import { resolve as resolveQuery } from '../src/resolve.js';
import { anotar } from '../src/bitacora.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ estado: 'error', mensaje: 'Método no permitido' });
  }
  try {
    const { texto, contexto, sesion } = req.body ?? {};
    if (typeof texto !== 'string' || !texto.trim()) {
      return res.status(400).json({ estado: 'error', mensaje: 'Escribe qué quieres ver.' });
    }
    const respuesta = await resolveQuery(texto.slice(0, 300), {
      contexto: contexto && typeof contexto === 'object' ? contexto : null,
    });
    registrar(texto, respuesta);
    // La web siempre manda una sesión; lo que llega sin ella no es una persona
    // usando la página sino una comprobación —un curl de verificación, un
    // monitor— y va a la pestaña de pruebas. Veinte sondas de despliegue se
    // colaron entre las consultas reales antes de que esto existiera.
    await anotar({ sesion, texto, respuesta }, sesion ? null : 'Pruebas');
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

/**
 * Una línea por consulta en los logs del hosting. Sin IP, sin identificador de
 * persona y sin nada que permita seguir a alguien entre consultas.
 *
 * La frase cruda sólo se guarda cuando **no** se pudo resolver: es justo la que
 * sirve para arreglar el intérprete, y sin ella los fallos son invisibles.
 */
function registrar(texto, r) {
  const resuelto = r.estado === 'ok';
  const linea = {
    t: 'consulta',
    estado: r.estado,
    pelicula: r.pedido?.pelicula ?? r.intent?.movie?.title ?? null,
    cine: r.pedido?.cine ?? r.intent?.cinema?.name ?? null,
    ajuste: r.ajuste ?? null,
    // Sólo lo que falló, y recortado.
    frase: resuelto ? null : texto.slice(0, 120),
  };
  console.log(JSON.stringify(linea));
}
