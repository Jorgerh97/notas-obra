# Notas de obra · cómo funciona la app (documento de consulta)

Documento completo para **hablar de la app en otro chat**: estudiar opciones, costes, ideas y dudas. Describe la app tal como está en la **versión 1.9.0** (publicada el 23 nov 2026; worker de producción `fcae21cd`).

> **Para el chat que lea esto:** tu papel es **consultar y proponer**, no programar ni publicar. No cambies archivos del proyecto, no ejecutes `wrangler deploy` ni `git push` y no toques las bases de datos. Si de la conversación sale algo que hacer, resúmelo al final en una lista corta («Para el chat de producción») que Jorge pueda pegar en el chat donde se hacen los cambios. Responde en castellano y con lenguaje sencillo: Jorge es jefe de obra, no programador. Nunca pidas claves ni tokens.

Otros documentos: `CLAUDE.md` (instrucciones de trabajo y reglas), `docs/PENDIENTE.md` (qué se hizo en cada versión e ideas sin decidir), `docs/FASE3-COMPARTIR.md` (diseño de las notas compartidas), `docs/PASO-PRODUCCION.md` (cómo se pasó a producción la versión multiusuario), `docs/FASE2.md` y `docs/FASE3.md` (calendario, matriz, checklists, fotos…).

---

## 1. Qué es y quién la usa

PWA (web que se instala como app) de **notas y tareas de obra** para Jorge, jefe de obra de una contratista en Barcelona. Se usa en el móvil (en obra), en la tablet y en el ordenador (oficina).

- **Usuarios**: desde la 1.7.1 (18 nov 2026) es **multiusuario**. Jorge es el usuario `yo` y administrador. Hay al menos otro usuario real («Julián JGR»). Cada usuario entra con **su propio token** (una contraseña larga que se pone en Ajustes).
- **Responsable por defecto (1.9.1, sin publicar)**: si no se indica nadie, la nota nueva queda asignada a quien la crea; se puede elegir a otro, a varios o «Nadie». Las anteriores no cambian.
- **Responsables**: una nota puede tener uno o varios responsables. Pueden ser **usuarios de la app** (la ven y la pueden trabajar) o **personas sin cuenta** (solo un nombre, para filtrar y saber a quién se encargó).

## 2. Qué hace (funciones)

**Notas**
- Título, descripción (con `#etiquetas` escritas), prioridad (**Urgente**, Alta, Normal, Baja), etiquetas (tipos: obra, industrial, acción, responsable, otra; con alias para el dictado), responsables, fecha límite con hora opcional, aviso previo (1–12 h, 1–7 días o 1–4 semanas), duración (botones rápidos o «Otra…» con ruedas de cantidad y unidad: minutos, horas o días, hasta 30 días), checklist, repetición (laborables, semanal, quincenal, mensual) y hasta varias fotos.
- «Subir a Urgente» automático cuando faltan menos de 24 h.
- Botón **Copiar** (crea una nota igual), **Realizada** (con Deshacer), papelera de 30 días.
- Las realizadas se guardan **un año** (las de obras abiertas, siempre). Antes de borrar, se archiva un informe HTML. Avisos a 30 y 7 días del borrado.

**Crear notas**
- Escribiendo, o **dictando**: un audio puede dar varias notas. Whisper (Cloudflare) pasa la voz a texto y Claude (Anthropic) lo convierte en notas; siempre hay pantalla de revisión. Claude solo usa etiquetas y personas existentes y propone las nuevas aparte (Crear / Usar similar / Descartar). Los audios se guardan 7 días en el dispositivo por si hay que reintentar.
- **Importar** CSV (con plantilla) y calendarios de Outlook **.ics**, varios archivos a la vez, con una sola revisión. Evita duplicados de .ics por su identificador.
- Pulsando un hueco del calendario.

**Ver y organizar**
- Tres modos: **Lista** (agrupada por fecha o etiqueta, orden por prioridad), **Calendario** (Semana, Mes y Agenda en el móvil; horario visible configurable y «Horario ampliado» 7–24 h) y **Matriz** (columnas por prioridad).
- **Barra lateral** (ordenador): grupos filtrados guardados (filtros por etiquetas, prioridades, responsables, con avisos, vencen esta semana, sin tocar 10+ días) y «Responsables».
- **Arrastrar** (ordenador/tablet): cambiar prioridad en la Matriz, mover fecha/hora en el Calendario, estirar la duración, soltar sobre un responsable para asignarla, soltar sobre un **grupo filtrado** para añadirle sus etiquetas, prioridad y responsable sin quitarle nada (1.8.2), y ordenar los grupos. Todo con Deshacer.
- Buscador, revisión semanal guiada (viernes por defecto), resumen matutino por push, PDF para reunión, historial de cambios, archivo de informes.
- Pantalla **«Tareas hechas compartidas»** (`#/registro`): quién hizo qué, con filtros, CSV y PDF.

