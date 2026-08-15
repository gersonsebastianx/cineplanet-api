#!/usr/bin/env node
// CLI de consulta de Cineplanet. Sólo lee: no reserva ni compra.
//
//   cine peliculas [texto]
//   cine cines [texto|--cerca]
//   cine funciones "La Odisea" [--fecha hoy|manana|YYYY-MM-DD] [--desde 16] [--hasta 18]
//                              [--cine "Trujillo"] [--cerca] [--json]
//   cine butacas <cinemaId> <sessionId> [--asientos 2] [--html out.html] [--json]
//   cine link <slug|"titulo"> <cinemaId> <sessionId>

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  movies,
  cinemas,
  matchMovies,
  matchCinemas,
  nearest,
  showtimes,
  resolveDate,
} from '../src/catalog.js';
import { seatMap, bestBlocks, renderHtml } from '../src/seatmap.js';
import { buyLink, stale } from '../src/api.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = resolve(root, 'config.json');
const config = existsSync(configPath)
  ? JSON.parse(readFileSync(configPath, 'utf8'))
  : { home: null };

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else flags[key] = true;
    } else positional.push(a);
  }
  return { flags, positional };
}

function out(obj) {
  // Los datos viejos sirven para elegir función, pero no para confiar en la
  // ocupación de butacas: hay que decirlo, no dejarlo pasar en silencio.
  if (stale.hits.length) {
    const min = Math.round(stale.oldestMs / 60000);
    console.error(`aviso: Cineplanet no responde; datos del cache, ${min} min de antigüedad`);
    obj = { stale: true, staleMinutes: min, ...obj };
  }
  console.log(JSON.stringify(obj, null, 2));
}
const fail = (msg) => {
  console.error(`error: ${msg}`);
  process.exit(1);
};

async function resolveCinemaIds(flags) {
  const list = await cinemas();
  if (flags.cine) {
    const hits = matchCinemas(list, String(flags.cine));
    if (!hits.length) fail(`ningún cine coincide con "${flags.cine}"`);
    return { ids: hits.map((c) => c.id), list };
  }
  if (flags.cerca) {
    if (!config.home) fail('no hay ubicación en config.json (campo "home")');
    return { ids: nearest(list, config.home, +flags.limite || 4).map((c) => c.id), list };
  }
  return { ids: null, list };
}

const [, , command, ...rest] = process.argv;
const { flags, positional } = parseArgs(rest);

try {
  switch (command) {
    case 'peliculas': {
      const list = await movies();
      const hits = positional.length ? matchMovies(list, positional.join(' ')) : list;
      out(
        hits
          .filter((m) => !m.comingSoon || flags.todas)
          .map(({ title, slug, runTime, rating, genre }) => ({
            title,
            slug,
            runTime,
            rating,
            genre,
          })),
      );
      break;
    }

    case 'cines': {
      const list = await cinemas();
      if (flags.cerca) {
        if (!config.home) fail('no hay ubicación en config.json (campo "home")');
        out(nearest(list, config.home, +flags.limite || 5));
        break;
      }
      out(positional.length ? matchCinemas(list, positional.join(' ')) : list);
      break;
    }

    case 'funciones': {
      const query = positional.join(' ');
      if (!query) fail('falta el nombre de la película');
      const list = await movies();
      const hits = matchMovies(list, query);
      if (!hits.length) fail(`no encontré "${query}" en cartelera`);
      const movie = hits[0];
      const { ids, list: cinemaList } = await resolveCinemaIds(flags);
      const found = await showtimes({
        movie,
        date: resolveDate(flags.fecha),
        from: flags.desde,
        to: flags.hasta,
        cinemaIds: ids,
      });
      const withKm = config.home
        ? (() => {
            const km = new Map(nearest(cinemaList, config.home, 999).map((c) => [c.id, c.km]));
            return found.map((f) => ({ ...f, km: km.get(f.cinemaId) }));
          })()
        : found;
      out({
        movie: { title: movie.title, slug: movie.slug, runTime: movie.runTime, rating: movie.rating },
        alternatives: hits.slice(1, 4).map((m) => m.title),
        count: withKm.length,
        showtimes: withKm,
      });
      break;
    }

    case 'butacas': {
      const [cinemaId, sessionId] = positional;
      if (!cinemaId || !sessionId) fail('uso: cine butacas <cinemaId> <sessionId>');
      const map = await seatMap(cinemaId, sessionId);
      const size = +flags.asientos || 2;
      const blocks = bestBlocks(map, size);
      if (flags.html) {
        const html = renderHtml(map, {
          movie: flags.pelicula,
          cinemaName: flags.nombre,
          date: flags.fecha === true ? undefined : flags.fecha,
          time: flags.hora,
          highlight: blocks[0]?.seats ?? [],
        });
        writeFileSync(flags.html === true ? 'butacas.html' : flags.html, html);
      }
      out({
        screen: map.screen,
        total: map.total,
        free: map.free,
        suggestions: blocks,
        rows: map.rows.map((r) => ({
          row: r.label,
          free: r.seats.filter((s) => s.free).map((s) => s.number),
        })),
      });
      break;
    }

    case 'link': {
      const [slugOrTitle, cinemaId, sessionId] = positional;
      if (!slugOrTitle || !cinemaId || !sessionId) {
        fail('uso: cine link <slug|"titulo"> <cinemaId> <sessionId>');
      }
      let slug = slugOrTitle;
      if (slug.includes(' ')) {
        const hit = matchMovies(await movies(), slug)[0];
        if (!hit) fail(`no encontré "${slug}"`);
        slug = hit.slug;
      }
      console.log(buyLink(slug, cinemaId, sessionId));
      break;
    }

    default:
      console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 11).join('\n'));
      process.exit(command ? 1 : 0);
  }
} catch (err) {
  fail(err.message);
}
