// Simula cómo escribe la gente de verdad y clasifica cada respuesta.
//
// No busca aciertos: busca **respuestas que rompen la conversación**. Tres
// categorías, de peor a menos peor:
//
//   inventa   → afirma algo que no sabemos: que lo dicho es una película que no
//               existe (la falla de «hola», «adelante», «lima», «norte»)
//   ciega     → no entendió nada y responde genérico, sin usar lo que sí sabía
//   muda      → error, excepción o respuesta vacía
//
// El corpus va de lo más simple a lo más enredado, en cuatro niveles. Sirve para
// ver **dónde** se rompe, no sólo cuánto: si sólo cae el nivel 4, el problema es
// otro que si cae el nivel 1.
//
// Las frases que traiga la bitácora entran acá. Ese es el circuito: alguien
// escribe algo que no entendemos, queda registrado, se convierte en caso y deja
// de fallar. Ver `NOTES.md`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from '../src/resolve.js';
import { movies, showtimes } from '../src/catalog.js';

// Los títulos salen de la cartelera del día, no de una lista escrita: el nivel
// básico afirma que escribir el nombre de una película que **sí se está dando**
// tiene que funcionar. Fijarlos a mano hacía fallar la prueba el día que esa
// película salía de cartelera — pasó con Toy Story y con Moana, y un build rojo
// por algo que no rompimos enseña a ignorar el rojo.
const enCartelera = [];
for (const m of await movies()) {
  if (enCartelera.length >= 3) break;
  if ((await showtimes({ movie: m })).length) enCartelera.push(m.title.toLowerCase());
}

const NIVELES = {
  // 1 — Lo mínimo. Si algo de esto falla, la web está rota.
  basico: [
    'hola', 'buenas', 'gracias', 'ok',
    'que hay?', 'que peliculas hay', 'que dan hoy', 'quiero ir al cine',
    ...enCartelera,
    'hoy', 'mañana', 'en la tarde', 'en la noche',
    'trujillo', 'lima', 'salaverry', 'san miguel',
    'que me recomiendas', 'algo para ver hoy', 'nose que ver', 'estoy aburrido',
  ],

  // 2 — Una frase completa, escrita con cuidado. El caso feliz.
  claro: [
    'quiero ver la odisea hoy en salaverry',
    'toy story mañana en trujillo',
    'la odisea el sabado a las 8 en salaverry',
    'algo de terror hoy en la noche en trujillo',
    'una comedia mañana en salaverry',
    'algo para niños hoy en la tarde en san miguel',
    'la odisea entre 4 y 6 en salaverry',
    'spiderman hoy a las 7 en comas',
    'quiero ver shrek con mi hijo el domingo',
    'la odisea doblada en salaverry',
    'toy story en 3d mañana',
    'algo subtitulado hoy en la noche en salaverry',
  ],

  // 3 — Como se escribe de verdad: apurado, con tipeos, a medias.
  real: [
    'q ay hoy', 'kiero ver algo', 'peliculaas', 'ola k ase',
    'la odicea en salaverri', 'toi stori hoy', 'insidous', 'minons en trujillo',
    'algo a las 8', 'de 6pm en adelante', 'a las 19:30', 'como a las 7 y media',
    'al mediodia', 'a la medianoche', 'despues del trabajo', 'temprano',
    'este viernes', 'pasado mañana', 'el 25', 'fin de semana', 'la proxima semana',
    'somos 3', 'ire solo', 'con mi enamorada', 'para toda la familia',
    'con mis hijos', 'somos 6 amigos', 'ire ocn mi amigo',
    'puente piedra', 'san juan de lurigancho', 'estoy en surco', 'vivo en los olivos',
    'el mas cercano', 'cerca de mi', 'callao', 'megaplaza', 'jockey plaza',
    'la nueva de terror', 'la de spiderman', 'la mas nueva', 'la primera de harry potter',
  ],

  // 4 — Lo enredado: seguimientos, mezclas largas, cosas que no hacemos y ruido.
  dificil: [
    'y mañana?', 'y a las 9?', 'hay otra hora?', 'y en 3d?', 'algo mas barato',
    'cuanto cuesta', 'hay descuento', 'tienen combos', 'aceptan socio',
    'hay estacionamiento', 'a que hora abren', 'resérvame', 'quiero comprar 2 entradas ya',
    'jajaja', '???', 'aaaa', 'x', 'no', 'si',
    'quiero ver algo de terror hoy en la noche en trujillo con mi amiga',
    'una comedia mañana temprano en salaverry para 4',
    'la odisea el sabado a las 8 en el real plaza de trujillo somos 2',
    'algo para niños hoy en la tarde cerca de san miguel para 3',
    'insidious hoy a las 10 de la noche en cp norte',
    'una como para las 6pm en adelante o 5 pm',
    'que este empezando ahorita en trujillo',
    'la odisea el 31 de febrero', 'la odisea ayer', 'la odisea para 50 personas',
    'algo en iquitos', 'la odisea en real plaza', 'cineplanet estaba en magdalena',
    'quiero ver la odisea pero en la molina y si no en san borja',
    // Traídas por la bitácora, de conversaciones reales del 17 de agosto.
    'me refiero de la 5 pm a 6 pm en adelante, que peliculas puedo encontrar en trujillo',
    'otra que me recomiendes aqui en trujillo',
    'El del mall del sur?',
    'quiero ver odisea mas tarde',
    'inuyasha quiero ver',
    // Del 18 de agosto: tres personas distintas escribieron "sherk" en cuatro
    // minutos, y una pidió cambiar de sede.
    'sherk quiero ver',
    'Sherk una entrada',
    'otro cine',
    'quiero dos entradas para la odisea mañana',
    'en cineplanet trujillo',
    // Del 19 de agosto: dos personas distintas preguntaron por otro país el
    // mismo día. Una se fue después de cinco turnos sin ver una sola función.
    'chile',
    'se puede en chile',
    'santiago',
    'espera, para qué pais de cineplanet funciona?',
    'era',
    // Del 20 de agosto: una película que no tenemos, con un país en el nombre.
    'lindo méxico mágico',
    // Del lanzamiento, septiembre: un cine que no existe, y un grupo de 6 que
    // dijo «no» cinco veces seguidas frente a una sala llena.
    'quiero ver spiderman en cp costanera',
    'No, que película tiene para 6 personas juntas en una sola fila',
    'No, quiero otra película',
    'No me queda claro que asiento hay',
    'No quiero otra película',
  ],
};

