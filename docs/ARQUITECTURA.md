# Notas de obra · descripción y arquitectura actual

Documento de partida para diseñar la versión con **varios usuarios** (dos, para empezar) que se asignan tareas entre ellos y pueden trabajar las dos personas sobre las mismas notas. Describe la app tal como está en la **versión 1.5.1** (noviembre 2026). Las instrucciones de trabajo del proyecto están en `CLAUDE.md`; lo pendiente, en `docs/PENDIENTE.md`.

---

## 1. Qué es la app

PWA de **notas y tareas de obra** para un jefe de obra (Jorge, Barcelona, no programador). Se usa en el móvil (en la obra) y en el ordenador (en la oficina).

- Notas escritas o **dictadas**: un audio puede dar varias notas. Whisper transcribe el audio, Claude lo analiza y siempre hay una pantalla de revisión antes de guardar.
- Cada nota tiene:
  - prioridad (Urgente, Alta, Normal, Baja);
  - etiquetas (obra, industrial, acción, responsable u otra);
  - un responsable;
  - fecha límite, con hora opcional;
  - aviso previo;
  - duración;
  - checklist;
  - repetición;
  - fotos.
- **Avisos push** (Web Push) a todos los dispositivos, con las acciones «Hecha» y «Posponer 10 min» desde la propia notificación.
- **Funciona sin conexión**: los cambios se guardan en el dispositivo y se envían al volver la conexión.
- Tres modos de ver las notas: **Lista** (agrupada por fecha o etiqueta), **Calendario** (semana, mes y agenda) y **Matriz** (por prioridad, arrastrando).
- Grupos filtrados guardados, responsables en la barra lateral, resumen matutino, revisión semanal guiada, PDF para reuniones, importación desde CSV, historial de cambios, papelera y archivo de informes.

Ahora mismo hay **un solo usuario**: un token compartido da acceso a todo. Los «responsables» (tabla `personas`) son solo nombres a los que se asigna una nota; **no son usuarios** y no entran en la app.

---

## 2. Piezas y dónde están

| Pieza | Tecnología | Dónde |
|---|---|---|
| App (frontend) | HTML + CSS + JS sin framework ni compilación; PWA con service worker | GitHub Pages, repositorio público `Jorgerh97/notas-obra`, publicada por `.github/workflows/pages.yml`. URL: `https://jorgerh97.github.io/notas-obra/` |
| API | Un solo Cloudflare Worker, `worker/worker.js` (~1.070 líneas) | Worker `notas-obra` en `*.workers.dev` (la URL exacta está en Ajustes de la app) |
| Base de datos | Cloudflare D1 (SQLite), `notas-obra-db`, binding `DB` | Cloudflare |
| Fotos | Cloudflare R2 `notas-obra-fotos`, binding `FOTOS`; claves `fotos/NOTA/FOTO-mini.jpg` y `-grande.jpg` | Cloudflare |
| Transcripción | Workers AI, binding `AI`, `@cf/openai/whisper-large-v3-turbo`, idioma español | Cloudflare |
| Análisis del dictado | API de Anthropic, modelo `claude-sonnet-5` (variable `MODEL` opcional), herramienta `guardar_notas` | Anthropic |
| Tareas programadas | Cron Trigger del worker cada minuto (`* * * * *`) | Cloudflare |

Secretos del worker: `ANTHROPIC_API_KEY` y `APP_TOKEN`. Variable: `ALLOWED_ORIGIN` (CORS, el dominio de GitHub Pages).

Archivos del repositorio:

```
app/       index.html, app.js (~2.900 líneas), app.css, sw.js, manifest.json, icons/, fonts/ (Barlow)
worker/    worker.js
test/      worker.test.mjs (Miniflare + D1 real, ~96 pruebas), servidor.mjs (worker local), ui.py (Playwright)
docs/      FASE2.md, FASE3.md, PENDIENTE.md, bocetos/*.dc.html, capturas-fase1/
wrangler.toml, package.json, CLAUDE.md, LEEME.md
```

---

## 3. Autenticación y acceso (estado actual)

