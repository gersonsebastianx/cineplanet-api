// El endpoint que atiende a la gente: lo que lo protege el día que llega tráfico
// de golpe. Se prueba sin red, mandando consultas vacías: el límite se cuenta
// antes de resolver nada.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/consulta.js';

/** Un par req/res de mentira, con lo poco que el handler usa de cada uno. */
const pedir = async (cuerpo, cabeceras = {}) => {
  let estado = 200;
  let cuerpoRespuesta = null;
  const res = {
    status(n) {
      estado = n;
      return this;
    },
    json(v) {
      cuerpoRespuesta = v;
      return this;
    },
  };
  await handler({ method: 'POST', headers: cabeceras, body: cuerpo }, res);
  // `codigo` y no `estado`: la respuesta ya trae su propio campo `estado` y
  // uno pisaba al otro.
  return { codigo: estado, cuerpo: cuerpoRespuesta };
};

test('sin texto no se resuelve nada', async () => {
  const r = await pedir({ texto: '   ', sesion: 'vacia-1' });
  assert.equal(r.codigo, 400);
});

test('sólo se aceptan POST', async () => {
  let estado = 0;
  await handler({ method: 'GET', headers: {} }, { status(n) { estado = n; return this; }, json() { return this; } });
  assert.equal(estado, 405);
});

// Una pestaña en bucle o un script curioso no pueden agotar la paciencia de
// Cineplanet para todos los demás.
test('una conversación que se dispara sola se frena', async () => {
  const sesion = 'bucle-' + Math.random().toString(36).slice(2);
  let ultimo = null;
  for (let i = 0; i < 41; i++) ultimo = await pedir({ texto: '', sesion });
  assert.equal(ultimo.codigo, 429, 'la consulta 41 debería frenarse');
  assert.match(ultimo.cuerpo.mensaje, /espera/i);
});

// Y el freno es por conversación, no por IP: en el Perú media ciudad navega
// detrás de la misma IP de operadora, y contar por IP sería bloquear a
// desconocidos que no hicieron nada.
test('otra conversación desde la misma IP no queda bloqueada', async () => {
  const ip = { 'x-forwarded-for': '190.0.0.1' };
  const sesion = 'vecino-' + Math.random().toString(36).slice(2);
  for (let i = 0; i < 41; i++) await pedir({ texto: '', sesion }, ip);
  const otra = await pedir({ texto: '', sesion: 'otra-' + Math.random().toString(36).slice(2) }, ip);
  assert.equal(otra.codigo, 400, 'la otra conversación tendría que pasar el límite');
});
