// Simula cómo escribe la gente de verdad y clasifica cada respuesta.
//
// No busca aciertos: busca **respuestas que rompen la conversación**. Tres
// categorías, de peor a menos peor:
//
//   inventa   → afirma que algo no está en cartelera cuando lo dicho no era un
//               título (la falla de «adelante», «lima», «norte»)
//   ciega     → no entendió nada y devuelve la pregunta genérica, sin usar lo
//               poco que sí sabía
//   muda      → error, excepción o respuesta vacía

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from '../src/resolve.js';

const FRASES = [
  // Cómo empieza la gente
  'hola', 'buenas', 'que hay?', 'que peliculas hay', 'que dan hoy',
  'quiero ir al cine', 'algo para ver hoy', 'que me recomiendas',
  'nose que ver', 'estoy aburrido', 'quiero ver una peli',

  // Película + lugar, con y sin cuidado
  'toy story en salaverry', 'la odisea hoy trujillo', 'spiderman en comas',
  'quiero ver shrek', 'harry potter donde lo dan', 'la de spiderman',
  'la nueva de terror', 'la de harry potter la primera',

  // Horas como se dicen de verdad
  'algo a las 8', 'a las 8 de la noche', 'de 6pm en adelante',
  'despues del trabajo', 'en la tarde', 'temprano', 'a la medianoche',
  'entre 4 y 6', 'de 5 a 7', 'como a las 7 y media', 'a las 19:30',
  'antes de las 5', 'al mediodia', 'que este empezando ahorita',

  // Días
  'hoy', 'mañana', 'este viernes', 'el sabado', 'fin de semana',
  'pasado mañana', 'el 25', 'la proxima semana',

  // Lugares
  'lima', 'en trujillo', 'puente piedra', 'san juan de lurigancho',
  'estoy en surco', 'vivo en los olivos', 'el mas cercano', 'cerca de mi',
  'callao', 'en el norte de lima', 'megaplaza', 'jockey plaza',

  // Cuántos van
  'somos 3', 'ire solo', 'con mi enamorada', 'para toda la familia',
  'con mis hijos', 'somos 6 amigos',

  // Preguntas de seguimiento
  'y mañana?', 'y a las 9?', 'hay otra hora?', 'algo mas barato',
  'y en 3d?', 'cuanto cuesta', 'hay descuento', 'aceptan socio',

  // Cosas que no sabemos hacer
  'quiero comprar 2 entradas ya', 'resérvame', 'cual es el precio',
  'tienen combos', 'hay estacionamiento', 'a que hora abren',

  // Ruido y escritura descuidada
  'ola k ase', 'peliculaas', 'q ay hoy', 'kiero ver algo',
  'hay algo bueno?', 'jajaja', 'gracias', 'ok', '???', 'aaaa',

  // Mezclas largas, como escribe la gente cuando está apurada
  'quiero ver algo de terror hoy en la noche en trujillo con mi amiga',
  'una comedia mañana temprano en salaverry para 4',
  'la odisea el sabado a las 8 en el real plaza de trujillo somos 2',
  'algo para niños hoy en la tarde cerca de san miguel',
  'insidious hoy a las 10 de la noche',
];

const INVENTA = /no está en cartelera|no existe/i;
// "No entendí" ya no miente, pero tampoco ayuda: se cuenta aparte para verlo.
const CIEGA = /No reconocí la película|¿En qué cine\?|No entendí/i;

const marcas = { bien: [], inventa: [], ciega: [], muda: [] };

for (const frase of FRASES) {
  let r;
  try {
    r = await resolve(frase);
  } catch (err) {
    marcas.muda.push([frase, err.message]);
    continue;
  }
  const dicho = r.pregunta ?? r.mensaje ?? (r.pedido ? `→ ${r.pedido.pelicula}` : '');
  if (!dicho) marcas.muda.push([frase, JSON.stringify(r).slice(0, 60)]);
  else if (INVENTA.test(dicho)) marcas.inventa.push([frase, dicho]);
  else if (CIEGA.test(dicho)) marcas.ciega.push([frase, dicho]);
  else marcas.bien.push([frase, dicho]);
}

// Lo que se afirma nunca puede ser inventado: eso no admite porcentaje.
test('ninguna frase recibe una afirmación inventada', () => {
  assert.deepEqual(
    marcas.inventa.map(([f]) => f),
    [],
    'decir «hola» no está en cartelera es afirmar algo que no sabemos',
  );
});

test('ninguna frase deja al chat mudo', () => {
  assert.deepEqual(marcas.muda.map(([f]) => f), []);
});

// Un techo, no un objetivo: si sube, algo se rompió y hay que mirarlo.
test('las respuestas inútiles no pasan del 10%', () => {
  const pct = (marcas.ciega.length / FRASES.length) * 100;
  assert.ok(pct <= 10, `${pct.toFixed(0)}% dice "no entendí": ${marcas.ciega.map(([f]) => f).join(', ')}`);
});
