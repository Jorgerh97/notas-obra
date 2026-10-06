'use strict';
/* Notas de obra · fase 1 */

const VERSION = '1.3.1';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
const DIA = 86400000;
const PRIOS = ['critica', 'alta', 'normal', 'baja'];
const PRIO_N = { critica: 'Urgente', alta: 'Alta', normal: 'Normal', baja: 'Baja' };   // "critica" es el valor guardado
const TIPOS = [['obra', 'Obras'], ['industrial', 'Industriales'], ['accion', 'Acciones'], ['responsable', 'Responsables'], ['otra', 'Otras']];
const TIPO_1 = { obra: 'Obra', industrial: 'Industrial', accion: 'Acción', responsable: 'Responsable', otra: 'Otra' };
const DIAS_SEM = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const TAG_RE = /^[\p{L}\p{N}_-]{1,40}$/u;
const ESTANCADA_DIAS = 10;
const AUDIO_DIAS = 7;
const AVISO_RANGO = { h: 12, d: 7, s: 4 };   // horas, días o semanas antes (desde 1)
const AVISO_N = { h: ['hora', 'horas'], d: ['día', 'días'], s: ['semana', 'semanas'] };
const HORA_AVISO = '08:00';                  // hora de los avisos cuando la fecha límite no tiene hora
const CAMPOS_AVISO = ['fecha_limite', 'hora_limite', 'aviso_cant', 'aviso_unidad'];
const API_MIN = 3;   // versión mínima del worker (ver API en worker.js)
const MODOS = [['lista', 'Lista'], ['calendario', 'Calendario'], ['matriz', 'Matriz']];
const DURACIONES = [[10, '10 min'], [30, '30 min'], [60, '1 h'], [120, '2 h']];
const DURACION_DEF = 10;   // minutos; las notas sin duración ocupan esto en el calendario
const chip = (act, v, on, txt) => `<button class="chip" data-act="${act}" data-v="${esc(v)}" aria-pressed="${on}">${txt}</button>`;
const textoDuracion = m => m < 60 ? m + ' min' : Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '');

const ICON = {
  mic: '<svg class="i" viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  plus: '<svg class="i" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  search: '<svg class="i" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  menu: '<svg class="i" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  close: '<svg class="i" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  back: '<svg class="i" viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  filter: '<svg class="i" viewBox="0 0 24 24"><path d="M4 6h16M7 12h10M10 18h4"/></svg>',
  up: '<svg class="i" viewBox="0 0 24 24"><path d="M6 15l6-6 6 6"/></svg>',
  down: '<svg class="i" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
};

