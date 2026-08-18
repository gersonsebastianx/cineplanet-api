// Interpreta una frase suelta en español: "Toy Story hoy entre 4 y 6 en el
// real plaza salaverry" → { movie, date, from, to, cinema, seats }.
//
// No usa modelos de lenguaje a propósito. El vocabulario es cerrado —la cartelera
// y los cines, ambos traídos de la API— así que comparar contra esas listas es
// más exacto, instantáneo y gratis. Lo único abierto son fechas y horas, y eso
// son reglas.

const norm = (s) =>
  (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9:\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Palabras que no distinguen un cine de otro ni una película de otra.
const STOP = new Set(
  ('de del la el los las en para a un una unos unas y o con al cine cines cp ' +
    'quiero comprar entradas entrada ver boletos boleto funcion funciones ' +
    'pelicula peliculas por favor porfa dame busca buscame necesito me gustaria ' +
    'hay algo tarde noche manana hoy dia sala butacas asientos ' +
    // Preguntas y muletillas: sin esto "¿y dónde tiene?" encuentra la película
    // "Donde duermen los sueños" y la conversación se va a otro lado.
    'donde cuando cual cuales que como quien quienes porque cuanto cuantos ' +
    'tiene tienen esta estan hay habra sale salen dan pasan ' +
    'vivo estoy vengo cerca aqui alla ahi mas otro otra otros otras ' +
    'si no ok gracias oe pe pues bueno igual tambien ' +
    // Muletillas de seguimiento: "¿aún está en cartelera X?" no habla de una
    // película llamada "aún" ni "cartelera".
    'aun todavia sigue siguen continua cartelera cartera estreno estrenos ' +
    // Conectores de hora. Sin esto "de 6pm en adelante" contestaba que
    // «adelante» no está en cartelera: la palabra sobraba y se leía como título.
    'adelante partir desde despues antes hasta entre tipo aproximadamente alrededor ' +
    // Vocabulario de todos los días que jamás es un título.
    'peli pelis nose ni idea aburrido aburrida plan planes ganas rato ratito ' +
    'media cuarto mediodia medianoche este esta estos estas proximo proxima ' +
    'pasado pasada semana finde fin trabajo chamba oficina clases ' +
    'temprano luego rato horario horarios funcion funciones franja ' +
    'primera segunda tercera ultima ultimo esa ese eso aquella aquel ' +
    'persona personas gente amigos amigas pareja novia novio esposa esposo hijos ' +
    // Posesivos: "mi" coincidía con "Mi Vecino Totoro" y con media cartelera.
    'mi mis tu tus su sus nuestro nuestra nuestros nuestras ' +
    // "Vi que en Cineplanet Magdalena sí estaba": nada de eso es un título.
    'cineplanet cineplanets vi vimos creo parece dice decia estaba estaban ' +
    // Pedir una recomendación no es nombrar una película.
    'recomienda recomiendas recomiendes recomiendame recomendacion recomendaciones ' +
    'sugieres sugiere sugerencia opciones alternativa alternativas cual cuales ' +
    'fui fuimos quiero queria quisiera puedo podria seria mejor solo solamente ' +
    // Artículos en inglés: "the odyssey" encontraba "THE MAN I LOVE".
    'the a of in on at and for to my i').split(' '),
);

const tokens = (s) => norm(s).split(' ').filter((w) => w && !STOP.has(w));

// Palabras frecuentes del español. NO se usan para descartar títulos: una
// película puede llamarse "Zona Cero" y encontrarse escribiéndolo exacto. Lo que
// no pueden hacer es aportar evidencia **aproximada**, que es de donde salían
// los peores errores: "pero" a una letra de "cero", "nueva" a una de "nueve".
//
// A diferencia de la lista de arriba, ésta no crece con la cartelera: es el
// vocabulario común del idioma y se escribe una vez.
const COMUNES = new Set(
  ('pero pera peso peor pero cero caso cosa casa como cuma toma tema tomo todo toda ' +
    'nueva nuevo nueve nada nadie noche norte parte parte pare pase paso pega pena ' +
    'vida vive vino visto veces vez vaya vale valor verde viene vuelta ' +
    'ante anda ando anos años arte alto alta area ' +
    'bien bueno buena base bajo baja boca ' +
    'cada calle campo carta carro casi cerca cielo cien cine claro come cuando cuenta ' +
    'dado dice dias dice dijo dime dios dolor duda dura ' +
    'edad ella ellos ente entre eran eres esos esta este esto ' +
    'fin final fue fuera fuerza forma frente fondo ' +
    'gana gente golpe gran grande grupo gusto ' +
    'hace hacia hasta hecho hijo hora hoy hombre ' +
    'idea igual isla ' +
    'jamas juego junto ' +
    'lado largo lejos libre libro linea logra luego lugar luz ' +
    'malo mano mayor medio mejor menos mesa metro mientras mismo modo momento mucho mundo ' +
    'nivel nombre nunca ' +
    'obra ocho once orden otro ' +
    'padre pais papel para pasa pieza plan plaza pleno poco poder ponen porque pronto puede punto puerta ' +
    'queda quien quiere ' +
    'raro razon real resto rico ' +
    'saber sabe sala salir salvo sino sobre sola solo suelo sueno suerte ' +
    'tal tanto tarde tener tengo tiempo tiene tipo tira tocar toma torno total trata tres ' +
    'ultimo unico usar ' +
    'valor varios veinte venir ver verdad viejo visto voz vuelve ' +
    'zona').split(' ').filter(Boolean),
);

const DAYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre',
];
const WORD_NUMBERS = {
  una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6,
  siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
};

// Distritos que la gente nombra y que **no** tienen Cineplanet. El distrito de
// cada sede sí sale de los datos (`secondAddress`), así que acá sólo quedan los
// vacíos: sirven para ofrecer la sede más cercana en vez de decir que no existe.
// Escritos a mano por necesidad — Cineplanet no publica lo que no tiene.
/**
 * Cómo se abrevian los distritos en el habla diaria. Alguien escribió "vivo en
 * SJM" y no se ubicó; peor aún, "san juan de miraflores" terminaba en San Juan
 * de Lurigancho. Se expanden antes de buscar, así siguen un solo camino.
 */
