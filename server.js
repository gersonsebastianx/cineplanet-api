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
import { readFile } from 'node:fs/promises';
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

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'POST' && url.pathname === '/api/consulta') {
    const ip = req.socket.remoteAddress ?? 'anon';
    if (!allowed(ip)) {
      return json(res, 429, { estado: 'error', mensaje: 'Demasiadas consultas seguidas. Espera un momento.' });
    }
    try {
      const { texto } = JSON.parse(await readBody(req));
      if (typeof texto !== 'string' || !texto.trim()) {
        return json(res, 400, { estado: 'error', mensaje: 'Escribe qué quieres ver.' });
      }
      return json(res, 200, await resolveQuery(texto.slice(0, 300)));
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

server.listen(PORT, () => {
  console.log(`Cineplanet conversacional en http://localhost:${PORT}`);
});