**Avisos**
- Push en todos los dispositivos del usuario, con botones «Hecha» y «Posponer 10 min». Con hora límite avisa a esa hora; el aviso previo sin hora suena a las 8:00.
- En notas compartidas: aviso al asignar y al dar por hecha; los avisos de fecha van a todos los participantes.

**Conector para Claude (1.9.0)**: cada usuario puede crear en Ajustes una dirección secreta y añadirla en claude.ai como conector. Así dicta o escribe notas desde la app de Claude, con su suscripción, sin gastar la clave de la API. El conector **solo crea notas** (herramienta `crear_notas`): no puede leer, cambiar ni borrar nada. Etiquetas y responsables se reconocen por nombre o alias; lo que no existe no se crea y Claude lo avisa. Las notas llegan con 🤖. El dictado de la propia app sigue existiendo.

**Sin conexión**: todo se puede hacer sin cobertura; se envía al volver la conexión. Si dos dispositivos cambian la misma nota a la vez, se elige qué versión conservar.

## 3. Piezas y dónde están

| Pieza | Tecnología | Dónde |
|---|---|---|
| App | HTML + CSS + JS sin framework ni compilación (`app/app.js` ~3.300 líneas, `app.css`, `sw.js`) | GitHub Pages, repositorio **público** `Jorgerh97/notas-obra`. URL `https://jorgerh97.github.io/notas-obra/`. Se publica sola al hacer `git push` a `main` |
| API | Un Cloudflare Worker, `worker/worker.js` (~1.350 líneas) | Worker `notas-obra` (`*.workers.dev`) |
| Base de datos | Cloudflare **D1** (SQLite) `notas-obra-db` | Cloudflare |
| Fotos | Cloudflare **R2** `notas-obra-fotos` (miniatura 400 px y grande 1.600 px, JPEG) | Cloudflare |
| Voz a texto | **Workers AI**, Whisper `whisper-large-v3-turbo` en español | Cloudflare |
| Análisis del dictado | **API de Anthropic**, modelo `claude-sonnet-5`, con la clave de Jorge | Anthropic |
| Tareas programadas | Cron del worker **cada minuto** | Cloudflare |

Secretos del worker: `ANTHROPIC_API_KEY` y `APP_TOKEN` (token del usuario `yo`). Se guardan con `npx wrangler secret put` y nunca se escriben en un chat.

**Entorno de pruebas** (`--env dev`): worker `notas-obra-dev`, base `notas-obra-dev-db`, bucket `notas-obra-fotos-dev`, sin cron y sin clave de Anthropic. La app de pruebas se abre en `http://localhost:8080`. Las copias de seguridad de producción están fuera del repositorio (`../copias-seguridad/`).

Hay un worker antiguo `proud-salad-c6ba` con la misma base: no se usa; pendiente de borrar con confirmación de Jorge.

## 4. Usuarios, permisos y acceso

- Cada petición lleva `Authorization: Bearer TOKEN`. El worker guarda solo la **huella SHA-256** de cada token (tabla `usuarios`), salvo el `APP_TOKEN`, que es el usuario `yo`.
- **Administrador** (Jorge): da de alta usuarios, los activa o desactiva, genera tokens nuevos (el token solo se ve al crearlo), da el permiso de **dictar** y traspasa las notas de una persona sin cuenta a un usuario (Ajustes → Responsables).
- **Dictado**: solo quien tiene `puede_dictar` (Jorge siempre). Los demás no ven el botón Dictar. Motivo: el dictado gasta la clave de Anthropic de Jorge.
- **Qué ve cada uno**: sus notas y las notas en que es responsable (directamente o a través de una persona vinculada a él). Los responsables pueden hacer todo menos mandar a la papelera o borrar.
- **Comunes a todos**: etiquetas y personas. **De cada usuario**: grupos filtrados, ajustes (resumen matutino, revisión, calendario), dispositivos de avisos, informes archivados e historial.
- CORS: el worker solo responde a la web de GitHub Pages (`ALLOWED_ORIGIN`).
- Para probar otro usuario en el mismo ordenador: ventana de incógnito o perfil de Chrome aparte.
- Duda abierta: Jorge preguntó si el dueño debería poder asignarse una nota a sí mismo (hoy no sale «Yo» como destino para tus propias notas). Sin decidir.