// Sólo las de tres letras o más y sin ambigüedad: "si" por San Isidro se comió
// el "sí" de «Vi que en Cineplanet magdalena sí estaba», y "pl" o "sb" tienen el
// mismo riesgo. Una abreviatura que puede ser otra palabra no vale la pena.
const ABREVIATURAS = {
  sjm: 'san juan de miraflores',
  sjl: 'san juan de lurigancho',
  smp: 'san martin de porres',
  vmt: 'villa maria del triunfo',
  ves: 'villa el salvador',
};

export const DISTRICTS = {
  barranco: [-12.1465, -77.0206],
  'san isidro': [-12.0972, -77.0365],
  magdalena: [-12.0906, -77.0729],
  'pueblo libre': [-12.0748, -77.0631],
  rimac: [-12.0281, -77.0294],
  'la perla': [-12.0689, -77.1036],
  bellavista: [-12.0611, -77.1069],
  independencia: [-11.9889, -77.0553],
  chosica: [-11.9403, -76.6975],
  barranca: [-10.7503, -77.7614],
  // Lima norte y este, que es de donde venían los peores desvíos: "puente
  // piedra" se parecía a "piura" y mandaba a mil kilómetros.
  'puente piedra': [-11.8664, -77.0761],
  carabayllo: [-11.8564, -77.0364],
  'santa rosa': [-11.7986, -77.1683],
  ancon: [-11.7756, -77.1761],
  'santa anita': [-12.0475, -76.9714],
  'el agustino': [-12.0428, -77.0006],
  'san luis': [-12.0756, -76.9992],
  chaclacayo: [-11.9836, -76.7686],
  cieneguilla: [-12.1147, -76.8103],
  pachacamac: [-12.2286, -76.8672],
  'villa el salvador norte': [-12.2136, -76.9364],
  'san bartolo': [-12.3878, -76.7797],
  punta_hermosa: [-12.3364, -76.8236],
  // Callao, que la gente nombra como distrito propio.
  callao: [-12.0567, -77.1181],
  'carmen de la legua': [-12.0392, -77.0894],
  'mi peru': [-11.8511, -77.1156],
  // Otras ciudades del norte y sur sin sede, frecuentes en conversación.
  huacho: [-11.1067, -77.6053],
  canete: [-13.0778, -76.3861],
  chincha: [-13.4097, -76.1319],
  paracas: [-13.8342, -76.2497],
  nazca: [-14.8292, -74.9367],
  moyobamba: [-6.0342, -76.9714],
  yurimaguas: [-5.9008, -76.1153],
  talara: [-4.5772, -81.2719],
  ilo: [-17.6394, -71.3375],
  'la oroya': [-11.5222, -75.9022],
  tarma: [-11.4192, -75.6906],
  huanta: [-12.9403, -74.2478],
  andahuaylas: [-13.6558, -73.3872],
  sicuani: [-14.2694, -71.2264],
};

// Ciudades grandes del Perú donde Cineplanet no tiene sede. Sin esta lista, "en
// Iquitos" devolvía sedes de Lima como si nada, que es una respuesta falsa.
export const CIUDADES_SIN_SEDE = {
  iquitos: [-3.7437, -73.2516],
  chimbote: [-9.0853, -78.5783],
  ica: [-14.0678, -75.7286],
  ayacucho: [-13.1588, -74.2239],
  tarapoto: [-6.4869, -76.3653],
  moquegua: [-17.1936, -70.9353],
  tumbes: [-3.5669, -80.4515],
  huaraz: [-9.5278, -77.5278],
  sullana: [-4.9039, -80.6858],
  abancay: [-13.6339, -72.8814],
  huancavelica: [-12.7869, -74.9758],
  'puerto maldonado': [-12.5933, -69.1891],
  chachapoyas: [-6.2317, -77.8692],
  jaen: [-5.7089, -78.8078],
};

// Cómo pide la gente un género frente a cómo lo escribe Cineplanet. "Para
// niños" no es un género suyo: es clasificación APT más animación o familiar.
const GENEROS = [
  { pide: /\b(nin[oa]s?|infantil|familiar|en\s+familia|toda\s+la\s+familia|mis\s+hijos)\b/, generos: ['Animación', 'Familiar'], apt: true, dice: 'para niños', nada: 'nada para niños' },
  { pide: /\b(terror|miedo|susto|horror)\b/, generos: ['Terror'], dice: 'de terror', nada: 'nada de terror' },
  { pide: /\b(accion|aventura)\b/, generos: ['Acción'], dice: 'de acción', nada: 'nada de acción' },
  { pide: /\b(comedia|graciosa|risa|chistosa)\b/, generos: ['Comedia'], dice: 'de comedia', nada: 'ninguna comedia' },
  { pide: /\b(animad[ao]s?|dibujos|caricatura)\b/, generos: ['Animación'], dice: 'animada', nada: 'ninguna animada' },
  { pide: /\b(anime|japonesa)\b/, generos: ['Anime'], dice: 'anime', nada: 'nada de anime' },
  { pide: /\b(drama|dramatica)\b/, generos: ['Drama'], dice: 'de drama', nada: 'ningún drama' },
  { pide: /\b(documental|documentales)\b/, generos: ['Documental'], dice: 'documental', nada: 'ningún documental' },
  { pide: /\b(concierto|conciertos|musical)\b/, generos: ['Concierto'], dice: 'de concierto', nada: 'ningún concierto' },
];

