// Proxy de la app "Notas de obra" (fase 1).
//
// Rutas (todas requieren la cabecera Authorization: Bearer APP_TOKEN):
//   GET    /estado                    Comprueba la configuración del worker.
//   GET    /datos                     Todas las notas, etiquetas, personas, grupos filtrados y ajustes.
//   POST   /notas                     Crea una nota (idempotente por id).
//   PUT    /notas/:id                 Modifica una nota. Usa base_version para detectar conflictos (409).
//   DELETE /notas/:id                 Borra definitivamente una nota de la papelera.
//   POST   /notas/:id/alarma          Acción desde un aviso: { accion: "hecha" | "posponer", minutos }.
//   POST   /notas/conservar           Conserva un año más las notas realizadas indicadas.
//   POST   /papelera/vaciar           Borra definitivamente toda la papelera.
//   POST|PUT|DELETE /etiquetas[/:id]  Etiquetas (cerrar una obra archiva sus notas).
//   POST|PUT|DELETE /personas[/:id]   Personas a las que asignar notas.
//   POST|PUT|DELETE /vistas[/:id]     Grupos filtrados.   PUT /vistas-orden { ids }
//   PUT    /config                    Ajustes compartidos entre dispositivos.
//   POST   /transcribir               Audio (cuerpo binario) → texto, con Whisper.
//   POST   /analizar                  Texto → propuesta de notas, con Claude.
//   GET    /push/clave                Clave pública para las notificaciones.
//   POST   /push/suscribir            Registra este dispositivo para recibir avisos.
//   GET    /dispositivos              Dispositivos registrados.
//   PUT|DELETE /dispositivos/:id      Renombra, activa/desactiva o quita un dispositivo.
//   POST   /push/prueba               Envía un aviso de prueba.
//   GET    /archivos, GET|DELETE /archivos/:id   Informes archivados antes de borrar notas.
//   GET    /exportar                  Copia completa de los datos en JSON.
//   GET    /yo                        Usuario del token (id, nombre, admin).
//   GET|POST /usuarios, PUT /usuarios/:id, POST /usuarios/:id/token   Solo el administrador: alta de usuarios,
//                                     activar/desactivar, permiso de dictado y token nuevo (el token solo se devuelve al crearlo).
//
// Notas compartidas (fase 3): una nota tiene uno o varios responsables (tabla nota_responsables): usuarios de
// la app o personas sin cuenta (una persona puede estar vinculada a un usuario). La ven su dueño (quien la creó,
// notas.usuario_id) y los responsables con cuenta. Los responsables pueden hacer todo menos enviarla a la papelera
// o borrarla. Etiquetas y personas son comunes a todos los usuarios. realizada_por guarda quién la dio por hecha.
//   GET    /registro                  Tareas hechas compartidas (cada uno las suyas; el administrador, todas).
//   POST   /personas/:id/traspasar    Solo el administrador: { usuario_id }. Las notas de esa persona pasan al usuario
//                                     (la persona queda vinculada a él y deja de salir aparte en la app).
//
// Dictado (fase 2): /transcribir y /analizar gastan la cuenta de Anthropic y Workers AI de Jorge, así que solo
// los puede usar quien tenga puede_dictar. El usuario principal lo tiene siempre; los demás empiezan sin él.
//
// Usuarios (fase 4): cada usuario tiene su propio token. El APP_TOKEN del worker es el usuario "yo"
// (Jorge, administrador). De los demás solo se guarda la huella SHA-256 del token, nunca el token.
// Todo (notas, etiquetas, personas, grupos, ajustes, dispositivos, archivos) es de cada usuario.
//
// Avisos: si la nota tiene hora límite, se avisa en ese momento; además puede tener un aviso con
// antelación (1-12 horas, 1-7 días o 1-4 semanas). La columna "alarma" guarda el próximo aviso pendiente.
//
// Tarea programada (Cron Trigger "* * * * *"): envía los avisos, sube a Urgente (valor interno "critica")
// las notas que vencen en menos de 24 h y, una vez al día, limpia la papelera y archiva y borra las realizadas caducadas.
//
// Variables del worker:
//   ANTHROPIC_API_KEY (Secret), APP_TOKEN (Secret), ALLOWED_ORIGIN (Text), MODEL (Text, opcional)
// Enlaces (bindings):
//   AI  Workers AI, para la transcripción.
//   DB  Base de datos D1 "notas-obra-db".

const DEFAULT_MODEL = 'claude-sonnet-5';
// Versión de la API. La app avisa si el worker no la indica (worker antiguo que no guarda hora, checklist ni fotos).
const API = 3;
const WHISPER = '@cf/openai/whisper-large-v3-turbo';
const MAX_AUDIO = 15 * 1024 * 1024;
const DIA = 86400000;
const RETENCION_REALIZADAS = 365;   // días
const RETENCION_PAPELERA = 30;      // días
const RETENCION_CAMBIOS = 90;       // días de historial de cambios
const PRIORIDADES = ['critica', 'alta', 'normal', 'baja'];
const ESTADOS = ['activa', 'realizada', 'papelera'];
const TIPOS_ETIQUETA = ['obra', 'industrial', 'accion', 'responsable', 'otra'];
// cal_*: horario visible del calendario. resumen_*: resumen matutino (activo '1'/'0', hora 'HH:MM', días '1,2,3,4,5' con 1 = lunes).
const CONFIG_PUBLICA = ['revision_dia', 'revision_ultima', 'cal_inicio', 'cal_fin', 'resumen_activo', 'resumen_hora', 'resumen_dias'];
const RESUMEN = { activo: '1', hora: '07:00', dias: '1,2,3,4,5', margen: 180 };   // margen: minutos tras la hora en que aún se envía
const ESTANCADA_DIAS = 10;
const USUARIO_PRINCIPAL = 'yo';   // el usuario del APP_TOKEN (Jorge, administrador)
// Ajustes de cada usuario (tabla config_usuario). En config quedan los globales: claves VAPID y tarea diaria.
const CONFIG_USUARIO = [...CONFIG_PUBLICA, 'resumen_ultimo'];
const AVISO_RANGO = { h: 12, d: 7, s: 4 };   // horas, días o semanas antes (desde 1)
const HORA_AVISO = '08:00';                  // hora de los avisos cuando la fecha límite no tiene hora

// ---------- Utilidades ----------
class HttpError extends Error { constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; } }
const now = () => new Date().toISOString();
const plus = (dias, desde) => new Date((desde ? Date.parse(desde) : Date.now()) + dias * DIA).toISOString();
const txt = (v, max = 4000) => String(v == null ? '' : v).slice(0, max);
const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const uuid = () => crypto.randomUUID();
const isId = v => typeof v === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(v);
const fechaOk = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isoOk = v => typeof v === 'string' && !isNaN(Date.parse(v)) && /^\d{4}-\d{2}-\d{2}T/.test(v);
const nombreEtiquetaOk = v => typeof v === 'string' && /^[\p{L}\p{N}_-]{1,40}$/u.test(v);
const horaOk = v => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const avisoOk = (unidad, cant) => unidad in AVISO_RANGO && Number.isInteger(cant) && cant >= 1 && cant <= AVISO_RANGO[unidad];

// ---------- Hora de Madrid ----------
function partesMadrid(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` };
}
// "AAAA-MM-DD" + "HH:MM" en hora de Madrid → milisegundos UTC.
function madridAUtc(fecha, hora) {
  const [y, m, d] = fecha.split('-').map(Number), [h, mi] = hora.split(':').map(Number);
  const local = Date.UTC(y, m - 1, d, h, mi);
  const desfase = t => { const p = partesMadrid(t); return Date.parse(p.fecha + 'T' + p.hora + ':00Z') - Math.floor(t / 60000) * 60000; };
  const t = local - desfase(local);
  return local - desfase(t);
}
const sumarDias = (fecha, n) => new Date(Date.parse(fecha + 'T00:00:00Z') + n * DIA).toISOString().slice(0, 10);

// Momentos en que hay que avisar de una nota (ms UTC).
function momentosAviso(n) {
  if (!n.fecha_limite) return [];
  const out = [];
  const hora = n.hora_limite || HORA_AVISO;
  if (n.hora_limite) out.push(madridAUtc(n.fecha_limite, n.hora_limite));
  if (avisoOk(n.aviso_unidad, n.aviso_cant)) {
    out.push(n.aviso_unidad === 'h'
      ? madridAUtc(n.fecha_limite, hora) - n.aviso_cant * 3600000
      : madridAUtc(sumarDias(n.fecha_limite, -n.aviso_cant * (n.aviso_unidad === 's' ? 7 : 1)), hora));
  }
  return out;
}
function proximoAviso(n, despues) {
  const t = momentosAviso(n).filter(x => x > despues).sort((a, b) => a - b)[0];
  return t ? new Date(t).toISOString() : null;
}

async function readJson(request) {
  try { return await request.json(); } catch { throw new HttpError(400, 'El cuerpo de la petición no es JSON válido.'); }
}

// ---------- Base de datos ----------
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS notas (
     id TEXT PRIMARY KEY, usuario_id TEXT NOT NULL DEFAULT 'yo', titulo TEXT NOT NULL, cuerpo TEXT, prioridad TEXT NOT NULL,
     estado TEXT NOT NULL DEFAULT 'activa', persona_id TEXT, fecha_limite TEXT, alarma TEXT, alarma_enviada INTEGER DEFAULT 0,
     subir_critica INTEGER DEFAULT 1, duracion INTEGER, origen TEXT, origen_ref TEXT, transcripcion TEXT,
     creada TEXT, actualizada TEXT, realizada_en TEXT, eliminada_en TEXT, borrar_en TEXT,
     aviso30 INTEGER DEFAULT 0, aviso7 INTEGER DEFAULT 0, version INTEGER NOT NULL DEFAULT 1)`,
  `CREATE INDEX IF NOT EXISTS idx_notas_estado ON notas(estado)`,
  `CREATE INDEX IF NOT EXISTS idx_notas_alarma ON notas(alarma)`,
  `CREATE INDEX IF NOT EXISTS idx_notas_origen ON notas(origen, origen_ref)`,
  `CREATE TABLE IF NOT EXISTS etiquetas (
     id TEXT PRIMARY KEY, usuario_id TEXT NOT NULL DEFAULT 'yo', nombre TEXT NOT NULL, tipo TEXT NOT NULL DEFAULT 'otra',
     alias TEXT, cerrada INTEGER DEFAULT 0, cerrada_en TEXT, creada TEXT, actualizada TEXT)`,
  `CREATE TABLE IF NOT EXISTS nota_etiquetas (nota_id TEXT NOT NULL, etiqueta_id TEXT NOT NULL, PRIMARY KEY (nota_id, etiqueta_id))`,
  `CREATE INDEX IF NOT EXISTS idx_ne_etiqueta ON nota_etiquetas(etiqueta_id)`,
  `CREATE TABLE IF NOT EXISTS personas (id TEXT PRIMARY KEY, usuario_id TEXT NOT NULL DEFAULT 'yo', nombre TEXT NOT NULL, cargo TEXT, creada TEXT)`,
  `CREATE TABLE IF NOT EXISTS vistas (id TEXT PRIMARY KEY, usuario_id TEXT NOT NULL DEFAULT 'yo', nombre TEXT NOT NULL, filtro TEXT NOT NULL, orden INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS cambios (id INTEGER PRIMARY KEY AUTOINCREMENT, nota_id TEXT, fecha TEXT, dispositivo TEXT, accion TEXT, antes TEXT)`,
  `CREATE INDEX IF NOT EXISTS idx_cambios_nota ON cambios(nota_id)`,
  `CREATE TABLE IF NOT EXISTS suscripciones (
     id TEXT PRIMARY KEY, endpoint TEXT UNIQUE NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, nombre TEXT,
     plataforma TEXT, activo INTEGER DEFAULT 1, creada TEXT, ultimo_uso TEXT)`,
  `CREATE TABLE IF NOT EXISTS config (clave TEXT PRIMARY KEY, valor TEXT)`,
  `CREATE TABLE IF NOT EXISTS archivos (id TEXT PRIMARY KEY, titulo TEXT, motivo TEXT, creado TEXT, notas INTEGER, html TEXT)`,
  // Fase 4 (multiusuario)
  `CREATE TABLE IF NOT EXISTS usuarios (id TEXT PRIMARY KEY, nombre TEXT NOT NULL, token_hash TEXT UNIQUE, admin INTEGER DEFAULT 0,
     activo INTEGER DEFAULT 1, creado TEXT, actualizado TEXT)`,
  `CREATE TABLE IF NOT EXISTS config_usuario (usuario_id TEXT NOT NULL, clave TEXT NOT NULL, valor TEXT, PRIMARY KEY (usuario_id, clave))`,
  `CREATE INDEX IF NOT EXISTS idx_notas_usuario ON notas(usuario_id)`,
  // Fase 3: responsables de cada nota (tipo 'usuario' o 'persona').
  `CREATE TABLE IF NOT EXISTS nota_responsables (nota_id TEXT NOT NULL, tipo TEXT NOT NULL, ref_id TEXT NOT NULL, asignado_por TEXT, asignado_en TEXT,
     PRIMARY KEY (nota_id, tipo, ref_id))`,
  `CREATE INDEX IF NOT EXISTS idx_resp_ref ON nota_responsables(tipo, ref_id)`,
];
// Columnas añadidas después de la primera versión (la base de producción ya tiene datos).
const COLUMNAS_NUEVAS = [
  ['notas', 'hora_limite', 'TEXT'], ['notas', 'aviso_cant', 'INTEGER'], ['notas', 'aviso_unidad', 'TEXT'],   // 1.1.0
  ['notas', 'checklist', 'TEXT'], ['notas', 'repetir', 'TEXT'], ['notas', 'serie', 'TEXT'], ['notas', 'prio_antes', 'TEXT'], ['notas', 'fotos', 'TEXT'],   // 1.3.0
  // Fase 4: dueño de cada dispositivo, informe y cambio. Lo que ya existe es de "yo".
  ['suscripciones', 'usuario_id', "TEXT NOT NULL DEFAULT 'yo'"], ['archivos', 'usuario_id', "TEXT NOT NULL DEFAULT 'yo'"], ['cambios', 'usuario_id', "TEXT NOT NULL DEFAULT 'yo'"],
  ['usuarios', 'puede_dictar', 'INTEGER DEFAULT 0'],   // fase 2: el principal puede siempre (puedeDictar)
  ['notas', 'realizada_por', 'TEXT'], ['personas', 'usuario_vinculado', 'TEXT'],   // fase 3
];
let schemaOk = false;
async function ensureSchema(env) {
  if (schemaOk) return;
  await env.DB.batch(SCHEMA.map(q => env.DB.prepare(q)));
  const colsDe = {};
  for (const [tabla, col, tipo] of COLUMNAS_NUEVAS) {
    const cols = colsDe[tabla] || (colsDe[tabla] = new Set((await all(env, `PRAGMA table_info(${tabla})`)).map(c => c.name)));
    if (!cols.has(col)) { try { await run(env, `ALTER TABLE ${tabla} ADD COLUMN ${col} ${tipo}`); } catch { /* otra instancia la añadió a la vez */ } }
  }
  if (!colsDe.notas.has('hora_limite')) await migrarAlarmas(env);
  // Fase 4: el usuario principal existe siempre y sus ajustes pasan de config a config_usuario (config no
  // se borra). INSERT OR IGNORE: no pisa lo que el usuario haya cambiado después.
  await run(env, 'INSERT OR IGNORE INTO usuarios (id, nombre, admin, activo, creado) VALUES (?, ?, 1, 1, ?)', USUARIO_PRINCIPAL, 'Jorge', now());
  await run(env, `INSERT OR IGNORE INTO config_usuario (usuario_id, clave, valor) SELECT ?, clave, valor FROM config WHERE clave IN (${CONFIG_USUARIO.map(() => '?').join(',')})`,
    USUARIO_PRINCIPAL, ...CONFIG_USUARIO);
  // Fase 3: el responsable único de antes (persona_id) pasa a la lista de responsables. INSERT OR IGNORE y
  // persona_id siempre igual a la primera persona de la lista: repetirlo no cambia nada.
  await run(env, `INSERT OR IGNORE INTO nota_responsables (nota_id, tipo, ref_id, asignado_por, asignado_en)
    SELECT id, 'persona', persona_id, usuario_id, creada FROM notas WHERE persona_id IS NOT NULL AND persona_id <> ''`);
  schemaOk = true;
}

