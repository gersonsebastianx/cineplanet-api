// «Hoy ya no queda, pero en otra sede sí.»
//
// Sesión real del 13 de octubre, 18:22 hora de Lima: alguien quería ver una
// película esa noche. En CP San Miguel había función a las 19:25. Cambió a CP
// Salaverry, donde ya no quedaba ninguna hoy, y la web contestó «mañana 14:20»
// sin decirle que a diez kilómetros de ahí sí podía verla esa misma noche. Fue
// la respuesta más inútil de la conversación, y la más barata de dar.
//
// La lógica es pura y se prueba con sedes y funciones fabricadas: no depende de
// qué haya hoy en cartelera ni de qué hora sea.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sedesConFuncionHoy } from '../src/resolve.js';

const HOY = '2026-10-13';
// Sedes sobre una línea: cada 0,01° de latitud son ~1,1 km.
const sede = (id, nombre, km) => ({ id, name: nombre, city: 'Lima', lat: -12 - km / 111, lon: -77 });
const SEDES = [
  sede('A', 'CP Cerca', 2),
  sede('B', 'CP Media', 7),
  sede('C', 'CP Lejos', 15),
  sede('D', 'CP Muy Lejos', 90),
  sede('E', 'CP Otra Mas', 11),
  sede('O', 'CP Origen', 0),
];
const fn = (cinemaId, time, date = HOY) => {
  const [h, m] = time.split(':').map(Number);
  return { cinemaId, date, time, minutes: h * 60 + m };
};
const ORIGEN = { lat: -12, lon: -77 };
const pedir = (funciones, extra = {}) =>
  sedesConFuncionHoy({ funciones, cinemas: SEDES, origen: ORIGEN, hoy: HOY, excluir: 'O', ...extra });

test('ofrece las sedes más cercanas que todavía tienen función hoy', () => {
  const r = pedir([fn('C', '21:00'), fn('A', '19:25'), fn('B', '20:10'), fn('E', '22:00')]);
  assert.deepEqual(r.map((x) => x.id), ['A', 'B', 'E'], 'las tres más cercanas, de cerca a lejos');
  assert.equal(r[0].hora, '19:25');
  assert.ok(r[0].km < r[1].km);
});

test('no ofrece la sede de la que se viene, ni otros días, ni sedes a 90 km', () => {
  const r = pedir([fn('O', '21:00'), fn('A', '19:25', '2026-10-14'), fn('D', '21:00')]);
  assert.deepEqual(r, [], 'sin nada razonable no se inventa nada');
});

test('respeta la franja pedida y muestra la primera función que cumple', () => {
  // «Ya son las 18:22»: la de las 14:00 ya pasó, la de las 19:25 sirve.
  const r = pedir([fn('A', '14:00'), fn('A', '19:25'), fn('A', '21:50')], { from: 18 * 60 + 22 });
  assert.equal(r.length, 1);
  assert.equal(r[0].hora, '19:25');
  assert.deepEqual(pedir([fn('A', '14:00')], { from: 18 * 60 + 22 }), []);
});

test('una sede sin coordenadas no se ofrece: no se sabe qué tan lejos está', () => {
  const sinCoords = [...SEDES, { id: 'X', name: 'CP Sin Coordenadas', city: 'Lima' }];
  const r = sedesConFuncionHoy({ funciones: [fn('X', '20:00')], cinemas: sinCoords, origen: ORIGEN, hoy: HOY });
  assert.deepEqual(r, []);
});
