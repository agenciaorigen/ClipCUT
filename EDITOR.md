# ClipCreate Editor — v5.0 (página de Color y herramientas pro)

Editor de video multipista que corre entero en el navegador. Está en el mismo repo que ClipCreate:

| Archivo | Qué es |
|---|---|
| `index.html` | ClipCreate (clips inteligentes). Desde v8.6 tiene el botón **Abrir en el editor** y el enlace **Editor** arriba. |
| `editor.html` | La pantalla del editor (diseño y estilos). |
| `editor.js` | Toda la lógica del editor. |
| `store.js` | Guarda proyectos y archivos en el navegador (IndexedDB). Lo usan las dos páginas. |
| `audio.js` | «Mejorar voz»: perfiles, análisis de nivel y ruido, la cadena de procesamiento. |
| `subs.js` | Subtítulos: transcripción (servidor o compu), tiempos por palabra, SRT y VTT. |
| `assets.js` | Biblioteca propia: efectos de sonido, música, gráficos y LUTs generados por ClipCreate. |
| `gl.js` | Color profesional con la placa de video (WebGL2): luces, sombras, blancos, negros, vibrance y LUTs. |
| `smart.js` | Silencios, Clips inteligentes con DeepSeek, seguir a quien habla, sincronizar cámaras y velocidad sin cambiar el tono. |

No hay que instalar ni compilar nada: se sube a GitHub y GitHub Pages lo publica igual que antes.

## Página de Color (v5.0)

Arriba, en el medio, hay dos botones: **Editar** y **Color**. La página de Color es como una sala de color:

- **Tira de clips** con miniatura, número y código de tiempo. El punto naranja marca los que ya tienen color. El clip elegido sigue al cursor.
- **Ruedas Sombras (Lift), Medios (Gamma), Luces (Gain) y Todo (Offset)**: el disco cambia el color (se arrastra el punto; con Shift, más fino; con el teclado, flechas y Supr para volver al centro; doble clic lo centra) y la barra de abajo cambia el brillo.
- **Curvas** Y (brillo), R, G y B con el histograma de la imagen atrás: clic agrega un punto, se arrastra, doble clic lo saca. También hay formas listas (curva S suave o fuerte, mate, más claro, más oscuro, recta).
- **Ajustes primarios**: exposición, contraste, saturación, vibrance, temperatura, tinte, matiz, luces, sombras y viñeta. Doble clic vuelve a cero.
- **Scopes**: Desfile RGB, Forma de onda, Vectorscopio (con los colores de referencia y la línea de piel) e Histograma, de la imagen que se ve.
- **Galería de stills**: guarda el color de un clip con una foto para aplicarlo a otro o a todos. Queda en este navegador y sirve en cualquier proyecto.
- **Ver original**, **Restablecer**, **Igual al anterior**, **Usar en todos** y el **LUT** con su intensidad.
- Todo se puede deshacer y sale igual en la exportación.

## Herramientas de edición pro (v5.0)

