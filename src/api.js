// Cliente de la API pública de Cineplanet.
//
// No es una API oficial para terceros: son los mismos endpoints que consume la
// web. Sólo se leen datos (cartelera, cines, funciones, mapas de butacas); nada
// de esto reserva ni compra.
//
// Detalle importante: /cache/moviescache responde 403 si no se visita primero
// la portada. Hay que tomar la cookie de sesión y reenviarla.

import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const SITE = 'https://www.cineplanet.com.pe/';
const API = 'https://www.cineplanet.com.pe/api/v1-web';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

// En un hosting sin disco de escritura el único lugar grabable es /tmp, así que
// la ruta se puede mover por variable de entorno.
const CACHE_DIR =
  process.env.CACHE_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', '.cache');

// Cuánto vale un dato antes de volver a pedirlo. Sin esto, un proceso que vive
// horas —el servidor de Render— servía el mismo mapa de butacas toda la tarde:
// asientos ya vendidos se veían libres, y pasada la medianoche la cartelera de
// "hoy" seguía siendo la de ayer.
const TTL = {
  catalogo: 10 * 60_000,
  // Las butacas se venden mientras uno mira: medio minuto ya es mucho.
  butacas: 45_000,
};
const ttlDe = (path) => (path.startsWith('/seatplan') ? TTL.butacas : TTL.catalogo);

// Cineplanet se cae seguido y a veces no cierra la conexión: sin plazo, la
// consulta se queda colgada hasta que el hosting la mata, y la persona ve una
// rueda girando sin explicación.
const PLAZO_MS = Number(process.env.CINEPLANET_TIMEOUT_MS) || 8000;

let cookie = null;
let cookieEnVuelo = null;
/** path → { json, obtenido, edadInicial } */
const cache = new Map();
/** Peticiones en curso: dos llamadas a la vez no deben ir dos veces a la red. */
const enVuelo = new Map();

/** Se llena cuando alguna respuesta salió del disco: quien consulte debe avisarlo. */
export const stale = { hits: [], oldestMs: 0 };

const cacheFile = (path) => join(CACHE_DIR, `${path.replace(/[^a-z0-9]+/gi, '_')}.json`);

function readCache(path) {
  const file = cacheFile(path);
  if (!existsSync(file)) return null;
  const age = Date.now() - statSync(file).mtimeMs;
  stale.hits.push(path);
  stale.oldestMs = Math.max(stale.oldestMs, age);
  return { json: JSON.parse(readFileSync(file, 'utf8')), edad: age };
}

/**
 * Qué tan viejo es el dato que se está usando, en milisegundos. Cero si salió
 * de la red hace un instante; más si viene de un snapshot en disco porque
 * Cineplanet no respondía. Quien arma la respuesta lo dice: ofrecer una función
 * de un snapshot viejo lleva a una página de compra vacía.
 */
export function edadDelDato(path) {
  const g = cache.get(path);
  if (!g) return null;
  return Date.now() - g.obtenido + g.edadInicial;
}

/** La antigüedad del catálogo que se usó para responder. */
export function edadDelCatalogo() {
  const edades = ['/cache/moviescache', '/cache/cinemascache', '/cache/sessioncache']
    .map(edadDelDato)
    .filter((e) => e != null);
  return edades.length ? Math.max(...edades) : null;
}

/**
 * El snapshot en disco sirve para el catálogo, no para las butacas: un mapa
 * viejo muestra como libres asientos ya vendidos, y sobre eso se sugieren
 * butacas y se ofrece un botón de comprar. Preferimos no mostrar mapa —quien
 * llama lo dice— antes que mostrar uno que miente. Está documentado así en
 * README y NOTES; el código no lo cumplía.
 */
const sirveElSnapshot = (path) => !path.startsWith('/seatplan');

function writeCache(path, json) {
  if (!sirveElSnapshot(path)) return;
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(cacheFile(path), JSON.stringify(json));
  } catch {
    // El cache es una comodidad: si no se puede escribir, seguimos igual.
  }
}

/**
 * La cookie de sesión, pedida una sola vez aunque la pidan varios a la vez.
 * Sin compartir la promesa, cada arranque en frío visitaba la portada dos veces
 * —`movies()` y `cinemas()` salen juntas— y eso es medio segundo regalado en el
 * momento en que más se nota.
 */
async function connect() {
  if (cookie) return cookie;
  cookieEnVuelo ??= (async () => {
    const res = await fetch(SITE, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(PLAZO_MS),
    });
    if (!res.ok) throw new Error(`Cineplanet rechazó la sesión pública (${res.status})`);
    const raw = res.headers.getSetCookie?.() ?? [];
    cookie = raw.map((c) => c.split(';')[0]).join('; ');
    return cookie;
  })().finally(() => {
    cookieEnVuelo = null;
  });
  return cookieEnVuelo;
}

async function pedir(path) {
  let live;
  try {
    const jar = await connect();
    const res = await fetch(`${API}${path}`, {
      headers: { Accept: 'application/json', 'User-Agent': UA, Cookie: jar },
      signal: AbortSignal.timeout(PLAZO_MS),
    });
    if (!res.ok) throw new Error(`Cineplanet rechazó ${path} (${res.status})`);
    live = await res.json();
  } catch (err) {
    // Un 403 sin cookie significa que su backend de sesiones no responde; es la
    // misma causa del "¡Ups! algo sucedió" de su web. Ahí sirve el último
    // snapshot: deja seguir eligiendo función aunque no se pueda comprar.
    const cached = sirveElSnapshot(path) ? readCache(path) : null;
    if (cached) {
      cache.set(path, { json: cached.json, obtenido: Date.now(), edadInicial: cached.edad });
      return cached.json;
    }
    // Y si tampoco hay disco, sirve lo que ya se había traído aunque haya
    // vencido: una cartelera de hace un rato es mejor que una disculpa.
    const vencido = sirveElSnapshot(path) ? cache.get(path) : null;
    if (vencido) return vencido.json;
    const hint = !cookie
      ? ' — Cineplanet no está emitiendo cookie de sesión, su plataforma está caída. Reintenta en unos minutos.'
      : '';
    throw new Error(`${err.message}${hint}`);
  }
  cache.set(path, { json: live, obtenido: Date.now(), edadInicial: 0 });
  writeCache(path, live);
  return live;
}

export async function getJson(path) {
  const guardado = cache.get(path);
  if (guardado && Date.now() - guardado.obtenido < ttlDe(path)) return guardado.json;
  // Dos consultas simultáneas del mismo dato son una sola llamada.
  if (enVuelo.has(path)) return enVuelo.get(path);
  const promesa = pedir(path).finally(() => enVuelo.delete(path));
  enVuelo.set(path, promesa);
  return promesa;
}

export const getMovies = () => getJson('/cache/moviescache');
export const getCinemas = () => getJson('/cache/cinemascache');
export const getSessions = () => getJson('/cache/sessioncache');
export const getSeatPlan = (cinemaId, sessionId) =>
  getJson(`/seatplan/cinema/${cinemaId}/session/${sessionId}`);

/** Link directo al mapa de butacas de una función concreta. */
export function buyLink(movieSlug, cinemaId, sessionId) {
  return `https://www.cineplanet.com.pe/compra/${movieSlug}/${cinemaId}/${sessionId}/asientos`;
}
