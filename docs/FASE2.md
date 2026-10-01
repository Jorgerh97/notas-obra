# Fase 2 · Calendario, matriz, arrastres, duración y resumen matutino

Lee antes `CLAUDE.md`. Los bocetos de referencia están en `docs/bocetos/`:
`CalSemana.dc.html` (10), `CalMes.dc.html` (11), `CalAgenda.dc.html` (12), `MatrizMovil.dc.html` (13), `MatrizEscritorio.dc.html` (14), `Resumen.dc.html` (6) y `NuevaNota.dc.html` (3, campo Duración). Respeta su distribución, colores y textos; los datos de los bocetos son de ejemplo.

Trabaja por partes y enseña a Jorge cada una funcionando en local antes de seguir:
1. Duración y selector de modo → 2. Matriz → 3. Calendario semana/mes (ordenador) → 4. Agenda y mes en móvil → 5. Arrastres y estirar → 6. Resumen matutino.

## 1. Duración y selector de modo
- **Duración** (columna `duracion` ya existe en `notas` y el worker ya la acepta y Claude ya la detecta en el dictado):
  - En el editor, botones rápidos **10 min · 30 min · 1 h · 2 h · Otra…** (Otra abre un campo en minutos). **10 min por defecto** en notas nuevas; en notas antiguas sin duración se trata como 10 min.
  - En la revisión del dictado, mostrar la duración de cada nota indicando si es la de por defecto o la que Claude ha entendido («una hora con el fontanero» → 1 h). Hoy `propuestaDe()` ya guarda `duracion`; falta mostrarla y editarla.
- **Selector de modo «Lista · Calendario · Matriz»** en la cabecera de la pantalla principal, en móvil y en ordenador (ver bocetos). Se recuerda el último modo (clave `ui` de IndexedDB). Rutas sugeridas: el modo forma parte del estado, no de la ruta, para no romper `#/nota/ID` y demás.
- La Lista sigue como está (agrupar por Fecha o Etiqueta).

## 2. Matriz (bocetos 13 y 14)
- Cuatro bloques por prioridad: Crítica, Alta, Normal, Baja, con el número de notas en la cabecera de cada uno.
- **Por defecto sin filtros**, con selector «Grupo filtrado: Ninguno · ver todo» para aplicar uno de los grupos guardados (independiente del filtro de la Lista).
- Dentro de cada bloque, orden por fecha (fecha límite o alarma), las más próximas arriba; sin fecha al final.
- **Ordenador/tablet (≥ 900 px)**: zona central en **2 × 2 bloques iguales**, cada uno con su propio scroll. Cada fila: título, descripción cortada, etiquetas y fecha (atrasadas en rojo).
- **Móvil**: bloques uno debajo de otro, cada nota en una línea con **título y fecha en pequeño**; si hay más de 5, «Ver X más».
- **Arrastrar entre bloques cambia la prioridad** (solo ordenador/tablet). El bloque de destino se marca con borde naranja discontinuo y el texto «Soltar aquí para cambiar a Alta». Al soltar: aviso «“Título” pasa de Normal a Alta · Deshacer».
- Tocar una nota abre el editor; la casilla marca como realizada con Deshacer, igual que en la Lista.

## 3. Calendario en ordenador (bocetos 10 y 11)
Por defecto **sin filtros** (todas las notas activas con fecha), con selector de grupo filtrado igual que la matriz. Vistas **Semana** y **Mes**, flechas ‹ › y botón Hoy.

**Semana**
- Columnas lunes–domingo; opción «Mostrar fin de semana» (sombreado cuando se muestra).
- Rejilla horaria **7:00–19:00 por defecto**, configurable («Horario visible», guardado en ajustes compartidos `config`: `cal_inicio`, `cal_fin`). Línea por hora y otra más tenue cada media hora.
- **Notas con alarma** → bloque en su hora, alto según su duración, con el color de su prioridad, hora y duración («· 1 h 30 min»).
- **Notas con fecha límite y sin alarma** → fila superior «⚑ Fecha límite» en su día, sin ocupar horas.
- Bajo cada día: **«Libre: 9 h 30 min»** = horas del horario visible − suma de duraciones de las notas activas con hora de ese día (las realizadas no cuentan).
- **Línea naranja de «ahora»** en el día de hoy; cabecera de hoy resaltada en azul.
- **Franja roja «Atrasadas · N»** arriba con las notas cuya fecha ya pasó: «Título · venció 25 sep». Texto de ayuda: «Arrástralas a un hueco para replanificar».
- Lateral: leyenda de prioridades, «🔔 Alarma con hora · ⚑ Fecha límite», «Mostrar realizadas en gris» (tachadas y semitransparentes), horario visible y fin de semana.
- Notas que se solapan en la misma franja: repartir el ancho de la columna entre ellas.

