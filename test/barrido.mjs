// Barrido de la conversación entera contra la cartelera de hoy.
//
//   npm run barrido
//
// No corre con `npm test` a propósito: tarda uno o dos minutos porque recorre
// las 43 sedes y todas las películas con funciones. Es la red que encontró el
// bucle de "…Parte 1 / Parte 2", los 42 callejones de "¿qué dan hoy?" pasada la
// última función, y la que confirmó cada arreglo después.
//
// Busca cuatro cosas, que son las cuatro maneras de romper una conversación:
//
//   bucle      la misma pregunta contestando lo que la pregunta ofrecía
//   callejon   una pregunta sin nada que pulsar, o una respuesta muda
//   inventa    afirmar que lo escrito es una película que no está
//   cineAjeno  contestar con una función de una sede que no es la pedida
//   colision   una frase común que un título nuevo convierte en «esa película»
//
// Y de paso revisa que los enlaces de compra correspondan a lo que dice la
// tarjeta: película, sede, fecha, hora y sala.

import { resolve } from '../src/resolve.js';
import { movies, cinemas, showtimes } from '../src/catalog.js';
import { parse, STOP, DISTRICTS, CIUDADES_SIN_SEDE } from '../src/parser.js';

const PATRON = /^https:\/\/www\.cineplanet\.com\.pe\/compra\/([^/]+)\/(\d{10})\/(\d+)\/asientos$/;

const hallazgos = { bucle: [], callejon: [], inventa: [], cineAjeno: [], colision: [], enlace: [], error: [] };
const dicho = (r) => r?.pregunta ?? r?.mensaje ?? (r?.pedido ? `→ ${r.pedido.pelicula}` : '');

async function turno(texto, contexto, elegido) {
  try {
    return await resolve(texto, { contexto, elegido });
  } catch (err) {
    hallazgos.error.push([texto, err.message]);
    return null;
  }
}

/** El enlace de la tarjeta tiene que llevar a la función que la tarjeta anuncia. */
async function revisarEnlaces(caso, r, porSlug, porId) {
  if (r.estado !== 'ok') return;
  const mirar = async (link, etiqueta) => {
    const m = PATRON.exec(link ?? '');
    if (!m) return hallazgos.enlace.push([caso, `${etiqueta}: forma inesperada → ${link}`]);
    const [, slug, cinemaId, sessionId] = m;
    const peli = porSlug.get(slug);
    const cine = porId.get(cinemaId);
    if (peli?.title !== r.pedido.pelicula)
      hallazgos.enlace.push([caso, `${etiqueta}: lleva a «${peli?.title ?? slug}», la tarjeta dice «${r.pedido.pelicula}»`]);
    if (cine?.name !== r.funcion.cine)
      hallazgos.enlace.push([caso, `${etiqueta}: lleva a ${cine?.name ?? cinemaId}, la tarjeta dice ${r.funcion.cine}`]);
    if (etiqueta === 'principal' && peli) {
      const fs = await showtimes({ movie: peli, cinemaIds: [cinemaId] });
      const f = fs.find((x) => String(x.sessionId) === sessionId);
      if (!f) hallazgos.enlace.push([caso, `la sesión ${sessionId} no está en la cartelera`]);
      else if (f.date !== r.funcion.fecha || f.time !== r.funcion.hora || f.screen !== r.funcion.sala)
        hallazgos.enlace.push([caso, `la tarjeta dice ${r.funcion.fecha} ${r.funcion.hora} ${r.funcion.sala} y la sesión es ${f.date} ${f.time} ${f.screen}`]);
    }
  };
  await mirar(r.funcion.link, 'principal');
  for (const o of r.otras ?? []) await mirar(o.link, `otra ${o.fechaTexto} ${o.hora}`);
}

const cinemaList = await cinemas();
const movieList = await movies();
const porSlug = new Map(movieList.map((m) => [m.slug, m]));
const porId = new Map(cinemaList.map((c) => [c.id, c]));

// 1. Cada película con funciones, escrita a secas. Si la respuesta ofrece la
//    misma película y contestarla repite la pregunta, es un bucle sin salida.
let conFunciones = 0;
for (const m of movieList) {
  if (!(await showtimes({ movie: m })).length) continue;
  conFunciones += 1;
  const r = await turno(m.title);
  if (!r) continue;
  if (/no está en cartelera/i.test(dicho(r))) hallazgos.inventa.push([m.title, dicho(r)]);
  if (r.estado === 'confirmar' && r.opciones?.some((o) => o.nombre === m.title)) {
    const otra = await turno(m.title, r.contexto);
    if (otra && dicho(otra) === dicho(r)) hallazgos.bucle.push([m.title, dicho(r)]);
  }
}

