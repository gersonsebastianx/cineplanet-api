// El camino que termina en el botón de compra.
//
// Hasta ahora este tramo se verificaba a mano: se abría la web, se miraba el
// mapa y se comparaba con Cineplanet. Es justo el que más caro sale si se
// rompe —alguien va al cine equivocado, o a butacas que no existen— y el que
// menos cubría el corpus, porque depende de que hoy haya una función con
// asientos libres.
//
// Por eso se prueba con planos fabricados: la parte que decide qué es butaca,
// qué fila va delante y cuáles conviene sugerir no necesita red.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leerPlan, bestBlocks, SalaAgotada } from '../src/seatmap.js';
import { buyLink } from '../src/api.js';

// ── Un plano como los que manda Cineplanet ──────────────────────────────────

const LIBRE = 0;
const OCUPADA = 1;
const RUEDAS = 3;
const HUECO = 5;

/**
 * Arma una respuesta con la forma real de la API. `filas` va **de atrás hacia
 * adelante**, como la manda Cineplanet: la primera del arreglo es la del fondo.
 * Cada fila es una cadena donde cada carácter es una butaca:
 *   . libre   x ocupada   r silla de ruedas   _ pasillo (no es butaca)
 */
function plano(filas, { area = 'SALA 1' } = {}) {
  const estado = { '.': LIBRE, x: OCUPADA, r: RUEDAS, _: HUECO };
  return {
    ResponseCode: '0',
    SeatLayoutData: {
      Areas: [
        {
          Description: area,
          Rows: filas.map(([nombre, dibujo]) => ({
            PhysicalName: nombre,
            Seats: [...dibujo].map((c, i) => ({
              Id: dibujo.length - i,
              Status: estado[c],
              Position: { ColumnIndex: i },
            })),
          })),
        },
      ],
    },
  };
}

// ── Sala agotada y fallos: no pueden confundirse ────────────────────────────

test('una sala agotada se distingue de cualquier otro fallo', () => {
  // Si esto se pierde, la web ofrece comprar butacas que ya no existen.
  assert.throws(() => leerPlan({ ResponseCode: '67' }), SalaAgotada);
  assert.throws(
    () => leerPlan({ ResponseCode: '1', ErrorDescription: 'Seat sold out' }),
    SalaAgotada,
  );
});

test('otro error no se disfraza de sala agotada', () => {
  // Tratar una caída como "agotada" haría saltar a la siguiente función y
  // esconder que Cineplanet está fallando.
  try {
    leerPlan({ ResponseCode: '9', ErrorDescription: 'Something else' });
    assert.fail('debería lanzar');
  } catch (err) {
    assert.ok(!(err instanceof SalaAgotada), 'no es una sala agotada');
    assert.match(err.message, /Something else/);
  }
});

test('un plano sin butacas legibles falla en vez de devolver una sala vacía', () => {
  assert.throws(() => leerPlan({ ResponseCode: '0' }));
  assert.throws(() => leerPlan(plano([['A', '____']])));
});

// ── Los dos ejes van al revés, y eso ya rompió el mapa una vez ──────────────

test('la numeración crece hacia la izquierda, como en la sala', () => {
  // Verificado butaca por butaca contra la web de Cineplanet cuando se
  // descubrió: la API entrega las columnas espejadas.
  const mapa = leerPlan(plano([['A', '....']]));
  const fila = mapa.rows[0];
  const porPosicion = [...fila.seats].sort((a, b) => a.x - b.x).map((s) => s.number);
  assert.deepEqual(porPosicion, [1, 2, 3, 4], 'de izquierda a derecha: 1, 2, 3, 4');
});

test('la primera fila del mapa es la de adelante, no la del fondo', () => {
  // La API las manda de atrás hacia adelante; en pantalla van al revés.
  const mapa = leerPlan(plano([
    ['C', '..'],
    ['B', '..'],
    ['A', '..'],
  ]));
  assert.deepEqual(mapa.rows.map((r) => r.label), ['A', 'B', 'C']);
});

test('los pasillos no son butacas y las de ruedas se marcan', () => {
  const mapa = leerPlan(plano([['A', '.__r x']]));
  const fila = mapa.rows[0];
  assert.equal(fila.seats.length, 3, 'dos pasillos y un espacio no cuentan');
  assert.equal(fila.seats.filter((s) => s.accessible).length, 1);
  assert.equal(mapa.total, 3);
  assert.equal(mapa.free, 1, 'sólo la libre; la de ruedas y la ocupada no');
});

// ── Qué butacas se sugieren ─────────────────────────────────────────────────

/** Sala de doce filas iguales, todas libres. */
const salaVacia = (anchura = 12, filas = 12) =>
  leerPlan(
    plano(
      Array.from({ length: filas }, (_, i) => [
        String.fromCharCode(65 + (filas - 1 - i)),
        '.'.repeat(anchura),
      ]),
    ),
  );

test('las butacas sugeridas son contiguas y de la misma fila', () => {
  for (const cuantas of [1, 2, 3, 4]) {
    const [mejor] = bestBlocks(salaVacia(), cuantas);
    assert.equal(mejor.seats.length, cuantas);
    assert.equal(new Set(mejor.seats.map((s) => s[0])).size, 1, 'una sola fila');
    const nums = [...mejor.numbers].sort((a, b) => a - b);
    assert.ok(
      nums.every((n, i) => i === 0 || n === nums[i - 1] + 1),
      `butacas separadas para ${cuantas}: ${mejor.seats.join(' ')}`,
    );
  }
});

