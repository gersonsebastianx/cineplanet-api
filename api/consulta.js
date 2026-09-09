// Función serverless: la misma lógica que `server.js`, sin proceso permanente.
//
// Cada instancia fría vuelve a pedir la cookie de sesión de Cineplanet; las
// tibias la reutilizan porque el módulo queda en memoria entre invocaciones.

import { resolve as resolveQuery } from '../src/resolve.js';
import { anotar } from '../src/bitacora.js';

// Una consulta dispara varias llamadas a Cineplanet, así que conviene no
// exigirles de más — ni dejar que una sola persona agote la paciencia de su
// plataforma para todos los demás. El servidor permanente ya lo hacía; acá
// faltaba, y es justo el día de un lanzamiento cuando se nota.
//
// Cada instancia lleva su propia cuenta: en serverless no hay memoria
// compartida, así que esto no frena un ataque repartido. Frena lo que de
// verdad pasa —una pestaña recargando en bucle, un script curioso— y no
// molesta a nadie que esté usando la web como se usa.
const VENTANA_MS = 60_000;
const MAXIMO = 40;
const golpes = new Map();

/**
 * Se cuenta por conversación, no por IP. En el Perú media ciudad navega por
 * datos móviles detrás de la misma IP de operadora: contar por IP el día de un
 * lanzamiento sería bloquear a desconocidos que no hicieron nada. La sesión es
 * un número al azar del navegador —quien quiera saltárselo puede— pero lo que
 * hay que frenar es una pestaña en bucle o un script curioso, y para eso basta.
 * Lo que llega sin sesión no es una persona usando la web: eso sí se cuenta por
 * IP, que es más estricto.
 */
function permitido(quien) {
  const ahora = Date.now();
  const suyos = (golpes.get(quien) ?? []).filter((t) => ahora - t < VENTANA_MS);
  suyos.push(ahora);
  golpes.set(quien, suyos);
  // La instancia puede vivir horas: sin esto, el mapa crece sin fin.
  if (golpes.size > 5000) golpes.clear();
  return suyos.length <= MAXIMO;
}

const deQuien = (req, sesion) => {
  if (typeof sesion === 'string' && sesion.length >= 6) return `s:${sesion.slice(0, 40)}`;
  const fwd = req.headers['x-forwarded-for'];
  return `ip:${(typeof fwd === 'string' && fwd.split(',')[0].trim()) || 'anon'}`;
};

/**
 * La bitácora no puede hacer esperar a nadie. Escribe en una hoja de Google, y
 * si Google tarda, ese retraso lo paga la persona que está buscando su función.
 * Se le da un plazo corto: si no llegó, la respuesta sale igual y la escritura
 * termina sola si le da tiempo.
 */
const sinHacerEsperar = (promesa, ms = 1500) =>
  Promise.race([promesa.catch(() => {}), new Promise((listo) => setTimeout(listo, ms))]);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ estado: 'error', mensaje: 'Método no permitido' });
  }
  try {
    const { texto, contexto, sesion, elegido } = req.body ?? {};
    if (!permitido(deQuien(req, sesion))) {
      return res
        .status(429)
        .json({ estado: 'error', mensaje: 'Demasiadas consultas seguidas. Espera un momento.' });
    }
    if (typeof texto !== 'string' || !texto.trim()) {
      return res.status(400).json({ estado: 'error', mensaje: 'Escribe qué quieres ver.' });
    }
    const respuesta = await resolveQuery(texto.slice(0, 300), {
      contexto: contexto && typeof contexto === 'object' ? contexto : null,
      // Lo pulsado viaja con identificador: pulsar un botón no debe volver a
      // pasar por el intérprete.
      elegido: elegido && typeof elegido === 'object' ? elegido : null,
    });
    registrar(texto, respuesta);
    // La web siempre manda una sesión; lo que llega sin ella no es una persona
    // usando la página sino una comprobación —un curl de verificación, un
    // monitor— y va a la pestaña de pruebas. Veinte sondas de despliegue se
    // colaron entre las consultas reales antes de que esto existiera.
    await sinHacerEsperar(anotar({ sesion, texto, respuesta }, sesion ? null : 'Pruebas'));
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