**Mes**
- Rejilla de 5–6 semanas empezando en lunes; días de fuera del mes atenuados; hoy con borde azul.
- Cada día muestra hasta 2 notas (punto de color + hora si tiene + título) y «+N más». Pulsar «+N más» o el día abre ese día en la vista Semana.
- **Color de fondo según la carga** del día: 0, 1, 2, 3+ notas → `#FFFFFF`, `#EAF3FE`, `#CFE3FC`, `#9FC6F5` (con equivalentes en modo oscuro).
- Si hay un grupo filtrado aplicado, aviso «Mostrando solo: Mallorca 245. Los días vacíos pueden tener notas de otras obras. · Quitar grupo».

## 4. Calendario en móvil (boceto 12)
- Vistas **Agenda** y **Mes**.
- **Agenda**: tira superior de 7 días (L M X J V S D) con número de notas y fondo según carga; hoy con anillo azul; deslizar para cambiar de semana. Debajo, franja «Atrasadas · N», y la lista por días: «Hoy · mar 29», «Mañana · mié 30»… con «4 notas» y cada elemento con «🔔 9:00» o «⚑ Límite», título, prioridad y etiqueta. Días sin notas agrupados: «Sáb 3 – Dom 4 · Sin notas · hueco disponible».
- **Mes** en móvil: misma lógica que en ordenador, en celdas pequeñas con puntos de color.
- En móvil **no hay arrastres** (se cambia la fecha desde el editor).

## 5. Arrastres y estirar (ordenador y tablet)
Usa Pointer Events (un solo código para ratón y táctil). En táctil, **mantener pulsado ~400 ms** para «levantar» la nota, para no moverla al hacer scroll. Mientras se arrastra: bloque semitransparente con sombra y contorno naranja; hueco de destino marcado.
- **Semana**: soltar en otro día y hora → cambia la fecha y la hora de la alarma (con pasos de 15 min). Si la nota tenía fecha límite el mismo día que la alarma, la fecha límite se mueve también. Si la nota solo tenía fecha límite y se suelta en una hora, pasa a tener alarma a esa hora en ese día. Soltar en la fila «⚑ Fecha límite» → cambia solo el día (la alarma, si la hay, se mueve al nuevo día manteniendo la hora).
- **Mes**: soltar en otro día → cambia la fecha manteniendo la hora.
- **Atrasadas**: se pueden arrastrar desde la franja roja a cualquier hueco o día.
- **Matriz**: entre bloques cambia la prioridad (apartado 2).
- **Estirar**: asa en el borde inferior del bloque en Semana; cambia la duración en pasos de 10 min (mínimo 10 min).
- Al mover la alarma, `alarma_enviada` vuelve a 0 (ya lo hace el worker cuando cambia `alarma`) y se retira el aviso ya mostrado en otros dispositivos.
- **Siempre Deshacer**: «“Visita de la Propiedad” movida a jue 1 oct, 14:00 · Deshacer» (≈8 s). Todo pasa por `editarNotaLocal()` para que funcione sin conexión y con control de conflictos.
- (Fase 3: con notas recurrentes, preguntará si mover solo esta o todas.)

## 6. Resumen matutino (boceto 6)
- **Ajustes → Resumen matutino**: activar/desactivar, hora (por defecto 7:00) y días (por defecto lunes a viernes). Guardar en `config` (`resumen_activo`, `resumen_hora`, `resumen_dias`); añadir esas claves a `CONFIG_PUBLICA` en el worker.
- **Worker**: en la tarea de cada minuto, a la hora configurada (hora de Madrid) y una sola vez por día (`config.resumen_ultimo`), enviar un push a los dispositivos activos: título «Buenos días», cuerpo «2 críticas · 3 alarmas hoy · 2 sin tocar», `url: '#/resumen'`. Si no hay nada pendiente, no enviar. Añadir pruebas en `test/worker.test.mjs`.
- **Pantalla `#/resumen`**: fecha y hora («Martes 29 de septiembre · 7:00»), «Buenos días», tres contadores (Críticas, Alarmas hoy, Estancadas) y secciones: **Alarmas de hoy** (hora, título, obra), **Críticas** (hoy / día, título, obra · persona), **Plazos de hoy** (fecha límite hoy), **Sin tocar desde hace días** (días sin tocar, más de 10). Botón «Ir al panel». Accesible también desde el menú.

## Criterios para dar la fase por terminada
- `npm test` pasa con pruebas nuevas para el resumen matutino y la configuración.
- Recorrido en local en 390 px y 1440 px, modo claro y oscuro, sin errores en consola.
- Arrastres probados con ratón y con táctil simulado; Deshacer funciona en todos.
- Las notas creadas en la fase 1 se ven bien (sin duración → 10 min).
- `VERSION` y `CACHE` subidos (1.1.0). Publicar solo con la confirmación de Jorge.
