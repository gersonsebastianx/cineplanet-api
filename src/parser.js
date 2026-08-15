// Interpreta una frase suelta en español: "Toy Story hoy entre 4 y 6 en el
// real plaza salaverry" → { movie, date, from, to, cinema, seats }.
//
// No usa modelos de lenguaje a propósito. El vocabulario es cerrado —las
// películas en cartelera y los 41 cines— así que comparar contra esas listas
// es más exacto, instantáneo y gratis. Lo único abierto son fechas y horas, y
// eso son reglas.

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
    'hay algo tarde noche manana hoy dia sala butacas asientos').split(' '),
);

const tokens = (s) => norm(s).split(' ').filter((w) => w && !STOP.has(w));

const DAYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre',
];
const WORD_NUMBERS = {
  una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6,
  siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
};

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

function parseDate(text, today) {
  const t = norm(text);
  if (/pasado\s+manana/.test(t)) return { date: addDays(today, 2), said: 'pasado mañana' };
  // "mañana" es el día siguiente salvo que hable de la franja horaria.
  if (/\bmanana\b/.test(t) && !/(por|en|de)\s+la\s+manana/.test(t)) {
    return { date: addDays(today, 1), said: 'mañana' };
  }
  if (/\bhoy\b|\besta\s+noche\b|\besta\s+tarde\b/.test(t)) return { date: today, said: 'hoy' };

  const dayName = DAYS.find((d) => new RegExp(`\\b${d}\\b`).test(t));
  if (dayName) {
    const target = DAYS.indexOf(dayName);
    let delta = (target - weekdayOf(today) + 7) % 7;
    if (delta === 0) delta = 7; // "el sábado" dicho un sábado = el próximo
    return { date: addDays(today, delta), said: dayName };
  }

  const dm = /\b(\d{1,2})\s+de\s+([a-z]+)/.exec(t);
  if (dm) {
    const month = MONTHS.findIndex((m) => m.startsWith(dm[2].slice(0, 4)));
    if (month >= 0) {
      const year = today.slice(0, 4);
      const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(+dm[1]).padStart(2, '0')}`;
      return { date: iso, said: `${dm[1]} de ${MONTHS[month]}` };
    }
  }
  return { date: null, said: null };
}

/** Convierte una hora dicha en 12h a 24h, con el sesgo de que al cine se va de tarde. */
function to24(hour, text, position) {
  if (hour >= 13) return hour;
  const after = norm(text).slice(position);
  if (/^\s*(de|en|por)\s+la\s+manana/.test(after) || /\bde\s+la\s+manana\b/.test(after)) {
    return hour;
  }
  if (hour === 12) return 12;
  return hour + 12; // 4 → 16, la lectura natural para una función de cine
}

function parseTime(text) {
  const t = norm(text);

  const between = /\bentre\s+(?:las?\s+)?(\d{1,2})(?::(\d{2}))?\s*(?:y|a)\s*(?:las?\s+)?(\d{1,2})(?::(\d{2}))?/.exec(t);
  if (between) {
    const end = between.index + between[0].length;
    const from = to24(+between[1], t, end) * 60 + (+between[2] || 0);
    const to = to24(+between[3], t, end) * 60 + (+between[4] || 0);
    return { from, to, said: `entre las ${between[1]} y ${between[3]}` };
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
    const end = at.index + at[0].length;
    const minutes = to24(+at[1], t, end) * 60 + (+at[2] || 0);
    // Una hora suelta se lee como "cerca de", no como exacta.
    return { from: minutes - 45, to: minutes + 45, said: `cerca de las ${at[1]}` };
  }

  if (/\b(en|por)\s+la\s+manana\b/.test(t)) return { from: 0, to: 12 * 60, said: 'en la mañana' };
  if (/\b(en|por|esta)\s+la?\s*tarde\b|\bde\s+tarde\b/.test(t)) {
    return { from: 12 * 60, to: 19 * 60, said: 'en la tarde' };
  }
  if (/\b(en|por|esta)\s+la?\s*noche\b|\bde\s+noche\b/.test(t)) {
    return { from: 19 * 60, to: 24 * 60, said: 'en la noche' };
  }
  return { from: null, to: null, said: null };
}

/** Puntúa por tokens distintivos compartidos: "real plaza salaverry" → CP Salaverry. */
function bestByTokens(text, candidates, label) {
  const list = tokens(text);
  const want = new Set(list);
  if (!want.size) return null;
  const glued = list.join('');
  let best = null;
  for (const item of candidates) {
    const have = tokens(label(item));
    if (!have.length) continue;
    let hits = have.filter((w) => want.has(w));
    // "spiderman" pegado debe encontrar "Spider man Un nuevo dia": se comparan
    // sin espacios, en ambos sentidos, con largo mínimo para no unir cualquier cosa.
    const haveGlued = have.join('');
    if (!hits.length && have.length > 1 && glued.length >= 6) {
      if (glued.includes(haveGlued) || haveGlued.startsWith(glued)) hits = have;
    }
    if (!hits.length) continue;
    // Premia cubrir el nombre completo; así "toy story" no pierde con "toy".
    const score = hits.length / have.length + hits.length * 0.1;
    if (!best || score > best.score) best = { item, score, hits };
  }
  return best;
}

/**
 * Interpreta la frase contra el catálogo real.
 * @param {string} text frase del usuario
 * @param {{movies: Array, cinemas: Array, today?: string}} catalog
 */
export function parse(text, { movies, cinemas, today = limaToday() }) {
  const cinemaHit = bestByTokens(text, cinemas, (c) => c.name);
  const { date, said: dateSaid } = parseDate(text, today);
  const { from, to, said: timeSaid } = parseTime(text);

  // Lo ya consumido por el cine, la fecha o la hora no debería competir por ser
  // película: si no, el "5" de "a las 5" gana contra "Toy Story 5".
  const used = new Set(cinemaHit ? cinemaHit.hits : []);
  const rest = tokens(text)
    .filter((w) => !used.has(w) && !/^\d+$/.test(w) && !DAYS.includes(w) && !MONTHS.includes(w))
    .join(' ');
  const movieHit = bestByTokens(rest, movies, (m) => m.title);
  const people = /\b(\d+)\s*(personas?|entradas?|boletos?|butacas?|asientos?)\b/.exec(norm(text));
  const worded = Object.entries(WORD_NUMBERS).find(([w]) =>
    new RegExp(`\\b${w}\\s+(personas?|entradas?|boletos?|butacas?|asientos?)\\b`).test(norm(text)),
  );

  return {
    movie: movieHit?.item ?? null,
    cinema: cinemaHit?.item ?? null,
    date,
    from,
    to,
    seats: people ? +people[1] : worded ? worded[1] : null,
    said: { date: dateSaid, time: timeSaid },
  };
}
