---
name: cine
description: Busca funciones de cine en Cineplanet y lleva al usuario hasta la pasarela de pago. Úsalo cuando pida ver una película, buscar funciones, horarios, butacas o entradas ("quiero ver La Odisea entre 4 y 6", "qué dan hoy en Trujillo", "cómprame entradas para Toy Story").
---

# Cine

Convierte una frase suelta ("quiero ver La Odisea entre 4 y 6") en una función
concreta con butacas, y termina entregando el link de compra.

Todo se apoya en `bin/cine.js`, que sólo lee la API pública de Cineplanet.
La compra siempre la cierra el usuario: tú nunca ingresas datos de tarjeta.

## Preferencias del usuario

Están en `config.json` (ubicación, si es Socio, cuántas butacas por defecto).
Léelo antes de preguntar algo que ya esté ahí.

## Flujo

**1. Interpreta la frase.** Saca película, ventana horaria y fecha. Si no dice
fecha, asume hoy; si ya no quedan funciones hoy, ofrece las de mañana y dilo.

**2. Busca las funciones.**

```bash
node bin/cine.js funciones "La Odisea" --fecha hoy --desde 16 --hasta 18 --cerca
```

- `--cerca` usa la ubicación de `config.json` y ordena por distancia.
- `--cine "Trujillo"` filtra por nombre de cine o ciudad.
- Sin `--fecha` trae todos los días disponibles.

Si el usuario **no indicó cine** y hay varios candidatos a distancia parecida,
pregunta cuál. Si hay uno claramente más cerca, elígelo y dilo — no preguntes
por preguntar.

Si la ventana horaria no tiene nada, ofrece la función más cercana por fuera de
la ventana en vez de responder "no hay".

**3. Muestra las butacas.**

```bash
node bin/cine.js butacas <cinemaId> <sessionId> --asientos 2
```

Devuelve butacas libres por fila y bloques contiguos sugeridos, mejores primero
(prioriza centro de sala). Renderiza el mapa **embebido en el chat** con
`mcp__visualize__show_widget`: círculos por butaca, rojo = ocupada, blanco =
libre, azul = sugerida, con las letras de fila a ambos lados y la pantalla
arriba. `--html <ruta>` escribe la misma vista como archivo si hace falta.

**El número va dentro de cada butaca** (círculos de 22px, texto de 11px). Sin el
número el mapa no sirve para pedir "quiero E8": hay que poder leerlo mirando.

**4. Responde corto.** Una línea con cine, sala, hora y butacas sugeridas, y el
mapa. Sin listar todas las funciones que descartaste.

> Encontré que el Cineplanet de Real Plaza Salaverry tiene función 5:15 en SALA 4.
> Estas son las butacas disponibles — te sugiero H6 y H7 (centro, juntas):

**5. Cierra la compra.** Cuando confirme butacas ("ok, H6 y H7"):

```bash
node bin/cine.js link "La Odisea" <cinemaId> <sessionId>
```

Entrégale el link y avísale que el mapa retiene las butacas **5 minutos** desde
que lo abre. Ofrece además marcarlas tú en el navegador y dejarlo en la pasarela.

Si acepta, con las herramientas del navegador: abre el link, marca esas butacas,
`Continuar`, y **detente en el login o en el pago**. El usuario inicia sesión él
mismo y paga él mismo.

Para marcarlas, despacha la secuencia completa de eventos sobre el elemento
(`pointerdown → mousedown → pointerup → mouseup → click`) en vez de clickear por
coordenada: el marco del screenshot y el viewport CSS no coinciden. Verifica
siempre leyendo las butacas seleccionadas del DOM antes de continuar. Detalles
en `NOTES.md`.

Avísale que la retención dura ~5 minutos y que las butacas quedan bloqueadas
para él mismo si abre el link en otro navegador mientras tanto.

## Límites

- Nunca ingreses datos de tarjeta ni completes el pago.
- Pide confirmación antes de cualquier paso irreversible.
- Los datos personales del checkout (correo, DNI) los llena el usuario.

## Referencia de la API

Documentada en `NOTES.md`: endpoints, estados de butaca y la forma del link de
compra.
