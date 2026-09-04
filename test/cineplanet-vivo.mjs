// ¿Está Cineplanet respondiendo? Se pregunta antes de evaluar nada.
//
// Existe por una razón del proyecto: un build rojo por algo que no rompimos
// enseña a ignorar el rojo. Las pruebas y el barrido consultan la cartelera real,
// así que cuando la plataforma de Cineplanet se cae —pasa seguido, y dos horas
// seguidas durante el desarrollo— fallarían todas sin que hubiera nada que
// arreglar de este lado. En ese caso la revisión se salta y lo dice.
//
// Escribe `vivo=true|false` en $GITHUB_OUTPUT cuando corre dentro de Actions.

import { appendFileSync } from 'node:fs';

const decir = (vivo, porque) => {
  console.log(vivo ? `Cineplanet responde: ${porque}` : `Cineplanet no responde: ${porque}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `vivo=${vivo}\n`);
  // Nunca falla: no responder no es un error nuestro, es una condición del día.
  process.exit(0);
};

try {
  const { movies, cinemas } = await import('../src/catalog.js');
  const [ms, cs] = await Promise.all([movies(), cinemas()]);
  if (!ms.length || !cs.length) decir(false, 'devolvió catálogo vacío');
  decir(true, `${ms.length} películas y ${cs.length} cines`);
} catch (err) {
  decir(false, err.message.slice(0, 200));
}
