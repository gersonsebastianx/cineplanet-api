// Resumen de la bitácora, para revisarla sin abrir la hoja.
//
// Existe porque el repaso diario lo hace un agente en la nube que no tiene —ni
// debe tener— las credenciales de Google. El análisis corre acá, donde ya están,
// y afuera sólo viaja el resultado.
//
// Pide clave porque expone frases que escribió gente: los últimos 8 caracteres
// del id de la hoja, que sólo tiene quien la administra.

import { leerFilas } from '../src/bitacora.js';

const FECHA = 0;
const SESION = 1;
const TEXTO = 2;
const ESTADO = 3;
const RESPUESTA = 8;

/** Estados en los que la persona no llegó a ver una función. */
const ATASCO = new Set(['falta', 'sin-cartelera', 'error']);

export default async function handler(req, res) {
  const llave = process.env.BITACORA_TOKEN || (process.env.SHEET_ID ?? '').slice(-8);
  if (!llave || req.query?.clave !== llave) {
    return res.status(403).json({ error: 'clave incorrecta' });
  }

  const dias = Math.min(Math.max(Number(req.query?.dias) || 1, 1), 30);
  const desde = new Date(Date.now() - dias * 86400e3).toISOString();
  const filas = (await leerFilas(2000)).filter(
    (f) => (f[FECHA] ?? '') >= desde && f[SESION] && f[SESION] !== 'diagnostico',
  );

  const sesiones = new Set(filas.map((f) => f[SESION]));
  const porEstado = {};
  for (const f of filas) porEstado[f[ESTADO] ?? '?'] = (porEstado[f[ESTADO] ?? '?'] ?? 0) + 1;

  // Lo que de verdad hay que mirar: dónde se quedó la gente sin respuesta útil.
  const atascos = filas
    .filter((f) => ATASCO.has(f[ESTADO]))
    .map((f) => ({ texto: f[TEXTO], estado: f[ESTADO], respuesta: (f[RESPUESTA] ?? '').slice(0, 120) }));

  // Conversaciones que nunca llegaron a una función: la señal más honesta de
  // que algo no funcionó, más que cualquier turno suelto.
  const llegaron = new Set(filas.filter((f) => f[ESTADO] === 'ok').map((f) => f[SESION]));
  const sinLlegar = [...sesiones].filter((s) => !llegaron.has(s));

  // Cuántas consultas por día, en horario de Lima: es la forma de ver el efecto
  // de una publicación o de un arreglo sin abrir la hoja.
  const diaLima = (iso) => new Date(new Date(iso).getTime() - 5 * 3600e3).toISOString().slice(0, 10);
  const porDia = {};
  for (const f of filas) {
    const d = diaLima(f[FECHA]);
    porDia[d] ??= { turnos: 0, sesiones: new Set(), ok: 0 };
    porDia[d].turnos += 1;
    porDia[d].sesiones.add(f[SESION]);
    if (f[ESTADO] === 'ok') porDia[d].ok += 1;
  }

  res.status(200).json({
    dias,
    sesiones: sesiones.size,
    turnos: filas.length,
    primera: filas[0]?.[FECHA] ?? null,
    ultima: filas.at(-1)?.[FECHA] ?? null,
    porDia: Object.fromEntries(
      Object.entries(porDia)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([d, v]) => [d, { turnos: v.turnos, sesiones: v.sesiones.size, ok: v.ok }]),
    ),
    porEstado,
    sesionesSinFuncion: sinLlegar.length,
    // Una respuesta que afirma que algo no está en cartelera merece revisión:
    // es la familia de errores que más caro salió.
    afirmacionesDeNoCartelera: filas.filter((f) => /no está en cartelera/i.test(f[RESPUESTA] ?? '')).length,
    atascos: atascos.slice(0, 40),
    conversaciones: [...sesiones].slice(-25).map((s) => ({
      sesion: s,
      turnos: filas.filter((f) => f[SESION] === s).map((f) => `${f[TEXTO]} → ${f[ESTADO]}`),
    })),
  });
}
