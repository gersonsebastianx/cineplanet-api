#!/usr/bin/env node
// Servidor mínimo para la interfaz conversacional.
//
// Hace falta un servidor porque la API de Cineplanet exige una cookie tomada
// desde el lado servidor y no manda cabeceras CORS: el navegador no puede
// llamarla directo.
//
//   node server.js          → http://localhost:3000
//   PORT=8080 node server.js

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath, extname, normalize } from 'node:path';
import { resolve as resolveQuery } from './src/resolve.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolvePath(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

// Una consulta dispara varias llamadas a Cineplanet; conviene no exigirles de más.
const RATE = { windowMs: 60_000, max: 20 };
const hits = new Map();

// Qué busca la gente, para sugerirlo a quien llega sin historial propio. Se
// cuenta película + cine ya resueltos, nunca la frase cruda ni quién la escribió.
const POPULARES = resolvePath(ROOT, '.cache', 'populares.json');
let populares = {};
try {
  populares = JSON.parse(await readFile(POPULARES, 'utf8'));
} catch {
  populares = {};
}

let guardando = null;
function contar(respuesta) {
  const p = respuesta?.pedido;
  if (!p?.pelicula || !p?.cine) return;
  const clave = `${p.pelicula} en ${p.cine}`;
  populares[clave] = (populares[clave] ?? 0) + 1;
  clearTimeout(guardando);
  guardando = setTimeout(() => {
    writeFile(POPULARES, JSON.stringify(populares)).catch(() => {});
  }, 2000);
}

const masBuscadas = (n = 3) =>
  Object.entries(populares)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([texto]) => texto);

/**
 * IP real del visitante. Detrás de un proxy —cualquier hosting— `remoteAddress`
 * es la del proxy y sería la misma para todos: el límite de consultas se
 * agotaría entre desconocidos y quedarían bloqueados sin haber hecho nada.
 * Sólo se confía en la cabecera si el despliegue declara que hay proxy.
 */
function clientIp(req) {
  if (process.env.TRUST_PROXY === '1') {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  }
  return req.socket.remoteAddress ?? 'anon';
}

function allowed(ip) {
  const now = Date.now();
  const seen = (hits.get(ip) ?? []).filter((t) => now - t < RATE.windowMs);
  seen.push(now);
  hits.set(ip, seen);
  if (hits.size > 5000) hits.clear();
  return seen.length <= RATE.max;
}

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
};

async function readBody(req, limit = 4096) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('consulta demasiado larga');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const arranque = new Date().toISOString();

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'POST' && url.pathname === '/api/consulta') {
    const ip = clientIp(req);
    if (!allowed(ip)) {
      return json(res, 429, { estado: 'error', mensaje: 'Demasiadas consultas seguidas. Espera un momento.' });
    }
    try {
      const { texto, contexto } = JSON.parse(await readBody(req));
      if (typeof texto !== 'string' || !texto.trim()) {
        return json(res, 400, { estado: 'error', mensaje: 'Escribe qué quieres ver.' });
      }
      // El contexto lo guarda el navegador, así el servidor no necesita sesiones.
      const respuesta = await resolveQuery(texto.slice(0, 300), {
        contexto: contexto && typeof contexto === 'object' ? contexto : null,
      });
      contar(respuesta);
      return json(res, 200, respuesta);
    } catch (err) {
      const caido = /cookie de sesión|rechazó/.test(err.message);
      return json(res, caido ? 503 : 500, {
        estado: 'error',
        mensaje: caido
          ? 'Cineplanet no está respondiendo ahora mismo. Intenta en unos minutos.'
          : 'No pude resolver esa consulta.',
      });
    }
  }

  // El hosting la usa para saber si el proceso sigue vivo.
  if (req.method === 'GET' && url.pathname === '/api/salud') {
    return json(res, 200, { ok: true, desde: arranque });
  }

  if (req.method === 'GET' && url.pathname === '/api/populares') {
    return json(res, 200, { populares: masBuscadas(3) });
  }

  if (req.method !== 'GET') return json(res, 405, { estado: 'error', mensaje: 'Método no permitido' });

  // Sólo se sirve lo que vive dentro de public/.
  const rel = url.pathname === '/' ? '/index.html' : normalize(url.pathname);
  const file = resolvePath(PUBLIC, `.${rel}`);
  if (!file.startsWith(PUBLIC)) return json(res, 403, { estado: 'error', mensaje: 'Prohibido' });

  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('No encontrado');
  }
});

await mkdir(resolvePath(ROOT, '.cache'), { recursive: true }).catch(() => {});

server.listen(PORT, () => {
  console.log(`Cineplanet conversacional en http://localhost:${PORT}`);
});

// El hosting manda SIGTERM al reiniciar; cerrar a tiempo evita respuestas cortadas.
for (const senal of ['SIGTERM', 'SIGINT']) {
  process.on(senal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