// Formato e idioma vienen en los datos de cada función y hasta ahora se
// ignoraban en silencio: alguien pedía "doblada" y podía recibir subtitulada.
// El catálogo sólo usa 2D, REGULAR y PRIME; "3D" se acepta como palabra porque
// la gente la dice, y si no hay funciones así se le avisa.
const FORMATOS = [
  { pide: /\bprime\b/, valor: 'PRIME', dice: 'PRIME' },
  { pide: /\b3\s?d\b/, valor: '3D', dice: '3D' },
  { pide: /\b2\s?d\b/, valor: '2D', dice: '2D' },
  { pide: /\bregular\b/, valor: 'REGULAR', dice: 'regular' },
];
const IDIOMAS = [
  { pide: /\bdoblad[ao]s?\b|\ben\s+espanol\b|\bespanol\b/, valor: 'DOBLADA', dice: 'doblada' },
  { pide: /\bsubtitulad[ao]s?\b|\bsubtitulos?\b|\bsubs\b/, valor: 'SUBTITULAD', dice: 'subtitulada' },
];

/** Fecha de hoy en horario de Lima, como YYYY-MM-DD. */
export function limaToday() {
  return new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
}

const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const weekdayOf = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();

const nowMinutesLima = () => {
  const d = new Date(Date.now() - 5 * 3600 * 1000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};

function parseDate(text, today) {
  const t = norm(text);
  if (/pasado\s+manana/.test(t)) return { date: addDays(today, 2), said: 'pasado mañana' };
  // "mañana" es el día siguiente salvo que hable de la franja horaria.
  if (/\bmanana\b/.test(t) && !/(por|en|de)\s+la\s+manana/.test(t)) {
    return { date: addDays(today, 1), said: 'mañana' };
  }
  if (/\bhoy\b|\besta\s+noche\b|\besta\s+tarde\b|\bahorita\b|\bmas\s+tarde\b/.test(t)) {
    return { date: today, said: 'hoy' };
  }
  // "el fin de semana" = el próximo sábado, que es cuando la gente va al cine.
  if (/\bfin\s+de\s+semana\b/.test(t)) {
    const delta = (6 - weekdayOf(today) + 7) % 7 || 7;
    return { date: addDays(today, delta), said: 'el fin de semana' };
  }

  const dayName = DAYS.find((d) => new RegExp(`\\b${d}\\b`).test(t));
  if (dayName) {
    const target = DAYS.indexOf(dayName);
    let delta = (target - weekdayOf(today) + 7) % 7;
    if (delta === 0) delta = 7; // "el sábado" dicho un sábado = el próximo
    return { date: addDays(today, delta), said: dayName };
  }

  // "en 3 días", "la próxima semana": relativas que la gente usa a diario.
  const enDias = /\ben\s+(\d{1,2})\s+dias?\b/.exec(t);
  if (enDias) {
    const n = +enDias[1];
    if (n <= 60) return { date: addDays(today, n), said: `en ${n} días` };
  }
  if (/\b(la\s+)?(proxima|siguiente)\s+semana\b|\bsemana\s+que\s+viene\b/.test(t)) {
    return { date: addDays(today, 7), said: 'la próxima semana' };
  }
  // El pasado no se puede comprar; hay que decirlo, no resolverlo a hoy.
  if (/\bayer\b|\banteayer\b|\bantier\b/.test(t)) {
    return { date: null, said: null, imposible: 'esa fecha ya pasó' };
  }

  const dm = /\b(\d{1,2})\s+de\s+([a-z]+)/.exec(t);
  if (dm) {
    const month = MONTHS.findIndex((m) => m.startsWith(dm[2].slice(0, 4)));
    if (month >= 0) {
      const dia = +dm[1];
      const year = +today.slice(0, 4);
      // El 31 de febrero no existe: aceptarlo en silencio y devolver otra cosa
      // es peor que decirlo.
      const enMes = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      if (dia < 1 || dia > enMes) {
        return { date: null, said: null, imposible: `${dia} de ${MONTHS[month]} no existe` };
      }
      const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
      if (iso < today) return { date: null, said: null, imposible: 'esa fecha ya pasó' };
      return { date: iso, said: `${dm[1]} de ${MONTHS[month]}` };
    }
  }
  return { date: null, said: null };
}

/** Convierte una hora dicha en 12h a 24h, con el sesgo de que al cine se va de tarde. */
function to24(hour, text, position) {
  if (hour >= 13) return hour;
  const after = norm(text).slice(position);
  // "7pm" y "7 de la noche" mandan sobre cualquier suposición.
  if (/^\s*(pm|p m)\b/.test(after)) return hour === 12 ? 12 : hour + 12;
  if (/^\s*(am|a m)\b/.test(after)) return hour === 12 ? 0 : hour;
  if (/^\s*(de|en|por)\s+la\s+manana/.test(after) || /\bde\s+la\s+manana\b/.test(after)) {
    return hour;
  }
  if (hour === 12) return 12;
  return hour + 12; // 4 → 16, la lectura natural para una función de cine
}

function parseTime(text) {
  const t = norm(text);

  // "entre 4 y 6", "de 5 a 7pm", "desde las 5 hasta las 7": la misma idea dicha
  // de tres maneras, y la gente usa las tres.
  const between =
    /\b(?:entre|de|desde)\s+(?:las?\s+)?(\d{1,2})(?::(\d{2}))?\s*(?:am|pm)?\s*(?:y|a|hasta)\s*(?:las?\s+)?(\d{1,2})(?::(\d{2}))?/.exec(t);
  if (between) {
    const end = between.index + between[0].length;
    // El sufijo va al final ("de 5 a 7pm"), pero aplica a las dos horas.
    let to = to24(+between[3], t, end) * 60 + (+between[4] || 0);
    let from = to24(+between[1], t, end) * 60 + (+between[2] || 0);
    // Un rango invertido significa que una de las dos se leyó en la mitad
    // equivocada del día: "de 10 a 12 am" es 10:00–12:00, no 10:00–00:00.
    if (to <= from) {
      if (to + 12 * 60 <= 24 * 60) to += 12 * 60;
      else from -= 12 * 60;
    }
    return { from, to, said: `entre las ${between[1]} y ${between[3]}` };
  }

  // "de 6pm en adelante" es la forma más común de pedir una franja abierta y no
  // se entendía: la hora se perdía entera y "adelante" viajaba como si fuera un
  // título. Va antes que las demás porque la pista está al final de la frase.
  const enAdelante =
    /\b(?:de|desde|a\s+partir\s+de)?\s*(?:las?\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:en\s+adelante|para\s+adelante|pa\s+adelante)/.exec(t);
  if (enAdelante) {
    const end = enAdelante.index + enAdelante[0].length;
    return {
      from: to24(+enAdelante[1], t, end) * 60 + (+enAdelante[2] || 0),
      to: 24 * 60,
      said: `de las ${enAdelante[1]} en adelante`,
    };
  }

  const after = /\b(despues\s+de|a\s+partir\s+de|desde)\s+(?:las?\s+)?(\d{1,2})(?::(\d{2}))?/.exec(t);
  if (after) {
    const end = after.index + after[0].length;
    return {
      from: to24(+after[2], t, end) * 60 + (+after[3] || 0),
      to: 24 * 60,
      said: `después de las ${after[2]}`,
    };
  }

  const before = /\b(antes\s+de|hasta)\s+(?:las?\s+)?(\d{1,2})(?::(\d{2}))?/.exec(t);
  if (before) {
    const end = before.index + before[0].length;
    return {
      from: 0,
      to: to24(+before[2], t, end) * 60 + (+before[3] || 0),
      said: `antes de las ${before[2]}`,
    };
  }

  const at = /\ba\s+las?\s+(\d{1,2})(?::(\d{2}))?/.exec(t);
  if (at) {
    if (+at[1] > 24) return { from: null, to: null, said: null, imposible: `las ${at[1]} no es una hora` };
    const end = at.index + at[0].length;
    const minutes = to24(+at[1], t, end) * 60 + (+at[2] || 0);
    // Una hora suelta se lee como "cerca de", no como exacta.
    return { from: minutes - 45, to: minutes + 45, said: `cerca de las ${at[1]}` };
  }

  // Horas relativas: "más tarde" y "ahorita" se leen contra el reloj, no contra
  // el calendario. Sin esto la frase se ignora y la respuesta parece sorda.
  if (/\b(mas\s+tarde|luego|despues)\b/.test(t)) {
    return { from: nowMinutesLima() + 30, to: 24 * 60, said: 'más tarde' };
  }
  if (/\b(ahorita|ahora|ya mismo|lo antes posible)\b/.test(t)) {
    return { from: nowMinutesLima(), to: nowMinutesLima() + 180, said: 'ahora' };
  }
  if (/\b(al\s+)?mediodia\b/.test(t)) return { from: 11 * 60, to: 14 * 60, said: 'al mediodía' };
  if (/\bmedianoche\b/.test(t)) return { from: 22 * 60, to: 24 * 60, said: 'a medianoche' };
  if (/\b(en|por)\s+la\s+manana\b/.test(t)) return { from: 0, to: 12 * 60, said: 'en la mañana' };
  // "esta noche" no lleva artículo; exigirlo dejaba la frase sin franja horaria.
  if (/\b(en|por|esta|de)\s+(la\s+)?tarde\b/.test(t)) {
    return { from: 12 * 60, to: 19 * 60, said: 'en la tarde' };
  }
  if (/\b(en|por|esta|de)\s+(la\s+)?noche\b/.test(t)) {
    return { from: 19 * 60, to: 24 * 60, said: 'en la noche' };
  }
  return { from: null, to: null, said: null };
}

/**
 * Distancia de edición acotada: perdona tipeos sin inventar coincidencias.
 * Una letra en palabras cortas, dos en las largas — "estori" debe llegar a
 * "story", pero "nueva" no debería llegar a "nueve" sin más apoyo.
 */
function closeEnough(a, b) {
  const margen = Math.max(a.length, b.length) >= 6 ? 2 : 1;
  if (Math.abs(a.length - b.length) > margen || a.length < 3) return false;
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length] <= margen;
}

