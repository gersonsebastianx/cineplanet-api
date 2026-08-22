// Convierte una frase en una respuesta lista para mostrar.
//
// La regla que manda: nunca responder sólo "no hay". Si la ventana pedida está
// vacía, se ensancha por pasos y se dice qué se cambió — eso es lo que hace que
// la conversación sirva en vez de frustrar.

import { movies, cinemas, showtimes, nearest } from './catalog.js';
import { edadDelCatalogo } from './api.js';
import { seatMap, bestBlocks, SalaAgotada } from './seatmap.js';
import { parse, limaToday, generoPorNombre, tokens } from './parser.js';

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
  // Sin esto, "quiero ver algo de terror" → "¿en qué cine?" → "trujillo"
  // devolvía la cartelera entera: se preguntaba dónde y se olvidaba el qué.
  // Se guarda el nombre visible porque el contexto viaja como JSON y la regla
  // que lo detecta no sobrevive al viaje.
  genero: i.genero?.dice ?? null,
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
    if (f.length) con.push({ id: m.id, titulo: m.title, funciones: f.length });
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
    if (f.length) con.push({ id: m.id, titulo: m.title, funciones: f.length });
  }
  return con.sort((a, b) => b.funciones - a.funciones).slice(0, limite);
}

/**
 * Las ciudades con más sedes, para ofrecerlas cuando hay que preguntar dónde.
 * Salen de los datos: si Cineplanet abre en una ciudad nueva, aparece sola.
 */
function ciudadesPrincipales(cinemaList, limite = 5) {
  const cuenta = new Map();
  for (const c of cinemaList) {
    if (c.city) cuenta.set(c.city, (cuenta.get(c.city) ?? 0) + 1);
  }
  return [...cuenta.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limite)
    .map(([ciudad]) => ciudad);
}

/** Descarta funciones que ya empezaron si el día es hoy. */
const stillSellable = (list, today) => {
  const now = nowMinutesLima();
  return list.filter((s) => s.date !== today || s.minutes > now + 10);
};

/**
 * Las funciones de la película en todo el país, calculadas una sola vez.
 * Varias reglas la necesitan y la cartelera no cambia dentro de una respuesta.
 */
function funcionesEnElPais(ctx) {
  ctx.cache.pais ??= showtimes({ movie: ctx.intent.movie }).then((l) => stillSellable(l, ctx.today));
  return ctx.cache.pais;
}

/** Las funciones de esa película en esa sede, también una sola vez. */
function funcionesEnLaSede(ctx) {
  ctx.cache.sede ??= showtimes({
    movie: ctx.intent.movie,
    cinemaIds: [ctx.intent.cinema.id],
  }).then((l) => stillSellable(l, ctx.today));
  return ctx.cache.sede;
}

/**
 * El orden de esta lista **es** una regla del producto: la primera que aplica
 * contesta. Antes ese orden vivía en una cadena de `if` de setecientas líneas,
 * donde cada rama nueva se colocaba razonando qué debía ir antes que qué — y
 * ese razonamiento no quedaba escrito en ninguna parte.
 *
 * `cuando` dice cuándo aplica; `responde` arma la respuesta. Una regla puede
 * devolver `null`: miró, no le sirvió, y cede el turno a la siguiente.
 *
 * Si ninguna aplica, se sigue al camino de compra: hay película y hay sede, y
 * lo que queda es elegir función y butacas.
 */
