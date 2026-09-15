// Cuando Cineplanet no entrega los mapas de butacas.
//
// Pasa: su plataforma se cae por partes. La cartelera responde y los mapas no.
// Lo que no puede pasar es convertir «no pude mirar» en «no hay lugar»: con los
// mapas caídos, la web afirmaba «mañana ninguna película tiene lugar para 6» —
// una afirmación sobre la sala hecha sin haber visto la sala.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const original = globalThis.fetch;
globalThis.fetch = async (...args) => {
  if (String(args[0]).includes('/seatplan/')) throw new Error('mapas caídos (simulado)');
  return original(...args);
};

const { resolve } = await import('../src/resolve.js');
const { cinemas } = await import('../src/catalog.js');

test('sin mapas no se afirma que no hay lugar', async (t) => {
  let r = null;
  for (const c of (await cinemas()).slice(0, 8)) {
    const intento = await resolve(`que dan mañana en ${c.name} para 6 personas`);
    if (intento.estado !== 'elige-cine') {
      r = intento;
      break;
    }
  }
  if (!r) return t.skip('sin cartelera para mañana');
  const d = r.pregunta ?? r.mensaje ?? '';
  assert.ok(!/ninguna película tiene lugar|no tiene lugar/i.test(d), `afirmó sin mirar: ${d}`);
  assert.equal(r.estado, 'cartelera', `no ofreció la cartelera: ${d}`);
  assert.match(d, /butacas/i, `no avisó que no pudo revisar las butacas: ${d}`);
});
