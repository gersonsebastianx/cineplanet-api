// La cartelera de una sede, que es la pregunta más común de todas: "¿qué dan
// hoy en X?". Se prueba contra la cartelera del día, sin fijar sedes ni títulos
// a mano: lo que se afirma es la **forma** de la respuesta, no su contenido.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from '../src/resolve.js';
import { movies, cinemas, showtimes } from '../src/catalog.js';

const cinemaList = await cinemas();
const movieList = await movies();

/** Una sede con funciones publicadas: sin eso no hay nada que listar. */
async function sedeConCartelera() {
  for (const c of cinemaList) {
    for (const m of movieList) {
      const f = await showtimes({ movie: m, cinemaIds: [c.id] });
      if (f.length) return c;
    }
  }
  return null;
}

const sede = await sedeConCartelera();

// Preguntar la cartelera y recibir "¿qué quieres ver?" es devolver la pregunta.
// Pasadas las últimas funciones del día le pasaba a 42 de las 43 sedes: el
// filtro de funciones ya empezadas vaciaba el día y no había plan B.
test('preguntar la cartelera nunca devuelve la misma pregunta', async (t) => {
  if (!sede) return t.skip('hoy no hay funciones publicadas en ninguna sede');
  for (const frase of [`que dan hoy en ${sede.name}`, `que hay en ${sede.name}`]) {
    const r = await resolve(frase);
    assert.notEqual(r.estado, 'falta', `«${frase}» → ${r.pregunta}`);
    if (r.estado === 'cartelera') assert.ok(r.opciones?.length, `«${frase}» sin opciones`);
    else assert.equal(r.estado, 'sin-cartelera', `«${frase}» → ${r.estado}`);
  }
});

// Ceder el día y no recordarlo obliga a la persona a repetir "mañana" después
// de que se le ofreció justamente mañana.
test('cuando se cede el día, el contexto recuerda el día ofrecido', async (t) => {
  if (!sede) return t.skip('sin cartelera hoy');
  const r = await resolve(`que dan hoy en ${sede.name}`);
  if (r.estado !== 'cartelera' || !/pero .* sí:/.test(r.pregunta ?? '')) {
    return t.skip('hoy esa sede todavía tiene funciones: no hay día que ceder');
  }
  assert.ok(r.contexto.date, 'se ofreció otro día y no quedó recordado');
  const siguiente = await resolve(r.opciones[0].nombre, { contexto: r.contexto });
  assert.ok(['ok', 'confirmar'].includes(siguiente.estado), `quedó en ${siguiente.estado}`);
});

// Un botón que al pulsarlo no elige nada es una puerta pintada en la pared.
test('cada título ofrecido lleva su identificador', async (t) => {
  if (!sede) return t.skip('sin cartelera hoy');
  const r = await resolve(`que dan hoy en ${sede.name}`);
  if (r.estado !== 'cartelera') return t.skip('no hubo lista que revisar');
  for (const o of r.opciones) {
    assert.ok(o.peliculaId, `«${o.nombre}» se ofrece sin identificador`);
    assert.ok(movieList.some((m) => m.id === o.peliculaId), `«${o.nombre}» apunta a un id fantasma`);
  }
});

// Pulsar es elegir. Antes el texto del botón volvía a pasar por el intérprete y
// dos títulos casi iguales devolvían la misma pregunta una y otra vez.
test('pulsar una opción elige esa película, no la que se le parece', async () => {
  const alguna = movieList.find((m) => m.title);
  const r = await resolve('esa', { elegido: { peliculaId: alguna.id } });
  assert.equal(r.intent.movie?.id, alguna.id);
  // Y el título elegido no puede reaparecer como "no entendí".
  assert.ok(!/no entend/i.test(r.pregunta ?? ''), r.pregunta);
});

// Un identificador inventado no debe elegir nada ni romper la respuesta.
test('un identificador que no existe simplemente no elige', async () => {
  const r = await resolve('la odisea', { elegido: { peliculaId: 'NO-EXISTE-0000' } });
  assert.ok(r.estado);
});
