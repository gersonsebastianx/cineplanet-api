// ¿Funciona la web que usa la gente?
//
//   node test/produccion.mjs
//
// Las pruebas y el barrido prueban el código contra Cineplanet **desde donde
// corren**. En GitHub eso es una IP que Cineplanet a veces rechaza, y entonces la
// revisión entera se saltaba sin haber mirado nunca la web de verdad, que corre
// en Vercel desde otras IPs y puede estar perfecta —o rota— por su cuenta.
//
// Esto pregunta directo a producción. Falla sólo si el fallo es nuestro: una
// respuesta que no es JSON, un error 500, la portada sin cargar. Si Cineplanet
// está caído, producción lo dice con un 503 y eso no es un fallo de este
// repositorio.
//
// Las consultas van sin `sesion`, así quedan en la pestaña de Pruebas de la
// bitácora y no se mezclan con lo que escribe la gente.

const WEB = process.env.WEB ?? 'https://cineplanet-api.vercel.app';
const fallos = [];
const avisos = [];

async function mirar(nombre, fn) {
  try {
    await fn();
    console.log(`✓ ${nombre}`);
  } catch (err) {
    fallos.push(`${nombre}: ${err.message}`);
    console.log(`✗ ${nombre}: ${err.message}`);
  }
}

const conPlazo = (ms) => AbortSignal.timeout(ms);

await mirar('la portada carga con su vista previa', async () => {
  const r = await fetch(`${WEB}/`, { signal: conPlazo(20_000) });
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
  const html = await r.text();
  if (!html.includes('og:image')) throw new Error('falta la vista previa (og:image)');
});

await mirar('la imagen de la vista previa existe', async () => {
  const r = await fetch(`${WEB}/og.png`, { signal: conPlazo(20_000) });
  if (r.status !== 200 || !/image\/png/.test(r.headers.get('content-type') ?? ''))
    throw new Error(`HTTP ${r.status} ${r.headers.get('content-type')}`);
});

await mirar('/api/salud', async () => {
  const r = await fetch(`${WEB}/api/salud`, { signal: conPlazo(20_000) });
  if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
});

await mirar('una consulta real llega a una respuesta', async () => {
  const r = await fetch(`${WEB}/api/consulta`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ texto: '¿Qué películas hay hoy?' }),
    signal: conPlazo(30_000),
  });
  let cuerpo;
  try {
    cuerpo = await r.json();
  } catch {
    throw new Error(`HTTP ${r.status} y la respuesta no es JSON`);
  }
  if (r.status === 503 && /Cineplanet/.test(cuerpo.mensaje ?? '')) {
    avisos.push(`producción responde bien, pero Cineplanet no le contesta: «${cuerpo.mensaje}»`);
    return;
  }
  if (r.status !== 200) throw new Error(`HTTP ${r.status}: ${cuerpo.mensaje ?? ''}`);
  if (!cuerpo.estado || !(cuerpo.pregunta || cuerpo.mensaje || cuerpo.pedido))
    throw new Error(`respuesta muda: ${JSON.stringify(cuerpo).slice(0, 120)}`);
});

for (const a of avisos) console.log(`::notice::${a}`);
if (fallos.length) {
  for (const f of fallos) console.log(`::error::${f}`);
  process.exit(1);
}