const REGLAS = [
  {
    // Lo que no se pudo usar se dice; ignorarlo en silencio es lo que hace que
    // la respuesta parezca sorda.
    nombre: 'fecha-imposible',
    cuando: ({ intent }) => !!intent.imposible,
    responde: ({ intent }) => ({
      estado: 'falta',
      pregunta: `${frase(intent.imposible)}. ¿Para cuándo lo busco?`,
      intent,
      contexto: recordar(intent),
    }),
  },

  {
    // Preguntas que no hacemos y saludos: se responden antes que nada, porque si
    // caen en la maquinaria de títulos terminan en «hola» no está en cartelera.
    nombre: 'fuera-de-lo-que-hacemos',
    cuando: ({ fresco }) => !!fresco.fuera,
    responde: ({ fresco, intent }) => ({
      estado: 'falta',
      // Sin "de + el": queda "de el estacionamiento".
      pregunta: `No sé nada sobre ${fresco.fuera}: acá sólo busco funciones y butacas, y el pago lo haces en Cineplanet. ¿Qué quieres ver?`,
      intent,
      contexto: recordar(intent),
    }),
  },

  {
    // Cineplanet no está sólo en el Perú y la gente lo sabe: el 19 de agosto dos
    // personas preguntaron por Chile el mismo día, y a una se le contestó "no
    // entendí «chile»" y se le volvió a pedir un distrito, tres veces. Preguntar
    // por el país es una pregunta legítima; lo honesto es decir qué cartelera
    // tenemos. Y no se olvida lo que ya se sabía: la película sobrevive.
    nombre: 'solo-cineplanet-peru',
    cuando: ({ fresco }) => fresco.fueraDelPeru || fresco.preguntaPais,
    responde: ({ fresco, intent }) => ({
      estado: 'falta',
      pregunta: fresco.otroPais
        ? `Sólo tengo la cartelera de Cineplanet Perú, así que no puedo ver funciones en ${fresco.otroPais}. ¿En qué distrito o ciudad del Perú vas al cine?`
        : 'Acá sólo está la cartelera de Cineplanet Perú. ¿En qué distrito o ciudad del Perú vas al cine?',
      intent,
      contexto: recordar(intent),
    }),
  },

  {
    nombre: 'centro-comercial-sin-sede',
    cuando: ({ fresco, intent }) => !!fresco.centroComercial && !intent.cinema,
    responde: ({ fresco, intent }) => ({
      estado: 'falta',
      pregunta: `Cineplanet no publica en qué centros comerciales está, así que no puedo confirmarte «${fresco.centroComercial}». ¿En qué distrito queda? Con eso te digo la sede más cercana.`,
      intent,
      contexto: recordar(intent),
    }),
  },

  {
    // Pidió cambiar de sede: se suelta la que veníamos usando y se ofrecen las de
    // alrededor. Antes esto caía en el camino normal, heredaba el mismo cine y
    // devolvía la misma respuesta, como si no hubiera escuchado.
    nombre: 'pide-otro-cine',
    cuando: ({ fresco }) => !!fresco.otroCine && !fresco.cinema && !fresco.district,
    responde: async ({ intent, previo, cinemaList, today }) => {
      const donde = intent.districtCoords ?? previo?.cinema ?? intent.cinema;
      // Igual que al elegir por distrito: si ya sabemos qué quiere ver, sólo se
      // ofrecen sedes donde esa película se da. Ofrecer una donde no la dan es
      // mandar a la persona a elegir dos veces.
      let candidatas = cinemaList;
      if (intent.movie) {
        const con = stillSellable(await showtimes({ movie: intent.movie }), today);
        const ids = new Set(con.map((f) => f.cinemaId));
        const conLaPelicula = cinemaList.filter((c) => ids.has(c.id));
        if (conLaPelicula.length) candidatas = conLaPelicula;
      }
      const cerca = donde
        ? nearest(candidatas, donde, 4).filter(
            (c) => c.id !== previo?.cinema?.id && c.id !== intent.cinema?.id,
          )
        : [];
      if (cerca.length) {
        return {
          estado: 'elige-cine',
          pregunta: '¿A cuál prefieres ir?',
          opciones: cerca.slice(0, 3).map((c) => ({ id: c.id, nombre: c.name, km: c.km, ciudad: c.city })),
          intent,
          // Se suelta la sede pero no dónde está la persona: eso sigue sirviendo.
          contexto: recordar({ ...intent, cinema: null }),
        };
      }
      return {
        estado: 'falta',
        pregunta: '¿En qué distrito o ciudad? Te digo qué cines hay ahí.',
        intent,
        contexto: recordar({ ...intent, cinema: null }),
      };
    },
  },

  {
    nombre: 'saludo',
    cuando: ({ fresco }) => !!fresco.saludo,
    responde: ({ fresco, intent }) => {
      const abre = fresco.saludo === 'saludo' ? 'Hola. ' : '';
      return {
        estado: 'falta',
        pregunta: intent.cinema
          ? `${abre}Dime qué quieres ver y te busco función en ${intent.cinema.name}.`
          : `${abre}Dime la película, el cine y cuándo — por ejemplo «La Odisea hoy en la tarde en Salaverry».`,
        intent,
        contexto: recordar(intent),
      };
    },
  },

  {
    // Un distrito sin sede propia no es un callejón sin salida: hay uno cerca.
    // Sólo si lo nombró en este mensaje: unas coordenadas heredadas del turno
    // anterior no son un distrito recién mencionado.
    nombre: 'distrito-sin-sede-propia',
    cuando: ({ intent }) => !intent.cinema && !!intent.district && !!intent.districtCoords,
    responde: async ({ intent, cinemaList, today }) => {
      const cuantas = intent.lugarConSede ?? 0;
      // Si ya sabemos qué quiere ver, sólo se ofrecen sedes donde **esa película**
      // se da. Alguien pidió Toy Story, dijo "Lima", eligió CP Risso de nuestra
      // propia lista y ahí no la daban: le ofrecimos una puerta cerrada y tuvo
      // que volver a elegir.
      let candidatas = cinemaList;
      if (intent.movie) {
        const con = stillSellable(await showtimes({ movie: intent.movie }), today);
        const ids = new Set(con.map((f) => f.cinemaId));
        const conLaPelicula = cinemaList.filter((c) => ids.has(c.id));
        if (conLaPelicula.length) candidatas = conLaPelicula;
      }
      const cerca = nearest(candidatas, intent.districtCoords, cuantas ? 4 : 3);
      return {
        estado: 'elige-cine',
        // Decir "no hay Cineplanet en Lima" es falso 27 veces. Cuando la ciudad
        // sí tiene sedes, lo honesto es decir cuántas y ofrecer las del centro,
        // que es lo mejor que se puede saber de alguien que sólo dijo su ciudad.
        pregunta: cuantas
          ? intent.movie
            ? `${intent.movie.title} en ${titulo(intent.district)}. ¿Cuál te queda cerca?`
            : `En ${titulo(intent.district)} hay ${cuantas} ${cuantas === 1 ? 'cine' : 'cines'}. ¿Cuál te queda cerca?`
          : `No hay Cineplanet en ${titulo(intent.district)}. Los más cercanos:`,
        opciones: cerca.map((c) => ({ id: c.id, nombre: c.name, km: cuantas ? null : c.km })),
        intent,
        contexto: recordar(intent),
      };
    },
  },

  {
    // Una sede parecida es más peligrosa que una película parecida: mandar a
    // alguien de Puente Piedra a Piura son mil kilómetros, y la respuesta se ve
    // igual de segura que si fuera correcta.
    nombre: 'sede-solo-parecida',
    cuando: ({ fresco }) => !!fresco.cinema && fresco.cinemaConfianza === 'media',
    responde: ({ fresco, intent }) => {
      // Cuando la duda es entre varias, se muestran todas. Alguien contestó
      // "ate" —su distrito— y se le preguntó «¿te refieres a CP Puruchuco?»
      // ofreciendo una sola: en Ate hay dos. Acertó de casualidad, y si quería
      // la otra tenía que decir que no y empezar de nuevo.
      const empatadas = fresco.cinemaOptions?.length > 1 ? fresco.cinemaOptions : null;
      return {
        estado: empatadas ? 'elige-cine' : 'confirmar',
        pregunta: empatadas ? '¿A cuál de estas te refieres?' : `¿Te refieres a ${fresco.cinema.name}?`,
        opciones: (empatadas ?? [fresco.cinema])
          .slice(0, 4)
          .map((c) => ({ id: c.id, nombre: c.name, ciudad: c.city })),
        intent,
        // Se olvida la sede dudosa: si no era esa, heredarla repetiría el error.
        contexto: recordar({ ...intent, cinema: null, districtCoords: null }),
      };
    },
  },

  {
    // Sólo hay parecido, no certeza. Antes esto se resolvía en silencio y de ahí
    // salieron las respuestas seguras y equivocadas: preguntar cuesta un toque.
    nombre: 'pelicula-solo-parecida',
    cuando: ({ fresco }) => !!fresco.movie && fresco.movieConfianza === 'media',
    responde: ({ fresco, intent }) => {
      const opciones = fresco.movieAlternativas
        .slice(0, 3)
        .map((m) => ({ nombre: m.title, peliculaId: m.id }));
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
    },
  },

  {
    // Pidió una recomendación, no una película: tratar "recomiendes" como título
    // y contestar que no está en cartelera es entender lo contrario de lo dicho.
    nombre: 'pide-recomendacion',
    cuando: ({ fresco }) => !!fresco.pideRecomendacion && !fresco.movie,
    responde: async ({ intent, movieList, today }) => {
      const cine = intent.cinema;
      const lista = await loMasDado(movieList, cine?.id, today, 6);
      // Sin nada que recomendar, esta regla no tiene respuesta: cede el turno.
      if (!lista.length) return null;
      return {
        estado: 'cartelera',
        pregunta: cine
          ? `Lo más visto en ${cine.name} ahora mismo:`
          : 'Lo más visto ahora mismo:',
        opciones: lista.map((m) => ({ nombre: m.titulo, peliculaId: m.id })),
        intent,
        contexto: recordar({ ...intent, movie: null }),
      };
    },
  },

  {
    // Hay un parecido que no alcanzó para elegir. Antes se descartaba y se
    // respondía "no está en cartelera", tirando la única pista útil.
    nombre: 'parecido-que-no-alcanzo',
    cuando: ({ fresco }) => !fresco.movie && fresco.movieSugerencias?.length > 0,
    responde: ({ fresco, intent }) => {
      const donde = intent.cinema ? ` en ${intent.cinema.name}` : '';
      const uno = fresco.movieSugerencias.length === 1;
      return {
        estado: 'confirmar',
        pregunta: uno
          ? `¿Te refieres a ${fresco.movieSugerencias[0].title}?`
          : `¿Cuál de estas quieres ver${donde}?`,
        opciones: fresco.movieSugerencias.map((m) => ({ nombre: m.title, peliculaId: m.id })),
        intent,
        contexto: recordar({ ...intent, movie: null }),
      };
    },
  },

  {
    // Quedaron palabras sin explicar. Durante mucho tiempo esto se respondía
    // afirmando que eran una película inexistente —«hola» no está en cartelera—,
    // y esa sola regla producía un tercio de las respuestas rotas.
    //
    // Que algo no se entienda no autoriza a decir qué era. Sólo se afirma "no
    // está en cartelera" cuando hay razón para creer que estaban nombrando una:
    // que se parezca a algún título. Si no, se dice lo único cierto —no se
    // entendió— y se ofrece por dónde seguir.
    //
    // Y si del mensaje sí se entendió algo —el día, la hora, el género, la sede,
    // cuántos van— una palabra suelta no puede tumbar la respuesta entera: "a las
    // 19:30" entendía la hora y contestaba «19:30» no está en cartelera. Se sigue
    // adelante y lo no usado se nombra al final, donde no estorba. Esta regla
    // reemplaza a la lista de palabras que nunca terminaba de crecer.
    //
    // Nota: para llegar hasta acá el parecido a un título ya fue descartado por
    // `parecido-que-no-alcanzo`, salvo cuando sí hay película elegida.
    nombre: 'palabras-sin-explicar',
    cuando: ({ fresco }) =>
      !fresco.movie && fresco.sobrantes.length > 0 && (parecidaATitulo(fresco) || !entendioAlgo(fresco)),
    responde: async ({ fresco, intent, movieList, today }) => {
      const dicho = fresco.sobrantes.join(' ');
      const parecida = parecidaATitulo(fresco);
      const noEntendi = parecida
        ? `Lo siento, «${dicho}» no está en cartelera`
        : `No entendí «${dicho}»`;
      // Soltar la película sólo si lo no entendido **se parece a un título**:
      // ahí están nombrando otra y heredar la anterior sería contestar por una
      // que nadie pidió. Una palabra cualquiera no es motivo para olvidar lo
      // que ya se sabía: alguien escribió "la odisea", después "chile", y a
      // partir de ahí la conversación había perdido la película. Cinco turnos,
      // ninguna función.
      const recuerdo = parecida ? { ...intent, movie: null } : intent;
      // Sin saber dónde va a ir, listar cartelera es listar la de otra punta del
      // país: qué se da depende del distrito.
      if (!intent.cinema) {
        return {
          estado: 'falta',
          // Y se nombra lo que sí se entendió, para que se vea que no se perdió.
          pregunta: `${noEntendi}. ¿En qué distrito vas al cine? Te digo ${
            recuerdo.movie ? `dónde dan ${recuerdo.movie.title}` : 'qué hay ahí'
          }.`,
          intent,
          contexto: recordar(recuerdo),
        };
      }
      const enCartelera = await loMasDado(movieList, intent.cinema.id, today);
      const donde = ` en ${intent.cinema.name}`;
      if (enCartelera.length) {
        return {
          estado: 'cartelera',
          pregunta: parecidaATitulo(fresco)
            ? `Lo siento, «${dicho}» no está en cartelera${donde}. Estas sí:`
            : `No entendí «${dicho}». Esto hay${donde}:`,
          opciones: enCartelera.map((m) => ({ nombre: m.titulo, peliculaId: m.id })),
          intent,
          contexto: recordar(recuerdo),
        };
      }
      return {
        estado: 'falta',
        pregunta: `Lo siento, «${dicho}» no está en cartelera. ¿Cuál quieres ver?`,
        intent,
        contexto: recordar(recuerdo),
      };
    },
  },

  {
    // No hay película: o se lista la cartelera de la sede, o se pregunta cuál.
    nombre: 'sin-pelicula',
    cuando: ({ intent }) => !intent.movie,
    responde: async (ctx) => (await carteleraDeLaSede(ctx)) ?? preguntarQuePelicula(ctx),
  },

  {
    // Antes de preguntar por la sede: si no tiene funciones en ningún lado, pedir
    // un cine es hacerle perder el tiempo. Puede ser un estreno futuro o una que
    // ya terminó su temporada, y son mensajes distintos.
    nombre: 'sin-funciones-en-el-pais',
    cuando: async (ctx) => !!ctx.intent.movie && !(await funcionesEnElPais(ctx)).length,
    responde: async ({ intent, movieList, today }) => {
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
        opciones: alternativas.map((m) => ({ nombre: m.titulo, peliculaId: m.id })),
        intent,
        contexto: recordar({ ...intent, movie: null }),
      };
    },
  },

  {
    // Varias sedes empatadas: preguntar es más rápido que mandar a la equivocada.
    nombre: 'varias-sedes-empatadas',
    cuando: ({ intent }) => !!intent.cinemaOptions,
    responde: ({ intent }) => ({
      estado: 'elige-cine',
      pregunta: '¿Cuál de estos?',
      opciones: intent.cinemaOptions.slice(0, 5).map((c) => ({ id: c.id, nombre: c.name, ciudad: c.city })),
      intent,
      contexto: recordar(intent),
    }),
  },

  {
    // Nombró un lugar que no reconocemos: decirlo es más honesto que listar sedes
    // de otra ciudad como si fueran la respuesta.
    nombre: 'lugar-desconocido',
    cuando: ({ intent }) => !intent.cinema && !!intent.lugarDesconocido,
    responde: ({ intent }) => ({
      estado: 'falta',
      pregunta: `No ubico "${intent.lugarDesconocido}". ¿En qué distrito o ciudad del Perú?`,
      intent,
      contexto: recordar(intent),
    }),
  },

  {
    nombre: 'falta-la-sede',
    cuando: ({ intent }) => !intent.cinema,
    responde: async ({ intent, cinemaList, today }) => {
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
          // Con las ciudades a un toque. Preguntar "¿en qué distrito estás?" a
          // secas es la fricción más repetida de la bitácora —14 de 36 turnos
          // atascados en una semana—: todas las demás preguntas ofrecen por
          // dónde seguir y ésta obligaba a escribir. Las ciudades salen de las
          // sedes que **sí** tienen la película.
          const ciudades = ciudadesPrincipales(sedes, 4);
          return {
            estado: ciudades.length ? 'elige-cine' : 'falta',
            pregunta: `${intent.movie.title} está en ${sedes.length} ${
              sedes.length === 1 ? 'cine' : 'cines'
            }. ¿En qué ciudad o distrito estás?`,
            opciones: ciudades.length ? ciudades.map((c) => ({ nombre: c })) : undefined,
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
    },
  },

  {
    // Hay película y hay sede, pero ahí no la dan.
    nombre: 'no-la-dan-en-esa-sede',
    cuando: async (ctx) => !!ctx.intent.cinema && !(await funcionesEnLaSede(ctx)).length,
    responde: async (ctx) => {
      const { intent, cinemaList } = ctx;
      // Decir "no la dan acá" y callarse es un callejón sin salida, teniendo la
      // lista de dónde sí la dan a un paso. La pregunta siguiente siempre es
      // "¿y dónde entonces?", así que se responde antes de que la hagan.
      const enTodoElPais = await funcionesEnElPais(ctx);
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
    },
  },
];

