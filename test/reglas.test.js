// El orden de las reglas es una regla del producto, no un detalle interno: cada
// una de estas líneas se puso razonando qué debía contestar antes que qué.
// Fijarlo acá hace que reordenar sea un cambio explícito y no un accidente.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ORDEN_DE_REGLAS } from '../src/resolve.js';

test('las reglas se evalúan en el orden acordado', () => {
  assert.deepEqual(ORDEN_DE_REGLAS, [
    'fecha-imposible',
    'fuera-de-lo-que-hacemos',
    'centro-comercial-sin-sede',
    'pide-otro-cine',
    'saludo',
    'distrito-sin-sede-propia',
    'sede-solo-parecida',
    'pelicula-solo-parecida',
    'pide-recomendacion',
    'parecido-que-no-alcanzo',
    'palabras-sin-explicar',
    'sin-pelicula',
    'sin-funciones-en-el-pais',
    'varias-sedes-empatadas',
    'lugar-desconocido',
    'falta-la-sede',
    'no-la-dan-en-esa-sede',
  ]);
});

test('ninguna regla se queda sin nombre ni sin condición', () => {
  assert.equal(new Set(ORDEN_DE_REGLAS).size, ORDEN_DE_REGLAS.length);
  for (const nombre of ORDEN_DE_REGLAS) assert.match(nombre, /^[a-z][a-z-]+$/);
});
