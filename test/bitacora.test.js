// La clave privada se copia a mano de un JSON a un campo de una sola línea, y
// ahí se rompe de maneras que OpenSSL reporta como "DECODER routines::
// unsupported" — un error que no dice nada sobre la causa y costó una tarde.
//
// Estas pruebas fijan las formas que hay que tolerar. La clave se genera acá:
// ninguna real entra al repositorio.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { normalizarClave } from '../src/bitacora.js';

const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const firma = (pem) => crypto.createSign('RSA-SHA256').update('prueba').sign(pem);

for (const [comoLlega, romper] of [
  ['tal cual', (k) => k],
  ['con los saltos escapados', (k) => k.replace(/\n/g, '\\n')],
  ['sin ningún salto', (k) => k.replace(/\n/g, '')],
  ['con las comillas y la coma del JSON', (k) => `${JSON.stringify(k)},`],
  ['con espacios en vez de saltos', (k) => k.replace(/\n/g, ' ')],
  ['con espacios alrededor', (k) => `  ${k}  `],
]) {
  test(`la clave sirve ${comoLlega}`, () => {
    assert.doesNotThrow(() => firma(normalizarClave(romper(privateKey))));
  });
}

test('una clave rearmada firma igual que la original', () => {
  const a = firma(privateKey);
  const b = firma(normalizarClave(privateKey.replace(/\n/g, '\\n')));
  assert.deepEqual(a, b, 'rearmar el PEM no puede cambiar la firma');
});
