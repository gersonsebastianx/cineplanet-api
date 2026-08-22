// El hilo de la conversación: lo que ya se sabe no se tira al primer tropiezo,
// y lo que se pregunta de verdad se contesta.
//
// Los dos casos salen de la bitácora del 19 de agosto. Alguien escribió "la
// odisea", después "chile", y de ahí en adelante la web había olvidado la
// película: cinco turnos, ninguna función. Ver NOTES.md, "el circuito".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from '../src/resolve.js';
import { movies } from '../src/catalog.js';

const enCartelera = (await movies()).find((m) => !m.comingSoon);

test('una palabra que no se entiende no borra la película', async () => {
  const primero = await resolve(enCartelera.title);
  assert.equal(primero.contexto.movieId, enCartelera.id, 'no llegó a reconocerla');

  // Una palabra cualquiera, que no se parece a ningún título: no hay razón
  // para creer que cambiaron de película.
  const segundo = await resolve('asdfgh', { contexto: primero.contexto });
  assert.equal(
    segundo.contexto.movieId,
    enCartelera.id,
    `se olvidó de ${enCartelera.title}: «${segundo.pregunta}»`,
  );
});

// Cineplanet no está sólo en el Perú y la gente lo sabe. Contestar "no entendí
// «chile»" y pedir un distrito es hacerse el tonto con una pregunta legítima.
test('preguntar por otro país recibe una respuesta honesta', async () => {
  for (const frase of ['chile', 'se puede en chile', 'espera, para qué pais de cineplanet funciona?']) {
    const r = await resolve(frase);
    const dicho = r.pregunta ?? r.mensaje ?? '';
    assert.ok(!/no entend/i.test(dicho), `«${frase}» → ${dicho}`);
    assert.match(dicho, /Perú/, `«${frase}» no dice de qué país es la cartelera: ${dicho}`);
  }
});

// Y preguntar por el país en medio de una búsqueda no la tira por la borda.
test('la pregunta por el país no pierde lo que ya se sabía', async () => {
  const primero = await resolve(enCartelera.title);
  const segundo = await resolve('se puede en chile', { contexto: primero.contexto });
  assert.equal(segundo.contexto.movieId, enCartelera.id);
});

// Un lugar del Perú manda sobre el parecido con uno de afuera: "Santiago de
// Surco" es Lima, no Chile.
test('un distrito peruano no se confunde con el extranjero', async () => {
  const r = await resolve('que dan hoy en santiago de surco');
  assert.notEqual(r.estado, 'falta', `«santiago de surco» → ${r.pregunta}`);
});

// Lo contrario también tiene que seguir siendo cierto: si lo que no se entendió
// **sí** se parece a un título, están nombrando otra película y heredar la
// anterior sería contestar por una que nadie pidió.
test('un parecido a otro título sí suelta la película anterior', async () => {
  const primero = await resolve(enCartelera.title);
  const otra = (await movies()).find((m) => m.id !== enCartelera.id && m.title.length > 8);
  // Escrito con un tipeo, para que no lo reconozca del todo y quede como
  // parecido: es el caso que la regla vigila.
  const conTipeo = otra.title.slice(0, 6).replace(/.$/, 'x');
  const segundo = await resolve(conTipeo, { contexto: primero.contexto });
  if (!segundo.opciones?.length && segundo.contexto.movieId === enCartelera.id) {
    // No llegó a parecerse a nada: el caso no aplica hoy.
    return;
  }
  assert.notEqual(segundo.contexto.movieId, enCartelera.id);
});

// Preguntar dónde está la persona es la pregunta más repetida de la bitácora
// —14 de 36 turnos atascados en una semana— y era la única sin botones: había
// que escribir. Todas las demás ofrecen por dónde seguir.
test('preguntar dónde siempre ofrece ciudades a un toque', async () => {
  for (const frase of [enCartelera.title, 'que peliculas hay?', 'quiero ir al cine']) {
    const r = await resolve(frase);
    if (r.estado === 'ok' || r.estado === 'cartelera') continue; // ya llegó más lejos
    assert.ok(r.opciones?.length, `«${frase}» pregunta sin ofrecer nada: ${r.pregunta}`);
  }
});

// Y esos botones tienen que llevar a algún lado: pulsando ciudad y sede se
// llega a la función, sin escribir una palabra más.
test('de la película a la función en dos toques', async (t) => {
  const primero = await resolve(enCartelera.title);
  if (!primero.opciones?.length) return t.skip('esa película ya resolvió sede sola');
  const ciudad = await resolve(primero.opciones[0].nombre, { contexto: primero.contexto });
  assert.ok(ciudad.opciones?.length, `la ciudad no ofreció sedes: ${ciudad.pregunta}`);
  const sede = ciudad.opciones[0];
  const final = await resolve(sede.nombre, {
    contexto: ciudad.contexto,
    elegido: sede.id ? { cineId: sede.id } : null,
  });
  assert.ok(['ok', 'cartelera'].includes(final.estado), `quedó en ${final.estado}: ${final.pregunta}`);
});

// El país dentro de un título no es un destino. Alguien escribió "lindo méxico
// mágico" —una película que no tenemos— y se le contestó que no tenemos
// cartelera de México. Un nombre de lugar sólo cuenta como lugar si va detrás
// de "en" o si es todo lo que dice el mensaje.
test('un país dentro de un título no se lee como destino', async () => {
  const r = await resolve('lindo méxico mágico');
  assert.ok(!/Cineplanet Perú/.test(r.pregunta ?? ''), `lo leyó como país: ${r.pregunta}`);
});

// Y tampoco se afirma qué película era: compartir una sola palabra con un
// título, dejando dos sin explicar, da para preguntar, no para decidir.
test('con cabos sueltos se pregunta, no se afirma', async () => {
  const r = await resolve('lindo méxico mágico');
  assert.ok(
    r.estado === 'confirmar' || /no está en cartelera|no entend/i.test(r.pregunta ?? r.mensaje ?? ''),
    `afirmó sin preguntar: [${r.estado}] ${r.pregunta ?? r.mensaje}`,
  );
});
