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

// Cuando una prueba nombra un título, se salta si esa película ya no está: la
// cartelera cambia sola y un build rojo por eso enseña a ignorar el rojo.
const enCartelera = (titulo) => ms.some((m) => m.title === titulo);

test('reconoce lo básico', { skip: !enCartelera('La Odisea') && 'La Odisea ya no está en cartelera' }, () => {
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

// Los tipeos se fabrican sobre la cartelera de hoy, no sobre títulos escritos a
// mano: esta prueba fallaba los lunes porque Moana salió de cartelera, y una
// prueba que caduca sola enseña a ignorar las alertas.

/** Cambia una letra por otra: el error de dedo más común. */
const conTipeo = (palabra) => {
  const i = Math.floor(palabra.length / 2);
  const otra = palabra[i] === 'a' ? 'e' : 'a';
  return palabra.slice(0, i) + otra + palabra.slice(i + 1);
};

/** Intercambia dos letras contiguas: el otro error de dedo más común. */
const conIntercambio = (palabra) => {
  const i = Math.floor(palabra.length / 2);
  return palabra.slice(0, i) + palabra[i + 1] + palabra[i] + palabra.slice(i + 2);
};

// Se toman títulos de una sola palabra larga y distintiva: los que la gente
// escribe de memoria y donde el tipeo importa.
const titulosLargos = ms
  .map((m) => m.title.split(/\s+/).find((w) => w.length >= 6 && /^[A-Za-záéíóúñ]+$/.test(w)))
  .filter(Boolean)
  .slice(0, 6);

for (const palabra of titulosLargos) {
  for (const [como, romper] of [['una letra cambiada', conTipeo], ['dos letras intercambiadas', conIntercambio]]) {
    const malEscrito = romper(palabra.toLowerCase());
    if (malEscrito === palabra.toLowerCase()) continue;
    test(`«${malEscrito}» (${como}) encuentra algo`, () => {
      const r = leer(`${malEscrito} en salaverry`);
      assert.ok(
        r.movie || r.movieSugerencias?.length,
        `escribir ${malEscrito} por ${palabra} no puede dejar a alguien sin nada`,
      );
      if (r.movie) {
        assert.equal(r.movieConfianza, 'media', 'un parecido nunca debería ser certeza');
      }
    });
  }
}

test('un tipeo en el título no secuestra la elección de sede', () => {
  // Un título mal escrito se parece a veces al nombre de una sede: la dicha gana.
  for (const palabra of titulosLargos.slice(0, 3)) {
    const r = leer(`${conTipeo(palabra.toLowerCase())} en salaverry`);
    assert.equal(r.cinema?.name, 'CP Salaverry', palabra);
  }
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

// ── Parecidos débiles: se ofrecen como pregunta, no se descartan ─────────────

test('«toi stori» sugiere Toy Story en vez de decir que no existe', { skip: !ms.some((m) => /Toy Story/.test(m.title)) && 'Toy Story ya no está en cartelera' }, () => {
  const r = leer('toi stori mañana hay?');
  assert.equal(r.movie, null, 'no alcanza para elegirla solo');
  assert.deepEqual(
    r.movieSugerencias.map((m) => m.title),
    ['Toy Story 5'],
  );
});

test('una pista hecha sólo de palabras comunes no se sugiere', () => {
  // "pero" coincide exacto con "Separada pero nunca sola" y no significa nada.
  assert.deepEqual(leer('Pero en cineplanet magdalena vi que sí').movieSugerencias, []);
});

// ── El título no puede robarle palabras a la sede ────────────────────────────

test('«la piedra filosofal» no manda a CP Piura', () => {
  // Reportado: al elegir Harry Potter desde la cartelera de San Miguel, salía
  // una función de Piura porque "piedra" está a dos letras de "piura".
  const r = leer('Harry Potter y la piedra filosofal [2001]');
  assert.match(r.movie?.title ?? '', /Harry Potter/);
  assert.equal(r.cinema, null, 'el título no nombra ninguna sede');
});

test('la sede dicha sigue ganando cuando sí se nombra', () => {
  assert.equal(leer('harry potter en san miguel').cinema?.name, 'CP San Miguel');
});

// ── Pedir una recomendación no es nombrar una película ──────────────────────

for (const frase of ['Otra película qué recomiendes?', 'qué me recomiendas?', 'otra opción?']) {
  test(`«${frase}» se entiende como pedido de recomendación`, () => {
    const r = leer(frase);
    assert.equal(r.pideRecomendacion, true);
    assert.equal(r.movie, null);
  });
}

// ── Cuántos van casi nunca viene como número ────────────────────────────────

test('«iré solo» es una entrada, no dos', () => {
  // Reportado: decía "ire solo" y seguía sugiriendo dos butacas.
  for (const f of ['ire solo', 'voy solo', 'iré sola', 'yo solo']) {
    assert.equal(leer(f).seats, 1, f);
  }
});

test('«somos 3» y «vamos 4» fijan el grupo', () => {
  assert.equal(leer('somos 3').seats, 3);
  assert.equal(leer('vamos 4').seats, 4);
});

test('«solo quiero ver…» no significa que vaya solo', () => {
  assert.equal(leer('solo quiero ver la odisea').seats, null);
});

test('decir cuántos van no deja palabras sin explicar', () => {
  for (const f of ['ire solo', 'somos 4', 'iré sola']) {
    assert.deepEqual(leer(f).sobrantes, [], f);
  }
});

test('«iré con mi amigo» son dos, aunque venga con tipeo', () => {
  // Reportado: "ire ocn mi amigo" ofreció elegir entre Mi Vecino Totoro y
  // Juan Gabriel — "mi" coincidía con los títulos y nadie contó al amigo.
  for (const f of ['ire ocn mi amigo', 'iré con mi amigo', 'voy con mi hermana', 'con mi mamá']) {
    assert.equal(leer(f).seats, 2, f);
  }
});

test('«mi» sola no elige película', () => {
  const r = leer('ire ocn mi amigo');
  assert.equal(r.movie, null);
  assert.deepEqual(r.movieSugerencias, [], 'un posesivo no es una pista de título');
});

test('«con mis amigos» no inventa cuántos son', () => {
  assert.equal(leer('voy con mis amigos').seats, null, 'en plural hay que preguntar');
});

test('el título sigue ganando cuando de verdad empieza con «mi»', () => {
  assert.equal(leer('mi vecino totoro en salaverry').movie?.title, 'Mi Vecino Totoro');
});

// ── Toda sede ofrecida tiene que poder elegirse ──────────────────────────────

test('las 43 sedes se reconocen por su propio nombre', () => {
  // Reportado: la web ofreció "CP Norte" y al pulsarlo contestó que «norte» no
  // está en cartelera. Tres sedes —CP Norte, CP Mall del Sur y CP Centro Jr. De
  // La Unión— tienen nombres hechos sólo de palabras genéricas, y el guardia que
  // impide que "real plaza" elija sede al azar las borraba enteras. Una de ellas
  // resolvía además a la equivocada (CP Canto Grande).
  const fallan = cs.filter((c) => leer(c.name).cinema?.id !== c.id).map((c) => c.name);
  assert.deepEqual(fallan, [], 'ninguna sede puede ser inalcanzable por su nombre');
});

test('«real plaza» a secas sigue sin elegir una sede al azar', () => {
  // El arreglo de arriba no puede reabrir esto: sólo vale el nombre completo.
  assert.equal(leer('la odisea en real plaza').cinema, null);
});

// ── Títulos originales: acá se dice "insidious", no "La Noche del Demonio" ───

test('«insidious» encuentra La Noche del Demonio', () => {
  // Reportado: estaba en cartelera y se contestó que no. La API de Cineplanet
  // no trae el título original en ningún campo, así que el puente es una tabla.
  const r = leer('Quiero ver insidious');
  assert.match(r.movie?.title ?? '', /Noche Del Demonio/i);
  assert.equal(r.movieConfianza, 'alta', 'nombrar el título original no es tantear');
  assert.deepEqual(r.sobrantes, [], 'lo escrito en inglés queda explicado');
});

test('el título original convive con el resto de la frase', () => {
  const r = leer('insidious en cp norte mañana');
  assert.match(r.movie?.title ?? '', /Noche Del Demonio/i);
  assert.equal(r.cinema?.name, 'CP Norte');
});

test('«the odyssey» ahora sí llega a La Odisea', { skip: !enCartelera('La Odisea') && 'La Odisea ya no está en cartelera' }, () => {
  assert.equal(leer('the odyssey').movie?.title, 'La Odisea');
});

test('una equivalencia sólo vale si esa película está en cartelera', () => {
  // "the conjuring" no debe inventar nada cuando El Conjuro no se proyecta.
  const r = leer('quiero ver the conjuring');
  const enCartelera = ms.some((m) => /conjuro/i.test(m.title));
  if (!enCartelera) assert.equal(r.movie, null);
});

test('un título original mal escrito igual llega', () => {
  // Lo trajo la bitácora en su primer minuto de vida: alguien escribió
  // "insidous", sin la segunda i, y la tabla exigía la palabra exacta.
  for (const f of ['quiero ver insidous', 'insidius en cp norte', 'the odisey']) {
    assert.notEqual(leer(f).movie, null, f);
  }
  assert.deepEqual(leer('quiero ver insidous').sobrantes, []);
});

// ── Responder la ciudad no puede ser un callejón sin salida ─────────────────

test('«lima» es una ciudad, nunca un título', () => {
  // La web pregunta "¿en qué distrito o provincia estás?" y la respuesta más
  // probable —27 de los 43 cines— contestaba «lima» no está en cartelera.
  const r = leer('lima');
  assert.equal(r.movie, null);
  assert.equal(r.district, 'Lima');
  assert.ok(r.lugarConSede > 1, 'Lima tiene sedes, y decir lo contrario es mentir');
  assert.deepEqual(r.sobrantes, []);
});

test('las ciudades salen de los datos, no de una lista escrita', () => {
  // Si Cineplanet abre en una ciudad nueva tiene que entenderse sin tocar nada.
  const ciudades = [...new Set(cs.map((c) => c.city).filter(Boolean))];
  const mudas = ciudades.filter((ciudad) => {
    const r = leer(`estoy en ${ciudad}`);
    return !r.cinema && !r.district;
  });
  assert.deepEqual(mudas, [], 'toda ciudad con sede debe reconocerse');
});

test('una ciudad sin sede sigue diciéndolo', () => {
  const r = leer('iquitos');
  assert.equal(r.lugarConSede, 0, 'no se puede prometer un cine que no existe');
});

// ── Un lugar dicho entero le gana a una sede que sólo se parece ─────────────

test('«puente piedra» no manda a CP Piura', () => {
  // Reportado desde la web: alguien de Lima norte terminaba a mil kilómetros
  // porque `piedra` está a dos letras de `piura`.
  for (const f of ['puente piedra', 'vivo en puente piedra']) {
    const r = leer(f);
    assert.equal(r.cinema, null, f);
    assert.equal(r.district, 'puente piedra', f);
  }
});

test('una sede sólo parecida se pregunta, no se decide', () => {
  // Mandar a alguien al cine equivocado cuesta más que una pregunta de más.
  const r = leer('quiero ver algo en salaverri');
  assert.equal(r.cinema?.name, 'CP Salaverry');
  assert.equal(r.cinemaConfianza, 'media');
});

test('la sede escrita bien sigue sin preguntar nada', () => {
  for (const f of ['la odisea en salaverry', 'la odisea en trujillo', 'harry potter en san miguel']) {
    assert.equal(leer(f).cinemaConfianza, 'alta', f);
  }
});

// ── Franjas abiertas: "de 6pm en adelante" ─────────────────────────────────

test('«de 6pm en adelante» se entiende y no deja palabras sueltas', () => {
  // Reportado por una amiga desde la web: "una como para las 6pm en adelante
  // o 5 pm" contestaba que «adelante» no está en cartelera.
  const r = leer('una como para las 6pm en adelante o 5 pm');
  assert.equal(hm(r.from), '18:00');
  assert.equal(hm(r.to), '24:00');
  assert.deepEqual(r.sobrantes, []);
  assert.equal(r.movie, null);
});

test('las palabras que acompañan una hora nunca son un título', () => {
  for (const f of [
    'de 5 para adelante',
    'a partir de las 7',
    'desde las 5',
    'antes de las 4',
    'la odisea entre 4 y 6 en salaverry',
  ]) {
    assert.deepEqual(leer(f).sobrantes, [], f);
  }
});

// ── Traído por el tráfico real del lanzamiento ──────────────────────────────

test('«san juan de miraflores» no manda a San Juan de Lurigancho', () => {
  // Reportado por la bitácora: alguien buscó Moana desde SJM y lo mandamos al
  // otro extremo de Lima. Cubría "san" y "juan" del nombre e ignoraba que la
  // persona había dicho "miraflores", que es la palabra que los distingue.
  assert.equal(leer('san juan de miraflores').cinema?.name, 'CP Mall del Sur');
  assert.equal(leer('moana en san juan de miraflores').cinema?.name, 'CP Mall del Sur');
  assert.equal(leer('san juan de lurigancho').cinema?.name, 'CP San Juan de Lurigancho');
});

test('las abreviaturas de distrito se entienden', () => {
  // "vivo en SJM" respondía "no ubico SJM".
  assert.equal(leer('vivo en SJM').cinema?.name, 'CP Mall del Sur');
  assert.equal(leer('estoy en sjl').cinema?.name, 'CP San Juan de Lurigancho');
  assert.equal(leer('en vmt').cinema?.name, 'CP Villa María del Triunfo');
});

test('una abreviatura no puede comerse una palabra común', () => {
  // "si" por San Isidro rompía «Vi que en Cineplanet magdalena sí estaba».
  assert.equal(leer('Vi que en Cineplanet magdalena si estaba').district, 'magdalena');
});

test('el género pedido sobrevive a la pregunta por el cine', async () => {
  // Traído por la bitácora: «quiero ver una película de terror» → «¿en qué
  // cine?» → «trujillo» devolvía la cartelera entera. Se preguntaba el dónde y
  // se olvidaba el qué.
  const { resolve } = await import('../src/resolve.js');
  const a = await resolve('quiero ver una pelicula de terror');
  const b = await resolve('en cineplanet trujillo', { contexto: a.contexto });
  const dicho = b.pregunta ?? b.mensaje ?? '';
  assert.match(dicho, /terror/i, 'la respuesta tiene que seguir hablando de terror');
});

test('cuando no hay del género pedido, igual se ofrece algo', async () => {
  // Nunca un callejón sin salida: o lo hay otro día, o se muestra lo que sí hay.
  const { resolve } = await import('../src/resolve.js');
  const a = await resolve('algo para niños');
  const b = await resolve('en salaverry', { contexto: a.contexto });
  assert.ok((b.opciones ?? []).length > 0 || b.pedido, 'siempre hay por dónde seguir');
});

test('un intercambio de letras es un solo error, no dos', () => {
  // Reportado: "Sherk una entrada" y "sHERK" no encontraban nada. Al teclear,
  // "sherk" por "shrek" es un dedo que se adelantó — el error más común — y la
  // cuenta simple lo cobraba doble, pasándose del margen.
  for (const f of ['Sherk una entrada', 'sHERK', 'la odisae', 'toy stroy']) {
    assert.notEqual(leer(f).movie, null, f);
  }
  assert.match(leer('sherk').movie?.title ?? '', /Shrek/);
});

test('el intercambio no abre la puerta a cualquier parecido', () => {
  // La red de siempre sigue puesta: palabras comunes no eligen título.
  assert.equal(leer('Pero en cineplanet magdalena vi que sí').movie, null);
  assert.equal(leer('la más nueva').movie, null);
});

test('«otro cine» pide cambiar de sede, no repite la misma', async () => {
  // Reportado: se escribía "otro cine" y volvía la misma respuesta, como si no
  // hubiera escuchado. La frase no era ni un lugar ni un título.
  const { resolve } = await import('../src/resolve.js');
  const a = await resolve('shrek hoy en cp ventanilla');
  for (const f of ['otro cine', 'en otra sede', 'cambiar de cine']) {
    const b = await resolve(f, { contexto: a.contexto });
    assert.equal(b.estado, 'elige-cine', f);
    assert.ok(b.opciones.length > 0, f);
    assert.ok(
      b.opciones.every((o) => o.nombre !== 'CP Ventanilla'),
      'no puede ofrecer la sede que se quiere dejar',
    );
  }
});

test('ceder la franja horaria se dice, no se calla', async () => {
  // Reportado por la bitácora: alguien pidió Moana "más de noche" y recibió la
  // misma función de las 15:40. Era cierto —es la única que hay— pero callarlo
  // hace que la respuesta parezca sorda.
  const { resolve } = await import('../src/resolve.js');
  const a = await resolve('moana mañana en cp san miguel');
  if (a.estado !== 'ok') return;
  const b = await resolve('mas de noche', { contexto: a.contexto });
  if (b.funcion && b.funcion.hora < '19:00') {
    assert.ok(
      (b.noUsado ?? []).some((n) => /no hay funciones/.test(n)),
      'si la función queda fuera de la franja pedida, hay que decirlo',
    );
  }
});

test('preguntar dónde siempre ofrece por dónde seguir', async () => {
  // Reportado: se preguntaba "¿en qué cine buscas algo de terror?", la persona
  // respondía "cineplanet" y recibía la misma pregunta palabra por palabra.
  const { resolve } = await import('../src/resolve.js');
  const a = await resolve('quiero ver una peli de terror, de preferencia de noche');
  assert.ok((a.opciones ?? []).length > 0, 'la pregunta necesita opciones');
  const b = await resolve('cineplanet', { contexto: a.contexto });
  assert.ok((b.opciones ?? []).length > 0, 'y la segunda vez también');
});
