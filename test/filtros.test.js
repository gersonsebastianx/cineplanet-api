// Formato e idioma pedidos en una cartelera: se respetan o se dice que no se
// pudo, pero nunca se ignoran en silencio.
//
// De la revisión del 15 de octubre: «hay funciones en inglés en San Miguel» y
// «hay prime en Salaverry» devolvían la cartelera entera, como si no se hubiera
// dicho nada. Quien pregunta por PRIME o por subtituladas está decidiendo si va;
// listarle películas que no cumplen es peor que decirle que no hay.
//
// Es una propiedad, no un caso: se verifica contra los datos del día sin fijar
// qué película ni qué sede.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from '../src/resolve.js';
import { movies, cinemas, showtimes } from '../src/catalog.js';

const [ms, cs] = [await movies(), await cinemas()];

/** ¿Tiene esa película, en esa sede, alguna función con ese idioma? */
async function tiene(movieId, cineId, idioma) {
  const m = ms.find((x) => x.id === movieId);
  const fs = await showtimes({ movie: m, cinemaIds: [cineId] });
  return fs.some((f) => f.languages.includes(idioma));
}

test('pedir «en inglés» en una sede sólo ofrece películas que tienen función subtitulada ahí', async (t) => {
  let probadas = 0;
  for (const c of cs.slice(0, 12)) {
    const r = await resolve(`que dan en ${c.name} en ingles`);
    if (r.estado !== 'cartelera' || !r.opciones?.length) continue;
    probadas += 1;
    for (const o of r.opciones) {
      assert.ok(await tiene(o.peliculaId, c.id, 'SUBTITULAD'), `${c.name}: ofreció «${o.nombre}», que no tiene función subtitulada ahí`);
    }
  }
  if (!probadas) t.skip('ninguna sede tiene funciones subtituladas hoy');
});

test('si ninguna película cumple el formato, se dice en vez de listar la cartelera', async (t) => {
  let probadas = 0;
  for (const c of cs.slice(0, 20)) {
    // ¿Alguna película de esta sede tiene PRIME? Si sí, no es el caso.
    let hay = false;
    for (const m of ms) {
      const fs = await showtimes({ movie: m, cinemaIds: [c.id] });
      if (fs.some((f) => f.formats.includes('PRIME'))) { hay = true; break; }
    }
    if (hay) continue;
    const r = await resolve(`hay prime en ${c.name}`);
    probadas += 1;
    const d = r.pregunta ?? r.mensaje ?? '';
    assert.match(d, /PRIME/, `${c.name} no tiene PRIME y no lo dijo: ${d}`);
    assert.match(d, /\bno\b/i, `${c.name}: ${d}`);
    if (probadas >= 3) break;
  }
  if (!probadas) t.skip('todas las sedes revisadas tienen PRIME');
});
