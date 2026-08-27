// Los ejemplos que ve quien llega por primera vez.
//
// La regla es la misma que rige las pruebas: nada se fija a mano. Un ejemplo
// escrito con un título concreto caduca el día que esa película sale de
// cartelera, y entonces el primer botón de la web contesta «ya no está en
// cartelera» — la peor primera impresión posible.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ejemplosDeLaCartelera } from '../src/ejemplos.js';
import { resolve } from '../src/resolve.js';

const ejemplos = await ejemplosDeLaCartelera(2);

test('un ejemplo sólo se ofrece si funciona solo', async (t) => {
  if (!ejemplos.length) return t.skip('hoy no hay cartelera con la que armarlos');
  for (const frase of ejemplos) {
    const r = await resolve(frase);
    assert.ok(
      ['ok', 'cartelera'].includes(r.estado),
      `«${frase}» → ${r.estado}: ${r.pregunta ?? r.mensaje}`,
    );
  }
});

test('los dos ejemplos no nombran la misma sede', (t) => {
  if (ejemplos.length < 2) return t.skip('hoy sólo alcanzó para uno');
  const sede = (f) => f.replace(/^.*\ben\s+/i, '').replace(/\?$/, '').trim().toLowerCase();
  assert.notEqual(sede(ejemplos[0]), sede(ejemplos[1]), ejemplos.join(' / '));
});

// El último recurso de la web, si hasta la cartelera falla: no nombra ninguna
// película ni ningún cine, así que no puede caducar. Pero tiene que llevar a
// algún lado.
test('el último recurso lleva a algún lado y nunca caduca', async () => {
  for (const frase of ['¿Qué películas hay hoy?', 'Quiero ir al cine mañana']) {
    const r = await resolve(frase);
    assert.notEqual(r.estado, 'falta', `«${frase}» → ${r.pregunta}`);
    assert.ok(r.opciones?.length, `«${frase}» no ofrece por dónde seguir`);
  }
});