// Las alarmas de la versión anterior pasan a ser la hora de la fecha límite. Si la alarma caía otro día
// que la fecha límite, se convierte en un aviso con antelación cuando cabe en las opciones (1-7 días, 1-4 semanas).
// La columna alarma no se toca: el aviso pendiente sigue sonando a la misma hora.
async function migrarAlarmas(env) {
  const notas = await all(env, 'SELECT id, fecha_limite, alarma FROM notas WHERE alarma IS NOT NULL AND hora_limite IS NULL');
  for (const n of notas) {
    const { fecha, hora } = partesMadrid(Date.parse(n.alarma));
    const limite = n.fecha_limite || fecha;
    const dias = Math.round((Date.parse(limite) - Date.parse(fecha)) / DIA);
    let unidad = null, cant = null;
    if (dias > 0 && dias % 7 === 0 && dias / 7 <= AVISO_RANGO.s) { unidad = 's'; cant = dias / 7; }
    else if (dias > 0 && dias <= AVISO_RANGO.d) { unidad = 'd'; cant = dias; }
    await run(env, 'UPDATE notas SET fecha_limite = ?, hora_limite = ?, aviso_unidad = ?, aviso_cant = ? WHERE id = ?', limite, hora, unidad, cant, n.id);
  }
}
const all = async (env, sql, ...b) => (await env.DB.prepare(sql).bind(...b).all()).results || [];
const first = (env, sql, ...b) => env.DB.prepare(sql).bind(...b).first();
const run = (env, sql, ...b) => env.DB.prepare(sql).bind(...b).run();

async function getCfg(env, clave) {
  const r = await first(env, 'SELECT valor FROM config WHERE clave = ?', clave);
  return r ? r.valor : null;
}
const setCfg = (env, clave, valor) =>
  run(env, 'INSERT INTO config (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor', clave, String(valor));
// Ajustes del usuario de la petición (env.U).
async function getCfgU(env, clave) {
  const r = await first(env, 'SELECT valor FROM config_usuario WHERE usuario_id = ? AND clave = ?', env.U, clave);
  return r ? r.valor : null;
}
const setCfgU = (env, clave, valor) => run(env, `INSERT INTO config_usuario (usuario_id, clave, valor) VALUES (?, ?, ?)
  ON CONFLICT(usuario_id, clave) DO UPDATE SET valor = excluded.valor`, env.U, clave, String(valor));

// ---------- Notas visibles y responsables (fase 3) ----------
// Notas que ve el usuario env.U: las suyas y, salvo en la papelera, aquellas de las que es responsable
// (directamente o a través de una persona vinculada a él). Se usa con ...vis(env).
const VISIBLE = `(notas.usuario_id = ? OR (notas.estado != 'papelera' AND EXISTS (SELECT 1 FROM nota_responsables r WHERE r.nota_id = notas.id
  AND ((r.tipo = 'usuario' AND r.ref_id = ?) OR (r.tipo = 'persona' AND r.ref_id IN (SELECT id FROM personas WHERE usuario_vinculado = ?))))))`;
const vis = env => [env.U, env.U, env.U];
const RESP_MAX = 10;
async function responsablesDe(env, ids) {
  const mapa = {};
  for (let i = 0; i < ids.length; i += 90) {
    const trozo = ids.slice(i, i + 90);
    const filas = await all(env, `SELECT nota_id, tipo, ref_id FROM nota_responsables WHERE nota_id IN (${trozo.map(() => '?').join(',')}) ORDER BY asignado_en, rowid`, ...trozo);
    for (const f of filas) (mapa[f.nota_id] = mapa[f.nota_id] || []).push({ tipo: f.tipo, id: f.ref_id });
  }
  return mapa;
}
// Lista de responsables recibida: solo usuarios activos y personas que existen, sin repetidos ni el dueño.
async function limpiarResponsables(env, lista, dueno) {
  const usuarios = new Set((await all(env, 'SELECT id FROM usuarios WHERE activo = 1')).map(r => r.id));
  const personas = new Set((await all(env, 'SELECT id FROM personas')).map(r => r.id));
  const out = [], vistos = new Set();
  for (const x of Array.isArray(lista) ? lista : []) {
    const tipo = x && x.tipo, id = x && x.id;
    if (!((tipo === 'usuario' && usuarios.has(id) && id !== dueno) || (tipo === 'persona' && personas.has(id)))) continue;
    if (vistos.has(tipo + ':' + id)) continue;
    vistos.add(tipo + ':' + id); out.push({ tipo, id });
  }
  return out.slice(0, RESP_MAX);
}
// Responsables del cuerpo de la petición. La app antigua solo envía persona_id: se cambia la persona y se
// conservan los usuarios. null = no se tocan.
async function responsablesDelCuerpo(env, b, actuales, dueno) {
  if (Array.isArray(b.responsables)) return limpiarResponsables(env, b.responsables, dueno);
  if ('persona_id' in b) {
    const usuarios = (actuales || []).filter(r => r.tipo === 'usuario');
    return limpiarResponsables(env, [...(isId(b.persona_id) ? [{ tipo: 'persona', id: b.persona_id }] : []), ...usuarios], dueno);
  }
  return null;
}
// Usuarios que participan en una nota (activos): su dueño y los responsables con cuenta o personas vinculadas.
async function participantes(env, notaId) {
  const filas = await all(env, `SELECT usuario_id AS u FROM notas WHERE id = ?
    UNION SELECT ref_id FROM nota_responsables WHERE nota_id = ? AND tipo = 'usuario'
    UNION SELECT p.usuario_vinculado FROM nota_responsables r JOIN personas p ON p.id = r.ref_id
      WHERE r.nota_id = ? AND r.tipo = 'persona' AND p.usuario_vinculado IS NOT NULL`, notaId, notaId, notaId);
  const activos = new Set((await all(env, 'SELECT id FROM usuarios WHERE activo = 1')).map(r => r.id));
  return [...new Set(filas.map(f => f.u))].filter(u => activos.has(u));
}
// Guarda los responsables (conserva quién y cuándo asignó a los que ya estaban; persona_id = primera persona,
// para la app antigua) y devuelve los usuarios que acaban de entrar, para avisarles.
async function ponerResponsables(env, notaId, lista) {
  const antes = await participantes(env, notaId);
  const previos = Object.fromEntries((await all(env, 'SELECT tipo, ref_id, asignado_por, asignado_en FROM nota_responsables WHERE nota_id = ?', notaId))
    .map(r => [r.tipo + ':' + r.ref_id, r]));
  const t = now();
  const ops = [env.DB.prepare('DELETE FROM nota_responsables WHERE nota_id = ?').bind(notaId)];
  for (const r of lista) {
    const prev = previos[r.tipo + ':' + r.id];
    ops.push(env.DB.prepare('INSERT OR IGNORE INTO nota_responsables (nota_id, tipo, ref_id, asignado_por, asignado_en) VALUES (?, ?, ?, ?, ?)')
      .bind(notaId, r.tipo, r.id, prev ? prev.asignado_por : env.U, prev ? prev.asignado_en : t));
  }
  const persona = lista.find(r => r.tipo === 'persona');
  ops.push(env.DB.prepare('UPDATE notas SET persona_id = ? WHERE id = ?').bind(persona ? persona.id : null, notaId));
  await env.DB.batch(ops);
  return (await participantes(env, notaId)).filter(u => !antes.includes(u) && u !== env.U);
}
const nombreUsuario = async (env, id) => ((await first(env, 'SELECT nombre FROM usuarios WHERE id = ?', id)) || {}).nombre || 'Alguien';
async function avisarUsuarios(env, ids, datos) {
  for (const u of ids) await avisarTodos(conUsuario(env, u), datos);
}
async function avisarAsignados(env, nota, nuevos) {
  if (!nota || !nuevos.length) return;
  await avisarUsuarios(env, nuevos, { tipo: 'info', tag: 'asignada-' + nota.id, titulo: 'Te han asignado una nota',
    cuerpo: ((await nombreUsuario(env, env.U)) + ': ' + nota.titulo).slice(0, 180), url: '#/nota/' + nota.id });
}
async function avisarHecha(env, nota) {
  if (!nota) return;
  const otros = (await participantes(env, nota.id)).filter(u => u !== env.U);
  if (!otros.length) return;
  await avisarUsuarios(env, otros, { tipo: 'info', tag: 'hecha-' + nota.id, titulo: 'Nota hecha',
    cuerpo: ((await nombreUsuario(env, env.U)) + ' ha dado por hecha: ' + nota.titulo).slice(0, 180), url: '#/nota/' + nota.id });
}