// 2. Cada sede: pedir su cartelera y pulsar el primer título, como haría
//    cualquiera desde la web.
let tarjetas = 0;
for (const c of cinemaList) {
  const lista = await turno(`que dan hoy en ${c.name}`);
  if (!lista) continue;
  if (lista.estado === 'falta' && !lista.opciones?.length)
    hallazgos.callejon.push([`cartelera de ${c.name}`, dicho(lista)]);
  const opcion = lista.opciones?.[0];
  if (!opcion) continue;

  const r = await turno(opcion.nombre, lista.contexto, opcion.peliculaId ? { peliculaId: opcion.peliculaId } : null);
  if (!r) continue;
  if (r.estado === 'falta' && !r.opciones?.length) hallazgos.callejon.push([`${c.name} → ${opcion.nombre}`, dicho(r)]);
  if (!dicho(r)) hallazgos.callejon.push([`${c.name} → ${opcion.nombre}`, '(respuesta muda)']);
  if (r.estado === 'ok') {
    tarjetas += 1;
    if (r.funcion.cine !== c.name)
      hallazgos.cineAjeno.push([`${c.name} → ${opcion.nombre}`, `contestó ${r.funcion.cine}`]);
    await revisarEnlaces(`${c.name} → ${opcion.nombre}`, r, porSlug, porId);
  }
  if (r.estado === 'confirmar') {
    const otra = await turno(opcion.nombre, r.contexto);
    if (otra && dicho(otra) === dicho(r)) hallazgos.bucle.push([`${c.name} → ${opcion.nombre}`, dicho(r)]);
  }
}

// 3. Colisiones. El intérprete supone que ciertas palabras sólo significan una
//    cosa —«terror» es un género, «piedra» un distrito, «amigo» quién viene— y
//    cada estreno puede desmentirlo: pasó con «Tierra de mi Padre», «Amigo por
//    ahi no es», «A Cualquier Precio», «Terror en el Amazonas» y «Album de
//    Familia». Se prueban frases comunes contra la cartelera de hoy y ninguna
//    debería elegir película: nadie las escribió para eso. Los títulos dichos
//    de verdad no entran acá; los cubren las secciones de arriba.
const GENEROS = [
  'terror', 'miedo', 'susto', 'horror', 'accion', 'aventura', 'comedia', 'graciosa', 'risa',
  'animada', 'anime', 'drama', 'documental', 'concierto', 'musical', 'infantil', 'familiar', 'ninos',
];
const comunes = [
  'hola', 'gracias', 'ok', 'ayuda', 'que dan hoy', 'que hay', 'que peliculas hay', 'cartelera', 'estrenos',
  'otro cine', 'otra pelicula', 'no tengo idea', 'cerca de mi casa', 'cualquiera', 'da igual', 'lo que sea',
  'recomiendame algo', 'cuanto cuesta', 'hay descuento', 'reservar', 'estacionamiento', 'mas barato',
  'ire solo', 'ire con mi amigo', 'ire con mi novia', 'con mi familia', 'con mis amigos', 'somos 4',
  'para 2 personas', 'a las 7', 'mañana en la tarde', 'en la noche', 'el sabado',
  'en español', 'doblada', 'subtitulada', '3d', 'prime', 'angamos', 'chile', 'santiago',
];
const frases = [...comunes];
for (const g of GENEROS) frases.push(g, `algo de ${g}`, `una peli de ${g}`);
for (const w of STOP) if (w.length >= 4) frases.push(w, `quiero ${w}`);
const lugares = new Set([
  ...Object.keys(DISTRICTS),
  ...Object.keys(CIUDADES_SIN_SEDE),
  ...cinemaList.flatMap((c) => [c.name, c.district, c.city].filter(Boolean)),
]);
for (const l of lugares) frases.push(l, `vivo en ${l}`, `que dan en ${l}`);
for (const f of new Set(frases)) {
  const r = parse(f, { movies: movieList, cinemas: cinemaList });
  if (r.movie) hallazgos.colision.push([f, `eligió «${r.movie.title}» (${r.movieConfianza})`]);
}

console.log(
  `\n${cinemaList.length} sedes · ${conFunciones} películas con funciones · ${tarjetas} tarjetas armadas`,
);
let total = 0;
for (const [clase, lista] of Object.entries(hallazgos)) {
  total += lista.length;
  console.log(`\n== ${clase}: ${lista.length}`);
  for (const x of lista.slice(0, 12)) console.log('  ·', x[0], '→', String(x[1]).slice(0, 120));
}
console.log(total ? `\n${total} hallazgos` : '\nsin hallazgos');
process.exit(total ? 1 : 0);