- Todas las rutas exigen la cabecera `Authorization: Bearer APP_TOKEN`. Es **un único token compartido**: quien lo tiene ve y cambia todo.
- Cada dispositivo envía `X-Dispositivo: <nombre>`, que solo sirve para el historial de cambios. No identifica a ninguna persona.
- El token, la URL del worker y el nombre del dispositivo se escriben en Ajustes y se guardan en IndexedDB.
- En el worker existe la constante `USUARIO = 'yo'`. Las consultas de `notas`, `etiquetas`, `personas` y `vistas` filtran por `usuario_id = USUARIO`.
- CORS: solo se admite el origen `ALLOWED_ORIGIN`.

---

## 4. Modelo de datos (D1)

El worker crea las tablas él mismo (`ensureSchema`). Las columnas nuevas se añaden con un `ALTER TABLE ... ADD COLUMN` protegido (`COLUMNAS_NUEVAS`, comprobando antes con `PRAGMA table_info`). **Regla: solo se añaden columnas o tablas, nunca se borran.** La base de producción tiene datos reales.

### `notas`
| Columna | Uso |
|---|---|
| `id` TEXT PK | UUID generado en el cliente (permite crear notas sin conexión; `POST /notas` es idempotente por id) |
| `usuario_id` | Siempre `'yo'` |
| `titulo`, `cuerpo` | Texto; el cuerpo puede llevar `#etiquetas` escritas |
| `prioridad` | `critica` (se muestra como «Urgente»), `alta`, `normal`, `baja` |
| `estado` | `activa`, `realizada`, `papelera` |
| `persona_id` | Responsable (FK a `personas`, sin restricción) |
| `fecha_limite` 'AAAA-MM-DD', `hora_limite` 'HH:MM' | Plazo |
| `aviso_unidad` (h/d/s), `aviso_cant` | Aviso previo: 1-12 horas, 1-7 días o 1-4 semanas |
| `alarma`, `alarma_enviada` | Próximo aviso pendiente, calculado por el worker |
| `subir_critica` | 1 = pasa a Urgente cuando falten menos de 24 h; `prio_antes` guarda la prioridad anterior |
| `duracion` | Minutos (para el calendario) |
| `checklist` | JSON `[{t, hecho}]` |
| `repetir`, `serie` | Repetición (laborables, semanal, quincenal, mensual); la siguiente se crea con id `serie_fecha` al marcar la anterior como realizada |
| `fotos` | JSON con los ids de las fotos en R2 (no sube la `version`) |
| `origen`, `origen_ref`, `transcripcion` | `manual`, `voz` o `csv`, con su referencia |
| `creada`, `actualizada`, `realizada_en`, `eliminada_en`, `borrar_en` | Fechas ISO |
| `aviso30`, `aviso7` | Avisos antes del borrado automático |
| `version` | Entero que sube en cada cambio; sirve para detectar conflictos |

### El resto
| Tabla | Columnas clave | Nota |
|---|---|---|
| `etiquetas` | `id, usuario_id, nombre, tipo, alias, cerrada, cerrada_en` | Tipos: obra, industrial, accion, responsable, otra. Nombre único sin distinguir mayúsculas ni acentos. Cerrar una obra archiva un informe |
| `nota_etiquetas` | `nota_id, etiqueta_id` | N a N |
| `personas` | `id, usuario_id, nombre, cargo` | Responsables: **solo nombres**, no cuentas |
| `vistas` | `id, usuario_id, nombre, filtro (JSON), orden` | Grupos filtrados de la barra lateral |
| `cambios` | `nota_id, fecha, dispositivo, accion, antes (JSON)` | Historial de 90 días. **Sin `usuario_id`** |
| `suscripciones` | `id, endpoint, p256dh, auth, nombre, plataforma, activo` | Dispositivos con push. **Sin `usuario_id`**: los avisos van a todos |
| `config` | `clave, valor` | Ajustes compartidos y claves VAPID. **Global** |
| `archivos` | `id, titulo, motivo, creado, notas, html` | Informes HTML archivados. **Sin `usuario_id`** |

---

## 5. API del worker

Todas las rutas usan `Authorization: Bearer APP_TOKEN` y responden JSON.