/** Hay algo que se parece a un título, aunque no alcance para elegirlo. */
const parecidaATitulo = (fresco) => fresco.movieSugerencias?.length > 0;

/** Del mensaje se entendió algo más que la palabra suelta que sobró. */
const entendioAlgo = (fresco) =>
  fresco.date != null ||
  fresco.from != null ||
  fresco.genero != null ||
  fresco.formato != null ||
  fresco.idioma != null ||
  fresco.seats != null ||
  fresco.cinema != null ||
  fresco.district != null;

/**
 * "¿qué hay hoy en Salaverry?" es de lo más común que se pregunta, y la
 * cartelera está a un paso: listarla es mejor que pedir un título que todavía
 * no eligió.
 *
 * Cuando lo pedido no está, se cede en el mismo orden que en el camino de
 * compra —primero la hora, después el día— y **se dice qué se cedió**. Antes
 * sólo se cedía si había un género pedido: sin género, "¿qué dan hoy?" después
 * de la última función contestaba "¿qué quieres ver?", que es la pregunta que
 * la persona acababa de hacer. Pasadas las 22:30 eso le ocurría a 42 de las 43
 * sedes.
 *
 * Devuelve `null` si no hay sede: ahí no hay cartelera que listar.
 */
async function carteleraDeLaSede({ intent, movieList, today }) {
  if (!intent.cinema) return null;
  const dia = intent.date ?? today;
  const cine = intent.cinema.name;
  const franja = intent.said?.time ? ` ${intent.said.time}` : '';
  // Un género pedido filtra la cartelera; "para niños" además exige APT,
  // porque una animación +14 no sirve para lo que están pidiendo.
  const delGenero = (m) =>
    !intent.genero ||
    (intent.genero.generos.includes(m.genre) && (!intent.genero.apt || m.rating === 'APT'));
  const enFranja = (s) =>
    (intent.from == null && intent.to == null) ||
    (s.minutes >= (intent.from ?? 0) && s.minutes <= (intent.to ?? 24 * 60));

  // Una sola pasada por la cartelera de la sede: de ahí salen todas las
  // respuestas posibles, y antes se recorría hasta tres veces.
  const pedido = []; // lo pedido: género y franja, el día pedido
  const aOtraHora = []; // el género pedido ese día, a otra hora
  const delDia = []; // cualquier película, ese día
  const masAdelante = []; // el género pedido, el próximo día que lo tenga
  const cualquieraAdelante = []; // cualquier película, el próximo día que la tenga
  for (const m of movieList) {
    const f = stillSellable(
      await showtimes({ movie: m, cinemaIds: [intent.cinema.id] }),
      today,
    );
    if (!f.length) continue;
    const hoy = f.filter((s) => s.date === dia);
    const proxima = f.filter((s) => s.date > dia).sort((a, b) => a.date.localeCompare(b.date))[0];
    if (hoy.length) delDia.push({ id: m.id, titulo: m.title });
    if (proxima) cualquieraAdelante.push({ id: m.id, titulo: m.title, dia: proxima.date });
    if (!delGenero(m)) continue;
    const enLaFranja = hoy.filter(enFranja);
    if (enLaFranja.length)
      pedido.push({ id: m.id, titulo: m.title, funciones: enLaFranja.length, rating: m.rating });
    else if (hoy.length)
      aOtraHora.push({ id: m.id, titulo: m.title, funciones: hoy.length, rating: m.rating });
    if (proxima) masAdelante.push({ id: m.id, titulo: m.title, dia: proxima.date });
  }

  const listar = (items) =>
    items.slice(0, 8).map((m) => ({ nombre: m.titulo, nota: m.rating ?? null, peliculaId: m.id }));
  const porFunciones = (a, b) => b.funciones - a.funciones;

  // 1. Lo que se pidió, tal cual.
  if (pedido.length) {
    pedido.sort(porFunciones);
    const cuando = cuandoTexto(dia, today);
    return {
      estado: 'cartelera',
      // Repetir la franja pedida es lo que deja ver si se entendió bien.
      pregunta: intent.genero
        ? `${frase(intent.genero.dice)} en ${cine} ${cuando}${franja}:`
        : `En ${cine} ${cuando}${franja} dan:`,
      opciones: listar(pedido),
      intent,
      contexto: recordar(intent),
    };
  }

  // 2. Se cede la hora antes que el día: lo mismo que se pidió, más tarde o más
  // temprano el mismo día.
  if (franja && aOtraHora.length) {
    aOtraHora.sort(porFunciones);
    return {
      estado: 'cartelera',
      // La franja va pegada a lo que falta —"no hay funciones en la tarde"— y no
      // colgando al final de la frase, donde parece otra cosa.
      pregunta: `No hay ${intent.genero ? intent.genero.nada : 'funciones'}${franja} en ${cine} ${cuandoTexto(
        dia,
        today,
      )}, pero sí a otras horas:`,
      opciones: listar(aOtraHora),
      intent,
      // Se suelta la franja: ya se dijo que no se pudo respetar.
      contexto: recordar({ ...intent, from: null, to: null }),
    };
  }

  // 3. Ese día no hay lo pedido, pero otro día sí. Es la respuesta que se busca
  // —"hoy no, mañana sí"— y no obliga a preguntar de nuevo.
  //
  // Además, el género que publica Cineplanet es grueso y a veces desconcierta
  // —"El Final de la Calle Oak" figura como Acción— así que filtrar y callarse
  // esconde justo lo que la persona buscaba.
  const adelante = intent.genero ? masAdelante : cualquieraAdelante;
  if (adelante.length) {
    const cuandoOtro = adelante.map((m) => m.dia).sort()[0];
    const conFuncion = adelante.filter((m) => m.dia === cuandoOtro);
    // "Hoy ya no quedan funciones ahora" se contradice sola: cuando la franja
    // pedida era el reloj —"ahorita", "más tarde"— ya lo dice el "ya no quedan".
    const franjaUtil = dia === today && /^(ahora|más tarde)$/.test(intent.said?.time ?? '') ? '' : franja;
    const abre =
      dia === today
        ? intent.genero
          ? `No hay ${intent.genero.nada} hoy${franjaUtil} en ${cine}`
          : `Hoy ya no quedan funciones${franjaUtil} en ${cine}`
        : `${frase(cuandoTexto(dia, today))} no hay ${
            intent.genero ? intent.genero.nada : 'funciones'
          }${franjaUtil} en ${cine}`;
    return {
      estado: 'cartelera',
      pregunta: `${abre}, pero ${sayDate(cuandoOtro, today)} sí:`,
      opciones: (conFuncion.length ? conFuncion : adelante)
        .slice(0, 6)
        .map((m) => ({ nombre: m.titulo, peliculaId: m.id })),
      intent,
      // Se recuerda el día que sí tiene funciones: pulsar un título después de
      // esto debe llevar a ese día, no repetir que el pedido estaba vacío.
      contexto: recordar({ ...intent, date: cuandoOtro, from: null, to: null }),
    };
  }

  // 4. Del género pedido no hay nada, ni ese día ni después: se ofrece lo que sí
  // se da **ese mismo día**. Decir "no hay nada para niños hoy" y listar
  // películas de mañana es contradecirse en la misma respuesta.
  if (intent.genero && delDia.length) {
    return {
      estado: 'cartelera',
      pregunta: `No hay ${intent.genero.nada}${franja} en ${cine} ${cuandoTexto(dia, today)}. Esto sí:`,
      opciones: delDia.slice(0, 6).map((m) => ({ nombre: m.titulo, peliculaId: m.id })),
      intent,
      contexto: recordar({ ...intent, genero: null }),
    };
  }

  // 5. No queda nada que ofrecer. Sin género tampoco hay pregunta que hacer:
  // decirlo es lo único honesto.
  if (!intent.genero && !delDia.length) {
    return {
      estado: 'sin-cartelera',
      mensaje: `${cine} no tiene funciones publicadas por ahora.`,
      intent,
      contexto: recordar(intent),
    };
  }
  if (!intent.genero) return null;
  return {
    estado: 'sin-cartelera',
    // Sin nombrar la franja, "no hay nada de terror hoy" es más rotundo de
    // lo que sabemos: puede haber, sólo que no a la hora pedida.
    mensaje: `No hay ${intent.genero.nada}${franja} en ${cine} ${cuandoTexto(dia, today)}.`,
    intent,
    contexto: recordar(intent),
  };
}