// Traspaso manual (administrador): cuando alguien que estaba como persona pasa a tener cuenta, sus notas pasan a
// ese usuario. Se quita la persona de cada nota y entra el usuario (salvo en las notas que ya son suyas).
async function traspasarPersona(env, personaId, usuarioId) {
  if (!env.A) throw new HttpError(403, 'Solo el administrador puede traspasar las notas de una persona.');
  const p = await first(env, 'SELECT id, nombre FROM personas WHERE id = ?', personaId);
  if (!p) throw new HttpError(404, 'La persona no existe.');
  const u = await first(env, 'SELECT id, nombre FROM usuarios WHERE id = ? AND activo = 1', usuarioId);
  if (!u) throw new HttpError(400, 'Elige un usuario activo de la app.');
  const notas = await all(env, `SELECT r.nota_id, n.usuario_id AS dueno FROM nota_responsables r JOIN notas n ON n.id = r.nota_id
    WHERE r.tipo = 'persona' AND r.ref_id = ?`, personaId);
  const t = now(), ops = [];
  for (const n of notas) {
    if (n.dueno !== u.id) ops.push(env.DB.prepare(`INSERT OR IGNORE INTO nota_responsables (nota_id, tipo, ref_id, asignado_por, asignado_en) VALUES (?, 'usuario', ?, ?, ?)`)
      .bind(n.nota_id, u.id, env.U, t));
    ops.push(env.DB.prepare(`DELETE FROM nota_responsables WHERE nota_id = ? AND tipo = 'persona' AND ref_id = ?`).bind(n.nota_id, personaId));
    // persona_id = la primera persona que quede (app antigua); la versión sube para que los dispositivos la recojan.
    ops.push(env.DB.prepare(`UPDATE notas SET persona_id = (SELECT ref_id FROM nota_responsables WHERE nota_id = notas.id AND tipo = 'persona' ORDER BY asignado_en, rowid LIMIT 1),
      actualizada = ?, version = version + 1 WHERE id = ?`).bind(t, n.nota_id));
    ops.push(env.DB.prepare('INSERT INTO cambios (nota_id, usuario_id, fecha, dispositivo, accion, antes) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(n.nota_id, env.U, t, 'Traspaso', 'traspaso:' + personaId + '>' + u.id, null));
  }
  ops.push(env.DB.prepare('UPDATE notas SET persona_id = NULL WHERE persona_id = ? AND id NOT IN (SELECT nota_id FROM nota_responsables)').bind(personaId));
  ops.push(env.DB.prepare('UPDATE personas SET usuario_vinculado = ? WHERE id = ?').bind(u.id, personaId));
  for (let i = 0; i < ops.length; i += 90) await env.DB.batch(ops.slice(i, i + 90));
  const suyas = notas.filter(n => n.dueno !== u.id).length;
  if (suyas && u.id !== env.U) await avisarTodos(conUsuario(env, u.id), { tipo: 'info', tag: 'traspaso-' + personaId,
    titulo: suyas === 1 ? 'Tienes 1 nota asignada' : 'Tienes ' + suyas + ' notas asignadas',
    cuerpo: ('Antes estaban a nombre de ' + p.nombre + '.').slice(0, 180), url: '#/' });
  return { traspasadas: notas.length, persona: await first(env, 'SELECT id, nombre, cargo, usuario_vinculado FROM personas WHERE id = ?', personaId) };
}

// Registro de tareas hechas compartidas: notas realizadas con algún responsable con cuenta. Cada usuario ve
// aquellas en las que participa; el administrador, todas. Los filtros los aplica la app.
async function registroHechas(env) {
  const compartida = `EXISTS (SELECT 1 FROM nota_responsables r LEFT JOIN personas p ON r.tipo = 'persona' AND p.id = r.ref_id
    WHERE r.nota_id = notas.id AND (r.tipo = 'usuario' OR p.usuario_vinculado IS NOT NULL))`;
  const notas = await all(env, `SELECT ${NOTA_COLS} FROM notas WHERE estado = 'realizada' AND ${compartida}
    ${env.A ? '' : 'AND ' + VISIBLE} ORDER BY realizada_en DESC LIMIT 2000`, ...(env.A ? [] : vis(env)));
  const ids = notas.map(n => n.id), mapa = await etiquetasDe(env, ids), resp = await responsablesDe(env, ids);
  for (const n of notas) { n.etiquetas = mapa[n.id] || []; n.responsables = resp[n.id] || []; prepararNota(n); }
  const usuarios = await all(env, 'SELECT id, nombre FROM usuarios ORDER BY nombre');   // también los desactivados
  return { notas, usuarios, todos: !!env.A };
}

// ---------- Usuarios ----------
// Cada petición lleva su usuario en env.U (una copia de env por petición; nunca una variable global,
// porque un mismo worker atiende varias peticiones a la vez).
const conUsuario = (env, id) => ({ ...env, U: id });
const puedeDictar = u => !!u && (u.id === USUARIO_PRINCIPAL || !!u.puede_dictar);
const usuarioPublico = u => ({ id: u.id, nombre: u.nombre, admin: !!u.admin, activo: !!u.activo, puede_dictar: puedeDictar(u) });
async function hashToken(token) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
  return [...h].map(b => b.toString(16).padStart(2, '0')).join('');
}
function nuevoToken() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return 'no_' + btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function usuarioDelToken(env, token) {
  if (!token) return null;
  if (token === env.APP_TOKEN) return first(env, 'SELECT * FROM usuarios WHERE id = ?', USUARIO_PRINCIPAL);
  if (token.length < 20) return null;
  return first(env, 'SELECT * FROM usuarios WHERE token_hash = ? AND activo = 1', await hashToken(token));
}
async function gestionUsuarios(env, M, parts, request, yo) {
  if (!yo.admin) throw new HttpError(403, 'Solo el administrador puede gestionar usuarios.');
  if (M === 'GET' && parts.length === 1) return { usuarios: (await all(env, 'SELECT * FROM usuarios ORDER BY creado')).map(usuarioPublico) };
  if (M === 'POST' && parts.length === 1) {
    const b = await readJson(request);
    const nombre = txt(b.nombre, 60).trim();
    if (!nombre) throw new HttpError(400, 'Escribe el nombre del usuario.');
    const id = uuid(), token = nuevoToken(), t = now();
    await run(env, 'INSERT INTO usuarios (id, nombre, token_hash, admin, activo, puede_dictar, creado, actualizado) VALUES (?, ?, ?, 0, 1, ?, ?, ?)',
      id, nombre, await hashToken(token), b.puede_dictar ? 1 : 0, t, t);
    return { usuario: usuarioPublico(await first(env, 'SELECT * FROM usuarios WHERE id = ?', id)), token };
  }
  const u = parts[1] ? await first(env, 'SELECT * FROM usuarios WHERE id = ?', parts[1]) : null;
  if (!u) throw new HttpError(404, 'El usuario no existe.');
  if (M === 'PUT' && parts.length === 2) {
    const b = await readJson(request);
    if ('activo' in b && !b.activo && u.id === USUARIO_PRINCIPAL) throw new HttpError(400, 'El usuario principal no se puede desactivar.');
    if ('puede_dictar' in b && !b.puede_dictar && u.id === USUARIO_PRINCIPAL) throw new HttpError(400, 'El usuario principal siempre puede dictar.');
    const nombre = 'nombre' in b ? txt(b.nombre, 60).trim() || u.nombre : u.nombre;
    const activo = 'activo' in b ? (b.activo ? 1 : 0) : u.activo;
    const dictar = 'puede_dictar' in b ? (b.puede_dictar ? 1 : 0) : (u.puede_dictar || 0);
    await run(env, 'UPDATE usuarios SET nombre = ?, activo = ?, puede_dictar = ?, actualizado = ? WHERE id = ?', nombre, activo, dictar, now(), u.id);
    return { usuario: usuarioPublico(await first(env, 'SELECT * FROM usuarios WHERE id = ?', u.id)) };
  }
  if (M === 'POST' && parts[2] === 'token' && parts.length === 3) {
    if (u.id === USUARIO_PRINCIPAL) throw new HttpError(400, 'El token del usuario principal es el APP_TOKEN del worker: se cambia con wrangler secret put.');
    const token = nuevoToken();
    await run(env, 'UPDATE usuarios SET token_hash = ?, actualizado = ? WHERE id = ?', await hashToken(token), now(), u.id);
    return { usuario: usuarioPublico(u), token };
  }
  throw new HttpError(404, 'Ruta no encontrada.');
}

// ---------- Notas ----------
const NOTA_COLS = 'id, usuario_id, realizada_por, titulo, cuerpo, prioridad, estado, persona_id, fecha_limite, hora_limite, aviso_cant, aviso_unidad, alarma, alarma_enviada, subir_critica, duracion, origen, origen_ref, creada, actualizada, realizada_en, eliminada_en, borrar_en, version, checklist, repetir, serie, prio_antes, fotos';

// ---------- Notas recurrentes ----------
// Al marcar realizada una nota que se repite se crea la siguiente, con id fijo (serie_fecha) para que la app,
// el worker o dos dispositivos a la vez no la dupliquen. Solo existe la próxima repetición.
const REPETIR = ['laborables', 'semanal', 'quincenal', 'mensual'];
function fechaSiguiente(f, repetir) {
  const d = new Date(f + 'T12:00:00Z');
  if (repetir === 'laborables') { do d.setUTCDate(d.getUTCDate() + 1); while ([0, 6].includes(d.getUTCDay())); }
  else if (repetir === 'semanal') d.setUTCDate(d.getUTCDate() + 7);
  else if (repetir === 'quincenal') d.setUTCDate(d.getUTCDate() + 14);
  else if (repetir === 'mensual') {
    const dia = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1);
    d.setUTCDate(Math.min(dia, new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()));
  }
  return d.toISOString().slice(0, 10);
}
// Próxima repetición: desde su fecha límite, avanzando hasta hoy o después (si se marca con retraso).
function proximaRepeticion(n) {
  const hoy = partesMadrid(Date.now()).fecha;
  let f = n.fecha_limite || hoy;
  do f = fechaSiguiente(f, n.repetir); while (f < hoy);
  const serie = n.serie || n.id;
  return {
    id: serie + '_' + f, serie, repetir: n.repetir, titulo: n.titulo, cuerpo: n.cuerpo || '',
    prioridad: n.prio_antes || n.prioridad, persona_id: n.persona_id, fecha_limite: f, hora_limite: n.hora_limite,
    aviso_unidad: n.aviso_unidad, aviso_cant: n.aviso_cant, duracion: n.duracion, subir_critica: n.subir_critica,
    checklist: (n.checklist || []).map(p => ({ t: p.t, hecho: false })), etiquetas: n.etiquetas || [], origen: 'app',
    responsables: n.responsables || [],
  };
}

// Checklist: lista de puntos [{ t, hecho }]. En la base se guarda como texto JSON; hacia fuera, como lista.
const CHECK_MAX = 50;
function limpiarChecklist(v) {
  const lista = (Array.isArray(v) ? v : []).map(p => typeof p === 'string' ? { t: p } : p || {})
    .map(p => ({ t: txt(p.t, 200).trim(), hecho: !!p.hecho })).filter(p => p.t).slice(0, CHECK_MAX);
  return lista;
}
function leerChecklist(s) { try { return limpiarChecklist(JSON.parse(s || '[]')); } catch { return []; } }
function leerFotos(s) { try { const l = JSON.parse(s || '[]'); return Array.isArray(l) ? l : []; } catch { return []; } }
// Deja una nota leída de la base lista para enviarla (checklist y fotos como listas).
const prepararNota = n => { n.checklist = leerChecklist(n.checklist); n.fotos = leerFotos(n.fotos); return n; };