| Ruta | Qué hace |
|---|---|
| `GET /estado` | Comprueba la configuración. Devuelve `api` (versión de la API, ahora 3) |
| `GET /datos` | **Todo** de una vez: notas, etiquetas, personas, vistas, config, `ahora`, `api` |
| `POST /notas` | Crea (idempotente por id) |
| `PUT /notas/:id` | Modifica con `base_version`. Si no coincide → 409 `{conflicto, servidor}`; `forzar: true` impone la versión del dispositivo |
| `DELETE /notas/:id` | Borrado definitivo (solo desde la papelera) |
| `POST /notas/:id/alarma` | `hecha` o `posponer` (desde la notificación) |
| `POST /notas/conservar`, `POST /papelera/vaciar` | Retención |
| `/notas/:id/fotos/:foto/:tipo` | Subir y ver fotos (R2) |
| `POST/PUT/DELETE /etiquetas`, `/personas`, `/vistas` | CRUD; `PUT /vistas-orden` |
| `PUT /config` | Solo las claves de `CONFIG_PUBLICA` (día de revisión, horario del calendario, resumen matutino) |
| `POST /transcribir` | Audio binario → texto (Whisper) |
| `POST /analizar` | Texto → notas propuestas (Claude, herramienta `guardar_notas`). Solo usa las etiquetas y personas que ya existen, y propone las nuevas aparte |
| `GET /push/clave`, `POST /push/suscribir`, `GET/PUT/DELETE /dispositivos`, `POST /push/prueba` | Push |
| `GET /archivos`, `GET/DELETE /archivos/:id` | Informes archivados |
| `GET /exportar` | Copia completa en JSON |

---

## 6. Sincronización y funcionamiento sin conexión

- La app guarda todo en **IndexedDB** (`notas-app`, almacén `kv`: `config`, `datos`, `outbox`, `audios`, `audio:ID`, `ui`, `fotos-pend`).
- Cada cambio se aplica primero en local y se mete en la cola **`outbox`** (`encolar()`). Varios PUT seguidos de la misma nota se fusionan conservando la primera `base_version`.
- `sincronizar()` se ejecuta cada 60 s si la app está visible, al recuperar la conexión y al volver a la app:
  1. `flush()` envía la cola;
  2. sube las fotos pendientes;
  3. si la cola queda vacía, pide `GET /datos` y **sustituye todos los datos locales**.
- Los conflictos se resuelven **por nota entera** gracias a `version`. Ante un 409, se abre una pantalla para elegir «la mía» o «la del servidor». No hay fusión campo a campo.
- **No hay tiempo real**: otro dispositivo ve los cambios en el siguiente ciclo, hasta 60 s después.
- El service worker (`sw.js`) guarda en caché los archivos de la app (`notas-vX.Y.Z`), recibe los push y gestiona las acciones de las notificaciones.

---

## 7. Avisos y tareas programadas (cron cada minuto)

- **Avisos**: envía push de las notas cuya `alarma` ha vencido y calcula el siguiente aviso. Con hora límite se avisa a esa hora; el aviso previo, sin hora, suena a las 8:00 (hora de Madrid).
- **Cada 15 min**: pasa a Urgente las notas con `subir_critica = 1` cuya fecha límite cae en menos de 24 h.
- **Resumen matutino** (configurable, 7:00 de lunes a viernes por defecto).
- **Una vez al día** (a partir de las 3:00 de Madrid):
  - purga la papelera (30 días);
  - archiva y borra las realizadas caducadas (un año, salvo las de obras abiertas);
  - avisa a 30 y a 7 días del borrado;
  - limpia el historial (90 días).
- **Push**: Web Push implementado a mano (VAPID ES256 guardada en `config`, cifrado aes128gcm). Cada aviso se envía a **todas** las suscripciones activas. Los mensajes «cerrar» no se mandan a Apple.

---

## 8. Frontend (`app/app.js`)

- Estado global `S` (`notas`, `etiquetas`, `personas`, `vistas`, `ui`, `outbox`, `ed` = borrador del editor, `dic` = dictado o importación).
- Se pinta con plantillas de texto:
  - `renderBase()` pinta la pantalla principal;
  - `renderOverlay()` pinta las páginas por ruta (`#/nota/ID`, `#/dictado`, `#/importar`, `#/historial`, `#/ajustes`, `#/revision`, `#/filtros`, `#/conflicto`, `#/menu`, `#/resumen`).