// Palabras que aparecen en tantos nombres de cine que por sí solas no eligen
// ninguno: "real plaza" está en seis sedes, "maria" en dos distritos distintos.
const WEAK_VENUE = new Set(['real', 'plaza', 'mall', 'centro', 'norte', 'sur', 'maria', 'santa', 'san', 'villa', 'del', 'jr', 'union', 'parque']);

/** Entre 1 y 8; fuera de ahí se ignora y se pregunta. */
function acotarPersonas(n) {
  if (n == null) return null;
  return n >= 1 && n <= 8 ? n : null;
}

/** Puntúa por tokens distintivos compartidos: "real plaza salaverry" → CP Salaverry. */
function bestByTokens(text, candidates, label, { weak = null, minScore = 0 } = {}) {
  const list = tokens(text);
  const want = new Set(list);
  if (!want.size) return null;
  const glued = list.join('');
  const scored = [];
  // Todas las palabras que usa esta lista. Sirve para saber si algo que la
  // persona escribió *pertenece a este campo*: "miraflores" nombra un distrito,
  // "doblada" no nombra ninguno. Sólo lo primero puede contradecir a un
  // candidato; lo segundo habla de otra cosa y no debe castigarlo.
  const vocabulario = new Set(candidates.flatMap((c) => tokens(label(c))));

  for (const item of candidates) {
    const have = tokens(label(item));
    if (!have.length) continue;

    const exactos = have.filter((w) => want.has(w));
    // Una palabra común del idioma no puede aportar parecido: de ahí salían
    // "pero"→"cero" y "nueva"→"nueve".
    const aprox = have.filter(
      (w) =>
        !want.has(w) &&
        list.some((q) => !COMUNES.has(q) && q.length >= 5 && closeEnough(q, w)),
    );
    const haveGlued = have.join('');
    const pegado =
      !exactos.length &&
      !aprox.length &&
      have.length > 1 &&
      glued.length >= 6 &&
      (glued.includes(haveGlued) || haveGlued.startsWith(glued));

    // Evidencia positiva: sin esto no hay candidato, por muy alto que puntúe.
    // Un parecido suelto sólo vale si la palabra es larga y distintiva.
    const hay =
      exactos.length > 0 ||
      pegado ||
      aprox.length >= 2 ||
      (aprox.length === 1 && aprox[0].length >= 5);
    if (!hay) continue;

    const hits = pegado ? have : [...exactos, ...aprox];
    // "real plaza" a secas no puede elegir sede: lo comparten muchas. Pero hay
    // sedes que se llaman **exactamente** así —CP Norte, CP Mall del Sur— y el
    // guardia las borraba enteras: la web ofrecía "CP Norte" y al pulsarlo
    // respondía que «norte» no está en cartelera. Decir el nombre completo no
    // es una pista floja, es el nombre.
    const completo = exactos.length === have.length;
    if (weak && !completo && hits.every((w) => weak.has(w))) continue;

    const peso = pegado ? have.length : exactos.length + aprox.length * 0.8;
    // Lo dicho y no explicado también informa: "san juan de miraflores" ganaba
    // para CP San Juan de Lurigancho —cubre "san" y "juan"— ignorando que la
    // persona dijo "miraflores", que es justo la palabra que las distingue.
    // Sin este castigo, el candidato que contradice lo escrito puede ganar.
    const ignoradas = list.filter(
      (q) =>
        q.length >= 5 &&
        !COMUNES.has(q) &&
        vocabulario.has(q) &&
        !have.some((w) => w === q || closeEnough(q, w)),
    );
    const score = peso / have.length + hits.length * 0.1 - ignoradas.length * 0.35;
    // Cuando la única evidencia es aproximada no hay certeza, hay sospecha.
    const confianza = exactos.length || pegado ? 'alta' : 'media';
    scored.push({ item, score, hits, confianza });
  }

  scored.sort((a, b) => b.score - a.score);
  if (!scored.length) return null;

  // Hay parecido pero no alcanza para elegir. Descartarlo era tirar la única
  // pista útil: "toi stori" se parece a Toy Story y merece una pregunta, no un
  // "no está en cartelera".
  if (scored[0].score < minScore) {
    // Una pista construida sólo con palabras comunes no es una pista: "pero"
    // coincide exacto con "Separada pero nunca sola" y no significa nada.
    const utiles = scored.filter((s) => s.hits.some((w) => !COMUNES.has(w)));
    return { item: null, confianza: 'baja', sugerencias: utiles.slice(0, 3).map((s) => s.item) };
  }

  const top = scored[0];
  top.tied = scored.filter((s) => s.score >= top.score - 0.01).map((s) => s.item);
  // Dos candidatos casi iguales tampoco son una certeza.
  if (top.tied.length > 1 && top.confianza === 'alta') top.confianza = 'media';
  top.alternativas = scored.slice(0, 3).map((s) => s.item);
  top.sugerencias = [];
  return top;
}

