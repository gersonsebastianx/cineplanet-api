// El hilo de la conversación: lo que ya se sabe no se tira al primer tropiezo,
// y lo que se pregunta de verdad se contesta.
//
// Los dos casos salen de la bitácora del 19 de agosto. Alguien escribió "la
// odisea", después "chile", y de ahí en adelante la web había olvidado la
// película: cinco turnos, ninguna función. Ver NOTES.md, "el circuito".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from '../src/resolve.js';
import { movies, cinemas } from '../src/catalog.js';

const enCartelera = (await movies()).find((m) => !m.comingSoon);

test('una palabra que no se entiende no borra la película', async () => {
  const primero = await resolve(enCartelera.title);
  assert.equal(primero.contexto.movieId, enCartelera.id, 'no llegó a reconocerla');

  // Una palabra cualquiera, que no se parece a ningún título: no hay razón
  // para creer que cambiaron de película.
  const segundo = await resolve('asdfgh', { contexto: primero.contexto });
  assert.equal(
    segundo.contexto.movieId,
    enCartelera.id,
    `se olvidó de ${enCartelera.title}: «${segundo.pregunta}»`,
  );
});

// Cineplanet no está sólo en el Perú y la gente lo sabe. Contestar "no entendí
// «chile»" y pedir un distrito es hacerse el tonto con una pregunta legítima.
test('preguntar por otro país recibe una respuesta honesta', async () => {
  for (const frase of ['chile', 'se puede en chile', 'espera, para qué pais de cineplanet funciona?']) {
    const r = await resolve(frase);
    const dicho = r.pregunta ?? r.mensaje ?? '';
    assert.ok(!/no entend/i.test(dicho), `«${frase}» → ${dicho}`);
    assert.match(dicho, /Perú/, `«${frase}» no dice de qué país es la cartelera: ${dicho}`);
  }
});

// Y preguntar por el país en medio de una búsqueda no la tira por la borda.
test('la pregunta por el país no pierde lo que ya se sabía', async () => {
  const primero = await resolve(enCartelera.title);
  const segundo = await resolve('se puede en chile', { contexto: primero.contexto });
  assert.equal(segundo.contexto.movieId, enCartelera.id);
});

// Un lugar del Perú manda sobre el parecido con uno de afuera: "Santiago de
// Surco" es Lima, no Chile.
test('un distrito peruano no se confunde con el extranjero', async () => {
  const r = await resolve('que dan hoy en santiago de surco');
  assert.notEqual(r.estado, 'falta', `«santiago de surco» → ${r.pregunta}`);
});

// Lo contrario también tiene que seguir siendo cierto: si lo que no se entendió
// **sí** se parece a un título, están nombrando otra película y heredar la
// anterior sería contestar por una que nadie pidió.
test('un parecido a otro título sí suelta la película anterior', async () => {
  const primero = await resolve(enCartelera.title);
  const otra = (await movies()).find((m) => m.id !== enCartelera.id && m.title.length > 8);
  // Escrito con un tipeo, para que no lo reconozca del todo y quede como
  // parecido: es el caso que la regla vigila.
  const conTipeo = otra.title.slice(0, 6).replace(/.$/, 'x');
  const segundo = await resolve(conTipeo, { contexto: primero.contexto });
  // El caso sólo aplica si lo escrito **se leyó como un título**: o se pregunta
  // cuál era, o se dice que no está en cartelera. Si no se pareció a nada, la
  // regla correcta es la contraria —conservar la película— y no hay nada que
  // afirmar acá.
  const loLeyoComoTitulo =
    segundo.estado === 'confirmar' ||
    /no está en cartelera/i.test(segundo.pregunta ?? segundo.mensaje ?? '');
  if (!loLeyoComoTitulo) return;
  assert.notEqual(segundo.contexto.movieId, enCartelera.id);
});

// Preguntar dónde está la persona es la pregunta más repetida de la bitácora
// —14 de 36 turnos atascados en una semana— y era la única sin botones: había
// que escribir. Todas las demás ofrecen por dónde seguir.
test('preguntar dónde siempre ofrece ciudades a un toque', async () => {
  for (const frase of [enCartelera.title, 'que peliculas hay?', 'quiero ir al cine']) {
    const r = await resolve(frase);
    if (r.estado === 'ok' || r.estado === 'cartelera') continue; // ya llegó más lejos
    assert.ok(r.opciones?.length, `«${frase}» pregunta sin ofrecer nada: ${r.pregunta}`);
  }
});

