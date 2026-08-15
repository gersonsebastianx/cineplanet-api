// Convierte una frase en una respuesta lista para mostrar.
//
// La regla que manda: nunca responder sólo "no hay". Si la ventana pedida está
// vacía, se ensancha por pasos y se dice qué se cambió — eso es lo que hace que
// la conversación sirva en vez de frustrar.

import { movies, cinemas, showtimes } from './catalog.js';
import { seatMap, bestBlocks } from './seatmap.js';
import { parse, limaToday } from './parser.js';

const MISSING = {
  movie: 'No reconocí la película. ¿Cuál quieres ver?',
  cinema: '¿En qué cine? Dime el distrito o el nombre del Cineplanet.',
};

const nowMinutesLima = () => {
  const d = new Date(Date.now() - 5 * 3600 * 1000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};

const DAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function sayDate(iso, today) {
  if (iso === today) return 'hoy';
  const d = new Date(`${iso}T12:00:00Z`);
  const t = new Date(`${today}T12:00:00Z`);
  const days = Math.round((d - t) / 864e5);
  if (days === 1) return 'mañana';
  return `el ${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()}`;
}

/** Descarta funciones que ya empezaron si el día es hoy. */
const stillSellable = (list, today) => {
  const now = nowMinutesLima();
  return list.filter((s) => s.date !== today || s.minutes > now + 10);
};

/**
 * Resuelve una frase contra la cartelera real.
 * @returns {Promise<object>} respuesta con `estado` y lo necesario para mostrarla
 */
export async function resolve(text, { today = limaToday() } = {}) {
  const [movieList, cinemaList] = await Promise.all([movies(), cinemas()]);
  const intent = parse(text, { movies: movieList, cinemas: cinemaList, today });

  if (!intent.movie) return { estado: 'falta', pregunta: MISSING.movie, intent };
  if (!intent.cinema) return { estado: 'falta', pregunta: MISSING.cinema, intent };

  const all = stillSellable(
    await showtimes({ movie: intent.movie, cinemaIds: [intent.cinema.id] }),
    today,
  );
  if (!all.length) {
    return {
      estado: 'sin-cartelera',
      mensaje: `${intent.movie.title} no tiene funciones en ${intent.cinema.name} en los próximos días.`,
      intent,
    };
  }

  const date = intent.date ?? today;
  const inWindow = all.filter(
    (s) =>
      s.date === date &&
      (intent.from == null || s.minutes >= intent.from) &&
      (intent.to == null || s.minutes <= intent.to),
  );

  // Se ensancha en el orden en que a una persona le duele menos ceder:
  // primero la hora, después el día.
  let elegidas = inWindow;
  let ajuste = null;
  if (!elegidas.length) {
    const sameDay = all.filter((s) => s.date === date);
    if (sameDay.length) {
      elegidas = sameDay;
      ajuste = intent.from != null ? 'hora' : null;
    } else {
      // El día pedido no existe: se busca el más cercano, hacia adelante primero
      // y hacia atrás si la película ya termina su temporada antes de esa fecha.
      const later = all.filter((s) => s.date > date);
      const earlier = all.filter((s) => s.date < date);
      const target = later.length ? later[0].date : earlier.length ? earlier[earlier.length - 1].date : null;
      if (target) {
        const delDia = all.filter((s) => s.date === target);
        const enVentana = delDia.filter(
          (s) =>
            (intent.from == null || s.minutes >= intent.from) &&
            (intent.to == null || s.minutes <= intent.to),
        );
        elegidas = enVentana.length ? enVentana : delDia;
        ajuste = later.length
          ? enVentana.length
            ? 'dia'
            : 'dia-y-hora'
          : 'ultimo-dia';
      }
    }
  }
  if (!elegidas.length) {
    return {
      estado: 'sin-cartelera',
      mensaje: `${intent.movie.title} no tiene más funciones en ${intent.cinema.name}.`,
      intent,
    };
  }

  const elegida = elegidas[0];
  const asientos = intent.seats ?? 2;
  let mapa = null;
  try {
    const map = await seatMap(elegida.cinemaId, elegida.sessionId);
    mapa = {
      sala: map.screen,
      libres: map.free,
      total: map.total,
      sugeridas: bestBlocks(map, asientos, 3),
      filas: map.rows.map((r) => ({
        fila: r.label,
        ancho: r.width,
        celdas: Array.from({ length: r.width }, (_, x) => {
          const s = r.seats.find((q) => q.x === x);
          return !s ? null : { n: s.number, id: s.id, libre: s.free, acc: s.accessible };
        }),
      })),
    };
  } catch {
    // El mapa es un extra: sin él la respuesta sigue sirviendo para comprar.
    mapa = null;
  }

  return {
    estado: 'ok',
    ajuste,
    pedido: {
      pelicula: intent.movie.title,
      cine: intent.cinema.name,
      fechaPedida: intent.date ? sayDate(intent.date, today) : null,
      ventana: intent.said.time,
      personas: asientos,
    },
    funcion: {
      fecha: elegida.date,
      fechaTexto: sayDate(elegida.date, today),
      hora: elegida.time,
      sala: elegida.screen,
      formatos: elegida.formats,
      idiomas: elegida.languages,
      cine: elegida.cinemaName,
      link: elegida.link,
    },
    otras: elegidas.slice(1, 5).map((s) => ({
      hora: s.time,
      fechaTexto: sayDate(s.date, today),
      sala: s.screen,
      link: s.link,
    })),
    mapa,
  };
}
