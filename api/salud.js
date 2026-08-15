// Estado del despliegue, sin revelar ningún valor: sólo si las variables están
// presentes. Sirve para distinguir "no llegó la configuración" de "Google la
// rechazó", que son problemas distintos y se arreglan distinto.
//
// Con ?diagnostico=<token> hace una escritura de prueba y devuelve tal cual lo
// que respondió Apps Script. Pide el token porque escribe una fila de verdad.

export default async function handler(req, res) {
  const bitacora = process.env.BITACORA_URL
    ? 'apps-script'
    : process.env.GOOGLE_SA_EMAIL && process.env.GOOGLE_SA_KEY && process.env.SHEET_ID
      ? 'cuenta-de-servicio'
      : 'apagada';

  const estado = { ok: true, bitacora, tokenPresente: !!process.env.BITACORA_TOKEN };

  const pedido = req.query?.diagnostico;
  if (pedido && process.env.BITACORA_TOKEN && pedido === process.env.BITACORA_TOKEN) {
    try {
      const r = await fetch(process.env.BITACORA_URL, {
        method: 'POST',
        headers: { 'content-type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          token: process.env.BITACORA_TOKEN,
          fila: [new Date().toISOString(), 'diagnostico', 'escritura de prueba', 'prueba', '', '', '', '', ''],
        }),
      });
      estado.prueba = { status: r.status, respuesta: (await r.text()).slice(0, 300) };
    } catch (err) {
      estado.prueba = { error: err.message };
    }
  } else if (pedido) {
    estado.prueba = { error: 'token no coincide con el del despliegue' };
  }

  res.status(200).json(estado);
}
