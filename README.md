# cineplanet-api

Documentación de la API web de Cineplanet Perú, obtenida por ingeniería inversa
y verificada contra el sitio real — más un cliente en Node que sirve de
demostración de que la documentación es correcta.

**Cero dependencias.** Node 20+ y nada más.

```bash
npx github:gersonsebastianx/cineplanet-api funciones "La Odisea" --desde 16 --hasta 18
```

> No es una API oficial ni está afiliada a Cineplanet. Son los mismos endpoints
> que consume su web. Puede romperse sin aviso — de hecho, durante el desarrollo
> su plataforma estuvo caída dos horas. Úsalo para consultar tu propia cartelera;
> no para automatizar compras a escala.

---

## La API

Base: `https://www.cineplanet.com.pe/api/v1-web`

### Sesión: el 403 que confunde

`/cache/moviescache` responde **403 en frío**. Hay que visitar
`https://www.cineplanet.com.pe/` primero, guardar la cookie `chtoe` que devuelve
y reenviarla. `cinemascache` y `sessioncache` suelen responder sin cookie, pero
conviene mandarla igual.

Si la portada **deja de emitir la cookie** y hasta las cookies válidas reciben
403, su backend está caído — no es un bloqueo por IP. Se distingue así: un
bloqueo dirigido responde 403 desde el primer request y sigue entregando
cookies.

### Endpoints

| Ruta | Contenido |
|---|---|
| `/cache/moviescache` | Cartelera. Árbol `movies[].cinemas[].dates[].sessions[]` |
| `/cache/cinemascache` | Cines con `ID`, nombre, ciudad, dirección, lat/long y **distrito** en `secondAddress` |
| `/cache/sessioncache` | Funciones: `id`, `showtime`, `screenName`, `formats`, `languages` |
| `/seatplan/cinema/{cinemaId}/session/{sessionId}` | Mapa de butacas |

El `id` de sesión es compuesto: `"0000000030-52959"` = `cinemaId-sessionId`.
El slug de la película para la URL de compra viene en `movieDetailsUrl`.

### Link de compra

```
https://www.cineplanet.com.pe/compra/{slug}/{cinemaId}/{sessionId}/asientos
```

Se construye enteramente con los datos de arriba y **funciona en frío**: cae
directo en el mapa de butacas de esa función, sin necesidad de pasar por la
página de la película, con un cronómetro de 5 minutos ya corriendo.

Flujo posterior: butacas → `Continuar` → login o "Seguir como invitado" →
tickets → pasarela de pago. Las butacas no viajan en la URL: hay que clickearlas.

### Mapa de butacas: los dos ejes vienen invertidos

`SeatLayoutData.Areas[].Rows[].Seats[].Status`:

| Valor | Significado |
|---|---|
| 0 | Libre |
| 1 | Ocupada |
| 3 | Silla de ruedas |
| 5, 7 | No es butaca (pasillo o hueco) |

Y lo que más cuesta descubrir:

- **Columnas**: la posición en pantalla es `ancho - 1 - ColumnIndex`. La
  numeración crece hacia la izquierda.
- **Filas**: llegan de atrás hacia adelante (L…A). Hay que invertirlas por área.

Verificado contra la web: en la sesión `0000000026/95087` (CP Salaverry, SALA 4),
las butacas que la web nombra `E8` y `E7` son exactamente las que calcula
[`src/seatmap.js`](src/seatmap.js), con el mismo patrón de ocupadas.

---

## La web conversacional

Una página donde se escribe la frase completa y sale la función con su mapa de
butacas y el enlace de compra. Pensada para compartir por WhatsApp: quien la
abre no instala nada.

```bash
npm start        # http://localhost:3000
```

> «quiero comprar entradas a Toy Story hoy entre las 4 y 6 en el real plaza salaverry»

**Sin modelos de lenguaje.** El vocabulario es cerrado —la cartelera y los cines, ambos traídos de la API— así que [`src/parser.js`](src/parser.js) compara
contra esas listas. Es exacto, instantáneo, gratis y no alucina. Sólo fechas y
horas son reglas: `hoy`, `mañana`, `el sábado`, `entre las 4 y 6`,
`después de las 8`, `en la noche`.

**Entiende más que títulos.** Géneros (`algo para niños`, `una de terror`),
la cartelera de una sede (`qué hay hoy en Salaverry`), tipeos de hasta dos
letras (`toi estori`), y lugares que no conoce los dice en vez de responder con
cines de otra ciudad.

**Nunca contesta sólo "no hay".** Si la ventana pedida está vacía, ensancha por
pasos y dice qué cambió: primero la hora, después el día, y si la película ya
termina antes de la fecha pedida, ofrece la última función. Esa es la mitad del
producto.

**Termina en Cineplanet.** La web resuelve la frase y entrega el enlace; los
asientos y el pago ocurren allá. No se piden ni se guardan datos personales.

Necesita servidor: la API de Cineplanet exige cookie de servidor y no manda
cabeceras CORS, así que un frontend puro no puede llamarla.

