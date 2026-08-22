# Por qué el intérprete falla, y qué lo arreglaría de raíz

Escrito el 2026-08-15, después de una decena de errores reportados por usuarios
reales. Cada uno se arregló por separado y siguieron apareciendo. Esto enumera
las causas de fondo en vez de los síntomas.

## El patrón que se repite

De los errores reportados, **ninguno fue una caída**. Todos fueron respuestas
seguras y equivocadas: el sistema nunca duda, nunca dice "no sé", nunca pregunta
"¿quisiste decir…?". Cuando acierta parece brillante; cuando falla, miente con
la misma cara.

Eso no es mala suerte. Es una consecuencia directa del diseño.

---

## Causa 1 — Lista negra que nunca termina

**Cómo se ve:** cada palabra común que se parece a un título produce una
película equivocada.

| Escribieron | Entendió | Por qué |
|---|---|---|
| «y dónde tiene?» | DONDE DUERMEN LOS SUEÑOS | `donde` es palabra del título |
| «la más nueva» | Caballo Salvaje **Nueve** | `nueva`→`nueve`, 1 letra |
| «the odyssey» | **THE** MAN I LOVE | `the` es artículo |
| «en jesús **maría**» | CP Villa **María** del Triunfo | `maría` está en dos sitios |
| «**pero** en magdalena…» | Zona **Cero** | `pero`→`cero`, 1 letra |

Cada arreglo fue añadir la palabra a una lista de exclusión. La lista lleva
ochenta entradas y **seguirá creciendo para siempre**, porque el español tiene
miles de palabras de cuatro letras y la cartelera cambia cada semana.

