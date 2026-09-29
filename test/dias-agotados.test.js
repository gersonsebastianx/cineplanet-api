// Cuando nada tiene lugar: se dicen los días que se miraron, no «hoy».
//
// Complemento de `dia-agotado.test.js`, en su propio archivo porque `api.js`
// guarda cada mapa 45 s y los dos casos necesitan mapas distintos.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fabricarMapas, elegirPar, pedirPrimerDia } from './apoyo/salas.js';

const par = await elegirPar();
fabricarMapas(() => true); // todo agotado

test('si nada tiene lugar, no se dice que es «hoy»', { skip: !par && 'sin película con dos días futuros' }, async () => {
  const { limaToday } = await import('../src/parser.js');
  const r = await pedirPrimerDia(par);
  const d = r.pregunta ?? r.mensaje ?? '';
  assert.notEqual(r.estado, 'ok', d);
  assert.match(d, /agotada|no tiene lugar/i, d);
  // Los días revisados se nombran; «hoy» sería afirmar algo que no se miró.
  assert.doesNotMatch(d.split('.')[0], /\bhoy\b/i, `dijo «hoy» de un día futuro: ${d}`);
  // «mañana» nombra el día tanto como el número, cuando es el caso.
  const manana = new Date(new Date(`${limaToday()}T12:00:00Z`).getTime() + 86400e3).toISOString().slice(0, 10);
  const nombre = par.primero === manana ? /\bmañana\b/i : new RegExp(`\\b${+par.primero.slice(8, 10)}\\b`);
  assert.match(d, nombre, `no nombró el día revisado: ${d}`);
  // Y como Cineplanet contestó «agotada», no se dice que no se pudo mirar.
  assert.doesNotMatch(d, /No pude revisar/i, d);
});
