# Pendiente para la próxima actualización

(Nada pendiente.)

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
