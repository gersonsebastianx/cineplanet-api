// Pedir otro horario después de ver una función.
//
// De la revisión del 15 de octubre: tras ver «Madre Siniestra 20:30» en CP San
// Borja, «más tarde», «otro horario», «otra función» y «hay otra hora» devolvían
// **la misma tarjeta de las 20:30**, y «la siguiente» respondía «no entendí». Había
// una de las 22:40. Quien lo pide quiere una distinta de la que ya vio, no la
// misma otra vez: la web parecía sorda.
//
// Los mapas se fabrican (todo con lugar): no depende de qué tan llena esté hoy
// una sala, sino sólo de qué días y horas existen en la cartelera.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fabricarMapas, elegirDiaConVarias, dicho } from './apoyo/salas.js';

fabricarMapas(() => false);
const { resolve } = await import('../src/resolve.js');

const caso = await elegirDiaConVarias(3);
const [primera, segunda, ultima] = caso ? [caso.funciones[0], caso.funciones[1], caso.funciones.at(-1)] : [];
const sinCaso = !caso && 'ninguna película tiene tres funciones el mismo día';

/** Ve la función de las `hora` de ese día, para pedir otra a partir de ahí. */
async function verLa(hora) {
  const r = await resolve(`${caso.pelicula.title} en ${caso.sede.name} ${dicho(caso.fecha)} a las ${hora}`, {
    elegido: { peliculaId: caso.pelicula.id, cineId: caso.sede.id },
  });
  return r;
}
const minutos = (hhmm) => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5);

test('«más tarde» da una función posterior a la que ya se vio', { skip: sinCaso }, async () => {
  const uno = await verLa(primera.time);
  assert.equal(uno.estado, 'ok');
  const visto = minutos(uno.funcion.hora);
  for (const frase of ['mas tarde', 'una mas tarde', 'la siguiente', 'mas noche']) {
    const r = await resolve(frase, { contexto: uno.contexto });
    assert.equal(r.estado, 'ok', `«${frase}» → ${r.pregunta ?? r.mensaje}`);
    assert.equal(r.funcion.fecha, caso.fecha, `«${frase}» cambió de día`);
    assert.ok(minutos(r.funcion.hora) > visto, `«${frase}» devolvió ${r.funcion.hora}, que no es posterior a ${uno.funcion.hora}`);
    assert.equal(r.relativa, 'despues', frase);
  }
});

test('«más temprano» da una función anterior a la que ya se vio', { skip: sinCaso }, async () => {
  const uno = await verLa(ultima.time);
  const visto = minutos(uno.funcion.hora);
  const r = await resolve('mas temprano', { contexto: uno.contexto });
  assert.equal(r.estado, 'ok', r.pregunta ?? r.mensaje);
  assert.ok(minutos(r.funcion.hora) < visto, `devolvió ${r.funcion.hora}, no anterior a ${uno.funcion.hora}`);
  assert.equal(r.relativa, 'antes');
});

test('«otro horario» o «otra función» nunca devuelve la misma', { skip: sinCaso }, async () => {
  const uno = await verLa(segunda.time);
  for (const frase of ['otro horario', 'otra funcion', 'hay otra hora']) {
    const r = await resolve(frase, { contexto: uno.contexto });
    assert.equal(r.estado, 'ok', `«${frase}» → ${r.pregunta ?? r.mensaje}`);
    assert.notEqual(r.funcion.hora, uno.funcion.hora, `«${frase}» repitió la función de las ${uno.funcion.hora}`);
  }
});

test('avanzando con «más tarde» se llega a la última, y ahí se dice y queda por dónde seguir', { skip: sinCaso }, async () => {
  let r = await verLa(primera.time);
  const vistas = [minutos(r.funcion.hora)];
  // Una persona que sigue pidiendo «más tarde» recorre el día hasta que se acaba.
  for (let i = 0; i < caso.funciones.length + 1; i++) {
    r = await resolve('mas tarde', { contexto: r.contexto });
    if (r.estado !== 'ok') break;
    const h = minutos(r.funcion.hora);
    assert.ok(h > vistas.at(-1), `retrocedió: ${r.funcion.hora} después de ${vistas.at(-1)}`);
    vistas.push(h);
  }
  assert.notEqual(r.estado, 'ok', `nunca se acabó: siguió ofreciendo ${r.funcion?.hora}`);
  const d = r.pregunta ?? r.mensaje ?? '';
  assert.match(d, /última|única|ninguna más|no hay otra/i, d);
  assert.ok(r.opciones?.length, `sin salida: ${d}`);
  // Y la última que se vio es la última de verdad.
  assert.equal(vistas.at(-1), caso.funciones.at(-1).minutes, 'se detuvo antes de la última función');
});

test('«otro día» salta al siguiente día de esa película en esa sede', { skip: sinCaso }, async (t) => {
  const { showtimes } = await import('../src/catalog.js');
  const todas = await showtimes({ movie: caso.pelicula, cinemaIds: [caso.sede.id] });
  const siguiente = [...new Set(todas.map((f) => f.date).filter((d) => d > caso.fecha))].sort()[0];
  const uno = await verLa(primera.time);
  const r = await resolve('otro dia', { contexto: uno.contexto });
  if (!siguiente) {
    assert.notEqual(r.estado, 'ok', 'no hay otro día y repitió la función');
    assert.ok((r.pregunta ?? r.mensaje ?? '').length > 0);
    return;
  }
  assert.equal(r.estado, 'ok', r.pregunta ?? r.mensaje);
  assert.equal(r.funcion.fecha, siguiente, '«otro día» tenía que ser el siguiente día con funciones');
  assert.equal(r.relativa, 'dia');
});