// Y esos botones tienen que llevar a algún lado: pulsando ciudad y sede se
// llega a la función, sin escribir una palabra más.
test('de la película a la función en dos toques', async (t) => {
  const primero = await resolve(enCartelera.title);
  if (!primero.opciones?.length) return t.skip('esa película ya resolvió sede sola');
  const ciudad = await resolve(primero.opciones[0].nombre, { contexto: primero.contexto });
  assert.ok(ciudad.opciones?.length, `la ciudad no ofreció sedes: ${ciudad.pregunta}`);
  const sede = ciudad.opciones[0];
  const final = await resolve(sede.nombre, {
    contexto: ciudad.contexto,
    elegido: sede.id ? { cineId: sede.id } : null,
  });
  assert.ok(['ok', 'cartelera'].includes(final.estado), `quedó en ${final.estado}: ${final.pregunta}`);
});

// El país dentro de un título no es un destino. Alguien escribió "lindo méxico
// mágico" —una película que no tenemos— y se le contestó que no tenemos
// cartelera de México. Un nombre de lugar sólo cuenta como lugar si va detrás
// de "en" o si es todo lo que dice el mensaje.
test('un país dentro de un título no se lee como destino', async () => {
  const r = await resolve('lindo méxico mágico');
  assert.ok(!/Cineplanet Perú/.test(r.pregunta ?? ''), `lo leyó como país: ${r.pregunta}`);
});

// Y tampoco se afirma qué película era: compartir una sola palabra con un
// título, dejando dos sin explicar, da para preguntar, no para decidir.
test('con cabos sueltos se pregunta, no se afirma', async () => {
  const r = await resolve('lindo méxico mágico');
  assert.ok(
    r.estado === 'confirmar' || /no está en cartelera|no entend/i.test(r.pregunta ?? r.mensaje ?? ''),
    `afirmó sin preguntar: [${r.estado}] ${r.pregunta ?? r.mensaje}`,
  );
});

// Del 22 de agosto: alguien buscaba La Odisea, respondió "ate" —su distrito— y
// la web preguntó «¿te refieres a CP Puruchuco?», ofreciendo una sola sede. En
// Ate hay dos. Acertó de casualidad; si quería la otra, tenía que decir que no
// y volver a empezar. Cuando dos sedes empatan hay que mostrarlas, no elegir
// una y preguntar por ella.
test('un lugar que empata entre dos sedes las ofrece, no adivina una', async (t) => {
  const cs = await cinemas();
  const cuenta = new Map();
  for (const c of cs) if (c.district) cuenta.set(c.district, (cuenta.get(c.district) ?? 0) + 1);
  const compartido = [...cuenta.entries()].find(([, n]) => n > 1)?.[0];
  if (!compartido) return t.skip('hoy ningún distrito tiene dos sedes');

  const r = await resolve(compartido);
  const enJuego = cs.filter((c) => c.district === compartido).map((c) => c.name);
  assert.ok(
    r.opciones?.length > 1,
    `«${compartido}» tiene ${enJuego.length} sedes (${enJuego.join(', ')}) y ofreció ${
      r.opciones?.length ?? 0
    }: ${r.pregunta}`,
  );
});

// Del 28 de agosto: alguien ya tenía su función —película, sede, hora y dos
// entradas— y escribió «quiero yo elegir las butacas». Le contestamos «no
// entendí «elegir»» y le mostramos la cartelera entera, tirando por la borda lo
// que ya había elegido. No es una pregunta fuera de alcance: es sobre cómo
// funciona esto, y tiene una respuesta corta y cierta.
test('preguntar por elegir las butacas se contesta, no se lista la cartelera', async () => {
  for (const frase of [
    'quiero yo elegir las butacas',
    'puedo escoger mis asientos?',
    'no quiero esas butacas',
    'quiero cambiar los asientos',
  ]) {
    const r = await resolve(frase);
    const d = r.pregunta ?? r.mensaje ?? '';
    assert.ok(!/no entend/i.test(d), `«${frase}» → ${d}`);
    assert.match(d, /elig|escog/i, `«${frase}» no explica quién elige: ${d}`);
  }
});

// Y no puede costarle la conversación: lo que ya había elegido sigue ahí.
test('esa pregunta no borra la función que ya se tenía', async () => {
  const uno = await resolve(enCartelera.title);
  const dos = await resolve('quiero yo elegir las butacas', { contexto: uno.contexto });
  assert.equal(dos.contexto.movieId, uno.contexto.movieId);
});

