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
