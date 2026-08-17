// Pruebas del intérprete: `npm test`.
//
// Cada error reportado por una persona real entra acá **antes** de arreglarse.
// Así no vuelve: dos veces se rompió algo que ya funcionaba y sólo se descubrió
// de casualidad.
//
// Se prueba el parser y no el resolvedor, porque el parser no depende de la
// cartelera del día: los títulos y sedes vienen de la API, pero lo que se afirma
// acá es la interpretación, que no cambia con la programación semanal.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/parser.js';
import { movies, cinemas } from '../src/catalog.js';

const [ms, cs] = [await movies(), await cinemas()];
const leer = (frase) => parse(frase, { movies: ms, cinemas: cs });
const hm = (m) => (m == null ? null : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`);

test('reconoce lo básico', () => {
  const r = leer('quiero ver La Odisea mañana en Salaverry');
  assert.equal(r.movie?.title, 'La Odisea');
  assert.equal(r.cinema?.name, 'CP Salaverry');
  assert.equal(r.movieConfianza, 'alta');
});

// ── Errores reportados por usuarios ──────────────────────────────────────────

test('«pero» no es «Zona Cero»', () => {
  // Una letra de diferencia entre una palabra comunísima y un título.
  assert.equal(leer('Pero en cineplanet magdalena vi que sí').movie, null);
});

test('«la más nueva» no es «Caballo Salvaje Nueve»', () => {
  assert.equal(leer('la más nueva').movie, null);
});

test('«¿y dónde tiene?» no es «Donde duermen los sueños»', () => {
  assert.equal(leer('y donde tiene?').movie, null);
});

test('«the odyssey» no es «THE MAN I LOVE»', () => {
  assert.notEqual(leer('the odyssey today').movie?.title, 'FCL30: THE MAN I LOVE');
});

test('«jesús maría» es CP Salaverry, no Villa María del Triunfo', () => {
  assert.equal(leer('la odisea en jesus maria').cinema?.name, 'CP Salaverry');
});

test('«cineplanet magdalena» reconoce el distrito y no inventa un título', () => {
  const r = leer('Vi que en Cineplanet magdalena si estaba');
  assert.equal(r.movie, null);
  assert.equal(r.district, 'magdalena');
});

test('«de 5 a 7pm» se entiende como tarde, no como madrugada', () => {
  const r = leer('la odisea mañana de 5 a 7pm en trujillo');
  assert.equal(hm(r.from), '17:00');
  assert.equal(hm(r.to), '19:00');
});

test('un rango con am no queda invertido', () => {
  const r = leer('la odisea de 10 a 12 am en salaverry');
  assert.equal(hm(r.from), '10:00');
  assert.equal(hm(r.to), '12:00');
});

test('el 31 de febrero se dice, no se resuelve a hoy', () => {
  assert.match(leer('la odisea el 31 de febrero en salaverry').imposible ?? '', /no existe/);
});

test('«ayer» se dice, no se resuelve a hoy', () => {
  assert.match(leer('la odisea ayer en salaverry').imposible ?? '', /ya pasó/);
});

test('«iquitos» se reconoce como ciudad sin sede', () => {
  const r = leer('la odisea en iquitos');
  assert.equal(r.cinema, null);
  assert.equal(r.district, 'iquitos');
});

test('«real plaza» a secas no elige una sede al azar', () => {
  assert.equal(leer('la odisea en real plaza').cinema, null);
});

test('«esta noche» fija la franja de la noche', () => {
  const r = leer('la odisea esta noche en salaverry');
  assert.equal(hm(r.from), '19:00');
});

test('las palabras de género no se leen como título', () => {
  const r = leer('algo para niños en salaverry');
  assert.equal(r.movie, null);
  assert.deepEqual(r.sobrantes, []);
  assert.ok(r.genero?.generos.includes('Animación'));
});

// ── Tipeos: se aceptan, pero como sospecha ───────────────────────────────────

for (const [frase, esperado] of [
  ['la odicea en salaverry', 'La Odisea'],
  ['minons en trujillo', 'Minions y Monstruos'],
  ['shreck en comas', 'Shrek [2001]'],
  ['moanna en salaverry', 'Moana'],
]) {
  test(`«${frase}» encuentra ${esperado} con confianza media`, () => {
    const r = leer(frase);
    assert.equal(r.movie?.title, esperado);
    assert.equal(r.movieConfianza, 'media', 'un parecido nunca debería ser certeza');
  });
}

test('un tipeo en el título no secuestra la elección de sede', () => {
  // "moanna" se parece a "molina": el cine dicho debe ganar igual.
  assert.equal(leer('moanna en salaverry').cinema?.name, 'CP Salaverry');
});

// ── Cantidades y fechas ──────────────────────────────────────────────────────

test('las cantidades absurdas se ignoran en vez de romper la búsqueda', () => {
  assert.equal(leer('la odisea para 50 personas en salaverry').seats, null);
  assert.equal(leer('la odisea para 0 personas en salaverry').seats, null);
  assert.equal(leer('la odisea para 4 personas en salaverry').seats, 4);
});

test('«para mí y mi novia» son dos', () => {
  assert.equal(leer('la odisea para mi y mi novia en salaverry').seats, 2);
});

test('«este fin de semana» cae en sábado', () => {
  const r = leer('la odisea este fin de semana en salaverry');
  assert.equal(new Date(`${r.date}T12:00:00Z`).getUTCDay(), 6);
});

// ── Formato e idioma: estaban en los datos y se ignoraban ────────────────────

test('«doblada» y «subtitulada» se entienden', () => {
  assert.equal(leer('la odisea doblada en salaverry').idioma?.valor, 'DOBLADA');
  assert.equal(leer('la odisea subtitulada en salaverry').idioma?.valor, 'SUBTITULAD');
  assert.equal(leer('la odisea en español en salaverry').idioma?.valor, 'DOBLADA');
});

test('«prime» y «3d» se entienden como formato', () => {
  assert.equal(leer('la odisea prime en salaverry').formato?.valor, 'PRIME');
  assert.equal(leer('la odisea en 3d en salaverry').formato?.valor, '3D');
});

test('pedir formato o idioma no deja palabras sin explicar', () => {
  for (const f of [
    'la odisea doblada en salaverry',
    'la odisea prime mañana en salaverry',
    'la odisea subtitulada en 3d en salaverry',
  ]) {
    assert.deepEqual(leer(f).sobrantes, [], f);
  }
});

// ── Funciones agotadas y sin butacas juntas ──────────────────────────────────

test('una función agotada se distingue de un fallo de red', async () => {
  const { SalaAgotada } = await import('../src/seatmap.js');
  const agotada = new SalaAgotada();
  assert.equal(agotada.agotada, true);
  assert.ok(agotada instanceof Error);
});
