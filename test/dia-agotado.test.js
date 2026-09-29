// Cuando el primer día con funciones está agotado y los siguientes no.
//
// Del 28 de septiembre: «Avengers: Doomsday Infinity Vision» está en preventa,
// con funciones desde el 16 de diciembre. En CP San Borja ese primer día está
// entero agotado, pero desde el 17 hay 28 funciones con lugar. La web contestó
// «está agotada en CP San Borja **hoy**» —hoy no hay funciones— y ofreció otras
// películas, sin mirar nunca el día siguiente de la que la persona pedía.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fabricarMapas, elegirPar, pedirPrimerDia } from './apoyo/salas.js';

const par = await elegirPar();
// Agotado todo el primer día; lo demás tiene lugar.
const delPrimero = new Set((par?.delPrimero ?? []).map((f) => String(f.sessionId)));
fabricarMapas((sesion) => delPrimero.has(sesion));

test('un día agotado no le cierra la puerta al siguiente', { skip: !par && 'sin película con dos días futuros' }, async () => {
  const r = await pedirPrimerDia(par);
  assert.equal(r.estado, 'ok', `no ofreció el día siguiente: ${r.pregunta ?? r.mensaje}`);
  assert.equal(r.funcion.fecha, par.segundo, 'tenía que ser el primer día con lugar');
  assert.equal(r.ajuste, 'dia-agotado');
  // Se dice de dónde se viene, para que nadie crea que ese día no existía.
  assert.match(r.pedido.motivoDia, /agotada/i);
  assert.ok(r.mapa?.libres > 0, 'la función ofrecida tiene que tener lugar');
});
