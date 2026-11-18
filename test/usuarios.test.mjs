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
ok(r.s === 200 && r.d.notas.length === 0 && r.d.vistas.length === 0, 'el usuario nuevo no ve las notas ni los grupos del principal');
ok(r.d.etiquetas.some(e => e.id === 'et_obra_yo') && r.d.personas.some(p => p.id === 'persona_yo_1'), 'fase 3: etiquetas y personas son comunes');
ok(r.d.usuarios.some(u => u.id === 'yo') && r.d.usuarios.some(u => u.id === idB), 'fase 3: /datos trae los usuarios para elegir responsables');
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
r = await b('PUT', '/etiquetas/et_obra_yo', { alias: 'la del centro' }); ok(r.s === 200 && r.d.etiqueta.alias === 'la del centro', 'fase 3: cualquiera puede corregir una etiqueta común');
r = await b('POST', '/etiquetas', { nombre: 'obraprueba1', tipo: 'obra' }); ok(r.s === 409, 'fase 3: no se repite un nombre del catálogo común');
r = await b('PUT', '/etiquetas/et_obra_yo', { cerrada: true }); ok(r.s === 403, 'fase 3: solo quien la creó o el administrador cierra una obra');
await b('PUT', '/personas/persona_yo_1', { nombre: 'Jefe de grupo', cargo: 'Estructura' });
ok((await db.prepare("SELECT cargo FROM personas WHERE id = 'persona_yo_1'").first()).cargo === 'Estructura', 'fase 3: cualquiera puede corregir una persona común');
r = await b('PUT', '/personas/persona_yo_1', { nombre: 'Jefe de grupo', usuario_vinculado: idB }); ok(r.s === 403, 'fase 3: solo el administrador vincula una persona a un usuario');
await b('PUT', '/vistas/vista_yo_1', { nombre: 'Cambiada', filtro: {} });
ok((await db.prepare("SELECT nombre FROM vistas WHERE id = 'vista_yo_1'").first()).nombre === 'Solo obra', 'no puede cambiar un grupo ajeno');
await b('PUT', '/vistas-orden', { ids: ['vista_yo_1'] });
await b('DELETE', '/etiquetas/et_obra_yo'); await b('DELETE', '/personas/persona_yo_1'); await b('DELETE', '/vistas/vista_yo_1');
r = await yo('GET', '/datos');
ok(r.d.etiquetas.some(e => e.id === 'et_obra_yo') && r.d.personas.some(p => p.id === 'persona_yo_1') && r.d.vistas.some(v => v.id === 'vista_yo_1'), 'no puede borrar etiquetas, personas ni grupos ajenos');
ok(r.d.notas.find(n => n.id === 'nota_yo_1').persona_id === 'persona_yo_1', 'la nota del principal conserva su responsable');
ok(r.d.notas.length === 3 && r.d.etiquetas.length === 1, 'el principal ve sus notas y el catálogo común sin cambios');
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

// ---------- Fase 3: notas compartidas por responsables ----------
r = await yo('POST', '/usuarios', { nombre: 'Tercero' }); const idC = r.d.usuario.id, c3 = llamar(r.d.token);
await yo('POST', '/push/suscribir', { ...sub('yo2'), nombre: 'Ordenador de Jorge' });
await c3('POST', '/push/suscribir', { ...sub('c'), nombre: 'Móvil del tercero' });
const notaDe = async (quien, id) => ((await quien('GET', '/datos')).d.notas || []).find(n => n.id === id);
pushes.length = 0;
r = await yo('POST', '/notas', { id: 'nota_comp_1', titulo: 'Hormigonar losa', prioridad: 'alta', etiquetas: ['et_obra_yo'],
  responsables: [{ tipo: 'usuario', id: idB }, { tipo: 'persona', id: 'persona_yo_1' }, { tipo: 'usuario', id: 'yo' }, { tipo: 'usuario', id: 'no_existe_99' }] });
ok(r.s === 200 && r.d.nota.responsables.length === 2 && r.d.nota.persona_id === 'persona_yo_1' && r.d.nota.usuario_id === 'yo',
  'una nota con varios responsables (sin el dueño ni usuarios que no existen); persona_id = primera persona');