// Sólo cuenta como invento afirmar que lo escrito es una película que no está.
// "El 31 de febrero no existe" también dice "no existe" y es una respuesta
// correcta: la trampa está en cazar la afirmación, no la palabra.
const INVENTA = /no está en cartelera/i;
const CIEGA = /No reconocí la película|¿En qué cine\?|No entendí/i;

/** Corre un nivel y devuelve cómo salió cada frase. */
async function correr(frases) {
  const marcas = { bien: [], inventa: [], ciega: [], muda: [] };
  for (const frase of frases) {
    let r;
    try {
      r = await resolve(frase);
    } catch (err) {
      marcas.muda.push([frase, err.message]);
      continue;
    }
    const dicho = r.pregunta ?? r.mensaje ?? (r.pedido ? `→ ${r.pedido.pelicula}` : '');
    if (!dicho) marcas.muda.push([frase, JSON.stringify(r).slice(0, 60)]);
    else if (INVENTA.test(dicho)) marcas.inventa.push([frase, dicho]);
    else if (CIEGA.test(dicho)) marcas.ciega.push([frase, dicho]);
    else marcas.bien.push([frase, dicho]);
  }
  return marcas;
}

const resultados = {};
for (const [nivel, frases] of Object.entries(NIVELES)) {
  resultados[nivel] = await correr(frases);
}
const todas = Object.values(resultados);
const juntar = (clase) => todas.flatMap((m) => m[clase]);

// Afirmar algo que no sabemos no admite porcentaje: es cero o está mal.
test('ninguna frase recibe una afirmación inventada', () => {
  assert.deepEqual(
    juntar('inventa').map(([f]) => f),
    [],
    'decir «hola» no está en cartelera es afirmar algo que no sabemos',
  );
});

test('ninguna frase deja al chat mudo', () => {
  assert.deepEqual(juntar('muda').map(([f]) => f), []);
});

// Lo básico y lo claro no admiten fallas: es el camino que recorre casi todo el
// mundo. En lo real y lo difícil se tolera decir "no entendí", que es honesto.
for (const nivel of ['basico', 'claro']) {
  test(`nivel ${nivel}: todas las frases reciben una respuesta útil`, () => {
    const flojas = resultados[nivel].ciega.map(([f]) => f);
    assert.deepEqual(flojas, [], `${nivel} no puede quedarse en "no entendí"`);
  });
}

