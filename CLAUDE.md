# Notas de obra · instrucciones del proyecto

## Con quién trabajas
Jorge, jefe de obra de una empresa contratista en Barcelona. No es programador.
- Responde **siempre en castellano**, en lenguaje sencillo, sin jerga innecesaria.
- Antes de **publicar** (git push a main, `wrangler deploy`) o de **borrar** algo, explica en una frase qué vas a hacer y espera su confirmación.
- **Nunca** le pidas que pegue claves o tokens en el chat. Los secretos se guardan con `npx wrangler secret put NOMBRE`, que se los pide a él en la terminal. No muestres secretos en pantalla.
- Cuando termines una tarea, dile en pocas líneas qué ha cambiado y qué tiene que probar él.

## Qué es la app
PWA de notas y tareas de obra, escritas o dictadas, con prioridades, etiquetas, alarmas push y funcionamiento sin conexión. Un solo usuario por ahora, pero los datos llevan `usuario_id = 'yo'` para añadir más usuarios en el futuro.

## Arquitectura
| Pieza | Dónde | Notas |
|---|---|---|
| `app/` | GitHub Pages (repo público `notas-obra`, publicado por `.github/workflows/pages.yml`) | HTML + CSS + JS sin framework ni compilación. |
| `worker/worker.js` | Cloudflare Worker `notas-obra` (`wrangler.toml`) | API, dictado, push, tareas programadas. |
| D1 `notas-obra-db` | Cloudflare | Binding `DB`. El worker crea las tablas solo (`ensureSchema`). |
| R2 `notas-obra-fotos` | Cloudflare | Binding `FOTOS`. Fotos de las notas (`fotos/NOTA/FOTO-mini.jpg` y `-grande.jpg`). |
| Workers AI | Cloudflare | Binding `AI`. Whisper `@cf/openai/whisper-large-v3-turbo`, `language: 'es'`. |
| Claude | API de Anthropic | Modelo `claude-sonnet-5` (variable `MODEL` opcional). Solo para analizar dictados. |

Variables del worker: `ANTHROPIC_API_KEY` (secret), `APP_TOKEN` (secret), `ALLOWED_ORIGIN` (en `wrangler.toml`, `https://USUARIO.github.io` sin ruta).
Cron `* * * * *`: alarmas vencidas → push; cada 15 min sube a Crítica lo que vence en <24 h; una vez al día (≥ 3:00 hora de Madrid) purga papelera, archiva y borra realizadas caducadas, avisa a 30 y 7 días y limpia el historial de cambios.

### Worker (resumen de la API, todas con `Authorization: Bearer APP_TOKEN`)
`GET /estado`, `GET /datos`, `POST /notas` (idempotente por id), `PUT /notas/:id` (con `base_version`; 409 `{conflicto, servidor}` si no coincide; `forzar: true` para imponerla), `DELETE /notas/:id` (solo papelera), `POST /notas/:id/alarma` (`hecha` | `posponer`), `POST /notas/conservar`, `POST /papelera/vaciar`, `/etiquetas` (409 si nombre duplicado sin distinguir mayúsculas ni acentos; `cerrada: true` en una obra archiva un informe), `/personas`, `/vistas`, `PUT /vistas-orden`, `PUT /config` (claves en `CONFIG_PUBLICA`), `POST /transcribir` (audio binario), `POST /analizar` (tool `guardar_notas`), `/push/clave`, `/push/suscribir`, `/dispositivos`, `/push/prueba`, `/archivos`, `/exportar`.
Web Push implementado a mano (VAPID ES256 generada y guardada en `config`, cifrado aes128gcm). Los mensajes `cerrar` no se envían a `push.apple.com` (Safari retira el permiso si no se muestra notificación).

Tablas: `notas` (con `version`, `duracion` en minutos ya existente, `hora_limite` 'HH:MM', `aviso_unidad` h/d/s y `aviso_cant`, `alarma` = próximo aviso pendiente calculado por el worker, `borrar_en`, `aviso30/7`), `etiquetas` (`tipo`: obra, industrial, accion, responsable, otra; `alias`; `cerrada`), `nota_etiquetas`, `personas`, `vistas` (grupos filtrados, `filtro` JSON), `cambios` (90 días), `suscripciones`, `config`, `archivos` (informes HTML).
**Cambios de esquema**: solo añadir columnas o tablas, nunca borrar. Para columnas nuevas usa `ALTER TABLE ... ADD COLUMN` protegido (comprobar con `PRAGMA table_info`), porque la base de producción ya tiene datos.