// ---------- Fotos (Cloudflare R2, binding FOTOS) ----------
// Cada foto se guarda en dos tamaños que prepara la app: «mini» (miniatura) y «grande». La lista de la nota
// (columna fotos) solo se toca desde estas rutas y no sube la versión, para no provocar conflictos al editar.
const FOTOS_MAX = 12, FOTO_BYTES = 5 * 1024 * 1024, TIPOS_FOTO = ['mini', 'grande'];
const claveFoto = (nota, foto, tipo) => `fotos/${nota}/${foto}-${tipo}.jpg`;
function hayR2(env) { if (!env.FOTOS) throw new HttpError(500, 'Falta el almacén de fotos (R2) con el nombre FOTOS en el worker.'); }
async function fotosDe(env, notaId) {
  const n = await first(env, `SELECT fotos FROM notas WHERE id = ? AND ${VISIBLE}`, notaId, ...vis(env));
  if (!n) throw new HttpError(404, 'La nota ya no existe.');
  return leerFotos(n.fotos);
}
async function subirFoto(env, notaId, fotoId, tipo, request, url) {
  hayR2(env);
  if (!isId(fotoId) || !TIPOS_FOTO.includes(tipo)) throw new HttpError(400, 'Foto no válida.');
  const lista = await fotosDe(env, notaId), existe = lista.some(f => f.id === fotoId);
  if (!existe && lista.length >= FOTOS_MAX) throw new HttpError(400, `Una nota admite como máximo ${FOTOS_MAX} fotos.`);
  const buf = await request.arrayBuffer();
  if (!buf.byteLength) throw new HttpError(400, 'La foto está vacía.');
  if (buf.byteLength > FOTO_BYTES) throw new HttpError(413, 'La foto es demasiado grande.');
  await env.FOTOS.put(claveFoto(notaId, fotoId, tipo), buf, { httpMetadata: { contentType: 'image/jpeg' } });
  if (tipo === 'grande' && !existe) {
    const dim = k => Math.min(Math.max(parseInt(url.searchParams.get(k), 10) || 0, 0), 10000);
    lista.push({ id: fotoId, ancho: dim('ancho'), alto: dim('alto'), creada: now() });
    await run(env, 'UPDATE notas SET fotos = ? WHERE id = ?', JSON.stringify(lista), notaId);
  }
  return { fotos: lista };
}
async function quitarFoto(env, notaId, fotoId) {
  hayR2(env);
  const lista = (await fotosDe(env, notaId)).filter(f => f.id !== fotoId);
  await env.FOTOS.delete(TIPOS_FOTO.map(t => claveFoto(notaId, fotoId, t)));
  await run(env, 'UPDATE notas SET fotos = ? WHERE id = ?', lista.length ? JSON.stringify(lista) : null, notaId);
  return { fotos: lista };
}
// Al borrar notas definitivamente, también sus fotos.
async function borrarFotosDe(env, ids) {
  if (!env.FOTOS) return;
  for (const id of ids) {
    let cursor;
    do {
      const r = await env.FOTOS.list({ prefix: `fotos/${id}/`, cursor });
      if (r.objects.length) await env.FOTOS.delete(r.objects.map(o => o.key));
      cursor = r.truncated ? r.cursor : undefined;
    } while (cursor);
  }
}

async function etiquetasDe(env, ids) {
  const mapa = {};
  for (let i = 0; i < ids.length; i += 90) {
    const trozo = ids.slice(i, i + 90);
    const filas = await all(env, `SELECT nota_id, etiqueta_id FROM nota_etiquetas WHERE nota_id IN (${trozo.map(() => '?').join(',')})`, ...trozo);
    for (const f of filas) (mapa[f.nota_id] = mapa[f.nota_id] || []).push(f.etiqueta_id);
  }
  return mapa;
}

async function leerNota(env, id) {
  const n = await first(env, `SELECT ${NOTA_COLS} FROM notas WHERE id = ? AND ${VISIBLE}`, id, ...vis(env));
  if (!n) return null;
  n.etiquetas = (await all(env, 'SELECT etiqueta_id FROM nota_etiquetas WHERE nota_id = ?', id)).map(r => r.etiqueta_id);
  n.responsables = (await responsablesDe(env, [id]))[id] || [];
  return prepararNota(n);
}

async function limpiarCampos(env, b, parcial) {
  const c = {};
  if (!parcial || 'titulo' in b) {
    c.titulo = txt(b.titulo, 200).trim();
    if (!c.titulo) throw new HttpError(400, 'La nota necesita un título.');
  }
  if (!parcial || 'cuerpo' in b) c.cuerpo = txt(b.cuerpo, 8000);
  if (!parcial || 'prioridad' in b) {
    c.prioridad = PRIORIDADES.includes(b.prioridad) ? b.prioridad : 'normal';
    c.prio_antes = null;   // la prioridad elegida a mano anula la subida automática a Urgente
  }
  if ('repetir' in b) c.repetir = REPETIR.includes(b.repetir) ? b.repetir : null;
  if ('serie' in b) c.serie = isId(b.serie) ? b.serie : null;
  if ('persona_id' in b) c.persona_id = isId(b.persona_id) ? b.persona_id : null;
  if ('fecha_limite' in b) c.fecha_limite = fechaOk(b.fecha_limite) ? b.fecha_limite : null;
  if ('hora_limite' in b) c.hora_limite = horaOk(b.hora_limite) ? b.hora_limite : null;
  if ('aviso_unidad' in b || 'aviso_cant' in b) {
    const ok = avisoOk(b.aviso_unidad, b.aviso_cant);
    c.aviso_unidad = ok ? b.aviso_unidad : null;
    c.aviso_cant = ok ? b.aviso_cant : null;
  }
  if ('fecha_limite' in c && !c.fecha_limite) { c.hora_limite = null; c.aviso_unidad = null; c.aviso_cant = null; }
  // "alarma" solo llega de la versión anterior de la app; la nueva envía la fecha, la hora y el aviso.
  if ('alarma' in b) c.alarma = isoOk(b.alarma) ? new Date(b.alarma).toISOString() : null;
  if ('subir_critica' in b) c.subir_critica = b.subir_critica ? 1 : 0;
  if ('duracion' in b) c.duracion = Number.isInteger(b.duracion) && b.duracion > 0 && b.duracion <= 1440 ? b.duracion : null;
  if ('checklist' in b) { const l = limpiarChecklist(b.checklist); c.checklist = l.length ? JSON.stringify(l) : null; }
  if ('estado' in b) {
    if (!ESTADOS.includes(b.estado)) throw new HttpError(400, 'Estado no válido.');
    c.estado = b.estado;
  }
  return c;
}

// Recalcula el próximo aviso cuando cambian la fecha límite, su hora o la antelación.
const CAMPOS_AVISO = ['fecha_limite', 'hora_limite', 'aviso_cant', 'aviso_unidad'];
function reprogramar(c, antes) {
  if ('alarma' in c) return;
  if (!CAMPOS_AVISO.some(k => k in c && (!antes || (c[k] ?? null) !== (antes[k] ?? null)))) return;
  c.alarma = proximoAviso({ ...(antes || {}), ...c }, Date.now());
  c.alarma_enviada = 0;
}

async function ponerEtiquetas(env, notaId, ids) {
  const validas = new Set((await all(env, 'SELECT id FROM etiquetas')).map(r => r.id));   // catálogo común
  const lista = [...new Set((Array.isArray(ids) ? ids : []).filter(id => validas.has(id)))].slice(0, 30);
  const ops = [env.DB.prepare('DELETE FROM nota_etiquetas WHERE nota_id = ?').bind(notaId)];
  for (const id of lista) ops.push(env.DB.prepare('INSERT OR IGNORE INTO nota_etiquetas (nota_id, etiqueta_id) VALUES (?, ?)').bind(notaId, id));
  await env.DB.batch(ops);
}

function efectosEstado(c, antes) {
  // Fechas que acompañan a cada estado.
  if (!('estado' in c) || (antes && antes.estado === c.estado)) return;
  const t = now();
  if (c.estado === 'realizada') { c.realizada_en = t; c.eliminada_en = null; c.borrar_en = plus(RETENCION_REALIZADAS); }
  if (c.estado === 'papelera') { c.eliminada_en = t; c.borrar_en = plus(RETENCION_PAPELERA); }
  if (c.estado === 'activa') { c.realizada_en = null; c.eliminada_en = null; c.borrar_en = null; }
  c.aviso30 = 0; c.aviso7 = 0;
}

