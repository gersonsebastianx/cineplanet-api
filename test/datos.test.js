// Preguntas sobre la película y despedidas.
//
// De la revisión del 15 de octubre: «cuánto dura Coyote vs Acme» sólo preguntaba
// la ciudad —como si no se hubiera dicho nada— aunque Cineplanet sí entrega la
// duración, y «chau» recibía «no entendí». Se prueba contra cualquier película
// del día con los datos que traiga, no contra una fija.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from '../src/resolve.js';
import { movies } from '../src/catalog.js';

const ms = await movies();
const contextoDe = (m) => ({ movieId: m.id, cinemaId: null, coords: null, date: null, from: null, to: null, seats: null });

test('«cuánto dura» se contesta con la duración que entrega Cineplanet', async (t) => {
  const m = ms.find((x) => x.runTime > 0);
  if (!m) return t.skip('ninguna película trae duración');
  const r = await resolve('cuanto dura', { contexto: contextoDe(m) });
  assert.match(r.aparte ?? '', new RegExp(`${m.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} dura`), r.aparte);
  const h = Math.floor(m.runTime / 60);
  const min = m.runTime % 60;
  if (h) assert.ok(r.aparte.includes(`${h} h`), `la duración tiene que decir ${h} h: ${r.aparte}`);
  if (min) assert.ok(r.aparte.includes(`${min} min`), `y ${min} min: ${r.aparte}`);
  // Y la conversación sigue: no se queda en el dato.
  assert.ok(r.pregunta || r.funcion || r.opciones?.length, 'después del dato tiene que seguir adelante');
});

test('la clasificación se dice como es: apta, o para mayores de N', async (t) => {
  const conRating = ms.filter((x) => x.rating);
  if (!conRating.length) return t.skip('ninguna película trae clasificación');
  for (const m of [conRating.find((x) => x.rating === 'APT'), conRating.find((x) => /^\+\d+$/.test(x.rating))].filter(Boolean)) {
    const r = await resolve('que clasificacion tiene', { contexto: contextoDe(m) });
    const esperado = m.rating === 'APT' ? /apta para todo público/ : new RegExp(`mayores de ${m.rating.slice(1)} años`);
    assert.match(r.aparte ?? '', esperado, `${m.title} (${m.rating}): ${r.aparte}`);
  }
});

test('de la trama se dice lo que no se tiene, sin inventar nada', async () => {
  const m = ms.find((x) => x.genre) ?? ms[0];
  const r = await resolve('de que trata', { contexto: contextoDe(m) });
  assert.match(r.aparte ?? '', /No tengo la sinopsis/, r.aparte);
  // Lo único que sí se sabe es el género y la duración.
  if (m.genre) assert.ok(r.aparte.toLowerCase().includes(m.genre.toLowerCase()), r.aparte);
});

test('preguntar por una película que no se nombró no inventa un dato', async () => {
  const r = await resolve('cuanto dura');
  assert.equal(r.aparte, undefined, 'no hay película de la que hablar');
});

test('despedirse se cierra bien y no es un «no entendí»', async () => {
  for (const f of ['chau', 'adios', 'gracias', 'hasta luego']) {
    const r = await resolve(f);
    const d = r.pregunta ?? r.mensaje ?? '';
    assert.doesNotMatch(d, /No entend/i, `«${f}» → ${d}`);
    assert.match(d, /disfrutes/i, `«${f}» no se despidió: ${d}`);
  }
});
