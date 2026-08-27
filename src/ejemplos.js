// Frases de ejemplo para quien llega sin historial propio.
//
// Lo que busca la gente sale de la bitácora; esto es lo que va debajo cuando la
// bitácora todavía no tiene suficiente. Hasta ahora ese fondo eran dos frases
// escritas a mano —«La Odisea mañana en la tarde en Salaverry»— y esa es la
// misma trampa que las pruebas tienen prohibida: la cartelera cambia sola, y el
// día que esa película se va, el primer botón que ve un visitante nuevo le
// contesta «ya no está en cartelera». La peor primera impresión posible.
//
// Así que se arman con la cartelera del día y **se comprueban antes de
// ofrecerlas**: un ejemplo sólo sirve si funciona solo.

import { movies, cinemas, showtimes } from './catalog.js';
import { resolve } from './resolve.js';
import { limaToday } from './parser.js';

/** "CP Salaverry" → "Salaverry": nadie escribe el prefijo al preguntar. */
const sinPrefijo = (nombre) => nombre.replace(/^CP\s+/i, '');

/** Descarta funciones que ya empezaron, igual que el resolvedor. */
const vigentes = (lista, today) => {
  const d = new Date(Date.now() - 5 * 3600 * 1000);
  const ahora = d.getUTCHours() * 60 + d.getUTCMinutes();
  return lista.filter((s) => s.date !== today || s.minutes > ahora + 10);
};

/**
 * Devuelve hasta `limite` frases que hoy llevan a una función o a una cartelera.
 * Si la cartelera está vacía o Cineplanet no responde, devuelve lo que pueda
 * —incluso nada—, y quien llame decide con qué rellenar.
 */
export async function ejemplosDeLaCartelera(limite = 2) {
  const today = limaToday();
  const [movieList, cinemaList] = await Promise.all([movies(), cinemas()]);
  const porCine = new Map();
  const porPelicula = [];

  for (const m of movieList) {
    const f = vigentes(await showtimes({ movie: m }), today);
    if (!f.length) continue;
    porPelicula.push({ pelicula: m, funciones: f });
    for (const s of f) porCine.set(s.cinemaId, (porCine.get(s.cinemaId) ?? 0) + 1);
  }
  if (!porPelicula.length) return [];

  // La más dada: es la que más gente va a reconocer en un botón.
  porPelicula.sort((a, b) => b.funciones.length - a.funciones.length);
  const masDada = porPelicula[0];
  // Y la sede donde más se da, para que el ejemplo termine en una función.
  const cuenta = new Map();
  for (const s of masDada.funciones) cuenta.set(s.cinemaId, (cuenta.get(s.cinemaId) ?? 0) + 1);
  const sedeDeLaPelicula = cinemaList.find(
    (c) => c.id === [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0]?.[0],
  );
  // Para el segundo ejemplo, otra sede: dos botones nombrando el mismo cine se
  // ven como uno repetido.
  const sedeMasActiva = cinemaList.find(
    (c) =>
      c.id ===
      [...porCine.entries()]
        .sort((a, b) => b[1] - a[1])
        .find(([id]) => id !== sedeDeLaPelicula?.id)?.[0],
  );

  const candidatas = [
    sedeDeLaPelicula && `${masDada.pelicula.title} mañana en ${sinPrefijo(sedeDeLaPelicula.name)}`,
    sedeMasActiva && `¿Qué dan hoy en ${sinPrefijo(sedeMasActiva.name)}?`,
  ].filter(Boolean);

  // La comprobación es el punto: se ofrece sólo lo que por sí solo llega a algo.
  const buenas = [];
  for (const frase of candidatas) {
    if (buenas.length >= limite) break;
    try {
      const r = await resolve(frase);
      if (r.estado === 'ok' || r.estado === 'cartelera') buenas.push(frase);
    } catch {
      // Si no se puede comprobar, no se ofrece.
    }
  }
  return buenas;
}