- Eventos por delegación: `data-act` lleva al objeto `ACT`; los arrastres van por Pointer Events (`SOLTAR`: prioridad, calendario, responsable, orden de grupos).
- Corte móvil / ordenador en 900 px. Paleta Voracys y letra Barlow (ver `CLAUDE.md`).
- Cada cambio en `app/` exige subir `VERSION` (app.js) y `CACHE` (sw.js).

---

## 9. Lo que hoy supone «un solo usuario»

Esto es lo que habría que cambiar para tener dos usuarios:

1. **Un token compartido** en lugar de una identidad por persona. No se sabe quién hace cada cosa, solo desde qué dispositivo.
2. **`USUARIO = 'yo'` fijo** en el worker. Todo lo de `notas`, `etiquetas`, `personas` y `vistas` es de «yo».
3. **Responsable = nombre de la tabla `personas`**, no un usuario con acceso. No hay forma de que el responsable vea la nota.
4. **`suscripciones` sin dueño**: cada aviso va a todos los dispositivos registrados.
5. **`config`, `cambios` y `archivos` sin dueño**: los ajustes (resumen, revisión semanal, calendario) son globales y el historial no guarda quién hizo el cambio.
6. **`GET /datos` devuelve todo**: no hay permisos ni filtrado por persona.
7. **Conflictos por nota entera**: con dos personas editando la misma nota (por ejemplo, cada una marcando partes del checklist) habrá más 409.
8. **Sin tiempo real**: el otro usuario ve los cambios con hasta 60 s de retraso.
9. **El dictado** solo conoce las etiquetas y personas de «yo».
10. **Retención y archivos**: el borrado de realizadas y el cierre de obras son globales.

---

## 10. Condiciones para la nueva arquitectura

- **No perder datos**: la base de producción tiene notas reales. Solo se pueden añadir columnas o tablas; las notas actuales pasan a ser de Jorge.
- **Seguir funcionando sin conexión** y con la cola de cambios.
- **Coste bajo**: cuenta de Cloudflare con plan gratuito o muy barato; mantener D1, R2, Workers AI y el worker único si es posible.
- **Sin framework ni compilación** en el frontend, salvo que el cambio lo justifique claramente.
- **Simple de mantener y de instalar** para un usuario no programador. Los secretos se guardan solo con `wrangler secret put` y nunca se escriben en el chat.
- **Pruebas**: `npm test` (Miniflare). Cada cambio del worker lleva pruebas nuevas.
- Interfaz en castellano, con la misma paleta y los mismos patrones.

## 11. Preguntas para decidir en el diseño

- **Inicio de sesión**: ¿un token por usuario, enlace por correo, código de un solo uso, Cloudflare Access…? ¿Cómo se da de alta al segundo usuario?
- **Qué se comparte**: ¿cada uno tiene sus notas privadas y además notas compartidas? ¿Se comparten las etiquetas y obras, o cada uno tiene las suyas?
- **Asignar**: ¿el responsable pasa a ser un usuario (con `personas` para quien no tiene cuenta)? ¿Puede el asignado cambiar la prioridad o la fecha, o solo marcarla como hecha y comentar?
- **Interactuar**: ¿comentarios en la nota, checklist compartido, aceptar o rechazar la tarea, aviso al otro cuando se completa?
- **Avisos**: ¿a quién se avisa (al creador, al asignado o a los dos)? Habría que vincular las suscripciones a un usuario.
- **Conflictos**: ¿fusión por campo, o mantener la elección por nota?
- **Inmediatez**: ¿bastan 60 s o hace falta tiempo real (Durable Objects o WebSockets)?
- **Ajustes**: ¿cuáles pasan a ser de cada usuario (resumen matutino, revisión semanal, calendario, grupos filtrados)?
- **Historial**: guardar quién hizo cada cambio.
- **Migración**: cómo pasar de `usuario_id = 'yo'` al usuario real de Jorge sin cortar el servicio a los dispositivos que ya usan el token actual.