## 5. Datos (D1)

El worker crea y amplía las tablas él solo. **Regla: solo se añaden columnas o tablas, nunca se borran** (la base tiene datos reales).

| Tabla | Para qué |
|---|---|
| `notas` | Una fila por nota: dueño (`usuario_id`), textos, prioridad, estado (activa / realizada / papelera), fecha y hora límite, aviso previo, próximo aviso calculado (`alarma`), duración, checklist (JSON), repetición y serie, fotos (JSON con ids), origen (manual, voz, app, csv, ics), fechas, `version` (para detectar conflictos), `realizada_por` |
| `nota_responsables` | Responsables de cada nota: tipo `usuario` o `persona`, quién y cuándo la asignó |
| `nota_etiquetas` | Etiquetas de cada nota |
| `etiquetas` | Comunes. Nombre único sin distinguir mayúsculas ni acentos. Cerrar una obra archiva un informe |
| `personas` | Responsables sin cuenta. `usuario_vinculado` si se traspasó a un usuario |
| `usuarios` | Huella del token, nombre, `admin`, `activo`, `puede_dictar` |
| `vistas` | Grupos filtrados de cada usuario (filtro en JSON, orden) |
| `config` / `config_usuario` | Ajustes globales (claves VAPID de los avisos) / de cada usuario |
| `suscripciones` | Dispositivos con avisos, de cada usuario |
| `cambios` | Historial de 90 días (quién, qué dispositivo, qué cambió) |
| `archivos` | Informes HTML archivados antes de borrar notas |

## 6. Cómo se sincroniza

- La app guarda todo en el dispositivo (IndexedDB) y trabaja contra esa copia: es rápida y funciona sin conexión.
- Cada cambio va a una **cola** (`outbox`). Cada **60 segundos** con la app abierta (y al volver a ella o recuperar la conexión): envía la cola, sube fotos pendientes y luego **descarga todos los datos** (`GET /datos`) y sustituye la copia local.
- Conflictos por nota entera (campo `version`): si dos dispositivos cambian la misma nota, sale una pantalla para elegir. No hay fusión campo a campo ni tiempo real (el otro usuario lo ve en menos de un minuto).
- **Punto débil conocido**: como descarga todas las notas cada minuto (incluidas las realizadas de un año), las lecturas de la base crecen con las notas guardadas. Ver apartado 9.

## 7. Tareas automáticas (cron cada minuto)

- Envía los avisos vencidos y calcula el siguiente.
- Cada 15 min: sube a Urgente lo que vence en menos de 24 h.
- Resumen matutino de cada usuario (por defecto 7:00, lunes a viernes), incluidas las notas compartidas que le tocan.
- Una vez al día (desde las 3:00): vacía la papelera de más de 30 días, archiva y borra realizadas caducadas, avisa a 30 y 7 días, limpia el historial.
- Push hecho a mano (VAPID + cifrado aes128gcm), sin servicios externos.

## 8. Cómo se trabaja y se publica

- Los cambios se hacen en el **chat de producción** (Claude Code en la carpeta del proyecto), se prueban en local y en `--env dev`, y se publican solo con la confirmación de Jorge. Jorge prefiere **juntar los cambios del día y publicar a final del día**.
- Pruebas automáticas: `npm test` (unas 270 comprobaciones con Miniflare: worker, migración, usuarios, importar .ics).
- Publicar la app: subir `VERSION` (app.js) y `CACHE` (sw.js), commit y `git push`. En cada dispositivo aparece «Hay una versión nueva».
- Publicar el worker: `npx wrangler deploy --env ""` (producción). Antes de cambios de esquema, copia de seguridad de la base.
- Para volver atrás de la versión multiusuario: etiqueta `v1.5.3` y versión de worker `79c96957-ff07-40f5-ad15-5d131b10aa1e`.

## 9. Costes y límites

**Hoy, con 2 usuarios: 0 € en Cloudflare.** Todo cabe en el plan gratuito. El único gasto real es el **dictado** (API de Anthropic).

**Dictado**
- Whisper (Cloudflare): dentro de lo gratuito.
- Claude Sonnet 5: 2 $ por millón de tokens leídos y 10 $ por millón escritos. Aproximadamente **2–3 céntimos por dictado** (estimado, no medido). 10 dictados al día ≈ 5–7 $ al mes por persona.
- Se paga con la **clave de la API de Jorge (console.anthropic.com), aparte de la suscripción Pro**: lo que no se use del Pro no se descuenta. Todos los usuarios que dictan gastan de esa misma clave. Hoy la app **no** separa el gasto por usuario.
- Idea propuesta (sin hacer): que el worker apunte los tokens de cada dictado por usuario, con pantalla de gasto para el administrador y límite mensual opcional por usuario. Alternativa descartada por complicada: una clave de Anthropic por usuario.