/**
 * Interpreta la frase contra el catálogo real.
 * @param {string} text frase del usuario
 * @param {{movies: Array, cinemas: Array, today?: string}} catalog
 */
// Cómo se conoce una película acá frente a cómo la titula Cineplanet. La API no
// trae el título original en ningún campo —se verificó: "insidious" no aparece
// en ninguna clave—, así que el puente hay que escribirlo. Reportado: "quiero
// ver insidious" contestaba que no está en cartelera, y sí estaba.
//
// Sólo entran nombres que en el Perú se dicen en inglés y cuyo estreno se
// tituló distinto. Los que se llaman igual —Toy Story, Shrek, Wicked, Barbie—
// no necesitan nada. Se evitan a propósito los muy cortos y ambiguos ("it",
// "up", "cars"): harían más daño que bien.
const ALIAS = [
  ['insidious', 'noche demonio'],
  ['the conjuring', 'conjuro'], ['conjuring', 'conjuro'],
  ['the nun', 'monja'],
  ['saw', 'juego del miedo'],
  ['final destination', 'destino final'],
  ['the exorcist', 'exorcista'],
  ['home alone', 'pobre angelito'],
  ['despicable me', 'villano favorito'],
  ['inside out', 'intensamente'],
  ['the lion king', 'rey leon'],
  ['beauty and the beast', 'bella bestia'],
  ['snow white', 'blancanieves'],
  ['sleeping beauty', 'bella durmiente'],
  ['the little mermaid', 'sirenita'],
  ['finding nemo', 'buscando nemo'],
  ['finding dory', 'buscando dory'],
  ['my neighbor totoro', 'vecino totoro'],
  ['spirited away', 'viaje chihiro'],
  ['howls moving castle', 'castillo ambulante'],
  ['princess mononoke', 'princesa mononoke'],
  ['grave of the fireflies', 'tumba luciernagas'],
  ['castle in the sky', 'castillo cielo'],
  ['the boy and the heron', 'nino garza'],
  ['the odyssey', 'odisea'],
  ['wuthering heights', 'cumbres borrascosas'],
  ['fast and furious', 'rapidos furiosos'], ['fast furious', 'rapidos furiosos'],
  ['the hunger games', 'juegos del hambre'],
  ['the avengers', 'vengadores'], ['avengers', 'vengadores'],
  ['guardians of the galaxy', 'guardianes galaxia'],
  ['black panther', 'pantera negra'],
  ['captain america', 'capitan america'],
  ['wonder woman', 'mujer maravilla'],
  ['fantastic four', 'fantasticos'],
  ['the bad guys', 'tipos malos'],
  ['demon slayer', 'guardianes noche'],
  ['how to train your dragon', 'entrenar dragon'],
  ['the smurfs', 'pitufos'],
  ['puss in boots', 'gato botas'],
  ['the incredibles', 'increibles'],
  ['wreck it ralph', 'ralph demoledor'],
  ['big hero 6', 'grandes heroes'],
  ['the substance', 'sustancia'],
  ['gladiator', 'gladiador'],
  ['back to the future', 'volver futuro'],
  ['the shining', 'resplandor'],
].map(([en, es]) => [norm(en), norm(es).split(' ')]);

/**
 * Película nombrada por su título original. Sólo cuenta si **una sola** de la
 * cartelera contiene todas las palabras del título peruano: si hay dos, no hay
 * certeza y sigue el camino normal, que sabe preguntar.
 */
