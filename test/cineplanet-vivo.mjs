// ¿Está Cineplanet respondiendo? Se pregunta antes de evaluar nada.
//
// Existe por una razón del proyecto: un build rojo por algo que no rompimos
// enseña a ignorar el rojo. Las pruebas y el barrido consultan la cartelera real,
// así que cuando la plataforma de Cineplanet se cae —pasa seguido— fallarían
// todas sin que hubiera nada que arreglar de este lado. En ese caso la revisión
// se salta y lo dice.
//
// Distingue dos cosas que antes se decían igual: que Cineplanet **rechace a
// GitHub** —un 403 en la portada, bloqueo por IP— y que Cineplanet esté
// **caído**. Desde el 16 de septiembre las corridas de la tarde reciben 403
// mientras la web anda bien: decir «su plataforma está caída» mandaba a buscar
// una caída que no existía. Y reintenta: un rechazo suelto no debe saltarse la
// revisión entera.
//
// Escribe `vivo=true|false` y `motivo=...` en $GITHUB_OUTPUT dentro de Actions.

import { appendFileSync } from 'node:fs';
import { movies, cinemas } from '../src/catalog.js';
import { edadDelCatalogo } from '../src/api.js';

const INTENTOS = 3;
const ESPERA_MS = Number(process.env.SONDA_ESPERA_MS) || 20_000;

const salir = (vivo, motivo, detalle) => {
  console.log(`${vivo ? 'Cineplanet responde' : 'Cineplanet no disponible'} (${motivo}): ${detalle}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `vivo=${vivo}\nmotivo=${motivo}\n`);
  // Nunca falla: no responder no es un error nuestro, es una condición del día.
  process.exit(0);
};

let ultimo = null;
for (let i = 1; i <= INTENTOS; i++) {
  try {
    // Un intento fallido no deja cookie guardada: el siguiente vuelve a pedirla.
    const [ms, cs] = await Promise.all([movies(), cinemas()]);
    // Un catálogo que salió del snapshot en disco no prueba que Cineplanet
    // responda: prueba que alguna vez respondió.
    const edad = edadDelCatalogo();
    if (edad != null && edad > 5 * 60_000) throw new Error(`sólo hay un snapshot de hace ${Math.round(edad / 60_000)} min`);
    if (ms.length && cs.length) salir(true, 'ok', `${ms.length} películas y ${cs.length} cines`);
    ultimo = new Error('devolvió catálogo vacío');
  } catch (err) {
    ultimo = err;
  }
  if (i < INTENTOS) {
    console.log(`Intento ${i} falló (${ultimo.message.slice(0, 90)}); reintento en ${ESPERA_MS / 1000} s`);
    await new Promise((r) => setTimeout(r, ESPERA_MS));
  }
}
const rechazo = /\(403\)/.test(ultimo?.message ?? '');
salir(false, rechazo ? 'rechazo' : 'caida', (ultimo?.message ?? '').slice(0, 200));