### App (`app/app.js`)
- Estado global `S`; render con plantillas de texto y delegación de eventos (`data-act` → objeto `ACT`).
- `renderBase()` pinta la pantalla principal; `renderOverlay()` las páginas por ruta (`#/nota/ID`, `#/dictado`, `#/historial`, `#/ajustes`, `#/revision`, `#/filtros`, `#/conflicto`, `#/menu`). Los formularios no se repintan mientras se escribe (los `input` actualizan borradores).
- IndexedDB `notas-app`, almacén `kv`: `config`, `datos`, `outbox`, `audios`, `audio:ID`, `ui`. El service worker lee `config` para las acciones de los avisos.
- Cambios offline: cola `S.outbox` (`encolar()` fusiona PUT de la misma nota conservando `base_version`); `flush()` y `sincronizar()` cada 60 s, al volver la conexión y al volver a la app. **No guardes funciones en la cola** (IndexedDB no las serializa).
- `sw.js`: caché `notas-vX.Y.Z`, push con acciones Hecha / Posponer 10 min.
- **Cada vez que cambies archivos de `app/`**, sube la versión en `VERSION` (app.js) y en `CACHE` (sw.js) para que los dispositivos reciban la actualización (aparece el aviso «Hay una versión nueva»).

## Diseño (paleta Voracys, igual que sus otras apps)
- Colores: brand `#60A4F4`, primario `#1F5FAE`, tinta `#16324F`, secundario `#52627A`, línea `#D6E2F0`, fondo `#F4F8FD`, tinte `#EAF3FE`, naranja `#FF7B0F` (texto `#8A3D00`, tinte `#FFF1E4`), rojo `#C62828`. Modo oscuro con los tokens de `app.css`.
- Fuentes Barlow (texto) y Barlow Condensed (títulos), alojadas en `app/fonts/`.
- Prioridades: **Urgente** rojo (valor interno `critica`, no cambiarlo), **Alta** naranja, **Normal** azul, **Baja** gris. Siempre con su nombre escrito además del color.
- Botón **Dictar** naranja y **Nueva nota** azul. Vista compacta: en móvil la descripción ocupa una línea con «…»; en ordenador cada nota es una fila.
- Corte móvil / ordenador en 900 px. En ordenador, barra lateral con grupos filtrados.
- Usa las clases y tokens existentes de `app.css` antes de crear estilos nuevos. Textos de la interfaz en castellano, frases cortas.
- Bocetos acordados en `docs/bocetos/*.dc.html` (marcado y estilos de referencia; no se abren solos) y en el lienzo https://claude.ai/artifact/TQ5ToUS1SVEnq7LsgP92MY. Capturas de la fase 1 en `docs/capturas-fase1/`.

## Reglas de negocio ya implementadas (fase 1)
- Etiquetas: se escriben con `#` en el cuerpo, salen sugerencias y se convierten en chip guardado aparte (renombrar cambia en todas). Sin espacios. Alias para el dictado.
- Dictado: varias notas por audio; Claude solo usa etiquetas y personas existentes, propone nuevas (en naranja: Crear / Usar similar / Descartar); siempre hay pantalla de revisión. Audios guardados 7 días en el dispositivo y reintentables.
- Realizadas: un año; las de obras abiertas no se borran nunca; al cerrar una obra se archiva informe y las caducadas tienen 30 días; antes de borrar se archiva informe. Papelera 30 días.
- Avisos (antes «alarmas»): la fecha límite puede llevar hora; con hora se avisa siempre en ese momento. Aviso previo opcional: 1-12 horas, 1-7 días o 1-4 semanas antes; sin hora límite suena a las 8:00. Las alarmas antiguas se pasaron a hora límite (`migrarAlarmas`).
- El botón Dictar empieza a grabar al pulsarlo (sin segundo toque).
- Deshacer (≈8 s) al marcar realizada, eliminar y (fase 2) arrastrar.
- Conflictos multi-dispositivo por versión, con pantalla para elegir.
- Revisión semanal guiada (día configurable, viernes por defecto).
- Lista: agrupar por Fecha o Etiqueta; dentro de cada grupo, orden por prioridad.

