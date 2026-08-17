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
  // Con cuenta de servicio la prueba se hace por el mismo camino que la bitácora
  // y se informa **lo que Google contestó**, no que se intentó: decir "enviada"
  // cuando la escritura se rechazó es exactamente el error que dejó la hoja
  // vacía durante días. Pide una clave porque escribe una fila de verdad; sin
  // token configurado sirve el final del id de la hoja, que quien la administra
  // tiene a la vista en la URL.
  if (pedido && conCuenta) {
    const llave = process.env.BITACORA_TOKEN || process.env.SHEET_ID.slice(-8);
    if (pedido !== llave) {
      estado.prueba = { error: 'clave incorrecta' };
      return res.status(200).json(estado);
    }
    const { anotar, formaDeLaClave } = await import('../src/bitacora.js');
    // A la pestaña de pruebas: mezclarlas con las consultas reales arruina lo
    // único que hace útil a la bitácora, que es leer lo que la gente pregunta.
    const r = await anotar(
      { sesion: 'diagnostico', texto: 'escritura de prueba', respuesta: { estado: 'prueba' } },
      'Pruebas',
    );
    estado.prueba = r?.ok
      ? { via: r.via, escrita: true }
      : {
          via: r?.via ?? 'cuenta-de-servicio',
          escrita: false,
          error: r?.detalle ?? 'sin respuesta',
          // Un PEM mal pegado falla con un error de OpenSSL que no dice nada.
          // Esto describe la forma del valor sin revelar ni un carácter.
          clave: formaDeLaClave(),
        };
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