// ---------- Fechas ----------
const ymd = d => { const x = new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
const hoyYmd = () => ymd(Date.now());
const addDias = (ymdStr, n) => { const [y, m, d] = ymdStr.split('-').map(Number); return ymd(new Date(y, m - 1, d + n)); };
const finSemana = () => { const d = new Date(); return addDias(hoyYmd(), (7 - d.getDay()) % 7); };
const diaCorto = ymdStr => { const [y, m, d] = ymdStr.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, ''); };
const diaLargo = ymdStr => { const [y, m, d] = ymdStr.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }); };
const hora = iso => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
const fechaCorta = iso => iso ? new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }).replace(/\./g, '') : '';
const ahoraLocal = () => new Date().toLocaleString('es-ES', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const relDia = ymdStr => {
  const h = hoyYmd();
  if (ymdStr === h) return 'hoy';
  if (ymdStr === addDias(h, 1)) return 'mañana';
  if (ymdStr === addDias(h, -1)) return 'ayer';
  return diaCorto(ymdStr);
};

// ---------- Avisos ----------
// A la hora límite se avisa siempre; además puede haber un aviso con antelación.
// Es el mismo cálculo que hace el worker, para ver el próximo aviso también sin conexión.
const textoAntelacion = (u, c) => c + ' ' + AVISO_N[u][c === 1 ? 0 : 1] + ' antes';
const avisoValido = (u, c) => !!AVISO_RANGO[u] && c >= 1 && c <= AVISO_RANGO[u];
function momentosAviso(n) {
  if (!n.fecha_limite) return [];
  const t = (f, h) => { const [y, m, d] = f.split('-').map(Number), [hh, mm] = h.split(':').map(Number); return new Date(y, m - 1, d, hh, mm).getTime(); };
  const base = n.hora_limite || HORA_AVISO, c = Number(n.aviso_cant), out = [];
  if (n.hora_limite) out.push(t(n.fecha_limite, n.hora_limite));
  if (avisoValido(n.aviso_unidad, c)) {
    out.push(n.aviso_unidad === 'h' ? t(n.fecha_limite, base) - c * 3600000 : t(addDias(n.fecha_limite, -c * (n.aviso_unidad === 's' ? 7 : 1)), base));
  }
  return out;
}
function proximoAviso(n, despues = Date.now()) {
  const t = momentosAviso(n).filter(x => x > despues).sort((a, b) => a - b)[0];
  return t ? new Date(t).toISOString() : null;
}
// «☑ 1/3» si la nota tiene checklist.
const textoCheck = n => { const l = n.checklist || []; return l.length ? `☑ ${l.filter(p => p.hecho).length}/${l.length}` : ''; };
const textoAviso = n => avisoValido(n.aviso_unidad, Number(n.aviso_cant)) ? textoAntelacion(n.aviso_unidad, Number(n.aviso_cant)) : '';

// ---------- Almacenamiento local (IndexedDB) ----------
const idb = {
  _db: null,
  open() {
    if (this._db) return this._db;
    this._db = new Promise((res, rej) => {
      const r = indexedDB.open('notas-app', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return this._db;
  },
  async tx(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction('kv', mode);
      const out = fn(t.objectStore('kv'));
      t.oncomplete = () => res(out && out.result);
      t.onerror = () => rej(t.error);
    });
  },
  get(k) { return this.tx('readonly', s => s.get(k)); },
  set(k, v) { return this.tx('readwrite', s => s.put(v, k)); },
  del(k) { return this.tx('readwrite', s => s.delete(k)); },
};

// ---------- Estado ----------
const filtroVacio = () => ({ etiquetas: [], modo: 'todas', prioridades: [], personas: [], conAlarma: false, venceSemana: false, estancadas: false });
const S = {
  cfg: { url: '', token: '', dispositivo: '', pushEndpoint: '' },
  notas: [], etiquetas: [], personas: [], vistas: [], srv: {},
  outbox: [], conflictos: [], audios: [],
  ui: { modo: 'lista', grupoVista: '', matrizMas: {}, cal: { vista: 'semana', ref: '', realizadas: true, finde: true }, agrupar: 'fecha', vista: null, filtro: filtroVacio(), q: '', buscar: false, histTab: 'realizadas', histQ: '' },
  sync: { estado: 'local', msg: '' },
  flushing: false,
  ed: null, dic: null, rev: null, modal: null,
  alarmasVistas: new Set(),
  fotosPend: [],          // fotos guardadas en el dispositivo que faltan por subir
  fotoUrls: new Map(),    // fotos ya cargadas para mostrar (id-tipo → URL)
};

const etq = id => S.etiquetas.find(e => e.id === id);
const per = id => S.personas.find(p => p.id === id);
const nota = id => S.notas.find(n => n.id === id);
const activas = () => S.notas.filter(n => n.estado === 'activa');

async function guardarLocal() {
  await idb.set('datos', { notas: S.notas, etiquetas: S.etiquetas, personas: S.personas, vistas: S.vistas, srv: S.srv });
}
const guardarOutbox = () => idb.set('outbox', { outbox: S.outbox, conflictos: S.conflictos });
const guardarCfg = () => idb.set('config', S.cfg);
const guardarAudios = () => idb.set('audios', S.audios);
const guardarUi = () => idb.set('ui', { modo: S.ui.modo, grupoVista: S.ui.grupoVista, cal: { vista: S.ui.cal.vista, realizadas: S.ui.cal.realizadas, finde: S.ui.cal.finde }, agrupar: S.ui.agrupar, vista: S.ui.vista, filtro: S.ui.filtro });

// ---------- Conexión con el worker ----------
async function api(path, opt = {}) {
  if (!S.cfg.url || !S.cfg.token) { const e = new Error('Configura la conexión en Ajustes.'); e.status = 0; e.config = true; throw e; }
  const headers = { Authorization: 'Bearer ' + S.cfg.token, 'X-Dispositivo': S.cfg.dispositivo || 'App', ...(opt.headers || {}) };
  let body = opt.body;
  if (body !== undefined && !opt.raw) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
  let r;
  try {
    r = await fetch(S.cfg.url.replace(/\/+$/, '') + path, { method: opt.method || 'GET', headers, body });
  } catch (err) {
    const e = new Error('Sin conexión con el servidor.'); e.status = 0; e.red = true; throw e;
  }
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json().catch(() => ({})) : await r.text();
  if (!r.ok) {
    const e = new Error((data && data.error) || ('Error ' + r.status));
    e.status = r.status; e.data = data; throw e;
  }
  return data;
}

function setSync(estado, msg) {
  S.sync = { estado, msg: msg || '' };
  const el = $('#sync');
  if (el) { el.className = 'status ' + (estado === 'off' ? 'off' : estado === 'err' ? 'err' : ''); el.textContent = textoSync(); el.title = S.sync.msg; }
}
function textoSync() {
  const p = S.outbox.length;
  if (S.sync.estado === 'err') return 'Revisa la conexión';
  if (S.sync.estado === 'off' || !navigator.onLine) return p ? 'Sin conexión · ' + p + ' por enviar' : 'Sin conexión';
  if (p) return 'Guardando…';
  return S.sync.estado === 'ok' ? 'Guardado' : '';
}

// Cola de cambios pendientes: permite trabajar sin cobertura.
function encolar(op) {
  if (op.kind === 'nota' && op.method === 'PUT') {
    const prev = S.outbox.find(o => o.kind === 'nota' && o.ref === op.ref && (o.method === 'PUT' || o.method === 'POST') && !o.enviando);
    if (prev) {
      const base = prev.body.base_version;
      Object.assign(prev.body, op.body);
      if (prev.method === 'PUT') prev.body.base_version = base; else { delete prev.body.base_version; delete prev.body.forzar; }
      guardarOutbox(); flushPronto(); return;
    }
  }
  S.outbox.push({ k: uid(), ...op });
  guardarOutbox(); flushPronto(); setSync(S.sync.estado);
}
let flushTimer = null;
function flushPronto() { clearTimeout(flushTimer); flushTimer = setTimeout(flush, 250); }

async function flush() {
  if (S.flushing || !S.cfg.url || !S.cfg.token) return;
  S.flushing = true;
  try {
    while (S.outbox.length) {
      const op = S.outbox[0];
      op.enviando = true;
      try {
        const d = await api(op.path, { method: op.method, body: op.body });
        S.outbox.shift();
        aplicarRespuesta(op, d);
      } catch (e) {
        op.enviando = false;
        if (e.status === 409 && e.data && e.data.conflicto) {
          S.outbox.shift();
          S.conflictos.push({ k: uid(), op, servidor: e.data.servidor });
          renderBase();
        } else if (e.status === 409 && op.kind === 'etiqueta' && e.data && e.data.etiqueta) {
          S.outbox.shift();
          remapEtiqueta(op.ref, e.data.etiqueta);
        } else if (e.status === 404 && op.kind === 'foto') {
          S.outbox.shift();   // la foto o la nota ya no existen: nada que quitar
        } else if (e.status === 404 && op.kind === 'nota') {
          S.outbox.shift();
          S.notas = S.notas.filter(n => n.id !== op.ref);
          toast('Una nota se había borrado desde otro dispositivo y se ha quitado de la lista.');
          renderBase();
        } else if (e.status >= 400 && e.status < 500 && ![401, 408, 429].includes(e.status)) {
          S.outbox.shift();
          toast('No se ha podido guardar un cambio: ' + e.message);
        } else {
          setSync(e.status === 401 || e.config ? 'err' : 'off', e.message);
          break;
        }
      }
      await guardarOutbox();
    }
    if (!S.outbox.length) setSync('ok');
    await guardarLocal();
  } finally {
    S.flushing = false;
    setSync(S.sync.estado, S.sync.msg);
  }
}

function aplicarRespuesta(op, d) {
  if (d && d.nota) {
    const srv = d.nota;
    srv.fotos = conFotosPendientes(srv.id, srv.fotos);
    const pendiente = S.outbox.some(o => o.kind === 'nota' && o.ref === srv.id);
    const i = S.notas.findIndex(n => n.id === srv.id);
    if (pendiente && i >= 0) {
      S.notas[i].version = srv.version;
      for (const o of S.outbox) if (o.kind === 'nota' && o.ref === srv.id && o.method === 'PUT') o.body.base_version = srv.version;
    } else if (i >= 0) S.notas[i] = srv; else S.notas.push(srv);
  }
  if (d && d.etiqueta) {
    const i = S.etiquetas.findIndex(e => e.id === d.etiqueta.id);
    if (i >= 0) S.etiquetas[i] = d.etiqueta; else S.etiquetas.push(d.etiqueta);
  }
  if (d && d.persona) { const i = S.personas.findIndex(p => p.id === d.persona.id); if (i >= 0) S.personas[i] = d.persona; }
  if (d && d.vista) { const i = S.vistas.findIndex(v => v.id === d.vista.id); if (i >= 0) S.vistas[i] = d.vista; }
  if (d && d.fotos && op.kind === 'foto') { const n = nota(op.ref); if (n) n.fotos = conFotosPendientes(op.ref, d.fotos); }
}

function remapEtiqueta(localId, existente) {
  S.etiquetas = S.etiquetas.filter(e => e.id !== localId);
  if (!etq(existente.id)) S.etiquetas.push(existente);
  const cambia = arr => arr ? [...new Set(arr.map(x => x === localId ? existente.id : x))] : arr;
  for (const n of S.notas) n.etiquetas = cambia(n.etiquetas);
  for (const o of S.outbox) if (o.body && Array.isArray(o.body.etiquetas)) o.body.etiquetas = cambia(o.body.etiquetas);
  for (const v of S.vistas) v.filtro.etiquetas = cambia(v.filtro.etiquetas || []);
  S.ui.filtro.etiquetas = cambia(S.ui.filtro.etiquetas);
  renderBase();
}

let syncando = false;
async function sincronizar() {
  if (syncando || !S.cfg.url || !S.cfg.token) return;
  syncando = true;
  try {
    await flush();
    subirFotos();
    if (S.outbox.length) return;
    const d = await api('/datos');
    if (S.outbox.length) return;   // hubo cambios mientras llegaban los datos
    S.notas = d.notas; S.etiquetas = d.etiquetas; S.personas = d.personas; S.vistas = d.vistas; S.srv = d.config || {};
    S.workerAntiguo = !(d.api >= API_MIN);
    for (const n of S.notas) n.fotos = conFotosPendientes(n.id, n.fotos || []);   // las que aún no han subido
    if (S.ui.vista && !S.vistas.some(v => v.id === S.ui.vista)) { S.ui.vista = null; S.ui.filtro = filtroVacio(); }
    await guardarLocal();
    setSync('ok');
    renderBase();
    comprobarAlarmas();
  } catch (e) {
    setSync(e.status === 401 || e.config ? 'err' : 'off', e.message);
  } finally { syncando = false; }
}

// ---------- Operaciones sobre notas ----------
function crearNotaLocal(campos) {
  const t = new Date().toISOString();
  const n = {
    id: campos.id || uid(), titulo: campos.titulo, cuerpo: campos.cuerpo || '', prioridad: campos.prioridad || 'normal', estado: 'activa',
    persona_id: campos.persona_id || null, fecha_limite: campos.fecha_limite || null, hora_limite: campos.hora_limite || null,
    aviso_cant: campos.aviso_cant || null, aviso_unidad: campos.aviso_unidad || null, alarma: proximoAviso(campos),
    subir_critica: campos.subir_critica === false || campos.subir_critica === 0 ? 0 : 1, duracion: campos.duracion || null, origen: campos.origen || 'manual',
    creada: t, actualizada: t, version: 1, etiquetas: campos.etiquetas || [], checklist: campos.checklist || [], alarma_enviada: 0,
    repetir: campos.repetir || null, serie: campos.serie || null,
  };
  S.notas.push(n);
  encolar({ kind: 'nota', ref: n.id, method: 'POST', path: '/notas', body: { ...campos, id: n.id, etiquetas: n.etiquetas } });
  guardarLocal();
  return n;
}

function editarNotaLocal(id, cambios) {
  const n = nota(id);
  if (!n) return;
  const t = new Date().toISOString();
  if ('fecha_limite' in cambios && !cambios.fecha_limite) Object.assign(cambios, { hora_limite: null, aviso_cant: null, aviso_unidad: null });
  Object.assign(n, cambios, { actualizada: t });
  if (CAMPOS_AVISO.some(k => k in cambios)) { n.alarma = proximoAviso(n); n.alarma_enviada = 0; }
  if ('estado' in cambios) {
    if (cambios.estado === 'realizada') { n.realizada_en = t; n.borrar_en = new Date(Date.now() + 365 * DIA).toISOString(); }
    if (cambios.estado === 'papelera') { n.eliminada_en = t; n.borrar_en = new Date(Date.now() + 30 * DIA).toISOString(); }
    if (cambios.estado === 'activa') { n.realizada_en = null; n.eliminada_en = null; n.borrar_en = null; }
  }
  encolar({ kind: 'nota', ref: id, method: 'PUT', path: '/notas/' + id, body: { ...cambios, base_version: n.version } });
  guardarLocal();
}

function crearEtiquetaLocal(nombre, tipo = 'otra', alias = '') {
  nombre = String(nombre).replace(/^#/, '').trim();
  const existe = S.etiquetas.find(e => norm(e.nombre) === norm(nombre));
  if (existe) return existe;
  const e = { id: uid(), nombre, tipo, alias, cerrada: 0 };
  S.etiquetas.push(e);
  encolar({ kind: 'etiqueta', ref: e.id, method: 'POST', path: '/etiquetas', body: { id: e.id, nombre, tipo, alias } });
  guardarLocal();
  return e;
}

// ---------- Filtros y agrupación ----------
function fechaEfectiva(n) {
  if (n.fecha_limite) return n.fecha_limite;
  if (n.alarma) return ymd(n.alarma);
  return null;
}
const estancada = n => Date.now() - Date.parse(n.actualizada || n.creada) > ESTANCADA_DIAS * DIA;
const atrasada = n => { const f = fechaEfectiva(n); return f && f < hoyYmd(); };

function cumpleFiltro(n, f) {
  if (f.etiquetas && f.etiquetas.length) {
    const tiene = f.etiquetas.map(id => (n.etiquetas || []).includes(id));
    if (f.modo === 'alguna' ? !tiene.some(Boolean) : !tiene.every(Boolean)) return false;
  }
  if (f.prioridades && f.prioridades.length && !f.prioridades.includes(n.prioridad)) return false;
  if (f.personas && f.personas.length) {
    const p = n.persona_id || 'ninguna';
    if (!f.personas.includes(p)) return false;
  }
  if (f.conAlarma && !(n.alarma || n.hora_limite || n.aviso_unidad)) return false;
  if (f.venceSemana) { const fe = fechaEfectiva(n); if (!fe || fe > finSemana()) return false; }
  if (f.estancadas && !estancada(n)) return false;
  return true;
}
function cumpleBusqueda(n, q) {
  if (!q) return true;
  const t = norm(q);
  const texto = norm([n.titulo, n.cuerpo, (n.etiquetas || []).map(id => (etq(id) || {}).nombre).join(' '), (per(n.persona_id) || {}).nombre].join(' '));
  return t.split(/\s+/).every(p => texto.includes(p.replace(/^#/, '')));
}
const filtroActivo = f => !!(f.etiquetas.length || f.prioridades.length || f.personas.length || f.conAlarma || f.venceSemana || f.estancadas);
const rankPrio = p => PRIOS.indexOf(p);
function ordenar(a, b) {
  return rankPrio(a.prioridad) - rankPrio(b.prioridad)
    || String(fechaEfectiva(a) || '9999').localeCompare(String(fechaEfectiva(b) || '9999'))
    || String(a.hora_limite || '99:99').localeCompare(String(b.hora_limite || '99:99'))
    || String(a.creada).localeCompare(String(b.creada));
}
function visibles() {
  return activas().filter(n => cumpleFiltro(n, S.ui.filtro) && cumpleBusqueda(n, S.ui.q)).sort(ordenar);
}
function agrupar(notas) {
  if (S.ui.agrupar === 'etiqueta') {
    const grupos = new Map();
    for (const n of notas) {
      const ids = (n.etiquetas || []).filter(etq);
      if (!ids.length) { if (!grupos.has('_')) grupos.set('_', []); grupos.get('_').push(n); }
      for (const id of ids) { if (!grupos.has(id)) grupos.set(id, []); grupos.get(id).push(n); }
    }
    const orden = [...grupos.keys()].filter(k => k !== '_').sort((a, b) => {
      const ea = etq(a), eb = etq(b);
      return TIPOS.findIndex(t => t[0] === ea.tipo) - TIPOS.findIndex(t => t[0] === eb.tipo) || ea.nombre.localeCompare(eb.nombre);
    });
    const out = orden.map(k => ({ key: k, nombre: '#' + etq(k).nombre, notas: grupos.get(k) }));
    if (grupos.has('_')) out.push({ key: 'sin', nombre: 'Sin etiqueta', notas: grupos.get('_') });
    return out;
  }
  const h = hoyYmd(), m = addDias(h, 1), fs = finSemana();
  const g = { atrasadas: [], hoy: [], manana: [], semana: [], despues: [], sin: [] };
  for (const n of notas) {
    const f = fechaEfectiva(n);
    if (!f) g.sin.push(n);
    else if (f < h) g.atrasadas.push(n);
    else if (f === h) g.hoy.push(n);
    else if (f === m) g.manana.push(n);
    else if (f <= fs) g.semana.push(n);
    else g.despues.push(n);
  }
  return [
    { key: 'atrasadas', nombre: 'Atrasadas', notas: g.atrasadas },
    { key: 'hoy', nombre: 'Hoy · ' + diaLargo(h), notas: g.hoy },
    { key: 'manana', nombre: 'Mañana · ' + diaLargo(m), notas: g.manana },
    { key: 'semana', nombre: 'Esta semana', notas: g.semana },
    { key: 'despues', nombre: 'Más adelante', notas: g.despues },
    { key: 'sin', nombre: 'Sin fecha', notas: g.sin },
  ].filter(x => x.notas.length);
}

// Realizadas que se borrarán pronto (las de obras abiertas se conservan).
function obraAbierta(n) { return (n.etiquetas || []).some(id => { const e = etq(id); return e && e.tipo === 'obra' && !e.cerrada; }); }
function porBorrar(dias) {
  const lim = Date.now() + dias * DIA;
  return S.notas.filter(n => n.estado === 'realizada' && n.borrar_en && Date.parse(n.borrar_en) <= lim && !obraAbierta(n))
    .sort((a, b) => a.borrar_en.localeCompare(b.borrar_en));
}
function candidatasRevision() {
  return activas().filter(n => atrasada(n) || estancada(n)).sort((a, b) => (atrasada(b) - atrasada(a)) || ordenar(a, b));
}
function toca_revision() {
  const dia = Number(S.srv.revision_dia == null ? 5 : S.srv.revision_dia);
  if (new Date().getDay() !== dia) return false;
  return S.srv.revision_ultima !== hoyYmd();
}

// ---------- Avisos inferiores con Deshacer ----------
const toastsActivos = new Map();
function toast(msg, opt = {}) {
  const cont = $('#toasts');
  const clave = opt.clave;
  if (clave && toastsActivos.has(clave)) {
    const t = toastsActivos.get(clave);
    t.n++; t.deshacer.push(opt.deshacer);
    t.el.querySelector('.grow').textContent = opt.plural ? opt.plural(t.n) : msg;
    clearTimeout(t.timer); t.timer = setTimeout(t.cerrar, opt.ms || 8000);
    return;
  }
  const el = document.createElement('div');
  el.className = 'toast' + (opt.clase ? ' ' + opt.clase : '');
  el.innerHTML = `<span class="grow">${esc(msg)}</span>`;
  const t = { el, n: 1, deshacer: opt.deshacer ? [opt.deshacer] : [], timer: null };
  t.cerrar = () => { el.remove(); if (clave) toastsActivos.delete(clave); };
  for (const [texto, fn] of (opt.botones || [])) {
    const b = document.createElement('button'); b.textContent = texto;
    b.onclick = () => { fn(); t.cerrar(); }; el.appendChild(b);
  }
  if (opt.deshacer) {
    const b = document.createElement('button'); b.textContent = 'Deshacer';
    b.onclick = () => { t.deshacer.forEach(f => f && f()); t.cerrar(); }; el.appendChild(b);
  }
  cont.appendChild(el);
  if (clave) toastsActivos.set(clave, t);
  if (opt.ms !== 0) t.timer = setTimeout(t.cerrar, opt.ms || (opt.deshacer ? 8000 : 4500));
}

function marcarRealizada(id, el) {
  const n = nota(id); if (!n || n.estado !== 'activa') return;
  const sig = realizarNota(id);
  if (el) el.classList.add('hecha');
  setTimeout(renderBase, 650);
  toast(sig ? `Nota realizada · la siguiente, el ${diaCorto(sig.fecha_limite)}` : 'Nota realizada', {
    clave: 'hecha', plural: k => k + ' notas realizadas',
    deshacer: () => { deshacerRealizada(id, sig); renderBase(); },
  });
}
// Realiza una nota y, si se repite, crea ya la siguiente (también sin conexión). Devuelve la siguiente.
function realizarNota(id) {
  const n = nota(id);
  editarNotaLocal(id, { estado: 'realizada' });
  if (!n || !n.repetir) return null;
  const sig = proximaRepeticion(n);
  return nota(sig.id) || crearNotaLocal(sig);
}
// Deshacer «realizada»: la siguiente repetición se quita si aún no se ha tocado (el worker hace lo mismo).
function deshacerRealizada(id, sig) {
  editarNotaLocal(id, { estado: 'activa' });
  const s = sig && nota(sig.id);
  if (!s || s.version !== 1 || s.actualizada !== s.creada) return;
  S.notas = S.notas.filter(x => x.id !== s.id);
  S.outbox = S.outbox.filter(o => !(o.kind === 'nota' && o.ref === s.id && !o.enviando));
  guardarOutbox(); guardarLocal();
}

// ---------- Fotos ----------
// Cada foto se reduce en el dispositivo (grande: 1600 px; miniatura: 400 px) y espera en IndexedDB
// (foto:ID:grande / foto:ID:mini) hasta que se sube. Así se pueden hacer fotos sin cobertura.
const FOTOS_MAX = 12;
const quitarPend = id => { S.fotosPend = S.fotosPend.filter(p => p.id !== id); };
const guardarPend = () => idb.set('fotos-pend', S.fotosPend);
// Lista de fotos de una nota: las del servidor más las que aún esperan en este dispositivo.
function conFotosPendientes(notaId, fotos) {
  const l = [...(fotos || [])];
  for (const p of S.fotosPend) if (p.nota === notaId && !l.some(f => f.id === p.id)) l.push({ id: p.id, ancho: p.ancho, alto: p.alto, creada: p.creada, pendiente: true });
  return l;
}
async function prepararFoto(file) {
  let img;
  try { img = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { img = await createImageBitmap(file); }
  const reducir = (lado, calidad) => new Promise((res, rej) => {
    const k = Math.min(1, lado / Math.max(img.width, img.height)), w = Math.round(img.width * k), h = Math.round(img.height * k);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    c.toBlob(b => b ? res({ b, w, h }) : rej(new Error('sin imagen')), 'image/jpeg', calidad);
  });
  const grande = await reducir(1600, 0.8), mini = await reducir(400, 0.7);
  if (img.close) img.close();
  return { grande, mini };
}
async function anadirFotos(notaId, files) {
  const n = nota(notaId); if (!n || !files || !files.length) return;
  n.fotos = n.fotos || [];
  const libres = FOTOS_MAX - n.fotos.length;
  if (libres <= 0) { toast(`Una nota admite como máximo ${FOTOS_MAX} fotos.`); return; }
  if (files.length > libres) toast(`Solo caben ${libres} ${libres === 1 ? 'foto' : 'fotos'} más en esta nota.`);
  for (const f of [...files].slice(0, libres)) {
    try {
      const { grande, mini } = await prepararFoto(f);
      const id = 'f' + uid().replace(/-/g, '').slice(0, 24);
      await idb.set(`foto:${id}:grande`, grande.b);
      await idb.set(`foto:${id}:mini`, mini.b);
      const p = { nota: notaId, id, ancho: grande.w, alto: grande.h, creada: new Date().toISOString() };
      S.fotosPend.push(p);
      n.fotos.push({ ...p, nota: undefined, pendiente: true });
    } catch { toast('No se ha podido leer una de las fotos.'); }
  }
  await guardarPend(); guardarLocal();
  pintarFotos(); renderBase();
  subirFotos();
}
let subiendoFotos = false;
async function subirFotos() {
  if (subiendoFotos || !S.cfg.url || !S.cfg.token || !navigator.onLine || !S.fotosPend.length) return;
  subiendoFotos = true;
  try {
    for (const p of [...S.fotosPend]) {
      // La nota tiene que existir ya en el servidor.
      if (S.outbox.some(o => o.kind === 'nota' && o.ref === p.nota && o.method === 'POST')) continue;
      const mini = await idb.get(`foto:${p.id}:mini`), grande = await idb.get(`foto:${p.id}:grande`);
      if (!grande) { quitarPend(p.id); continue; }
      try {
        if (mini) await api(`/notas/${p.nota}/fotos/${p.id}/mini`, { method: 'POST', body: mini, raw: true, headers: { 'Content-Type': 'image/jpeg' } });
        const r = await api(`/notas/${p.nota}/fotos/${p.id}/grande?ancho=${p.ancho}&alto=${p.alto}`, { method: 'POST', body: grande, raw: true, headers: { 'Content-Type': 'image/jpeg' } });
        quitarPend(p.id);
        await idb.del(`foto:${p.id}:grande`);   // la miniatura se queda para verla sin conexión
        const n = nota(p.nota); if (n) n.fotos = conFotosPendientes(p.nota, r.fotos);
      } catch (e) {
        if (e.status === 404 || e.status === 400 || e.status === 413) {
          quitarPend(p.id);
          if (e.status !== 404) toast('No se ha podido subir una foto: ' + e.message);
        } else break;   // sin conexión o error del servidor: se reintenta en la próxima sincronización
      }
    }
  } finally {
    subiendoFotos = false;
    await guardarPend(); guardarLocal();
    pintarFotos(); renderBase();
  }
}
// Devuelve una URL para mostrar la foto: desde el dispositivo si la tiene, o pidiéndola al worker con el token.
async function urlFoto(notaId, fotoId, tipo) {
  const k = fotoId + '-' + tipo;
  if (S.fotoUrls.has(k)) return S.fotoUrls.get(k);
  let blob = await idb.get(`foto:${fotoId}:${tipo}`);
  if (!blob) {
    const r = await fetch(S.cfg.url.replace(/\/+$/, '') + `/notas/${notaId}/fotos/${fotoId}/${tipo}`, { headers: { Authorization: 'Bearer ' + S.cfg.token } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    blob = await r.blob();
    if (tipo === 'mini') idb.set(`foto:${fotoId}:mini`, blob);
  }
  const u = URL.createObjectURL(blob);
  S.fotoUrls.set(k, u);
  return u;
}
// Rellena las <img data-foto> que aún no tienen imagen. La grande, si no se puede cargar, usa la miniatura.
function cargarFotos(root = document) {
  for (const img of $$('img[data-foto]:not([src])', root)) {
    const { nota: n, foto, tipo = 'mini' } = img.dataset;
    urlFoto(n, foto, tipo).catch(() => tipo === 'grande' ? urlFoto(n, foto, 'mini') : Promise.reject())
      .then(u => { img.src = u; }).catch(() => { img.closest('.foto-mini, .foto-visor')?.classList.add('sin-foto'); });
  }
}
function quitarFotoLocal(notaId, fotoId) {
  const n = nota(notaId); if (!n) return;
  const f = (n.fotos || []).find(x => x.id === fotoId);
  n.fotos = (n.fotos || []).filter(x => x.id !== fotoId);
  if (f && f.pendiente) { quitarPend(fotoId); guardarPend(); }
  else encolar({ kind: 'foto', ref: notaId, method: 'DELETE', path: `/notas/${notaId}/fotos/${fotoId}` });
  idb.del(`foto:${fotoId}:mini`); idb.del(`foto:${fotoId}:grande`);
  guardarLocal();
}
// Sección «Fotos» del editor (las fotos se guardan al momento, sin esperar a «Guardar»).
function bloqueFotos(e) {
  if (!e.id) return `<div class="field" id="ed-fotos"><span class="field-label">Fotos</span><p class="hint">Guarda la nota para poder añadirle fotos.</p></div>`;
  const l = (nota(e.id) || {}).fotos || [];
  return `<div class="field" id="ed-fotos"><span class="field-label">Fotos${l.length ? ` <small>${l.length}/${FOTOS_MAX}</small>` : ''}</span>
    <div class="fotos-grid">${l.map(f => `<button type="button" class="foto-mini" data-act="foto-ver" data-nota="${esc(e.id)}" data-v="${esc(f.id)}" aria-label="Ver foto">
        <img data-foto="${esc(f.id)}" data-nota="${esc(e.id)}" alt="">${f.pendiente ? '<span class="foto-pend">Por subir</span>' : ''}</button>`).join('')}
      ${l.length < FOTOS_MAX ? `<label class="foto-mas">+ Foto<input type="file" accept="image/*" multiple data-fotos="${esc(e.id)}" hidden></label>` : ''}</div></div>`;
}
function pintarFotos() { const b = $('#ed-fotos'); if (b && S.ed) { b.outerHTML = bloqueFotos(S.ed); cargarFotos($('#ed-fotos')); } }
function modalFoto() {
  const { nota: notaId, id } = S.modal, f = ((nota(notaId) || {}).fotos || []).find(x => x.id === id);
  if (!f) return '';
  return `<div class="overlay foto-visor" data-act="modal-cerrar" role="dialog" aria-label="Foto">
    <img data-foto="${esc(id)}" data-nota="${esc(notaId)}" data-tipo="grande" alt="Foto de la nota">
    <div class="foto-acciones"><button class="btn danger" data-act="foto-quitar">Quitar foto</button><button class="btn" data-act="modal-cerrar">Cerrar</button></div>
  </div>`;
}

// ---------- Notas recurrentes ----------
const REPETIR_N = [['', 'No se repite'], ['laborables', 'Cada día laborable'], ['semanal', 'Cada semana'], ['quincenal', 'Cada 2 semanas'], ['mensual', 'Cada mes']];
const textoRepetir = r => (REPETIR_N.find(x => x[0] === r) || ['', ''])[1];
// Mismo cálculo que el worker (fechaSiguiente y proximaRepeticion).
function fechaSiguiente(f, repetir) {
  const [y, m, d] = f.split('-').map(Number);
  if (repetir === 'laborables') { let x = f; do x = addDias(x, 1); while ([0, 6].includes(new Date(x + 'T12:00').getDay())); return x; }
  if (repetir === 'semanal') return addDias(f, 7);
  if (repetir === 'quincenal') return addDias(f, 14);
  if (repetir === 'mensual') return ymd(new Date(y, m, Math.min(d, new Date(y, m + 1, 0).getDate())));
  return f;
}
function proximaRepeticion(n) {
  const hoy = hoyYmd();
  let f = n.fecha_limite || hoy;
  do f = fechaSiguiente(f, n.repetir); while (f < hoy);
  const serie = n.serie || n.id;
  return {
    id: serie + '_' + f, serie, repetir: n.repetir, titulo: n.titulo, cuerpo: n.cuerpo || '', prioridad: n.prio_antes || n.prioridad,
    persona_id: n.persona_id || null, fecha_limite: f, hora_limite: n.hora_limite || null, aviso_unidad: n.aviso_unidad || null, aviso_cant: n.aviso_cant || null,
    duracion: n.duracion || null, subir_critica: n.subir_critica, checklist: (n.checklist || []).map(p => ({ t: p.t, hecho: false })),
    etiquetas: [...(n.etiquetas || [])], origen: 'app',
  };
}
function aPapelera(id) {
  editarNotaLocal(id, { estado: 'papelera' });
  renderBase();
  toast('Nota enviada a la papelera', {
    clave: 'papelera', plural: k => k + ' notas enviadas a la papelera',
    deshacer: () => { editarNotaLocal(id, { estado: 'activa' }); renderBase(); },
  });
}

// ---------- Vista principal ----------
function textoCuando(n) {
  const partes = [];
  const h = hoyYmd();
  if (n.fecha_limite) {
    const hl = n.hora_limite ? ' ' + n.hora_limite : '';
    const late = n.fecha_limite < h || (n.fecha_limite === h && n.hora_limite && n.hora_limite < hora(Date.now()));
    partes.push(`<span class="${late ? 'late' : ''}">${late ? 'venció ' + esc((n.fecha_limite === h ? 'hoy' : diaCorto(n.fecha_limite)) + hl) : '⚑ ' + esc(relDia(n.fecha_limite) + hl)}</span>`);
  }
  // El aviso de la hora límite ya se ve en la fecha; aquí solo se muestra el aviso previo.
  const enLimite = n.alarma && n.hora_limite && Date.parse(n.alarma) === momentosAviso({ fecha_limite: n.fecha_limite, hora_limite: n.hora_limite })[0];
  if (n.alarma && !enLimite) {
    const d = ymd(n.alarma);
    partes.push(`<span class="alarm">🔔 ${d === h ? '' : esc(relDia(d)) + ' '}${esc(hora(n.alarma))}</span>`);
  }
  if (textoCheck(n)) partes.push(`<span class="chk-n">${textoCheck(n)}</span>`);
  if (n.repetir) partes.push(`<span class="rep" title="${esc(textoRepetir(n.repetir))}">↻</span>`);
  if ((n.fotos || []).length) partes.push(`<span class="fotos-n">📷 ${n.fotos.length}</span>`);
  return partes.join(' ');
}
function filaNota(n) {
  const tags = (n.etiquetas || []).map(etq).filter(Boolean).map(e => '#' + esc(e.nombre)).join(' ');
  const p = per(n.persona_id);
  return `<article class="nota p-${n.prioridad}" data-id="${esc(n.id)}">
    <button class="tick" data-act="hecha" data-id="${esc(n.id)}" aria-label="Marcar como realizada: ${esc(n.titulo)}"></button>
    <button class="n-main" data-act="abrir" data-id="${esc(n.id)}">
      <span class="n-prio"><i class="dot"></i>${PRIO_N[n.prioridad]}</span>
      <span class="n-tit"><i class="dot"></i><span>${esc(n.titulo)}${n.cuerpo ? `<span class="n-inline-body">${esc(n.cuerpo.replace(/\s+/g, ' '))}</span>` : ''}</span></span>
      ${n.cuerpo ? `<span class="n-body">${esc(n.cuerpo.replace(/\s+/g, ' '))}</span>` : ''}
      <span class="n-meta"><span class="n-tags">${tags}</span><span class="n-who">${p ? esc(p.nombre) : ''}</span><span class="n-when">${textoCuando(n)}</span></span>
    </button>
  </article>`;
}

function nombreVista() {
  if (!S.ui.vista) return filtroActivo(S.ui.filtro) ? 'Notas filtradas' : 'Todas las notas';
  const v = S.vistas.find(x => x.id === S.ui.vista);
  return v ? v.nombre : 'Todas las notas';
}
const vistaModificada = () => {
  if (!S.ui.vista) return false;
  const v = S.vistas.find(x => x.id === S.ui.vista);
  return v && JSON.stringify({ ...filtroVacio(), ...v.filtro }) !== JSON.stringify(S.ui.filtro);
};
function chipsFiltro() {
  const f = S.ui.filtro, out = [];
  if (f.etiquetas.length) out.push(f.etiquetas.map(id => '#' + ((etq(id) || {}).nombre || '?')).join(f.modo === 'alguna' ? ' o ' : ' y '));
  if (f.prioridades.length) out.push(f.prioridades.map(p => PRIO_N[p]).join(', '));
  if (f.personas.length) out.push(f.personas.map(id => id === 'ninguna' ? 'Sin asignar' : (per(id) || {}).nombre).join(', '));
  if (f.conAlarma) out.push('Con avisos');
  if (f.venceSemana) out.push('Vencen esta semana');
  if (f.estancadas) out.push('Sin tocar 10+ días');
  return out;
}

function renderBase() {
  const base = $('#base');
  if (!base) return;
  const lista = visibles();
  const total = activas().length;
  const urgentes = activas().filter(n => n.prioridad === 'critica').length;
  const grupos = agrupar(lista);
  const sidebarItems = [{ id: '', nombre: 'Todas las notas', regla: '', n: total }]
    .concat(S.vistas.map(v => ({ id: v.id, nombre: v.nombre, regla: resumenFiltro(v.filtro), n: activas().filter(n => cumpleFiltro(n, { ...filtroVacio(), ...v.filtro })).length })));
  const cur = S.ui.vista || '';
  const banners = [];
  if (!S.cfg.url || !S.cfg.token) banners.push(`<div class="banner warn"><span class="grow"><b>Conecta la app con tu worker</b> para guardar las notas en la nube.</span><a class="btn small" href="#/ajustes">Abrir Ajustes</a></div>`);
  if (S.workerAntiguo) banners.push(`<div class="banner bad"><span class="grow"><b>Este dispositivo está conectado a un worker antiguo.</b> No se guardan la hora, el checklist, la repetición ni las fotos. Cambia la URL del worker en Ajustes.</span><a class="btn small" href="#/ajustes">Abrir Ajustes</a></div>`);
  if (S.conflictos.length) banners.push(`<div class="banner bad"><span class="grow"><b>${S.conflictos.length === 1 ? 'Una nota se ha editado' : S.conflictos.length + ' notas se han editado'} en dos dispositivos a la vez.</b> Elige qué versión conservar.</span><a class="btn small" href="#/conflicto">Resolver</a></div>`);
  const pend = S.audios.filter(a => a.estado === 'pendiente' || a.estado === 'error' || a.estado === 'transcrito');
  if (pend.length) banners.push(`<div class="banner warn"><span class="grow"><b>${pend.length === 1 ? 'Tienes 1 audio' : 'Tienes ' + pend.length + ' audios'} sin analizar.</b> Se guardaron sin conexión o falló el análisis.</span><a class="btn small" href="#/dictado">Ver audios</a></div>`);
  if (toca_revision() && candidatasRevision().length) banners.push(`<div class="banner"><span class="grow"><b>Revisión semanal:</b> ${candidatasRevision().length} notas atrasadas o sin tocar desde hace días.</span><a class="btn small primary" href="#/revision">Empezar</a></div>`);
  const pb = porBorrar(7);
  if (pb.length) banners.push(`<div class="banner warn"><span class="grow"><b>${pb.length === 1 ? '1 nota realizada' : pb.length + ' notas realizadas'} se borrará${pb.length === 1 ? '' : 'n'} esta semana.</b></span><a class="btn small" href="#/historial">Revisar</a></div>`);
  const chips = chipsFiltro();

  base.innerHTML = `
  <header class="topbar">
    <div class="title"><h1>Notas</h1><span class="count">${total} activas${urgentes ? ' · ' + urgentes + (urgentes === 1 ? ' urgente' : ' urgentes') : ''}</span></div>
    ${selectorModo('desk-only')}
    <label class="search desk-only">${ICON.search}<input id="q" type="search" placeholder="Buscar en notas, etiquetas o personas" value="${esc(S.ui.q)}" aria-label="Buscar"></label>
    <span class="spacer desk-only"></span>
    <span id="sync" class="status" title="${esc(S.sync.msg)}">${esc(textoSync())}</span>
    <button class="icon-btn mob-only" data-act="buscar" aria-label="Buscar">${ICON.search}</button>
    <a class="icon-btn mob-only" href="#/menu" aria-label="Menú">${ICON.menu}</a>
    <a class="btn pill orange desk-only" href="#/dictado" data-act="dictar">${ICON.mic}Dictar</a>
    <a class="btn pill primary desk-only" href="#/nota/nueva">${ICON.plus}Nueva nota</a>
  </header>
  ${S.ui.buscar ? `<div class="mob-only" style="padding:8px 16px 0"><label class="search">${ICON.search}<input id="qm" type="search" placeholder="Buscar" value="${esc(S.ui.q)}" aria-label="Buscar"><button class="icon-btn" data-act="cerrar-buscar" aria-label="Cerrar búsqueda" style="width:34px;height:34px">${ICON.close}</button></label></div>` : ''}
  <div class="layout">
    <nav class="sidebar" aria-label="${S.ui.modo === 'calendario' ? 'Opciones del calendario' : 'Grupos filtrados'}">
      ${S.ui.modo === 'calendario' ? `<div class="side-groups">${calLateral()}</div>` : `
      ${sideItem(sidebarItems[0], cur)}
      <div class="side-head"><span>Grupos filtrados</span><button class="btn small" data-act="guardar-grupo" title="Guardar los filtros actuales como grupo" ${filtroActivo(S.ui.filtro) ? '' : 'disabled'}>+ Guardar</button></div>
      <div class="side-groups">
        ${sidebarItems.slice(1).map(it => sideItem(it, cur)).join('') || '<p class="hint" style="padding:4px 12px">Aplica filtros y guárdalos como grupo para volver a ellos con un clic.</p>'}
      </div>`}
      <div class="side-foot">
        <a class="side-item" href="#/resumen"><span class="grow"><b>Resumen del día</b></span></a>
        <a class="side-item" href="#/revision"><span class="grow"><b>Revisión semanal</b></span></a>
        <a class="side-item" href="#/historial"><span class="grow"><b>Historial y papelera</b></span></a>
        <a class="side-item" href="#/ajustes"><span class="grow"><b>Ajustes</b></span></a>
      </div>
    </nav>
    <main class="main modo-${S.ui.modo}">
      ${banners.join('')}
      ${S.ui.modo !== 'lista' ? (S.ui.modo === 'matriz' ? vistaMatriz() : vistaCalendario()) : `
      <div class="groups-row">
        <div class="label">Grupos filtrados</div>
        <div class="chips">
          <button class="chip" data-act="vista" data-id="" aria-pressed="${!cur}">Todas</button>
          ${S.vistas.map(v => `<button class="chip" data-act="vista" data-id="${esc(v.id)}" aria-pressed="${cur === v.id}">${esc(v.nombre)}</button>`).join('')}
        </div>
      </div>
      <div class="main-head desk-only">
        <h2>${esc(nombreVista())}</h2>
        ${vistaModificada() ? '<button class="btn small" data-act="actualizar-grupo">Actualizar grupo</button>' : ''}
        <span class="hint">Agrupar</span>
        <div class="seg"><button data-act="agrupar" data-v="fecha" aria-pressed="${S.ui.agrupar === 'fecha'}">Fecha</button><button data-act="agrupar" data-v="etiqueta" aria-pressed="${S.ui.agrupar === 'etiqueta'}">Etiqueta</button></div>
        <a class="btn small" href="#/filtros">${ICON.filter}Filtros${filtroActivo(S.ui.filtro) ? ' · ' + chips.length : ''}</a>
        <button class="btn small" data-act="pdf-reunion">PDF para reunión</button>
      </div>
      <div class="toolbar">
        ${selectorModo('mob-only')}
        <span class="hint">Agrupar</span>
        <div class="seg"><button data-act="agrupar" data-v="fecha" aria-pressed="${S.ui.agrupar === 'fecha'}">Fecha</button><button data-act="agrupar" data-v="etiqueta" aria-pressed="${S.ui.agrupar === 'etiqueta'}">Etiqueta</button></div>
        <span class="grow"></span>
        <a class="btn small" href="#/filtros">${ICON.filter}Filtros${filtroActivo(S.ui.filtro) ? ' · ' + chips.length : ''}</a>
      </div>
      ${chips.length ? `<div class="active-filters">${chips.map(c => `<span class="tag">${esc(c)}</span>`).join('')}<button class="btn link small" data-act="limpiar-filtro">Quitar filtros</button>${!S.ui.vista ? '<button class="btn link small mob-only" data-act="guardar-grupo">Guardar como grupo</button>' : vistaModificada() ? '<button class="btn link small mob-only" data-act="actualizar-grupo">Actualizar grupo</button>' : ''}</div>` : ''}
      <div class="list">
        ${grupos.map(g => `<section class="group ${g.key}"><h2>${esc(g.nombre)} <small>${g.notas.length}</small></h2><div class="rows">${g.notas.map(filaNota).join('')}</div></section>`).join('')}
        ${!lista.length ? vacio(total) : ''}
      </div>`}
    </main>
  </div>
  <div class="bottombar">
    <a class="btn pill orange" href="#/dictado" data-act="dictar">${ICON.mic}Dictar</a>
    <a class="btn pill primary" href="#/nota/nueva">${ICON.plus}Nueva nota</a>
  </div>`;
  medirTopbar();
}
// Selector «Lista · Calendario · Matriz»: en ordenador va en la barra superior y en el móvil en la barra fija.
function selectorModo(clase) {
  return `<div class="seg modos ${clase}" role="group" aria-label="Modo de vista">${MODOS.map(([v, t]) => `<button data-act="modo" data-v="${v}" aria-pressed="${S.ui.modo === v}">${t}</button>`).join('')}</div>`;
}
// Selector de grupo filtrado de la Matriz y el Calendario (independiente del filtro de la Lista).
function selectorGrupo(clase) {
  const cur = S.ui.grupoVista || '';
  return `<label class="sel-grupo ${clase}">${clase === 'desk-only' ? '<span>Grupo filtrado</span>' : ''}<select class="input" data-grupo-vista aria-label="Grupo filtrado">
    <option value="">${clase === 'mob-only' ? 'Grupo filtrado: ninguno · ver todo' : 'Ninguno · ver todo'}</option>
    ${S.vistas.map(v => `<option value="${esc(v.id)}" ${cur === v.id ? 'selected' : ''}>${esc(v.nombre)}</option>`).join('')}</select></label>`;
}
// Notas activas del grupo elegido (y de la búsqueda), para la Matriz y el Calendario.
function notasDeGrupo(conRealizadas) {
  const v = S.ui.grupoVista && S.vistas.find(x => x.id === S.ui.grupoVista);
  const f = v ? { ...filtroVacio(), ...v.filtro } : null;
  return S.notas.filter(n => (n.estado === 'activa' || (conRealizadas && n.estado === 'realizada'))
    && (!f || cumpleFiltro(n, f)) && cumpleBusqueda(n, S.ui.q));
}
// Fecha corta de una nota: «hoy 12:30», «⚑ vie 2 oct», «venció 25 sep» o «sin fecha».
function cuandoCorto(n) {
  if (!n.fecha_limite) return { t: 'sin fecha', late: false };
  const h = hoyYmd(), hl = n.hora_limite ? ' ' + n.hora_limite : '';
  const late = n.fecha_limite < h || (n.fecha_limite === h && n.hora_limite && n.hora_limite < hora(Date.now()));
  if (late) return { t: 'venció ' + (n.fecha_limite === h ? 'hoy' : diaCorto(n.fecha_limite)) + hl, late };
  return { t: (n.hora_limite ? '' : '⚑ ') + relDia(n.fecha_limite) + hl + (textoAviso(n) ? ' 🔔' : '') + (n.repetir ? ' ↻' : ''), late };
}
const ordenFecha = (a, b) => String(a.fecha_limite || '9999').localeCompare(String(b.fecha_limite || '9999'))
  || String(a.hora_limite || '99:99').localeCompare(String(b.hora_limite || '99:99'))
  || String(a.creada).localeCompare(String(b.creada));

// ---------- Matriz de prioridad ----------
const MATRIZ_MOVIL = 5;   // notas visibles por bloque en el móvil antes de «Ver X más»
function vistaMatriz() {
  const notas = notasDeGrupo().sort(ordenFecha);
  const v = S.ui.grupoVista && S.vistas.find(x => x.id === S.ui.grupoVista);
  const bloques = PRIOS.map(p => {
    const lista = notas.filter(n => n.prioridad === p);
    const abierto = S.ui.matrizMas && S.ui.matrizMas[p];
    const visibles = abierto ? lista : lista.slice(0, MATRIZ_MOVIL);
    const fila = n => {
      const c = cuandoCorto(n), tags = (n.etiquetas || []).map(etq).filter(Boolean).map(e => '#' + esc(e.nombre)).join(' ');
      return `<div class="mx-row" data-id="${esc(n.id)}" data-drag="prio" data-titulo="${esc(n.titulo)}" data-cuando="${esc(c.t)}">
        <button class="tick" data-act="hecha" data-id="${esc(n.id)}" aria-label="Marcar como realizada: ${esc(n.titulo)}"></button>
        <button class="mx-main" data-act="abrir" data-id="${esc(n.id)}"><b>${esc(n.titulo)}</b>${textoCheck(n) ? ` <span class="chk-n">${textoCheck(n)}</span>` : ''}${n.cuerpo ? `<span class="mx-body"> — ${esc(n.cuerpo.replace(/\s+/g, ' '))}</span>` : ''}</button>
        <span class="mx-tags desk-only">${tags}</span>
        <span class="mx-when ${c.late ? 'late' : ''}">${esc(c.t)}</span>
      </div>`;
    };
    return `<section class="mx-q p-${p}" data-drop="prio" data-prio="${p}">
      <div class="mx-head"><span class="mx-dot"></span><h3>${PRIO_N[p]}</h3><span class="n">${lista.length}</span><span class="grow"></span><span class="mx-hint"></span></div>
      <div class="mx-rows">
        <div class="desk-only">${lista.map(fila).join('') || '<p class="hint mx-vacio">Sin notas</p>'}</div>
        <div class="mob-only">${visibles.map(fila).join('') || '<p class="hint mx-vacio">Sin notas</p>'}
          ${lista.length > MATRIZ_MOVIL ? `<button class="mx-mas" data-act="mx-mas" data-v="${p}">${abierto ? 'Ver menos' : 'Ver ' + (lista.length - MATRIZ_MOVIL) + ' más'}</button>` : ''}</div>
      </div>
    </section>`;
  }).join('');
  return `<div class="toolbar">${selectorModo('mob-only')}${selectorGrupo('mob-only')}</div>
    <div class="main-head desk-only"><h2>Matriz de prioridad</h2><span class="hint">${notas.length} ${notas.length === 1 ? 'nota activa' : 'notas activas'} · ordenadas por fecha dentro de cada bloque</span><span class="grow"></span>${selectorGrupo('desk-only')}</div>
    ${v ? `<div class="banner"><span class="grow">Mostrando solo: <b>${esc(v.nombre)}</b>.</span><button class="btn small" data-act="quitar-grupo-vista">Quitar grupo</button></div>` : ''}
    <div class="matriz">${bloques}</div>`;
}
function cambiarPrioridad(id, prio) {
  const n = nota(id);
  if (!n || n.prioridad === prio) return;
  const antes = { prioridad: n.prioridad, subir_critica: n.subir_critica };
  // Si se baja a mano una urgente, no se vuelve a subir sola por la fecha límite.
  const cambios = { prioridad: prio };
  if (antes.prioridad === 'critica' && n.subir_critica !== 0) cambios.subir_critica = 0;
  editarNotaLocal(id, cambios);
  renderBase();
  toast(`«${n.titulo}» pasa de ${PRIO_N[antes.prioridad]} a ${PRIO_N[prio]}`, {
    deshacer: () => { editarNotaLocal(id, 'subir_critica' in cambios ? antes : { prioridad: antes.prioridad }); renderBase(); },
  });
}

// ---------- Calendario ----------
const CAL_HH = 46;   // píxeles por hora en la vista Semana
const HORARIOS = [[6, 18], [7, 19], [7, 20], [8, 18], [8, 20], [6, 22]];
const DIAS_CORTOS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const DIAS_LARGOS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const pad2 = n => String(n).padStart(2, '0');
const mayus = s => s.charAt(0).toUpperCase() + s.slice(1);
// Horario visible (ajuste compartido entre dispositivos): 7:00–19:00 por defecto.
const calHorario = () => { const i = Number(S.srv.cal_inicio), f = Number(S.srv.cal_fin); return S.srv.cal_inicio != null && i >= 0 && f > i && f <= 24 ? [i, f] : [7, 19]; };
const lunesDe = f => { const [y, m, d] = f.split('-').map(Number); return addDias(f, -((new Date(y, m - 1, d).getDay() + 6) % 7)); };
const minutosDe = h => { const [a, b] = h.split(':').map(Number); return a * 60 + b; };
const durNota = n => n.duracion || DURACION_DEF;
const fmtLibre = m => m <= 0 ? '0 min' : textoDuracion(m);
const tituloMes = f => { const [y, m] = f.split('-').map(Number); return mayus(new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }).replace(' de ', ' ')); };
function cal() { if (!S.ui.cal.ref) S.ui.cal.ref = hoyYmd(); return S.ui.cal; }
// Notas del calendario: activas con fecha (y realizadas, si se muestran) del grupo elegido.
const notasCal = () => notasDeGrupo(cal().realizadas).filter(n => n.fecha_limite);
// Nivel de carga de un día (0-3) según sus notas activas.
const cargaDia = (notas, f) => Math.min(3, notas.filter(n => n.fecha_limite === f && n.estado === 'activa').length);

function vistaCalendario() {
  const c = cal(), notas = notasCal();
  const v = S.ui.grupoVista && S.vistas.find(x => x.id === S.ui.grupoVista);
  const lun = lunesDe(c.ref);
  const titulo = c.vista === 'mes' ? tituloMes(c.ref)
    : (() => { const dom = addDias(lun, 6), a = new Date(lun + 'T12:00'), b = new Date(dom + 'T12:00');
      const f = (d, o) => d.toLocaleDateString('es-ES', o).replace(/\./g, '');
      return a.getMonth() === b.getMonth() ? `${a.getDate()} – ${f(b, { day: 'numeric', month: 'short', year: 'numeric' })}` : `${f(a, { day: 'numeric', month: 'short' })} – ${f(b, { day: 'numeric', month: 'short', year: 'numeric' })}`; })();
  // Atrasadas: de días anteriores (las de hoy ya se ven en su día).
  const atrasadas = notas.filter(n => n.estado === 'activa' && n.fecha_limite < hoyYmd()).sort(ordenFecha);
  return `<div class="toolbar">${selectorModo('mob-only')}
      <div class="calm-opciones mob-only"><div class="seg"><button data-act="cal-vista" data-v="semana" aria-pressed="${c.vista !== 'mes'}">Agenda</button><button data-act="cal-vista" data-v="mes" aria-pressed="${c.vista === 'mes'}">Mes</button></div>${selectorGrupo('mob-only')}</div></div>
    <div class="calm mob-only">${calMovil(notas, atrasadas, v)}</div>
    <div class="cal desk-only">
      <div class="cal-head">
        <button class="btn icon-sq" data-act="cal-mover" data-v="-1" aria-label="${c.vista === 'mes' ? 'Mes' : 'Semana'} anterior">‹</button>
        <button class="btn" data-act="cal-hoy">Hoy</button>
        <button class="btn icon-sq" data-act="cal-mover" data-v="1" aria-label="${c.vista === 'mes' ? 'Mes' : 'Semana'} siguiente">›</button>
        <h2>${esc(titulo)}</h2>
        <div class="seg"><button data-act="cal-vista" data-v="semana" aria-pressed="${c.vista !== 'mes'}">Semana</button><button data-act="cal-vista" data-v="mes" aria-pressed="${c.vista === 'mes'}">Mes</button></div>
      </div>
      ${v ? `<div class="banner"><span class="grow"><b>Mostrando solo: ${esc(v.nombre)}</b> · Los días vacíos pueden tener notas de otros grupos.</span><button class="btn small" data-act="quitar-grupo-vista">Quitar grupo · ver todo</button></div>` : ''}
      ${atrasadas.length ? `<div class="cal-atrasadas"><b>Atrasadas · ${atrasadas.length}</b>
        <div class="chips">${atrasadas.map(n => `<button class="chip" data-act="abrir" data-id="${esc(n.id)}" ${arrastrable(n)}>${esc(n.titulo)} · ${esc(cuandoCorto(n).t)}</button>`).join('')}</div>
        <span class="hint">Arrástralas a un hueco para replanificar</span></div>` : ''}
      ${c.vista === 'mes' ? calMes(notas) : calSemana(notas)}
    </div>`;
}

// Reparte en columnas las notas que se solapan en el mismo día.
function enColumnas(evs) {
  const out = []; let grupo = [], finGrupo = -1;
  const cerrar = () => {
    const cols = [];
    for (const ev of grupo) { let k = cols.findIndex(fin => fin <= ev.s); if (k < 0) { k = cols.length; cols.push(0); } cols[k] = ev.e; ev.col = k; }
    for (const ev of grupo) ev.ncol = cols.length;
    out.push(...grupo); grupo = [];
  };
  for (const ev of evs.sort((a, b) => a.s - b.s || b.e - a.e)) { if (grupo.length && ev.s >= finGrupo) cerrar(); grupo.push(ev); finGrupo = Math.max(finGrupo, ev.e); }
  if (grupo.length) cerrar();
  return out;
}

function calSemana(notas) {
  const c = cal(), [ini, fin] = calHorario(), lun = lunesDe(c.ref), hoy = hoyYmd();
  const dias = Array.from({ length: c.finde ? 7 : 5 }, (_, i) => addDias(lun, i));
  const alto = (fin - ini) * CAL_HH, vis0 = ini * 60, vis1 = fin * 60;
  const ahora = new Date(), minAhora = ahora.getHours() * 60 + ahora.getMinutes();
  const cols = `58px repeat(${dias.length}, minmax(0, 1fr))`;
  const datos = dias.map((f, i) => {
    const delDia = notas.filter(n => n.fecha_limite === f);
    const conHora = delDia.filter(n => n.hora_limite);
    // Libre = horario visible − lo que ocupan las notas activas con hora (las realizadas no cuentan).
    const ocupado = conHora.filter(n => n.estado === 'activa').reduce((a, n) => { const s = minutosDe(n.hora_limite); return a + Math.max(0, Math.min(s + durNota(n), vis1) - Math.max(s, vis0)); }, 0);
    return { f, finde: i >= 5, hoy: f === hoy, delDia, conHora, libre: (fin - ini) * 60 - ocupado };
  });
  const cabecera = datos.map(d => { const x = new Date(d.f + 'T12:00');
    return `<div class="cal-dh ${d.hoy ? 'hoy' : ''} ${d.finde ? 'finde' : ''}"><b>${DIAS_LARGOS[(x.getDay() + 6) % 7].slice(0, 3)} ${x.getDate()}${d.hoy ? ' · Hoy' : ''}</b><span>Libre: <b>${fmtLibre(d.libre)}</b></span></div>`; }).join('');
  const limites = datos.map(d => `<div class="cal-due ${d.hoy ? 'hoy' : ''} ${d.finde ? 'finde' : ''}" data-drop="cal" data-fecha="${d.f}" data-sinhora="1" data-act="cal-nueva" title="Pulsa para crear una nota con esta fecha, sin hora">
    ${d.delDia.filter(n => !n.hora_limite).sort((a, b) => rankPrio(a.prioridad) - rankPrio(b.prioridad)).map(n => `<button class="cal-chip p-${n.prioridad} ${n.estado !== 'activa' ? 'hecha' : ''}" data-act="abrir" data-id="${esc(n.id)}" ${arrastrable(n)} title="${esc(n.titulo)}">${esc(n.titulo)}</button>`).join('')}</div>`).join('');
  const horas = Array.from({ length: fin - ini }, (_, i) => `<span style="top:${i * CAL_HH + 2}px">${ini + i}:00</span>`).join('');
  const columnas = datos.map(d => {
    // Las notas fuera del horario visible se pegan al borde; se reparten en columnas según donde se dibujan.
    const evs = enColumnas(d.conHora.map(n => { const r = minutosDe(n.hora_limite), s = Math.min(Math.max(r, vis0), vis1 - 26); return { n, r, s, e: s + Math.max(durNota(n), 26) }; }));
    const bloques = evs.map(({ n, r, s, col, ncol }) => {
      const dur = durNota(n);
      const top = (s - vis0) / 60 * CAL_HH;
      const h = Math.max(Math.min(dur / 60 * CAL_HH - 2, alto - top), 20);
      const fuera = r < vis0 ? '↑ ' : r >= vis1 ? '↓ ' : '';
      return `<button class="cal-ev p-${n.prioridad} ${n.estado !== 'activa' ? 'hecha' : ''}" data-act="abrir" data-id="${esc(n.id)}" ${arrastrable(n)}
        style="top:${top + 1}px;height:${h}px;left:calc(${col / ncol * 100}% + 4px);width:calc(${100 / ncol}% - 8px)" title="${esc(n.hora_limite + ' ' + n.titulo + ' · ' + textoDuracion(dur))}">
        <b>${fuera}${esc(n.hora_limite)}</b> <span class="t">${esc(n.titulo)}</span> <span class="d">· ${textoDuracion(dur)}${textoAviso(n) ? ' 🔔' : ''}${n.repetir ? ' ↻' : ''}</span>${n.estado === 'activa' ? '<span class="cal-asa" data-estirar aria-hidden="true"></span>' : ''}</button>`;
    }).join('');
    const linea = d.hoy && minAhora >= vis0 && minAhora < vis1 ? `<div class="cal-ahora" style="top:${(minAhora - vis0) / 60 * CAL_HH}px"></div>` : '';
    return `<div class="cal-col ${d.hoy ? 'hoy' : ''} ${d.finde ? 'finde' : ''}" data-drop="cal" data-fecha="${d.f}" data-act="cal-nueva" title="Pulsa en un hueco para crear una nota a esa hora" style="height:${alto}px">${bloques}${linea}</div>`;
  }).join('');
  return `<div class="cal-semana">
    <div class="cal-fila" style="grid-template-columns:${cols}"><span></span>${cabecera}</div>
    <div class="cal-fila cal-fila-due" style="grid-template-columns:${cols}"><span class="cal-due-lbl">⚑ Fecha límite</span>${limites}</div>
    <div class="cal-scroll"><div class="cal-fila cal-rejilla" style="grid-template-columns:${cols};--hh:${CAL_HH}px"><div class="cal-horas" style="height:${alto}px">${horas}</div>${columnas}</div></div>
  </div>`;
}

function calMes(notas) {
  const c = cal(), [y, m] = c.ref.split('-').map(Number), hoy = hoyYmd();
  const ini = lunesDe(`${y}-${pad2(m)}-01`), ultimo = ymd(new Date(y, m, 0));
  const semanas = Math.ceil((Math.round((Date.parse(ultimo) - Date.parse(ini)) / DIA) + 1) / 7);
  const celdas = Array.from({ length: semanas * 7 }, (_, i) => {
    const f = addDias(ini, i), [, mm, dd] = f.split('-').map(Number);
    const lista = notas.filter(n => n.fecha_limite === f)
      .sort((a, b) => (a.hora_limite ? 0 : 1) - (b.hora_limite ? 0 : 1) || String(a.hora_limite).localeCompare(String(b.hora_limite)) || rankPrio(a.prioridad) - rankPrio(b.prioridad));
    return `<div class="cal-dia carga${cargaDia(notas, f)} ${mm !== m ? 'fuera' : ''} ${f === hoy ? 'hoy' : ''}" data-drop="cal" data-fecha="${f}" data-act="cal-dia" data-v="${f}">
      <span class="num">${dd}<button class="cal-mas-nota" data-act="cal-nueva" data-fecha="${f}" aria-label="Nueva nota el ${esc(diaLargo(f))}" title="Nueva nota este día">+</button></span>
      ${lista.slice(0, 2).map(n => `<button class="cal-mi p-${n.prioridad} ${n.estado !== 'activa' ? 'hecha' : ''}" data-act="abrir" data-id="${esc(n.id)}" ${arrastrable(n)}><i class="dot"></i>${n.hora_limite ? esc(n.hora_limite) + ' ' : ''}${esc(n.titulo)}</button>`).join('')}
      ${lista.length > 2 ? `<button class="cal-mas" data-act="cal-dia" data-v="${f}">+${lista.length - 2} más</button>` : ''}
    </div>`;
  }).join('');
  return `<div class="cal-mes"><div class="cal-mes-dow">${DIAS_LARGOS.map(d => `<span>${d}</span>`).join('')}</div>
    <div class="cal-mes-rejilla" style="grid-template-rows:repeat(${semanas}, minmax(0, 1fr))">${celdas}</div></div>`;
}

// Atributos para poder arrastrar una nota del calendario (solo las pendientes).
const arrastrable = n => n.estado === 'activa' ? `data-drag="cal" data-titulo="${esc(n.titulo)}" data-cuando="${esc(cuandoCorto(n).t)}"` : '';
// Mover una nota a otro día u hora (arrastrando), con Deshacer. El aviso previo se recalcula solo.
function moverNota(id, cambios, donde) {
  const n = nota(id); if (!n) return;
  const antes = { fecha_limite: n.fecha_limite, hora_limite: n.hora_limite || null };
  editarNotaLocal(id, cambios);
  renderBase();
  toast(`«${n.titulo}» movida a ${donde}`, { deshacer: () => { editarNotaLocal(id, antes); renderBase(); } });
}
function cambiarDuracion(id, dur) {
  const n = nota(id); if (!n) return;
  const antes = n.duracion || null;
  editarNotaLocal(id, { duracion: dur });
  renderBase();
  toast(`«${n.titulo}» dura ahora ${textoDuracion(dur)}`, { deshacer: () => { editarNotaLocal(id, { duracion: antes }); renderBase(); } });
}

// ---------- Calendario en el móvil: Agenda y Mes ----------
const sinMes = f => diaCorto(f).replace(',', '').replace(/ \S+$/, '');   // «jue 1»
const sinDia = f => diaCorto(f).replace(/^\S+ /, '');                    // «1 oct»
// En el móvil no se arrastra: la fecha se cambia desde el editor.
function calMovil(notas, atrasadas, grupo) {
  const c = cal(), hoy = hoyYmd(), lun = lunesDe(c.ref);
  const aviso = grupo ? `<div class="banner"><span class="grow">Mostrando solo: <b>${esc(grupo.nombre)}</b>.</span><button class="btn small" data-act="quitar-grupo-vista">Quitar</button></div>` : '';
  if (c.vista === 'mes') {
    const [y, m] = c.ref.split('-').map(Number), ini = lunesDe(`${y}-${pad2(m)}-01`), ultimo = ymd(new Date(y, m, 0));
    const semanas = Math.ceil((Math.round((Date.parse(ultimo) - Date.parse(ini)) / DIA) + 1) / 7);
    const celdas = Array.from({ length: semanas * 7 }, (_, i) => {
      const f = addDias(ini, i), [, mm, dd] = f.split('-').map(Number);
      const lista = notas.filter(n => n.fecha_limite === f && n.estado === 'activa').sort((a, b) => rankPrio(a.prioridad) - rankPrio(b.prioridad));
      return `<button class="calm-dia carga${cargaDia(notas, f)} ${mm !== m ? 'fuera' : ''} ${f === hoy ? 'hoy' : ''}" data-act="cal-dia" data-v="${f}" aria-label="${esc(diaLargo(f))}: ${lista.length} notas">
        <span class="num">${dd}</span><span class="puntos">${lista.slice(0, 3).map(n => `<i class="dot p-${n.prioridad}"></i>`).join('')}</span></button>`;
    }).join('');
    return `<div class="calm-nav"><button class="btn icon-sq" data-act="cal-mover" data-v="-1" aria-label="Mes anterior">‹</button><h2>${esc(tituloMes(c.ref))}</h2><button class="btn small" data-act="cal-hoy">Hoy</button><button class="btn icon-sq" data-act="cal-mover" data-v="1" aria-label="Mes siguiente">›</button></div>
      ${aviso}<div class="calm-mes">${DIAS_CORTOS.map(d => `<span>${d}</span>`).join('')}${celdas}</div>
      <p class="hint">Toca un día para ver su agenda.</p>`;
  }
  // Agenda: tira de 7 días (se desliza para cambiar de semana) y la lista por días.
  const dias = Array.from({ length: 7 }, (_, i) => addDias(lun, i));
  const tira = dias.map((f, i) => {
    const k = notas.filter(n => n.fecha_limite === f && n.estado === 'activa').length;
    return `<button class="calm-tira-dia carga${cargaDia(notas, f)} ${f === hoy ? 'hoy' : ''}" data-act="calm-ir" data-v="${f}"><span>${DIAS_CORTOS[i]}</span><b>${Number(f.slice(8))}</b><small>${k || '—'}</small></button>`;
  }).join('');
  const etiquetaDia = f => f === hoy ? 'Hoy · ' + sinMes(f) : f === addDias(hoy, 1) ? 'Mañana · ' + sinMes(f) : mayus(diaCorto(f).replace(',', ''));
  // En la semana actual, los días ya pasados no se listan (lo pendiente está en Atrasadas).
  const visibles = dias.filter(f => f >= hoy || lun > hoy || addDias(lun, 6) < hoy);
  const bloques = []; let vacios = [];
  const cerrarVacios = () => {
    if (!vacios.length) return;
    const a = vacios[0], b = vacios[vacios.length - 1];
    bloques.push(`<section class="calm-dia-sec"><div class="calm-vacio"><span class="grow">${esc(mayus(sinMes(a)))}${a !== b ? ' – ' + esc(mayus(sinMes(b))) : ''} · Sin notas · hueco disponible</span><button class="calm-mas" data-act="cal-nueva" data-fecha="${a}" aria-label="Nueva nota el ${esc(diaLargo(a))}">+ Nota</button></div></section>`);
    vacios = [];
  };
  for (const f of visibles) {
    const lista = notas.filter(n => n.fecha_limite === f)
      .sort((a, b) => (a.estado === 'activa' ? 0 : 1) - (b.estado === 'activa' ? 0 : 1) || (a.hora_limite ? 0 : 1) - (b.hora_limite ? 0 : 1) || String(a.hora_limite).localeCompare(String(b.hora_limite)) || rankPrio(a.prioridad) - rankPrio(b.prioridad));
    if (!lista.length) { vacios.push(f); continue; }
    cerrarVacios();
    const pend = lista.filter(n => n.estado === 'activa').length;
    bloques.push(`<section class="calm-dia-sec" id="calm-${f}"><div class="calm-dia-t ${f === hoy ? 'hoy' : ''}"><h2>${esc(etiquetaDia(f))}</h2><span>${pend === 1 ? '1 nota' : pend + ' notas'}</span><button class="calm-mas" data-act="cal-nueva" data-fecha="${f}" aria-label="Nueva nota el ${esc(diaLargo(f))}">+ Nota</button></div>
      ${lista.map(n => { const e = (n.etiquetas || []).map(etq).filter(Boolean)[0];
        return `<button class="calm-item p-${n.prioridad} ${n.estado !== 'activa' ? 'hecha' : ''}" data-act="abrir" data-id="${esc(n.id)}">
          <span class="calm-cuando">${n.hora_limite ? esc(n.hora_limite) + (textoAviso(n) ? ' 🔔' : '') : '⚑ Límite'}</span>
          <span class="calm-txt"><b>${esc(n.titulo)}</b><small><i class="dot"></i>${PRIO_N[n.prioridad]}${n.hora_limite ? ' · ' + textoDuracion(durNota(n)) : ''}${e ? ' · #' + esc(e.nombre) : ''}${textoCheck(n) ? ' · ' + textoCheck(n) : ''}${n.repetir ? ' · ↻' : ''}</small></span></button>`; }).join('')}</section>`);
  }
  cerrarVacios();
  const dom = addDias(lun, 6);
  return `<div class="calm-nav"><button class="btn icon-sq" data-act="cal-mover" data-v="-1" aria-label="Semana anterior">‹</button><h2>${esc(sinDia(lun))} – ${esc(sinDia(dom))}</h2><button class="btn small" data-act="cal-hoy">Hoy</button><button class="btn icon-sq" data-act="cal-mover" data-v="1" aria-label="Semana siguiente">›</button></div>
    <div class="calm-tira" data-deslizar="semana">${tira}</div>
    ${aviso}
    ${atrasadas.length ? `<div class="calm-atrasadas"><b>Atrasadas · ${atrasadas.length}</b><div>${atrasadas.map(n => `<button data-act="abrir" data-id="${esc(n.id)}">${esc(n.titulo)} (${esc(sinDia(n.fecha_limite))})</button>`).join(' · ')}</div></div>` : ''}
    ${bloques.join('') || '<p class="hint">No hay días por delante en esta semana.</p>'}`;
}
// Deslizar la tira de días a izquierda o derecha cambia de semana.
let deslizar = null;
document.addEventListener('touchstart', ev => { const t = ev.target.closest('[data-deslizar]'); deslizar = t ? { x: ev.touches[0].clientX, y: ev.touches[0].clientY } : null; }, { passive: true });
document.addEventListener('touchend', ev => {
  if (!deslizar) return;
  const dx = ev.changedTouches[0].clientX - deslizar.x, dy = ev.changedTouches[0].clientY - deslizar.y;
  deslizar = null;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) { cal().ref = addDias(cal().ref, dx < 0 ? 7 : -7); renderBase(); }
}, { passive: true });

// Panel lateral del calendario (ordenador): grupo, mes pequeño, leyenda y opciones.
function calLateral() {
  const c = cal(), notas = notasCal(), [ini, fin] = calHorario(), hoy = hoyYmd();
  const [y, m] = c.ref.split('-').map(Number), primero = lunesDe(`${y}-${pad2(m)}-01`), lun = lunesDe(c.ref);
  const mini = Array.from({ length: 42 }, (_, i) => {
    const f = addDias(primero, i), [, mm, dd] = f.split('-').map(Number);
    if (i >= 35 && mm !== m) return '';
    const semana = c.vista !== 'mes' && f >= lun && f <= addDias(lun, 6);
    return `<button class="carga${cargaDia(notas, f)} ${mm !== m ? 'fuera' : ''} ${f === hoy ? 'hoy' : ''} ${semana ? 'semana' : ''}" data-act="cal-dia" data-v="${f}" aria-label="${esc(diaLargo(f))}">${dd}</button>`;
  }).join('');
  return `<div class="cal-side">
    <section><div class="cal-lbl">Grupo filtrado</div>${selectorGrupo('cal-sel')}<small class="hint">Por defecto el calendario muestra todas las notas con fecha.</small></section>
    <section><div class="cal-mini-t">${esc(tituloMes(c.ref))}</div><div class="cal-mini">${DIAS_CORTOS.map(d => `<span>${d}</span>`).join('')}${mini}</div></section>
    <section class="cal-leyenda"><div class="cal-lbl">Leyenda</div>
      <div><i class="dot p-critica"></i>Urgente <i class="dot p-alta"></i>Alta</div>
      <div><i class="dot p-normal"></i>Normal <i class="dot p-baja"></i>Baja</div>
      <div>Con hora · ⚑ Solo fecha · 🔔 Aviso previo</div>
      <div class="cal-carga">Carga del día: <i class="carga0"></i><i class="carga1"></i><i class="carga2"></i><i class="carga3"></i></div>
      <label class="check"><input type="checkbox" data-cal="realizadas" ${c.realizadas ? 'checked' : ''}>Mostrar realizadas en gris</label>
      <label class="field"><span class="cal-lbl">Horario visible</span><select class="input" data-cal="horario">${HORARIOS.map(([a, b]) => `<option value="${a}-${b}" ${a === ini && b === fin ? 'selected' : ''}>${a}:00 – ${b}:00</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" data-cal="finde" ${c.finde ? 'checked' : ''}>Mostrar fin de semana</label>
    </section>
  </div>`;
}

// ---------- Arrastrar (ordenador y tablet) ----------
// Un solo código para ratón y táctil (Pointer Events). En táctil hay que mantener pulsado ~400 ms,
// para no mover notas al desplazar la pantalla. Los destinos llevan data-drop; las notas, data-drag.
const ARR = { st: null, suprimirClick: false };
const SOLTAR = {
  prio: (st, destino) => {
    const n = nota(st.id), p = destino && destino.dataset.prio;
    if (!n || !p || p === n.prioridad) return null;
    return { texto: `Al soltar: «${n.titulo}» pasa de ${PRIO_N[n.prioridad]} a ${PRIO_N[p]}`, pista: 'Soltar aquí para cambiar a ' + PRIO_N[p], hacer: () => cambiarPrioridad(n.id, p) };
  },
  // Calendario: en una hora de la Semana (pasos de 15 min), en la fila «⚑ Fecha límite» (sin hora) o en un día del Mes (misma hora).
  cal: (st, d) => {
    const n = nota(st.id), f = d.dataset.fecha;
    if (!n || !f) return null;
    let hora = n.hora_limite || null, hueco = null;
    if (d.classList.contains('cal-col')) {
      const [ini, fin] = calHorario(), r = d.getBoundingClientRect();
      let m = ini * 60 + Math.round((st.y - (st.offY || 0) - r.top) / CAL_HH * 60 / 15) * 15;
      m = Math.min(Math.max(m, ini * 60), fin * 60 - 15);
      hora = pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
      hueco = { top: (m - ini * 60) / 60 * CAL_HH, alto: Math.max(durNota(n) / 60 * CAL_HH - 2, 20) };
    } else if (d.dataset.sinhora) hora = null;
    if (f === n.fecha_limite && hora === (n.hora_limite || null)) return null;
    const donde = mayus(diaCorto(f).replace(',', '')) + (hora ? ', ' + hora : ' (sin hora)');
    return { texto: `Al soltar: «${n.titulo}» → ${donde}`, pista: '', hueco: hueco && { ...hueco, texto: 'Soltar aquí · ' + donde },
      hacer: () => moverNota(n.id, { fecha_limite: f, hora_limite: hora }, donde) };
  },
};
// Estirar: el asa del borde inferior de un bloque de la Semana cambia la duración (pasos de 10 min).
document.addEventListener('pointerdown', ev => {
  const asa = ev.target.closest('[data-estirar]');
  if (!asa || ev.button !== 0 || window.innerWidth < 900) return;
  const el = asa.closest('.cal-ev'), n = el && nota(el.dataset.id);
  if (!n) return;
  ev.preventDefault(); ev.stopPropagation();
  ARR.est = { el, id: n.id, y0: ev.clientY, dur0: durNota(n), dur: durNota(n) };
  document.body.classList.add('estirando');
}, true);
document.addEventListener('pointermove', ev => {
  const e = ARR.est; if (!e) return;
  ev.preventDefault();
  e.dur = Math.max(10, Math.round((e.dur0 + (ev.clientY - e.y0) / CAL_HH * 60) / 10) * 10);
  e.el.style.height = Math.max(e.dur / 60 * CAL_HH - 2, 20) + 'px';
  const d = e.el.querySelector('.d'); if (d) d.textContent = '· ' + textoDuracion(e.dur);
});
document.addEventListener('pointerup', () => {
  const e = ARR.est; if (!e) return;
  ARR.est = null; document.body.classList.remove('estirando');
  ARR.suprimirClick = true; setTimeout(() => { ARR.suprimirClick = false; }, 0);
  if (e.dur !== e.dur0) cambiarDuracion(e.id, e.dur); else renderBase();
});
document.addEventListener('pointerdown', ev => {
  const el = ev.target.closest('[data-drag]');
  if (!el || !SOLTAR[el.dataset.drag] || ev.button !== 0 || window.innerWidth < 900 || ev.target.closest('.tick')) return;
  const st = { el, tipo: el.dataset.drag, id: el.dataset.id, x0: ev.clientX, y0: ev.clientY, x: ev.clientX, y: ev.clientY, activo: false, tactil: ev.pointerType !== 'mouse' };
  // Al arrastrar un bloque de la Semana, la hora es la de su borde superior, no la del puntero.
  if (el.classList.contains('cal-ev')) st.offY = ev.clientY - el.getBoundingClientRect().top;
  if (st.tactil) st.timer = setTimeout(() => empezarArrastre(st), 400);
  ARR.st = st;
});
document.addEventListener('pointermove', ev => {
  const st = ARR.st; if (!st) return;
  st.x = ev.clientX; st.y = ev.clientY;
  const lejos = Math.hypot(st.x - st.x0, st.y - st.y0);
  if (!st.activo) {
    if (!st.tactil && lejos > 6) empezarArrastre(st);
    else if (st.tactil && lejos > 10) finArrastre();   // es un desplazamiento, no un arrastre
    return;
  }
  ev.preventDefault();
  moverArrastre(st);
});
document.addEventListener('pointerup', () => {
  const st = ARR.st; if (!st) return;
  if (st.activo) { const r = st.res; ARR.suprimirClick = true; setTimeout(() => { ARR.suprimirClick = false; }, 0); finArrastre(); if (r) r.hacer(); }
  else finArrastre();
});
document.addEventListener('pointercancel', () => finArrastre());
document.addEventListener('click', ev => { if (ARR.suprimirClick) { ev.preventDefault(); ev.stopPropagation(); ARR.suprimirClick = false; } }, true);
// Mientras se arrastra con el dedo, la pantalla no se desplaza.
document.addEventListener('touchmove', ev => { if (ARR.st && ARR.st.activo) ev.preventDefault(); }, { passive: false });

function empezarArrastre(st) {
  if (ARR.st !== st) return;
  st.activo = true;
  const g = document.createElement('div');
  g.className = 'drag-ghost';
  g.innerHTML = `<b>${esc(st.el.dataset.titulo || '')}</b><span>${esc(st.el.dataset.cuando || '')}</span>`;
  document.body.appendChild(g);
  const info = document.createElement('div');
  info.className = 'drag-info';
  document.body.appendChild(info);
  st.ghost = g; st.info = info;
  document.body.classList.add('arrastrando');
  st.el.classList.add('levantada');
  moverArrastre(st);
}
function moverArrastre(st) {
  st.ghost.style.transform = `translate(${st.x + 12}px, ${st.y - 18}px) rotate(-1.5deg)`;
  const destino = (document.elementFromPoint(st.x, st.y) || document.body).closest(`[data-drop="${st.tipo}"]`);
  const res = destino ? SOLTAR[st.tipo](st, destino) : null;
  if (destino !== st.destino) { quitarMarca(st); st.destino = destino; }
  st.res = res;
  if (destino) {
    destino.classList.toggle('drop', !!res);
    const h = destino.querySelector('.mx-hint'); if (h) h.textContent = res ? res.pista : '';
    // En la Semana se dibuja el hueco donde quedará la nota.
    let hueco = destino.querySelector(':scope > .cal-hueco');
    if (res && res.hueco) {
      if (!hueco) { hueco = document.createElement('div'); hueco.className = 'cal-hueco'; destino.appendChild(hueco); }
      hueco.style.top = res.hueco.top + 'px'; hueco.style.height = res.hueco.alto + 'px'; hueco.textContent = res.hueco.texto;
    } else if (hueco) hueco.remove();
  }
  st.info.textContent = res ? res.texto : destino ? 'Ya está aquí' : st.tipo === 'cal' ? 'Suelta en un día o en una hora' : 'Suelta sobre otro bloque';
}
function quitarMarca(st) {
  if (!st.destino) return;
  st.destino.classList.remove('drop');
  const h = st.destino.querySelector('.mx-hint'); if (h) h.textContent = '';
  const hu = st.destino.querySelector(':scope > .cal-hueco'); if (hu) hu.remove();
}
function finArrastre() {
  const st = ARR.st; if (!st) return;
  clearTimeout(st.timer);
  if (st.ghost) st.ghost.remove();
  if (st.info) st.info.remove();
  quitarMarca(st);
  st.el.classList.remove('levantada');
  document.body.classList.remove('arrastrando');
  ARR.st = null;
}
// En el móvil, la barra de Agrupar y Filtros se queda fija justo debajo de la barra superior.
function medirTopbar() {
  const tb = $('.topbar');
  if (tb) document.documentElement.style.setProperty('--topbar-h', tb.offsetHeight + 'px');
}
window.addEventListener('resize', medirTopbar);
function sideItem(it, cur) {
  return `<button class="side-item" data-act="vista" data-id="${esc(it.id)}" aria-current="${cur === it.id}"><span class="grow"><b>${esc(it.nombre)}</b>${it.regla ? `<small>${esc(it.regla)}</small>` : ''}</span><span class="n">${it.n}</span></button>`;
}
function resumenFiltro(f) {
  const g = S.ui.filtro; S.ui.filtro = { ...filtroVacio(), ...f };
  const r = chipsFiltro().join(' · ');
  S.ui.filtro = g;
  return r;
}
function vacio(total) {
  if (!total) return `<div class="empty"><h2>Todavía no hay notas</h2><p>Dicta lo que tengas pendiente o escribe tu primera nota.</p><div class="row"><a class="btn orange" href="#/dictado" data-act="dictar">${ICON.mic}Dictar</a><a class="btn primary" href="#/nota/nueva">${ICON.plus}Nueva nota</a></div></div>`;
  return `<div class="empty"><h2>No hay notas con estos filtros</h2><p>Prueba a quitar algún filtro o a cambiar la búsqueda.</p><button class="btn" data-act="limpiar-filtro">Quitar filtros</button></div>`;
}

// ---------- Páginas superpuestas ----------
const ruta = () => (location.hash || '#/').slice(2);
function cerrar() { if (history.length > 1 && S._dentro) history.back(); else location.hash = '#/'; }
function pagina(titulo, cuerpo, pie, opt = {}) {
  return `<div class="overlay" data-act="${opt.sheet ? 'fondo' : ''}"><div class="${opt.sheet ? 'sheet' : 'page'}" role="dialog" aria-modal="true" aria-label="${esc(titulo)}">
    ${opt.sheet ? '<div class="sheet-grip"></div>' : ''}
    <div class="page-head" ${opt.sheet ? 'style="border-bottom:0;background:none"' : ''}>
      <button class="icon-btn" data-act="cerrar" aria-label="Cerrar">${opt.volver ? ICON.back : ICON.close}</button>
      <h1>${esc(titulo)}</h1>${opt.accion || ''}
    </div>
    <div class="page-body">${cuerpo}</div>
    ${pie ? `<div class="page-foot">${pie}</div>` : ''}
  </div></div>`;
}

// Al repintar la misma página (por ejemplo al pulsar un botón del editor) se conserva el desplazamiento.
function renderOverlay() {
  const r = ruta(), prev = $('#ov .page-body');
  const sc = prev && S._ovRuta === r ? prev.scrollTop : 0;
  pintarOverlay();
  S._ovRuta = r;
  const nb = $('#ov .page-body');
  if (nb && sc) nb.scrollTop = sc;
  cargarFotos($('#ov'));
}
function pintarOverlay() {
  const ov = $('#ov');
  const r = ruta();
  document.body.style.overflow = r ? 'hidden' : '';
  document.body.classList.toggle('con-ov', !!r);
  if (!r) { ov.innerHTML = ''; return; }
  const [a, b] = r.split('/');
  if (a === 'nota') { if (!S.ed || S.ed.ruta !== r) iniciarEditor(b); ov.innerHTML = vistaEditor(); return; }
  if (a === 'filtros') { ov.innerHTML = vistaFiltros(); return; }
  if (a === 'menu') { ov.innerHTML = vistaMenu(); return; }
  if (a === 'dictado') { ov.innerHTML = vistaDictado(); return; }
  if (a === 'historial') { ov.innerHTML = vistaHistorial(); if (S.ui.histTab === 'archivos') cargarArchivos(); return; }
  if (a === 'ajustes') { ov.innerHTML = vistaAjustes(); cargarDispositivos(); return; }
  if (a === 'revision') { if (!S.rev) iniciarRevision(); ov.innerHTML = vistaRevision(); return; }
  if (a === 'resumen') { ov.innerHTML = vistaResumen(); return; }
  if (a === 'conflicto') { ov.innerHTML = vistaConflicto(); return; }
  ov.innerHTML = '';
}
function renderModal() {
  const m = $('#modal');
  if (!S.modal) { m.innerHTML = ''; return; }
  if (S.modal.tipo === 'etiqueta') m.innerHTML = modalEtiqueta();
  if (S.modal.tipo === 'persona') m.innerHTML = modalPersona();
  if (S.modal.tipo === 'grupo') m.innerHTML = modalGrupo();
  if (S.modal.tipo === 'foto') { m.innerHTML = modalFoto(); cargarFotos(m); }
}

// ---------- Editor de notas ----------
function iniciarEditor(id) {
  const n = id && id !== 'nueva' ? nota(id) : null;
  S.ed = {
    ruta: ruta(), id: n ? n.id : null,
    d: n ? { titulo: n.titulo, cuerpo: n.cuerpo || '', prioridad: n.prioridad, persona_id: n.persona_id || '', fecha_limite: n.fecha_limite || '', hora_limite: n.hora_limite || '',
        aviso_unidad: n.aviso_unidad || '', aviso_cant: n.aviso_cant || 1, duracion: n.duracion || DURACION_DEF, subir_critica: n.subir_critica !== 0, etiquetas: [...(n.etiquetas || [])], checklist: (n.checklist || []).map(p => ({ ...p })), repetir: n.repetir || '' }
      : { titulo: '', cuerpo: '', prioridad: 'normal', persona_id: '', fecha_limite: (S.prefill || {}).fecha_limite || '', hora_limite: (S.prefill || {}).hora_limite || '',
        aviso_unidad: '', aviso_cant: 1, duracion: DURACION_DEF, subir_critica: true, etiquetas: preEtiquetas(), checklist: [], repetir: '' },
    durOtra: !!(n && n.duracion && !DURACIONES.some(x => x[0] === n.duracion)),
    sug: null, sel: 0,
  };
  S.prefill = null;   // fecha y hora elegidas en el calendario: solo valen para esta nota nueva
}
// Nueva nota con la fecha (y la hora) donde se ha pulsado en el calendario.
function nuevaNotaEn(fecha, horaLimite) {
  S.prefill = { fecha_limite: fecha, hora_limite: horaLimite || '' };
  S.ed = null;
  location.hash = '#/nota/nueva';
}
// Una nota nueva hereda las etiquetas del grupo o filtro que estás viendo.
function preEtiquetas() { return S.ui.filtro.modo !== 'alguna' ? [...S.ui.filtro.etiquetas] : []; }

function vistaEditor() {
  const e = S.ed, d = e.d, n = e.id ? nota(e.id) : null;
  if (e.id && !n) return pagina('Nota', '<p>Esta nota ya no existe.</p>', '');
  const tags = d.etiquetas.map(id => etq(id)).filter(Boolean);
  const cuerpo = `
    <label class="field"><span>Título</span><input class="input" data-ed="titulo" value="${esc(d.titulo)}" maxlength="200" placeholder="Qué hay que hacer" autocomplete="off"></label>
    <div class="field body-wrap">
      <label for="ed-cuerpo" class="field-label">Nota <small>· escribe # para añadir una etiqueta</small></label>
      <textarea id="ed-cuerpo" class="input" data-ed="cuerpo" rows="4" placeholder="Detalles">${esc(d.cuerpo)}</textarea>
      <div id="sug"></div>
    </div>
    <div class="field"><span class="field-label">Etiquetas</span>
      <div class="tags-edit">${tags.map(t => `<span class="tag ${t.cerrada ? 'cerrada' : ''}">#${esc(t.nombre)}<button data-act="ed-quitar-tag" data-id="${esc(t.id)}" aria-label="Quitar #${esc(t.nombre)}">×</button></span>`).join('')}
      <button class="btn link small" data-act="ed-hash">+ Etiqueta</button></div>
    </div>
    <div class="field"><span class="field-label">Prioridad</span>
      <div class="prio-pick">${PRIOS.map(p => `<button class="p-${p}" data-act="ed-prio" data-v="${p}" aria-pressed="${d.prioridad === p}">${PRIO_N[p]}</button>`).join('')}</div>
    </div>
    <label class="field"><span>Asignar a <small>(opcional)</small></span>
      <select class="input" data-ed="persona_id"><option value="">Nadie</option>${S.personas.map(p => `<option value="${esc(p.id)}" ${d.persona_id === p.id ? 'selected' : ''}>${esc(p.nombre)}${p.cargo ? ' · ' + esc(p.cargo) : ''}</option>`).join('')}</select>
      ${S.personas.length ? '' : '<small>Añade personas en Ajustes para poder asignarles notas.</small>'}
    </label>
    <div class="grid2">
      <label class="field"><span>Fecha límite</span><input class="input" type="date" data-ed="fecha_limite" value="${esc(d.fecha_limite)}"></label>
      <div class="field"><span class="field-label">Hora <small>(opcional)</small></span>${selectorHora(d.hora_limite, 'ed')}</div>
    </div>
    ${bloqueAvisos(d)}
    <div class="field"><span class="field-label">Duración <small>(opcional · ocupa hueco en el calendario)</small></span>
      <div class="dur-pick">${DURACIONES.map(([m, t]) => `<button type="button" data-act="ed-dur" data-v="${m}" aria-pressed="${!e.durOtra && Number(d.duracion) === m}">${t}</button>`).join('')}
        <button type="button" data-act="ed-dur" data-v="otra" aria-pressed="${e.durOtra}">Otra…</button>
        ${e.durOtra ? `<input class="input" type="number" min="1" max="1440" step="5" inputmode="numeric" data-ed="duracion" value="${esc(d.duracion)}" aria-label="Duración en minutos"> <small>min</small>` : ''}</div>
      <small class="hint">Si no eliges nada, se reservan 10 minutos.</small>
    </div>
    <label class="check"><input type="checkbox" data-ed="subir_critica" ${d.subir_critica ? 'checked' : ''}>Subir a Urgente cuando falten 24 h para la fecha límite</label>
    <label class="field"><span>Repetir</span><select class="input" data-ed="repetir">${REPETIR_N.map(([v, t]) => `<option value="${v}" ${(d.repetir || '') === v ? 'selected' : ''}>${t}</option>`).join('')}</select>
      ${pistaRepetir(d)}</label>
    ${bloqueChecklist(d)}
    ${bloqueFotos(e)}
    ${n ? `<p class="hint">Creada el ${esc(fechaCorta(n.creada))}${n.origen === 'voz' ? ' por dictado' : ''}. Última modificación: ${esc(fechaCorta(n.actualizada))}.</p>` : ''}
    ${n && n.estado !== 'activa' ? `<div class="banner"><span class="grow">Esta nota está ${n.estado === 'realizada' ? 'realizada' : 'en la papelera'}.</span><button class="btn small" data-act="ed-reabrir">Volver a pendiente</button></div>` : ''}`;
  const pie = n && n.estado === 'activa'
    ? `<button class="btn danger" data-act="ed-borrar">Eliminar</button><button class="btn" data-act="ed-hecha">Realizada</button><button class="btn primary" data-act="ed-guardar">Guardar</button>`
    : `<button class="btn" data-act="cerrar">Cancelar</button><button class="btn primary" data-act="ed-guardar">Guardar</button>`;
  return pagina(e.id ? 'Editar nota' : 'Nueva nota', cuerpo, pie);
}

// Avisos del editor: se repintan solos al cambiar la fecha, la hora o la antelación.
function bloqueAvisos(d) {
  let dentro;
  if (!d.fecha_limite) dentro = '<p class="hint">Pon una fecha límite para recibir avisos.</p>';
  else {
    const u = d.aviso_unidad, cant = Number(d.aviso_cant) || 1;
    const prox = proximoAviso({ ...d, aviso_cant: cant });
    dentro = `<p class="hint">${d.hora_limite ? 'Te aviso a la hora límite. ¿Quieres otro aviso antes?' : 'Sin hora límite, los avisos suenan a las 8:00. ¿Cuánto antes?'}</p>
      <div class="aviso-pick">
        <div class="seg">${[['', 'Ninguno'], ['h', 'Horas'], ['d', 'Días'], ['s', 'Semanas']].map(([v, t]) => `<button type="button" data-act="ed-aviso" data-v="${v}" aria-pressed="${(u || '') === v}">${t}</button>`).join('')}</div>
        ${u ? `<select class="input" data-ed="aviso_cant" aria-label="Cuánto antes avisar">${Array.from({ length: AVISO_RANGO[u] }, (_, i) => i + 1).map(i => `<option value="${i}" ${cant === i ? 'selected' : ''}>${textoAntelacion(u, i)}</option>`).join('')}</select>` : ''}
      </div>
      <p class="hint">${prox ? '🔔 Próximo aviso: ' + esc(relDia(ymd(prox))) + ' a las ' + esc(hora(prox)) : d.hora_limite || u ? 'La hora de los avisos ya ha pasado.' : 'Sin avisos.'}</p>`;
  }
  return `<div class="field" id="ed-avisos"><span class="field-label">Avisos</span>${dentro}</div>`;
}
function pintarAvisos() { const b = $('#ed-avisos'); if (b && S.ed) b.outerHTML = bloqueAvisos(S.ed.d); }
// Duración en minutos tal como se guarda. En una nota antigua sin duración, los 10 min por defecto no se guardan.
function duracionGuardar(d, n) {
  const m = Math.round(Number(d.duracion));
  const v = m >= 1 && m <= 1440 ? m : DURACION_DEF;
  return n && !n.duracion && v === DURACION_DEF ? null : v;
}
// Fecha, hora y aviso tal como se guardan (sin fecha no hay hora ni aviso).
function camposFecha(d) {
  // Una nota que se repite necesita fecha: si no la tiene, cuenta desde hoy.
  const f = d.fecha_limite || (d.repetir ? hoyYmd() : null), u = f && AVISO_RANGO[d.aviso_unidad] ? d.aviso_unidad : null;
  return { repetir: d.repetir || null, fecha_limite: f, hora_limite: f && d.hora_limite ? d.hora_limite : null, aviso_unidad: u, aviso_cant: u ? Math.min(Number(d.aviso_cant) || 1, AVISO_RANGO[u]) : null };
}

// Hora con dos desplegables (hora y minutos de 5 en 5). A diferencia del campo de hora del navegador,
// no puede quedarse a medias («08:--»), que se guardaba como «sin hora» sin avisar.
// destino: 'ed' (editor) o el número de la propuesta del dictado.
function selectorHora(valor, destino) {
  const [h, m] = (valor || '').split(':');
  const mins = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));
  if (m && !mins.includes(m)) mins.push(m), mins.sort();   // horas antiguas con minutos sueltos (07:32)
  return `<span class="hora-pick" data-hora="${destino}">
    <select class="input" data-hora-parte="h" aria-label="Hora"><option value="">—</option>${Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')).map(x => `<option value="${x}" ${x === h ? 'selected' : ''}>${x}</option>`).join('')}</select>
    <b>:</b>
    <select class="input" data-hora-parte="m" aria-label="Minutos" ${h ? '' : 'disabled'}>${mins.map(x => `<option value="${x}" ${x === (m || '00') ? 'selected' : ''}>${x}</option>`).join('')}</select></span>`;
}
function leerSelectorHora(t) {
  const c = t.closest('.hora-pick'), h = c.querySelector('[data-hora-parte="h"]').value, ms = c.querySelector('[data-hora-parte="m"]');
  ms.disabled = !h;
  return { destino: c.dataset.hora, valor: h ? h + ':' + (ms.value || '00') : '' };
}
// Explica qué pasará al realizar una nota que se repite.
function pistaRepetir(d) {
  if (!d.repetir) return '<small class="hint" id="ed-repetir"></small>';
  const sig = fechaSiguiente(d.fecha_limite || hoyYmd(), d.repetir);
  return `<small class="hint" id="ed-repetir">↻ Al marcarla como realizada se creará la siguiente${d.fecha_limite ? '' : ' (sin fecha límite, cuenta desde hoy)'}: ${esc(diaLargo(sig))}.</small>`;
}
// Checklist del editor: los puntos se escriben sin repintar; añadir o quitar repinta solo este bloque.
const checklistGuardar = d => (d.checklist || []).map(p => ({ t: p.t.trim(), hecho: !!p.hecho })).filter(p => p.t);
function bloqueChecklist(d) {
  const l = d.checklist || [];
  return `<div class="field" id="ed-check"><span class="field-label">Checklist${l.length ? ` <small>${l.filter(p => p.hecho).length}/${l.length}</small>` : ''}</span>
    <div class="chk-lista">${l.map((p, i) => `<div class="chk-item ${p.hecho ? 'hecho' : ''}">
        <input type="checkbox" data-chk="${i}" ${p.hecho ? 'checked' : ''} aria-label="Hecho">
        <input class="chk-t" data-chk-t="${i}" value="${esc(p.t)}" maxlength="200" placeholder="Punto ${i + 1}" autocomplete="off">
        <button type="button" class="icon-btn" data-act="chk-quitar" data-v="${i}" aria-label="Quitar punto">${ICON.close}</button></div>`).join('')}
      <button type="button" class="chk-anadir" data-act="chk-anadir">+ Añadir punto</button></div></div>`;
}
function pintarChecklist(foco) {
  const b = $('#ed-check'); if (!b || !S.ed) return;
  b.outerHTML = bloqueChecklist(S.ed.d);
  if (foco != null) { const i = $(`[data-chk-t="${foco}"]`); if (i) i.focus(); }
}

function guardarCambiosSilencio() {
  const e = S.ed, d = e.d, n = nota(e.id); if (!n || !d.titulo.trim()) return;
  const campos = { titulo: d.titulo.trim(), cuerpo: d.cuerpo.replace(/[ \t]{2,}/g, ' ').trim(), prioridad: d.prioridad, persona_id: d.persona_id || null, ...camposFecha(d), duracion: duracionGuardar(d, n), subir_critica: d.subir_critica ? 1 : 0 };
  const cambios = {};
  for (const k of Object.keys(campos)) if ((n[k] == null ? null : n[k]) !== campos[k] && !(k === 'cuerpo' && (n[k] || '') === campos[k])) cambios[k] = campos[k];
  if (JSON.stringify([...(n.etiquetas || [])].sort()) !== JSON.stringify([...d.etiquetas].sort())) cambios.etiquetas = d.etiquetas;
  const chk = checklistGuardar(d);
  if (JSON.stringify(n.checklist || []) !== JSON.stringify(chk)) cambios.checklist = chk;
  if (Object.keys(cambios).length) editarNotaLocal(e.id, cambios);
}
function guardarEditor() {
  const e = S.ed, d = e.d;
  const titulo = d.titulo.trim();
  if (!titulo) { toast('Escribe un título para la nota.'); $('[data-ed="titulo"]') && $('[data-ed="titulo"]').focus(); return; }
  const campos = {
    titulo, cuerpo: d.cuerpo.replace(/[ \t]{2,}/g, ' ').trim(), prioridad: d.prioridad, persona_id: d.persona_id || null,
    ...camposFecha(d), duracion: duracionGuardar(d, e.id ? nota(e.id) : null), subir_critica: d.subir_critica ? 1 : 0, etiquetas: d.etiquetas,
    checklist: checklistGuardar(d),
  };
  if (e.id) {
    const n = nota(e.id), cambios = {};
    for (const k of Object.keys(campos)) {
      const antes = k === 'etiquetas' ? JSON.stringify([...(n.etiquetas || [])].sort()) : k === 'checklist' ? JSON.stringify(n.checklist || []) : n[k] == null ? null : n[k];
      const ahora = k === 'etiquetas' ? JSON.stringify([...campos[k]].sort()) : k === 'checklist' ? JSON.stringify(campos[k]) : campos[k];
      if (antes !== ahora && !(k === 'cuerpo' && (antes || '') === ahora)) cambios[k] = campos[k];
    }
    if (Object.keys(cambios).length) editarNotaLocal(e.id, cambios);
    toast('Nota guardada');
  } else {
    crearNotaLocal({ ...campos, origen: 'manual' });
    toast('Nota creada');
  }
  S.ed = null;
  renderBase();
  cerrar();
}

// Autocompletado de etiquetas al escribir #
function tokenHash(ta) {
  const antes = ta.value.slice(0, ta.selectionStart);
  const m = antes.match(/(^|\s)#([\p{L}\p{N}_-]*)$/u);
  return m ? { q: m[2], ini: ta.selectionStart - m[2].length - 1, fin: ta.selectionStart } : null;
}
function sugerencias(q) {
  const nq = norm(q);
  const usadas = new Set(S.ed.d.etiquetas);
  const cands = S.etiquetas.filter(e => !usadas.has(e.id) && !e.cerrada);
  const empiezan = cands.filter(e => norm(e.nombre).startsWith(nq) || norm(e.alias || '').split(/\s*,\s*/).some(a => a && a.startsWith(nq)));
  const contienen = nq ? cands.filter(e => !empiezan.includes(e) && norm(e.nombre).includes(nq)) : [];
  const lista = [...empiezan, ...contienen].slice(0, 6).map(e => ({ tipo: 'e', e, n: S.notas.filter(n => (n.etiquetas || []).includes(e.id)).length }));
  if (q && TAG_RE.test(q) && !S.etiquetas.some(e => norm(e.nombre) === nq)) lista.push({ tipo: 'nueva', nombre: q });
  return lista;
}
function pintarSug() {
  const box = $('#sug'); if (!box) return;
  const s = S.ed && S.ed.sug;
  if (!s || !s.lista.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="suggest" role="listbox">${s.lista.map((x, i) => x.tipo === 'e'
    ? `<button role="option" data-act="sug" data-i="${i}" aria-selected="${i === S.ed.sel}"><span>#${esc(x.e.nombre)}</span><small>${x.n === 1 ? '1 nota' : x.n + ' notas'}</small></button>`
    : `<button role="option" class="new" data-act="sug" data-i="${i}" aria-selected="${i === S.ed.sel}"><span>+ Crear etiqueta nueva «${esc(x.nombre)}»</span></button>`).join('')}</div>`;
}
function elegirSug(i) {
  const s = S.ed.sug, x = s && s.lista[i]; if (!x) return;
  const ta = $('#ed-cuerpo');
  const e = x.tipo === 'e' ? x.e : crearEtiquetaLocal(x.nombre);
  if (!S.ed.d.etiquetas.includes(e.id)) S.ed.d.etiquetas.push(e.id);
  // El texto #etiqueta se quita del cuerpo: la etiqueta queda guardada aparte como chip.
  const v = ta.value;
  let nuevo = v.slice(0, s.ini) + v.slice(s.fin);
  nuevo = nuevo.replace(/[ \t]{2,}/g, ' ');
  S.ed.d.cuerpo = nuevo;
  S.ed.sug = null;
  renderOverlay();
  const t2 = $('#ed-cuerpo'); if (t2) { t2.focus(); const pos = Math.min(s.ini, t2.value.length); t2.setSelectionRange(pos, pos); }
}

// ---------- Filtros ----------
function vistaFiltros() {
  const f = S.ui.filtro;
  const porTipo = TIPOS.map(([t, nombre]) => {
    const es = S.etiquetas.filter(e => e.tipo === t && (!e.cerrada || f.etiquetas.includes(e.id)));
    return es.length ? `<div class="hint">${nombre}</div><div class="tags-edit">${es.map(e => chip('f-tag', e.id, f.etiquetas.includes(e.id), '#' + esc(e.nombre))).join('')}</div>` : '';
  }).join('');
  const n = activas().filter(x => cumpleFiltro(x, f) && cumpleBusqueda(x, S.ui.q)).length;
  const cuerpo = `
    <section class="field"><div class="row"><span class="field-label grow">Etiquetas</span>
      <div class="seg"><button data-act="f-modo" data-v="todas" aria-pressed="${f.modo !== 'alguna'}">Todas</button><button data-act="f-modo" data-v="alguna" aria-pressed="${f.modo === 'alguna'}">Alguna</button></div></div>
      ${porTipo || '<p class="hint">Todavía no hay etiquetas. Se crean escribiendo # en una nota.</p>'}
    </section>
    <section class="field"><span class="field-label">Prioridad</span><div class="tags-edit">${PRIOS.map(p => chip('f-prio', p, f.prioridades.includes(p), PRIO_N[p])).join('')}</div></section>
    <section class="field"><span class="field-label">Asignada a</span><div class="tags-edit">${S.personas.map(p => chip('f-per', p.id, f.personas.includes(p.id), esc(p.nombre))).join('')}${chip('f-per', 'ninguna', f.personas.includes('ninguna'), 'Sin asignar')}</div></section>
    <section class="field"><span class="field-label">Otros</span>
      <label class="check"><input type="checkbox" data-act="f-bool" data-v="conAlarma" ${f.conAlarma ? 'checked' : ''}>Con avisos</label>
      <label class="check"><input type="checkbox" data-act="f-bool" data-v="venceSemana" ${f.venceSemana ? 'checked' : ''}>Vencen esta semana (incluye atrasadas)</label>
      <label class="check"><input type="checkbox" data-act="f-bool" data-v="estancadas" ${f.estancadas ? 'checked' : ''}>Sin tocar desde hace más de ${ESTANCADA_DIAS} días</label>
    </section>`;
  const pie = `<button class="btn" data-act="limpiar-filtro">Limpiar</button>
    ${S.ui.vista && vistaModificada() ? '<button class="btn" data-act="actualizar-grupo">Actualizar grupo</button>' : `<button class="btn" data-act="guardar-grupo" ${filtroActivo(f) ? '' : 'disabled'}>Guardar como grupo</button>`}
    <button class="btn" data-act="pdf-reunion" ${n ? '' : 'disabled'}>PDF para reunión</button>
    <button class="btn primary" data-act="cerrar">Ver ${n} ${n === 1 ? 'nota' : 'notas'}</button>`;
  return pagina('Filtrar notas', cuerpo, pie, { sheet: true });
}

// ---------- Resumen del día (al que lleva el aviso de cada mañana) ----------
const RESUMEN_DEF = { activo: '1', hora: '07:00', dias: '1,2,3,4,5' };   // igual que en el worker
const resumenCfg = k => S.srv['resumen_' + k] == null || S.srv['resumen_' + k] === '' ? RESUMEN_DEF[k] : S.srv['resumen_' + k];
// Los ajustes del resumen se comparten entre dispositivos (config del worker).
function guardarResumen(k, v) {
  S.srv['resumen_' + k] = v;
  encolar({ kind: 'config', method: 'PUT', path: '/config', body: { ['resumen_' + k]: v } });
  guardarLocal();
  if (ruta() === 'ajustes') renderOverlay();
  const dias = resumenCfg('dias').split(',').filter(Boolean).map(d => DIAS_LARGOS[d - 1].slice(0, 3).toLowerCase());
  toast(resumenCfg('activo') === '0' ? 'Resumen matutino desactivado' : `Resumen matutino a las ${resumenCfg('hora')} · ${dias.join(', ') || 'ningún día'}`);
}
function vistaResumen() {
  const hoy = hoyYmd(), act = activas();
  const obra = n => (n.etiquetas || []).map(etq).filter(Boolean).map(e => e.nombre)[0] || '';
  const conHora = act.filter(n => n.fecha_limite === hoy && n.hora_limite).sort(ordenFecha);
  const urgentes = act.filter(n => n.prioridad === 'critica').sort(ordenFecha);
  const plazos = act.filter(n => n.fecha_limite === hoy && !n.hora_limite && n.prioridad !== 'critica');
  const quietas = act.filter(estancada).sort((a, b) => String(a.actualizada || a.creada).localeCompare(String(b.actualizada || b.creada)));
  const dias = n => Math.floor((Date.now() - Date.parse(n.actualizada || n.creada)) / DIA);
  const fila = (n, izq, clase, sub) => `<button class="res-fila" data-act="abrir" data-id="${esc(n.id)}"><span class="res-izq ${clase}">${esc(izq)}</span>
    <span class="res-txt"><b>${esc(n.titulo)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span></button>`;
  const seccion = (titulo, lista, f) => lista.length ? `<section class="res-sec"><h2>${titulo}</h2><div class="res-lista">${lista.map(f).join('')}</div></section>` : '';
  const ahora = new Date();
  const cuerpo = `<div class="res-cab"><div class="hint">${esc(mayus(ahora.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })))} · ${esc(hora(ahora))}</div><h2>Buenos días</h2></div>
    <div class="res-cont">
      <div class="res-n urg"><b>${urgentes.length}</b><span>${urgentes.length === 1 ? 'Urgente' : 'Urgentes'}</span></div>
      <div class="res-n"><b>${conHora.length}</b><span>Con hora hoy</span></div>
      <div class="res-n"><b>${quietas.length}</b><span>Sin tocar</span></div>
    </div>
    ${seccion('Hoy con hora', conHora, n => fila(n, n.hora_limite, 'azul', obra(n) && '#' + obra(n)))}
    ${seccion('Urgentes', urgentes, n => fila(n, !n.fecha_limite ? '—' : n.fecha_limite === hoy ? 'Hoy' : n.fecha_limite < hoy ? 'Venció' : mayus(diaCorto(n.fecha_limite).split(',')[0]), 'rojo', [obra(n) && '#' + obra(n), (per(n.persona_id) || {}).nombre].filter(Boolean).join(' · ')))}
    ${seccion('Plazos de hoy', plazos, n => fila(n, '⚑', 'azul', [PRIO_N[n.prioridad], obra(n) && '#' + obra(n)].filter(Boolean).join(' · ')))}
    ${seccion('Sin tocar desde hace días', quietas, n => fila(n, dias(n) + ' d', 'gris', obra(n) && '#' + obra(n)))}
    ${!conHora.length && !urgentes.length && !plazos.length && !quietas.length ? '<div class="empty"><h2>Todo en orden</h2><p>Hoy no hay nada urgente ni pendiente con hora.</p></div>' : ''}`;
  return pagina('Resumen del día', cuerpo, `<button class="btn primary" data-act="ir-panel">Ir al panel</button>`);
}

function vistaMenu() {
  const cuerpo = `<div class="list-plain">
    <div><a class="btn link" href="#/resumen" data-reemplazar>Resumen del día</a></div>
    <div><a class="btn link" href="#/revision" data-reemplazar>Revisión semanal</a></div>
    <div><a class="btn link" href="#/historial" data-reemplazar>Historial y papelera</a></div>
    <div><a class="btn link" href="#/ajustes" data-reemplazar>Ajustes</a></div>
    <div><button class="btn link" data-act="pdf-reunion">PDF para reunión</button></div>
    <div><button class="btn link" data-act="imprimir-lista">PDF de la lista actual</button></div>
  </div><p class="hint">${esc(textoSync() || 'Sin cambios pendientes')} · versión ${VERSION}</p>`;
  return pagina('Menú', cuerpo, '', { sheet: true });
}

// ---------- Impresión / PDF ----------
function imprimir(titulo, notas) {
  const filas = notas.map(n => `<tr><td>${PRIO_N[n.prioridad]}</td><td><b>${esc(n.titulo)}</b>${n.cuerpo ? '<br>' + esc(n.cuerpo).replace(/\n/g, '<br>') : ''}${(n.checklist || []).map(p => '<br>' + (p.hecho ? '☑ ' : '☐ ') + esc(p.t)).join('')}</td>
    <td>${(n.etiquetas || []).map(id => '#' + esc((etq(id) || {}).nombre || '')).join(' ')}</td><td>${esc((per(n.persona_id) || {}).nombre || '')}</td>
    <td>${n.estado === 'realizada' ? 'Realizada ' + esc(fechaCorta(n.realizada_en)) : n.estado === 'papelera' ? 'Eliminada' : 'Pendiente'}${n.fecha_limite ? '<br>Límite ' + esc(diaCorto(n.fecha_limite) + (n.hora_limite ? ' ' + n.hora_limite : '')) : ''}${textoAviso(n) ? '<br>Aviso ' + esc(textoAviso(n)) : ''}${n.repetir ? '<br>↻ ' + esc(textoRepetir(n.repetir)) : ''}</td></tr>`).join('');
  $('#print').innerHTML = `<h1>${esc(titulo)}</h1><p>${notas.length} notas · ${esc(new Date().toLocaleString('es-ES'))}</p>
    <table><thead><tr><th>Prioridad</th><th>Nota</th><th>Etiquetas</th><th>Asignada a</th><th>Estado y fechas</th></tr></thead><tbody>${filas}</tbody></table>`;
  setTimeout(() => window.print(), 50);
}
// PDF para reunión: las notas que se están viendo, agrupadas por obra, con huecos para escribir a mano.
function imprimirReunion(titulo, notas) {
  const hoy = hoyYmd();
  const obraDe = n => (n.etiquetas || []).map(etq).find(e => e && e.tipo === 'obra');
  const grupos = new Map();
  for (const n of notas) { const o = obraDe(n), k = o ? o.nombre : ''; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(n); }
  const claves = [...grupos.keys()].sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || a.localeCompare(b));
  const vencidas = notas.filter(n => n.fecha_limite && (n.fecha_limite < hoy || (n.fecha_limite === hoy && n.hora_limite && n.hora_limite < hora(Date.now())))).length;
  const urgentes = notas.filter(n => n.prioridad === 'critica').length;
  const fila = n => {
    const otras = (n.etiquetas || []).map(etq).filter(e => e && e !== obraDe(n)).map(e => '#' + esc(e.nombre)).join(' ');
    const late = n.fecha_limite && n.fecha_limite < hoy;
    return `<tr class="pr-${n.prioridad}">
      <td class="pr-prio">${PRIO_N[n.prioridad]}</td>
      <td><b>${esc(n.titulo)}</b>${n.repetir ? ' <span class="pr-gris">↻ ' + esc(textoRepetir(n.repetir)) + '</span>' : ''}
        ${n.cuerpo ? `<div>${esc(n.cuerpo).replace(/\n/g, '<br>')}</div>` : ''}
        ${(n.checklist || []).length ? `<div class="pr-chk">${n.checklist.map(p => (p.hecho ? '☑ ' : '☐ ') + esc(p.t)).join('<br>')}</div>` : ''}
        ${otras || (n.fotos || []).length ? `<div class="pr-gris">${otras}${(n.fotos || []).length ? ` 📷 ${n.fotos.length}` : ''}</div>` : ''}</td>
      <td>${esc((per(n.persona_id) || {}).nombre || '')}</td>
      <td>${n.fecha_limite ? `<span class="${late ? 'pr-late' : ''}">${late ? 'Venció ' : ''}${esc(diaCorto(n.fecha_limite).replace(',', ''))}${n.hora_limite ? ' ' + n.hora_limite : ''}</span>` : '—'}</td>
      <td></td></tr>`;
  };
  $('#print').innerHTML = `<div class="pr">
    <div class="pr-cab"><div><h1>Reunión · ${esc(titulo)}</h1><div class="pr-gris">${esc(mayus(new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })))}</div></div>
      <div class="pr-res">${notas.length} ${notas.length === 1 ? 'nota' : 'notas'}${urgentes ? ' · ' + urgentes + (urgentes === 1 ? ' urgente' : ' urgentes') : ''}${vencidas ? ' · ' + vencidas + (vencidas === 1 ? ' vencida' : ' vencidas') : ''}</div></div>
    <div class="pr-datos"><div><span>Asistentes</span></div><div><span>Lugar</span></div><div><span>Próxima reunión</span></div></div>
    ${claves.map(k => `<h2>${k ? '#' + esc(k) : 'Sin obra'} <small>${grupos.get(k).length}</small></h2>
      <table><thead><tr><th style="width:9%">Prioridad</th><th style="width:38%">Nota</th><th style="width:12%">Responsable</th><th style="width:11%">Fecha límite</th><th>Acuerdos</th></tr></thead>
      <tbody>${grupos.get(k).sort((a, b) => rankPrio(a.prioridad) - rankPrio(b.prioridad) || ordenFecha(a, b)).map(fila).join('')}</tbody></table>`).join('')}
    <div class="pr-otros"><span>Otros temas</span></div>
    <div class="pr-pie">Notas de obra · generado el ${esc(new Date().toLocaleString('es-ES', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }))}</div>
  </div>`;
  setTimeout(() => window.print(), 50);
}
function imprimirHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  $('#print').innerHTML = doc.body.innerHTML;
  setTimeout(() => window.print(), 50);
}

// ---------- Dictado ----------
function dic() { if (!S.dic) S.dic = { fase: 'listo', propuestas: [], msg: '', segs: 0 }; return S.dic; }
const fmtT = s => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');

function vistaDictado() {
  const D = dic();
  const pendientes = S.audios.filter(a => a.estado !== 'guardado');
  let cuerpo = '', pie = '';
  if (D.fase === 'revision') return vistaRevisionDictado();
  if (D.fase === 'grabando' || D.fase === 'pausa') {
    cuerpo = `<div class="card rec">
      <div class="time" id="rec-time">${fmtT(D.segs)}</div>
      <div class="state ${D.fase === 'grabando' ? 'on' : ''}">${D.fase === 'grabando' ? 'Grabando…' : 'En pausa'}</div>
      <div class="meter" id="meter">${'<span></span>'.repeat(32)}</div>
      <button class="rec-btn" data-act="rec-pausa" aria-label="${D.fase === 'grabando' ? 'Pausar' : 'Continuar'}">${D.fase === 'grabando' ? '<span class="stop" style="width:10px;margin-right:8px"></span><span class="stop" style="width:10px"></span>' : ICON.mic}</button>
    </div>
    <p class="hint">Habla con naturalidad. Si mencionas varios asuntos, se separarán en notas distintas con su prioridad, etiquetas, persona, fecha, hora y avisos.</p>`;
    pie = `<button class="btn" data-act="rec-cancelar">Descartar</button><button class="btn primary" data-act="rec-parar">Terminar y analizar</button>`;
  } else if (D.fase === 'procesando') {
    cuerpo = `<div class="card rec"><div class="spinner" role="status" aria-label="Procesando"></div><div class="state">${esc(D.msg)}</div></div>
      <p class="hint">El audio ya está guardado en este dispositivo. Si se corta la conexión, podrás reintentarlo.</p>`;
  } else {
    cuerpo = `${D.fase === 'error' ? `<div class="banner bad"><span class="grow"><b>No se ha podido analizar.</b> ${esc(D.msg)}</span></div>` : ''}
      <div class="card rec">
        <div class="time">00:00</div>
        <div class="state">${D.propuestas.length ? 'Graba otro audio para añadir más notas' : 'Pulsa para empezar a dictar'}</div>
        <button class="rec-btn" data-act="rec-empezar" aria-label="Empezar a grabar">${ICON.mic}</button>
      </div>
      ${D.propuestas.length ? `<button class="btn" data-act="dic-volver-revision">Volver a las ${D.propuestas.length} notas propuestas</button>` : ''}
      ${pendientes.length ? `<section class="card"><h2>Audios guardados</h2><p class="hint">Se conservan ${AUDIO_DIAS} días en este dispositivo por si hay que volver a analizarlos.</p>
        <div class="list-plain">${pendientes.map(a => `<div><span class="grow"><b>${esc(fechaCorta(a.fecha))} ${esc(hora(a.fecha))} · ${fmtT(a.segs || 0)}</b>
          <small>${a.estado === 'error' ? 'Error: ' + esc(a.error || '') : a.estado === 'pendiente' ? 'Sin analizar' : a.estado === 'transcrito' ? 'Transcrito, falta analizar' : 'Analizado'}</small></span>
          <button class="btn small ${a.estado === 'analizado' ? '' : 'primary'}" data-act="audio-procesar" data-id="${esc(a.id)}">${a.estado === 'analizado' ? 'Volver a analizar' : 'Analizar'}</button>
          <button class="icon-btn" data-act="audio-borrar" data-id="${esc(a.id)}" aria-label="Borrar audio">${ICON.close}</button></div>`).join('')}</div></section>` : ''}`;
  }
  return pagina('Dictar notas', cuerpo, pie);
}

async function empezarGrabacion() {
  const D = dic();
  if (!navigator.mediaDevices || !window.MediaRecorder) { toast('Este navegador no permite grabar audio.'); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch { toast('Sin permiso para usar el micrófono. Actívalo en los ajustes del navegador.'); return; }
  const tipo = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find(t => MediaRecorder.isTypeSupported(t)) || '';
  const rec = new MediaRecorder(stream, tipo ? { mimeType: tipo, audioBitsPerSecond: 32000 } : undefined);
  D.chunks = []; D.rec = rec; D.stream = stream; D.segs = 0; D.fase = 'grabando'; D.tipo = rec.mimeType || tipo || 'audio/webm';
  rec.ondataavailable = ev => { if (ev.data && ev.data.size) D.chunks.push(ev.data); };
  rec.start(1000);
  D.timer = setInterval(() => {
    if (D.fase !== 'grabando') return;
    D.segs++;
    const el = $('#rec-time'); if (el) el.textContent = fmtT(D.segs);
    if (D.segs >= 600) pararGrabacion(true);
  }, 1000);
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const an = ctx.createAnalyser(); an.fftSize = 64;
    ctx.createMediaStreamSource(stream).connect(an);
    D.actx = ctx;
    const buf = new Uint8Array(an.frequencyBinCount);
    const pinta = () => {
      if (!D.rec || D.rec.state === 'inactive') return;
      an.getByteFrequencyData(buf);
      const bars = $$('#meter span');
      bars.forEach((b, i) => { b.style.height = Math.max(3, (buf[i % buf.length] / 255) * 44) + 'px'; });
      requestAnimationFrame(pinta);
    };
    pinta();
  } catch { /* sin medidor */ }
  renderOverlay();
}
function soltarMicro(D) {
  clearInterval(D.timer);
  if (D.stream) D.stream.getTracks().forEach(t => t.stop());
  if (D.actx) D.actx.close().catch(() => {});
  D.stream = null; D.actx = null;
}
async function pararGrabacion(auto) {
  const D = dic();
  if (!D.rec) return;
  const rec = D.rec;
  await new Promise(res => { rec.onstop = res; rec.stop(); });
  soltarMicro(D);
  D.rec = null;
  const blob = new Blob(D.chunks, { type: D.tipo });
  D.chunks = [];
  if (blob.size < 2000) { D.fase = 'listo'; toast('La grabación está vacía.'); renderOverlay(); return; }
  const a = { id: uid(), fecha: new Date().toISOString(), segs: D.segs, tipo: D.tipo, estado: 'pendiente' };
  await idb.set('audio:' + a.id, blob);
  S.audios.unshift(a); await guardarAudios();
  if (auto) toast('Se ha llegado al máximo de 10 minutos. Graba otro audio para continuar.');
  procesarAudio(a.id);
}
function cancelarGrabacion() {
  const D = dic();
  if (D.rec) { D.rec.onstop = null; try { D.rec.stop(); } catch {} }
  soltarMicro(D); D.rec = null; D.chunks = []; D.fase = 'listo';
  renderOverlay();
}

async function procesarAudio(id) {
  const D = dic();
  const a = S.audios.find(x => x.id === id); if (!a) return;
  if (!navigator.onLine) {
    a.estado = a.texto ? 'transcrito' : 'pendiente'; await guardarAudios();
    D.fase = 'listo'; renderOverlay(); renderBase();
    toast('Sin conexión. El audio queda guardado y podrás analizarlo cuando vuelva la cobertura.');
    return;
  }
  D.fase = 'procesando';
  try {
    if (!a.texto) {
      D.msg = 'Transcribiendo el audio…'; renderOverlay();
      const blob = await idb.get('audio:' + id);
      if (!blob) throw new Error('El audio ya no está en este dispositivo.');
      const r = await api('/transcribir', { method: 'POST', body: blob, raw: true, headers: { 'Content-Type': a.tipo || blob.type || 'audio/webm' } });
      a.texto = r.texto; a.estado = 'transcrito'; await guardarAudios();
      if (!a.texto) throw new Error('No se ha entendido nada en el audio. Prueba a grabarlo otra vez más cerca del micrófono.');
    }
    D.msg = 'Preparando las notas con Claude…'; renderOverlay();
    const r = await api('/analizar', { method: 'POST', body: { texto: a.texto, ahora_local: ahoraLocal() } });
    a.estado = 'analizado'; a.error = ''; await guardarAudios();
    for (const n of r.notas) D.propuestas.push(propuestaDe(n, a));
    D.fase = 'revision';
  } catch (e) {
    a.estado = a.texto ? 'transcrito' : 'error'; a.error = e.message; await guardarAudios();
    D.fase = 'error'; D.msg = e.message + (e.red ? ' El audio queda guardado para reintentarlo.' : '');
  }
  renderOverlay(); renderBase();
}
function propuestaDe(n, a) {
  return {
    k: uid(), incluir: true, audio: a.id, transcripcion: a.texto,
    titulo: n.titulo, cuerpo: n.cuerpo, prioridad: n.prioridad,
    etiquetas: n.etiquetas.map(nombre => (S.etiquetas.find(e => norm(e.nombre) === norm(nombre)) || {}).id).filter(Boolean),
    evidencias: n.evidencias || [],
    nuevas: (n.etiquetas_nuevas || []).map(x => ({ ...x, decision: '' })),
    persona_id: (S.personas.find(p => norm(p.nombre) === norm(n.persona)) || {}).id || '',
    fecha_limite: n.fecha_limite || '', hora_limite: n.hora_limite || '', aviso_unidad: n.aviso_unidad || '', aviso_cant: n.aviso_cant || 0,
    duracion: n.duracion || DURACION_DEF, durDefecto: !n.duracion,
    checklist: (n.checklist || []).map(t => ({ t, hecho: false })), repetir: n.repetir || '',
  };
}

function vistaRevisionDictado() {
  const D = dic();
  const incl = D.propuestas.filter(p => p.incluir).length;
  const textos = [...new Set(D.propuestas.map(p => p.transcripcion))].filter(Boolean);
  const cuerpo = `<div class="banner"><span class="grow"><b>${D.propuestas.length === 1 ? 'Claude ha preparado 1 nota' : 'Claude ha preparado ' + D.propuestas.length + ' notas'}.</b> Revisa y corrige antes de guardar.</span></div>
    <details class="card"><summary style="font-weight:600;color:var(--primary);cursor:pointer">Ver lo que se ha transcrito</summary><p style="white-space:pre-wrap;margin:0">${esc(textos.join('\n\n'))}</p></details>
    ${D.propuestas.map((p, i) => tarjetaPropuesta(p, i)).join('')}
    <p class="hint">Las etiquetas en naranja no existen todavía. Solo se crean si pulsas Crear.</p>`;
  const pie = `<button class="btn" data-act="dic-descartar">Descartar</button><button class="btn" data-act="dic-mas">Grabar más</button>
    <button class="btn primary" data-act="dic-guardar" ${incl ? '' : 'disabled'}>Guardar ${incl} ${incl === 1 ? 'nota' : 'notas'}</button>`;
  return pagina('Revisar dictado', cuerpo, pie);
}
function tarjetaPropuesta(p, i) {
  const tags = p.etiquetas.map(etq).filter(Boolean);
  return `<article class="card propuesta p-${p.prioridad} ${p.incluir ? '' : 'off'}">
    <div class="top"><span class="grow">Nota ${i + 1}</span>
      <select data-p="${i}" data-f="prioridad" aria-label="Prioridad">${PRIOS.map(x => `<option value="${x}" ${p.prioridad === x ? 'selected' : ''}>${PRIO_N[x]}</option>`).join('')}</select>
      <label class="check" style="min-height:36px"><input type="checkbox" data-p="${i}" data-f="incluir" ${p.incluir ? 'checked' : ''}>Incluir</label></div>
    <input class="input" data-p="${i}" data-f="titulo" value="${esc(p.titulo)}" aria-label="Título">
    <textarea class="input" rows="2" data-p="${i}" data-f="cuerpo" aria-label="Nota" style="min-height:64px">${esc(p.cuerpo)}</textarea>
    <div class="tags-edit">${tags.map(t => `<span class="tag">#${esc(t.nombre)}<button data-act="p-quitar-tag" data-p="${i}" data-id="${esc(t.id)}" aria-label="Quitar">×</button></span>`).join('')}
      ${p.nuevas.filter(n => n.decision === 'crear').map(n => `<span class="tag nueva">+ #${esc(n.nombre)}</span>`).join('')}
      <select class="input" data-p="${i}" data-f="add-tag" style="width:auto;min-height:34px;padding:0 6px" aria-label="Añadir etiqueta"><option value="">+ Etiqueta</option>${S.etiquetas.filter(e => !e.cerrada && !p.etiquetas.includes(e.id)).map(e => `<option value="${esc(e.id)}">#${esc(e.nombre)}</option>`).join('')}</select></div>
    ${p.evidencias.length ? `<div class="hint">${p.evidencias.map(e => `Oído «${esc(e.oido)}» → #${esc(e.etiqueta)}`).join(' · ')}</div>` : ''}
    ${p.nuevas.filter(n => !n.decision).map((n, j) => `<div class="nueva-box"><div><b>#${esc(n.nombre)}</b> no existe${n.oido ? ` (oído «${esc(n.oido)}»)` : ''}.${n.similar ? ` La más parecida que ya tienes es #${esc(n.similar)}.` : ''}</div>
      <div class="acts"><button class="btn small orange" data-act="p-nueva" data-p="${i}" data-n="${esc(n.nombre)}" data-v="crear">Crear #${esc(n.nombre)}</button>
      ${n.similar ? `<button class="btn small" data-act="p-nueva" data-p="${i}" data-n="${esc(n.nombre)}" data-v="usar">Usar #${esc(n.similar)}</button>` : ''}
      <button class="btn small link" data-act="p-nueva" data-p="${i}" data-n="${esc(n.nombre)}" data-v="descartar">Descartar</button></div></div>`).join('')}
    <div class="grid2">
      <label class="field"><small>Fecha límite</small><input class="input" type="date" data-p="${i}" data-f="fecha_limite" value="${esc(p.fecha_limite)}"></label>
      <div class="field"><small>Hora</small>${selectorHora(p.hora_limite, String(i))}</div>
    </div>
    <div class="grid2">
      <label class="field"><small>Asignar a</small><select class="input" data-p="${i}" data-f="persona_id"><option value="">Nadie</option>${S.personas.map(x => `<option value="${esc(x.id)}" ${p.persona_id === x.id ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('')}</select></label>
      <label class="field"><small>Aviso previo</small><select class="input" data-p="${i}" data-f="aviso"><option value="">Ninguno</option>${Object.keys(AVISO_RANGO).map(u => `<optgroup label="${AVISO_N[u][1][0].toUpperCase() + AVISO_N[u][1].slice(1)}">${Array.from({ length: AVISO_RANGO[u] }, (_, j) => j + 1).map(c => `<option value="${u}:${c}" ${p.aviso_unidad === u && p.aviso_cant === c ? 'selected' : ''}>${textoAntelacion(u, c)}</option>`).join('')}</optgroup>`).join('')}</select></label>
    </div>
    ${p.checklist.length ? `<label class="field"><small>Checklist · un punto por línea</small><textarea class="input" rows="${Math.min(p.checklist.length + 1, 8)}" data-p="${i}" data-f="checklist" style="min-height:64px">${esc(p.checklist.map(x => x.t).join('\n'))}</textarea></label>` : ''}
    <div class="grid2">
      <label class="field"><small>Duración · ${p.durDefecto ? 'por defecto' : 'la que se ha entendido'}</small><select class="input" data-p="${i}" data-f="duracion">${[...new Set([...DURACIONES.map(x => x[0]), p.duracion])].sort((a, b) => a - b).map(m => `<option value="${m}" ${p.duracion === m ? 'selected' : ''}>${textoDuracion(m)}</option>`).join('')}</select></label>
      <label class="field"><small>Repetir</small><select class="input" data-p="${i}" data-f="repetir">${REPETIR_N.map(([v, t]) => `<option value="${v}" ${(p.repetir || '') === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    </div>
  </article>`;
}
async function guardarDictado() {
  const D = dic();
  let n = 0;
  const audios = new Set();
  for (const p of D.propuestas.filter(x => x.incluir)) {
    const ids = [...p.etiquetas];
    for (const x of p.nuevas) {
      if (x.decision === 'crear') ids.push(crearEtiquetaLocal(x.nombre).id);
      if (x.decision === 'usar' && x.similar) { const e = S.etiquetas.find(e => norm(e.nombre) === norm(x.similar)); if (e) ids.push(e.id); }
    }
    crearNotaLocal({
      titulo: p.titulo.trim() || 'Nota dictada', cuerpo: p.cuerpo.trim(), prioridad: p.prioridad, etiquetas: [...new Set(ids)],
      persona_id: p.persona_id || null, ...camposFecha(p), duracion: p.duracion || null, checklist: checklistGuardar(p),
      origen: 'voz', origen_ref: p.audio, transcripcion: p.transcripcion,
    });
    audios.add(p.audio); n++;
  }
  for (const a of S.audios) if (audios.has(a.id)) a.estado = 'guardado';
  await guardarAudios();
  S.dic = null;
  renderBase();
  location.hash = '#/';
  toast(n === 1 ? 'Nota guardada' : n + ' notas guardadas');
}
async function limpiarAudios() {
  const lim = Date.now() - AUDIO_DIAS * DIA;
  const viejos = S.audios.filter(a => Date.parse(a.fecha) < lim);
  for (const a of viejos) await idb.del('audio:' + a.id);
  if (viejos.length) { S.audios = S.audios.filter(a => !viejos.includes(a)); await guardarAudios(); }
}

// ---------- Historial ----------
function vistaHistorial() {
  const tab = S.ui.histTab;
  const q = S.ui.histQ;
  const pb = porBorrar(30);
  let lista = '';
  if (tab === 'realizadas') {
    const ns = S.notas.filter(n => n.estado === 'realizada' && cumpleBusqueda(n, q)).sort((a, b) => String(b.realizada_en).localeCompare(String(a.realizada_en)));
    lista = ns.length ? `<div class="list-plain card">${ns.slice(0, 300).map(n => `<div><span class="grow"><b>${esc(n.titulo)}</b>
      <small>Realizada el ${esc(fechaCorta(n.realizada_en))} · ${obraAbierta(n) ? 'se conserva mientras su obra esté abierta' : 'se borra el ' + esc(fechaCorta(n.borrar_en))}</small></span>
      <button class="btn small" data-act="reabrir" data-id="${esc(n.id)}">Reabrir</button></div>`).join('')}</div>` : '<p class="hint">No hay notas realizadas.</p>';
  } else if (tab === 'papelera') {
    const ns = S.notas.filter(n => n.estado === 'papelera' && cumpleBusqueda(n, q)).sort((a, b) => String(b.eliminada_en).localeCompare(String(a.eliminada_en)));
    lista = ns.length ? `<div class="list-plain card">${ns.map(n => `<div><span class="grow"><b>${esc(n.titulo)}</b><small>Se borra definitivamente el ${esc(fechaCorta(n.borrar_en))}</small></span>
      <button class="btn small" data-act="reabrir" data-id="${esc(n.id)}">Restaurar</button><button class="btn small danger" data-act="borrar-ya" data-id="${esc(n.id)}">Borrar ya</button></div>`).join('')}</div>
      <button class="btn danger" data-act="vaciar-papelera">Vaciar papelera</button>` : '<p class="hint">La papelera está vacía. Lo que elimines se guarda aquí 30 días.</p>';
  } else {
    lista = `<p class="hint">Antes de borrar notas realizadas, y al cerrar una obra, se guarda aquí un informe con todas sus notas. Los informes no se borran solos.</p>
      <div id="archivos" class="list-plain card">${S._archivos ? (S._archivos.length ? S._archivos.map(a => `<div><span class="grow"><b>${esc(a.titulo)}</b><small>${esc(fechaCorta(a.creado))} · ${a.notas} notas · ${esc(a.motivo || '')}</small></span>
      <button class="btn small" data-act="archivo-abrir" data-id="${esc(a.id)}">Abrir PDF</button><button class="icon-btn" data-act="archivo-borrar" data-id="${esc(a.id)}" aria-label="Borrar informe">${ICON.close}</button></div>`).join('') : '<p class="hint" style="margin:8px 0">Todavía no hay informes archivados.</p>') : '<p class="hint" style="margin:8px 0">Cargando…</p>'}</div>`;
  }
  const cuerpo = `
    ${pb.length ? `<div class="banner warn" style="margin:0"><span class="grow"><b>${pb.length === 1 ? '1 nota realizada se borrará' : pb.length + ' notas realizadas se borrarán'} a partir del ${esc(fechaCorta(pb[0].borrar_en))}.</b> Antes se guardará un informe en Archivos.</span>
      <button class="btn small" data-act="exportar-porborrar">PDF ahora</button><button class="btn small" data-act="conservar-porborrar">Conservar un año más</button></div>` : ''}
    <div class="seg" role="tablist"><button data-act="hist-tab" data-v="realizadas" aria-pressed="${tab === 'realizadas'}">Realizadas · ${S.notas.filter(n => n.estado === 'realizada').length}</button><button data-act="hist-tab" data-v="papelera" aria-pressed="${tab === 'papelera'}">Papelera · ${S.notas.filter(n => n.estado === 'papelera').length}</button><button data-act="hist-tab" data-v="archivos" aria-pressed="${tab === 'archivos'}">Archivos</button></div>
    ${tab !== 'archivos' ? `<label class="search">${ICON.search}<input id="hq" type="search" placeholder="Buscar" value="${esc(q)}"></label>` : ''}
    ${lista}
    <p class="hint">Las realizadas se guardan un año; las de obras abiertas, mientras la obra siga abierta. Lo eliminado pasa 30 días en la papelera.</p>`;
  return pagina('Historial', cuerpo, '');
}
async function cargarArchivos() {
  if (S._cargandoArch) return;
  S._cargandoArch = true;
  try { S._archivos = (await api('/archivos')).archivos; }
  catch (e) { S._archivos = []; toast(e.message); }
  finally { S._cargandoArch = false; }
  if (ruta() === 'historial' && S.ui.histTab === 'archivos') { const el = $('#ov'); el.innerHTML = vistaHistorial(); }
}

// ---------- Revisión semanal ----------
function iniciarRevision() {
  S.rev = { ids: candidatasRevision().map(n => n.id), i: 0, hechas: 0, reprog: 0, borradas: 0, mantenidas: 0, fecha: false };
}
function vistaRevision() {
  const R = S.rev;
  if (!R.ids.length) return pagina('Revisión semanal', `<div class="empty"><h2>Todo al día</h2><p>No hay notas atrasadas ni notas sin tocar desde hace más de ${ESTANCADA_DIAS} días.</p></div>`, `<button class="btn primary" data-act="rev-fin">Terminar</button>`);
  if (R.i >= R.ids.length) {
    return pagina('Revisión semanal', `<div class="card review-card"><div class="big">Revisión terminada</div>
      <p>${R.hechas} realizadas · ${R.reprog} reprogramadas · ${R.borradas} eliminadas · ${R.mantenidas} se mantienen.</p></div>`, `<button class="btn primary" data-act="rev-fin">Volver a las notas</button>`);
  }
  const n = nota(R.ids[R.i]);
  if (!n || n.estado !== 'activa') { R.i++; return vistaRevision(); }
  const tags = (n.etiquetas || []).map(etq).filter(Boolean).map(e => '#' + esc(e.nombre)).join(' ');
  const motivo = atrasada(n) ? `<span style="color:var(--red);font-weight:600">Atrasada: vencía ${esc(diaLargo(fechaEfectiva(n)))}</span>` : `Sin tocar desde el ${esc(fechaCorta(n.actualizada))}`;
  const cuerpo = `<div class="progress" aria-label="Progreso"><i style="width:${Math.round(R.i / R.ids.length * 100)}%"></i></div>
    <p class="hint">${R.i + 1} de ${R.ids.length}</p>
    <div class="card review-card p-${n.prioridad}">
      <div class="row"><i class="dot"></i><b style="color:var(--p-ink)">${PRIO_N[n.prioridad]}</b><span class="grow"></span><span class="hint">${motivo}</span></div>
      <div class="big">${esc(n.titulo)}</div>
      ${n.cuerpo ? `<p style="margin:0;white-space:pre-wrap">${esc(n.cuerpo)}</p>` : ''}
      <div class="hint">${tags}${per(n.persona_id) ? ' · ' + esc(per(n.persona_id).nombre) : ''}</div>
    </div>
    ${R.fecha ? `<div class="card"><label class="field"><span>Nueva fecha límite</span><input id="rev-fecha" class="input" type="date" value="${esc(addDias(hoyYmd(), 7))}"></label>
      <div class="row"><button class="btn" data-act="rev-fecha-no">Cancelar</button><button class="btn primary" data-act="rev-fecha-ok">Guardar fecha</button></div></div>` : `
    <div class="review-actions">
      <button class="btn primary" data-act="rev" data-v="hecha">Ya está hecha</button>
      <button class="btn" data-act="rev" data-v="reprogramar">Reprogramar</button>
      <button class="btn danger" data-act="rev" data-v="eliminar">Eliminar</button>
      <button class="btn" data-act="rev" data-v="mantener">Mantener así</button>
    </div>`}`;
  return pagina('Revisión semanal', cuerpo, '');
}
function accionRevision(v) {
  const R = S.rev, id = R.ids[R.i];
  if (v === 'hecha') { realizarNota(id); R.hechas++; }
  if (v === 'eliminar') { editarNotaLocal(id, { estado: 'papelera' }); R.borradas++; }
  if (v === 'mantener') { editarNotaLocal(id, {}); R.mantenidas++; }
  if (v === 'reprogramar') { R.fecha = true; renderOverlay(); return; }
  R.i++;
  if (R.i >= R.ids.length) terminarRevision(false);
  renderOverlay(); renderBase();
}
function terminarRevision(salir) {
  S.srv.revision_ultima = hoyYmd();
  encolar({ kind: 'config', method: 'PUT', path: '/config', body: { revision_ultima: hoyYmd() } });
  guardarLocal();
  if (salir) { S.rev = null; location.hash = '#/'; renderBase(); }
}

// ---------- Conflictos ----------
function vistaConflicto() {
  const c = S.conflictos[0];
  if (!c) return pagina('Conflictos', '<p>No hay conflictos pendientes.</p>', `<button class="btn primary" data-act="cerrar">Cerrar</button>`);
  const mia = nota(c.op.ref) || {}, srv = c.servidor;
  const campos = [['titulo', 'Título'], ['cuerpo', 'Nota'], ['prioridad', 'Prioridad'], ['fecha_limite', 'Fecha límite'], ['hora_limite', 'Hora'], ['aviso_unidad', 'Aviso previo'], ['checklist', 'Checklist'], ['estado', 'Estado'], ['persona_id', 'Asignada a']];
  const val = (n, k) => k === 'prioridad' ? PRIO_N[n[k]] : k === 'aviso_unidad' ? (textoAviso(n) || '—') : k === 'checklist' ? ((n.checklist || []).map(p => (p.hecho ? '☑ ' : '☐ ') + p.t).join(' · ') || '—') : k === 'persona_id' ? ((per(n[k]) || {}).nombre || '—') : (n[k] || '—');
  const col = (n, t) => `<div><b>${t}</b>${campos.map(([k, l]) => `<span class="${JSON.stringify(mia[k] || '') !== JSON.stringify(srv[k] || '') ? 'changed' : ''}"><small class="hint">${l}:</small> ${esc(val(n, k))}</span>`).join('')}</div>`;
  const cuerpo = `<p>Esta nota se cambió en otro dispositivo mientras la editabas aquí. Elige qué versión quieres conservar. Lo marcado en naranja es lo que difiere.</p>
    <div class="diff">${col(mia, 'Tu versión (este dispositivo)')}${col(srv, 'Versión guardada (otro dispositivo)')}</div>`;
  return pagina(S.conflictos.length > 1 ? `Conflicto (1 de ${S.conflictos.length})` : 'Conflicto', cuerpo,
    `<button class="btn" data-act="conf-srv">Usar la guardada</button><button class="btn primary" data-act="conf-mia">Quedarme con la mía</button>`);
}
function resolverConflicto(mia) {
  const c = S.conflictos.shift();
  if (mia) encolar({ ...c.op, k: uid(), body: { ...c.op.body, forzar: true } });
  else {
    const i = S.notas.findIndex(n => n.id === c.servidor.id);
    if (i >= 0) S.notas[i] = c.servidor; else S.notas.push(c.servidor);
  }
  guardarOutbox(); guardarLocal();
  renderBase();
  if (S.conflictos.length) renderOverlay(); else cerrar();
}

// ---------- Ajustes ----------
function vistaAjustes() {
  const c = S.cfg;
  const pushOk = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const perm = pushOk ? Notification.permission : 'no';
  const cont = e => S.notas.filter(n => n.estado !== 'papelera' && (n.etiquetas || []).includes(e.id)).length;
  const dia = Number(S.srv.revision_dia == null ? 5 : S.srv.revision_dia);
  const cuerpo = `
  <section class="card"><h2>Conexión</h2>
    <label class="field"><span>URL del worker</span><input class="input" id="cfg-url" value="${esc(c.url)}" placeholder="https://notas-obra.tuusuario.workers.dev" autocomplete="off" inputmode="url"></label>
    <label class="field"><span>Token (APP_TOKEN)</span><input class="input" id="cfg-token" type="password" value="${esc(c.token)}" autocomplete="off"></label>
    <label class="field"><span>Nombre de este dispositivo</span><input class="input" id="cfg-disp" value="${esc(c.dispositivo)}" placeholder="Móvil, Portátil oficina…"></label>
    <div class="row"><button class="btn primary" data-act="cfg-guardar">Guardar y probar conexión</button></div>
    <p id="cfg-res" class="hint"></p>
  </section>

  <section class="card"><h2>Avisos</h2>
    ${!pushOk ? '<p class="hint">Este navegador no admite avisos. En iPhone, instala primero la app en la pantalla de inicio (Compartir → Añadir a pantalla de inicio) y ábrela desde allí.</p>'
      : perm === 'denied' ? '<p class="hint">Los avisos están bloqueados para esta app. Actívalos en los ajustes del navegador (icono del candado junto a la dirección) y vuelve aquí.</p>'
      : `<p class="hint">${c.pushEndpoint && perm === 'granted' ? 'Este dispositivo recibe los avisos.' : 'Activa los avisos para que suenen en este dispositivo aunque la app esté cerrada.'}</p>
         <div class="row"><button class="btn ${c.pushEndpoint && perm === 'granted' ? '' : 'primary'}" data-act="push-activar">${c.pushEndpoint && perm === 'granted' ? 'Volver a registrar' : 'Activar avisos aquí'}</button><button class="btn" data-act="push-probar">Enviar aviso de prueba</button></div>`}
    <div id="dispositivos" class="list-plain"></div>
  </section>

  <section class="card"><div class="row"><h2 class="grow">Etiquetas</h2><button class="btn small" data-act="etq-nueva">+ Nueva</button></div>
    <p class="hint">Los alias son las palabras que usas al hablar («la nave», «Sabadell»). Ayudan a acertar la etiqueta cuando dictas. Al cerrar una obra se archiva un informe con todas sus notas.</p>
    ${TIPOS.map(([t, nombre]) => { const es = S.etiquetas.filter(e => e.tipo === t); return es.length ? `<h3>${nombre}</h3><div class="list-plain">${es.map(e => `<div><span class="grow"><b>#${esc(e.nombre)}${e.cerrada ? ' · cerrada' : ''}</b><small>${e.alias ? 'Alias: ' + esc(e.alias) : 'Sin alias'} · ${cont(e)} notas</small></span><button class="btn small" data-act="etq-editar" data-id="${esc(e.id)}">Editar</button></div>`).join('')}</div>` : ''; }).join('') || '<p class="hint">Todavía no hay etiquetas. Crea una aquí o escribe # en cualquier nota.</p>'}
  </section>

  <section class="card"><div class="row"><h2 class="grow">Personas</h2><button class="btn small" data-act="per-nueva">+ Nueva</button></div>
    <div class="list-plain">${S.personas.map(p => `<div><span class="grow"><b>${esc(p.nombre)}</b><small>${esc(p.cargo || '')}</small></span><button class="btn small" data-act="per-editar" data-id="${esc(p.id)}">Editar</button></div>`).join('') || '<p class="hint">Añade a quién sueles asignar notas: jefe de obra, encargado, jefe de producción…</p>'}</div>
  </section>

  <section class="card"><h2>Grupos filtrados</h2>
    <p class="hint">Para crear uno, aplica filtros en la lista y pulsa «Guardar como grupo».</p>
    <div class="list-plain">${S.vistas.map((v, i) => `<div><span class="grow"><b>${esc(v.nombre)}</b><small>${esc(resumenFiltro(v.filtro))}</small></span>
      <button class="icon-btn" data-act="grupo-mover" data-id="${esc(v.id)}" data-v="-1" aria-label="Subir" ${i ? '' : 'disabled'}>${ICON.up}</button>
      <button class="icon-btn" data-act="grupo-mover" data-id="${esc(v.id)}" data-v="1" aria-label="Bajar" ${i < S.vistas.length - 1 ? '' : 'disabled'}>${ICON.down}</button>
      <button class="btn small" data-act="grupo-editar" data-id="${esc(v.id)}">Editar</button></div>`).join('')}</div>
  </section>

  <section class="card"><h2>Revisión semanal</h2>
    <label class="field"><span>Día de la revisión</span><select class="input" id="rev-dia">${[1, 2, 3, 4, 5, 6, 0].map(d => `<option value="${d}" ${d === dia ? 'selected' : ''}>${DIAS_SEM[d][0].toUpperCase() + DIAS_SEM[d].slice(1)}</option>`).join('')}</select></label>
    <p class="hint">Ese día aparecerá un aviso para repasar las notas atrasadas y las que llevan más de ${ESTANCADA_DIAS} días sin tocar.</p>
  </section>

  <section class="card"><h2>Resumen matutino</h2>
    <label class="check"><input type="checkbox" data-resumen="activo" ${resumenCfg('activo') !== '0' ? 'checked' : ''}>Recibir cada mañana un aviso con lo pendiente</label>
    <label class="field"><span>Hora</span><input class="input" type="time" data-resumen="hora" value="${esc(resumenCfg('hora'))}" style="max-width:160px"></label>
    <div class="field"><span class="field-label">Días</span><div class="tags-edit">${DIAS_LARGOS.map((d, i) => chip('res-dia', String(i + 1), resumenCfg('dias').split(',').includes(String(i + 1)), d.slice(0, 3))).join('')}</div></div>
    <p class="hint">Solo llega si hay algo urgente, con hora hoy o sin tocar desde hace más de ${ESTANCADA_DIAS} días. <a href="#/resumen" data-reemplazar>Ver el resumen de hoy</a></p>
  </section>

  <section class="card"><h2>Copia de seguridad</h2>
    <p class="hint">Descarga todas tus notas, etiquetas, personas y grupos en un archivo.</p>
    <div class="row"><button class="btn" data-act="exportar">Descargar copia</button></div>
  </section>
  <p class="hint">Notas de obra · versión ${VERSION}</p>`;
  return pagina('Ajustes', cuerpo, '');
}
async function cargarDispositivos() {
  const el = () => $('#dispositivos');
  if (!S.cfg.url || !S.cfg.token) return;
  try {
    const { dispositivos } = await api('/dispositivos');
    if (!el()) return;
    el().innerHTML = dispositivos.length ? '<h3 style="margin-top:6px">Dispositivos que reciben avisos</h3>' + dispositivos.map(d => `<div><span class="grow"><b>${esc(d.nombre || 'Sin nombre')}${d.endpoint === S.cfg.pushEndpoint ? ' (este)' : ''}</b><small>${d.activo ? 'Activo' : 'Desactivado'}${d.ultimo_uso ? ' · último aviso ' + esc(fechaCorta(d.ultimo_uso)) : ''}</small></span>
      <button class="btn small" data-act="disp-activo" data-id="${esc(d.id)}" data-v="${d.activo ? 0 : 1}">${d.activo ? 'Desactivar' : 'Activar'}</button>
      <button class="icon-btn" data-act="disp-borrar" data-id="${esc(d.id)}" aria-label="Quitar dispositivo">${ICON.close}</button></div>`).join('') : '';
  } catch { /* sin conexión */ }
}
async function guardarConexion() {
  S.cfg.url = $('#cfg-url').value.trim().replace(/\/+$/, '');
  S.cfg.token = $('#cfg-token').value.trim();
  S.cfg.dispositivo = $('#cfg-disp').value.trim() || nombrePorDefecto();
  await guardarCfg();
  const res = $('#cfg-res');
  res.textContent = 'Probando…';
  try {
    const r = await api('/estado');
    res.textContent = !(r.api >= API_MIN) ? 'Conectado, pero este worker es una versión antigua: no guarda la hora, el checklist, la repetición ni las fotos. Revisa la URL: la correcta acaba en «notas-obra….workers.dev».'
      : r.faltan && r.faltan.length ? 'Conectado, pero falta configurar en el worker: ' + r.faltan.join(', ') + '.' : 'Conexión correcta. Todo listo.';
    res.style.color = !(r.api >= API_MIN) ? 'var(--red)' : r.faltan && r.faltan.length ? 'var(--orange-ink)' : 'var(--primary)';
    await sincronizar();
    cargarDispositivos();
  } catch (e) {
    res.textContent = e.message + (e.red ? ' Revisa la URL del worker y que ALLOWED_ORIGIN coincida con la dirección de esta app.' : '');
    res.style.color = 'var(--red)';
  }
}
const nombrePorDefecto = () => /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ? 'Móvil' : 'Ordenador';
const plataforma = () => /iPhone|iPad/i.test(navigator.userAgent) ? 'iOS' : /Android/i.test(navigator.userAgent) ? 'Android' : /Windows/i.test(navigator.userAgent) ? 'Windows' : /Mac/i.test(navigator.userAgent) ? 'Mac' : 'Otro';
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));

async function activarAvisos() {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Sin permiso no se pueden mostrar avisos.'); renderOverlay(); return; }
    const reg = await navigator.serviceWorker.ready;
    const { clave } = await api('/push/clave');
    let sub = await reg.pushManager.getSubscription();
    if (sub) {
      const actual = sub.options && sub.options.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null;
      const nueva = unb64u(clave);
      if (!actual || actual.length !== nueva.length || actual.some((x, i) => x !== nueva[i])) { await sub.unsubscribe(); sub = null; }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64u(clave) });
    const j = sub.toJSON();
    await api('/push/suscribir', { method: 'POST', body: { endpoint: j.endpoint, keys: j.keys, nombre: S.cfg.dispositivo || nombrePorDefecto(), plataforma: plataforma() } });
    S.cfg.pushEndpoint = j.endpoint; await guardarCfg();
    toast('Avisos activados en este dispositivo.');
    renderOverlay();
  } catch (e) { toast('No se han podido activar los avisos: ' + e.message); }
}

function modalEtiqueta() {
  const m = S.modal, e = m.id ? etq(m.id) : { nombre: '', tipo: 'obra', alias: '', cerrada: 0 };
  const cuerpo = `<label class="field"><span>Nombre</span><input class="input" id="me-nombre" value="${esc(e.nombre)}" placeholder="Mallorca245" autocomplete="off"><small>Sin espacios: se escribe #${esc(e.nombre || 'Nombre')} en las notas. Si lo cambias, se actualiza en todas.</small></label>
    <label class="field"><span>Tipo</span><select class="input" id="me-tipo">${TIPOS.map(([t]) => `<option value="${t}" ${e.tipo === t ? 'selected' : ''}>${TIPO_1[t]}</option>`).join('')}</select></label>
    <label class="field"><span>Alias <small>(separados por comas)</small></span><input class="input" id="me-alias" value="${esc(e.alias || '')}" placeholder="la de Mallorca, Mallorca"></label>
    ${m.id && e.tipo === 'obra' ? `<div class="card" style="background:var(--bg)"><b>${e.cerrada ? 'Obra cerrada' : 'Obra abierta'}</b>
      <p class="hint" style="margin:0">${e.cerrada ? 'Sus notas realizadas se borran al cumplir un año.' : 'Mientras esté abierta, sus notas realizadas no se borran. Al cerrarla se guarda un informe con todas sus notas y se abre para descargarlo en PDF.'}</p>
      <div class="row"><button class="btn small" data-act="me-cerrar">${e.cerrada ? 'Reabrir obra' : 'Cerrar obra'}</button></div></div>` : ''}
    ${m.id ? '<button class="btn danger" data-act="me-borrar">Eliminar etiqueta</button>' : ''}`;
  return pagina(m.id ? 'Editar etiqueta' : 'Nueva etiqueta', cuerpo, `<button class="btn" data-act="modal-cerrar">Cancelar</button><button class="btn primary" data-act="me-guardar">Guardar</button>`, { sheet: true }).replace('data-act="cerrar"', 'data-act="modal-cerrar"');
}
function modalPersona() {
  const m = S.modal, p = m.id ? per(m.id) : { nombre: '', cargo: '' };
  const cuerpo = `<label class="field"><span>Nombre</span><input class="input" id="mp-nombre" value="${esc(p.nombre)}" placeholder="Encargado, Jordi…"></label>
    <label class="field"><span>Cargo <small>(opcional)</small></span><input class="input" id="mp-cargo" value="${esc(p.cargo || '')}" placeholder="Jefe de producción"></label>
    ${m.id ? '<button class="btn danger" data-act="mp-borrar">Eliminar persona</button>' : ''}`;
  return pagina(m.id ? 'Editar persona' : 'Nueva persona', cuerpo, `<button class="btn" data-act="modal-cerrar">Cancelar</button><button class="btn primary" data-act="mp-guardar">Guardar</button>`, { sheet: true }).replace('data-act="cerrar"', 'data-act="modal-cerrar"');
}
function modalGrupo() {
  const m = S.modal, v = m.id ? S.vistas.find(x => x.id === m.id) : null;
  const cuerpo = `<label class="field"><span>Nombre del grupo</span><input class="input" id="mg-nombre" value="${esc(v ? v.nombre : '')}" placeholder="Mallorca 245 · Urgentes" maxlength="60"></label>
    <p class="hint">Filtros: ${esc(resumenFiltro(v ? v.filtro : S.ui.filtro) || 'ninguno')}</p>
    ${v ? '<button class="btn danger" data-act="mg-borrar">Eliminar grupo</button>' : ''}`;
  return pagina(v ? 'Editar grupo filtrado' : 'Guardar como grupo', cuerpo, `<button class="btn" data-act="modal-cerrar">Cancelar</button><button class="btn primary" data-act="mg-guardar">Guardar</button>`, { sheet: true }).replace('data-act="cerrar"', 'data-act="modal-cerrar"');
}

// ---------- Avisos con la app abierta ----------
function comprobarAlarmas() {
  const ahora = Date.now();
  for (const n of activas()) {
    const clave = n.id + '|' + n.alarma;   // una nota puede tener dos avisos (antes y a la hora límite)
    if (!n.alarma || S.alarmasVistas.has(clave)) continue;
    const t = Date.parse(n.alarma);
    if (t <= ahora && ahora - t < 15 * 60000) {
      S.alarmasVistas.add(clave);
      if (document.visibilityState !== 'visible') continue;
      toast('🔔 ' + n.titulo, {
        clase: 'alarm', ms: 0, botones: [
          ['Hecha', () => { accionAlarmaLocal(n.id, 'hecha'); }],
          ['+10 min', () => { accionAlarmaLocal(n.id, 'posponer'); }],
          ['Cerrar', () => {}],
        ],
      });
    } else if (t < ahora) S.alarmasVistas.add(clave);
    // Tras sonar, el siguiente aviso de la nota (el de la hora límite) queda programado también aquí.
    if (t <= ahora) { const sig = proximoAviso(n, t); if (sig) n.alarma = sig; }
  }
}
function accionAlarmaLocal(id, accion) {
  const n = nota(id); if (!n) return;
  if (accion === 'hecha') { n.estado = 'realizada'; n.realizada_en = new Date().toISOString(); }
  else n.alarma = new Date(Date.now() + 10 * 60000).toISOString();
  encolar({ kind: 'alarma', ref: id, method: 'POST', path: '/notas/' + id + '/alarma', body: { accion, minutos: 10, endpoint: S.cfg.pushEndpoint || '' } });
  renderBase();
  toast(accion === 'hecha' ? 'Nota realizada' : 'Te lo recuerdo en 10 minutos');
}

// ---------- Acciones ----------
const ACT = {
  cerrar: () => cerrar(),
  fondo: (el, ev) => { if (ev.target !== el) return; if (el.closest('#modal')) { S.modal = null; renderModal(); } else cerrar(); },
  'modal-cerrar': () => { S.modal = null; renderModal(); },
  hecha: (el) => marcarRealizada(el.dataset.id, el.closest('.nota')),
  abrir: (el) => { location.hash = '#/nota/' + el.dataset.id; },
  'ir-panel': () => { location.hash = '#/'; },
  'res-dia': (el) => {
    const dias = new Set(resumenCfg('dias').split(',').filter(Boolean));
    if (dias.has(el.dataset.v)) dias.delete(el.dataset.v); else dias.add(el.dataset.v);
    guardarResumen('dias', [...dias].sort().join(','));
  },
  buscar: () => { S.ui.buscar = true; renderBase(); const q = $('#qm'); if (q) q.focus(); },
  'cerrar-buscar': () => { S.ui.buscar = false; S.ui.q = ''; renderBase(); },
  vista: (el) => {
    const id = el.dataset.id || null;
    S.ui.vista = id;
    const v = id && S.vistas.find(x => x.id === id);
    S.ui.filtro = v ? { ...filtroVacio(), ...JSON.parse(JSON.stringify(v.filtro)) } : filtroVacio();
    guardarUi(); renderBase();
  },
  agrupar: (el) => { S.ui.agrupar = el.dataset.v; guardarUi(); renderBase(); },
  modo: (el) => { S.ui.modo = el.dataset.v; guardarUi(); renderBase(); window.scrollTo(0, 0); },
  'mx-mas': (el) => { S.ui.matrizMas[el.dataset.v] = !S.ui.matrizMas[el.dataset.v]; renderBase(); },
  'quitar-grupo-vista': () => { S.ui.grupoVista = ''; guardarUi(); renderBase(); },
  'cal-vista': (el) => { cal().vista = el.dataset.v; guardarUi(); renderBase(); },
  'cal-hoy': () => { cal().ref = hoyYmd(); renderBase(); },
  // Agenda del móvil: tocar un día de la tira lleva a sus notas.
  'calm-ir': (el) => {
    const s = document.getElementById('calm-' + el.dataset.v);
    if (s) window.scrollTo({ top: s.getBoundingClientRect().top + window.scrollY - (document.querySelector('.toolbar').getBoundingClientRect().bottom + 8), behavior: 'smooth' });
    else toast(el.dataset.v < hoyYmd() ? 'Día pasado: lo pendiente está en Atrasadas.' : 'Ese día no tiene notas.');
  },
  'cal-mover': (el) => {
    const c = cal(), k = Number(el.dataset.v);
    if (c.vista === 'mes') { const [y, m] = c.ref.split('-').map(Number); c.ref = ymd(new Date(y, m - 1 + k, 1)); }
    else c.ref = addDias(c.ref, 7 * k);
    renderBase();
  },
  // Pulsar un hueco del calendario crea una nota ahí: en la rejilla de la Semana con la hora pulsada
  // (pasos de 15 min, como al arrastrar); en la fila «⚑ Fecha límite» o con el «+» de un día, solo con la fecha.
  'cal-nueva': (el, ev) => {
    const f = el.dataset.fecha; if (!f) return;
    let h = '';
    if (el.classList.contains('cal-col') && ev) {
      const [ini, fin] = calHorario(), r = el.getBoundingClientRect();
      let m = ini * 60 + Math.floor((ev.clientY - r.top) / CAL_HH * 60 / 15) * 15;
      m = Math.min(Math.max(m, ini * 60), fin * 60 - 15);
      h = pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
    }
    nuevaNotaEn(f, h);
  },
  // Un día del mes (o del mes pequeño) abre su semana.
  'cal-dia': (el) => { const c = cal(); c.ref = el.dataset.v; c.vista = 'semana'; guardarUi(); renderBase(); },
  'limpiar-filtro': () => { S.ui.filtro = filtroVacio(); S.ui.vista = null; guardarUi(); renderBase(); if (ruta() === 'filtros') renderOverlay(); },
  'guardar-grupo': () => { if (!filtroActivo(S.ui.filtro)) return; S.modal = { tipo: 'grupo', id: null }; renderModal(); setTimeout(() => $('#mg-nombre') && $('#mg-nombre').focus(), 50); },
  'actualizar-grupo': () => {
    const v = S.vistas.find(x => x.id === S.ui.vista); if (!v) return;
    v.filtro = JSON.parse(JSON.stringify(S.ui.filtro));
    encolar({ kind: 'vista', method: 'PUT', path: '/vistas/' + v.id, body: { nombre: v.nombre, filtro: v.filtro } });
    guardarLocal(); renderBase(); if (ruta() === 'filtros') renderOverlay();
    toast('Grupo «' + v.nombre + '» actualizado');
  },
  'imprimir-lista': () => imprimir(nombreVista(), visibles()),
  'pdf-reunion': () => {
    const notas = visibles();
    if (!notas.length) { toast('No hay notas que llevar a la reunión con este filtro.'); return; }
    imprimirReunion(nombreVista(), notas);
  },

  // Filtros
  'f-tag': (el) => { toggle(S.ui.filtro.etiquetas, el.dataset.v); cambioFiltro(); },
  'f-prio': (el) => { toggle(S.ui.filtro.prioridades, el.dataset.v); cambioFiltro(); },
  'f-per': (el) => { toggle(S.ui.filtro.personas, el.dataset.v); cambioFiltro(); },
  'f-modo': (el) => { S.ui.filtro.modo = el.dataset.v; cambioFiltro(); },
  'f-bool': (el) => { S.ui.filtro[el.dataset.v] = el.checked; cambioFiltro(); },

  // Editor
  'ed-prio': (el) => { S.ed.d.prioridad = el.dataset.v; renderOverlay(); },
  'ed-dur': (el) => {
    if (el.dataset.v === 'otra') S.ed.durOtra = true;
    else { S.ed.durOtra = false; S.ed.d.duracion = Number(el.dataset.v); }
    renderOverlay();
    if (S.ed.durOtra) { const i = $('[data-ed="duracion"]'); if (i) i.focus(); }
  },
  'foto-ver': (el) => { S.modal = { tipo: 'foto', nota: el.dataset.nota, id: el.dataset.v }; renderModal(); },
  'foto-quitar': () => {
    if (!confirm('¿Quitar esta foto de la nota?')) return;
    quitarFotoLocal(S.modal.nota, S.modal.id);
    S.modal = null; renderModal(); pintarFotos(); renderBase();
    toast('Foto quitada');
  },
  'chk-anadir': () => { const l = S.ed.d.checklist; l.push({ t: '', hecho: false }); pintarChecklist(l.length - 1); },
  'chk-quitar': (el) => { S.ed.d.checklist.splice(Number(el.dataset.v), 1); pintarChecklist(); },
  'ed-aviso': (el) => { const d = S.ed.d; d.aviso_unidad = el.dataset.v; if (d.aviso_unidad) d.aviso_cant = Math.min(Number(d.aviso_cant) || 1, AVISO_RANGO[d.aviso_unidad]); pintarAvisos(); },
  'ed-quitar-tag': (el) => { S.ed.d.etiquetas = S.ed.d.etiquetas.filter(x => x !== el.dataset.id); renderOverlay(); },
  'ed-hash': () => {
    const ta = $('#ed-cuerpo');
    const v = ta.value;
    const sep = v && !/\s$/.test(v) ? ' ' : '';
    ta.value = v + sep + '#'; S.ed.d.cuerpo = ta.value;
    ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
    onCuerpo(ta);
  },
  sug: (el) => elegirSug(Number(el.dataset.i)),
  'ed-guardar': () => guardarEditor(),
  'ed-hecha': () => { const id = S.ed.id; guardarCambiosSilencio(); S.ed = null; cerrar(); setTimeout(() => marcarRealizada(id), 50); },
  'ed-borrar': () => { const id = S.ed.id; S.ed = null; cerrar(); setTimeout(() => aPapelera(id), 50); },
  'ed-reabrir': () => { editarNotaLocal(S.ed.id, { estado: 'activa' }); renderOverlay(); renderBase(); toast('La nota vuelve a estar pendiente'); },

  // Dictado
  'rec-empezar': () => empezarGrabacion(),
  // Botón Dictar: abre el dictado y empieza a grabar sin tener que pulsar otra vez.
  dictar: () => {
    const D = dic();
    if (ruta() !== 'dictado') location.hash = '#/dictado';
    if (!['grabando', 'pausa', 'procesando'].includes(D.fase)) empezarGrabacion();
  },
  'rec-pausa': () => {
    const D = dic(); if (!D.rec) return;
    if (D.fase === 'grabando') { D.rec.pause(); D.fase = 'pausa'; } else { D.rec.resume(); D.fase = 'grabando'; }
    renderOverlay();
  },
  'rec-parar': () => pararGrabacion(false),
  'rec-cancelar': () => cancelarGrabacion(),
  'audio-procesar': (el) => procesarAudio(el.dataset.id),
  'audio-borrar': async (el) => {
    if (!confirm('¿Borrar este audio del dispositivo?')) return;
    await idb.del('audio:' + el.dataset.id);
    S.audios = S.audios.filter(a => a.id !== el.dataset.id); await guardarAudios();
    renderOverlay(); renderBase();
  },
  'dic-mas': () => { dic().fase = 'listo'; renderOverlay(); },
  'dic-volver-revision': () => { dic().fase = 'revision'; renderOverlay(); },
  'dic-descartar': () => { if (!confirm('¿Descartar las notas propuestas? El audio sigue guardado unos días por si quieres volver a analizarlo.')) return; S.dic = null; location.hash = '#/'; },
  'dic-guardar': () => guardarDictado(),
  'p-quitar-tag': (el) => { const p = dic().propuestas[el.dataset.p]; p.etiquetas = p.etiquetas.filter(x => x !== el.dataset.id); renderOverlay(); },
  'p-nueva': (el) => { const p = dic().propuestas[el.dataset.p]; const n = p.nuevas.find(x => x.nombre === el.dataset.n); if (n) n.decision = el.dataset.v; renderOverlay(); },

  // Historial
  'hist-tab': (el) => { S.ui.histTab = el.dataset.v; renderOverlay(); },
  reabrir: (el) => { editarNotaLocal(el.dataset.id, { estado: 'activa' }); renderOverlay(); renderBase(); toast('La nota vuelve a estar pendiente'); },
  'borrar-ya': (el) => {
    if (!confirm('¿Borrar definitivamente esta nota? No se podrá recuperar.')) return;
    const id = el.dataset.id;
    S.notas = S.notas.filter(n => n.id !== id);
    encolar({ kind: 'borrar', ref: id, method: 'DELETE', path: '/notas/' + id });
    guardarLocal(); renderOverlay();
  },
  'vaciar-papelera': () => {
    if (!confirm('¿Borrar definitivamente todas las notas de la papelera?')) return;
    S.notas = S.notas.filter(n => n.estado !== 'papelera');
    encolar({ kind: 'borrar', method: 'POST', path: '/papelera/vaciar' });
    guardarLocal(); renderOverlay();
  },
  'exportar-porborrar': () => imprimir('Notas realizadas que se borrarán pronto', porBorrar(30)),
  'conservar-porborrar': () => {
    const ns = porBorrar(30);
    for (const n of ns) n.borrar_en = new Date(Date.now() + 365 * DIA).toISOString();
    encolar({ kind: 'conservar', method: 'POST', path: '/notas/conservar', body: { ids: ns.map(n => n.id) } });
    guardarLocal(); renderOverlay(); renderBase();
    toast(ns.length === 1 ? 'La nota se conservará un año más' : ns.length + ' notas se conservarán un año más');
  },
  'archivo-abrir': async (el) => { try { imprimirHtml(await api('/archivos/' + el.dataset.id)); } catch (e) { toast(e.message); } },
  'archivo-borrar': async (el) => {
    if (!confirm('¿Borrar este informe archivado?')) return;
    try { await api('/archivos/' + el.dataset.id, { method: 'DELETE' }); S._archivos = S._archivos.filter(a => a.id !== el.dataset.id); renderOverlay(); } catch (e) { toast(e.message); }
  },

  // Revisión
  rev: (el) => accionRevision(el.dataset.v),
  'rev-fecha-no': () => { S.rev.fecha = false; renderOverlay(); },
  'rev-fecha-ok': () => {
    const v = $('#rev-fecha').value; if (!v) return;
    const R = S.rev;
    editarNotaLocal(R.ids[R.i], { fecha_limite: v });
    R.reprog++; R.fecha = false; R.i++;
    if (R.i >= R.ids.length) terminarRevision(false);
    renderOverlay(); renderBase();
  },
  'rev-fin': () => terminarRevision(true),

  // Conflictos
  'conf-mia': () => resolverConflicto(true),
  'conf-srv': () => resolverConflicto(false),

  // Ajustes
  'cfg-guardar': () => guardarConexion(),
  'push-activar': () => activarAvisos(),
  'push-probar': async () => { try { const r = await api('/push/prueba', { method: 'POST', body: {} }); toast(r.total ? `Aviso enviado a ${r.enviados} de ${r.total} dispositivos.` : 'Ningún dispositivo tiene los avisos activados.'); } catch (e) { toast(e.message); } },
  'disp-activo': async (el) => { try { await api('/dispositivos/' + el.dataset.id, { method: 'PUT', body: { activo: el.dataset.v === '1' } }); cargarDispositivos(); } catch (e) { toast(e.message); } },
  'disp-borrar': async (el) => { if (!confirm('¿Dejar de enviar avisos a este dispositivo?')) return; try { await api('/dispositivos/' + el.dataset.id, { method: 'DELETE' }); cargarDispositivos(); } catch (e) { toast(e.message); } },
  'etq-nueva': () => { S.modal = { tipo: 'etiqueta', id: null }; renderModal(); },
  'etq-editar': (el) => { S.modal = { tipo: 'etiqueta', id: el.dataset.id }; renderModal(); },
  'me-guardar': () => {
    const nombre = $('#me-nombre').value.trim().replace(/^#/, ''), tipo = $('#me-tipo').value, alias = $('#me-alias').value.trim();
    if (!TAG_RE.test(nombre)) { toast('El nombre solo puede tener letras, números, guion y guion bajo, sin espacios.'); return; }
    const dup = S.etiquetas.find(e => norm(e.nombre) === norm(nombre) && e.id !== S.modal.id);
    if (dup) { toast('Ya existe la etiqueta #' + dup.nombre + '.'); return; }
    if (S.modal.id) {
      const e = etq(S.modal.id); Object.assign(e, { nombre, tipo, alias });
      encolar({ kind: 'etiqueta-ed', method: 'PUT', path: '/etiquetas/' + e.id, body: { nombre, tipo, alias } });
    } else crearEtiquetaLocal(nombre, tipo, alias);
    guardarLocal(); S.modal = null; renderModal(); renderOverlay(); renderBase();
  },
  'me-cerrar': async () => {
    const e = etq(S.modal.id); if (!e) return;
    const cerrarla = !e.cerrada;
    if (cerrarla && !confirm('¿Cerrar la obra #' + e.nombre + '? Se guardará un informe con todas sus notas en Historial → Archivos y se abrirá para descargarlo en PDF.')) return;
    try {
      const r = await api('/etiquetas/' + e.id, { method: 'PUT', body: { cerrada: cerrarla } });
      Object.assign(e, r.etiqueta);
      await sincronizar();
      S.modal = null; renderModal(); renderOverlay();
      if (cerrarla && r.archivo) imprimirHtml(await api('/archivos/' + r.archivo));
      toast(cerrarla ? 'Obra cerrada. El informe está en Historial → Archivos.' : 'Obra reabierta');
    } catch (err) { toast(err.red ? 'Para cerrar una obra hace falta conexión.' : err.message); }
  },
  'me-borrar': () => {
    const e = etq(S.modal.id);
    if (!confirm('¿Eliminar #' + e.nombre + '? Se quitará de todas las notas.')) return;
    S.etiquetas = S.etiquetas.filter(x => x.id !== e.id);
    for (const n of S.notas) n.etiquetas = (n.etiquetas || []).filter(x => x !== e.id);
    S.ui.filtro.etiquetas = S.ui.filtro.etiquetas.filter(x => x !== e.id);
    encolar({ kind: 'etiqueta-ed', method: 'DELETE', path: '/etiquetas/' + e.id });
    guardarLocal(); S.modal = null; renderModal(); renderOverlay(); renderBase();
  },
  'per-nueva': () => { S.modal = { tipo: 'persona', id: null }; renderModal(); },
  'per-editar': (el) => { S.modal = { tipo: 'persona', id: el.dataset.id }; renderModal(); },
  'mp-guardar': () => {
    const nombre = $('#mp-nombre').value.trim(), cargo = $('#mp-cargo').value.trim();
    if (!nombre) { toast('Escribe un nombre.'); return; }
    if (S.modal.id) { Object.assign(per(S.modal.id), { nombre, cargo }); encolar({ kind: 'persona', method: 'PUT', path: '/personas/' + S.modal.id, body: { nombre, cargo } }); }
    else { const p = { id: uid(), nombre, cargo }; S.personas.push(p); encolar({ kind: 'persona', method: 'POST', path: '/personas', body: p }); }
    guardarLocal(); S.modal = null; renderModal(); renderOverlay();
  },
  'mp-borrar': () => {
    const p = per(S.modal.id);
    if (!confirm('¿Eliminar a ' + p.nombre + '? Sus notas quedarán sin asignar.')) return;
    S.personas = S.personas.filter(x => x.id !== p.id);
    for (const n of S.notas) if (n.persona_id === p.id) n.persona_id = null;
    encolar({ kind: 'persona', method: 'DELETE', path: '/personas/' + p.id });
    guardarLocal(); S.modal = null; renderModal(); renderOverlay(); renderBase();
  },
  'grupo-editar': (el) => { S.modal = { tipo: 'grupo', id: el.dataset.id }; renderModal(); },
  'grupo-mover': (el) => {
    const i = S.vistas.findIndex(v => v.id === el.dataset.id), j = i + Number(el.dataset.v);
    if (j < 0 || j >= S.vistas.length) return;
    [S.vistas[i], S.vistas[j]] = [S.vistas[j], S.vistas[i]];
    encolar({ kind: 'vista', method: 'PUT', path: '/vistas-orden', body: { ids: S.vistas.map(v => v.id) } });
    guardarLocal(); renderOverlay(); renderBase();
  },
  'mg-guardar': () => {
    const nombre = $('#mg-nombre').value.trim();
    if (!nombre) { toast('Ponle un nombre al grupo.'); return; }
    if (S.modal.id) {
      const v = S.vistas.find(x => x.id === S.modal.id); v.nombre = nombre;
      encolar({ kind: 'vista', method: 'PUT', path: '/vistas/' + v.id, body: { nombre, filtro: v.filtro } });
    } else {
      const v = { id: uid(), nombre, filtro: JSON.parse(JSON.stringify(S.ui.filtro)), orden: S.vistas.length + 1 };
      S.vistas.push(v); S.ui.vista = v.id;
      encolar({ kind: 'vista', method: 'POST', path: '/vistas', body: v });
      toast('Grupo «' + nombre + '» guardado');
    }
    guardarLocal(); guardarUi(); S.modal = null; renderModal(); renderBase(); if (ruta()) renderOverlay();
  },
  'mg-borrar': () => {
    const v = S.vistas.find(x => x.id === S.modal.id);
    if (!confirm('¿Eliminar el grupo «' + v.nombre + '»? Las notas no se borran.')) return;
    S.vistas = S.vistas.filter(x => x.id !== v.id);
    if (S.ui.vista === v.id) { S.ui.vista = null; }
    encolar({ kind: 'vista', method: 'DELETE', path: '/vistas/' + v.id });
    guardarLocal(); guardarUi(); S.modal = null; renderModal(); renderOverlay(); renderBase();
  },
  exportar: async () => {
    try {
      const txt = await api('/exportar');
      const blob = new Blob([typeof txt === 'string' ? txt : JSON.stringify(txt, null, 1)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'notas-copia-' + hoyYmd() + '.json'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) { toast(e.message); }
  },
};
function toggle(arr, v) { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); }
function cambioFiltro() { guardarUi(); renderBase(); renderOverlay(); }

document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act]');
  if (el && ACT[el.dataset.act]) {
    if (el.tagName === 'INPUT' && el.type === 'checkbox') { ACT[el.dataset.act](el, ev); return; }
    ev.preventDefault();
    ACT[el.dataset.act](el, ev);
    return;
  }
  const a = ev.target.closest('a[data-reemplazar]');
  if (a) { ev.preventDefault(); location.replace(a.getAttribute('href')); }
});

// Campos de texto: se guardan en el borrador sin volver a pintar (para no perder el cursor).
document.addEventListener('input', ev => {
  const t = ev.target;
  if (t.id === 'q' || t.id === 'qm') { S.ui.q = t.value; clearTimeout(S._qt); S._qt = setTimeout(() => { const pos = t.selectionStart, id = t.id; renderBase(); const n = $('#' + id); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }, 200); return; }
  if (t.id === 'hq') { S.ui.histQ = t.value; clearTimeout(S._hq); S._hq = setTimeout(() => { const pos = t.selectionStart; renderOverlay(); const n = $('#hq'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }, 250); return; }
  if (t.dataset.horaParte) {
    const { destino, valor } = leerSelectorHora(t);
    if (destino === 'ed' && S.ed) { S.ed.d.hora_limite = valor; pintarAvisos(); }
    else if (S.dic && S.dic.propuestas[destino]) S.dic.propuestas[destino].hora_limite = valor;
    return;
  }
  if (S.ed && t.dataset.chkT != null) { S.ed.d.checklist[Number(t.dataset.chkT)].t = t.value; return; }
  if (S.ed && t.dataset.chk != null) { S.ed.d.checklist[Number(t.dataset.chk)].hecho = t.checked; pintarChecklist(); return; }
  if (t.dataset.ed && S.ed) {
    S.ed.d[t.dataset.ed] = t.type === 'checkbox' ? t.checked : t.value;
    if (t.dataset.ed === 'cuerpo') onCuerpo(t);
    if (['fecha_limite', 'hora_limite', 'aviso_cant'].includes(t.dataset.ed)) pintarAvisos();
    if (['fecha_limite', 'repetir'].includes(t.dataset.ed)) { const p = $('#ed-repetir'); if (p) p.outerHTML = pistaRepetir(S.ed.d); }
    if (t.dataset.ed === 'duracion') S.ed.d.duracion = Number(t.value);
    return;
  }
  if (t.dataset.p != null && S.dic) {
    const p = S.dic.propuestas[t.dataset.p], f = t.dataset.f;
    if (f === 'incluir') { p.incluir = t.checked; renderOverlay(); return; }
    if (f === 'duracion') { p.duracion = Number(t.value); p.durDefecto = false; renderOverlay(); return; }
    if (f === 'checklist') { p.checklist = t.value.split('\n').map(x => ({ t: x, hecho: false })); return; }
    if (f === 'aviso') { const [u, c] = t.value.split(':'); p.aviso_unidad = u || ''; p.aviso_cant = Number(c) || 0; return; }
    if (f === 'add-tag') { if (t.value) { p.etiquetas.push(t.value); renderOverlay(); } return; }
    p[f] = t.value;
    if (f === 'prioridad') renderOverlay();
  }
});
document.addEventListener('change', ev => {
  const t = ev.target;
  if (t.dataset.ed && S.ed && t.type === 'checkbox') S.ed.d[t.dataset.ed] = t.checked;
  if (t.dataset.p != null && S.dic && (t.dataset.f === 'add-tag' || t.dataset.f === 'incluir')) return;
  if (t.dataset.fotos) { const files = [...t.files]; t.value = ''; anadirFotos(t.dataset.fotos, files); return; }
  if (t.matches('[data-grupo-vista]')) { S.ui.grupoVista = t.value; guardarUi(); renderBase(); return; }
  if (t.dataset.resumen) {
    if (t.dataset.resumen === 'activo') guardarResumen('activo', t.checked ? '1' : '0');
    else if (/^\d{2}:\d{2}$/.test(t.value)) guardarResumen('hora', t.value);
    return;
  }
  if (t.dataset.cal) {
    const c = cal();
    if (t.dataset.cal === 'horario') {
      const [a, b] = t.value.split('-');
      S.srv.cal_inicio = a; S.srv.cal_fin = b;
      encolar({ kind: 'config', method: 'PUT', path: '/config', body: { cal_inicio: a, cal_fin: b } });
      guardarLocal();
    } else { c[t.dataset.cal] = t.checked; guardarUi(); }
    renderBase();
    return;
  }
  if (t.id === 'rev-dia') {
    S.srv.revision_dia = t.value;
    encolar({ kind: 'config', method: 'PUT', path: '/config', body: { revision_dia: t.value } });
    guardarLocal(); renderBase(); toast('Revisión semanal: cada ' + DIAS_SEM[Number(t.value)]);
  }
});
function onCuerpo(ta) {
  const tok = tokenHash(ta);
  if (!tok) { if (S.ed.sug) { S.ed.sug = null; pintarSug(); } return; }
  S.ed.sug = { ...tok, lista: sugerencias(tok.q) };
  S.ed.sel = 0;
  pintarSug();
}
document.addEventListener('keydown', ev => {
  const t = ev.target;
  // Checklist: Enter añade un punto debajo; borrar en un punto vacío lo quita.
  if (S.ed && t.dataset && t.dataset.chkT != null) {
    const i = Number(t.dataset.chkT), l = S.ed.d.checklist;
    if (ev.key === 'Enter') { ev.preventDefault(); l.splice(i + 1, 0, { t: '', hecho: false }); pintarChecklist(i + 1); return; }
    if (ev.key === 'Backspace' && !t.value) { ev.preventDefault(); l.splice(i, 1); pintarChecklist(l.length ? Math.max(0, i - 1) : null); return; }
  }
  if (t.id === 'ed-cuerpo' && S.ed && S.ed.sug && S.ed.sug.lista.length) {
    const n = S.ed.sug.lista.length;
    if (ev.key === 'ArrowDown') { ev.preventDefault(); S.ed.sel = (S.ed.sel + 1) % n; pintarSug(); return; }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); S.ed.sel = (S.ed.sel - 1 + n) % n; pintarSug(); return; }
    if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); elegirSug(S.ed.sel); return; }
    if (ev.key === 'Escape') { ev.preventDefault(); S.ed.sug = null; pintarSug(); return; }
  }
  if (t.id === 'ed-cuerpo' && S.ed && (ev.key === ' ' || ev.key === 'Enter')) {
    // #Etiqueta existente escrita completa: se convierte en chip al pulsar espacio.
    const tok = tokenHash(t);
    if (tok && tok.q) {
      const e = S.etiquetas.find(x => norm(x.nombre) === norm(tok.q) && !x.cerrada);
      if (e) { ev.preventDefault(); S.ed.sug = { ...tok, lista: [{ tipo: 'e', e }] }; elegirSug(0); return; }
    }
  }
  if (ev.key === 'Escape') {
    if (S.modal) { S.modal = null; renderModal(); return; }
    if (ruta() && !(S.dic && (S.dic.fase === 'grabando' || S.dic.fase === 'pausa'))) cerrar();
  }
  if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter' && S.ed && ruta().startsWith('nota')) { ev.preventDefault(); guardarEditor(); }
});

