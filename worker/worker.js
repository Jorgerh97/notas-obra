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
const USUARIO = 'yo';   // fase 1: un solo usuario. Preparado para varios.
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
];
// Columnas añadidas después de la primera versión (la base de producción ya tiene datos).
const COLUMNAS_NUEVAS = [['notas', 'hora_limite', 'TEXT'], ['notas', 'aviso_cant', 'INTEGER'], ['notas', 'aviso_unidad', 'TEXT']];
let schemaOk = false;
async function ensureSchema(env) {
  if (schemaOk) return;
  await env.DB.batch(SCHEMA.map(q => env.DB.prepare(q)));
  const cols = new Set((await all(env, 'PRAGMA table_info(notas)')).map(c => c.name));
  if (!cols.has('hora_limite')) {
    for (const [tabla, col, tipo] of COLUMNAS_NUEVAS) {
      if (!cols.has(col)) { try { await run(env, `ALTER TABLE ${tabla} ADD COLUMN ${col} ${tipo}`); } catch { /* otra instancia la añadió a la vez */ } }
    }
    await migrarAlarmas(env);
  }
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

// ---------- Notas ----------
const NOTA_COLS = 'id, titulo, cuerpo, prioridad, estado, persona_id, fecha_limite, hora_limite, aviso_cant, aviso_unidad, alarma, alarma_enviada, subir_critica, duracion, origen, origen_ref, creada, actualizada, realizada_en, eliminada_en, borrar_en, version';

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
  const n = await first(env, `SELECT ${NOTA_COLS} FROM notas WHERE id = ? AND usuario_id = ?`, id, USUARIO);
  if (!n) return null;
  n.etiquetas = (await all(env, 'SELECT etiqueta_id FROM nota_etiquetas WHERE nota_id = ?', id)).map(r => r.etiqueta_id);
  return n;
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
  }
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
  const validas = new Set((await all(env, 'SELECT id FROM etiquetas WHERE usuario_id = ?', USUARIO)).map(r => r.id));
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

