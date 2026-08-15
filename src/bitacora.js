// Bitácora de consultas en una hoja de cálculo de Google.
//
// Una fila por turno, con el identificador de sesión al lado: filtrando por esa
// columna se lee la conversación completa, y filtrando por estado se ven de
// golpe todas las que fallaron. Eso es lo que sirve para arreglar el intérprete.
//
// Sin dependencias: el token se firma con `node:crypto` y se cambia por uno de
// acceso con `fetch`. Si faltan las credenciales, no hace nada y no molesta.
//
// Hay dos maneras de llegar a la hoja, y basta con una. Si están las dos, manda
// la cuenta de servicio: es la elección deliberada y la que aísla mejor, así que
// no debería quedar tapada por una variable vieja que alguien olvidó borrar.
//
//   GOOGLE_SA_EMAIL   cuenta de servicio de Google Cloud
//   GOOGLE_SA_KEY     su clave privada (el PEM completo)
//   SHEET_ID          id de la hoja, compartida con ese correo como editor
//
//   BITACORA_URL      la alternativa: un Apps Script publicado como web app
//   BITACORA_TOKEN    palabra compartida con ese script

import { createSign } from 'node:crypto';

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const conCuentaDeServicio = () =>
  !!(process.env.GOOGLE_SA_EMAIL && process.env.GOOGLE_SA_KEY && process.env.SHEET_ID);

const activo = () => conCuentaDeServicio() || !!process.env.BITACORA_URL;

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let token = null; // { valor, expira }

async function accessToken() {
  if (token && Date.now() < token.expira - 60_000) return token.valor;

  const ahora = Math.floor(Date.now() / 1000);
  const cabecera = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const cuerpo = b64url(
    JSON.stringify({
      iss: process.env.GOOGLE_SA_EMAIL,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: ahora,
      exp: ahora + 3600,
    }),
  );
  // Las variables de entorno guardan los saltos de línea escapados.
  const clave = process.env.GOOGLE_SA_KEY.replace(/\\n/g, '\n');
  const firma = createSign('RSA-SHA256').update(`${cabecera}.${cuerpo}`).sign(clave);
  const jwt = `${cabecera}.${cuerpo}.${b64url(firma)}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`Google rechazó las credenciales (${res.status})`);
  const json = await res.json();
  token = { valor: json.access_token, expira: Date.now() + json.expires_in * 1000 };
  return token.valor;
}

/** La fila tal como queda en la hoja, en el orden de los encabezados. */
function armarFila(datos) {
  const { sesion, texto, respuesta } = { ...datos };
  return [
    new Date().toISOString(),
    sesion ?? '',
    texto.slice(0, 200),
    respuesta.estado,
    respuesta.pedido?.pelicula ?? respuesta.intent?.movie?.title ?? '',
    respuesta.pedido?.cine ?? respuesta.intent?.cinema?.name ?? '',
    respuesta.funcion ? `${respuesta.funcion.fechaTexto} ${respuesta.funcion.hora}` : '',
    respuesta.ajuste ?? '',
    respuesta.pregunta ?? respuesta.mensaje ?? '',
  ];
}

/**
 * Agrega una fila. Nunca lanza: una bitácora rota no debe tumbar una consulta.
 * @param {object} datos { sesion, texto, respuesta }
 */
export async function anotar(datos) {
  if (!activo()) return;
  try {
    const fila = armarFila(datos);

    // Camino corto: el Apps Script de la propia hoja.
    if (!conCuentaDeServicio() && process.env.BITACORA_URL) {
      const res = await fetch(process.env.BITACORA_URL, {
        method: 'POST',
        // Apps Script responde 302 hacia googleusercontent y con JSON la
        // redirección pierde el cuerpo; con texto plano acepta el POST directo.
        headers: { 'content-type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ token: process.env.BITACORA_TOKEN ?? '', fila }),
        redirect: 'follow',
      });
      // Sin esto, un token mal copiado o un script sin publicar fallan en
      // silencio: la consulta responde bien y la hoja se queda vacía.
      const cuerpo = (await res.text()).slice(0, 200);
      // Se busca "escrito", no "ok": doGet también responde ok y así una
      // redirección que convierta el POST en GET pasaría por éxito.
      if (!res.ok || !cuerpo.includes('"escrito":true')) {
        console.error(
          JSON.stringify({ t: 'bitacora-rechazo', status: res.status, respuesta: cuerpo }),
        );
      }
      return;
    }

    const url =
      `https://sheets.googleapis.com/v4/spreadsheets/${process.env.SHEET_ID}` +
      `/values/A:I:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await accessToken()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ values: [fila] }),
    });
    // Mismo criterio que en el otro camino: un fallo tiene que dejar rastro.
    if (!res.ok) {
      console.error(
        JSON.stringify({
          t: 'bitacora-rechazo',
          status: res.status,
          respuesta: (await res.text()).slice(0, 200),
        }),
      );
    }
  } catch (err) {
    // Se deja rastro en los logs y se sigue: la consulta ya se respondió.
    console.error(JSON.stringify({ t: 'bitacora-error', error: err.message }));
  }
}