ok(pushes.includes('/b') && !pushes.includes('/yo2') && !pushes.includes('/c'), 'aviso solo al responsable asignado (' + pushes.join(', ') + ')');
let nb = await notaDe(b2, 'nota_comp_1');
ok(nb && nb.usuario_id === 'yo' && nb.responsables.length === 2, 'el responsable ve la nota compartida y quién la creó');
ok(!(await notaDe(b2, 'nota_yo_1')), '…pero no las demás notas del dueño');
ok(!(await notaDe(c3, 'nota_comp_1')), 'quien no es responsable no la ve');
r = await b2('PUT', '/notas/nota_comp_1', { titulo: 'Hormigonar losa planta 2', prioridad: 'alta', base_version: nb.version });
ok(r.s === 200 && r.d.nota.titulo === 'Hormigonar losa planta 2', 'el responsable puede cambiarla');
ok((await notaDe(yo, 'nota_comp_1')).titulo === 'Hormigonar losa planta 2', 'el dueño ve el cambio');
r = await b2('PUT', '/notas/nota_comp_1', { titulo: 'x', estado: 'papelera' }); ok(r.s === 403, 'el responsable no puede enviarla a la papelera');
r = await b2('DELETE', '/notas/nota_comp_1'); ok(r.s === 403, 'el responsable no puede borrarla');
r = await b2('PUT', '/notas/nota_comp_1', { titulo: 'Hormigonar losa planta 2', base_version: 1 }); ok(r.s === 409 && r.d.conflicto, 'dos usuarios a la vez: el mismo control de conflictos que entre dispositivos');
// App antigua: solo persona_id → cambia la persona y se conservan los usuarios
r = await b2('PUT', '/notas/nota_comp_1', { titulo: 'Hormigonar losa planta 2', persona_id: null });
ok(r.d.nota.responsables.length === 1 && r.d.nota.responsables[0].id === idB && r.d.nota.persona_id === null, 'la app antigua (solo persona_id) no quita a los usuarios responsables');
// Darla por hecha
pushes.length = 0;
nb = await notaDe(b2, 'nota_comp_1');
r = await b2('PUT', '/notas/nota_comp_1', { titulo: nb.titulo, estado: 'realizada', base_version: nb.version });
ok(r.d.nota.estado === 'realizada' && r.d.nota.realizada_por === idB && r.d.nota.realizada_en, 'se guarda quién la dio por hecha y cuándo');
ok(pushes.includes('/yo2') && !pushes.includes('/b'), 'aviso de hecha al dueño, no a quien la marcó (' + pushes.join(', ') + ')');
const hist = await db.prepare("SELECT usuario_id, accion FROM cambios WHERE nota_id = 'nota_comp_1' AND accion = 'estado:realizada'").first();
ok(hist && hist.usuario_id === idB, 'el historial guarda quién la marcó');
// Registro de tareas hechas compartidas
await c3('POST', '/notas', { id: 'nota_c_sola', titulo: 'Privada del tercero', prioridad: 'normal', estado: 'realizada' });
await b2('POST', '/notas', { id: 'nota_b_con_c', titulo: 'Entre B y C', prioridad: 'normal', responsables: [{ tipo: 'usuario', id: idC }] });
nb = await notaDe(c3, 'nota_b_con_c');
await c3('PUT', '/notas/nota_b_con_c', { titulo: nb.titulo, estado: 'realizada', base_version: nb.version });
const reg = async quien => (await quien('GET', '/registro')).d;
let rg = await reg(yo);
ok(rg.todos === true && rg.notas.some(n => n.id === 'nota_comp_1' && n.realizada_por === idB) && rg.notas.some(n => n.id === 'nota_b_con_c' && n.realizada_por === idC),
  'registro: el administrador ve todas las compartidas hechas y quién dio el OK');
