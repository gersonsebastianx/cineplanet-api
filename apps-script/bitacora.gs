/**
 * Recibe una fila y la agrega a la hoja. Va dentro de la propia hoja de cálculo,
 * así que no hace falta cuenta de servicio ni credenciales: el script ya corre
 * con permiso sobre ella.
 *
 * Cómo instalarlo:
 *   1. Abrir la hoja → Extensiones → Apps Script.
 *   2. Pegar este archivo, reemplazando lo que haya.
 *   3. Cambiar TOKEN por una palabra cualquiera, larga y difícil de adivinar.
 *   4. Configuración del proyecto (⚙️) → marcar "Mostrar el archivo de
 *      manifiesto appsscript.json en el editor".
 *   5. Abrir appsscript.json y reemplazarlo por el de esta misma carpeta. Ese
 *      manifiesto acota el permiso a `spreadsheets.currentonly`: el script
 *      queda limitado a la hoja que lo contiene y no puede tocar ninguna otra
 *      del Drive. Sin él, Google pide acceso a **todas** las hojas de cálculo.
 *   6. Implementar → Nueva implementación → Aplicación web.
 *        Ejecutar como:  Yo
 *        Quién tiene acceso:  Cualquier usuario
 *   7. Autorizar cuando Google lo pida, y copiar la URL que termina en /exec.
 *
 * Después, en Vercel: BITACORA_URL con esa URL y BITACORA_TOKEN con la palabra.
 *
 * "Cualquier usuario" suena abierto, pero el script sólo acepta escrituras que
 * traigan el token; sin él responde 403 y no toca la hoja. Es la razón de que el
 * token exista.
 */

const TOKEN = 'CAMBIA-ESTO-POR-UNA-PALABRA-LARGA';

function doPost(e) {
  try {
    const cuerpo = JSON.parse(e.postData.contents);

    if (cuerpo.token !== TOKEN) {
      return ContentService.createTextOutput(
        JSON.stringify({ ok: false, error: 'token inválido' }),
      ).setMimeType(ContentService.MimeType.JSON);
    }

    const fila = cuerpo.fila;
    if (!Array.isArray(fila) || !fila.length) {
      return ContentService.createTextOutput(
        JSON.stringify({ ok: false, error: 'fila vacía' }),
      ).setMimeType(ContentService.MimeType.JSON);
    }

    SpreadsheetApp.getActiveSpreadsheet().getSheets()[0].appendRow(fila);

    // "escrito" sólo lo devuelve este camino. Si la respuesta llegara desde
    // doGet —porque una redirección convirtió el POST en GET— se notaría.
    return ContentService.createTextOutput(
      JSON.stringify({ ok: true, escrito: true }),
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ ok: false, error: String(err) }),
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

/** Para comprobar desde el navegador que la implementación está viva. */
function doGet() {
  return ContentService.createTextOutput(
    JSON.stringify({ ok: true, escrito: false, mensaje: 'bitácora en pie' }),
  ).setMimeType(ContentService.MimeType.JSON);
}
