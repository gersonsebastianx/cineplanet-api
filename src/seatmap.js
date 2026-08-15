// Mapa de butacas: normaliza la respuesta de /seatplan y busca bloques contiguos.
//
// La API entrega filas y columnas invertidas respecto a como se ven en pantalla,
// así que se espejan ambos ejes. Estados: 0 libre, 1 ocupada, 3 silla de ruedas,
// 5 y 7 son huecos (pasillos), no son butacas.

import { getSeatPlan } from './api.js';

const FREE = 0;
const TAKEN = 1;
const ACCESSIBLE = 3;

export async function seatMap(cinemaId, sessionId) {
  const plan = await getSeatPlan(cinemaId, sessionId);
  if (plan.ResponseCode !== '0') {
    throw new Error(plan.ErrorDescription || 'Cineplanet no entregó el mapa de butacas');
  }
  const data = plan.SeatLayoutData;
  if (!data) throw new Error('Cineplanet no devolvió butacas para esta función');

  const rows = [];
  for (const area of data.Areas ?? []) {
    const areaRows = area.Rows ?? [];
    const areaOut = [];
    const width = Math.max(
      0,
      ...areaRows.flatMap((r) => (r.Seats ?? []).map((s) => s.Position.ColumnIndex + 1)),
    );
    for (const row of areaRows) {
      const label = (row.PhysicalName ?? '').trim();
      if (!label) continue;
      const seats = [];
      for (const seat of row.Seats ?? []) {
        if (seat.Status !== FREE && seat.Status !== TAKEN && seat.Status !== ACCESSIBLE) continue;
        seats.push({
          id: `${label}${seat.Id}`,
          row: label,
          number: seat.Id,
          x: width - 1 - seat.Position.ColumnIndex, // espejo: la numeración crece hacia la izquierda
          free: seat.Status === FREE,
          accessible: seat.Status === ACCESSIBLE,
        });
      }
      if (seats.length) {
        seats.sort((a, b) => a.x - b.x);
        areaOut.push({ label, area: area.Description ?? '', width, seats });
      }
    }
    // La API entrega las filas de atrás hacia adelante; en pantalla van al revés.
    rows.push(...areaOut.reverse());
  }
  if (!rows.length) throw new Error('la función no tiene butacas legibles');

  const all = rows.flatMap((r) => r.seats);
  return {
    cinemaId,
    sessionId,
    screen: (data.Areas?.[0]?.Description ?? '').trim(),
    rows,
    total: all.length,
    free: all.filter((s) => s.free).length,
  };
}

/**
 * Bloques contiguos de `size` butacas libres, mejores primero.
 *
 * La zona buena de una sala está **detrás del centro y al medio a lo ancho**:
 * en una sala de doce filas, la E, F y G. Las primeras filas obligan a mirar
 * hacia arriba y los extremos laterales deforman la imagen, así que ambos se
 * penalizan fuerte — no basta con preferir el centro, hay que castigar el borde.
 *
 * Los bloques devueltos **no se solapan entre sí**: si comparten butacas no son
 * alternativas, son la misma zona corrida un asiento.
 */
export function bestBlocks(map, size = 2, limit = 5) {
  const nRows = map.rows.length;
  // El punto dulce está al 62% de profundidad: ni pegado a la pantalla ni al fondo.
  const filaIdeal = (nRows - 1) * 0.62;
  const blocks = [];

  map.rows.forEach((row, rowIndex) => {
    const free = row.seats.filter((s) => s.free && !s.accessible);
    for (let i = 0; i + size <= free.length; i++) {
      const run = free.slice(i, i + size);
      const contiguous = run.every((s, k) => k === 0 || s.x === run[k - 1].x + 1);
      if (!contiguous) continue;

      const centerX = run.reduce((a, s) => a + s.x, 0) / size;
      const offCenter = Math.abs(centerX - (row.width - 1) / 2) / Math.max(1, (row.width - 1) / 2);
      const offRow = Math.abs(rowIndex - filaIdeal) / Math.max(1, nRows - 1);

      // Cuadrático: alejarse un poco casi no cuesta, alejarse mucho sí.
      let score = 100 - offCenter ** 2 * 70 - offRow ** 2 * 120;
      // Las dos primeras filas son incómodas aunque estén perfectamente al centro.
      if (rowIndex <= 1) score -= 25;
      // El 15% más lateral de la fila, también.
      if (offCenter > 0.7) score -= 15;

      blocks.push({
        row: row.label,
        seats: run.map((s) => s.id),
        numbers: run.map((s) => s.number),
        score: +score.toFixed(1),
      });
    }
  });

  blocks.sort((a, b) => b.score - a.score);

  // Alternativas de verdad: sin butacas compartidas, y variando de fila mientras
  // se pueda, para que la segunda opción se sienta distinta y no corrida.
  const elegidos = [];
  const usadas = new Set();
  for (const pasada of [true, false]) {
    for (const b of blocks) {
      if (elegidos.length >= limit) break;
      if (b.seats.some((s) => usadas.has(s))) continue;
      if (pasada && elegidos.some((e) => e.row === b.row)) continue;
      elegidos.push(b);
      b.seats.forEach((s) => usadas.add(s));
    }
  }
  return elegidos;
}

