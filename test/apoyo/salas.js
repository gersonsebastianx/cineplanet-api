// Andamiaje para probar qué se hace cuando las salas están llenas o no.
//
// Depende de la cartelera para saber qué días existen, pero no de qué tan llena
// esté hoy una sala: los mapas se fabrican. `api.js` guarda cada mapa 45 s, así
// que cada archivo de prueba usa un solo escenario —`node --test` corre cada
// archivo en su propio proceso— en vez de cambiarlo a mitad.

export const AGOTADA = { ResponseCode: '67', ErrorDescription: 'Session sold out' };

export const LIBRE = {
  ResponseCode: '0',
  SeatLayoutData: {
    Areas: [
      {
        Description: 'SALA 1',
        Rows: ['B', 'A'].map((nombre) => ({
          PhysicalName: nombre,
          Seats: Array.from({ length: 10 }, (_, i) => ({
            Id: 10 - i,
            Status: 0,
            Position: { ColumnIndex: i },
          })),
        })),
      },
    ],
  },
};

/** Responde los mapas con `decidir(sessionId)`; todo lo demás va a la red real. */
export function fabricarMapas(decidir) {
  const original = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    const url = String(args[0]);
    if (!url.includes('/seatplan/')) return original(...args);
    const cuerpo = decidir(/session\/(\d+)/.exec(url)?.[1]) ? AGOTADA : LIBRE;
    return new Response(JSON.stringify(cuerpo), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];
export const dicho = (iso) => `el ${+iso.slice(8, 10)} de ${MESES[+iso.slice(5, 7) - 1]}`;

/** Una película y una sede reales con funciones en al menos dos días futuros. */
export async function elegirPar() {
  const { movies, cinemas, showtimes } = await import('../../src/catalog.js');
  const { limaToday } = await import('../../src/parser.js');
  const hoy = limaToday();
  const [ms, cs] = [await movies(), await cinemas()];
  for (const m of ms) {
    const todas = (await showtimes({ movie: m })).filter((f) => f.date > hoy);
    for (const [cineId, fs] of Map.groupBy(todas, (f) => f.cinemaId)) {
      const dias = [...new Set(fs.map((f) => f.date))].sort();
      if (dias.length < 2) continue;
      return {
        pelicula: m,
        sede: cs.find((c) => c.id === cineId),
        primero: dias[0],
        segundo: dias[1],
        delPrimero: fs.filter((f) => f.date === dias[0]),
      };
    }
  }
  return null;
}

/** Pide esa película en esa sede para el primer día, sin depender de cómo se parsee el título. */
export async function pedirPrimerDia(par) {
  const { resolve } = await import('../../src/resolve.js');
  return resolve(`${par.pelicula.title} en ${par.sede.name} ${dicho(par.primero)}`, {
    elegido: { peliculaId: par.pelicula.id, cineId: par.sede.id },
  });
}