**La raíz:** el sistema pide evidencia negativa ("esta palabra no debería contar")
cuando debería pedir evidencia positiva ("hay razón suficiente para creer que es
este título").

**Qué lo arregla:** invertir la carga de la prueba.

- Una coincidencia aproximada nunca debería bastar por sí sola. Si de un título
  de dos palabras sólo coincide una, y encima aproximada, eso no es un título:
  es ruido.
- Exigir coincidencia exacta en palabras cortas. `pero`→`cero` no debería
  existir como posibilidad.
- Puntuar y **exigir margen**: si el segundo candidato está cerca del primero,
  no hay un ganador, hay una duda.

---

## Causa 2 — El sistema nunca duda

**Cómo se ve:** «¿aún está en cartelera Obsesión?» devolvió Spider-Man, con
cartelera, butacas y botón de compra. Todo correcto salvo la película.

No existe el concepto de confianza. Una coincidencia pasa el umbral o no pasa;
si pasa, se actúa como si fuera certeza. No hay un estado intermedio.

**Qué lo arregla:** tres bandas en vez de dos.

| Confianza | Respuesta |
|---|---|
| Alta | Responder como ahora |
| Media | «¿Te refieres a *Zona Cero*?» y esperar |
| Baja | Tratar como desconocido |

La banda del medio es la que no existe, y es la que habría evitado la mitad de
los errores reportados.

---

## Causa 3 — La herencia de contexto es invisible

**Cómo se ve:** se preguntó por una película y se respondió por la anterior,
sin decir en ningún momento que se estaba reutilizando algo.

El contexto es necesario —«y a las 9?» tiene que saber de qué habla— pero hoy
rellena huecos en silencio. Quien lee la respuesta no puede saber qué parte
salió de su mensaje y qué parte se supuso.

**Qué lo arregla:** que la respuesta diga lo que heredó. «En CP Salaverry, como
antes: …». Cuesta una línea y convierte un error invisible en uno evidente.

---

## Causa 4 — Cadena de reglas con orden frágil

**Cómo se ve:** dos veces, al reordenar las comprobaciones, se rompió algo que
funcionaba. Al mover el distrito antes, «algo para niños» pasó a leerse como
título. Al descartar la sede, se perdieron las coordenadas.

`resolve()` es una cadena de `if` donde **el orden codifica significado**. Nadie
puede mirar esa función y decir qué situaciones cubre.

**Qué lo arregla:** separar dos cosas que hoy están mezcladas.

1. **Interpretar** — construir una intención completa con su confianza, sin
   decidir nada.
2. **Decidir** — una tabla de situaciones: qué se sabe, qué falta, qué se
   responde. Explícita y leíble de un vistazo.

---

## Causa 5 — Lo que no se modela desaparece

**Cómo se ve:** «de 5 a 7pm» se ignoró y se respondió con otra hora, sin avisar.
«31 de febrero» y «ayer» devolvieron la función de hoy.

Cada uno se arregló agregando la forma que faltaba. Pero la clase de error
—entender a medias y no decirlo— sigue viva para toda forma que no se nos
ocurrió.

**Qué lo arregla:** el sistema ya sabe qué palabras no pudo atribuir a nada (los
"sobrantes"). Hoy sólo se usan para detectar títulos desconocidos. Deberían
usarse siempre: **si algo del mensaje no se consumió, decirlo**.

---

## Causa 6 — Sin pruebas que corran solas

**Cómo se ve:** el corpus de 48 frases vive en una carpeta temporal y se ejecuta
a mano. Cada arreglo puede romper otra cosa y sólo se descubre si alguien se
acuerda de correrlo.

Las dos regresiones que introduje se detectaron por casualidad.

**Qué lo arregla:** el corpus dentro del repositorio, con la respuesta esperada
de cada frase, corriendo con `npm test`. Y **cada error reportado entra como
caso** antes de arreglarse: así no vuelve.

---

## Causa 7 — Lo que se calcula no siempre se ve

**Cómo se ve:** el botón sugería `G25 y G26` y el mapa no las mostraba. La flecha
del botón llevaba versiones sin verse. El gradiente se salía del círculo en
Safari.

En los tres casos **el dato estaba bien**. Lo que falló fue la presentación, y
las pruebas por API no lo detectan porque miran el JSON, no la pantalla.

**Qué lo arregla:** cuando se resalta algo, garantizar que esté a la vista. Y
revisar en el navegador real, al ancho real, no sólo la respuesta del servidor.

---

## Causa 8 — Integraciones que fallan calladas

**Cómo se ve:** el contador de populares nunca funcionó en producción. La
bitácora respondía bien y no escribía nada. Las variables de entorno no se
aplicaban sin volver a desplegar.

**Qué lo arregla:** toda escritura externa revisa su respuesta y deja rastro, y
el chequeo de salud reporta **capacidad real** —"escribí una fila de prueba y
funcionó"— no la mera presencia de configuración.

---

## Estado

**Causas 1 y 2 — resueltas** (2026-08-15). La coincidencia ahora exige evidencia
positiva: un parecido suelto no elige título, y las palabras frecuentes del
español no aportan parecido. Cuando la única evidencia es aproximada, la
respuesta es `confirmar` — «¿Te refieres a La Odisea?»— en vez de una
afirmación.

**Causa 6 — resuelta.** Las pruebas viven en `test/` y corren con `npm test`.
Cada error reportado entra como caso antes de arreglarse.

**Causa 5 — resuelta.** Formato e idioma estaban en los datos y se ignoraban en
silencio: alguien pedía "doblada" y podía recibir subtitulada. Ahora se
entienden, se filtran, y si no hay funciones que los cumplan se cede y **se
dice**. Lo que sigue sin entenderse se nombra en la respuesta.

**Causa 3 — resuelta.** La tarjeta dice qué heredó del turno anterior —"Sobre La
Odisea · CP Salaverry, como antes"— así que reutilizar algo equivocado deja de
ser invisible.

**Causa 4 — en curso, por pasos.** Medido el 2026-08-19: `resolve()` tiene **703
líneas, 31 puntos de salida y 60 condiciones**, y el orden de esas salidas
codifica reglas que no están escritas en ninguna parte. Sólo ese día se le
agregaron cuatro ramas nuevas, cada una colocada razonando qué debía ir antes
que qué — razonamiento que vive en el orden de las líneas y en nadie más.

Reescribirla de golpe se descartó por una razón medida, no por prudencia vaga:
el corpus alcanzaba **cuatro de los siete estados posibles**, y no tocaba `ok`,
`sin-cartelera` ni `error`. Es decir, la red no cubría el camino que termina en
el mapa de butacas y el botón de compra, que es el que importa.

**Paso 1 — hecho** (2026-08-19). `test/butacas.test.js`: 14 pruebas sobre planos
fabricados, más una que recorre la conversación entera contra la cartelera del
día. Para eso se separó `leerPlan()` de la llamada de red. Se verificó la red con
seis mutaciones —quitar el espejo de columnas, la inversión de filas, la
detección de sala agotada, el filtro de sillas de ruedas, el de bloques
solapados, y desalinear las sugeridas del mapa— y las seis hicieron fallar una
prueba.

**Paso 2 — hecho** (2026-08-19). El orden quedó visible **sin cambiarlo**: la
cadena de `if` es ahora una lista de **17 reglas** con nombre y condición
explícita (`fecha-imposible`, `pide-otro-cine`, `palabras-sin-explicar`…), en el
mismo orden que tenían. Lo que quedaba después —elegir función, mirar butacas,
armar el botón de compra— salió a `caminoDeCompra()`, y los dos bloques largos
que colgaban de una condición son funciones con nombre (`carteleraDeLaSede()`,
`preguntarQuePelicula()`).

Se verificó frase por frase: 128 casos —el corpus entero más ocho conversaciones
encadenadas— corridos contra la versión anterior y la nueva, **cero
diferencias**; y el arnés se probó primero contra sí mismo (cero) y después
contra una versión con dos reglas intercambiadas, que dio siete. Es decir,
detecta lo que debía detectar. Las 102 pruebas siguen verdes.

`ORDEN_DE_REGLAS` se exporta y una prueba lo fija: reordenar deja de ser
invisible, hay que declararlo en el mismo commit.

**Paso 3 — quizá nunca.** La separación completa entre "interpretar" y "decidir".
Conviene decidir si hace falta *después* del paso 2, no antes.

## Revisión de extremo a extremo (2026-08-19)

Se revisó el camino completo —lo que se busca, lo que se responde y adónde
lleva el botón— con el catálogo real, no con ejemplos.

**Los enlaces están bien.** Se comprobaron las 2 090 parejas película–función
del catálogo: ninguna sesión huérfana, ninguna que mezcle una función con otra
sede, ningún título sin dirección web. En 60 tarjetas armadas de punta a punta
se verificó que el enlace lleve a **esa** película, en **esa** sede, en la
función que dice la tarjeta —fecha, hora y sala—, incluidos los enlaces de
"otras funciones". Y se abrió uno en un navegador de verdad: carga la página de
butacas correcta.

Vale la pena saber cómo falla del otro lado, porque no avisa: con una dirección
de película equivocada la página de Cineplanet queda **en blanco**, y con una
función que ya no existe muestra el mapa vacío y el botón de comprar igual. En
ambos casos responde 200: no hay forma de detectarlo desde afuera. Por eso lo
que se cuida es el origen del enlace, no su respuesta.

**Tres cosas estaban mal y se arreglaron.**

1. **"¿Qué dan hoy?" de noche era un callejón.** Pasada la última función del
   día, la pregunta más común de todas contestaba «¿Qué quieres ver?» — la
   misma pregunta que la persona acababa de hacer. A las 23:12 le pasaba a **42
   de las 43 sedes**. Ahora se cede en el mismo orden que en el resto de la
   conversación —primero la hora, después el día— y se dice: «Hoy ya no quedan
   funciones en CP Trujillo Centro, pero mañana sí:». El día ofrecido queda
   recordado, así que pulsar un título lleva directo a la función.

2. **Pulsar un botón volvía a pasar por el intérprete.** Los títulos se ofrecían
   sólo como texto, así que dos películas que el intérprete no sabe separar
   —"…Parte 1" y "…Parte 2"— devolvían «¿cuál de estas?» y pulsar la respuesta
   repetía la pregunta, sin salida. Hoy las dos están como próximo estreno, así
   que el bucle todavía no le tocó a nadie. Ahora cada opción viaja con su
   identificador, como ya se hacía con las sedes.

3. **Nada caducaba en memoria.** El proceso guardaba cada respuesta de
   Cineplanet para siempre: en un servidor que vive horas, el mapa de butacas
   de una función se congelaba —asientos ya vendidos se veían libres— y pasada
   la medianoche la cartelera de "hoy" seguía siendo la de ayer. Ahora el
   catálogo caduca a los diez minutos y las butacas a los cuarenta y cinco
   segundos.

**Además:** las llamadas a Cineplanet tienen plazo (ocho segundos) en vez de
quedarse colgadas hasta que el hosting las mate; las peticiones simultáneas del
mismo dato son una sola —el arranque en frío visitaba la portada dos veces—; y
cuando se responde con un snapshot viejo porque Cineplanet no contesta, la
tarjeta lo dice en vez de ofrecer un enlace que puede estar muerto.

**Lo que se revisó y estaba bien:** los 43 nombres de sede y las 12 ciudades
vuelven a entenderse cuando se ofrecen como botón; de 69 títulos, 66 igual —los
tres que no ya no pueden trabarse, porque el botón lleva identificador—; el
barrido completo (43 sedes × cartelera × pulsar un título) no produce bucles,
callejones, respuestas inventadas ni tarjetas de otra sede.

**Un dato del catálogo, no un error nuestro:** CP Trujillo Centro y CP
Ventanilla publican hoy 8 y 6 funciones —dos películas cada una—, contra 23–110
del resto. Cineplanet tampoco lista Trujillo entre sus ciudades con cartelera.
No hay nada que arreglar de este lado; conviene saberlo antes de dudar de la
búsqueda.

## Lo que trajo la bitácora (2026-08-19)

Cinco conversaciones en un día. Cuatro llegaron a una función; una se fue
después de cinco turnos sin ver ninguna. Ese es el caso que enseña:

    la odisea          → falta   «La Odisea está en 43 cines. ¿En qué distrito estás?»
    chile              → falta   «No entendí «chile». ¿En qué distrito vas al cine?»
    era                → falta   «¿Qué quieres ver? Dime el nombre de la película.»
    se puede en chile  → falta   «No entendí «puede chile». ¿En qué distrito…?»
    santiago           → falta   «No entendí «santiago». ¿En qué distrito…?»

Dos fallas distintas, las dos de la misma familia —no escuchar—:

**La película se perdía al primer tropiezo.** En el turno 2 la web ya había
olvidado La Odisea, así que el turno 3 preguntó lo que la persona contestó en el
turno 1. La regla que responde a las palabras sin explicar soltaba la película
siempre; ahora la suelta **sólo si lo que no entendió se parece a un título**,
que es cuando de verdad están nombrando otra. Si no, se conserva y se dice:
«¿En qué distrito vas al cine? Te digo dónde dan La Odisea».

**Preguntar por otro país no se entendía.** Cineplanet no está sólo en el Perú y
la gente lo sabe: ese mismo día otra persona escribió «¿para qué país de
cineplanet funciona?» y recibió una lista de películas. Ahora se reconoce el
lugar de afuera y la pregunta de cobertura, y se contesta lo único honesto:
«Sólo tengo la cartelera de Cineplanet Perú». Cuando el lugar es ambiguo
—"Santiago" también es Santiago de Surco— no se nombra: se dice de qué cartelera
disponemos y se pregunta por el Perú, sin afirmar qué quiso decir.

**Y un bucle que apareció al revisar.** La pareja "…Parte 1" / "…Parte 2" ya
tiene funciones, y escribiendo el título completo devolvía «¿cuál de estas?»
para siempre: los números sueltos se descartaban antes de buscar título, para
que el "5" de "a las 5" no ganara contra "Toy Story 5". Ahora el número se
descarta **sólo si alguien más lo usó** —una hora, una fecha, una cantidad—; si
no lo usó nadie, es lo único que distingue una parte de la otra.

### Lo que trajo el primer día con los arreglos puestos

Cinco conversaciones, doce turnos, **ninguna se fue sin ver una función** (antes:
4 de 30). Un solo turno atascado, y fue culpa de la regla nueva: alguien
escribió «lindo méxico mágico» —una película que no tenemos— y se le contestó
que no tenemos cartelera de México.

Dos correcciones de eso:

- **Un país dentro de un título no es un destino.** El nombre de lugar sólo
  cuenta si va detrás de una preposición («en chile») o si es todo lo que dice
  el mensaje («chile», «santiago»).
- **Con dos cabos sueltos se pregunta.** Sin lo anterior, la frase elegía «El
  Arbol Magico» por compartir una sola palabra —«mágico»— y lo afirmaba sin
  dudar, dejando «lindo» y «méxico» sin explicar. Ahora eso baja la certeza a
  «¿te refieres a…?», que es la misma regla que ya valía para las sedes.

### La fricción más repetida: preguntar dónde, sin botones

En una semana: 30 conversaciones, 127 turnos, 56 llegaron a una función. De los
36 turnos atascados, **14 eran la misma pregunta**:

    quiero ver la odisea mañana  → «La Odisea está en 43 cines. ¿En qué distrito o provincia estás?»
    Moana                        → «Moana está en 10 cines. ¿En qué distrito o provincia estás?»
    quiero ver shrek mañana      → idem

Es una pregunta correcta —sin saber dónde está la persona, ofrecer sedes es
adivinar— pero era la **única sin botones**: todas las demás ofrecen por dónde
seguir y ésta obligaba a escribir. Ahora llega con las ciudades donde esa
película sí se da, a un toque, y de ahí a la función son dos más. Igual «¿qué
películas hay?», que contestaba "dime el nombre de la película" a quien acababa
de pedir la lista: ahora pregunta la ciudad, con botones.

### Una lección aparte: las pruebas también caducan

Dos veces en el mismo día se puso roja una prueba que nadie había tocado, porque
la cartelera cambió: salió *Moana*, y *Shrek* dejó de darse en CP Ventanilla. Un
build rojo por algo que no rompimos enseña a ignorar el rojo, que es peor que no
tener pruebas.

Regla: **ninguna prueba fija un título ni una sede a mano.** Los tipeos se
fabrican sobre la cartelera del día; lo que necesite una sede la busca contra lo
que haya; y lo que de verdad dependa de un título concreto se salta solo si ese
título ya no está.

## En qué orden vale la pena atacarlo

1. **Causa 1 y 2 juntas** — es un solo cambio en la función de coincidencia y
   elimina la familia de errores más visible y más embarazosa.
2. **Causa 6** — sin pruebas automáticas, cualquier arreglo puede desandar otro.
3. **Causa 5** — barato y convierte errores invisibles en preguntas.
4. **Causa 3** — una línea por respuesta.
5. **Causa 4** — el más caro; conviene después de tener pruebas que respalden el
   refactor.

Las causas 7 y 8 ya están mayormente atendidas, pero conviene tenerlas escritas
porque vuelven cada vez que se agrega una pantalla o una integración.