async function crearNota(env, b, dispositivo) {
  const id = isId(b.id) ? b.id : uuid();
  const existe = await leerNota(env, id);
  if (existe) return existe;   // reintento de una creación que ya llegó
  const c = await limpiarCampos(env, b, false);
  c.estado = c.estado || 'activa';
  efectosEstado(c, null);
  reprogramar(c, null);
  const t = now();
  const fila = {
    id, usuario_id: USUARIO, titulo: c.titulo, cuerpo: c.cuerpo || '', prioridad: c.prioridad, estado: c.estado,
    persona_id: c.persona_id || null, fecha_limite: c.fecha_limite || null, hora_limite: c.hora_limite || null,
    aviso_cant: c.aviso_cant || null, aviso_unidad: c.aviso_unidad || null, alarma: c.alarma || null, alarma_enviada: 0,
    subir_critica: 'subir_critica' in c ? c.subir_critica : 1, duracion: c.duracion || null,
    origen: ['manual', 'voz', 'app'].includes(b.origen) ? b.origen : 'manual', origen_ref: b.origen_ref ? txt(b.origen_ref, 200) : null,
    transcripcion: b.transcripcion ? txt(b.transcripcion, 20000) : null,
    creada: t, actualizada: t, realizada_en: c.realizada_en || null, eliminada_en: c.eliminada_en || null, borrar_en: c.borrar_en || null,
    version: 1,
  };
  const cols = Object.keys(fila);
  await run(env, `INSERT INTO notas (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...cols.map(k => fila[k]));
  await ponerEtiquetas(env, id, b.etiquetas);
  await run(env, 'INSERT INTO cambios (nota_id, fecha, dispositivo, accion, antes) VALUES (?, ?, ?, ?, ?)', id, t, dispositivo, 'crear', null);
  return leerNota(env, id);
}

async function editarNota(env, ctx, id, b, dispositivo) {
  const antes = await leerNota(env, id);
  if (!antes) throw new HttpError(404, 'La nota ya no existe. Puede que se haya borrado desde otro dispositivo.');
  if (!b.forzar && Number.isInteger(b.base_version) && b.base_version !== antes.version) {
    throw new HttpError(409, 'Esta nota se ha modificado desde otro dispositivo.', { conflicto: true, servidor: antes });
  }
  const c = await limpiarCampos(env, b, true);
  efectosEstado(c, antes);
  reprogramar(c, antes);
  if ('alarma' in c && c.alarma === antes.alarma) { delete c.alarma; delete c.alarma_enviada; }
  else if ('alarma' in c) c.alarma_enviada = 0;
  const t = now();
  c.actualizada = t;
  const cols = Object.keys(c);
  await run(env, `UPDATE notas SET ${cols.map(k => k + ' = ?').join(', ')}, version = version + 1 WHERE id = ?`, ...cols.map(k => c[k]), id);
  if (Array.isArray(b.etiquetas)) await ponerEtiquetas(env, id, b.etiquetas);
  await run(env, 'INSERT INTO cambios (nota_id, fecha, dispositivo, accion, antes) VALUES (?, ?, ?, ?, ?)',
    id, t, dispositivo, c.estado && c.estado !== antes.estado ? 'estado:' + c.estado : 'editar', JSON.stringify(antes));
  // Si el aviso ya se mostró y la nota se ha resuelto o reprogramado, se retira de los demás dispositivos.
  if (antes.alarma_enviada && (c.estado && c.estado !== 'activa' || 'alarma' in c)) ctx.waitUntil(cerrarAvisos(env, id, null));
  return leerNota(env, id);
}

async function accionAlarma(env, ctx, id, b, dispositivo) {
  const n = await leerNota(env, id);
  if (!n) throw new HttpError(404, 'La nota ya no existe.');
  if (b.accion === 'hecha') {
    const c = { estado: 'realizada' };
    efectosEstado(c, n);
    await run(env, 'UPDATE notas SET estado = ?, realizada_en = ?, eliminada_en = NULL, borrar_en = ?, aviso30 = 0, aviso7 = 0, actualizada = ?, version = version + 1 WHERE id = ?',
      'realizada', c.realizada_en, c.borrar_en, now(), id);
  } else if (b.accion === 'posponer') {
    const min = Math.min(Math.max(parseInt(b.minutos, 10) || 10, 1), 24 * 60);
    await run(env, 'UPDATE notas SET alarma = ?, alarma_enviada = 0, actualizada = ?, version = version + 1 WHERE id = ?',
      new Date(Date.now() + min * 60000).toISOString(), now(), id);
  } else throw new HttpError(400, 'Acción no válida.');
  await run(env, 'INSERT INTO cambios (nota_id, fecha, dispositivo, accion, antes) VALUES (?, ?, ?, ?, ?)', id, now(), dispositivo, 'aviso:' + b.accion, JSON.stringify(n));
  ctx.waitUntil(cerrarAvisos(env, id, typeof b.endpoint === 'string' ? b.endpoint : null));
  return leerNota(env, id);
}

// ---------- Etiquetas, personas y grupos ----------
async function guardarEtiqueta(env, id, b) {
  const t = now();
  const actual = id ? await first(env, 'SELECT * FROM etiquetas WHERE id = ? AND usuario_id = ?', id, USUARIO) : null;
  if (id && !actual && !b.crear) throw new HttpError(404, 'La etiqueta no existe.');
  const nombre = 'nombre' in b ? String(b.nombre || '').replace(/^#/, '').trim() : actual && actual.nombre;
  if (!nombreEtiquetaOk(nombre)) throw new HttpError(400, 'El nombre de la etiqueta solo puede tener letras, números, guion y guion bajo, sin espacios.');
  const repetida = (await all(env, 'SELECT id, nombre FROM etiquetas WHERE usuario_id = ?', USUARIO))
    .find(e => norm(e.nombre) === norm(nombre) && e.id !== (actual ? actual.id : id));
  if (repetida) throw new HttpError(409, 'Ya existe la etiqueta #' + repetida.nombre + '.', { etiqueta: repetida });
  const tipo = TIPOS_ETIQUETA.includes(b.tipo) ? b.tipo : (actual ? actual.tipo : 'otra');
  const alias = 'alias' in b ? txt(b.alias, 300) : (actual ? actual.alias : '');
  let archivo = null;
  if (!actual) {
    const nuevoId = isId(id) ? id : uuid();
    await run(env, 'INSERT INTO etiquetas (id, usuario_id, nombre, tipo, alias, cerrada, creada, actualizada) VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
      nuevoId, USUARIO, nombre, tipo, alias, t, t);
    id = nuevoId;
  } else {
    let cerrada = actual.cerrada, cerradaEn = actual.cerrada_en;
    if ('cerrada' in b && !!b.cerrada !== !!actual.cerrada) {
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
  const existe = id ? await first(env, 'SELECT id FROM personas WHERE id = ?', id) : null;
  if (existe) await run(env, 'UPDATE personas SET nombre = ?, cargo = ? WHERE id = ?', nombre, cargo, id);
  else { id = isId(id) ? id : uuid(); await run(env, 'INSERT INTO personas (id, usuario_id, nombre, cargo, creada) VALUES (?, ?, ?, ?, ?)', id, USUARIO, nombre, cargo, now()); }
  return first(env, 'SELECT id, nombre, cargo FROM personas WHERE id = ?', id);
}

async function guardarVista(env, id, b) {
  const nombre = txt(b.nombre, 60).trim();
  if (!nombre) throw new HttpError(400, 'El grupo filtrado necesita un nombre.');
  const filtro = JSON.stringify(b.filtro && typeof b.filtro === 'object' ? b.filtro : {}).slice(0, 4000);
  const existe = id ? await first(env, 'SELECT id FROM vistas WHERE id = ?', id) : null;
  if (existe) await run(env, 'UPDATE vistas SET nombre = ?, filtro = ? WHERE id = ?', nombre, filtro, id);
  else {
    id = isId(id) ? id : uuid();
    const max = await first(env, 'SELECT COALESCE(MAX(orden), 0) AS m FROM vistas');
    await run(env, 'INSERT INTO vistas (id, usuario_id, nombre, filtro, orden) VALUES (?, ?, ?, ?, ?)', id, USUARIO, nombre, filtro, (max ? max.m : 0) + 1);
  }
  const v = await first(env, 'SELECT id, nombre, filtro, orden FROM vistas WHERE id = ?', id);
  v.filtro = JSON.parse(v.filtro);
  return v;
}

async function leerDatos(env) {
  const notas = await all(env, `SELECT ${NOTA_COLS} FROM notas WHERE usuario_id = ? ORDER BY creada`, USUARIO);
  const mapa = await etiquetasDe(env, notas.map(n => n.id));
  for (const n of notas) n.etiquetas = mapa[n.id] || [];
  const etiquetas = await all(env, 'SELECT id, nombre, tipo, alias, cerrada, cerrada_en FROM etiquetas WHERE usuario_id = ? ORDER BY nombre', USUARIO);
  const personas = await all(env, 'SELECT id, nombre, cargo FROM personas WHERE usuario_id = ? ORDER BY nombre', USUARIO);
  const vistas = (await all(env, 'SELECT id, nombre, filtro, orden FROM vistas WHERE usuario_id = ? ORDER BY orden', USUARIO))
    .map(v => ({ ...v, filtro: JSON.parse(v.filtro || '{}') }));
  const config = {};
  for (const r of await all(env, `SELECT clave, valor FROM config WHERE clave IN (${CONFIG_PUBLICA.map(() => '?').join(',')})`, ...CONFIG_PUBLICA)) config[r.clave] = r.valor;
  return { notas, etiquetas, personas, vistas, config, ahora: now() };
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
      <td><b>${esc(n.titulo)}</b>${n.cuerpo ? '<br>' + esc(n.cuerpo).replace(/\n/g, '<br>') : ''}</td>
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
  await run(env, 'INSERT INTO archivos (id, titulo, motivo, creado, notas, html) VALUES (?, ?, ?, ?, ?, ?)',
    id, titulo, motivo, now(), notas.length, informeHtml(titulo, notas, etiquetas, personas));
  return id;
}

async function archivarEtiqueta(env, etiquetaId, nombre, motivo) {
  const notas = await all(env, `SELECT ${NOTA_COLS} FROM notas WHERE id IN (SELECT nota_id FROM nota_etiquetas WHERE etiqueta_id = ?) ORDER BY creada`, etiquetaId);
  const mapa = await etiquetasDe(env, notas.map(n => n.id));
  for (const n of notas) n.etiquetas = mapa[n.id] || [];
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
- hora_limite (HH:MM, 24 h, hora local): solo si se dice una hora concreta ("a las 10", "a las 4 de la tarde" → 16:00). Si se dice una hora sin día, la fecha límite es hoy, o mañana si esa hora ya ha pasado. A la hora límite la app avisa siempre; no hace falta pedirlo.
- aviso_unidad (h, d o s) y aviso_cant: solo si se pide que avise con antelación ("avísame un día antes" → d y 1; "dos horas antes" → h y 2; "una semana antes" → s y 1). Horas de 1 a 12, días de 1 a 7, semanas de 1 a 4. Si no se pide, unidad vacía y 0.
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
  const etiquetas = await all(env, 'SELECT nombre, tipo, alias, cerrada FROM etiquetas WHERE usuario_id = ? ORDER BY tipo, nombre', USUARIO);
  const personas = await all(env, 'SELECT nombre, cargo FROM personas WHERE usuario_id = ? ORDER BY nombre', USUARIO);
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
      fecha_limite: fechaOk(n.fecha_limite) ? n.fecha_limite : '',
      hora_limite: fechaOk(n.fecha_limite) && horaOk(n.hora_limite) ? n.hora_limite : '',
      aviso_unidad: fechaOk(n.fecha_limite) && avisoOk(n.aviso_unidad, n.aviso_cant) ? n.aviso_unidad : '',
      aviso_cant: fechaOk(n.fecha_limite) && avisoOk(n.aviso_unidad, n.aviso_cant) ? n.aviso_cant : 0,
      duracion: Number.isInteger(n.duracion) && n.duracion > 0 ? Math.min(n.duracion, 1440) : 0,
    };
  });
  return { notas, uso: data.usage || null };
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

async function avisarTodos(env, datos) {
  const subs = await all(env, 'SELECT * FROM suscripciones WHERE activo = 1');
  const res = await Promise.all(subs.map(s => enviarPush(env, s, datos)));
  return res.filter(Boolean).length;
}

// Retira el aviso de una nota en los demás dispositivos. En iPhone no se envía: Safari exige mostrar
// una notificación por cada mensaje recibido y retiraría el permiso.
async function cerrarAvisos(env, notaId, excepto) {
  const subs = await all(env, 'SELECT * FROM suscripciones WHERE activo = 1');
  await Promise.all(subs.filter(s => s.endpoint !== excepto && !s.endpoint.includes('push.apple.com'))
    .map(s => enviarPush(env, s, { tipo: 'cerrar', tag: 'nota-' + notaId })));
}

// ---------- Tareas programadas ----------
async function enviarAlarmas(env) {
  const vencidas = await all(env, `SELECT id, titulo, cuerpo, prioridad, fecha_limite, hora_limite, aviso_cant, aviso_unidad, alarma FROM notas
    WHERE estado = 'activa' AND alarma_enviada = 0 AND alarma IS NOT NULL AND alarma <= ? ORDER BY alarma LIMIT 40`, now());
  for (const n of vencidas) {
    // Tras el aviso con antelación queda pendiente el de la hora límite.
    const siguiente = proximoAviso(n, Date.parse(n.alarma));
    if (siguiente) await run(env, 'UPDATE notas SET alarma = ?, alarma_enviada = 0 WHERE id = ?', siguiente, n.id);
    else await run(env, 'UPDATE notas SET alarma_enviada = 1 WHERE id = ?', n.id);
    const titulo = (n.prioridad === 'critica' ? '⚠ ' : '') + n.titulo;
    const limite = n.fecha_limite ? 'Fecha límite: ' + diaEs(n.fecha_limite) + (n.hora_limite ? ' a las ' + n.hora_limite : '') : '';
    const cuerpo = [limite, n.cuerpo || ''].filter(Boolean).join(' · ').slice(0, 180);
    await avisarTodos(env, { tipo: 'alarma', nota_id: n.id, titulo, cuerpo, tag: 'nota-' + n.id });
  }
}

async function subirPrioridades(env) {
  const manana = new Date(Date.now() + DIA).toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
  await run(env, `UPDATE notas SET prioridad = 'critica', actualizada = ?, version = version + 1
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
  const caducadas = await all(env, `SELECT ${NOTA_COLS} FROM notas WHERE estado = 'realizada' AND borrar_en <= ? AND ${SIN_OBRA_ABIERTA} ORDER BY realizada_en`, t);
  if (caducadas.length) {
    const mapa = await etiquetasDe(env, caducadas.map(n => n.id));
    for (const n of caducadas) n.etiquetas = mapa[n.id] || [];
    const hoy = new Date().toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid' });
    await guardarArchivo(env, 'Notas realizadas borradas el ' + hoy, 'Más de un año desde que se realizaron', caducadas);
    await borrarDefinitivo(env, caducadas.map(n => n.id));
  }

  // 3. Avisos 30 y 7 días antes del borrado de realizadas.
  for (const [dias, campo] of [[30, 'aviso30'], [7, 'aviso7']]) {
    const proximas = await all(env, `SELECT id, borrar_en FROM notas WHERE estado = 'realizada' AND ${campo} = 0 AND borrar_en <= ? AND ${SIN_OBRA_ABIERTA}`, plus(dias));
    if (!proximas.length) continue;
    const ids = proximas.map(n => n.id);
    for (let i = 0; i < ids.length; i += 90) {
      const trozo = ids.slice(i, i + 90);
      await run(env, `UPDATE notas SET ${campo} = 1 WHERE id IN (${trozo.map(() => '?').join(',')})`, ...trozo);
    }
    const fecha = new Date(proximas.map(n => Date.parse(n.borrar_en)).sort()[0]).toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'long' });
    await avisarTodos(env, {
      tipo: 'info', tag: 'borrado-' + dias,
      titulo: proximas.length === 1 ? '1 nota realizada se borrará pronto' : proximas.length + ' notas realizadas se borrarán pronto',
      cuerpo: 'A partir del ' + fecha + '. Ábrelas en Historial para exportarlas o conservarlas.', url: '#/historial',
    });
  }

  // 4. Historial de cambios antiguo.
  await run(env, 'DELETE FROM cambios WHERE fecha < ?', plus(-RETENCION_CAMBIOS));
}

