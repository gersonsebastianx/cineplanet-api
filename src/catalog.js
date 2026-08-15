// Búsqueda de películas, cines y funciones sobre los datos de la API.

import { getMovies, getCinemas, getSessions, buyLink } from './api.js';

const norm = (s) =>
  (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Los timestamps vienen con offset de Lima; se leen literales para no depender del TZ del host. */
function parseShowtime(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}`, minutes: +h * 60 + +mi };
}

export function toMinutes(hhmm) {
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(String(hhmm).trim());
  if (!m) throw new Error(`hora inválida: ${hhmm}`);
  return +m[1] * 60 + (+m[2] || 0);
}

const R = 6371;
function haversine(a, b) {
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Saca el distrito de `secondAddress`, que llega como "Miraflores Lima Lima" o
 * "La Molina - Lima". Es la única fuente real del distrito de cada sede: sin
 * esto habría que mantener una lista a mano, y una lista a mano se equivoca
 * (CP Salaverry está en Jesús María, no en un distrito llamado Salaverry).
 */
function districtOf(secondAddress, city) {
  let s = (secondAddress ?? '')
    .split('(')[0]
    .split(',')[0]
    .split(' - ')[0]
    .trim();
  const same = (a, b) => norm(a) === norm(b);
  // La ciudad y el departamento vienen repetidos al final; se quitan. A veces el
  // repetido no es la ciudad sino la región ("Ventanilla Callao Callao").
  let parts = s.split(/\s+/).filter(Boolean);
  while (parts.length > 1 && (same(parts.at(-1), city) || same(parts.at(-1), parts.at(-2)))) {
    parts.pop();
  }
  s = parts.join(' ');
  // A veces la ciudad viene pegada a la última palabra: "AteLima".
  const glued = new RegExp(`${city}$`, 'i');
  if (parts.length && glued.test(s) && !same(s, city)) s = s.replace(glued, '').trim();
  return s || city;
}

export async function cinemas() {
  const { cinemas: list } = await getCinemas();
  return list.map((c) => ({
    id: c.ID,
    name: c.name,
    city: c.city,
    district: districtOf(c.secondAddress, c.city),
    address: c.address,
    slug: c.formattedCinemaName,
    lat: parseFloat(c.latitude),
    lon: parseFloat(c.longitude),
  }));
}

export async function movies() {
  const { movies: list } = await getMovies();
  return list.map((m) => ({
    id: m.id,
    title: (m.title ?? '').trim(),
    slug: m.movieDetailsUrl,
    runTime: m.runTime,
    rating: m.ratingDescription,
    genre: m.genre,
    comingSoon: m.isComingSoon,
    cinemas: m.cinemas ?? [],
  }));
}

/** Coincidencia tolerante: exacta → empieza por → contiene → por palabras. */
export function matchMovies(list, query) {
  const q = norm(query);
  if (!q) return [];
  const words = q.split(' ');
  const score = (m) => {
    const t = norm(m.title);
    if (t === q) return 100;
    if (t.startsWith(q)) return 80;
    if (t.includes(q)) return 60;
    const hit = words.filter((w) => w.length > 2 && t.includes(w)).length;
    return hit ? 20 + hit * 10 : 0;
  };
  return list
    .map((m) => ({ m, s: score(m) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.m.title.localeCompare(b.m.title))
    .map((x) => x.m);
}

export function matchCinemas(list, query) {
  const q = norm(query);
  if (!q) return [];
  return list.filter((c) => norm(c.name).includes(q) || norm(c.city).includes(q));
}

export function nearest(list, origin, limit = 5) {
  return list
    .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon))
    .map((c) => ({ ...c, km: +haversine(origin, c).toFixed(1) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, limit);
}

/**
 * Funciones de una película, ya filtradas.
 * @param {object} opts { movie, date, from, to, cinemaIds }
 */
export async function showtimes({ movie, date, from, to, cinemaIds }) {
  const { sessions } = await getSessions();
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const cinemaList = await cinemas();
  const cinemaById = new Map(cinemaList.map((c) => [c.id, c]));
  const allowed = cinemaIds ? new Set(cinemaIds) : null;
  const fromMin = from == null ? -Infinity : toMinutes(from);
  const toMin = to == null ? Infinity : toMinutes(to);

  const out = [];
  for (const entry of movie.cinemas) {
    if (allowed && !allowed.has(entry.cinemaId)) continue;
    const cinema = cinemaById.get(entry.cinemaId);
    for (const day of entry.dates ?? []) {
      for (const compositeId of day.sessions ?? []) {
        const session = byId.get(compositeId);
        if (!session) continue;
        const when = parseShowtime(session.showtime);
        if (!when) continue;
        if (date && when.date !== date) continue;
        if (when.minutes < fromMin || when.minutes > toMin) continue;
        out.push({
          sessionId: session.sessionId,
          cinemaId: entry.cinemaId,
          cinemaName: cinema?.name ?? entry.cinemaId,
          city: cinema?.city,
          km: cinema?.km,
          date: when.date,
          time: when.time,
          minutes: when.minutes,
          screen: session.screenName,
          formats: session.formats ?? [],
          languages: session.languages ?? [],
          link: buyLink(movie.slug, entry.cinemaId, session.sessionId),
        });
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.minutes - b.minutes);
}

/** 'hoy' | 'mañana' | 'YYYY-MM-DD' → fecha en horario de Lima. */
export function resolveDate(input) {
  if (!input) return null;
  const s = norm(input);
  const limaNow = new Date(Date.now() - 5 * 3600 * 1000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  if (s === 'hoy') return fmt(limaNow);
  if (s === 'manana' || s === 'mnana') return fmt(new Date(limaNow.getTime() + 864e5));
  if (s === 'pasado manana') return fmt(new Date(limaNow.getTime() + 2 * 864e5));
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
  throw new Error(`fecha inválida: ${input}`);
}
