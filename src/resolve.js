// Convierte una frase en una respuesta lista para mostrar.
//
// La regla que manda: nunca responder sólo "no hay". Si la ventana pedida está
// vacía, se ensancha por pasos y se dice qué se cambió — eso es lo que hace que
// la conversación sirva en vez de frustrar.

import { movies, cinemas, showtimes, nearest } from './catalog.js';
import { seatMap, bestBlocks, SalaAgotada } from './seatmap.js';
import { parse, limaToday } from './parser.js';

const MISSING = {
  movie: 'No reconocí la película. ¿Cuál quieres ver?',
  cinema: '¿En qué cine? Dime el distrito o el nombre del Cineplanet.',
};

/** Nombres propios: cada palabra en mayúscula ("San Isidro"). */
const titulo = (s) => (s ?? '').replace(/\b\w/g, (c) => c.toUpperCase());
/** Frases: sólo la primera letra ("31 de febrero no existe"). */
const cuandoTexto = (dia, today) => (dia === today ? 'hoy' : sayDate(dia, today));
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
  formato: i.formato ?? null,
  idioma: i.idioma ?? null,
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

/**
 * Películas del mismo género que sí tienen funciones. Cuando la pedida no está,
 * ofrecer parecidas es más útil que una lista al azar de la cartelera.
 */
async function mismoGenero(pelicula, movieList, cinemaId, today) {
  const candidatas = movieList.filter(
    (m) => m.id !== pelicula?.id && m.genre && m.genre === pelicula?.genre,
  );
  const con = [];
  for (const m of candidatas) {
    const f = stillSellable(
      await showtimes({ movie: m, cinemaIds: cinemaId ? [cinemaId] : undefined }),
      today,
    );
    if (f.length) con.push({ titulo: m.title, funciones: f.length });
  }
  return con.sort((a, b) => b.funciones - a.funciones).slice(0, 4);
}