/** Página HTML autocontenida con el mapa, en los colores de Cineplanet. */
export function renderHtml(map, meta = {}) {
  const head = [meta.movie, meta.cinemaName, meta.screen || map.screen, meta.date, meta.time]
    .filter(Boolean)
    .join(' · ');
  const highlight = new Set(meta.highlight ?? []);

  const rowsHtml = map.rows
    .map((row) => {
      const cells = [];
      for (let x = 0; x < row.width; x++) {
        const seat = row.seats.find((s) => s.x === x);
        if (!seat) {
          cells.push('<i class="gap"></i>');
          continue;
        }
        const cls = seat.accessible
          ? 'acc'
          : highlight.has(seat.id)
            ? 'pick'
            : seat.free
              ? 'free'
              : 'taken';
        // El número va dentro de la butaca: sin él no se puede pedir "E8" mirando el mapa.
        cells.push(`<i class="s ${cls}" title="${seat.id}">${seat.number}</i>`);
      }
      return `<div class="row"><span class="lbl">${row.label}</span>${cells.join(
        '',
      )}<span class="lbl">${row.label}</span></div>`;
    })
    .join('\n');

  return `<title>Butacas ${head || 'Cineplanet'}</title>
<style>
  :root{--bg:#fff;--fg:#0d2f6b;--muted:#7a8ba8;--free:#fff;--line:#0d2f6b;--taken:#e8394a;--pick:#0d3fa0;--acc:#b9c4d6;}
  :root:not([data-theme="light"]){}
  @media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#0f1520;--fg:#dce6f7;--muted:#8b9ab3;--free:#0f1520;--line:#5f7fbf;}}
  :root[data-theme="dark"]{--bg:#0f1520;--fg:#dce6f7;--muted:#8b9ab3;--free:#0f1520;--line:#5f7fbf;}
  body{background:var(--bg);color:var(--fg);font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;padding:20px;}
  h1{font-size:16px;margin:0 0 4px;}
  .meta{color:var(--muted);font-size:13px;margin-bottom:18px;}
  .screen{max-width:520px;margin:0 auto 22px;text-align:center;color:var(--muted);font-size:12px;letter-spacing:.18em;}
  .screen div{height:6px;border-radius:3px;background:linear-gradient(90deg,transparent,var(--line),transparent);opacity:.5;margin-top:6px;}
  .map{overflow-x:auto;}
  .grid{display:inline-block;min-width:100%;}
  .row{display:flex;align-items:center;gap:3px;justify-content:center;margin:3px 0;}
  .lbl{color:var(--muted);font-size:11px;width:16px;text-align:center;flex:none;}
  .s,.gap{width:22px;height:22px;border-radius:50%;flex:none;}
  .s{border:1.5px solid var(--line);background:var(--free);box-sizing:border-box;display:flex;align-items:center;justify-content:center;font-size:11px;font-style:normal;color:var(--fg);}
  .taken{background:var(--taken);border-color:var(--taken);color:#fff;}
  .pick{background:var(--pick);border-color:var(--pick);color:#fff;}
  .acc{background:var(--acc);border-color:var(--acc);color:var(--bg);}
  .legend{display:flex;gap:18px;justify-content:center;flex-wrap:wrap;margin-top:22px;color:var(--muted);font-size:12px;}
  .legend span{display:flex;align-items:center;gap:6px;}
</style>
<h1>${head || 'Mapa de butacas'}</h1>
<div class="meta">${map.free} de ${map.total} butacas libres</div>
<div class="screen">PANTALLA<div></div></div>
<div class="map"><div class="grid">
${rowsHtml}
</div></div>
<div class="legend">
  <span><i class="s free"></i>Disponible</span>
  <span><i class="s taken"></i>Ocupada</span>
  <span><i class="s pick"></i>Sugerida</span>
  <span><i class="s acc"></i>Silla de ruedas</span>
</div>`;
}