async function crearNota(env, b, dispositivo, { avisar = true } = {}) {
  const id = isId(b.id) ? b.id : uuid();
  const existe = await leerNota(env, id);
  if (existe) return existe;   // reintento de una creación que ya llegó
  if (await first(env, 'SELECT 1 AS x FROM notas WHERE id = ?', id)) throw new HttpError(409, 'Ese identificador de nota ya está en uso.');
  const c = await limpiarCampos(env, b, false);
  c.estado = c.estado || 'activa';
  efectosEstado(c, null);
  reprogramar(c, null);
  const t = now();
  const fila = {
    id, usuario_id: env.U, titulo: c.titulo, cuerpo: c.cuerpo || '', prioridad: c.prioridad, estado: c.estado,
    persona_id: null, fecha_limite: c.fecha_limite || null, hora_limite: c.hora_limite || null,
    aviso_cant: c.aviso_cant || null, aviso_unidad: c.aviso_unidad || null, alarma: c.alarma || null, alarma_enviada: 0,
    subir_critica: 'subir_critica' in c ? c.subir_critica : 1, duracion: c.duracion || null, checklist: c.checklist || null,
    repetir: c.repetir || null, serie: c.serie || null,
    origen: ['manual', 'voz', 'app', 'csv', 'ics'].includes(b.origen) ? b.origen : 'manual', origen_ref: b.origen_ref ? txt(b.origen_ref, 200) : null,
    transcripcion: b.transcripcion ? txt(b.transcripcion, 20000) : null,
    creada: t, actualizada: t, realizada_en: c.realizada_en || null, eliminada_en: c.eliminada_en || null, borrar_en: c.borrar_en || null,
    realizada_por: c.estado === 'realizada' ? env.U : null, version: 1,
  };
  const cols = Object.keys(fila);
  await run(env, `INSERT INTO notas (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...cols.map(k => fila[k]));
  await ponerEtiquetas(env, id, b.etiquetas);
  const resp = await responsablesDelCuerpo(env, b, [], env.U);
  const nuevos = resp ? await ponerResponsables(env, id, resp) : [];
  await run(env, 'INSERT INTO cambios (nota_id, usuario_id, fecha, dispositivo, accion, antes) VALUES (?, ?, ?, ?, ?, ?)', id, env.U, t, dispositivo, 'crear', null);
  const nota = await leerNota(env, id);
  if (avisar) await avisarAsignados(env, nota, nuevos);
  return nota;
}

async function editarNota(env, ctx, id, b, dispositivo) {
  const antes = await leerNota(env, id);
  if (!antes) throw new HttpError(404, 'La nota ya no existe. Puede que se haya borrado desde otro dispositivo.');
  if (!b.forzar && Number.isInteger(b.base_version) && b.base_version !== antes.version) {
    throw new HttpError(409, 'Esta nota se ha modificado desde otro dispositivo.', { conflicto: true, servidor: antes });
  }
  const c = await limpiarCampos(env, b, true);
  delete c.persona_id;   // va con los responsables
  if (c.estado === 'papelera' && antes.estado !== 'papelera' && antes.usuario_id !== env.U) {
    throw new HttpError(403, 'Solo quien creó la nota puede enviarla a la papelera.');
  }
  efectosEstado(c, antes);
  if ('estado' in c && c.estado !== antes.estado) c.realizada_por = c.estado === 'realizada' ? env.U : null;
  reprogramar(c, antes);
  if ('alarma' in c && c.alarma === antes.alarma) { delete c.alarma; delete c.alarma_enviada; }
  else if ('alarma' in c) c.alarma_enviada = 0;
  const t = now();
  c.actualizada = t;
  const cols = Object.keys(c);
  await run(env, `UPDATE notas SET ${cols.map(k => k + ' = ?').join(', ')}, version = version + 1 WHERE id = ?`, ...cols.map(k => c[k]), id);
  if (Array.isArray(b.etiquetas)) await ponerEtiquetas(env, id, b.etiquetas);
  const resp = await responsablesDelCuerpo(env, b, antes.responsables, antes.usuario_id);
  const nuevos = resp ? await ponerResponsables(env, id, resp) : [];
  await run(env, 'INSERT INTO cambios (nota_id, usuario_id, fecha, dispositivo, accion, antes) VALUES (?, ?, ?, ?, ?, ?)',
    id, env.U, t, dispositivo, c.estado && c.estado !== antes.estado ? 'estado:' + c.estado : 'editar', JSON.stringify(antes));
  await seguirSerie(env, antes, c.estado, dispositivo);
  // Si el aviso ya se mostró y la nota se ha resuelto o reprogramado, se retira de los demás dispositivos.
  if (antes.alarma_enviada && (c.estado && c.estado !== 'activa' || 'alarma' in c)) ctx.waitUntil(cerrarAvisos(env, id, null));
  const nota = await leerNota(env, id);
  if (!nota) return { id, sin_acceso: true };   // se ha quitado a sí mismo de responsable
  await avisarAsignados(env, nota, nuevos);
  if (c.estado === 'realizada' && antes.estado !== 'realizada') await avisarHecha(env, nota);
  return nota;
}

// Nota recurrente: al realizarla se crea la siguiente; al deshacer, se quita la siguiente si nadie la ha tocado.
async function seguirSerie(env, antes, estado, dispositivo) {
  if (!antes.repetir || !estado || estado === antes.estado) return;
  // La siguiente repetición es del mismo dueño y con los mismos responsables, la marque quien la marque.
  if (estado === 'realizada' && antes.estado === 'activa') await crearNota(conUsuario(env, antes.usuario_id), proximaRepeticion(antes), dispositivo, { avisar: false });
  if (estado === 'activa' && antes.estado === 'realizada') {
    const sig = await leerNota(env, proximaRepeticion(antes).id);
    if (sig && sig.version === 1 && sig.estado === 'activa') await borrarDefinitivo(env, [sig.id]);
  }
}

async function accionAlarma(env, ctx, id, b, dispositivo) {
  const n = await leerNota(env, id);
  if (!n) throw new HttpError(404, 'La nota ya no existe.');
  if (b.accion === 'hecha') {
    const c = { estado: 'realizada' };
    efectosEstado(c, n);
    await run(env, 'UPDATE notas SET estado = ?, realizada_en = ?, realizada_por = ?, eliminada_en = NULL, borrar_en = ?, aviso30 = 0, aviso7 = 0, actualizada = ?, version = version + 1 WHERE id = ?',
      'realizada', c.realizada_en, env.U, c.borrar_en, now(), id);
    await seguirSerie(env, n, 'realizada', dispositivo);
    if (n.estado !== 'realizada') await avisarHecha(env, await leerNota(env, id));
  } else if (b.accion === 'posponer') {
    const min = Math.min(Math.max(parseInt(b.minutos, 10) || 10, 1), 24 * 60);
    await run(env, 'UPDATE notas SET alarma = ?, alarma_enviada = 0, actualizada = ?, version = version + 1 WHERE id = ?',
      new Date(Date.now() + min * 60000).toISOString(), now(), id);
  } else throw new HttpError(400, 'Acción no válida.');
  await run(env, 'INSERT INTO cambios (nota_id, usuario_id, fecha, dispositivo, accion, antes) VALUES (?, ?, ?, ?, ?, ?)', id, env.U, now(), dispositivo, 'aviso:' + b.accion, JSON.stringify(n));
  ctx.waitUntil(cerrarAvisos(env, id, typeof b.endpoint === 'string' ? b.endpoint : null));
  return leerNota(env, id);
}

// ---------- Etiquetas, personas y grupos ----------
async function guardarEtiqueta(env, id, b) {
  const t = now();
  const actual = id ? await first(env, 'SELECT * FROM etiquetas WHERE id = ?', id) : null;   // catálogo común
  if (id && !actual && !b.crear) throw new HttpError(404, 'La etiqueta no existe.');
  const nombre = 'nombre' in b ? String(b.nombre || '').replace(/^#/, '').trim() : actual && actual.nombre;
  if (!nombreEtiquetaOk(nombre)) throw new HttpError(400, 'El nombre de la etiqueta solo puede tener letras, números, guion y guion bajo, sin espacios.');
  const repetida = (await all(env, 'SELECT id, nombre FROM etiquetas'))
    .find(e => norm(e.nombre) === norm(nombre) && e.id !== (actual ? actual.id : id));
  if (repetida) throw new HttpError(409, 'Ya existe la etiqueta #' + repetida.nombre + '.', { etiqueta: repetida });
  const tipo = TIPOS_ETIQUETA.includes(b.tipo) ? b.tipo : (actual ? actual.tipo : 'otra');
  const alias = 'alias' in b ? txt(b.alias, 300) : (actual ? actual.alias : '');
  let archivo = null;
  if (!actual) {
    const nuevoId = isId(id) && !(await first(env, 'SELECT 1 AS x FROM etiquetas WHERE id = ?', id)) ? id : uuid();
    await run(env, 'INSERT INTO etiquetas (id, usuario_id, nombre, tipo, alias, cerrada, creada, actualizada) VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
      nuevoId, env.U, nombre, tipo, alias, t, t);
    id = nuevoId;
  } else {
    let cerrada = actual.cerrada, cerradaEn = actual.cerrada_en;
    if ('cerrada' in b && !!b.cerrada !== !!actual.cerrada) {
      if (!env.A && actual.usuario_id !== env.U) throw new HttpError(403, 'Solo quien creó la etiqueta o el administrador puede cerrarla o reabrirla.');
      cerrada = b.cerrada ? 1 : 0;
      cerradaEn = cerrada ? t : null;
      if (cerrada) {
        // Al cerrar una obra se archiva un informe con todas sus notas y las realizadas caducadas
        // tienen 30 días de margen antes de borrarse.
        archivo = await archivarEtiqueta(env, id, nombre, 'Cierre de la obra #' + nombre);
        await run(env, `UPDATE notas SET borrar_en = ?, aviso30 = 0, aviso7 = 0 WHERE estado = 'realizada' AND borrar_en < ?
                        AND id IN (SELECT nota_id FROM nota_etiquetas WHERE etiqueta_id = ?)`, plus(30), plus(30), id);
      }
    }
    await run(env, 'UPDATE etiquetas SET nombre = ?, tipo = ?, alias = ?, cerrada = ?, cerrada_en = ?, actualizada = ? WHERE id = ?',
      nombre, tipo, alias, cerrada, cerradaEn, t, id);
  }
  const etiqueta = await first(env, 'SELECT id, nombre, tipo, alias, cerrada, cerrada_en FROM etiquetas WHERE id = ?', id);
  return { etiqueta, archivo };
}

async function guardarPersona(env, id, b) {
  const nombre = txt(b.nombre, 80).trim();
  if (!nombre) throw new HttpError(400, 'Escribe el nombre o el cargo de la persona.');
  const cargo = txt(b.cargo, 80).trim();
  const existe = id ? await first(env, 'SELECT id FROM personas WHERE id = ?', id) : null;   // catálogo común
  if (existe) await run(env, 'UPDATE personas SET nombre = ?, cargo = ? WHERE id = ?', nombre, cargo, id);
  else { id = isId(id) ? id : uuid(); await run(env, 'INSERT INTO personas (id, usuario_id, nombre, cargo, creada) VALUES (?, ?, ?, ?, ?)', id, env.U, nombre, cargo, now()); }
  if ('usuario_vinculado' in b) {
    // Vincular una persona a una cuenta comparte con ese usuario todas las notas en que es responsable.
    if (!env.A) throw new HttpError(403, 'Solo el administrador puede vincular una persona a un usuario.');
    const u = b.usuario_vinculado ? await first(env, 'SELECT id FROM usuarios WHERE id = ?', b.usuario_vinculado) : null;
    if (b.usuario_vinculado && !u) throw new HttpError(400, 'El usuario no existe.');
    await run(env, 'UPDATE personas SET usuario_vinculado = ? WHERE id = ?', u ? u.id : null, id);
  }
  return first(env, 'SELECT id, nombre, cargo, usuario_vinculado FROM personas WHERE id = ?', id);
}

async function guardarVista(env, id, b) {
  const nombre = txt(b.nombre, 60).trim();
  if (!nombre) throw new HttpError(400, 'El grupo filtrado necesita un nombre.');
  const filtro = JSON.stringify(b.filtro && typeof b.filtro === 'object' ? b.filtro : {}).slice(0, 4000);
  const existe = id ? await first(env, 'SELECT id FROM vistas WHERE id = ? AND usuario_id = ?', id, env.U) : null;
  if (existe) await run(env, 'UPDATE vistas SET nombre = ?, filtro = ? WHERE id = ?', nombre, filtro, id);
  else {
    id = isId(id) && !(await first(env, 'SELECT 1 AS x FROM vistas WHERE id = ?', id)) ? id : uuid();
    const max = await first(env, 'SELECT COALESCE(MAX(orden), 0) AS m FROM vistas WHERE usuario_id = ?', env.U);
    await run(env, 'INSERT INTO vistas (id, usuario_id, nombre, filtro, orden) VALUES (?, ?, ?, ?, ?)', id, env.U, nombre, filtro, (max ? max.m : 0) + 1);
  }
  const v = await first(env, 'SELECT id, nombre, filtro, orden FROM vistas WHERE id = ?', id);
  v.filtro = JSON.parse(v.filtro);
  return v;
}

async function leerDatos(env) {
  const notas = await all(env, `SELECT ${NOTA_COLS} FROM notas WHERE ${VISIBLE} ORDER BY creada`, ...vis(env));
  const mapa = await etiquetasDe(env, notas.map(n => n.id)), resp = await responsablesDe(env, notas.map(n => n.id));
  for (const n of notas) { n.etiquetas = mapa[n.id] || []; n.responsables = resp[n.id] || []; prepararNota(n); }
  const etiquetas = await all(env, 'SELECT id, nombre, tipo, alias, cerrada, cerrada_en, usuario_id AS creada_por FROM etiquetas ORDER BY nombre');
  const personas = await all(env, 'SELECT id, nombre, cargo, usuario_vinculado, usuario_id AS creada_por FROM personas ORDER BY nombre');
  const usuarios = await all(env, 'SELECT id, nombre FROM usuarios WHERE activo = 1 ORDER BY nombre');   // para elegir responsables
  const vistas = (await all(env, 'SELECT id, nombre, filtro, orden FROM vistas WHERE usuario_id = ? ORDER BY orden', env.U))
    .map(v => ({ ...v, filtro: JSON.parse(v.filtro || '{}') }));
  const config = {};
  for (const r of await all(env, `SELECT clave, valor FROM config_usuario WHERE usuario_id = ? AND clave IN (${CONFIG_PUBLICA.map(() => '?').join(',')})`, env.U, ...CONFIG_PUBLICA)) config[r.clave] = r.valor;
  const u = await first(env, 'SELECT * FROM usuarios WHERE id = ?', env.U);
  return { notas, etiquetas, personas, vistas, config, usuario: u ? usuarioPublico(u) : null, usuarios, ahora: now(), api: API };
}

// ---------- Informes archivados ----------
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PRIO_NOMBRE = { critica: 'Urgente', alta: 'Alta', normal: 'Normal', baja: 'Baja' };
const fechaEs = iso => iso ? new Date(iso).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
const diaEs = d => d ? d.split('-').reverse().join('/') : '';

function informeHtml(titulo, notas, etiquetas, personas) {
  const eMap = Object.fromEntries(etiquetas.map(e => [e.id, e.nombre]));
  const pMap = Object.fromEntries(personas.map(p => [p.id, p.nombre]));
  const filas = notas.map(n => `
    <tr>
      <td>${esc(PRIO_NOMBRE[n.prioridad] || n.prioridad)}</td>
      <td><b>${esc(n.titulo)}</b>${n.cuerpo ? '<br>' + esc(n.cuerpo).replace(/\n/g, '<br>') : ''}${(n.checklist || []).map(p => '<br>' + (p.hecho ? '☑ ' : '☐ ') + esc(p.t)).join('')}${(n.fotos || []).length ? `<br>📷 ${n.fotos.length} ${n.fotos.length === 1 ? 'foto' : 'fotos'}` : ''}</td>
      <td>${(n.etiquetas || []).map(id => '#' + esc(eMap[id] || '')).join(' ')}</td>
      <td>${esc(pMap[n.persona_id] || '')}</td>
      <td>${esc(n.estado === 'realizada' ? 'Realizada ' + fechaEs(n.realizada_en) : n.estado === 'papelera' ? 'Eliminada' : 'Pendiente')}
        ${n.fecha_limite ? '<br>Límite ' + esc(diaEs(n.fecha_limite)) + (n.hora_limite ? ' ' + esc(n.hora_limite) : '') : ''}<br>Creada ${esc(fechaEs(n.creada))}</td>
    </tr>`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(titulo)}</title>
<style>body{font-family:Barlow,Arial,sans-serif;color:#16324F;margin:24px}h1{font-size:22px;margin:0 0 4px}p{color:#52627A;margin:0 0 16px}
table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #D6E2F0;padding:6px 8px;text-align:left;vertical-align:top}
th{background:#EAF3FE}</style></head><body><h1>${esc(titulo)}</h1><p>${notas.length} notas · Generado el ${esc(fechaEs(now()))}</p>
<table><thead><tr><th>Prioridad</th><th>Nota</th><th>Etiquetas</th><th>Asignada a</th><th>Estado y fechas</th></tr></thead><tbody>${filas}</tbody></table></body></html>`;
}

async function guardarArchivo(env, titulo, motivo, notas) {
  if (!notas.length) return null;
  const etiquetas = await all(env, 'SELECT id, nombre FROM etiquetas');
  const personas = await all(env, 'SELECT id, nombre FROM personas');
  const id = uuid();
  await run(env, 'INSERT INTO archivos (id, usuario_id, titulo, motivo, creado, notas, html) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, env.U, titulo, motivo, now(), notas.length, informeHtml(titulo, notas, etiquetas, personas));
  return id;
}

async function archivarEtiqueta(env, etiquetaId, nombre, motivo) {
  // Cierre de una obra: el informe lleva todas sus notas, de cualquier usuario (las etiquetas son comunes).
  const notas = await all(env, `SELECT ${NOTA_COLS} FROM notas WHERE id IN (SELECT nota_id FROM nota_etiquetas WHERE etiqueta_id = ?) ORDER BY creada`, etiquetaId);
  const mapa = await etiquetasDe(env, notas.map(n => n.id));
  for (const n of notas) { n.etiquetas = mapa[n.id] || []; prepararNota(n); }
  return guardarArchivo(env, 'Notas de #' + nombre, motivo, notas);
}

// ---------- Claude: análisis del dictado ----------
const SYSTEM = `Eres el asistente de un jefe de obra de una empresa constructora. Conviertes lo que dicta en notas breves y accionables para su app de notas.

Reglas:
- Si el dictado menciona varios asuntos independientes, crea una nota por asunto. Si es un solo asunto, una sola nota.
- titulo: corto (máximo 8 palabras), empezando por un verbo cuando sea una acción ("Llamar al fontanero", "Revisar línea de vida").
- cuerpo: los detalles útiles en una o dos frases, en castellano correcto. Corrige errores evidentes de transcripción usando el contexto de obra. No inventes nada.
- prioridad: critica (en la app se llama "Urgente": riesgo de seguridad, paralización, hormigonados o plazos de hoy o mañana), alta (importante con plazo cercano), normal (por defecto), baja (cuando se diga que no corre prisa). Si se dice explícitamente la urgencia, respétala ("urgente" o "crítico" es critica).
- etiquetas: elige SOLO de la lista de etiquetas existentes. Usa sus alias para reconocerlas cuando se mencionen de otra forma ("la de Mallorca", "los carpinteros"). En evidencias indica las palabras que has oído y la etiqueta asociada.
- etiquetas_nuevas: solo si se menciona claramente una obra, industrial o asunto que no está en la lista y sería útil etiquetarlo. Nombre sin espacios (por ejemplo "Fontaneria" o "Nave_Sabadell"). En similar pon la etiqueta existente más parecida, o vacío si no hay ninguna.
- persona: solo de la lista de personas existentes, cuando se diga que la nota es para alguien o que alguien tiene que hacerla. Si no, vacío.
- fecha_limite (AAAA-MM-DD): cuando se diga para cuándo hay que hacerlo, o el día en que se pide un aviso o recordatorio. Calcula las fechas relativas ("el jueves", "la semana que viene") a partir de la fecha actual que se indica.
- hora_limite (HH:MM, 24 h, hora local, siempre con dos cifras: "09:30"): cuando se diga una hora o un momento concreto del día. Ejemplos: "a las 10" → 10:00; "a las 4 de la tarde" → 16:00; "sobre las 9 y media" → 09:30; "a las 8 menos cuarto" → 07:45; "a las 12 y cuarto" → 12:15; "a mediodía" → 12:00; "a primera hora" → 08:00; "a última hora" o "al final del día" → 18:00. En obra, una hora de 1 a 6 sin más es de la tarde ("a las 3" → 15:00) y de 7 a 11 es de la mañana. Si se dice una hora sin día, la fecha límite es hoy, o mañana si esa hora ya ha pasado. A la hora límite la app avisa siempre; no hace falta pedirlo.
- aviso_unidad (h, d o s) y aviso_cant: solo si se pide que avise con antelación ("avísame un día antes" → d y 1; "dos horas antes" → h y 2; "una semana antes" → s y 1). Horas de 1 a 12, días de 1 a 7, semanas de 1 a 4. Si no se pide, unidad vacía y 0.
- checklist: solo si se enumeran pasos o elementos concretos que hay que ir marcando ("pedir oferta a tres industriales: Puertas Vidal, Carpintería Roca y Alumisa" → un punto por industrial). Textos cortos. Si no, vacío.
- repetir: solo si se dice que se repite: laborables ("cada día", "todos los días laborables"), semanal ("cada lunes", "todas las semanas"), quincenal ("cada dos semanas"), mensual ("cada mes", "el día 5 de cada mes"). Pon también la fecha límite de la primera vez. Si no, vacío.
- duracion (minutos): solo si se dice cuánto va a durar ("reunión de una hora"). Si no, 0.
- Deja vacíos los campos que no se mencionen.`;

const TOOL = {
  name: 'guardar_notas',
  description: 'Guarda las notas extraídas del dictado.',
  input_schema: {
    type: 'object',
    properties: {
      notas: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            titulo: { type: 'string' },
            cuerpo: { type: 'string' },
            prioridad: { type: 'string', enum: PRIORIDADES },
            etiquetas: { type: 'array', items: { type: 'string' } },
            evidencias: { type: 'array', items: { type: 'object', properties: { oido: { type: 'string' }, etiqueta: { type: 'string' } }, required: ['oido', 'etiqueta'] } },
            etiquetas_nuevas: { type: 'array', items: { type: 'object', properties: { nombre: { type: 'string' }, similar: { type: 'string' }, oido: { type: 'string' } }, required: ['nombre'] } },
            persona: { type: 'string' },
            fecha_limite: { type: 'string' },
            hora_limite: { type: 'string' },
            aviso_unidad: { type: 'string', enum: ['', 'h', 'd', 's'] },
            aviso_cant: { type: 'integer' },
            checklist: { type: 'array', items: { type: 'string' } },
            repetir: { type: 'string', enum: ['', ...REPETIR] },
            duracion: { type: 'integer' },
          },
          required: ['titulo', 'cuerpo', 'prioridad', 'etiquetas'],
        },
      },
    },
    required: ['notas'],
  },
};