ok(!rg.notas.some(n => n.id === 'nota_c_sola' || n.id === 'nota_yo_3'), 'registro: las notas no compartidas no salen');
ok(rg.usuarios.some(u => u.id === idC), 'registro: trae los nombres de los usuarios');
rg = await reg(b2); ok(rg.todos === false && rg.notas.some(n => n.id === 'nota_comp_1') && rg.notas.some(n => n.id === 'nota_b_con_c'), 'registro: cada uno ve aquellas en las que participa');
rg = await reg(c3); ok(rg.notas.some(n => n.id === 'nota_b_con_c') && !rg.notas.some(n => n.id === 'nota_comp_1'), 'registro: no ve las de otros');
// Reabrir
nb = await notaDe(yo, 'nota_comp_1');
r = await yo('PUT', '/notas/nota_comp_1', { titulo: nb.titulo, estado: 'activa', base_version: nb.version });
ok(r.d.nota.estado === 'activa' && r.d.nota.realizada_por === null, 'al reabrirla se borra quién la hizo (queda en el historial)');
// Persona vinculada a una cuenta
r = await yo('POST', '/personas', { id: 'persona_de_c', nombre: 'Encargado tercero' });
await yo('POST', '/notas', { id: 'nota_para_c', titulo: 'Para el encargado', prioridad: 'normal', responsables: [{ tipo: 'persona', id: 'persona_de_c' }] });
ok(!(await notaDe(c3, 'nota_para_c')), 'una persona sin vincular no da acceso');
r = await yo('PUT', '/personas/persona_de_c', { nombre: 'Encargado tercero', usuario_vinculado: idC }); ok(r.s === 200 && r.d.persona.usuario_vinculado === idC, 'el administrador vincula una persona a una cuenta');
ok(await notaDe(c3, 'nota_para_c'), 'al vincularla, el usuario ve las notas en que esa persona es responsable');
// Avisos de fecha: a todos los que participan
pushes.length = 0;
await db.prepare("UPDATE notas SET alarma = ?, alarma_enviada = 0 WHERE id = 'nota_para_c'").bind(pasado).run();
await sched.scheduled({ cron: '* * * * *', scheduledTime: Date.now() });
ok(pushes.includes('/yo2') && pushes.includes('/c') && !pushes.includes('/b'), 'cron: el aviso de fecha llega al dueño y a los responsables (' + pushes.join(', ') + ')');
// Repeticiones: la siguiente es del dueño y con los mismos responsables, sin aviso de asignación
await yo('POST', '/notas', { id: 'nota_rep_1', titulo: 'Revisión semanal de andamios', prioridad: 'normal', fecha_limite: '2026-11-20', repetir: 'semanal', responsables: [{ tipo: 'usuario', id: idB }] });
nb = await notaDe(b2, 'nota_rep_1');
pushes.length = 0;
await b2('PUT', '/notas/nota_rep_1', { titulo: nb.titulo, estado: 'realizada', base_version: nb.version });
const sig = (await b2('GET', '/datos')).d.notas.find(n => n.serie === 'nota_rep_1' && n.estado === 'activa');
ok(sig && sig.usuario_id === 'yo' && sig.responsables.some(x => x.id === idB), 'la siguiente repetición es del dueño y la ve el responsable');
ok(!pushes.includes('/b'), 'la repetición no envía aviso de asignación');
// Quitarse a sí mismo de responsable
nb = await notaDe(b2, 'nota_comp_1');
r = await b2('PUT', '/notas/nota_comp_1', { titulo: nb.titulo, responsables: [], base_version: nb.version });
ok(r.s === 200 && r.d.nota.sin_acceso === true && !(await notaDe(b2, 'nota_comp_1')), 'quien se quita de responsable deja de ver la nota');
// Borrar una persona común: solo quien la creó o el administrador
r = await c3('DELETE', '/personas/persona_de_c'); ok(r.s === 403, 'otro usuario no puede borrar una persona común');
r = await yo('DELETE', '/personas/persona_de_c'); ok(r.s === 200 && !(await notaDe(c3, 'nota_para_c')), 'al borrar la persona desaparece de las notas y se deja de compartir');

await mf.dispose();
console.log('Pruebas de usuarios terminadas.');
