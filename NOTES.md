# API de Cineplanet — lo que se verificó

No es una API oficial para terceros: son los endpoints que consume su propia web.
Todo lo que usamos es de lectura.

## Sesión

`GET /api/v1-web/cache/moviescache` responde **403** en frío. Hay que visitar
`https://www.cineplanet.com.pe/` primero, guardar las cookies y reenviarlas.
`cinemascache` y `sessioncache` responden sin cookie, pero se manda igual.

## Endpoints

| Ruta | Contenido |
|---|---|
| `/api/v1-web/cache/moviescache` | Cartelera. Árbol `movies[].cinemas[].dates[].sessions[]` |
| `/api/v1-web/cache/cinemascache` | Cines con `ID`, nombre, ciudad, dirección, **lat/long** y distrito |
| `/api/v1-web/cache/sessioncache` | Funciones: `id`, `showtime`, `screenName`, `formats`, `languages` |
| `/api/v1-web/seatplan/cinema/{cinemaId}/session/{sessionId}` | Mapa de butacas |

El `id` de sesión es compuesto: `"0000000030-52959"` = `cinemaId-sessionId`.
El slug de la película para la URL de compra viene en `movieDetailsUrl`.

## Link de compra

```
https://www.cineplanet.com.pe/compra/{slug}/{cinemaId}/{sessionId}/asientos
```

Se puede construir enteramente con los datos de arriba. Cae directo en el mapa
de butacas de esa función, con un cronómetro de **5 minutos** ya corriendo.

✅ **Confirmado en frío el 2026-08-15**, con el sitio sano: abrirlo en una
pestaña nueva, sin pasar por la página de la película, cae directo en el mapa
correcto con el cronómetro corriendo. No necesita estado previo.

El error "¡Ups! algo sucedió" que dio antes era la caída de su plataforma, no el
link. La hipótesis de que hacía falta el estado previo del flujo era falsa.

Flujo posterior: butacas → `Continuar` → login o "Seguir como invitado" →
tickets → pasarela de pago. Las butacas **no** viajan en la URL: hay que
clickearlas.

## Cuando todo devuelve 403

Si la portada **deja de emitir la cookie `chtoe`** y hasta las cookies viejas
reciben 403, su backend de sesiones está caído — no es un bloqueo por IP. Se
distingue así: un bloqueo dirigido responde 403 desde el primer request y sigue
entregando cookies. Visto el 2026-08-15. No hay nada que arreglar del lado
nuestro; sólo reintentar.

## El distrito de cada sede

`secondAddress` lo trae, en las 43 sedes sin excepción, con formatos irregulares:
`"Miraflores Lima Lima"`, `"La Molina - Lima"`, `"Ate, Lima Lima"`, `"AteLima Lima"`.
Se limpia cortando en `(`, `,` y ` - `, y quitando del final la ciudad repetida.

Importa porque el nombre de la sede **no** dice dónde está: CP Salaverry queda en
Jesús María, CP El Polo en Surco, CP Norte en Los Olivos. Una lista escrita a mano
se equivoca; ésta no.

## Estados de butaca

`SeatLayoutData.Areas[].Rows[].Seats[].Status`:

| Valor | Significado |
|---|---|
| 0 | Libre |
| 1 | Ocupada |
| 3 | Silla de ruedas |
| 5, 7 | No es butaca (pasillo/hueco) |

**Los dos ejes vienen invertidos** respecto a la pantalla:

- Columnas: la posición en pantalla es `ancho - 1 - ColumnIndex`. La numeración
  crece hacia la izquierda.
- Filas: llegan de atrás hacia adelante (L…A); hay que invertirlas por área.

Verificado contra la web: sesión `0000000026/95062` (CP Salaverry, SALA 4), fila
H — las butacas que la web nombró `H5` y `H4` corresponden exactamente a las
posiciones que calcula `src/seatmap.js`, con el mismo patrón de ocupadas.

## Notas del DOM (para automatizar los últimos clicks)

- Butacas: `div.seat-map--seat`, con `_available` / `_broken` / `_selected`.
  Ojo: el swatch de la leyenda también lleva `_selected`. Filtrar por
  `closest('tr')` para contar sólo butacas de verdad.
- Un `.click()` pelado no basta, pero **una secuencia completa de eventos sí**:
  `pointerdown → mousedown → pointerup → mouseup → click`, con `bubbles`,
  `composed` y `clientX/clientY` reales. Es mucho más fiable que clickear por
  coordenada, porque el marco del screenshot y el viewport CSS **no coinciden**
  (por ejemplo 800px de marco contra 443px de viewport: factor 1.8). Clickear con
  coordenadas del DOM sin convertir da en cualquier otro lado.
- La numeración de una fila va de izquierda a derecha en orden decreciente
  (13…1 en SALA 4), así que el índice `i` en el DOM mapea a `nums[i]`.
- Al elegir una fecha distinta a hoy aparece un modal de confirmación
  ("Continuar Compra") antes de llegar al mapa.

## Crédito

La forma de la API la documentó primero
[asther0/cineplanet-cli](https://github.com/asther0/cineplanet-cli) (Rust).

## Cache en disco

`src/api.js` guarda cada respuesta buena en `.cache/` y tira de ahí cuando
Cineplanet no responde. Sirve para seguir eligiendo función durante una caída;
el CLI marca `"stale": true` y avisa por stderr la antigüedad en minutos.

Lo que **no** cubre: los mapas de butacas. Cada `seatplan` es de una sesión
concreta y sólo queda cacheado si ya se consultó esa sesión antes. Y aunque
estuviera, la ocupación cambia sola — un mapa viejo no dice qué está libre ahora.
