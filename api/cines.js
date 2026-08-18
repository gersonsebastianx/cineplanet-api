// Sedes cercanas, para el botón "Cambiar" de la tarjeta.
//
// La web recuerda el último cine en el navegador de cada persona. Cuando ese
// recuerdo ya no sirve —viajó, se mudó, o simplemente va a otro— necesita
// cambiarlo sin escribir. Devolver las 43 sedes sería peor que preguntar: acá
// van sólo las tres más cercanas a donde se la ubicó por última vez.

import { cinemas, nearest } from '../src/catalog.js';

export default async function handler(req, res) {
  try {
    const lista = await cinemas();
    const lat = Number(req.query?.lat);
    const lon = Number(req.query?.lon);
    const cerca =
      Number.isFinite(lat) && Number.isFinite(lon)
        ? nearest(lista, { lat, lon }, 3)
        : // Sin coordenadas no se puede acertar, así que se ofrece buscar por
          // distrito en vez de inventar tres sedes al azar.
          [];
    res.setHeader('cache-control', 'public, max-age=3600');
    return res.status(200).json({
      cines: cerca.map((c) => ({ id: c.id, nombre: c.name, km: c.km, ciudad: c.city })),
    });
  } catch (err) {
    return res.status(500).json({ cines: [], error: err.message });
  }
}
