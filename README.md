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
| `/cache/cinemascache` | 41 cines con `ID`, nombre, ciudad, dirección y lat/long |
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

La forma de esta API la documentó primero
**[asther0/cineplanet-cli](https://github.com/asther0/cineplanet-cli)**, una TUI
en Rust. Sin ese trabajo previo esto habría tomado mucho más.

Dos cosas salieron específicamente de leer su código fuente: los **códigos de
estado de butaca** (0/1/3/5/7) y el hecho de que **los dos ejes vienen
invertidos**. Ambas se verificaron después de forma independiente contra el sitio
real. El resto de este repositorio es una implementación propia en Node, con
foco distinto: documentar la API y usarla de forma conversacional, en vez de una
interfaz de terminal.

Ese repositorio **no declara licencia**, así que no se copió código de él.

## Licencia

MIT — ver [LICENSE](LICENSE).
