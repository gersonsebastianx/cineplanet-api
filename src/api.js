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

const CACHE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.cache');

let cookie = null;
const cache = new Map();

/** Se llena cuando alguna respuesta salió del disco: quien consulte debe avisarlo. */
export const stale = { hits: [], oldestMs: 0 };

const cacheFile = (path) => join(CACHE_DIR, `${path.replace(/[^a-z0-9]+/gi, '_')}.json`);

function readCache(path) {
  const file = cacheFile(path);
  if (!existsSync(file)) return null;
  const age = Date.now() - statSync(file).mtimeMs;
  stale.hits.push(path);
  stale.oldestMs = Math.max(stale.oldestMs, age);
  return JSON.parse(readFileSync(file, 'utf8'));
}

function writeCache(path, json) {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(cacheFile(path), JSON.stringify(json));
  } catch {
    // El cache es una comodidad: si no se puede escribir, seguimos igual.
  }
}

async function connect() {
  if (cookie) return cookie;
  const res = await fetch(SITE, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Cineplanet rechazó la sesión pública (${res.status})`);
  const raw = res.headers.getSetCookie?.() ?? [];
  cookie = raw.map((c) => c.split(';')[0]).join('; ');
  return cookie;
}

export async function getJson(path) {
  if (cache.has(path)) return cache.get(path);
  let live;
  try {
    const jar = await connect();
    const res = await fetch(`${API}${path}`, {
      headers: { Accept: 'application/json', 'User-Agent': UA, Cookie: jar },
    });
    if (!res.ok) throw new Error(`Cineplanet rechazó ${path} (${res.status})`);
    live = await res.json();
  } catch (err) {
    // Un 403 sin cookie significa que su backend de sesiones no responde; es la
    // misma causa del "¡Ups! algo sucedió" de su web. Ahí sirve el último
    // snapshot: deja seguir eligiendo función aunque no se pueda comprar.
    const cached = readCache(path);
    if (cached) return cached;
    const hint = !cookie
      ? ' — Cineplanet no está emitiendo cookie de sesión, su plataforma está caída. Reintenta en unos minutos.'
      : '';
    throw new Error(`${err.message}${hint}`);
  }
  cache.set(path, live);
  writeCache(path, live);
  return live;
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