async function borrarDefinitivo(env, ids) {
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
  const cfg = async (k, def) => { const v = await getCfg(env, 'resumen_' + k); return v == null || v === '' ? def : v; };
  if ((await cfg('activo', RESUMEN.activo)) === '0') return null;
  const hora = await cfg('hora', RESUMEN.hora), dias = (await cfg('dias', RESUMEN.dias)).split(',').map(Number);
  const p = partesMadrid(ms), dow = (new Date(p.fecha + 'T12:00:00Z').getUTCDay() + 6) % 7 + 1;
  const desde = minutosHora(p.hora) - minutosHora(horaOk(hora) ? hora : RESUMEN.hora);
  if (!dias.includes(dow) || desde < 0 || desde > RESUMEN.margen) return null;
  if ((await getCfg(env, 'resumen_ultimo')) === p.fecha) return null;
  await setCfg(env, 'resumen_ultimo', p.fecha);
  const n = await first(env, `SELECT
      SUM(prioridad = 'critica') AS urgentes,
      SUM(fecha_limite = ? AND hora_limite IS NOT NULL) AS con_hora,
      SUM(actualizada < ?) AS estancadas
    FROM notas WHERE estado = 'activa' AND usuario_id = ?`, p.fecha, plus(-ESTANCADA_DIAS, new Date(ms).toISOString()), USUARIO);
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
  await resumenMatutino(env);
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
      if ((request.headers.get('Authorization') || '') !== 'Bearer ' + env.APP_TOKEN) return json({ error: 'Token incorrecto. Revisa el token en los ajustes de la app.' }, 401);
      if (!env.DB) return json({ error: 'Falta la base de datos D1 con el nombre DB en el worker.' }, 500);
      await ensureSchema(env);

      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, '') || '/';
      const parts = path.split('/').filter(Boolean);
      const M = request.method;
      const disp = txt(request.headers.get('X-Dispositivo'), 60) || 'desconocido';

      if (M === 'GET' && path === '/estado') {
        const faltan = [];
        if (!env.AI) faltan.push('Enlace de Workers AI (AI)');
        if (!env.ANTHROPIC_API_KEY) faltan.push('ANTHROPIC_API_KEY');
        return json({ ok: true, faltan, version: 1 });
      }
      if (M === 'GET' && path === '/datos') return json(await leerDatos(env));

      if (parts[0] === 'notas') {
        if (M === 'POST' && path === '/notas') return json({ nota: await crearNota(env, await readJson(request), disp) });
        if (M === 'POST' && path === '/notas/conservar') {
          const b = await readJson(request);
          const ids = (Array.isArray(b.ids) ? b.ids : []).filter(isId).slice(0, 500);
          for (let i = 0; i < ids.length; i += 90) {
            const trozo = ids.slice(i, i + 90);
            await run(env, `UPDATE notas SET borrar_en = ?, aviso30 = 0, aviso7 = 0, version = version + 1 WHERE estado = 'realizada' AND id IN (${trozo.map(() => '?').join(',')})`, plus(RETENCION_REALIZADAS), ...trozo);
          }
          return json({ ok: true, conservadas: ids.length });
        }
        const id = parts[1];
        if (!isId(id)) return json({ error: 'Nota no válida.' }, 400);
        if (M === 'PUT' && parts.length === 2) return json({ nota: await editarNota(env, ctx, id, await readJson(request), disp) });
        if (M === 'POST' && parts[2] === 'alarma') return json({ nota: await accionAlarma(env, ctx, id, await readJson(request), disp) });
        if (M === 'DELETE' && parts.length === 2) {
          const n = await leerNota(env, id);
          if (n && n.estado !== 'papelera') return json({ error: 'Solo se pueden borrar definitivamente las notas de la papelera.' }, 400);
          await borrarDefinitivo(env, [id]);
          return json({ ok: true });
        }
      }
      if (M === 'POST' && path === '/papelera/vaciar') {
        const ids = (await all(env, `SELECT id FROM notas WHERE estado = 'papelera'`)).map(n => n.id);
        await borrarDefinitivo(env, ids);
        return json({ ok: true, borradas: ids.length });
      }

      if (parts[0] === 'etiquetas') {
        if (M === 'POST' && parts.length === 1) { const b = await readJson(request); return json(await guardarEtiqueta(env, isId(b.id) ? b.id : null, { ...b, crear: true })); }
        if (M === 'PUT' && parts.length === 2) return json(await guardarEtiqueta(env, parts[1], await readJson(request)));
        if (M === 'DELETE' && parts.length === 2) {
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
        if (M === 'DELETE' && parts.length === 2) {
          await env.DB.batch([
            env.DB.prepare('UPDATE notas SET persona_id = NULL WHERE persona_id = ?').bind(parts[1]),
            env.DB.prepare('DELETE FROM personas WHERE id = ?').bind(parts[1]),
          ]);
          return json({ ok: true });
        }
      }
      if (parts[0] === 'vistas') {
        if (M === 'POST' && parts.length === 1) { const b = await readJson(request); return json({ vista: await guardarVista(env, isId(b.id) ? b.id : null, b) }); }
        if (M === 'PUT' && parts.length === 2) return json({ vista: await guardarVista(env, parts[1], await readJson(request)) });
        if (M === 'DELETE' && parts.length === 2) { await run(env, 'DELETE FROM vistas WHERE id = ?', parts[1]); return json({ ok: true }); }
      }
      if (M === 'PUT' && path === '/vistas-orden') {
        const b = await readJson(request);
        const ids = (Array.isArray(b.ids) ? b.ids : []).filter(isId);
        if (ids.length) await env.DB.batch(ids.map((id, i) => env.DB.prepare('UPDATE vistas SET orden = ? WHERE id = ?').bind(i + 1, id)));
        return json({ ok: true });
      }
      if (M === 'PUT' && path === '/config') {
        const b = await readJson(request);
        for (const k of CONFIG_PUBLICA) if (k in b) await setCfg(env, k, txt(b[k], 100));
        return json({ ok: true });
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
        await run(env, `INSERT INTO suscripciones (id, endpoint, p256dh, auth, nombre, plataforma, activo, creada) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
          ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, nombre = excluded.nombre, plataforma = excluded.plataforma, activo = 1`,
          id, endpoint, txt(b.keys.p256dh, 200), txt(b.keys.auth, 100), txt(b.nombre, 60) || disp, txt(b.plataforma, 60), now());
        return json({ ok: true, id });
      }
      if (M === 'GET' && path === '/dispositivos') return json({ dispositivos: await all(env, 'SELECT id, endpoint, nombre, plataforma, activo, creada, ultimo_uso FROM suscripciones ORDER BY creada') });
      if (parts[0] === 'dispositivos' && parts.length === 2) {
        if (M === 'PUT') {
          const b = await readJson(request);
          if ('nombre' in b) await run(env, 'UPDATE suscripciones SET nombre = ? WHERE id = ?', txt(b.nombre, 60), parts[1]);
          if ('activo' in b) await run(env, 'UPDATE suscripciones SET activo = ? WHERE id = ?', b.activo ? 1 : 0, parts[1]);
          return json({ ok: true });
        }
        if (M === 'DELETE') { await run(env, 'DELETE FROM suscripciones WHERE id = ?', parts[1]); return json({ ok: true }); }
      }
      if (M === 'POST' && path === '/push/prueba') {
        const b = await readJson(request).catch(() => ({}));
        const subs = b && b.id ? await all(env, 'SELECT * FROM suscripciones WHERE id = ?', b.id) : await all(env, 'SELECT * FROM suscripciones WHERE activo = 1');
        let ok = 0;
        for (const s of subs) if (await enviarPush(env, s, { tipo: 'info', tag: 'prueba', titulo: 'Aviso de prueba', cuerpo: 'Los avisos de tus notas llegarán así a ' + (s.nombre || 'este dispositivo') + '.' })) ok++;
        return json({ ok: true, enviados: ok, total: subs.length });
      }

      if (M === 'GET' && path === '/archivos') return json({ archivos: await all(env, 'SELECT id, titulo, motivo, creado, notas FROM archivos ORDER BY creado DESC') });
      if (parts[0] === 'archivos' && parts.length === 2) {
        if (M === 'GET') {
          const a = await first(env, 'SELECT html FROM archivos WHERE id = ?', parts[1]);
          if (!a) return json({ error: 'El archivo no existe.' }, 404);
          return new Response(a.html, { headers: { ...cors, 'Content-Type': 'text/html; charset=utf-8' } });
        }
        if (M === 'DELETE') { await run(env, 'DELETE FROM archivos WHERE id = ?', parts[1]); return json({ ok: true }); }
      }
      if (M === 'GET' && path === '/exportar') {
        const datos = await leerDatos(env);
        datos.archivos = await all(env, 'SELECT id, titulo, motivo, creado, notas FROM archivos');
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

