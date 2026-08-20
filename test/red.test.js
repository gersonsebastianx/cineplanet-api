// Cómo se habla con Cineplanet: una sola llamada por dato, con plazo y con
// caducidad. Todo esto se prueba con un `fetch` de mentira, así que no depende
// de que su plataforma esté arriba.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.CACHE_DIR = mkdtempSync(join(tmpdir(), 'cine-test-'));
const { getJson, edadDelDato } = await import('../src/api.js');

const original = globalThis.fetch;
const responder = (json) => ({
  ok: true,
  status: 200,
  json: async () => json,
  headers: { getSetCookie: () => ['s=1; Path=/'] },
});

// Dos partes de la misma respuesta piden el mismo dato a la vez. Sin compartir
// la petición en curso se iba dos veces a la red por nada: la portada se
// visitaba dos veces en cada arranque en frío, que es cuando más se nota.
test('dos consultas simultáneas del mismo dato son una sola llamada', async (t) => {
  let llamadas = 0;
  globalThis.fetch = async () => {
    llamadas += 1;
    return responder({ dato: 1 });
  };
  t.after(() => {
    globalThis.fetch = original;
  });

  const [a, b] = await Promise.all([getJson('/prueba/uno'), getJson('/prueba/uno')]);
  assert.deepEqual(a, b);
  // Una para la cookie y una para el dato: nunca dos del mismo.
  assert.equal(llamadas, 2, `fueron ${llamadas} llamadas`);

  // Y lo ya traído no se vuelve a pedir mientras siga fresco.
  await getJson('/prueba/uno');
  assert.equal(llamadas, 2);
});

// Servir un dato viejo sin saber que es viejo es lo que lleva a ofrecer una
// función que ya no existe.
test('cada dato sabe de cuándo es', async (t) => {
  globalThis.fetch = async () => responder({ dato: 2 });
  t.after(() => {
    globalThis.fetch = original;
  });
  await getJson('/prueba/dos');
  const edad = edadDelDato('/prueba/dos');
  assert.ok(edad != null && edad < 5000, `edad rara: ${edad}`);
  assert.equal(edadDelDato('/prueba/jamas-pedido'), null);
});