// Del 13 de septiembre: alguien con su tarjeta escribió «No, quiero otra
// película» y recibió **la misma tarjeta**. Después «No quiero otra película»,
// y otra vez la misma. «Otro cine» se entendía desde agosto; «otra película»,
// no.
test('«otra película» ofrece otras, no repite la misma', async (t) => {
  const lista = await resolve(`que dan mañana en ${(await cinemas())[0].name}`);
  if (lista.estado !== 'cartelera' || lista.opciones.length < 2) return t.skip('sin cartelera suficiente');
  const op = lista.opciones[0];
  const tarjeta = await resolve(op.nombre, { contexto: lista.contexto, elegido: { peliculaId: op.peliculaId } });

  const r = await resolve('No, quiero otra película', { contexto: tarjeta.contexto });
  assert.ok(r.opciones?.length, `no ofreció nada: ${r.pregunta ?? r.mensaje}`);
  assert.ok(
    r.opciones.every((o) => o.peliculaId !== op.peliculaId),
    `volvió a ofrecer ${op.nombre}, que es justo la que no quiere`,
  );
  assert.equal(r.contexto.movieId, null, 'siguió recordando la película de la que se quería salir');
});

// Pero la negación da vuelta el sentido: «no quiero otra película» es seguir
// con la misma.
test('«no quiero otra película» conserva la que tenía', async () => {
  const uno = await resolve(enCartelera.title);
  const dos = await resolve('No quiero otra película', { contexto: uno.contexto });
  assert.equal(dos.contexto.movieId, uno.contexto.movieId);
});

// «No me queda claro qué asientos hay» recibía «No entendí» y la cartelera
// entera, dos veces seguidas. Es una pregunta sobre el mapa y tiene respuesta.
test('preguntar qué asientos hay explica el mapa, sin perder la función', async () => {
  const uno = await resolve(enCartelera.title);
  for (const frase of ['No me queda claro que asiento hay', 'que asientos quedan libres?']) {
    const r = await resolve(frase, { contexto: uno.contexto });
    const d = r.pregunta ?? r.mensaje ?? '';
    assert.ok(!/no entend/i.test(d), `«${frase}» → ${d}`);
    assert.match(d, /libre/i, `«${frase}» no explica qué está libre: ${d}`);
    assert.equal(r.contexto.movieId, uno.contexto.movieId);
  }
});

// Del 10 de septiembre: alguien con CP Salaverry en la conversación escribió
// «quiero ver spiderman en cp costanera». No existe CP Costanera, y la web no lo
// dijo: se quedó con Salaverry y listó su cartelera, como si no hubiera nombrado
// otro lugar.
test('nombrar un cine que no existe no hereda el anterior', async () => {
  const cs = await cinemas();
  const primero = await resolve(`que dan mañana en ${cs[0].name}`);
  const segundo = await resolve('quiero ver algo en cp inventadolandia', { contexto: primero.contexto });
  const d = segundo.pregunta ?? segundo.mensaje ?? '';
  assert.ok(!d.includes(cs[0].name) || /no ubico/i.test(d), `siguió en ${cs[0].name}: ${d}`);
  assert.match(d, /no ubico/i, `no dijo que no conoce el lugar: ${d}`);
});

// Y en esa misma frase, «spiderman» —el título escrito todo junto— dejaba de
// reconocerse con que hubiera una palabra más en el mensaje.
test('un título escrito todo junto se reconoce aunque haya más palabras', async (t) => {
  const { parse } = await import('../src/parser.js');
  const ms = await movies();
  const cs = await cinemas();
  const compuesto = ms.find((m) => {
    const w = m.title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/\s+/);
    return w.length >= 3 && w[0].length >= 3 && w[1].length >= 3 && /^[a-z]+$/.test(w[0] + w[1]) && (w[0] + w[1]).length >= 7;
  });
  if (!compuesto) return t.skip('hoy no hay un título que se pueda escribir pegado');
  const w = compuesto.title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/\s+/);
  const pegado = w[0] + w[1];
  const r = parse(`quiero ver ${pegado} en cp inventadolandia`, { movies: ms, cinemas: cs });
  assert.equal(r.movie?.id, compuesto.id, `«${pegado}» no encontró «${compuesto.title}»`);
  assert.equal(r.movieConfianza, 'alta', 'la palabra pegada no puede contar como cabo suelto');
});