async function analizar(env, b) {
  if (!env.ANTHROPIC_API_KEY) throw new HttpError(500, 'Falta ANTHROPIC_API_KEY en el worker.');
  const texto = txt(b.texto, 30000).trim();
  if (!texto) throw new HttpError(400, 'No hay texto que analizar.');
  const etiquetas = await all(env, 'SELECT nombre, tipo, alias, cerrada FROM etiquetas ORDER BY tipo, nombre');
  const personas = await all(env, 'SELECT nombre, cargo FROM personas ORDER BY nombre');
  const listaEt = etiquetas.filter(e => !e.cerrada).map(e => `- ${e.nombre} (${e.tipo}${e.alias ? '; alias: ' + e.alias : ''})`).join('\n') || '(ninguna todavía)';
  const listaPe = personas.map(p => `- ${p.nombre}${p.cargo ? ' (' + p.cargo + ')' : ''}`).join('\n') || '(ninguna todavía)';
  const ahora = txt(b.ahora_local, 60) || new Date().toLocaleString('es-ES', { timeZone: 'Europe/Madrid' });
  const contexto = `Fecha y hora actual: ${ahora}\n\nEtiquetas existentes (usa el nombre exacto):\n${listaEt}\n\nPersonas existentes:\n${listaPe}`;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: env.MODEL || DEFAULT_MODEL,
      max_tokens: 4000,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'guardar_notas' },
      messages: [{ role: 'user', content: contexto + '\n\nDictado (transcripción automática):\n"""\n' + texto + '\n"""' }],
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const busy = r.status === 529 || r.status === 503;
    throw new HttpError(502, busy ? 'Claude está saturado en este momento. El audio queda guardado: reinténtalo en un minuto.'
      : 'Error de Claude: ' + ((data.error && data.error.message) || 'HTTP ' + r.status));
  }
  const block = (data.content || []).find(x => x.type === 'tool_use' && x.name === 'guardar_notas');
  if (!block || !Array.isArray(block.input.notas)) throw new HttpError(502, 'Claude no ha devuelto notas. Reinténtalo.');

  // Validación: nunca se devuelve como existente una etiqueta o persona que no exista.
  const porNorm = Object.fromEntries(etiquetas.map(e => [norm(e.nombre), e.nombre]));
  const perNorm = Object.fromEntries(personas.map(p => [norm(p.nombre), p.nombre]));
  const notas = block.input.notas.slice(0, 20).map(n => {
    const existentes = [], nuevas = [];
    for (const nombre of n.etiquetas || []) {
      const e = porNorm[norm(String(nombre).replace(/^#/, ''))];
      if (e) { if (!existentes.includes(e)) existentes.push(e); }
      else nuevas.push({ nombre: String(nombre).replace(/^#/, ''), similar: '', oido: '' });
    }
    for (const x of n.etiquetas_nuevas || []) {
      const nombre = String(x.nombre || '').replace(/^#/, '').replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 40);
      if (!nombre) continue;
      if (porNorm[norm(nombre)]) { const e = porNorm[norm(nombre)]; if (!existentes.includes(e)) existentes.push(e); continue; }
      if (nuevas.some(y => norm(y.nombre) === norm(nombre))) continue;
      nuevas.push({ nombre, similar: porNorm[norm(x.similar || '')] || '', oido: txt(x.oido, 80) });
    }
    return {
      titulo: txt(n.titulo, 200).trim() || 'Nota dictada',
      cuerpo: txt(n.cuerpo, 4000).trim(),
      prioridad: PRIORIDADES.includes(n.prioridad) ? n.prioridad : 'normal',
      etiquetas: existentes,
      evidencias: (n.evidencias || []).filter(e => porNorm[norm(e.etiqueta)]).map(e => ({ oido: txt(e.oido, 80), etiqueta: porNorm[norm(e.etiqueta)] })).slice(0, 10),
      etiquetas_nuevas: nuevas.slice(0, 5),
      persona: perNorm[norm(n.persona)] || '',
      ...fechaHoraDictado(n),
      aviso_unidad: fechaOk(n.fecha_limite) && avisoOk(n.aviso_unidad, n.aviso_cant) ? n.aviso_unidad : '',
      aviso_cant: fechaOk(n.fecha_limite) && avisoOk(n.aviso_unidad, n.aviso_cant) ? n.aviso_cant : 0,
      duracion: Number.isInteger(n.duracion) && n.duracion > 0 ? Math.min(n.duracion, 1440) : 0,
      checklist: limpiarChecklist(n.checklist).map(p => p.t),
      repetir: REPETIR.includes(n.repetir) ? n.repetir : '',
    };
  });
  return { notas, uso: data.usage || null };
}

// Hora del dictado: admite "9:30", "9.30" o "9" y la deja en "09:30". Si hay hora pero no día,
// la fecha es hoy (o mañana si esa hora ya ha pasado en Madrid), como se pide a Claude.
function normHora(v) {
  const m = String(v || '').trim().match(/^(\d{1,2})(?:[:.h](\d{2}))?\s*h?$/i);
  if (!m) return '';
  const h = `${m[1].padStart(2, '0')}:${m[2] || '00'}`;
  return horaOk(h) ? h : '';
}
function fechaHoraDictado(n, ahora = Date.now()) {
  const hora = normHora(n.hora_limite);
  if (fechaOk(n.fecha_limite)) return { fecha_limite: n.fecha_limite, hora_limite: hora };
  if (!hora || n.fecha_limite) return { fecha_limite: '', hora_limite: '' };   // fecha mal escrita: mejor sin fecha
  const p = partesMadrid(ahora);
  return { fecha_limite: hora > p.hora ? p.fecha : sumarDias(p.fecha, 1), hora_limite: hora };
}

async function transcribir(env, request) {
  if (!env.AI) throw new HttpError(500, 'Falta el enlace de Workers AI con el nombre AI en el worker.');
  const buf = await request.arrayBuffer();
  if (!buf.byteLength) throw new HttpError(400, 'El audio está vacío.');
  if (buf.byteLength > MAX_AUDIO) throw new HttpError(413, 'El audio es demasiado largo. Graba tramos de menos de 10 minutos.');
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  const audio = btoa(bin);
  const nombres = (await all(env, 'SELECT nombre FROM etiquetas WHERE cerrada = 0 LIMIT 60')).map(e => e.nombre).join(', ');
  const prompt = ('Notas de obra. ' + nombres).slice(0, 400);
  let res;
  try { res = await env.AI.run(WHISPER, { audio, language: 'es', vad_filter: true, initial_prompt: prompt }); }
  catch (e) { res = await env.AI.run(WHISPER, { audio, language: 'es' }); }
  return { texto: String((res && res.text) || '').trim() };
}

// ---------- Notificaciones push (Web Push con VAPID y cifrado aes128gcm) ----------
const enc = s => new TextEncoder().encode(s);
const b64u = buf => { const b = new Uint8Array(buf); let s = ''; for (const x of b) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const concat = (...arrs) => { const out = new Uint8Array(arrs.reduce((a, x) => a + x.length, 0)); let o = 0; for (const x of arrs) { out.set(x, o); o += x.length; } return out; };

async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}
async function hkdf(salt, ikm, info, len) {
  const prk = await hmac(salt, ikm);
  return (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, len);
}

async function vapid(env) {
  let v = await getCfg(env, 'vapid');
  if (!v) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const nuevo = JSON.stringify({ jwk: await crypto.subtle.exportKey('jwk', kp.privateKey), pub: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)) });
    await run(env, 'INSERT OR IGNORE INTO config (clave, valor) VALUES (?, ?)', 'vapid', nuevo);
    v = await getCfg(env, 'vapid');
  }
  return JSON.parse(v);
}

async function jwtVapid(env, endpoint) {
  const { jwk, pub } = await vapid(env);
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64u(enc(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(enc(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || 'mailto:notas@example.com' })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc(head + '.' + body));
  return { jwt: head + '.' + body + '.' + b64u(sig), pub };
}

async function cifrar(p256dh, authB64, payload) {
  const uaPub = unb64u(p256dh), auth = unb64u(authB64);
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));
  const ikm = await hkdf(auth, shared, concat(enc('WebPush: info\0'), uaPub, asPub), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(enc(payload), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]);   // 4096
  return concat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}

async function enviarPush(env, sub, datos) {
  try {
    const { jwt, pub } = await jwtVapid(env, sub.endpoint);
    const body = await cifrar(sub.p256dh, sub.auth, JSON.stringify(datos));
    const r = await fetch(sub.endpoint, {
      method: 'POST',
      headers: { TTL: '86400', Urgency: 'high', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', Authorization: `vapid t=${jwt}, k=${pub}` },
      body,
    });
    if (r.status === 404 || r.status === 410) { await run(env, 'DELETE FROM suscripciones WHERE id = ?', sub.id); return false; }
    if (r.ok) await run(env, 'UPDATE suscripciones SET ultimo_uso = ? WHERE id = ?', now(), sub.id);
    return r.ok;
  } catch { return false; }
}

// Avisa a todos los dispositivos del usuario env.U.
async function avisarTodos(env, datos) {
  const subs = await all(env, 'SELECT * FROM suscripciones WHERE activo = 1 AND usuario_id = ?', env.U);
  const res = await Promise.all(subs.map(s => enviarPush(env, s, datos)));
  return res.filter(Boolean).length;
}

// Retira el aviso de una nota en los demás dispositivos. En iPhone no se envía: Safari exige mostrar
// una notificación por cada mensaje recibido y retiraría el permiso.
async function cerrarAvisos(env, notaId, excepto) {
  const us = await participantes(env, notaId);
  if (!us.length) return;
  const subs = await all(env, `SELECT * FROM suscripciones WHERE activo = 1 AND usuario_id IN (${us.map(() => '?').join(',')})`, ...us);
  await Promise.all(subs.filter(s => s.endpoint !== excepto && !s.endpoint.includes('push.apple.com'))
    .map(s => enviarPush(env, s, { tipo: 'cerrar', tag: 'nota-' + notaId })));
}

// ---------- Tareas programadas ----------
async function enviarAlarmas(env) {
  const vencidas = await all(env, `SELECT id, usuario_id, titulo, cuerpo, prioridad, fecha_limite, hora_limite, aviso_cant, aviso_unidad, alarma FROM notas
    WHERE estado = 'activa' AND alarma_enviada = 0 AND alarma IS NOT NULL AND alarma <= ? ORDER BY alarma LIMIT 40`, now());
  for (const n of vencidas) {
    // Tras el aviso con antelación queda pendiente el de la hora límite.
    const siguiente = proximoAviso(n, Date.parse(n.alarma));
    if (siguiente) await run(env, 'UPDATE notas SET alarma = ?, alarma_enviada = 0 WHERE id = ?', siguiente, n.id);
    else await run(env, 'UPDATE notas SET alarma_enviada = 1 WHERE id = ?', n.id);
    const titulo = (n.prioridad === 'critica' ? '⚠ ' : '') + n.titulo;
    const limite = n.fecha_limite ? 'Fecha límite: ' + diaEs(n.fecha_limite) + (n.hora_limite ? ' a las ' + n.hora_limite : '') : '';
    const cuerpo = [limite, n.cuerpo || ''].filter(Boolean).join(' · ').slice(0, 180);
    // A todos los que participan: dueño y responsables con cuenta (solo usuarios activos).
    await avisarUsuarios(env, await participantes(env, n.id), { tipo: 'alarma', nota_id: n.id, titulo, cuerpo, tag: 'nota-' + n.id });
  }
}

async function subirPrioridades(env) {
  const manana = new Date(Date.now() + DIA).toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
  // prio_antes guarda la prioridad elegida, para que la siguiente repetición no nazca ya como Urgente.
  await run(env, `UPDATE notas SET prio_antes = prioridad, prioridad = 'critica', actualizada = ?, version = version + 1
    WHERE estado = 'activa' AND subir_critica = 1 AND prioridad != 'critica' AND fecha_limite IS NOT NULL AND fecha_limite <= ?`, now(), manana);
}

const SIN_OBRA_ABIERTA = `NOT EXISTS (SELECT 1 FROM nota_etiquetas ne JOIN etiquetas e ON e.id = ne.etiqueta_id
   WHERE ne.nota_id = notas.id AND e.tipo = 'obra' AND e.cerrada = 0)`;

async function tareaDiaria(env) {
  const t = now();
  // 1. Papelera: lo que lleva 30 días se borra definitivamente.
  const papelera = await all(env, `SELECT id FROM notas WHERE estado = 'papelera' AND borrar_en <= ?`, t);
  await borrarDefinitivo(env, papelera.map(n => n.id));

  // 2. Realizadas con más de un año: primero se archiva un informe y después se borran.
  //    Las que pertenecen a una obra todavía abierta se conservan.
  //    Cada usuario recibe su propio informe.
  const caducadas = await all(env, `SELECT ${NOTA_COLS} FROM notas WHERE estado = 'realizada' AND borrar_en <= ? AND ${SIN_OBRA_ABIERTA} ORDER BY realizada_en`, t);
  if (caducadas.length) {
    const mapa = await etiquetasDe(env, caducadas.map(n => n.id));
    for (const n of caducadas) { n.etiquetas = mapa[n.id] || []; prepararNota(n); }
    const hoy = new Date().toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid' });
    for (const [uid, lista] of Object.entries(porUsuario(caducadas)))
      await guardarArchivo(conUsuario(env, uid), 'Notas realizadas borradas el ' + hoy, 'Más de un año desde que se realizaron', lista);
    await borrarDefinitivo(env, caducadas.map(n => n.id));
  }

  // 3. Avisos 30 y 7 días antes del borrado de realizadas.
  for (const [dias, campo] of [[30, 'aviso30'], [7, 'aviso7']]) {
    const proximas = await all(env, `SELECT id, usuario_id, borrar_en FROM notas WHERE estado = 'realizada' AND ${campo} = 0 AND borrar_en <= ? AND ${SIN_OBRA_ABIERTA}`, plus(dias));
    if (!proximas.length) continue;
    const ids = proximas.map(n => n.id);
    for (let i = 0; i < ids.length; i += 90) {
      const trozo = ids.slice(i, i + 90);
      await run(env, `UPDATE notas SET ${campo} = 1 WHERE id IN (${trozo.map(() => '?').join(',')})`, ...trozo);
    }
    for (const [uid, lista] of Object.entries(porUsuario(proximas))) {
      const fecha = new Date(lista.map(n => Date.parse(n.borrar_en)).sort()[0]).toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'long' });
      await avisarTodos(conUsuario(env, uid), {
        tipo: 'info', tag: 'borrado-' + dias,
        titulo: lista.length === 1 ? '1 nota realizada se borrará pronto' : lista.length + ' notas realizadas se borrarán pronto',
        cuerpo: 'A partir del ' + fecha + '. Ábrelas en Historial para exportarlas o conservarlas.', url: '#/historial',
      });
    }
  }

  // 4. Historial de cambios antiguo.
  await run(env, 'DELETE FROM cambios WHERE fecha < ?', plus(-RETENCION_CAMBIOS));
}

const porUsuario = notas => { const m = {}; for (const n of notas) (m[n.usuario_id] = m[n.usuario_id] || []).push(n); return m; };

async function borrarDefinitivo(env, ids) {
  await borrarFotosDe(env, ids);
  for (let i = 0; i < ids.length; i += 90) {
    const trozo = ids.slice(i, i + 90), q = trozo.map(() => '?').join(',');
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM nota_etiquetas WHERE nota_id IN (${q})`).bind(...trozo),
      env.DB.prepare(`DELETE FROM notas WHERE id IN (${q})`).bind(...trozo),
    ]);
  }
}

// Resumen matutino: una vez al día, a la hora y en los días elegidos (hora de Madrid), un aviso con lo pendiente.
// Si el worker no corre justo a esa hora, se envía en cuanto pueda dentro del margen. Sin nada pendiente, no se envía.
async function resumenMatutino(env, ms = Date.now()) {
  const cfg = async (k, def) => { const v = await getCfgU(env, 'resumen_' + k); return v == null || v === '' ? def : v; };
  if ((await cfg('activo', RESUMEN.activo)) === '0') return null;
  const hora = await cfg('hora', RESUMEN.hora), dias = (await cfg('dias', RESUMEN.dias)).split(',').map(Number);
  const p = partesMadrid(ms), dow = (new Date(p.fecha + 'T12:00:00Z').getUTCDay() + 6) % 7 + 1;
  const desde = minutosHora(p.hora) - minutosHora(horaOk(hora) ? hora : RESUMEN.hora);
  if (!dias.includes(dow) || desde < 0 || desde > RESUMEN.margen) return null;
  if ((await getCfgU(env, 'resumen_ultimo')) === p.fecha) return null;
  await setCfgU(env, 'resumen_ultimo', p.fecha);
  const n = await first(env, `SELECT
      SUM(prioridad = 'critica') AS urgentes,
      SUM(fecha_limite = ? AND hora_limite IS NOT NULL) AS con_hora,
      SUM(actualizada < ?) AS estancadas
    FROM notas WHERE estado = 'activa' AND ${VISIBLE}`, p.fecha, plus(-ESTANCADA_DIAS, new Date(ms).toISOString()), ...vis(env));
  const partes = [[n.urgentes, 'urgente', 'urgentes'], [n.con_hora, 'con hora hoy', 'con hora hoy'], [n.estancadas, 'sin tocar', 'sin tocar']]
    .filter(([k]) => k > 0).map(([k, uno, varios]) => k + ' ' + (k === 1 ? uno : varios));
  if (!partes.length) return null;
  const datos = { tipo: 'info', tag: 'resumen', titulo: 'Buenos días', cuerpo: partes.join(' · '), url: '#/resumen' };
  await avisarTodos(env, datos);
  return datos;
}
const minutosHora = h => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));

async function programada(env) {
  await ensureSchema(env);
  await enviarAlarmas(env);
  for (const u of await all(env, 'SELECT id FROM usuarios WHERE activo = 1')) await resumenMatutino(conUsuario(env, u.id));
  const d = new Date();
  if (d.getUTCMinutes() % 15 === 0) await subirPrioridades(env);
  const hoy = d.toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
  const horaLocal = Number(d.toLocaleString('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false }));
  if (horaLocal >= 3 && (await getCfg(env, 'ultimo_diario')) !== hoy) {
    await setCfg(env, 'ultimo_diario', hoy);
    await tareaDiaria(env);
  }
}

// ---------- Servidor ----------
export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const permitido = env.ALLOWED_ORIGIN || '';
    const cors = {
      'Access-Control-Allow-Origin': origin && origin === permitido ? origin : permitido,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Dispositivo',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      if (!env.APP_TOKEN) return json({ error: 'Falta APP_TOKEN en el worker.' }, 500);
      const auth = request.headers.get('Authorization') || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const malToken = () => json({ error: 'Token incorrecto. Revisa el token en los ajustes de la app.' }, 401);
      if (!token || (token !== env.APP_TOKEN && token.length < 20)) return malToken();
      if (!env.DB) return json({ error: 'Falta la base de datos D1 con el nombre DB en el worker.' }, 500);
      await ensureSchema(env);
      const yo = await usuarioDelToken(env, token);
      if (!yo) return malToken();
      env = { ...conUsuario(env, yo.id), A: !!yo.admin };   // A: administrador

      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, '') || '/';
      const parts = path.split('/').filter(Boolean);
      const M = request.method;
      const disp = txt(request.headers.get('X-Dispositivo'), 60) || 'desconocido';

      if (M === 'GET' && path === '/estado') {
        const faltan = [];
        if (!env.AI) faltan.push('Enlace de Workers AI (AI)');
        if (!env.ANTHROPIC_API_KEY) faltan.push('ANTHROPIC_API_KEY');
        if (!env.FOTOS) faltan.push('Almacén de fotos R2 (FOTOS)');
        return json({ ok: true, faltan, version: 1, api: API, usuario: usuarioPublico(yo) });
      }
      if (M === 'GET' && path === '/yo') return json({ usuario: usuarioPublico(yo) });
      if (M === 'GET' && path === '/registro') return json(await registroHechas(env));
      if (parts[0] === 'usuarios') return json(await gestionUsuarios(env, M, parts, request, yo));
      if (M === 'GET' && path === '/datos') return json(await leerDatos(env));

      if (parts[0] === 'notas') {
        if (M === 'POST' && path === '/notas') return json({ nota: await crearNota(env, await readJson(request), disp) });
        if (M === 'POST' && path === '/notas/conservar') {
          const b = await readJson(request);
          const ids = (Array.isArray(b.ids) ? b.ids : []).filter(isId).slice(0, 500);
          for (let i = 0; i < ids.length; i += 90) {
            const trozo = ids.slice(i, i + 90);
            await run(env, `UPDATE notas SET borrar_en = ?, aviso30 = 0, aviso7 = 0, version = version + 1 WHERE estado = 'realizada' AND ${VISIBLE} AND id IN (${trozo.map(() => '?').join(',')})`, plus(RETENCION_REALIZADAS), ...vis(env), ...trozo);
          }
          return json({ ok: true, conservadas: ids.length });
        }
        const id = parts[1];
        if (!isId(id)) return json({ error: 'Nota no válida.' }, 400);
        if (M === 'PUT' && parts.length === 2) return json({ nota: await editarNota(env, ctx, id, await readJson(request), disp) });
        if (M === 'POST' && parts[2] === 'alarma') return json({ nota: await accionAlarma(env, ctx, id, await readJson(request), disp) });
        // Fotos: /notas/:id/fotos/:foto/:tipo (subir y ver) y /notas/:id/fotos/:foto (quitar)
        if (parts[2] === 'fotos' && parts[3]) {
          if (M === 'POST' && parts[4]) return json(await subirFoto(env, id, parts[3], parts[4], request, url));
          if (M === 'DELETE' && parts.length === 4) return json(await quitarFoto(env, id, parts[3]));
          if (M === 'GET' && TIPOS_FOTO.includes(parts[4])) {
            hayR2(env);
            await fotosDe(env, id);   // la nota tiene que ser del usuario
            const o = await env.FOTOS.get(claveFoto(id, parts[3], parts[4]));
            if (!o) return json({ error: 'La foto ya no existe.' }, 404);
            return new Response(o.body, { headers: { ...cors, 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=31536000, immutable' } });
          }
        }
        if (M === 'DELETE' && parts.length === 2) {
          const n = await leerNota(env, id);
          if (!n) return json({ ok: true });   // no existe o no la ve este usuario
          if (n.usuario_id !== env.U) return json({ error: 'Solo quien creó la nota puede borrarla.' }, 403);
          if (n.estado !== 'papelera') return json({ error: 'Solo se pueden borrar definitivamente las notas de la papelera.' }, 400);
          await borrarDefinitivo(env, [id]);
          return json({ ok: true });
        }
      }
      if (M === 'POST' && path === '/papelera/vaciar') {
        const ids = (await all(env, `SELECT id FROM notas WHERE estado = 'papelera' AND usuario_id = ?`, env.U)).map(n => n.id);
        await borrarDefinitivo(env, ids);
        return json({ ok: true, borradas: ids.length });
      }

      if (parts[0] === 'etiquetas') {
        if (M === 'POST' && parts.length === 1) { const b = await readJson(request); return json(await guardarEtiqueta(env, isId(b.id) ? b.id : null, { ...b, crear: true })); }
        if (M === 'PUT' && parts.length === 2) return json(await guardarEtiqueta(env, parts[1], await readJson(request)));
        if (M === 'DELETE' && parts.length === 2) {
          const e = await first(env, 'SELECT usuario_id FROM etiquetas WHERE id = ?', parts[1]);
          if (!e) return json({ ok: true });
          if (!env.A && e.usuario_id !== env.U) return json({ error: 'Solo quien creó la etiqueta o el administrador puede borrarla.' }, 403);
          await env.DB.batch([
            env.DB.prepare('DELETE FROM nota_etiquetas WHERE etiqueta_id = ?').bind(parts[1]),
            env.DB.prepare('DELETE FROM etiquetas WHERE id = ?').bind(parts[1]),
          ]);
          return json({ ok: true });
        }
      }
      if (parts[0] === 'personas') {
        if (M === 'POST' && parts.length === 1) { const b = await readJson(request); return json({ persona: await guardarPersona(env, isId(b.id) ? b.id : null, b) }); }
        if (M === 'PUT' && parts.length === 2) return json({ persona: await guardarPersona(env, parts[1], await readJson(request)) });
        if (M === 'POST' && parts.length === 3 && parts[2] === 'traspasar') return json(await traspasarPersona(env, parts[1], (await readJson(request)).usuario_id));
        if (M === 'DELETE' && parts.length === 2) {
          const pe = await first(env, 'SELECT usuario_id FROM personas WHERE id = ?', parts[1]);
          if (!pe) return json({ ok: true });
          if (!env.A && pe.usuario_id !== env.U) return json({ error: 'Solo quien creó la persona o el administrador puede borrarla.' }, 403);
          await env.DB.batch([
            env.DB.prepare("DELETE FROM nota_responsables WHERE tipo = 'persona' AND ref_id = ?").bind(parts[1]),
            env.DB.prepare('UPDATE notas SET persona_id = NULL WHERE persona_id = ?').bind(parts[1]),
            env.DB.prepare('DELETE FROM personas WHERE id = ?').bind(parts[1]),
          ]);
          return json({ ok: true });
        }
      }
      if (parts[0] === 'vistas') {
        if (M === 'POST' && parts.length === 1) { const b = await readJson(request); return json({ vista: await guardarVista(env, isId(b.id) ? b.id : null, b) }); }
        if (M === 'PUT' && parts.length === 2) return json({ vista: await guardarVista(env, parts[1], await readJson(request)) });
        if (M === 'DELETE' && parts.length === 2) { await run(env, 'DELETE FROM vistas WHERE id = ? AND usuario_id = ?', parts[1], env.U); return json({ ok: true }); }
      }
      if (M === 'PUT' && path === '/vistas-orden') {
        const b = await readJson(request);
        const ids = (Array.isArray(b.ids) ? b.ids : []).filter(isId);
        if (ids.length) await env.DB.batch(ids.map((id, i) => env.DB.prepare('UPDATE vistas SET orden = ? WHERE id = ? AND usuario_id = ?').bind(i + 1, id, env.U)));
        return json({ ok: true });
      }
      if (M === 'PUT' && path === '/config') {
        const b = await readJson(request);
        for (const k of CONFIG_PUBLICA) if (k in b) await setCfgU(env, k, txt(b[k], 100));
        return json({ ok: true });
      }

      if (M === 'POST' && (path === '/transcribir' || path === '/analizar') && !puedeDictar(yo)) {
        return json({ error: 'Tu usuario no tiene permiso para dictar. Escribe la nota a mano o pide el permiso al administrador.', sin_permiso: 'dictar' }, 403);
      }
      if (M === 'POST' && path === '/transcribir') return json(await transcribir(env, request));
      if (M === 'POST' && path === '/analizar') return json(await analizar(env, await readJson(request)));

      if (M === 'GET' && path === '/push/clave') return json({ clave: (await vapid(env)).pub });
      if (M === 'POST' && path === '/push/suscribir') {
        const b = await readJson(request);
        const endpoint = txt(b.endpoint, 1000);
        if (!/^https:\/\//.test(endpoint) || !b.keys || !b.keys.p256dh || !b.keys.auth) return json({ error: 'Suscripción no válida.' }, 400);
        const existe = await first(env, 'SELECT id FROM suscripciones WHERE endpoint = ?', endpoint);
        const id = existe ? existe.id : uuid();
        // Un mismo navegador puede pasar a otro usuario (otro token): el dispositivo pasa a ser suyo.
        await run(env, `INSERT INTO suscripciones (id, usuario_id, endpoint, p256dh, auth, nombre, plataforma, activo, creada) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
          ON CONFLICT(endpoint) DO UPDATE SET usuario_id = excluded.usuario_id, p256dh = excluded.p256dh, auth = excluded.auth, nombre = excluded.nombre, plataforma = excluded.plataforma, activo = 1`,
          id, env.U, endpoint, txt(b.keys.p256dh, 200), txt(b.keys.auth, 100), txt(b.nombre, 60) || disp, txt(b.plataforma, 60), now());
        return json({ ok: true, id });
      }
      if (M === 'GET' && path === '/dispositivos') return json({ dispositivos: await all(env, 'SELECT id, endpoint, nombre, plataforma, activo, creada, ultimo_uso FROM suscripciones WHERE usuario_id = ? ORDER BY creada', env.U) });
      if (parts[0] === 'dispositivos' && parts.length === 2) {
        if (M === 'PUT') {
          const b = await readJson(request);
          if ('nombre' in b) await run(env, 'UPDATE suscripciones SET nombre = ? WHERE id = ? AND usuario_id = ?', txt(b.nombre, 60), parts[1], env.U);
          if ('activo' in b) await run(env, 'UPDATE suscripciones SET activo = ? WHERE id = ? AND usuario_id = ?', b.activo ? 1 : 0, parts[1], env.U);
          return json({ ok: true });
        }
        if (M === 'DELETE') { await run(env, 'DELETE FROM suscripciones WHERE id = ? AND usuario_id = ?', parts[1], env.U); return json({ ok: true }); }
      }
      if (M === 'POST' && path === '/push/prueba') {
        const b = await readJson(request).catch(() => ({}));
        const subs = b && b.id ? await all(env, 'SELECT * FROM suscripciones WHERE id = ? AND usuario_id = ?', b.id, env.U) : await all(env, 'SELECT * FROM suscripciones WHERE activo = 1 AND usuario_id = ?', env.U);
        let ok = 0;
        for (const s of subs) if (await enviarPush(env, s, { tipo: 'info', tag: 'prueba', titulo: 'Aviso de prueba', cuerpo: 'Los avisos de tus notas llegarán así a ' + (s.nombre || 'este dispositivo') + '.' })) ok++;
        return json({ ok: true, enviados: ok, total: subs.length });
      }

      if (M === 'GET' && path === '/archivos') return json({ archivos: await all(env, 'SELECT id, titulo, motivo, creado, notas FROM archivos WHERE usuario_id = ? ORDER BY creado DESC', env.U) });
      if (parts[0] === 'archivos' && parts.length === 2) {
        if (M === 'GET') {
          const a = await first(env, 'SELECT html FROM archivos WHERE id = ? AND usuario_id = ?', parts[1], env.U);
          if (!a) return json({ error: 'El archivo no existe.' }, 404);
          return new Response(a.html, { headers: { ...cors, 'Content-Type': 'text/html; charset=utf-8' } });
        }
        if (M === 'DELETE') { await run(env, 'DELETE FROM archivos WHERE id = ? AND usuario_id = ?', parts[1], env.U); return json({ ok: true }); }
      }
      if (M === 'GET' && path === '/exportar') {
        const datos = await leerDatos(env);
        datos.archivos = await all(env, 'SELECT id, titulo, motivo, creado, notas FROM archivos WHERE usuario_id = ?', env.U);
        return new Response(JSON.stringify(datos, null, 1), { headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="notas-copia.json"' } });
      }

      return json({ error: 'Ruta no encontrada.' }, 404);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message, ...(e.extra || {}) }, e.status);
      return json({ error: 'Error en el worker: ' + (e && e.message ? e.message : String(e)) }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    if (!env.DB) return;
    ctx.waitUntil(programada(env));
  },
};