// ---------- Rutas ----------
window.addEventListener('hashchange', () => {
  S._dentro = true;
  const r = ruta();
  if (!r.startsWith('nota')) S.ed = null;
  if (r !== 'revision') S.rev = null;
  if (r !== 'dictado' && S.dic && (S.dic.fase === 'grabando' || S.dic.fase === 'pausa')) cancelarGrabacion();
  if (r !== 'historial') S._archivos = null;
  S.modal = null; renderModal();
  renderOverlay();
});

// ---------- Arranque ----------
async function arrancar() {
  try {
    const [cfg, datos, ob, audios, ui, fp] = await Promise.all([idb.get('config'), idb.get('datos'), idb.get('outbox'), idb.get('audios'), idb.get('ui'), idb.get('fotos-pend')]);
    if (Array.isArray(fp)) S.fotosPend = fp;
    if (cfg) Object.assign(S.cfg, cfg);
    if (!S.cfg.dispositivo) S.cfg.dispositivo = nombrePorDefecto();
    if (datos) { S.notas = datos.notas || []; S.etiquetas = datos.etiquetas || []; S.personas = datos.personas || []; S.vistas = datos.vistas || []; S.srv = datos.srv || {}; }
    if (ob) { S.outbox = (ob.outbox || []).map(o => ({ ...o, enviando: false })); S.conflictos = ob.conflictos || []; }
    if (audios) S.audios = audios;
    if (ui) { S.ui.modo = MODOS.some(m => m[0] === ui.modo) ? ui.modo : 'lista'; S.ui.grupoVista = ui.grupoVista || ''; if (ui.cal) Object.assign(S.ui.cal, ui.cal, { ref: '' }); S.ui.agrupar = ui.agrupar || 'fecha'; S.ui.vista = ui.vista || null; S.ui.filtro = { ...filtroVacio(), ...(ui.filtro || {}) }; }
  } catch (e) { console.warn('Almacenamiento local no disponible', e); }
  renderBase();
  renderOverlay();
  limpiarAudios();
  if (!S.cfg.url && !ruta()) location.hash = '#/ajustes';
  sincronizar();
  setInterval(() => { if (document.visibilityState === 'visible') sincronizar(); }, 60000);
  setInterval(comprobarAlarmas, 20000);
  setInterval(() => { if (!ruta()) renderBase(); }, 5 * 60000);   // cambia "hoy" y "mañana" al pasar el día
}
window.addEventListener('online', () => { setSync('ok'); sincronizar(); });
window.addEventListener('offline', () => setSync('off', 'Sin conexión'));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { sincronizar(); comprobarAlarmas(); } });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw && nw.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          toast('Hay una versión nueva de la app.', { ms: 0, botones: [['Actualizar', () => nw.postMessage('activar')]] });
        }
      });
    });
  }).catch(() => {});
  let recargando = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!recargando) { recargando = true; location.reload(); } });
  navigator.serviceWorker.addEventListener('message', ev => {
    if (ev.data && ev.data.tipo === 'sync') sincronizar();
    if (ev.data && ev.data.tipo === 'abrir' && ev.data.url) location.hash = ev.data.url;
  });
}
arrancar();