test('nivel real: menos del 15% se queda en "no entendí"', () => {
  const { ciega } = resultados.real;
  const pct = (ciega.length / NIVELES.real.length) * 100;
  assert.ok(pct < 15, `${pct.toFixed(0)}%: ${ciega.map(([f]) => f).join(', ')}`);
});

test('nivel difícil: menos del 25% se queda en "no entendí"', () => {
  const { ciega } = resultados.dificil;
  const pct = (ciega.length / NIVELES.dificil.length) * 100;
  assert.ok(pct < 25, `${pct.toFixed(0)}%: ${ciega.map(([f]) => f).join(', ')}`);
});

// De la bitácora del 20 de agosto: alguien buscando Spiderman escribió
// «angamos» —una avenida de Lima— y recibió «No entendí «angamos»», lo mismo
// que habría recibido escribiendo teclas al azar. El lugar sí se reconocía como
// desconocido; lo que pasaba es que la regla de palabras sin explicar contestaba
// antes. Decir «no ubico ese lugar» es cierto y deja seguir; «no entendí» suena
// a que la persona escribió mal.
test('un lugar que no ubicamos no se trata como palabras sin sentido', async () => {
  // Inventado a propósito: ningún título ni sede puede parecerse, así que el
  // caso no depende de la cartelera del día.
  for (const f of ['quiero ver algo en zurrumbanga', 'en zurrumbanga']) {
    const r = await resolve(f);
    const dicho = r.pregunta ?? r.mensaje ?? '';
    assert.match(dicho, /No ubico/i, f);
    assert.doesNotMatch(dicho, /No entendí/i, f);
    // Y nunca un callejón: siempre queda por dónde seguir.
    assert.ok(dicho.includes('?') || r.opciones?.length, `${f} no deja por dónde seguir`);
  }
});

// La misma conversación del 20 de agosto, entera. Tras elegir Lima, la persona
// contestó «angamos» a «¿cuál te queda cerca?» y recibió dos agravios en una
// línea: «no entendí» —como si hubiera escrito mal— y la lista de países, que
// borraba el Lima que acababa de elegir. Cuando la pregunta anterior fue por un
// lugar, lo que llega sin explicar es la respuesta a esa pregunta.
test('contestar un lugar que no ubicamos no borra lo ya elegido', async () => {
  const pelicula = (await movies()).find((m) => m.cinemas?.length > 1);
  if (!pelicula) return; // sin cartelera no hay nada que encadenar

  let ctx = null;
  for (const t of [pelicula.title, 'Lima']) ctx = (await resolve(t, { contexto: ctx })).contexto;
  assert.ok(ctx.coords, 'tras elegir Lima se recuerda dónde está la persona');

  const r = await resolve('angamos', { contexto: ctx });
  const dicho = r.pregunta ?? r.mensaje ?? '';
  assert.match(dicho, /No ubico/i, dicho);
  assert.doesNotMatch(dicho, /No entendí/i, dicho);
  // Lo elegido no se pierde: no se vuelve a preguntar por el país.
  assert.ok(r.opciones?.length, 'tiene que ofrecer por dónde seguir');
  const nombres = r.opciones.map((o) => o.nombre);
  assert.ok(
    !nombres.includes('Arequipa') && !nombres.includes('Piura'),
    `volvió a preguntar por la ciudad: ${nombres.join(' / ')}`,
  );
});

// El mismo desperdicio, un paso más allá: si lo que no entendimos no parece un
// lugar —«no tengo idea»— tampoco hay que volver a preguntar por el país. La
// persona ya dijo Lima; ofrecerle Arequipa y Piura es tirar lo que acaba de
// decir. Se le dice que no se entendió y se sigue con las sedes de donde está.
test('no entender algo no borra la ciudad ya elegida', async () => {
  const pelicula = (await movies()).find((m) => m.cinemas?.length > 1);
  if (!pelicula) return;

  let ctx = null;
  for (const t of [pelicula.title, 'Lima']) ctx = (await resolve(t, { contexto: ctx })).contexto;

  const r = await resolve('no tengo idea', { contexto: ctx });
  const dicho = r.pregunta ?? r.mensaje ?? '';
  assert.ok(r.opciones?.length, `sin opciones: ${dicho}`);
  const nombres = r.opciones.map((o) => o.nombre);
  assert.ok(
    !nombres.includes('Arequipa') && !nombres.includes('Piura'),
    `volvió a preguntar por la ciudad: ${nombres.join(' / ')}`,
  );
  // Y no se inventa que «tengo» sea un lugar.
  assert.doesNotMatch(dicho, /No ubico/i, dicho);
});
