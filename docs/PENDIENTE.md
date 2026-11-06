# Pendiente para la próxima actualización

Propuesto a Jorge y sin decidir: no hacer nada hasta que él lo pida.

## Mejorar la transcripción con ruido de fondo (hablado el 3 nov 2026)
- Jorge dice que a veces, con ruido, «no se puede analizar». Falta que pase el texto exacto del mensaje.
- Hoy: `noiseSuppression` y `echoCancellation` en el micro, 32 kbps, Whisper con `vad_filter` e `initial_prompt` (solo etiquetas).
- Propuesta recomendada:
  1. Subir a 64 kbps, con `autoGainControl` y un solo canal.
  2. `initial_prompt` con responsables y vocabulario de obra (encofrado, forjado, ferralla, replanteo, hormigonado…).
  3. Si el texto sale vacío o casi vacío, reintentar sin `vad_filter`.
  4. En la revisión, poder corregir lo transcrito y pulsar «Volver a analizar».
- Solo si no basta: reconocedor de pago (OpenAI o Deepgram), que pide otra cuenta y otra clave.

## Dictar sin abrir la app (hablado el 25 oct 2026)
- CarPlay y Android Auto no son posibles: solo admiten apps nativas de la tienda.
- iPhone: Atajo de Siri «Nota de obra» que envía el texto a una entrada nueva del worker; Claude lo analiza y las notas se crean directamente con la marca «Por revisar», con aviso en la app. El token se escribe en el Atajo, en el iPhone, nunca en el chat. Un Atajo que solo abra la URL no sirve: abre Safari, no la app instalada.
- Android: `shortcuts` en el manifest («Dictar» y «Nueva nota», al mantener pulsado el icono; «Dictar» empieza a grabar al abrir) y `share_target` (Compartir → Notas de obra). «Ok Google, abre Notas de obra» solo abre la app. HTTP Shortcuts solo como último recurso.
- Jorge aún no ha dicho si hacerlo ni cuál.

## Tareas de Jorge por confirmar
- Que el ordenador y el iPhone usan ya la URL del worker nuevo.
- Si se borra el worker antiguo `proud-salad-c6ba` (solo con su confirmación y comprobando que nadie lo usa).
- Si ha quitado la clave antigua de Anthropic de la web y de `Anotaciones.txt`. La clave nueva se puso el 3 nov 2026.

## Hecho en la versión 1.5.0 (13 oct 2026)
- Importar notas desde CSV: página `#/importar` (Ajustes → Importar notas, y menú del móvil) con «Descargar plantilla» (`plantillaCsv`, «;» y BOM UTF-8) y «Elegir archivo CSV». `leerCsv` detecta «;» o «,», comillas y saltos de línea; UTF-8 o Windows-1252. `propuestasCsv` reconoce las columnas por su nombre (o el orden de la plantilla si no hay cabecera), máx. 500 filas.
- Revisión con la pantalla del dictado (`S.dic.csv`): avisos por fila en naranja (fecha/hora/aviso/duración/repetir/prioridad mal escritos), responsables y etiquetas nuevos con Crear / Descartar (la decisión vale para todas las filas). Guardado con `crearNotaLocal`, origen `csv` (añadido a la lista del worker).

## Hecho en la versión 1.4.1 (13 oct 2026)
- Arreglo: desde la 1.4.0 el fondo de todas las ventanas lleva `data-act="fondo"` y el clic de cualquier cosa de dentro sin `data-act` propio (casillas como «Subir a Urgente…» o las del checklist, el botón «+ Foto») caía en él y el `preventDefault` lo anulaba. Ahora el fondo solo cuenta si se pulsa el propio fondo.

## Hecho en la versión 1.4.0 (8 oct 2026)
- Grupos filtrados unificados: el grupo (o responsable) elegido en la barra lateral se aplica a Lista, Calendario y Matriz y se mantiene al cambiar de modo. Se quitó el filtro aparte `S.ui.grupoVista`; `notasDeGrupo` usa `S.ui.filtro`. En el móvil, el desplegable de grupo de Matriz/Calendario es el mismo filtro (`aplicarVista`).
- Apartado «Responsables» en la barra lateral (son las personas, `persona_id`): pulsar uno filtra sus notas; «+ Añadir»; contador de pendientes. Asignar: arrastrando cualquier nota (Lista, Matriz o Calendario) encima de un responsable (`SOLTAR.per`, con Deshacer) o con los botones «Responsable» del editor (con «+ Nuevo», que se asigna al crearlo). En el móvil, chips de responsables en la Lista. Una nota nueva hereda el responsable del filtro.
- Ordenar los grupos filtrados arrastrándolos en la barra lateral (`SOLTAR.grupo` → `PUT /vistas-orden`).
- Casilla para dar por realizada desde el Calendario (`.cal-tick` en Semana, fila ⚑, Mes y Agenda del móvil). En las realizadas en gris aparece marcada y al pulsarla vuelve a pendiente (`ACT.reabrir`).
- Cerrar pulsando fuera (`cerrarFuera`): nota (guarda los cambios; nota nueva vacía se descarta; sin título avisa), filtros, menú, historial y resumen. Ajustes, dictado, revisión y conflictos solo con su botón. No se cierra si el clic empezó dentro.
- Calendario: líneas de hora de 2 px y más oscuras, media hora visible, separación de días más marcada (`--cal-dia`), en claro y oscuro. Letra de las notas del calendario 11,5 px y más fina.
- Hora por voz: instrucciones a Claude con más ejemplos («y media», «menos cuarto», «a mediodía», «a primera hora»…); el worker normaliza «9:30», «9.30» o «9» y, si hay hora sin día, pone hoy o mañana (`fechaHoraDictado`). Recordar a Jorge que el ordenador y el iPhone deben usar el worker nuevo.

## Hecho en la versión 1.3.1 (6 oct 2026)
- Hora con dos desplegables (hora y minutos de 5 en 5): ya no puede quedarse a medias («08:--»), que se guardaba sin hora y sin avisar.
- Crear nota pulsando en el calendario: hueco de la Semana (con la hora, pasos de 15 min), fila «⚑ Fecha límite» y «+» del día en el Mes (solo fecha), «+ Nota» en la Agenda del móvil. Pulsar un día del Mes sigue abriendo su semana.
- La app avisa si un dispositivo está conectado a un worker antiguo (`api` < 3 en `/datos` y `/estado`). Causa real del fallo de la hora: el ordenador y el iPhone de Jorge usaban el worker antiguo `proud-salad-c6ba` (misma base D1, código de la primera versión). Jorge tiene que cambiar la URL en Ajustes; después se puede borrar ese worker (pedir confirmación).