/** Sin película y sin cartelera que mostrar: se pregunta cuál. */
function preguntarQuePelicula({ intent, cinemaList }) {
  const donde = intent.cinema ? ` en ${intent.cinema.name}` : '';
  if (intent.genero && !intent.cinema) {
    return {
      estado: 'cartelera',
      pregunta: `¿En qué ciudad o distrito buscas algo ${intent.genero.dice}?`,
      // Sin opciones, quien respondía algo que no entendíamos —"cineplanet"—
      // recibía la misma pregunta palabra por palabra y abandonaba. Con las
      // ciudades a un toque siempre hay por dónde seguir.
      opciones: ciudadesPrincipales(cinemaList).map((c) => ({ nombre: c })),
      intent,
      contexto: recordar(intent),
    };
  }
  if (!intent.cinema) {
    // Sin sede y sin película, "dime el nombre de la película" no ayuda a quien
    // acaba de preguntar «¿qué películas hay?». Qué se da depende del distrito,
    // así que se pregunta eso, con las ciudades a un toque.
    const ciudades = ciudadesPrincipales(cinemaList);
    if (ciudades.length) {
      return {
        estado: 'elige-cine',
        pregunta: '¿En qué ciudad o distrito vas al cine? Te digo qué dan ahí.',
        opciones: ciudades.map((c) => ({ nombre: c })),
        intent,
        contexto: recordar(intent),
      };
    }
  }
  return {
    estado: 'falta',
    pregunta: `¿Qué quieres ver${donde}? Dime el nombre de la película.`,
    intent,
    contexto: recordar(intent),
  };
}