## Fases
- **Fase 1**: hecha (este código).
- **Fase 2**: hecha en la versión 1.2.0 (calendario, matriz, arrastres, duración y resumen matutino → `docs/FASE2.md`). Modo Lista/Calendario/Matriz en `S.ui.modo`; arrastres con Pointer Events en el objeto `SOLTAR` (tipos `prio` y `cal`); config compartida `cal_inicio`/`cal_fin` y `resumen_activo`/`resumen_hora`/`resumen_dias`; resumen enviado por `resumenMatutino()` en el cron.
- **Fase 3**: hecha en la versión 1.3.0 (checklists, notas recurrentes, PDF para reunión y fotos en R2 → `docs/FASE3.md`). Columnas nuevas `checklist`, `repetir`, `serie`, `prio_antes`, `fotos`; la siguiente repetición se crea con id `serie_fecha` (`proximaRepeticion` en worker y app); fotos en el bucket R2 `notas-obra-fotos` (binding `FOTOS`), cola local `fotos-pend` en IndexedDB. Descartados por Jorge: nota → borrador de Gmail y conexión con «Visitas de obra».
- **1.3.1** (6 oct 2026): hora con desplegables (minutos de 5 en 5), crear nota pulsando en el calendario y aviso de worker antiguo → `docs/PENDIENTE.md`. Existe un worker antiguo `proud-salad-c6ba` con la misma base D1: no usarlo; borrarlo solo con confirmación de Jorge.
- **Aplazado**: eventos de calendario externo (se hará con las reuniones de Microsoft cuando le den acceso).

## Pruebas
- `npm install` y luego `npm test`: pruebas del worker con Miniflare (D1 real; Claude y push simulados). Deben pasar todas antes de publicar. Añade pruebas para cada cambio del worker.
- Prueba de la interfaz: `npm run worker-local` (worker en `http://localhost:8787`, token `secreto`, Claude simulado) y en otra terminal `python -m http.server 8080 --directory app`. `test/ui.py` es un recorrido con Playwright para Python; si en este equipo es más cómodo, pásalo a Playwright para Node. Revisa las capturas en móvil (390 px) y ordenador (1440 px).
- Antes de publicar, prueba también en el navegador real de Jorge (Chrome o Edge) y pídele que pruebe en su móvil lo que no se puede automatizar: micrófono, avisos push, instalación.

## Publicar
### Primera publicación (solo una vez)
1. Comprueba que hay Git, Node.js (LTS) y GitHub CLI (`gh`). Si falta `gh`, propón instalarlo con `winget install --id GitHub.cli`.
2. `npm install`, `npm test`.
3. `npx wrangler login` (se abre el navegador; Jorge acepta). `npx wrangler d1 create notas-obra-db` y copia el `database_id` en `wrangler.toml`. Si ya existiera una base con ese nombre, usa su id (`npx wrangler d1 list`).
4. `gh auth login` (navegador). Obtén el usuario con `gh api user -q .login` y pon `ALLOWED_ORIGIN = "https://usuario.github.io"` en `wrangler.toml` (en minúsculas: el navegador envía el dominio en minúsculas y el worker compara el texto exacto).
5. Secretos: `npx wrangler secret put ANTHROPIC_API_KEY` y `npx wrangler secret put APP_TOKEN`. Explícale que los escriba él en la terminal; el token es una contraseña que se inventa y que luego pondrá en Ajustes de la app.
6. `npx wrangler deploy`. Comprueba `GET /estado` con su token (pídele que lo pruebe él desde la app si no quieres manejar el token).
7. `git init`, primer commit, `gh repo create notas-obra --public --source . --push`. Activa Pages con el flujo de Actions: `gh api -X POST repos/USUARIO/notas-obra/pages -f build_type=workflow` (si ya existe, `-X PUT`). Espera a que termine la acción y dale la URL `https://USUARIO.github.io/notas-obra/`.
8. Dile qué hacer en cada dispositivo: abrir la URL, Ajustes → URL del worker, token y nombre → Guardar y probar → Activar avisos → Enviar aviso de prueba → instalar la app (Chrome/Edge; en iPhone, Compartir → Añadir a pantalla de inicio).
Si encuentras un worker o repositorio `notas-obra` creado antes a mano, pregunta antes de sobrescribirlo.

### Actualizaciones
`npm test` → sube `VERSION` y `CACHE` si cambia `app/` → commit → (confirmación) `git push` (publica la app) y `npx wrangler deploy` si cambió el worker. El worker se gestiona solo desde aquí: si se edita en el panel de Cloudflare, el siguiente deploy lo sobrescribe.
