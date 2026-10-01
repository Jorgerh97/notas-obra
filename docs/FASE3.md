# Fase 3 · Checklists, notas recurrentes, PDF para reunión y fotos

Lee antes `CLAUDE.md`. Referencias: boceto `NuevaNota.dc.html` (secciones Repetir, Checklist y Fotos), `Escritorio.dc.html` y `Filtros.dc.html` (botón «PDF para reunión»).

**Fuera de esta fase** (decidido con Jorge el 2 oct 2026): pasar notas a borrador de Gmail (el botón «Enviar por correo» del boceto no se hace) y la conexión con la app «Visitas de obra».

Trabaja por partes y enseña a Jorge cada una funcionando en local antes de seguir:
1. Checklists → 2. Notas recurrentes → 3. PDF para reunión → 4. Fotos (R2).

Cambios de esquema como siempre: solo `ALTER TABLE ... ADD COLUMN` (lista `COLUMNAS_NUEVAS` del worker). Versión final **1.3.0**.

## 1. Checklists
- Columna `checklist` (TEXT, JSON `[{ "t": "Industrial 1", "hecho": false }]`, máx. 50 puntos de 200 caracteres). El worker la valida en `limpiarCampos`.
- Editor: sección «Checklist» como en el boceto: casilla + texto por punto (los hechos tachados), «+ Añadir punto», quitar punto. Marcar un punto no repinta el formulario.
- Lista, Matriz y Agenda: «Checklist 1/3» junto a la fecha.
- Dictado: Claude puede devolver `checklist` (lista de textos) cuando se enumeran pasos o elementos («pedir oferta a tres industriales: A, B y C»). Se muestra y edita en la revisión.
- PDF de la lista e informes archivados: los puntos con ☐ / ☑.

## 2. Notas recurrentes
- Columnas `repetir` (TEXT: `''`, `laborables`, `semanal`, `quincenal`, `mensual`) y `serie` (id de la primera nota de la serie).
- Editor: «Repetir» con «No se repite · Cada día laborable · Cada semana · Cada 2 semanas · Cada mes». Necesita fecha límite (si no hay, se toma hoy al elegir repetición).
- **Al marcar realizada** una nota recurrente se crea la siguiente: misma nota con la fecha avanzada (misma hora, duración, aviso previo, etiquetas, persona y prioridad; checklist desmarcado). Mensual: mismo día del mes siguiente (o el último día si no existe).
- La siguiente tiene id determinista `serie + '_' + fecha` para que la cree igual la app (sin conexión), el worker (botón «Hecha» del aviso) o dos dispositivos a la vez sin duplicarse (`POST /notas` es idempotente).
- Deshacer «realizada» quita la siguiente si aún no se ha tocado.
- Indicador ↻ en la Lista, la Matriz y el Calendario. Solo existe la próxima repetición (no se dibujan las futuras).

## 3. PDF para reunión
- Botón «PDF para reunión» en la cabecera de la Lista (sustituye a «PDF de la lista»), en Filtros y en el menú del móvil.
- Documento para imprimir o guardar como PDF con las notas que se están viendo (filtro o grupo): cabecera «Reunión · Mallorca 245 · jueves 2 de octubre», casillas «Asistentes» y «Lugar»; notas agrupadas por obra y ordenadas por prioridad; columnas Prioridad, Nota (con checklist), Responsable, Fecha límite y una columna vacía «Acuerdos» para escribir a mano; al final un recuadro de «Otros temas».
- Paleta Voracys en blanco y negro legible.

## 4. Fotos (Cloudflare R2)
- **Antes** Jorge activa R2 en el panel de Cloudflare (pide tarjeta; gratis hasta 10 GB). Después `npx wrangler r2 bucket create notas-obra-fotos` y binding `FOTOS` en `wrangler.toml`.
- Columna `fotos` (TEXT, JSON `[{ "id", "ancho", "alto", "creada" }]`, máx. 12 por nota).
- La app reduce cada foto antes de subirla (lado mayor 1600 px, JPEG 0,8) y crea una miniatura (400 px). Rutas del worker: `POST /notas/:id/fotos` (binario), `GET /fotos/:id` y `GET /fotos/:id/mini` (con el token: la app las pide con `fetch` y las muestra como blob), `DELETE /notas/:id/fotos/:foto`.
- Sin conexión: las fotos esperan en IndexedDB (`foto:ID`) y se suben al volver la cobertura, como los audios.
- Editor: rejilla de miniaturas con «+ Foto» (cámara o galería), ver en grande y quitar. «📷 2» en la Lista.
- Al borrar definitivamente una nota se borran sus fotos de R2. Los informes archivados indican cuántas fotos tenía.

## Criterios para dar la fase por terminada
- `npm test` pasa con pruebas nuevas: checklist (validación), recurrencia (fechas, id determinista, idempotencia, «Hecha» desde el aviso), fotos con R2 simulado (subir, leer, borrar, borrado con la nota).
- Recorrido en local en 390 px y 1440 px, modo claro y oscuro, sin errores en consola.
- `VERSION` y `CACHE` subidos (1.3.0). Publicar solo con la confirmación de Jorge.
