// Fase 4 (multiusuario): tokens personales y datos separados por usuario. Datos inventados.
import { Miniflare } from 'miniflare';
import { readFileSync } from 'fs';
import crypto from 'crypto';

const pushes = [];   // { destino } de cada aviso enviado
const mf = new Miniflare({
  modules: true,
  script: readFileSync(new URL('../worker/worker.js', import.meta.url), 'utf8'),
  d1Databases: ['DB'], r2Buckets: ['FOTOS'],
  bindings: { APP_TOKEN: 'secreto', ALLOWED_ORIGIN: 'http://localhost:8080' },
  outboundService: async (req) => {
    const url = new URL(req.url);
    if (url.hostname === 'push.example') { pushes.push(url.pathname); return new Response(null, { status: 201 }); }
    return new Response('no', { status: 500 });
  },
});
const db = await mf.getD1Database('DB');
const ok = (c, m) => { if (!c) { console.error('FALLO:', m); process.exitCode = 1; } else console.log('ok -', m); };
const llamar = token => async (method, path, body) => {
  const r = await mf.dispatchFetch('http://w' + path, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'X-Dispositivo': 'Prueba' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = t; }
  return { s: r.status, d };
};
const yo = llamar('secreto');
const sub = ruta => { const k = crypto.createECDH('prime256v1'); k.generateKeys();
  return { endpoint: 'https://push.example/' + ruta, keys: { p256dh: k.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') } }; };

// ---------- Usuario principal y alta de usuarios ----------
let r = await yo('GET', '/yo');
ok(r.s === 200 && r.d.usuario.id === 'yo' && r.d.usuario.admin === true, 'el APP_TOKEN es el usuario principal y es administrador');
r = await yo('POST', '/usuarios', { nombre: 'Encargado de prueba' });
ok(r.s === 200 && typeof r.d.token === 'string' && r.d.token.length >= 40 && r.d.usuario.admin === false, 'el administrador da de alta un usuario y recibe su token una sola vez');
const idB = r.d.usuario.id, tokenB = r.d.token;
const b = llamar(tokenB);
const filaB = await db.prepare('SELECT * FROM usuarios WHERE id = ?').bind(idB).first();
ok(filaB.token_hash && filaB.token_hash !== tokenB && !Object.values(filaB).includes(tokenB), 'el token no se guarda: solo su huella');
r = await b('GET', '/yo'); ok(r.s === 200 && r.d.usuario.id === idB && !r.d.usuario.admin, 'el usuario nuevo entra con su token');
r = await b('GET', '/usuarios'); ok(r.s === 403, 'un usuario normal no puede gestionar usuarios');
r = await b('POST', '/usuarios', { nombre: 'Intruso' }); ok(r.s === 403, 'un usuario normal no puede crear usuarios');
r = await llamar('mal')('GET', '/datos'); ok(r.s === 401, 'token corto rechazado');
r = await llamar('x'.repeat(43))('GET', '/datos'); ok(r.s === 401, 'token inventado rechazado');
r = await yo('GET', '/usuarios'); ok(r.s === 200 && r.d.usuarios.length === 2, 'el administrador ve la lista de usuarios');

// ---------- Datos de cada usuario ----------
await yo('POST', '/etiquetas', { id: 'et_obra_yo', nombre: 'ObraPrueba1', tipo: 'obra' });
await yo('POST', '/personas', { id: 'persona_yo_1', nombre: 'Jefe de grupo' });
await yo('POST', '/vistas', { id: 'vista_yo_1', nombre: 'Solo obra', filtro: { etiquetas: ['et_obra_yo'] } });
await yo('POST', '/notas', { id: 'nota_yo_1', titulo: 'Revisar replanteo', prioridad: 'alta', etiquetas: ['et_obra_yo'], persona_id: 'persona_yo_1' });
await yo('POST', '/notas', { id: 'nota_yo_2', titulo: 'Nota en la papelera', prioridad: 'normal' });
await yo('PUT', '/notas/nota_yo_2', { titulo: 'Nota en la papelera', prioridad: 'normal', estado: 'papelera', base_version: 1 });
await yo('POST', '/notas', { id: 'nota_yo_3', titulo: 'Realizada', prioridad: 'normal', estado: 'realizada' });
await yo('PUT', '/config', { resumen_hora: '07:00', cal_inicio: '7' });

r = await b('GET', '/datos');
ok(r.s === 200 && r.d.notas.length === 0 && r.d.etiquetas.length === 0 && r.d.personas.length === 0 && r.d.vistas.length === 0, 'el usuario nuevo no ve nada del principal');
ok(r.d.usuario && r.d.usuario.id === idB, '/datos indica de quién son los datos');
r = await b('PUT', '/notas/nota_yo_1', { titulo: 'Cambiada', base_version: 1 }); ok(r.s === 404, 'no puede editar una nota ajena');
r = await b('POST', '/notas', { id: 'nota_yo_1', titulo: 'Con el id de otro', prioridad: 'normal' }); ok(r.s === 409, 'no puede crear una nota con el id de otra ajena');
r = await b('POST', '/notas/nota_yo_1/alarma', { accion: 'hecha' }); ok(r.s === 404, 'no puede marcar hecha una nota ajena desde un aviso');
r = await b('DELETE', '/notas/nota_yo_2'); ok(r.s === 200, 'borrar una nota ajena no da error…');
r = await b('POST', '/papelera/vaciar'); ok(r.s === 200 && r.d.borradas === 0, 'vaciar su papelera no toca la ajena');
const papelera = await db.prepare("SELECT COUNT(*) AS n FROM notas WHERE id = 'nota_yo_2'").first();
ok(papelera.n === 1, '…y la nota ajena sigue existiendo');
const antesConservar = (await db.prepare("SELECT borrar_en FROM notas WHERE id = 'nota_yo_3'").first()).borrar_en;
await b('POST', '/notas/conservar', { ids: ['nota_yo_3'] });
ok((await db.prepare("SELECT borrar_en FROM notas WHERE id = 'nota_yo_3'").first()).borrar_en === antesConservar, 'no puede cambiar la conservación de notas ajenas');
r = await b('PUT', '/etiquetas/et_obra_yo', { nombre: 'Robada' }); ok(r.s === 404, 'no puede renombrar una etiqueta ajena');
r = await b('POST', '/etiquetas', { nombre: 'ObraPrueba1', tipo: 'obra' }); ok(r.s === 200, 'puede tener una etiqueta con el mismo nombre que otro usuario');
r = await b('POST', '/etiquetas', { id: 'et_obra_yo', nombre: 'OtraEtiqueta' }); ok(r.s === 200 && r.d.etiqueta.id !== 'et_obra_yo', 'una etiqueta nueva con un id ajeno recibe otro id');
await b('PUT', '/personas/persona_yo_1', { nombre: 'Cambiada' });
ok((await db.prepare("SELECT nombre, usuario_id FROM personas WHERE id = 'persona_yo_1'").first()).nombre === 'Jefe de grupo', 'no puede renombrar una persona ajena');
await b('PUT', '/vistas/vista_yo_1', { nombre: 'Cambiada', filtro: {} });
ok((await db.prepare("SELECT nombre FROM vistas WHERE id = 'vista_yo_1'").first()).nombre === 'Solo obra', 'no puede cambiar un grupo ajeno');
await b('PUT', '/vistas-orden', { ids: ['vista_yo_1'] });
await b('DELETE', '/etiquetas/et_obra_yo'); await b('DELETE', '/personas/persona_yo_1'); await b('DELETE', '/vistas/vista_yo_1');
r = await yo('GET', '/datos');
ok(r.d.etiquetas.some(e => e.id === 'et_obra_yo') && r.d.personas.some(p => p.id === 'persona_yo_1') && r.d.vistas.some(v => v.id === 'vista_yo_1'), 'no puede borrar etiquetas, personas ni grupos ajenos');
ok(r.d.notas.find(n => n.id === 'nota_yo_1').persona_id === 'persona_yo_1', 'la nota del principal conserva su responsable');
ok(r.d.notas.length === 3 && r.d.etiquetas.length === 1, 'el principal solo ve lo suyo');
r = await b('GET', '/notas/nota_yo_1/fotos/foto_xxxxxx/mini'); ok(r.s === 404, 'no puede ver fotos de una nota ajena');
r = await b('GET', '/exportar'); ok(r.d.notas.length === 0, 'la exportación solo lleva lo suyo');

// ---------- Ajustes de cada usuario ----------
await b('PUT', '/config', { resumen_hora: '09:15', cal_inicio: '6' });
r = await yo('GET', '/datos'); ok(r.d.config.resumen_hora === '07:00' && r.d.config.cal_inicio === '7', 'los ajustes del principal no cambian…');
r = await b('GET', '/datos'); ok(r.d.config.resumen_hora === '09:15' && r.d.config.cal_inicio === '6', '…y el otro usuario tiene los suyos');

// ---------- Dispositivos y avisos ----------
const subYo = sub('yo'), subB = sub('b');
r = await yo('POST', '/push/suscribir', { ...subYo, nombre: 'Móvil de Jorge' }); const idSubYo = r.d.id;
await b('POST', '/push/suscribir', { ...subB, nombre: 'Móvil del encargado' });
r = await b('GET', '/dispositivos'); ok(r.d.dispositivos.length === 1 && r.d.dispositivos[0].nombre === 'Móvil del encargado', 'cada usuario ve solo sus dispositivos');
await b('DELETE', '/dispositivos/' + idSubYo);
await b('PUT', '/dispositivos/' + idSubYo, { nombre: 'Cambiado' });
r = await yo('GET', '/dispositivos'); ok(r.d.dispositivos.length === 1 && r.d.dispositivos[0].nombre === 'Móvil de Jorge', 'no puede borrar ni renombrar dispositivos ajenos');
pushes.length = 0;
r = await b('POST', '/push/prueba'); ok(r.d.total === 1 && pushes.length === 1 && pushes[0] === '/b', 'el aviso de prueba solo llega a sus dispositivos');
r = await b('POST', '/push/prueba', { id: idSubYo }); ok(r.d.total === 0, 'no puede enviar avisos a un dispositivo ajeno');

// Avisos del cron: cada nota avisa solo a los dispositivos de su dueño
await b('POST', '/notas', { id: 'nota_b_1', titulo: 'Aviso del encargado', prioridad: 'normal' });
const pasado = new Date(Date.now() - 60000).toISOString();
await db.prepare("UPDATE notas SET alarma = ?, alarma_enviada = 0 WHERE id IN ('nota_yo_1', 'nota_b_1')").bind(pasado).run();
pushes.length = 0;
const sched = await mf.getWorker();
await sched.scheduled({ cron: '* * * * *', scheduledTime: Date.now() });
ok(pushes.filter(p => p === '/yo').length === 1 && pushes.filter(p => p === '/b').length === 1 && pushes.length === 2, 'cron: cada aviso va solo a los dispositivos del dueño de la nota (' + pushes.join(', ') + ')');

// Un mismo navegador que cambia de usuario pasa a ser del nuevo
await b('POST', '/push/suscribir', { ...subYo, nombre: 'Navegador compartido' });
r = await yo('GET', '/dispositivos'); ok(r.d.dispositivos.length === 0, 'un dispositivo que entra con otro token deja de ser del anterior');
r = await b('GET', '/dispositivos'); ok(r.d.dispositivos.length === 2, '…y pasa a ser del nuevo usuario');

// ---------- Desactivar y cambiar token ----------
r = await yo('PUT', '/usuarios/yo', { activo: false }); ok(r.s === 400, 'el usuario principal no se puede desactivar');
r = await yo('POST', '/usuarios/yo/token'); ok(r.s === 400, 'el token del principal no se cambia por aquí');
r = await yo('PUT', '/usuarios/' + idB, { activo: false }); ok(r.s === 200 && r.d.usuario.activo === false, 'el administrador desactiva un usuario');
r = await b('GET', '/datos'); ok(r.s === 401, 'un usuario desactivado ya no entra');
pushes.length = 0;
await db.prepare("UPDATE notas SET alarma = ?, alarma_enviada = 0 WHERE id = 'nota_b_1'").bind(pasado).run();
await sched.scheduled({ cron: '* * * * *', scheduledTime: Date.now() });
ok(pushes.length === 0, 'un usuario desactivado no recibe avisos');
await yo('PUT', '/usuarios/' + idB, { activo: true });
r = await b('GET', '/datos'); ok(r.s === 200 && r.d.notas.length === 1, 'al reactivarlo vuelve a entrar con sus datos');
r = await yo('POST', '/usuarios/' + idB + '/token'); const tokenB2 = r.d.token;
ok(r.s === 200 && tokenB2 && tokenB2 !== tokenB, 'el administrador genera un token nuevo');
r = await b('GET', '/datos'); ok(r.s === 401, 'el token antiguo deja de valer');
r = await llamar(tokenB2)('GET', '/datos'); ok(r.s === 200 && r.d.usuario.id === idB, 'el token nuevo entra como el mismo usuario');

// Historial con el usuario que hizo cada cambio
const cambios = await db.prepare("SELECT DISTINCT usuario_id FROM cambios WHERE nota_id = 'nota_b_1'").all();
ok(cambios.results.length === 1 && cambios.results[0].usuario_id === idB, 'el historial guarda qué usuario hizo cada cambio');

// ---------- Fase 2: permiso de dictado ----------
// En esta prueba no hay ANTHROPIC_API_KEY ni Workers AI: con permiso, la petición pasa y falla después
// por falta de configuración (500); sin permiso, se rechaza antes (403) sin gastar nada.
const b2 = llamar(tokenB2);
r = await yo('GET', '/yo'); ok(r.d.usuario.puede_dictar === true, 'el usuario principal puede dictar');
r = await b2('GET', '/yo'); ok(r.d.usuario.puede_dictar === false, 'un usuario nuevo empieza sin permiso de dictado');
r = await b2('GET', '/datos'); ok(r.d.usuario.puede_dictar === false, '/datos indica el permiso de dictado (la app oculta Dictar)');
r = await b2('POST', '/analizar', { texto: 'Llamar al gruista mañana' }); ok(r.s === 403 && r.d.sin_permiso === 'dictar', 'sin permiso no puede analizar dictados');
r = await mf.dispatchFetch('http://w/transcribir', { method: 'POST', headers: { Authorization: 'Bearer ' + tokenB2, 'Content-Type': 'audio/webm' }, body: new Uint8Array([1, 2, 3]) });
ok(r.status === 403, 'sin permiso no puede transcribir audio');
r = await yo('POST', '/analizar', { texto: 'Llamar al gruista mañana' }); ok(r.s === 500 && /ANTHROPIC_API_KEY/.test(r.d.error), 'el principal pasa el permiso (aquí falla solo por no tener clave)');
r = await yo('PUT', '/usuarios/yo', { puede_dictar: false }); ok(r.s === 400, 'al usuario principal no se le puede quitar el dictado');
r = await yo('PUT', '/usuarios/' + idB, { puede_dictar: true }); ok(r.s === 200 && r.d.usuario.puede_dictar === true, 'el administrador da permiso de dictado');
r = await b2('POST', '/analizar', { texto: 'Llamar al gruista mañana' }); ok(r.s === 500 && /ANTHROPIC_API_KEY/.test(r.d.error), 'con permiso ya pasa la comprobación');
r = await yo('PUT', '/usuarios/' + idB, { nombre: 'Encargado renombrado' }); ok(r.d.usuario.puede_dictar === true, 'cambiar el nombre no quita el permiso');
r = await yo('PUT', '/usuarios/' + idB, { puede_dictar: false }); ok(r.d.usuario.puede_dictar === false, 'el administrador quita el permiso');
r = await b2('POST', '/analizar', { texto: 'x' }); ok(r.s === 403, 'y vuelve a rechazarse');
r = await b2('PUT', '/usuarios/' + idB, { puede_dictar: true }); ok(r.s === 403, 'un usuario no puede darse permiso a sí mismo');
r = await yo('POST', '/usuarios', { nombre: 'Con dictado', puede_dictar: true }); ok(r.d.usuario.puede_dictar === true, 'se puede dar de alta un usuario ya con permiso de dictado');

await mf.dispose();
console.log('Pruebas de usuarios terminadas.');
