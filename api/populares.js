// Lo que más busca la gente, para quien llega sin historial propio.
//
// Antes se contaba en memoria y en Vercel eso nunca funcionó: cada petición
// corre en una instancia distinta, así que el contador siempre estaba vacío y
// la web caía en las dos frases de ejemplo. Los datos ya estaban en la
// bitácora; sólo había que leerlos de ahí.

import { leerFilas } from '../src/bitacora.js';
import { resolve } from '../src/resolve.js';

// Columnas de la hoja.
const SESION = 1;
const TEXTO = 2;
const ESTADO = 3;

const clave = (s) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Una lectura por instancia cada diez minutos: la lista no cambia tan rápido
// como para justificar ir a Google en cada visita.
let cache = { hasta: 0, lista: [] };

export default async function handler(req, res) {
  if (Date.now() < cache.hasta) {
    return res.status(200).json({ populares: cache.lista });
  }
  const filas = await leerFilas();
  const cuenta = new Map();

  for (const f of filas) {
    const texto = (f[TEXTO] ?? '').trim();
    const sesion = f[SESION] ?? '';
    const estado = f[ESTADO] ?? '';
    // Sólo lo que llevó a algo: repetir una frase que no funcionó sería invitar
    // a la gente a chocarse contra la misma pared.
    if (!['ok', 'cartelera'].includes(estado)) continue;
    // Las sondas de diagnóstico y las pruebas sin sesión no son gente buscando.
    if (!sesion || sesion === 'diagnostico') continue;
    // Frases largas suelen ser una conversación entera, no un buen ejemplo.
    if (texto.length < 8 || texto.length > 52) continue;

    const k = clave(texto);
    if (!k) continue;
    const previo = cuenta.get(k) ?? { texto, sesiones: new Set() };
    previo.sesiones.add(sesion);
    cuenta.set(k, previo);
  }

  const candidatas = [...cuenta.values()]
    // Que la hayan escrito **personas distintas**. Con esto, lo que aparece son
    // búsquedas comunes y no la frase suelta de alguien, que sería mostrarle a
    // un desconocido lo que otro escribió.
    .filter((c) => c.sesiones.size >= 2)
    .sort((a, b) => b.sesiones.size - a.sesiones.size)
    .slice(0, 8);

  // Y que **funcione sola**. Muchas frases muy repetidas son respuestas de
  // seguimiento —"para 1 personas", "trujillo"— que sin la conversación previa
  // no llevan a ninguna parte. En vez de adivinar cuáles son, se prueban: sólo
  // sirve de ejemplo la que por sí misma llega a una función.
  const lista = [];
  for (const c of candidatas) {
    if (lista.length >= 3) break;
    try {
      const r = await resolve(c.texto);
      if (r.estado === 'ok') lista.push(c.texto);
    } catch {
      /* si falla la comprobación, simplemente no se ofrece */
    }
  }

  cache = { hasta: Date.now() + 10 * 60 * 1000, lista };
  res.setHeader('cache-control', 'public, max-age=600');
  res.status(200).json({ populares: lista });
}
