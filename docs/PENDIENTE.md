# Pendiente para la próxima actualización

Nada pendiente. Lo último (versión 1.3.1, 6 oct 2026):
- Hora con dos desplegables (hora y minutos de 5 en 5): ya no puede quedarse a medias («08:--»), que se guardaba sin hora y sin avisar.
- Crear nota pulsando en el calendario: hueco de la Semana (con la hora, pasos de 15 min), fila «⚑ Fecha límite» y «+» del día en el Mes (solo fecha), «+ Nota» en la Agenda del móvil. Pulsar un día del Mes sigue abriendo su semana.
- La app avisa si un dispositivo está conectado a un worker antiguo (`api` < 3 en `/datos` y `/estado`). Causa real del fallo de la hora: el ordenador y el iPhone de Jorge usaban el worker antiguo `proud-salad-c6ba` (misma base D1, código de la primera versión). Jorge tiene que cambiar la URL en Ajustes; después se puede borrar ese worker (pedir confirmación).
