// Prueba de migraciones: ensureSchema se puede ejecutar varias veces sobre una base con datos
// sin cambiar nada. Es la base para las migraciones de la versión multiusuario (Fase 1).
// Datos inventados; nunca datos reales.
import { Miniflare } from 'miniflare';
import { readFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { isDeepStrictEqual } from 'util';

const script = readFileSync(new URL('../worker/worker.js', import.meta.url), 'utf8');
const carpeta = mkdtempSync(join(tmpdir(), 'notas-migracion-'));   // D1 guardada en disco para reabrirla
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
const TABLAS = ['notas', 'etiquetas', 'nota_etiquetas', 'personas', 'vistas', 'config'];
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
console.log('Pruebas de migración terminadas.');
