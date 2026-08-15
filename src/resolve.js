// Convierte una frase en una respuesta lista para mostrar.
//
// La regla que manda: nunca responder sólo "no hay". Si la ventana pedida está
// vacía, se ensancha por pasos y se dice qué se cambió — eso es lo que hace que
// la conversación sirva en vez de frustrar.

import { movies, cinemas, showtimes, nearest } from './catalog.js';
import { seatMap, bestBlocks } from './seatmap.js';
import { parse, limaToday } from './parser.js';

const MISSING = {
  movie: 'No reconocí la película. ¿Cuál quieres ver?',
  cinema: '¿En qué cine? Dime el distrito o el nombre del Cineplanet.',
};

/** Nombres propios: cada palabra en mayúscula ("San Isidro"). */
const titulo = (s) => (s ?? '').replace(/\b\w/g, (c) => c.toUpperCase());
/** Frases: sólo la primera letra ("31 de febrero no existe"). */
const frase = (s) => (s ?? '').charAt(0).toUpperCase() + (s ?? '').slice(1);

/**
 * Lo mínimo que hay que recordar del turno anterior para encadenar la charla.
 * Sólo identificadores: el objeto de la película arrastra todas sus funciones y
 * el contexto viaja en cada pedido.
 */
const recordar = (i) => ({
  movieId: i.movie?.id ?? null,
  cinemaId: i.cinema?.id ?? null,
  // Dónde está la persona se dice una vez ("vivo en surco") y sirve para todo
  // el resto de la charla: sin recordarlo, la segunda respuesta ofrece Pucallpa.
  coords:
    i.districtCoords ??
    (i.cinema && Number.isFinite(i.cinema.lat) ? { lat: i.cinema.lat, lon: i.cinema.lon } : null),
  date: i.date,
  from: i.from,
  to: i.to,
  seats: i.seats,
});

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
export async function resolve(text, { today = limaToday(), contexto = null } = {}) {
  const [movieList, cinemaList] = await Promise.all([movies(), cinemas()]);
  const fresco = parse(text, { movies: movieList, cinemas: cinemaList, today });

  // Una conversación acumula: "La Odisea" y después "en Barranco" son una sola
  // intención. Lo nuevo pisa lo viejo; lo que no se mencionó, se hereda.
  const previo = contexto
    ? {
        movie: movieList.find((m) => m.id === contexto.movieId) ?? null,
        cinema: cinemaList.find((c) => c.id === contexto.cinemaId) ?? null,
      }
    : null;
  const intent = contexto
    ? {
        ...fresco,
        movie: fresco.movie ?? previo.movie,
        // Nombrar un distrito nuevo descarta la sede anterior: cambió de idea.
        cinema: fresco.cinema ?? (fresco.district ? null : previo.cinema),
        districtCoords: fresco.districtCoords ?? contexto.coords ?? null,
        date: fresco.date ?? contexto.date ?? null,
        from: fresco.from ?? contexto.from ?? null,
        to: fresco.to ?? contexto.to ?? null,
        seats: fresco.seats ?? contexto.seats ?? null,
      }
    : fresco;

  // Lo que no se pudo usar se dice; ignorarlo en silencio es lo que hace que la
  // respuesta parezca sorda.
  if (intent.imposible) {
    return {
      estado: 'falta',
      pregunta: `${frase(intent.imposible)}. ¿Para cuándo lo busco?`,
      intent,
      contexto: recordar(intent),
    };
  }

  if (!intent.movie) {
    // "¿qué hay hoy en Salaverry?" es de lo más común que se pregunta, y la
    // cartelera está a un paso: listarla es mejor que pedir un título que
    // todavía no eligió.
    if (intent.cinema) {
      const dia = intent.date ?? today;
      const enCartelera = [];
      for (const m of movieList) {
        const f = stillSellable(
          await showtimes({ movie: m, cinemaIds: [intent.cinema.id] }),
          today,
        );
        const delDia = f.filter((s) => s.date === dia);
        if (delDia.length) enCartelera.push({ titulo: m.title, funciones: delDia.length });
      }
      if (enCartelera.length) {
        enCartelera.sort((a, b) => b.funciones - a.funciones);
        return {
          estado: 'cartelera',
          pregunta: `En ${intent.cinema.name} ${dia === today ? 'hoy' : sayDate(dia, today)} dan:`,
          opciones: enCartelera.slice(0, 8).map((m) => ({ nombre: m.titulo })),
          intent,
          contexto: recordar(intent),
        };
      }
    }
    const donde = intent.cinema ? ` en ${intent.cinema.name}` : '';
    return {
      estado: 'falta',
      pregunta: `¿Qué quieres ver${donde}? Dime el nombre de la película.`,
      intent,
      contexto: recordar(intent),
    };
  }

  // Un distrito sin sede propia no es un callejón sin salida: hay uno cerca.
  // Sólo si lo nombró en este mensaje: unas coordenadas heredadas del turno
  // anterior no son un distrito recién mencionado.
  if (!intent.cinema && intent.district && intent.districtCoords) {
    const cerca = nearest(cinemaList, intent.districtCoords, 3);
    return {
      estado: 'elige-cine',
      pregunta: `No hay Cineplanet en ${titulo(intent.district)}. Los más cercanos:`,
      opciones: cerca.map((c) => ({ id: c.id, nombre: c.name, km: c.km })),
      intent,
      contexto: recordar(intent),
    };
  }

  // Varias sedes empatadas: preguntar es más rápido que mandar a la equivocada.
  if (intent.cinemaOptions) {
    return {
      estado: 'elige-cine',
      pregunta: '¿Cuál de estos?',
      opciones: intent.cinemaOptions.slice(0, 5).map((c) => ({ id: c.id, nombre: c.name, ciudad: c.city })),
      intent,
      contexto: recordar(intent),
    };
  }

  if (!intent.cinema) {
    // Si ya se sabe la película, preguntar "¿en qué cine?" a secas obliga a
    // adivinar dónde la dan. Mejor mostrar las sedes que sí la tienen.
    const conFuncion = stillSellable(await showtimes({ movie: intent.movie }), today);
    const sedes = [...new Set(conFuncion.map((s) => s.cinemaId))]
      .map((id) => cinemaList.find((c) => c.id === id))
      .filter(Boolean);
    if (sedes.length) {
      // Sin ubicación, la sede con más funciones es la apuesta más razonable.
      const cuantas = new Map();
      for (const s of conFuncion) cuantas.set(s.cinemaId, (cuantas.get(s.cinemaId) ?? 0) + 1);
      const orden = intent.districtCoords
        ? nearest(sedes, intent.districtCoords, 4)
        : [...sedes].sort((a, b) => (cuantas.get(b.id) ?? 0) - (cuantas.get(a.id) ?? 0)).slice(0, 4);
      return {
        estado: 'elige-cine',
        pregunta: `¿En cuál? ${intent.movie.title} está en:`,
        opciones: orden.map((c) => ({ id: c.id, nombre: c.name, km: c.km, ciudad: c.city })),
        intent,
        contexto: recordar(intent),
      };
    }
    return { estado: 'falta', pregunta: MISSING.cinema, intent, contexto: recordar(intent) };
  }

  const all = stillSellable(
    await showtimes({ movie: intent.movie, cinemaIds: [intent.cinema.id] }),
    today,
  );
  if (!all.length) {
    // Decir "no la dan acá" y callarse es un callejón sin salida, teniendo la
    // lista de dónde sí la dan a un paso. La pregunta siguiente siempre es
    // "¿y dónde entonces?", así que se responde antes de que la hagan.
    const enOtros = stillSellable(await showtimes({ movie: intent.movie }), today);
    const sedes = [...new Set(enOtros.map((s) => s.cinemaId))]
      .map((id) => cinemaList.find((c) => c.id === id))
      .filter(Boolean);
    const cerca = sedes.length ? nearest(sedes, intent.cinema, 3) : [];

    if (cerca.length) {
      return {
        estado: 'elige-cine',
        pregunta: `${intent.movie.title} no la dan en ${intent.cinema.name}. Sí en:`,
        opciones: cerca.map((c) => ({ id: c.id, nombre: c.name, km: c.km, ciudad: c.city })),
        intent,
        // Se descarta la sede elegida pero no dónde está la persona: esa sede
        // era justamente la pista de su ubicación.
        contexto: recordar({
          ...intent,
          cinema: null,
          districtCoords: intent.districtCoords ?? { lat: intent.cinema.lat, lon: intent.cinema.lon },
        }),
      };
    }
    return {
      estado: 'sin-cartelera',
      mensaje: `${intent.movie.title} no tiene funciones en ningún Cineplanet en los próximos días.`,
      intent,
      contexto: recordar(intent),
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
      contexto: recordar(intent),
    };
  }

  const elegida = elegidas[0];
  const asientos = intent.seats ?? 2;
  let mapa = null;
  try {
    const map = await seatMap(elegida.cinemaId, elegida.sessionId);
    // Siempre se buscan hasta tres bloques distintos; que haya dos o uno lo
    // decide la sala, no un umbral inventado. Si sólo hay una zona buena, se
    // ofrece una y ya.
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
    contexto: recordar(intent),
    // Se pregunta siempre que no lo haya dicho: una entrada o dos cambia por
    // completo qué butacas sirven, y adivinarlo mal se nota recién al pagar.
    preguntarGrupo: intent.seats == null && !!mapa,
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
