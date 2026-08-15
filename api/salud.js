// Estado del despliegue, sin revelar ningún valor: sólo si las variables están
// presentes. Sirve para distinguir "no llegó la configuración" de "Google la
// rechazó", que son problemas distintos y se arreglan distinto.
//
// Con ?diagnostico=<token> hace una escritura de prueba y devuelve tal cual lo
// que respondió Apps Script. Pide el token porque escribe una fila de verdad.

export default async function handler(req, res) {
  const conCuenta =
    !!process.env.GOOGLE_SA_EMAIL && !!process.env.GOOGLE_SA_KEY && !!process.env.SHEET_ID;
  const bitacora = conCuenta ? 'cuenta-de-servicio' : process.env.BITACORA_URL ? 'apps-script' : 'apagada';

  const estado = { ok: true, bitacora, tokenPresente: !!process.env.BITACORA_TOKEN };

  const pedido = req.query?.diagnostico;
  // Con cuenta de servicio la prueba se hace por el mismo camino que la bitácora.
  if (pedido && conCuenta) {
    const { anotar } = await import('../src/bitacora.js');
    await anotar({
      sesion: 'diagnostico',
      texto: 'escritura de prueba',
      respuesta: { estado: 'prueba' },
    });
    estado.prueba = { via: 'cuenta-de-servicio', enviada: true };
    return res.status(200).json(estado);
  }
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
      estado.prueba = {
        status: r.status,
        // Un fragmento basta para comparar contra la que muestra Apps Script y
        // no alcanza para usar la URL: el identificador completo es más largo.
        urlConfigurada: `…${process.env.BITACORA_URL.slice(-0)}`.length
          ? process.env.BITACORA_URL.slice(0, 62) + '…'
          : null,
        respuesta: (await r.text()).slice(0, 200),
      };
    } catch (err) {
      estado.prueba = { error: err.message };
    }
  } else if (pedido) {
    estado.prueba = { error: 'token no coincide con el del despliegue' };
  }

  res.status(200).json(estado);
}