function porAlias(text, movies) {
  const t = norm(text);
  const dichas = t.split(' ').filter(Boolean);
  for (const [en, palabras] of ALIAS) {
    // Con tolerancia a tipeos: la bitácora registró "insidous" —sin la segunda
    // i— fallando. Quien escribe un título en inglés lo escribe de oído.
    const partes = en.split(' ');
    const nombrado = new RegExp(`\\b${en}\\b`).test(t)
      ? true
      : partes.length === 1 && partes[0].length >= 6
        ? dichas.some((w) => closeEnough(w, partes[0]))
        : partes.every((pz) => dichas.some((w) => w === pz || (pz.length >= 6 && closeEnough(w, pz))));
    if (!nombrado) continue;
    const cand = movies.filter((m) => {
      const have = new Set(norm(m.title).split(' '));
      return palabras.every((w) => have.has(w));
    });
    if (cand.length === 1) {
      // Se devuelve lo que la persona escribió, no lo que quiso escribir: es lo
      // que hay que descontar de las palabras sin explicar.
      const escritas = dichas.filter(
        (w) => partes.includes(w) || partes.some((pz) => pz.length >= 6 && closeEnough(w, pz)),
      );
      return { item: cand[0], dicho: escritas.join(' ') || en };
    }
  }
  return null;
}

/**
 * Ciudad nombrada que sí tiene Cineplanet, con el centro de sus sedes como
 * ubicación. No se escribe a mano: sale del campo `city` de la propia API, así
 * que si abren una sede en una ciudad nueva se entiende sin tocar nada.
 *
 * El centro sirve para lo de siempre —ordenar por cercanía—, y en una ciudad
 * con muchas sedes deja arriba las céntricas, que es la mejor respuesta posible
 * cuando alguien sólo dijo "Lima".
 */
function ciudadNombrada(text, cinemas) {
  const t = norm(text);
  let mejor = null;
  for (const c of cinemas) {
    const ciudad = norm(c.city ?? '');
    if (!ciudad || ciudad.length < 4) continue;
    if (!new RegExp(`\\b${ciudad}\\b`).test(t)) continue;
    // Ante "Chiclayo" y "Chiclayo Real Plaza", gana el nombre más largo.
    if (!mejor || ciudad.length > norm(mejor.nombre).length) mejor = { nombre: c.city, sedes: [] };
  }
  if (!mejor) return null;
  mejor.sedes = cinemas.filter(
    (c) => norm(c.city ?? '') === norm(mejor.nombre) && Number.isFinite(c.lat),
  );
  if (!mejor.sedes.length) return null;
  mejor.coords = {
    lat: mejor.sedes.reduce((a, c) => a + c.lat, 0) / mejor.sedes.length,
    lon: mejor.sedes.reduce((a, c) => a + c.lon, 0) / mejor.sedes.length,
  };
  return mejor;
}

// Preguntas legítimas que esta web no responde. Decir "no entendí" ante
// "¿cuánto cuesta?" es cierto y no sirve: la persona preguntó bien, somos
// nosotros los que no lo hacemos. Decirlo de frente es mejor que hacerse el
// tonto, y evita que insista tres veces.
const FUERA = [
  { pide: /\b(precio|precios|cuesta|cuestan|cuanto\s+(sale|es|cuesta)|tarifa|entrada\s+cuanto)\b/, tema: 'los precios' },
  { pide: /\b(descuento|descuentos|promocion|promociones|2x1|dos\s+por\s+uno|socio|socios|cineplanet\s+card)\b/, tema: 'los descuentos y beneficios de socio' },
  { pide: /\b(combo|combos|canchita|popcorn|dulceria|comida|snack)\b/, tema: 'la dulcería' },
  { pide: /\b(estacionamiento|parqueo|cochera)\b/, tema: 'el estacionamiento' },
  { pide: /\b(reserva|reservar|reservame|apartar|apartame|separar)\b/, tema: 'reservar sin pagar' },
  { pide: /\b(a\s+que\s+hora\s+(abren|cierran)|horario\s+de\s+atencion)\b/, tema: 'el horario del local' },
];

// Saludos y ruido: no son una consulta, y tratarlos como título fue de donde
// salió «hola» no está en cartelera.
const SALUDO =
  /^(hola|holi|buenas|buenos\s+dias|buenas\s+tardes|buenas\s+noches|hey|ola|ola\s+k\s+ase|que\s+tal|saludos|alo)[\s!¡?¿.]*$/;
// Cortesía y ruido: no es un saludo, y responder "Hola" a un "gracias" suena a
// máquina que no escuchó.
const CORTESIA = /^(gracias|graciass?|ok|oka|okey|listo|ya|bueno|perfecto|genial|(?:ja|je|ji|ha){2,}|a{3,}|\?+|\.+|x+)[\s!¡?¿.]*$/;