/**
 * Hay película, hay sede y hay funciones: elegir cuál, mirar el mapa de butacas
 * y armar la respuesta con el botón de compra.
 */
async function caminoDeCompra(ctx) {
  const { fresco, intent, contexto, today } = ctx;
  const all = await funcionesEnLaSede(ctx);

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
  // La franja pedida también se cede a veces, y callarlo deja la respuesta
  // muda: alguien pidió Moana "más de noche" y recibió la misma función de las
  // 15:40 sin explicación. Era cierto —es la única que hay— pero no se dijo.
  const fueraDeFranja =
    (intent.from != null || intent.to != null) &&
    elegida &&
    (elegida.minutes < (intent.from ?? 0) || elegida.minutes > (intent.to ?? 24 * 60));
  if (fueraDeFranja) {
    noUsado.push(
      `no hay funciones ${intent.said?.time ?? 'en esa franja'}${
        disponibles.length === 1 ? ', ésta es la única' : ''
      }`,
    );
  }
  // Cuando Cineplanet no responde se contesta con el último snapshot. Sirve
  // para seguir eligiendo, pero el enlace puede llevar a una página de compra
  // vacía si esa función ya no existe: callarlo es mandar a alguien a una
  // puerta cerrada sin avisar.
  const edad = edadDelCatalogo();
  if (edad != null && edad > 30 * 60_000) {
    noUsado.push(
      `Cineplanet no está respondiendo: esta cartelera es de hace ${Math.round(edad / 60_000)} minutos y puede haber cambiado`,
    );
  }
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

/**
 * Resuelve una frase contra la cartelera real.
 * @returns {Promise<object>} respuesta con `estado` y lo necesario para mostrarla
 */
export async function resolve(text, { today = limaToday(), contexto = null, elegido = null } = {}) {
  const [movieList, cinemaList] = await Promise.all([movies(), cinemas()]);
  const fresco = parse(text, { movies: movieList, cinemas: cinemaList, today });

  // Pulsar un botón no es escribir una frase: si la opción traía identificador,
  // ésa es la elección y no se vuelve a interpretar el texto. Sin esto, dos
  // títulos que el intérprete no sabe separar —"…Parte 1" y "…Parte 2"—
  // contestaban «¿cuál de estas?» y pulsar la respuesta repetía la pregunta,
  // para siempre. Es la misma lección que ya se había aprendido con las sedes.
  const fijada = elegido?.peliculaId
    ? (movieList.find((m) => m.id === elegido.peliculaId) ?? null)
    : null;
  if (fijada) {
    const suyas = new Set(tokens(fijada.title));
    Object.assign(fresco, {
      movie: fijada,
      movieConfianza: 'alta',
      movieAlternativas: [],
      movieSugerencias: [],
      // El título ya está explicado: nombrarlo como "no entendí" sería absurdo.
      sobrantes: fresco.sobrantes.filter((w) => !suyas.has(w)),
    });
  }
  const fijadaSede = elegido?.cineId
    ? (cinemaList.find((c) => c.id === elegido.cineId) ?? null)
    : null;
  if (fijadaSede) {
    Object.assign(fresco, { cinema: fijadaSede, cinemaConfianza: 'alta', cinemaOptions: null });
  }

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
        genero: fresco.genero ?? generoPorNombre(contexto.genero) ?? null,
        formato: fresco.formato ?? contexto.formato ?? null,
        idioma: fresco.idioma ?? contexto.idioma ?? null,
      }
    : fresco;

  const ctx = { today, contexto, movieList, cinemaList, fresco, previo, intent, cache: {} };

  for (const regla of REGLAS) {
    if (!(await regla.cuando(ctx))) continue;
    const respuesta = await regla.responde(ctx);
    if (respuesta) return respuesta;
  }

  return caminoDeCompra(ctx);
}

/**
 * El orden, en un solo lugar y verificable. Una prueba lo fija, así que
 * reordenar deja de ser un cambio invisible: hay que decirlo en el mismo commit.
 */
export const ORDEN_DE_REGLAS = REGLAS.map((r) => r.nombre);