**En línea: [cineplanet-api.vercel.app](https://cineplanet-api.vercel.app)**

### Ponerla en línea

```bash
npm start        # local, http://localhost:3000
```

Para que la use alguien más hace falta un servidor, y hay dos caminos, ambos
gratis y sin tarjeta:

- **Vercel** — [`vercel.json`](vercel.json) y las funciones de [`api/`](api).
  No duerme, así que la primera consulta responde igual de rápido que la
  décima. Es el que conviene si el enlace se comparte.
- **Render** — [`render.yaml`](render.yaml), proceso permanente, cero cambios.
  En el plan gratuito duerme tras ~15 minutos sin visitas y despertarlo tarda
  cerca de un minuto.

En Vercel el conteo de búsquedas populares vive en la memoria de cada instancia,
así que es aproximado y se reinicia solo. Es para sugerir, no para medir.

Dos cosas que el servidor necesita en producción y que no se notan en local:

- **`TRUST_PROXY=1`.** Detrás de un proxy, `remoteAddress` es la del proxy y es
  la misma para todo el mundo: el límite de consultas se agotaría entre
  desconocidos y quedarían bloqueados sin haber hecho nada. Con la variable
  puesta se lee `X-Forwarded-For`; sin ella se ignora, que es lo correcto en
  local donde esa cabecera la puede inventar cualquiera.
- **`/api/salud`** para que el hosting sepa que el proceso vive, y cierre
  ordenado con `SIGTERM` para no cortar respuestas a medias.

En el plan gratuito de Render el servicio duerme tras ~15 minutos sin visitas,
así que la primera consulta después de un rato tarda cerca de un minuto.

### Bitácora de consultas

Cada consulta deja una línea JSON en los logs del hosting: estado, película y
cine. Sin IP, sin identificador de persona, sin cookies. La frase cruda sólo se
guarda cuando **no** se pudo resolver — es la que sirve para arreglar el
intérprete, y sin ella los fallos son invisibles.

Los logs del plan gratuito duran poco. Para acumular historial,
[`src/bitacora.js`](src/bitacora.js) escribe una fila por turno en una hoja de
Google, con el identificador de sesión al lado: filtrando por esa columna se lee
la conversación completa; filtrando por estado se ven de golpe las que fallaron.

Hay dos caminos y basta con uno. Si faltan las variables, no hace nada.

**El corto** — un Apps Script dentro de la propia hoja
([`apps-script/bitacora.gs`](apps-script/bitacora.gs), con las instrucciones
adentro). Sin Google Cloud y sin claves: el script ya corre con permiso sobre la
hoja. Se publica como aplicación web y quedan dos variables:

| Variable | De dónde sale |
|---|---|
| `BITACORA_URL` | La URL de la implementación, termina en `/exec` |
| `BITACORA_TOKEN` | Una palabra cualquiera, la misma que dentro del script |

La implementación se publica como "cualquier usuario", pero el script rechaza
todo lo que no traiga el token: sin él responde y no toca la hoja.

**El largo** — cuenta de servicio de Google Cloud, con `GOOGLE_SA_EMAIL`,
`GOOGLE_SA_KEY` y `SHEET_ID`. Hay que habilitar la API de Google Sheets y
**compartir la hoja como editor con el correo de la cuenta de servicio**; sin ese
último paso Google responde 403 aunque las credenciales sean correctas.

El identificador de sesión es un número al azar que vive en la pestaña del
navegador y muere al cerrarla. No identifica a nadie.

---

## El cliente

```bash
git clone https://github.com/gersonsebastianx/cineplanet-api.git
cd cineplanet-api
cp config.example.json config.json   # pon tu ubicación
```

| Comando | Qué hace |
|---|---|
| `cine peliculas [texto]` | Cartelera, con búsqueda tolerante a tildes |
| `cine cines [texto\|--cerca]` | Cines, o los más cercanos a tu `config.json` |
| `cine funciones "Título" [--fecha] [--desde] [--hasta] [--cine\|--cerca]` | Funciones filtradas, con su link de compra |
| `cine butacas <cinemaId> <sessionId> [--asientos N] [--html out.html]` | Mapa de butacas y bloques contiguos sugeridos |
| `cine link <slug\|"título"> <cinemaId> <sessionId>` | Solo el link |

Todo sale como JSON por stdout, para encadenarlo con otras cosas.

```bash
node bin/cine.js funciones "La Odisea" --fecha manana --desde 16 --hasta 18 --cerca
```

### Cache en disco

Cada respuesta buena se guarda en `.cache/`. Si Cineplanet no responde, el CLI
tira del último snapshot, marca `"stale": true` y avisa la antigüedad por
stderr. Sirve para seguir eligiendo función durante una caída.

No cubre los mapas de butacas: cada `seatplan` es de una sesión concreta y la
ocupación cambia sola. Un mapa viejo no dice qué está libre ahora, así que ahí
falla limpio en vez de mentir.

### Uso conversacional

`.claude/skills/cine/` es un skill de Claude Code que envuelve el CLI: escribes
*"quiero ver La Odisea mañana entre 4 y 6"* y resuelve cine, función y butacas,
muestra el mapa y entrega el link. Si no usas Claude Code, ignóralo — el CLI
funciona solo.

---

## Crédito

Inspirado en
**[asther0/cineplanet-cli](https://github.com/asther0/cineplanet-cli)**, la TUI
en Rust que documentó esta API primero. De ahí salieron los códigos de estado de
butaca y la inversión de los dos ejes, verificados después contra el sitio real.

## Licencia

MIT — ver [LICENSE](LICENSE).
