# Pendiente para la próxima actualización

Propuesto a Jorge y sin decidir: no hacer nada hasta que él lo pida.

## Versión multiusuario (fase 4), en la rama `fase4-multiusuario` — sin publicar en producción
- Fase 0 (18 nov 2026): entorno `--env dev` (worker `notas-obra-dev`, D1 `notas-obra-dev-db`, R2 `notas-obra-fotos-dev`, sin cron), copia de producción fuera del repositorio y `test/migracion.test.mjs`.
- Fase 1 (18 nov 2026), solo en el worker: tabla `usuarios` (token personal, solo se guarda su SHA-256), el `APP_TOKEN` es el usuario `yo` (administrador). Cada petición lleva su usuario (`env.U`) y todo se filtra por él: notas, etiquetas, personas, grupos, ajustes (tabla nueva `config_usuario`, con copia de los de `config`), dispositivos, archivos e historial (columna `usuario_id`, lo existente queda como `yo`). Rutas `GET /yo` y, solo para el administrador, `GET|POST /usuarios`, `PUT /usuarios/:id`, `POST /usuarios/:id/token`. Pruebas: `test/usuarios.test.mjs` y migración desde el esquema real de producción (`test/esquema-fase0.mjs`, sin datos).
- La app no cambia en la Fase 1 (cada usuario pone su token en Ajustes).
- Fase 2 (18 nov 2026): columna `usuarios.puede_dictar` (por defecto 0). El principal puede siempre (`puedeDictar`, aunque su fila tenga 0); al resto se le da o quita con `PUT /usuarios/:id { puede_dictar }` o al darlo de alta. Sin permiso, `/transcribir` y `/analizar` responden 403 `{ sin_permiso: 'dictar' }` antes de gastar nada. App 1.6.0: `/datos` trae `usuario` (se guarda en IndexedDB); sin permiso se ocultan los botones Dictar y el aviso de audios pendientes, y `#/dictado` (también el acceso directo del icono) vuelve al inicio con un aviso. Con un worker sin usuarios (producción actual) todo sigue igual.
- Fase 3 (18 nov 2026): notas compartidas por responsables, según `docs/FASE3-COMPARTIR.md`. Worker: `nota_responsables` (usuarios y personas; migración desde `persona_id`), `notas.realizada_por`, `personas.usuario_vinculado` (solo el administrador), visibilidad `VISIBLE` (dueño o responsable), responsables pueden todo menos papelera y borrar, etiquetas y personas comunes (borrar o cerrar: quien las creó o el administrador), avisos al asignar y al dar por hecha, avisos de fecha a todos los participantes, `GET /registro`. App 1.7.0: varios responsables en el editor (👤 = usuario de la app), «👥» y «de X» en las notas compartidas, «Creada por / Hecha por», sin «Eliminar» en notas ajenas y pantalla «Tareas hechas compartidas» (`#/registro`) con filtros por usuario, obra y fechas, CSV y PDF.
- Fase 3, ajustes (18 nov 2026, app 1.7.1): «Responsables» de la barra lateral, chips del móvil y filtros mezclan usuarios de la app («Yo» primero, solo si hay más de un usuario) y personas sin cuenta. Clave `u:ID` para usuarios y el id para personas (los grupos guardados siguen valiendo); una persona vinculada cuenta como su usuario y no sale aparte. Arrastrar una nota a un usuario lo añade como responsable. Traspaso manual del administrador en Ajustes → Responsables → Editar: `POST /personas/:id/traspasar` (quita la persona de sus notas, pone al usuario, la vincula, deja historial y un único aviso). El resumen matutino cuenta también las notas compartidas asignadas (prueba en `test/usuarios.test.mjs`).

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

## Hecho en la versión 1.5.3 (18 nov 2026)
- Fechas no vencidas como «26/11 17:30» o «26/11» (`diaNum`), en la app entera (antes «⚑ vie, 20 nov», «hoy», «mañana»). Vencidas, igual que en la 1.5.2: «12 nov».
- Lista y Matriz en ordenador y tablet: columnas de etiquetas estrechas (90-100 px, cortadas con «…»; en la Matriz, 80 px) y fecha de ancho fijo (76-80 px). Los iconos de checklist, aviso previo, repetición y fotos van detrás del título (`.n-extra-tit`; en la Matriz, `cuandoCorto().ic`) y no ocupan columna. En el móvil siguen en la línea de abajo (`.n-extra`).
- Con esto, la Matriz en ordenador ya deja sitio a la descripción (315 px en lugar de 185 a 1440 px).

## Hecho en la versión 1.5.2 (18 nov 2026)
- Nota vencida: solo la fecha, «12 nov» (`diaMes`), sin «venció» ni hora, en rojo y negrita (Lista, Matriz y Calendario). El PDF para reunión sigue poniendo «Venció».
- Tablet en horizontal (900-1199 px): en la Lista, título y descripción en hasta 3 líneas y la fecha encima de las etiquetas en una columna estrecha; en la Matriz, sin etiquetas y con el texto en hasta 3 líneas. Tablet en vertical (600-899 px): la Matriz muestra la descripción en una segunda línea.
- Arreglo: en tablet la barra superior se salía por la derecha (el botón «Nueva nota» quedaba cortado).
- Jorge descartó cambiar el tipo de letra (bocetos en https://claude.ai/artifact/ULs1wjzaMWTEU8jTR3v2P6).

## Hecho en la versión 1.5.1 (6 nov 2026)
- Al abrir una nota nueva, el cursor queda en el título (`S.ed.enfocar`, solo al abrir; no en notas existentes ni al repintar). En iPhone el teclado podría no abrirse solo: falta probarlo en el móvil de Jorge.

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