/** Lo que más se está dando, para cuando no hay género del cual guiarse. */
async function loMasDado(movieList, cinemaId, today, limite = 6) {
  const con = [];
  for (const m of movieList) {
    const f = stillSellable(
      await showtimes({ movie: m, cinemaIds: cinemaId ? [cinemaId] : undefined }),
      today,
    );
    if (f.length) con.push({ titulo: m.title, funciones: f.length });
  }
  return con.sort((a, b) => b.funciones - a.funciones).slice(0, limite);
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
        formato: fresco.formato ?? contexto.formato ?? null,
        idioma: fresco.idioma ?? contexto.idioma ?? null,
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

  // Un distrito sin sede propia no es un callejón sin salida: hay uno cerca.
  // Sólo si lo nombró en este mensaje: unas coordenadas heredadas del turno
  // anterior no son un distrito recién mencionado.
  if (!intent.cinema && intent.district && intent.districtCoords) {
    const cuantas = intent.lugarConSede ?? 0;
    const cerca = nearest(cinemaList, intent.districtCoords, cuantas ? 4 : 3);
    return {
      estado: 'elige-cine',
      // Decir "no hay Cineplanet en Lima" es falso 27 veces. Cuando la ciudad
      // sí tiene sedes, lo honesto es decir cuántas y ofrecer las del centro,
      // que es lo mejor que se puede saber de alguien que sólo dijo su ciudad.
      pregunta: cuantas
        ? `En ${titulo(intent.district)} hay ${cuantas} ${cuantas === 1 ? 'cine' : 'cines'}. ¿Cuál te queda cerca?`
        : `No hay Cineplanet en ${titulo(intent.district)}. Los más cercanos:`,
      opciones: cerca.map((c) => ({ id: c.id, nombre: c.name, km: cuantas ? null : c.km })),
      intent,
      contexto: recordar(intent),
    };
  }

  // Una sede parecida es más peligrosa que una película parecida: mandar a
  // alguien de Puente Piedra a Piura son mil kilómetros, y la respuesta se ve
  // igual de segura que si fuera correcta.
  if (fresco.cinema && fresco.cinemaConfianza === 'media') {
    return {
      estado: 'confirmar',
      pregunta: `¿Te refieres a ${fresco.cinema.name}?`,
      opciones: [{ id: fresco.cinema.id, nombre: fresco.cinema.name, ciudad: fresco.cinema.city }],
      intent,
      // Se olvida la sede dudosa: si no era esa, heredarla repetiría el error.
      contexto: recordar({ ...intent, cinema: null, districtCoords: null }),
    };
  }

  // Sólo hay parecido, no certeza. Antes esto se resolvía en silencio y de ahí
  // salieron las respuestas seguras y equivocadas: preguntar cuesta un toque.
  if (fresco.movie && fresco.movieConfianza === 'media') {
    const opciones = fresco.movieAlternativas.slice(0, 3).map((m) => ({ nombre: m.title }));
    return {
      estado: 'confirmar',
      pregunta:
        opciones.length > 1
          ? '¿Cuál de estas quieres ver?'
          : `¿Te refieres a ${fresco.movie.title}?`,
      opciones,
      intent,
      contexto: recordar({ ...intent, movie: null }),
    };
  }

  // Pidió una recomendación, no una película: tratar "recomiendes" como título
  // y contestar que no está en cartelera es entender lo contrario de lo dicho.
  if (fresco.pideRecomendacion && !fresco.movie) {
    const cine = intent.cinema;
    const lista = await loMasDado(movieList, cine?.id, today, 6);
    if (lista.length) {
      return {
        estado: 'cartelera',
        pregunta: cine
          ? `Lo más visto en ${cine.name} ahora mismo:`
          : 'Lo más visto ahora mismo:',
        opciones: lista.map((m) => ({ nombre: m.titulo })),
        intent,
        contexto: recordar({ ...intent, movie: null }),
      };
    }
  }

  // Hay un parecido que no alcanzó para elegir. Antes se descartaba y se
  // respondía "no está en cartelera", tirando la única pista útil.
  if (!fresco.movie && fresco.movieSugerencias?.length) {
    const donde = intent.cinema ? ` en ${intent.cinema.name}` : '';
    const uno = fresco.movieSugerencias.length === 1;
    return {
      estado: 'confirmar',
      pregunta: uno
        ? `¿Te refieres a ${fresco.movieSugerencias[0].title}?`
        : `¿Cuál de estas quieres ver${donde}?`,
      opciones: fresco.movieSugerencias.map((m) => ({ nombre: m.title })),
      intent,
      contexto: recordar({ ...intent, movie: null }),
    };
  }

  // Nombró algo que no está en cartelera. Heredar la película del turno anterior
  // produce una respuesta segura y equivocada: preguntó por una y se le contesta
  // por otra. Mejor decir que no se encontró.
  if (!fresco.movie && fresco.sobrantes.length) {
    const dicho = fresco.sobrantes.join(' ');
    // Sin saber dónde va a ir, listar cartelera es listar la de otra punta del
    // país: qué se da depende del distrito.
    if (!intent.cinema) {
      return {
        estado: 'falta',
        pregunta: `Lo siento, «${dicho}» no está en cartelera. ¿En qué distrito vas al cine? Te digo qué hay ahí.`,
        intent,
        contexto: recordar({ ...intent, movie: null }),
      };
    }
    const enCartelera = await loMasDado(movieList, intent.cinema.id, today);
    const donde = ` en ${intent.cinema.name}`;
    if (enCartelera.length) {
      return {
        estado: 'cartelera',
        pregunta: `Lo siento, «${dicho}» no está en cartelera${donde}. Estas sí:`,
        opciones: enCartelera.map((m) => ({ nombre: m.titulo })),
        intent,
        contexto: recordar({ ...intent, movie: null }),
      };
    }
    return {
      estado: 'falta',
      pregunta: `Lo siento, «${dicho}» no está en cartelera. ¿Cuál quieres ver?`,
      intent,
      contexto: recordar({ ...intent, movie: null }),
    };
  }

  if (!intent.movie) {
    // "¿qué hay hoy en Salaverry?" es de lo más común que se pregunta, y la
    // cartelera está a un paso: listarla es mejor que pedir un título que
    // todavía no eligió.
    if (intent.cinema) {
      const dia = intent.date ?? today;
      // Un género pedido filtra la cartelera; "para niños" además exige APT,
      // porque una animación +14 no sirve para lo que están pidiendo.
      const candidatas = intent.genero
        ? movieList.filter(
            (m) =>
              intent.genero.generos.includes(m.genre) &&
              (!intent.genero.apt || m.rating === 'APT'),
          )
        : movieList;
      const enCartelera = [];
      for (const m of candidatas) {
        const f = stillSellable(
          await showtimes({ movie: m, cinemaIds: [intent.cinema.id] }),
          today,
        );
        const delDia = f.filter((s) => s.date === dia);
        // Si pidió una franja, la cartelera es la de esa franja. Antes la hora
        // se entendía y después se tiraba: alguien preguntaba "de 6pm en
        // adelante" y recibía la lista del día entero, funciones ya pasadas
        // incluidas.
        const enFranja =
          intent.from != null || intent.to != null
            ? delDia.filter(
                (s) =>
                  s.minutes >= (intent.from ?? 0) && s.minutes <= (intent.to ?? 24 * 60),
              )
            : delDia;
        if (enFranja.length)
          enCartelera.push({ titulo: m.title, funciones: enFranja.length, rating: m.rating });
      }
      if (enCartelera.length) {
        enCartelera.sort((a, b) => b.funciones - a.funciones);
        const cuando = dia === today ? 'hoy' : sayDate(dia, today);
        // Repetir la franja pedida es lo que deja ver si se entendió bien.
        const franja = intent.said?.time ? ` ${intent.said.time}` : '';
        return {
          estado: 'cartelera',
          pregunta: intent.genero
            ? `${frase(intent.genero.dice)} en ${intent.cinema.name} ${cuando}${franja}:`
            : `En ${intent.cinema.name} ${cuando}${franja} dan:`,
          opciones: enCartelera.slice(0, 8).map((m) => ({ nombre: m.titulo, nota: m.rating })),
          intent,
          contexto: recordar(intent),
        };
      }
      if (intent.genero) {
        return {
          estado: 'sin-cartelera',
          // Sin nombrar la franja, "no hay nada de terror hoy" es más rotundo de
          // lo que sabemos: puede haber, sólo que no a la hora pedida.
          mensaje: `No hay ${intent.genero.nada} en ${intent.cinema.name} ${cuandoTexto(dia, today)}${
            intent.said?.time ? ` ${intent.said.time}` : ''
          }.`,
          intent,
          contexto: recordar(intent),
        };
      }
    }
    const donde = intent.cinema ? ` en ${intent.cinema.name}` : '';
    if (intent.genero && !intent.cinema) {
      return {
        estado: 'falta',
        pregunta: `¿En qué cine buscas algo ${intent.genero.dice}?`,
        intent,
        contexto: recordar(intent),
      };
    }
    return {
      estado: 'falta',
      pregunta: `¿Qué quieres ver${donde}? Dime el nombre de la película.`,
      intent,
      contexto: recordar(intent),
    };
  }

  // Antes de preguntar por la sede: si no tiene funciones en ningún lado, pedir
  // un cine es hacerle perder el tiempo. Puede ser un estreno futuro o una que
  // ya terminó su temporada, y son mensajes distintos.
  const enTodoElPais = stillSellable(await showtimes({ movie: intent.movie }), today);
  if (!enTodoElPais.length) {
    const parecidas = await mismoGenero(intent.movie, movieList, null, today);
    const alternativas = parecidas.length ? parecidas : await loMasDado(movieList, null, today);
    const genero = intent.movie.genre?.toLowerCase();
    return {
      estado: 'cartelera',
      pregunta: intent.movie.comingSoon
        ? `${intent.movie.title} todavía no se estrena.${
            parecidas.length ? ` Mientras tanto, de ${genero} sí hay:` : ' Esto sí está en cartelera:'
          }`
        : `Lo siento, ${intent.movie.title} ya no está en cartelera.${
            parecidas.length ? ` De ${genero} sí hay:` : ' Esto sí:'
          }`,
      opciones: alternativas.map((m) => ({ nombre: m.titulo })),
      intent,
      contexto: recordar({ ...intent, movie: null }),
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

  // Nombró un lugar que no reconocemos: decirlo es más honesto que listar sedes
  // de otra ciudad como si fueran la respuesta.
  if (!intent.cinema && intent.lugarDesconocido) {
    return {
      estado: 'falta',
      pregunta: `No ubico "${intent.lugarDesconocido}". ¿En qué distrito o ciudad del Perú?`,
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
      // Sin saber dónde está la persona, ofrecer sedes es adivinar: la más
      // popular puede quedarle a dos horas. Mejor preguntar una vez y usarlo
      // para el resto de la conversación.
      if (!intent.districtCoords) {
        return {
          estado: 'falta',
          pregunta: `${intent.movie.title} está en ${sedes.length} ${
            sedes.length === 1 ? 'cine' : 'cines'
          }. ¿En qué distrito o provincia estás?`,
          intent,
          contexto: recordar(intent),
        };
      }
      const orden = nearest(sedes, intent.districtCoords, 4);
      return {
        estado: 'elige-cine',
        pregunta: `${intent.movie.title} está en:`,
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
    const sedes = [...new Set(enTodoElPais.map((s) => s.cinemaId))]
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
    // Inalcanzable en la práctica: si no tuviera funciones en ningún lado se
    // habría respondido más arriba. Queda por si la cartelera cambia entre
    // ambas consultas.
    return {
      estado: 'sin-cartelera',
      mensaje: `${intent.movie.title} ya no tiene funciones.`,
      intent,
      contexto: recordar(intent),
    };
  }

  // Formato e idioma son preferencias duras mientras existan funciones que las
  // cumplan; si no, se ceden y se dice, igual que con la hora.
  const cumplen = all.filter(
    (s) =>
      (!intent.formato || s.formats.includes(intent.formato.valor)) &&
      (!intent.idioma || s.languages.includes(intent.idioma.valor)),
  );
  const cedido = [];
  if ((intent.formato || intent.idioma) && !cumplen.length) {
    if (intent.formato) cedido.push(intent.formato.dice);
    if (intent.idioma) cedido.push(intent.idioma.dice);
  }
  const disponibles = cumplen.length ? cumplen : all;

  const date = intent.date ?? today;
  const inWindow = disponibles.filter(
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
    const sameDay = disponibles.filter((s) => s.date === date);
    if (sameDay.length) {
      elegidas = sameDay;
      ajuste = intent.from != null ? 'hora' : null;
    } else {
      // El día pedido no existe: se busca el más cercano, hacia adelante primero
      // y hacia atrás si la película ya termina su temporada antes de esa fecha.
      const later = disponibles.filter((s) => s.date > date);
      const earlier = disponibles.filter((s) => s.date < date);
      const target = later.length ? later[0].date : earlier.length ? earlier[earlier.length - 1].date : null;
      if (target) {
        const delDia = disponibles.filter((s) => s.date === target);
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

  // Una función agotada no sirve de nada: se descarta y se sigue con la
  // siguiente. Antes se ofrecía igual, con botón de comprar y todo.
  let elegida = null;
  let mapa = null;
  let agotadas = 0;
  let falloMapa = null;
  let respaldo = null;
  let sueltas = false;
  const asientos = intent.seats ?? 2;

  for (const candidata of elegidas) {
    try {
      const map = await seatMap(candidata.cinemaId, candidata.sessionId);
      // Siempre se buscan hasta tres bloques distintos; que haya dos o uno lo
      // decide la sala, no un umbral inventado.
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
      // Una función sin butacas juntas no sirve para el grupo: se guarda por si
      // no hay nada mejor, y se sigue buscando.
      if (!mapa.sugeridas.length) {
        if (!respaldo) respaldo = { candidata, mapa };
        mapa = null;
        continue;
      }
      elegida = candidata;
      break;
    } catch (err) {
      if (err instanceof SalaAgotada) {
        agotadas += 1;
        continue;
      }
      // Otro fallo del mapa no invalida la función: se ofrece igual y se avisa.
      falloMapa = 'no pude cargar el mapa de butacas';
      elegida = candidata;
      break;
    }
  }
  if (!elegida && respaldo) {
    elegida = respaldo.candidata;
    mapa = respaldo.mapa;
    sueltas = true;
  }
  if (!elegida) {
    return {
      estado: 'sin-cartelera',
      mensaje:
        agotadas === 1
          ? `Esa función de ${intent.movie.title} está agotada.`
          : `Las ${agotadas} funciones de ${intent.movie.title} que encontré están agotadas.`,
      intent,
      contexto: recordar(intent),
    };
  }

  // Lo heredado del turno anterior se nombra. Rellenar en silencio es lo que
  // hizo que alguien preguntara por una película y recibiera otra sin notarlo.
  const heredado = [];
  if (contexto && !fresco.movie && intent.movie) heredado.push(intent.movie.title);
  if (contexto && !fresco.cinema && intent.cinema) heredado.push(intent.cinema.name);

  // Todo lo que no se pudo usar se nombra. Callarlo es lo que hacía que la
  // respuesta pareciera sorda aunque fuera correcta.
  const noUsado = [];
  if (cedido.length) noUsado.push(`no hay funciones ${cedido.join(' ni ')}`);
  if (falloMapa) noUsado.push(falloMapa);
  if (sueltas) noUsado.push(`sólo quedan butacas sueltas, no ${asientos} juntas`);
  if (agotadas) noUsado.push(agotadas === 1 ? 'la anterior estaba agotada' : `${agotadas} funciones antes estaban agotadas`);
  if (fresco.sobrantes.length) noUsado.push(`no entendí «${fresco.sobrantes.join(' ')}»`);

  return {
    estado: 'ok',
    ajuste,
    noUsado: noUsado.length ? noUsado : null,
    heredado: heredado.length ? heredado : null,
    preferencias: {
      formato: intent.formato?.dice ?? null,
      idioma: intent.idioma?.dice ?? null,
      respetadas: !cedido.length,
    },
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