test('no sugiere la primera fila ni los extremos', () => {
  // Reportado en su momento: sugería pegado a la pantalla y en el borde.
  const [mejor] = bestBlocks(salaVacia(), 2);
  assert.ok(!['A', 'B'].includes(mejor.row), `sugirió la fila ${mejor.row}`);
  const centro = 12 / 2;
  assert.ok(
    mejor.numbers.every((n) => Math.abs(n - centro) <= 3),
    `sugirió butacas del borde: ${mejor.seats.join(' ')}`,
  );
});

test('las alternativas no comparten butacas con la principal', () => {
  // Ofrecer "otra opción" que se solapa con la primera no es una alternativa.
  const bloques = bestBlocks(salaVacia(), 2, 4);
  const vistas = new Set();
  for (const b of bloques) {
    for (const s of b.seats) {
      assert.ok(!vistas.has(s), `la butaca ${s} se ofrece dos veces`);
      vistas.add(s);
    }
  }
});

test('nunca sugiere una butaca de silla de ruedas', () => {
  const mapa = leerPlan(plano([
    ['C', 'rr..rr'],
    ['B', 'rr..rr'],
    ['A', 'rr..rr'],
  ]));
  for (const b of bestBlocks(mapa, 2, 5)) {
    const dela = mapa.rows.flatMap((r) => r.seats).filter((s) => b.seats.includes(s.id));
    assert.ok(dela.every((s) => !s.accessible), `sugirió ${b.seats.join(' ')}`);
  }
});

test('si no hay tantas juntas, no las inventa', () => {
  // Sala donde sólo quedan sueltas: la respuesta correcta es ninguna, y la
  // interfaz lo dice ("sólo quedan butacas sueltas").
  const mapa = leerPlan(plano([
    ['B', '.x.x.x'],
    ['A', '.x.x.x'],
  ]));
  assert.deepEqual(bestBlocks(mapa, 2), []);
  assert.ok(bestBlocks(mapa, 1).length > 0, 'de a una sí hay');
});

test('sólo sugiere butacas que estén libres', () => {
  const mapa = leerPlan(plano([
    ['C', 'xx..xx'],
    ['B', 'xxxxxx'],
    ['A', 'xx..xx'],
  ]));
  const libres = new Set(
    mapa.rows.flatMap((r) => r.seats).filter((s) => s.free).map((s) => s.id),
  );
  for (const b of bestBlocks(mapa, 2, 5)) {
    for (const s of b.seats) assert.ok(libres.has(s), `${s} no está libre`);
  }
});

// ── El enlace que lleva a pagar ─────────────────────────────────────────────

test('el enlace de compra apunta al mapa de esa función', () => {
  // Es lo último que toca la persona antes de pagar: si se arma mal, el viaje
  // entero no sirve.
  const link = buyLink('la-odisea', '0000000026', '95173');
  assert.equal(
    link,
    'https://www.cineplanet.com.pe/compra/la-odisea/0000000026/95173/asientos',
  );
});

// ── Y el camino entero, contra la cartelera de hoy ──────────────────────────

test('una conversación llega hasta el enlace con butacas que existen', async () => {
  // Las de arriba prueban las piezas; ésta prueba que encajan. Depende de que
  // hoy haya funciones, así que si no las hay se salta en vez de fallar.
  const { resolve } = await import('../src/resolve.js');
  const { cinemas } = await import('../src/catalog.js');
  const sedes = await cinemas();

  let card = null;
  for (const sede of sedes.slice(0, 4)) {
    const lista = await resolve(`que dan hoy en ${sede.name}`);
    if (lista.estado !== 'cartelera' || !lista.opciones?.length) continue;
    const r = await resolve(lista.opciones[0].nombre, { contexto: lista.contexto });
    if (r.estado === 'ok' && r.mapa) {
      card = r;
      break;
    }
  }
  if (!card) {
    console.log('    (sin funciones con butacas ahora mismo: se salta)');
    return;
  }

  assert.match(
    card.funcion.link,
    /^https:\/\/www\.cineplanet\.com\.pe\/compra\/[^/]+\/\d+\/\d+\/asientos$/,
    'el enlace tiene que llevar al mapa de esa función concreta',
  );

  // Las butacas que resaltamos deben existir en el mapa y estar libres: es el
  // error que ya cometimos una vez, sugerir G25 y G26 en una sala de 26.
  const porId = new Map(
    card.mapa.filas.flatMap((f) => f.celdas.filter((c) => c?.id)).map((c) => [c.id, c]),
  );
  const sugeridas = (card.mapa.sugeridas ?? []).flatMap((s) => s.seats ?? []);
  assert.ok(sugeridas.length > 0, 'una tarjeta con mapa tiene que sugerir butacas');
  for (const id of sugeridas) {
    const butaca = porId.get(id);
    assert.ok(butaca, `${id} se resalta pero no está en el mapa que mostramos`);
    assert.ok(butaca.libre, `${id} se sugiere pero está ocupada`);
  }
  assert.ok(card.mapa.libres <= card.mapa.total);
});