- **Borrar y cerrar el hueco** (ripple): Shift+Supr o el botón de la papelera con flecha.
- **Entrada y salida** (I y O) marcan un tramo: **Extraer** lo saca y corre lo que sigue; **Levantar** lo saca y deja el hueco. Alt+X borra las marcas.
- **Cuchilla en todas las pistas**: Shift+S, o Shift+clic con la cuchilla.
- **Varios clips a la vez**: Shift o Ctrl+clic, arrastrar un recuadro en una parte vacía, o Ctrl+A. Se mueven juntos, se borran juntos y «Pegar ajustes» va para todos.
- **Marcadores** (M) en la regla, con nota y lista en el panel del proyecto. ↑ ↓ saltan de corte en corte y Shift+↑ ↓ de marcador en marcador.
- **Rampas de velocidad**: un clip puede ir acelerando o frenando (Velocidad → Hacer una rampa).
- **Recorte** y **Marcos** (mitades, tercios, principal y secundario, recuadros) para pantalla dividida e imagen en imagen.
- **Final del video** (panel del proyecto): **barra de progreso** arriba y **placa final** con logo, texto (las palabras con @ o # en color) y duración.

## Planes

El editor lee el plan de la cuenta de ClipCreate (el mismo `mi_cuenta` del servidor):

- **Sin cuenta o Gratis**: todo funciona y los videos salen con «Hecho con ClipCreate» abajo a la derecha.
- **Básico**: sin marca, pero sin las herramientas Pro (Mejorar voz, Clips inteligentes, Seguir a quien habla y la página de Color): al tocarlas aparece el aviso con «Ver planes».
- **Pro**: todo y sin marca.
- Si no hay internet, usa el último plan que supo. Arriba a la derecha se ve el plan (o «Entrar»), que lleva a los planes en ClipCreate.

## Diseño profesional (v4.0)

- **Pantalla de sala de edición**: barra superior fina, columna de íconos (Medios, Biblioteca, Subtítulos, IA), visor centrado, inspector a la derecha, línea de tiempo abajo y barra de estado.
- **Visor con transporte**: código de tiempo HH:MM:SS:cuadros, ir al principio o al final, cuadro por cuadro, reproducir, zona segura y pantalla completa.
- **Inspector por secciones plegables** (Encuadre, Color, Transición, Sonido, Voz, Velocidad…), con etiqueta, control y valor en una línea. Se acuerda cuáles cerraste.
- **Línea de tiempo**:
  - **Miniaturas** del video a lo largo de cada clip y **forma de onda** del audio, en los clips de audio y abajo en los de video. Se preparan solas en segundo plano la primera vez y quedan guardadas.
  - Colores por tipo de pista: azul para video, verde para audio y violeta para textos y subtítulos.
  - Regla con marcas finas y cursor con cabeza.
- **Herramientas**: Selección (V), Cuchilla para cortar donde hacés clic (B) e Imán para pegar a bordes y cursor (N).
- **Alto de la línea de tiempo ajustable**: arrastrás el divisor o usás las flechas, y queda guardado.
- **En el celular** se acomoda en una sola columna.

## Una sola app (ClipCreate v9.1 + Editor v3.1)

- **Inicio con botones** en `index.html`: «Clips de un episodio» (el ClipCreate de siempre), «Un Reel o Short» (editor en 9:16), «Un video largo» (editor en 16:9) y «Mis proyectos».
- **Misma identidad**: el editor usa el naranja, los colores y el logo de ClipCreate. Tocar «ClipCreate» arriba lleva al inicio.
- **«Editar a fondo en el editor»** (en Descargar) abre el clip en la misma pestaña con todo lo armado en ClipCreate:
  - el encuadre de cada parte, el zoom viral y el de disimular cortes (como fotogramas clave),
  - las frases fuertes en blanco y negro, el color elegido, los subtítulos con su estilo, tamaño, altura y color,
  - el título, el invitado, el logo, los whoosh, el sonido de estudio y la descripción para publicar,
  - (v9.1) los diseños **Dividido, Trío y Spotlight** (cada franja es un clip en su pista con su recorte y su marco; suena solo la primera), **Centrado** (entero con fondo desenfocado), la **portada**, la **placa final** y la **barra de progreso**.
- **«← Volver a los clips»** en el editor vuelve a ClipCreate y recupera el episodio solo, sin elegir el archivo de nuevo. En el inicio también aparece «Seguir con «episodio»».
- No pasan al editor (todavía): la portada, el cierre, la barra de progreso y los diseños Dividido, Trío, Spotlight y Centrado (en esos casos el clip llega con el encuadre centrado).

## Qué hace la Fase 1

- **Importar** videos, audios e imágenes (botón o arrastrando a la página). Si el formato no se puede abrir, avisa.
- **Reproductor** con vista previa en tiempo real y zona segura de Reels/TikTok/Shorts.
- **Línea de tiempo multipista**: pistas de video, audio y texto; mover clips (también entre pistas), recortar bordes, imán a los bordes y al cursor, zoom.
- **Cortes**: dividir (S), duplicar (Ctrl+D), borrar (Supr), separar el audio del video.
- **Encuadre por clip**: llenar/entero, zoom, posición, rotación, opacidad.
- **Formatos**: 9:16, 16:9, 1:1 y 4:5.
- **Textos**: título, subtítulo, nombre y cargo, etiqueta de redes, frase destacada; letra, grosor, tamaño, color, contorno y caja.
- **Audio básico**: volumen (hasta 200 %), silenciar clip o pista, fundidos de entrada y salida.
- **Deshacer/rehacer** (hasta 200 pasos), **autoguardado** y **recuperación**: al volver a abrir, aparece el último proyecto.
- **Exportación real**: MP4 H.264 (o H.265, o WebM si el navegador no tiene H.264), 720p / 1080p / 4K, 24–60 cuadros, 3 calidades, tamaño estimado, progreso real y cancelar. También **solo audio en WAV**.
- **Desde ClipCreate**: «Abrir en el editor» manda el clip con sus partes, el encuadre de cada parte, los subtítulos y el título.

## Qué suma la Fase 2

- **Mejorar voz** (un botón por clip, o «Mejorar todas las voces» en el proyecto): mide el nivel de la voz y el ruido de fondo de cada archivo y aplica una cadena de filtro de graves, sacar zumbido de 50 Hz, compuerta de ruido entre frases, ecualizador para voz (calidez, menos «voz de caja», presencia, aire, eses), nivel parejo, compresor y limitador.
  - Perfiles **Podcast**, **Entrevista** y **Voz viral**, con controles a mano: reducción de ruido, claridad, nivelado y zumbido.
  - **Escuchar original / mejorado** para comparar. Lo que se escucha es exactamente lo que sale en el video.
  - Medidor de nivel con aviso de **PICO** cuando se satura; al exportar, avisa si hubo que suavizar picos.
  - En la prueba: la voz quedó en −18 dB (el nivel de los Reels) y el ruido entre frases bajó casi 7 dB respecto de la voz.
  - Límite honesto: baja el ruido *entre* frases y los zumbidos; no saca un ruido fuerte que está *encima* de la voz.
- **Subtítulos automáticos** (pestaña Subtítulos):
  - Con cuenta de ClipCreate se transcriben en el servidor (Groq, Whisper grande) con el tiempo real de cada palabra. Sin cuenta, en la compu con Whisper (no se sube nada; los tiempos de cada palabra son estimados).
  - Usa el mismo plan que ClipCreate: el mismo video no cuenta dos veces.
  - 8 estilos: palabra activa en amarillo, dinámico de redes, frases destacadas, podcast profesional, blanco con contorno, periodístico, documental y minimalista.
  - Palabras por línea, tamaño, altura y mayúsculas para todos a la vez.
  - Lista editable para corregir nombres y palabras; tocar el tiempo lleva a ese momento.
  - Importar y exportar SRT y VTT (también desde Exportar).
- **Transiciones** (entrada de cada clip, desde el anterior de la misma pista): disolución cruzada, fundido a negro, flash blanco, zoom, deslizar, barrido, desenfoque, giro y glitch. Duración, dirección e intensidad; «Usar en todos los cortes». En la línea de tiempo se marcan con un triángulo amarillo.
- **Color por clip**: exposición, contraste, saturación, temperatura, matiz y viñeta; perfiles Podcast, Interiores, Luz cálida, Luz fría y Cinematográfico; botón para ver el original.
- **Textos con animación de entrada**: aparecer, subir, pop y máquina de escribir.

## Qué suma la v3.0 (Fases 3 y 4, más la biblioteca propia)

- **Biblioteca propia**, todo generado por ClipCreate desde cero: no hay archivos de terceros, así que se puede usar en cualquier video, también comercial.
  - **11 efectos de sonido**: whoosh, swoosh, pop, click, impacto, subida, ding, notificación, cámara, glitch y tecleo. Se escuchan con ▶ antes de agregarlos.
  - **3 bases de música**: Pulso, Ambiente e Informativo. Entran con volumen bajo y bajando solas cuando alguien habla (ducking).
  - **12 gráficos** con los colores de tu marca: flecha, círculo, subrayado, esquinas, «Suscribite», «Seguinos @», globo, destello, tilde, cruz, barra de nombre y marco.
  - **9 LUTs**: teal & naranja, película cálida, atardecer, frío nórdico, vintage, moody, vivo, blanco y negro, noche azul. Se pueden bajar como `.cube` para usarlos en otros editores.
  - Textos nuevos: emoji y pregunta al público.
- **Marca del canal**: nombre, usuario, colores y logo. «Aplicar plantilla de programa» pone el logo, la placa de entrada, el nombre del invitado, el cierre con tu usuario y los subtítulos con tu color.
- **Color profesional**: luces, sombras, blancos, negros, tinte y vibrance, LUTs propios o importados (`.cube`) con intensidad, y grano de película.
- **Editar con el texto** (pestaña IA): seleccionás palabras de la transcripción y se cortan del video (todas las pistas se acomodan solas). Tocar una palabra lleva a ese momento.
- **Quitar silencios**: busca los silencios de más de X segundos (solo en las voces, la música no cuenta), los marca en rojo y los saca dejando 0,15 s de aire.
- **Clips inteligentes**: DeepSeek lee la transcripción y propone clips con título, texto de portada, descripción con hashtags, tipo y puntaje. Los mirás con «Ver», elegís y se crean como proyectos nuevos: en vertical, con el gancho al principio, el título arriba y siguiendo a quien habla.
- **Seguir a quien habla** (reencuadre): detecta las caras, mira quién mueve la boca y mueve el encuadre con fotogramas clave (con un corte cuando cambia de persona).
- **Fotogramas clave** (◆) para posición, zoom, rotación y opacidad, y **zoom lento** a lo largo del clip.
- **Velocidad** de 0,25× a 4×: la voz mantiene su tono.
- **Congelar cuadro** (Shift+F) y **copiar y pegar ajustes** entre clips (Ctrl+Alt+C / Ctrl+Alt+V).
- **Fondo desenfocado** cuando la imagen no llena el cuadro.
- **Multicámara**: sincroniza dos cámaras (o una cámara y un grabador) comparando el sonido. Para cambiar de cámara, dividís la pista de arriba y borrás los tramos.
- **Cola de exportación**: exporta varios proyectos uno detrás del otro en la carpeta que elijas.

## Atajos

Espacio reproducir · V selección · B cuchilla (Shift+clic: todas las pistas) · N imán · S dividir (Shift+S: todas las pistas) · Supr borrar (Shift+Supr: y cerrar el hueco) · I / O entrada y salida · Alt+X borrar entrada y salida · M marcador · ↑ ↓ corte anterior o siguiente · Shift+↑ ↓ marcador · Ctrl+A todo · Shift/Ctrl+clic elegir varios · Ctrl+D duplicar · Shift+F congelar cuadro · Ctrl+Alt+C / V copiar y pegar ajustes · Ctrl+Z / Ctrl+Shift+Z deshacer/rehacer · ← → un cuadro (Shift: 1 s) · Alt+← → mover el clip · Inicio/Fin · + / − zoom · Ctrl+rueda zoom · Esc quitar selección

## Privacidad

Los videos **no se suben a ningún lado**: se procesan en la compu. La única excepción es «Generar subtítulos» con cuenta de ClipCreate: ahí se manda solo el audio comprimido al servidor (Supabase y Groq) para transcribirlo, y la pestaña lo avisa. Sin cuenta, todo queda en la compu. Los archivos quedan guardados en este navegador. Borrar un proyecto (Proyectos → Borrar) borra también sus archivos del navegador; los originales de la compu no se tocan. Si se borran los datos del navegador, se pierden los proyectos.

## Requisitos

- Chrome o Edge actualizados en una compu (exportar usa WebCodecs). Safari y Firefox pueden editar pero quizás no exportar.
- Lo ideal: 8 GB de RAM o más. Entrevistas de hasta ~40 min van bien; una hora o más funciona pero la exportación tarda (aprox. lo que dura el video, según la compu).
- En Chrome/Edge el video exportado se escribe directo al disco (te pregunta dónde guardarlo), así no se llena la memoria con videos largos.

## Dependencias y costos

- **mediabunny 1.60.0** (la misma que ya usa ClipCreate), cargada desde jsDelivr: lee y arma los MP4. Gratis.
- **Google Fonts**: Montserrat, Anton, Plus Jakarta Sans y Playfair Display. Gratis.
- **Transformers.js 3.5.1 + Whisper** (los mismos de ClipCreate) para transcribir en la compu. Gratis; la primera vez descarga el modelo (~250 MB en calidad Buena, ~80 MB en Rápida) y queda guardado.
- **Servidor de ClipCreate (Supabase + Groq)** solo para transcribir con cuenta: usa la función `transcribir` que ya existe, con los mismos límites del plan (4 horas de audio por día por usuario). El costo es el de Groq que ya tenés.
- **DeepSeek** (Clips inteligentes): a través de la función `deepseek` que ya tenés en Supabase, o con tu clave. Con los mismos límites del plan.
- **MediaPipe** (el mismo detector de caras de ClipCreate) para seguir a quien habla. Gratis; la primera vez descarga el modelo.
- Todo lo demás (voz, color, LUTs, transiciones, silencios, multicámara, exportar) es gratis y corre en la compu.

## Lo que viene (sin hacer todavía)

- Identificar quién habla en los subtítulos (Groq no lo hace; el reencuadre sí detecta quién habla por la boca).
- Cambio de cámara automático en multicámara (hoy se sincroniza solo y se corta a mano).
- Nodos de color y máscaras (ventanas) como en DaVinci: hoy hay una corrección por clip.
- Línea fina entre franjas de Dividido o Trío (en ClipCreate está; en el editor todavía no).

## Cómo se probó

**v5.0**: en Chromium con videos reales: marcadores, entrada y salida con Extraer y Levantar (y deshacer), Shift+S, borrar con ripple, Shift+clic, recuadro, mover varios juntos, Ctrl+A, barra de progreso y placa final con logo, la página de Color (ruedas con mouse y teclado, brillo, curvas, formas, los cuatro scopes, stills aplicados a todos, ver original, tira de clips, deshacer), exportar con la marca de Gratis y la pantalla del celular. «Editar a fondo» desde ClipCreate con Dividido, portada, placa final y barra. El plan de la cuenta no se pudo probar contra el servidor (desde acá no llega): probalo entrando con una cuenta Básico y otra Pro.

**v3.0**: con videos reales en Chromium se probaron:
- La biblioteca: sonidos, música y gráficos agregados y exportados.
- La marca y la plantilla, y el color con LUT, luces, sombras, grano y fotogramas clave.
- Congelar cuadro, copiar ajustes y velocidad 2×.
- Cortar una frase desde la transcripción y quitar 7 silencios (y deshacerlo).
- Clips inteligentes con una respuesta de DeepSeek simulada.
- Multicámara: encontró el corrimiento exacto de 1,3 s entre dos cámaras.
- Exportar y la cola (MP4 verificados con ffprobe).

No se pudo probar desde acá: DeepSeek de verdad y el detector de caras (no llega a esos servidores). Usan el mismo código que ClipCreate, pero probalos con un video corto.


**Fase 2**: Mejorar voz midiendo el WAV exportado antes y después; las 9 transiciones en la vista previa; estilos de subtítulos, reagrupar palabras, dividir subtítulos, exportar e importar SRT; exportar MP4 con todo junto. La transcripción con Whisper y con el servidor no se pudo correr desde el entorno de prueba (no llega a esos servidores): usa el mismo código que ya funciona en ClipCreate, pero conviene probarla primero con un episodio corto.

**Fase 1**: con videos, audios e imágenes reales en Chromium: importar, dividir, deshacer/rehacer, textos, separar audio, mover entre pistas, reproducir, exportar (se verificó el MP4 con ffprobe: H.264, 720×1280, 30 cuadros, audio estéreo 48 kHz con la mezcla correcta en cada tramo), exportar WAV, recargar la página (recupera el proyecto) y «Abrir en el editor» desde ClipCreate.