**Límites gratuitos de Cloudflare** (estimación con 30 notas al día por usuario, una foto en cada una, app abierta ~3 h al día, notas realizadas guardadas un año):

| Límite gratuito | Usuarios hasta llegar | Qué pasa si se supera |
|---|---|---|
| Registros técnicos (Observability): 0,5 GB/día | ~800 | Solo dejan de guardarse registros. Además, el worker no tiene `[observability]` activado |
| Peticiones al worker: 100.000/día | ~240 | El worker rechaza peticiones hasta el día siguiente |
| Fotos R2: 10 GB guardados | ~3 al cabo de un año (~3 GB/usuario/año) | Se cobra el exceso, céntimos |
| **Lecturas D1: 5 millones/día** | **3–4 el primer mes; 1–2 al cabo de un año** | La nube deja de responder hasta el día siguiente (la app sigue sin conexión) |

- El cuello de botella es la **sincronización completa cada minuto** (apartado 6). Soluciones: **sincronización por cambios** (pedir solo lo cambiado desde la última vez; recomendada, cambio grande en worker y app) y/o **Workers Paid** (5 $/mes, 25.000 millones de lecturas al mes).
- Aviso de Cloudflare (20 nov 2026): desde el 1 dic 2026 Observability cobra por volumen solo en planes de pago. En el plan gratuito no cambia nada.

## 10. Ideas y temas abiertos

- Sincronización por cambios (ver 9).
- Conector para Claude: poner la clave en un «encabezado de solicitud» de claude.ai en lugar de en la dirección (así la URL no lleva nada secreto). Propuesto el 23 nov 2026; Jorge lo aplaza.
- Control del gasto de dictado por usuario (ver 9).
- ¿Asignarse una nota a uno mismo? (ver 4).
- Mejorar el dictado con ruido de fondo (más calidad de audio, vocabulario de obra a Whisper) → `docs/PENDIENTE.md`.
- Eventos de calendario externo / reuniones de Microsoft: aplazado hasta tener acceso.
- Borrar el worker antiguo `proud-salad-c6ba`.
- Descartados por Jorge: cambiar el tipo de letra, nota → borrador de Gmail, conexión con «Visitas de obra».

## 11. Historial de versiones (resumen)

| Versión | Fecha | Qué trajo |
|---|---|---|
| 1.0–1.1 | 1 oct 2026 | Notas, dictado, etiquetas, avisos push, sin conexión |
| 1.2.0 | 1 oct 2026 | Calendario, Matriz, arrastres, duración, resumen matutino |
| 1.3.0–1.3.1 | 2–6 oct 2026 | Checklists, repeticiones, PDF para reunión, fotos; hora con desplegables |
| 1.4.0–1.4.1 | 8–13 oct 2026 | Barra lateral con grupos y responsables, arrastrar a responsable |
| 1.5.0–1.5.3 | 13 oct–18 nov 2026 | Importar CSV, cursor en el título, fechas cortas, más sitio para el título |
| 1.7.1 | 18 nov 2026 | **Multiusuario**: tokens, permiso de dictado, notas compartidas, registro de hechas, traspaso |
| 1.8.0 | 19 nov 2026 | Importar calendarios de Outlook (.ics), varios archivos a la vez |
| 1.8.1 | 19 nov 2026 | Horario ampliado en el calendario, botón Copiar |
| 1.8.2 | 20 nov 2026 | Arrastrar una nota a un grupo filtrado le añade sus filtros |
| 1.8.3 | 23 nov 2026 | Duración con ruedas de cantidad y unidad, hasta 30 días (también en el worker) |
| 1.9.0 | 23 nov 2026 | Conector para Claude (MCP): crear notas desde la app de Claude con la suscripción; solo crea, no lee |

## 12. Condiciones que cualquier propuesta debe respetar

- No perder datos: la base de producción tiene notas reales; solo añadir columnas o tablas.
- Seguir funcionando sin conexión.
- Coste bajo: plan gratuito de Cloudflare o muy barato.
- Sin framework ni compilación en la app, salvo motivo muy claro.
- Fácil de mantener para alguien que no programa. Secretos solo con `wrangler secret put`.
- El repositorio es **público**: nada de datos reales, copias de la base ni correos en él.
- Interfaz en castellano, paleta Voracys (azules, naranja para Dictar, rojo para Urgente) y letra Barlow.