export function parse(text, { movies, cinemas, today = limaToday() }) {
  // Las abreviaturas se expanden primero: el resto del intérprete no tiene por
  // qué enterarse de que existen.
  for (const [corto, largo] of Object.entries(ABREVIATURAS)) {
    const re = new RegExp(`\\b${corto}\\b`, 'gi');
    if (re.test(norm(text))) text = norm(text).replace(re, largo);
  }

  // Se busca por nombre y por distrito real: "en jesús maría" debe encontrar
  // CP Salaverry, que es donde está, aunque el nombre no lo diga.
  const porNombre = bestByTokens(text, cinemas, (c) => c.name, { weak: WEAK_VENUE, minScore: 0.45 });
  const porDistrito = bestByTokens(text, cinemas, (c) => c.district ?? '', {
    weak: WEAK_VENUE,
    minScore: 0.45,
  });
  // Gana el mejor puntaje, no el que se probó primero: el distrito de una sede
  // puede describirla mejor que su nombre. CP Mall del Sur está en San Juan de
  // Miraflores y su nombre no lo dice.
  let cinemaHit =
    porNombre?.item && porDistrito?.item
      ? porDistrito.score > porNombre.score
        ? porDistrito
        : porNombre
      : (porNombre?.item ? porNombre : porDistrito?.item ? porDistrito : null);
  // Un distrito sin sede propia igual dice dónde está la persona.
  const t = norm(text);
  // "¿qué otra me recomiendas?" pide una lista, no una película concreta.
  const pideRecomendacion =
    /\b(recomien|recomend|sugier|sugerenc|que\s+otra|otra\s+opcion|opciones)/.test(norm(text));
  const genero = GENEROS.find((g) => g.pide.test(norm(text))) ?? null;
  const formato = FORMATOS.find((f) => f.pide.test(norm(text))) ?? null;
  const idioma = IDIOMAS.find((i) => i.pide.test(norm(text))) ?? null;
  // Lo que disparó el género ya está explicado: "niños" no es un título.
  const dichoGenero = genero ? (genero.pide.exec(norm(text))?.[0] ?? '') : '';
  const ciudadSinSede = Object.keys(CIUDADES_SIN_SEDE).find((c) =>
    new RegExp(`\\b${c}\\b`).test(norm(text)),
  );
  // Ciudades donde sí hay Cineplanet, sacadas de los propios datos. "Lima" no
  // aparece en el nombre de ninguna sede, así que sin esto la respuesta más
  // probable a "¿en qué distrito estás?" —27 de los 43 cines— terminaba en
  // «lima» no está en cartelera. Un callejón sin salida en el paso más
  // transitado de la conversación.
  const ciudadConSede = ciudadNombrada(text, cinemas);
  const district = Object.keys(DISTRICTS)
    .filter((d) => new RegExp(`\\b${d}\\b`).test(t))
    .sort((a, b) => b.length - a.length)[0] ?? null;
  // Un lugar dicho con todas sus letras le gana a una sede que sólo se parece:
  // "puente piedra" es un distrito exacto y `piedra`→`piura` es un parecido.
  if ((district || ciudadConSede) && cinemaHit && cinemaHit.confianza !== 'alta') {
    cinemaHit = null;
  }

  const { date, said: dateSaid, imposible: fechaImposible } = parseDate(text, today);
  const { from, to, said: timeSaid, imposible: horaImposible } = parseTime(text);

  // Lo ya consumido por el cine, la fecha o la hora no debería competir por ser
  // película: si no, el "5" de "a las 5" gana contra "Toy Story 5".
  const used = new Set(cinemaHit?.hits ?? []);
  const rest = tokens(text)
    .filter((w) => !used.has(w) && !/^\d+$/.test(w) && !DAYS.includes(w) && !MONTHS.includes(w))
    .join(' ');
  // Una sola palabra genérica no debería elegir película: se exige que cubra
  // una parte real del título.
  // El título original manda sobre el parecido: quien escribe "insidious" no
  // está tanteando, sabe exactamente cuál quiere.
  const alias = porAlias(text, movies);
  const movieHit = alias
    ? { item: alias.item, confianza: 'alta', hits: tokens(alias.item.title) }
    : bestByTokens(rest, movies, (m) => m.title, { minScore: 0.5 });
  const people = /\b(\d+)\s*(personas?|entradas?|boletos?|butacas?|asientos?)\b/.exec(norm(text));
  const worded = Object.entries(WORD_NUMBERS).find(([w]) =>
    new RegExp(`\\b${w}\\s+(personas?|entradas?|boletos?|butacas?|asientos?)\\b`).test(norm(text)),
  );

  // Si nombró un lugar tras "en" y no es sede, distrito ni ciudad conocida, hay
  // que decir que no se conoce en vez de responder con cines de otra ciudad.
  let lugarDesconocido = null;
  if (!cinemaHit && !district && !ciudadSinSede) {
    const usadas = new Set([
      ...(movieHit?.item ? tokens(movieHit.item.title) : []),
      ...tokens(text).filter((w) => /^\d+$/.test(w) || DAYS.includes(w) || MONTHS.includes(w)),
    ]);
    const m = /\ben\s+(?:el\s+|la\s+|los\s+|las\s+)?([a-záéíóúñ]+(?:\s+[a-záéíóúñ]+)?)/i.exec(text);
    if (m) {
      const dicho = tokens(m[1]).filter((w) => !usadas.has(w));
      if (dicho.length) lugarDesconocido = m[1].trim();
    }
  }

  // El título puede robarle palabras a la sede: "la piedra filosofal" se parece
  // a "Piura" y mandaba a alguien de San Miguel a otra ciudad. Con la película
  // ya elegida, la sede se recalcula sin las palabras del título.
  if (movieHit?.item) {
    const delTitulo = new Set(tokens(movieHit.item.title));
    const sinTitulo = tokens(text)
      .filter((w) => !delTitulo.has(w))
      .join(' ');
    const porNom = bestByTokens(sinTitulo, cinemas, (c) => c.name, {
      weak: WEAK_VENUE,
      minScore: 0.45,
    });
    const porDist = bestByTokens(sinTitulo, cinemas, (c) => c.district ?? '', {
      weak: WEAK_VENUE,
      minScore: 0.45,
    });
    const otra =
      porNom?.item && porDist?.item
        ? porDist.score > porNom.score
          ? porDist
          : porNom
        : (porNom?.item ? porNom : porDist?.item ? porDist : null);
    cinemaHit = otra?.item ? otra : null;
  }

  // Cuántos van casi nunca viene como número. "Iré solo" o "somos 3" decían lo
  // mismo que "para 1 persona" y se ignoraban, así que seguía sugiriendo dos.
  const t2 = norm(text);
  const pareja = /\b(mi|con)\s+(novi[ao]|espos[ao]|pareja|enamorad[ao])\b/.test(t2);
  // "iré con mi amigo" son dos entradas. Se acepta sin el "con" porque el tipeo
  // es frecuente —"ire ocn mi amigo"— y "mi amigo" ya dice que no va solo.
  const acompanado =
    /\b(con\s+)?(mi|un[ao])\s+(amig[ao]|herman[ao]|prim[ao]|mama|papa|madre|padre|hij[ao]|novi[ao]|espos[ao]|pareja|enamorad[ao]|ti[ao]|abuel[ao])\b/.exec(t2);
  // En plural no dice cuántos: mejor preguntar que suponer.
  const enGrupoVago = /\b(con\s+)?(mis|unos|unas)\s+(amig[oa]s|herman[oa]s|prim[oa]s|hij[oa]s)\b/.test(t2);
  const solo =
    /\b(ire|ir|voy|iba|estare|estoy|vengo|vere|veo)\s+sol[oa]s?\b/.test(t2) ||
    /\b(yo\s+sol[oa]|sol[oa]\s+yo|sol[oa]\s+nomas)\b/.test(t2) ||
    /\bpara\s+mi\s+(sol[oa]|nomas)\b/.test(t2);
  const grupo = /\b(somos|vamos|seremos|iremos|seriamos)\s+(\d{1,2}|dos|tres|cuatro|cinco|seis|siete|ocho)\b/.exec(t2);
  const cuantosGrupo = grupo ? (WORD_NUMBERS[grupo[2]] ?? +grupo[2]) : null;


  // Palabras que no se pudieron atribuir a nada: probablemente sean un título
  // que no está en cartelera. Sirven para no rellenar con la película anterior.
  const atribuidas = new Set([
    // Lo que se escribió en inglés ya está explicado por la película.
    ...(alias ? alias.dicho.split(' ') : []),
    ...(ciudadConSede ? norm(ciudadConSede.nombre).split(' ') : []),
    ...(movieHit?.item ? tokens(movieHit.item.title) : []),
    ...(cinemaHit?.hits ?? []),
    ...(district ? tokens(district) : []),
    ...(ciudadSinSede ? tokens(ciudadSinSede) : []),
    ...tokens(dichoGenero),
    ...tokens(formato ? (formato.pide.exec(norm(text))?.[0] ?? '') : ''),
    ...tokens(idioma ? (idioma.pide.exec(norm(text))?.[0] ?? '') : ''),
    // "somos 3" y "voy solo" dicen cuántos van: no son un título desconocido.
    ...tokens(grupo?.[0] ?? ''),
    ...tokens(acompanado?.[0] ?? ''),
    ...(enGrupoVago ? ['amigos', 'amigas', 'hermanos', 'primos', 'hijos'] : []),
    ...(solo ? ['solo', 'sola', 'ire', 'voy', 'yo', 'nomas', 'vengo', 'estoy'] : []),
    ...(pareja ? ['mi', 'con', 'novia', 'novio', 'esposa', 'esposo', 'pareja'] : []),
    ...tokens(text).filter((w) => /^\d+$/.test(w) || DAYS.includes(w) || MONTHS.includes(w)),
  ]);
  const sobrantes = tokens(text).filter((w) => !atribuidas.has(w) && w.length >= 4);

  return {
    movie: movieHit?.item ?? null,
    movieConfianza: movieHit?.item ? movieHit.confianza : null,
    movieAlternativas: movieHit?.alternativas ?? [],
    movieSugerencias: movieHit?.sugerencias ?? [],
    cinema: cinemaHit?.item ?? null,
    // Igual que con las películas: un parecido no es una certeza. "puente
    // piedra" caía en CP Piura —a mil kilómetros— porque `piedra` está a dos
    // letras de `piura`, y se respondía sin dudar.
    cinemaConfianza: cinemaHit?.item ? (cinemaHit.confianza ?? 'alta') : null,
    // Varias sedes empatadas: quien resuelva debe preguntar, no elegir.
    cinemaOptions: cinemaHit?.tied?.length > 1 ? cinemaHit.tied : null,
    district: district ?? ciudadSinSede ?? ciudadConSede?.nombre ?? null,
    fuera: FUERA.find((f) => f.pide.test(norm(text)))?.tema ?? null,
    // Nombró un centro comercial que no está en los datos de Cineplanet. No se
    // puede afirmar si hay sede ahí o no, así que se pregunta por el distrito
    // en vez de inventar una respuesta en cualquiera de los dos sentidos.
    centroComercial:
      cinemaHit?.item || district
        ? null
        : (/\b(mega\s?plaza|jockey\s?plaza|open\s?plaza|mall\s?plaza|plaza\s?norte|centro\s+comercial|mall)\b/.exec(
            norm(text),
          )?.[0] ?? null),
    saludo: SALUDO.test(norm(text)) ? 'saludo' : CORTESIA.test(norm(text)) ? 'cortesia' : null,
    // Nombró una ciudad que sí tiene sedes. Sin esta distinción la respuesta
    // afirmaba "No hay Cineplanet en Lima", que es falso 27 veces.
    lugarConSede: !district && !ciudadSinSede && ciudadConSede ? ciudadConSede.sedes.length : 0,
    districtCoords: district
      ? { lat: DISTRICTS[district][0], lon: DISTRICTS[district][1] }
      : ciudadSinSede
        ? { lat: CIUDADES_SIN_SEDE[ciudadSinSede][0], lon: CIUDADES_SIN_SEDE[ciudadSinSede][1] }
        : (ciudadConSede?.coords ?? null),
    date,
    from,
    to,
    // Nadie compra 50 butacas juntas por chat, y 0 rompe la búsqueda de bloques.
    seats: acotarPersonas(
      people
        ? +people[1]
        : worded
          ? worded[1]
          : (cuantosGrupo ??
            (solo ? 1 : enGrupoVago ? null : acompanado || pareja ? 2 : null)),
    ),
    lugarDesconocido,
    sobrantes,
    formato: formato ? { valor: formato.valor, dice: formato.dice } : null,
    idioma: idioma ? { valor: idioma.valor, dice: idioma.dice } : null,
    pideRecomendacion,
    genero: genero
      ? { generos: genero.generos, apt: !!genero.apt, dice: genero.dice, nada: genero.nada }
      : null,
    said: { date: dateSaid, time: timeSaid },
    imposible: fechaImposible ?? horaImposible ?? null,
  };
}
