// Prueba de migraciones: ensureSchema se puede ejecutar varias veces sobre una base con datos
// sin cambiar nada. Es la base para las migraciones de la versión multiusuario (Fase 1).
// Datos inventados; nunca datos reales.
import { Miniflare } from 'miniflare';
import { readFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { isDeepStrictEqual } from 'util';
import { ESQUEMA_FASE0 } from './esquema-fase0.mjs';

const script = readFileSync(new URL('../worker/worker.js', import.meta.url), 'utf8');
let carpeta = mkdtempSync(join(tmpdir(), 'notas-migracion-'));   // D1 guardada en disco para reabrirla
const H = { Authorization: 'Bearer secreto', 'Content-Type': 'application/json', 'X-Dispositivo': 'Prueba migración' };
const ok = (c, m) => { if (!c) { console.error('FALLO:', m); process.exitCode = 1; } else console.log('ok -', m); };

// Cada instancia nueva del worker empieza con schemaOk = false, así que vuelve a ejecutar ensureSchema.
const abrir = () => new Miniflare({
  modules: true, script,
  d1Databases: ['DB'], d1Persist: carpeta, r2Buckets: ['FOTOS'],
  bindings: { APP_TOKEN: 'secreto', ALLOWED_ORIGIN: 'http://localhost:8080' },
});
async function call(mf, method, path, body) {
  const r = await mf.dispatchFetch('http://w' + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, d: await r.json() };
}
const TABLAS = ['notas', 'etiquetas', 'nota_etiquetas', 'personas', 'vistas', 'config', 'usuarios', 'config_usuario'];
async function foto(mf) {
  const db = await mf.getD1Database('DB');
  const out = {};
  for (const t of TABLAS) out[t] = (await db.prepare(`SELECT * FROM ${t} ORDER BY 1, 2`).all()).results;
  out.columnas = (await db.prepare('PRAGMA table_info(notas)').all()).results.map(c => c.name);
  return out;
}

try {
  // 1) Primera ejecución: crea el esquema actual. Después, datos de ejemplo inventados.
  let mf = abrir();
  let r = await call(mf, 'GET', '/estado'); ok(r.s === 200, 'primera ejecución de ensureSchema (base vacía)');
  await call(mf, 'POST', '/etiquetas', { id: 'et_obra', nombre: 'ObraEjemplo100', tipo: 'obra', alias: 'la de ejemplo' });
  await call(mf, 'POST', '/etiquetas', { id: 'et_ferralla', nombre: 'Ferralla', tipo: 'industrial' });
  await call(mf, 'POST', '/personas', { id: 'persona_ej_1', nombre: 'Encargado de prueba', cargo: 'Obra' });
  await call(mf, 'POST', '/vistas', { id: 'vista_ej_1', nombre: 'Solo obra', filtro: { etiquetas: ['et_obra'] } });
  const notas = [
    { id: 'nota_ej_1', titulo: 'Revisar armado de zapatas', cuerpo: 'Antes de hormigonar #ObraEjemplo100', prioridad: 'alta', etiquetas: ['et_obra', 'et_ferralla'], persona_id: 'persona_ej_1', fecha_limite: '2027-03-10', hora_limite: '09:30', aviso_unidad: 'd', aviso_cant: 2, duracion: 60 },
    { id: 'nota_ej_2', titulo: 'Pedir planos de instalaciones', prioridad: 'baja', checklist: ['Fontanería', 'Electricidad'], repetir: 'semanal', fecha_limite: '2027-03-12' },
    { id: 'nota_ej_3', titulo: 'Nota sin fecha', cuerpo: 'Texto con acentos: camión, grúa, año', prioridad: 'normal' },
  ];
  for (const n of notas) { r = await call(mf, 'POST', '/notas', n); ok(r.s === 200, 'crear nota de ejemplo ' + n.id); }
  r = await call(mf, 'PUT', '/notas/nota_ej_3', { ...notas[2], estado: 'realizada', base_version: 1 }); ok(r.s === 200, 'marcar una nota como realizada' + (r.s === 200 ? '' : ' ' + JSON.stringify(r.d)));
  const antes = await foto(mf);
  const datosAntes = (await call(mf, 'GET', '/datos')).d;
  await mf.dispose();
  ok(antes.notas.length === 3 && antes.etiquetas.length === 2 && antes.personas.length === 1 && antes.nota_etiquetas.length === 2, 'datos de ejemplo guardados');
  ok(antes.notas.some(n => n.id === 'nota_ej_3' && n.estado === 'realizada'), 'se conservan los ids elegidos y el estado realizado');

  // 2) y 3) Segunda y tercera ejecución de ensureSchema sobre la misma base: nada debe cambiar.
  for (const vez of ['segunda', 'tercera']) {
    mf = abrir();
    r = await call(mf, 'GET', '/estado'); ok(r.s === 200, `${vez} ejecución de ensureSchema sin errores`);
    const despues = await foto(mf);
    for (const t of TABLAS) ok(isDeepStrictEqual(antes[t], despues[t]), `${vez} ejecución: tabla ${t} idéntica (${despues[t].length} filas)`);
    ok(isDeepStrictEqual(antes.columnas, despues.columnas), `${vez} ejecución: columnas de notas sin cambios (${despues.columnas.length})`);
    const datos = (await call(mf, 'GET', '/datos')).d;
    ok(isDeepStrictEqual(
      { notas: datosAntes.notas, etiquetas: datosAntes.etiquetas, personas: datosAntes.personas, vistas: datosAntes.vistas },
      { notas: datos.notas, etiquetas: datos.etiquetas, personas: datos.personas, vistas: datos.vistas }), `${vez} ejecución: GET /datos devuelve lo mismo`);
    await mf.dispose();
  }
} finally {
  rmSync(carpeta, { recursive: true, force: true });
}

// ---------- Fase 4: migración desde el esquema EXACTO de producción (antes de los usuarios) ----------
// Base con las tablas de producción del 18/11/2026 y datos inventados; luego el worker nuevo arranca tres veces.
carpeta = mkdtempSync(join(tmpdir(), 'notas-migracion-fase0-'));
const VIEJAS = ['notas', 'etiquetas', 'nota_etiquetas', 'personas', 'vistas', 'config'];
const TODAS = [...VIEJAS, 'suscripciones', 'cambios', 'archivos', 'usuarios', 'config_usuario', 'nota_responsables'];
// Columnas que añaden las fases 3 y siguientes: en la base vieja no existen y nacen vacías.
const NUEVAS = ['realizada_por', 'usuario_vinculado'];
const sinNuevas = fs => fs.map(f => Object.fromEntries(Object.entries(f).filter(([k]) => !NUEVAS.includes(k))));
async function filas(mf, tablas) {
  const db = await mf.getD1Database('DB'), out = {};
  for (const t of tablas) out[t] = (await db.prepare(`SELECT * FROM ${t} ORDER BY 1, 2`).all()).results;
  return out;
}
try {
  let mf = abrir();
  const db = await mf.getD1Database('DB');
  for (const q of ESQUEMA_FASE0) await db.prepare(q).run();
  const t = '2026-11-01T08:00:00.000Z';
  await db.batch([
    db.prepare("INSERT INTO notas (id, titulo, cuerpo, prioridad, estado, persona_id, fecha_limite, hora_limite, creada, actualizada, version, checklist) VALUES ('nota_vieja_1', 'Pedir hormigón', 'Planta 3', 'alta', 'activa', 'persona_vieja', '2026-12-01', '08:30', ?, ?, 3, '[{\"t\":\"Uno\",\"hecho\":false}]')").bind(t, t),
    db.prepare("INSERT INTO notas (id, titulo, prioridad, estado, creada, actualizada) VALUES ('nota_vieja_2', 'Sin fecha', 'normal', 'realizada', ?, ?)").bind(t, t),
    db.prepare("INSERT INTO etiquetas (id, nombre, tipo, creada, actualizada) VALUES ('et_vieja_1', 'ObraVieja', 'obra', ?, ?)").bind(t, t),
    db.prepare("INSERT INTO nota_etiquetas (nota_id, etiqueta_id) VALUES ('nota_vieja_1', 'et_vieja_1')"),
    db.prepare("INSERT INTO personas (id, nombre, cargo, creada) VALUES ('persona_vieja', 'Encargado', 'Obra', ?)").bind(t),
    db.prepare("INSERT INTO vistas (id, nombre, filtro, orden) VALUES ('vista_vieja', 'Urgentes', '{}', 1)"),
    db.prepare("INSERT INTO cambios (nota_id, fecha, dispositivo, accion, antes) VALUES ('nota_vieja_1', ?, 'Móvil', 'crear', NULL)").bind(t),
    db.prepare("INSERT INTO suscripciones (id, endpoint, p256dh, auth, nombre, plataforma, activo, creada) VALUES ('sub_vieja_1', 'https://push.example/viejo', 'clave', 'auth', 'Móvil viejo', 'Android', 1, ?)").bind(t),
    db.prepare("INSERT INTO archivos (id, titulo, motivo, creado, notas, html) VALUES ('arch_viejo', 'Informe', 'Prueba', ?, 1, '<p>x</p>')").bind(t),
    db.prepare("INSERT INTO config (clave, valor) VALUES ('revision_dia', '4'), ('cal_inicio', '6'), ('resumen_hora', '06:45'), ('resumen_ultimo', '2026-11-17'), ('ultimo_diario', '2026-11-18')"),
  ]);
  const antes = await filas(mf, [...VIEJAS, 'suscripciones', 'cambios', 'archivos']);
  await mf.dispose();

  mf = abrir();
  let r = await call(mf, 'GET', '/estado'); ok(r.s === 200 && r.d.usuario && r.d.usuario.id === 'yo', 'Fase 4: el worker nuevo arranca sobre la base de producción y el APP_TOKEN es "yo"');
  const migrada = await filas(mf, TODAS);
  for (const t of VIEJAS) ok(isDeepStrictEqual(antes[t], sinNuevas(migrada[t])) && migrada[t].every(f => NUEVAS.every(k => f[k] == null)), `Fase 4: tabla ${t} sin cambios (${migrada[t].length} filas)`);
  ok(migrada.nota_responsables.length === 1 && migrada.nota_responsables[0].nota_id === 'nota_vieja_1' && migrada.nota_responsables[0].tipo === 'persona'
    && migrada.nota_responsables[0].ref_id === 'persona_vieja', 'Fase 3: el responsable de antes pasa a la lista de responsables');
  const sinUsuario = (fs) => fs.map(({ usuario_id, ...resto }) => resto);
  for (const t of ['suscripciones', 'cambios', 'archivos']) {
    ok(isDeepStrictEqual(antes[t], sinUsuario(migrada[t])) && migrada[t].every(f => f.usuario_id === 'yo'), `Fase 4: ${t} conserva sus datos y pasa a ser de "yo"`);
  }
  ok(migrada.usuarios.length === 1 && migrada.usuarios[0].id === 'yo' && migrada.usuarios[0].admin === 1 && !migrada.usuarios[0].token_hash, 'Fase 4: se crea el usuario principal, administrador y sin token guardado');
  const cu = Object.fromEntries(migrada.config_usuario.map(f => [f.clave, f.usuario_id + ':' + f.valor]));
  ok(cu.revision_dia === 'yo:4' && cu.cal_inicio === 'yo:6' && cu.resumen_hora === 'yo:06:45' && cu.resumen_ultimo === 'yo:2026-11-17' && !('ultimo_diario' in cu),
    'Fase 4: los ajustes de Jorge se copian a config_usuario (los globales no)');
  r = await call(mf, 'GET', '/datos');
  ok(r.d.notas.length === 2 && r.d.etiquetas.length === 1 && r.d.personas.length === 1 && r.d.vistas.length === 1 && r.d.config.cal_inicio === '6' && r.d.config.revision_dia === '4',
    'Fase 4: con el APP_TOKEN se ven las notas, etiquetas, personas, grupos y ajustes de antes');
  ok(r.d.notas.find(x => x.id === 'nota_vieja_1').etiquetas[0] === 'et_vieja_1' && r.d.notas.find(x => x.id === 'nota_vieja_1').version === 3, 'Fase 4: las notas conservan etiquetas y versión');
  ok(r.d.notas.find(x => x.id === 'nota_vieja_1').responsables[0].id === 'persona_vieja' && r.d.notas.find(x => x.id === 'nota_vieja_1').persona_id === 'persona_vieja', 'Fase 3: la nota conserva su responsable'); 
  r = await call(mf, 'GET', '/dispositivos'); ok(r.d.dispositivos.length === 1 && r.d.dispositivos[0].nombre === 'Móvil viejo', 'Fase 4: el dispositivo con avisos sigue siendo de Jorge');
  r = await call(mf, 'GET', '/archivos'); ok(r.d.archivos.length === 1, 'Fase 4: los informes archivados siguen siendo de Jorge');
  await mf.dispose();

  for (const vez of ['segunda', 'tercera']) {
    mf = abrir();
    r = await call(mf, 'GET', '/estado'); ok(r.s === 200, `Fase 4: ${vez} ejecución sin errores`);
    const otra = await filas(mf, TODAS);
    ok(TODAS.every(t => isDeepStrictEqual(migrada[t], otra[t])), `Fase 4: ${vez} ejecución no cambia ninguna tabla`);
    await mf.dispose();
  }
} finally {
  rmSync(carpeta, { recursive: true, force: true });
}
console.log('Pruebas de migración terminadas.');
