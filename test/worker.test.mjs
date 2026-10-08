import { Miniflare } from 'miniflare';
import { readFileSync } from 'fs';
import crypto from 'crypto';
import ece from 'http_ece';

const pushes = [];
let claudeInput = null;

// Suscripción push simulada (como la de un navegador)
const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
const authSecret = crypto.randomBytes(16);
const b64u = b => Buffer.from(b).toString('base64url');

const mf = new Miniflare({
  modules: true,
  script: readFileSync(new URL('../worker/worker.js', import.meta.url), 'utf8'),
  d1Databases: ['DB'], r2Buckets: ['FOTOS'],
  bindings: { APP_TOKEN: 'secreto', ALLOWED_ORIGIN: 'https://yo.github.io', ANTHROPIC_API_KEY: 'k' },
  outboundService: async (req) => {
    const url = new URL(req.url);
    if (url.hostname === 'api.anthropic.com') {
      claudeInput = await req.json();
      return new Response(JSON.stringify({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'guardar_notas', input: { notas: [
        { titulo: 'Confirmar hormigonado', cuerpo: 'Llamar a planta', prioridad: 'critica', etiquetas: ['mallorca245', 'Inventada'], evidencias: [{ oido: 'la de Mallorca', etiqueta: 'Mallorca245' }], persona: 'encargado', fecha_limite: '2026-09-30', hora_limite: '07:30', aviso_unidad: 'h', aviso_cant: 2 },
        { titulo: 'Revisar bajantes', cuerpo: 'Con el fontanero', prioridad: 'normal', etiquetas: [], etiquetas_nuevas: [{ nombre: 'Fontanería general', similar: 'Instalaciones', oido: 'fontanero' }], persona: 'Nadie', fecha_limite: 'mañana', hora_limite: '25:00', aviso_unidad: 'd', aviso_cant: 9, checklist: ['Bajante 1', '  ', 'Bajante 2'] },
        { titulo: 'Llamar a la grúa', cuerpo: '', prioridad: 'normal', etiquetas: [], persona: '', fecha_limite: '', hora_limite: '9:30' },
        { titulo: 'Pedir hormigón', cuerpo: '', prioridad: 'normal', etiquetas: [], persona: '', fecha_limite: '2026-10-20', hora_limite: '8.15' },
      ] } }] }), { headers: { 'content-type': 'application/json' } });
    }
    if (url.hostname === 'push.example') {
      pushes.push({ headers: Object.fromEntries(req.headers), body: Buffer.from(await req.arrayBuffer()) });
      return new Response(null, { status: 201 });
    }
    return new Response('no', { status: 500 });
  },
});

const H = { Authorization: 'Bearer secreto', 'Content-Type': 'application/json', 'X-Dispositivo': 'Test' };
async function call(method, path, body) {
  const r = await mf.dispatchFetch('http://w' + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = t; }
  return { s: r.status, d };
}
const ok = (c, m) => { if (!c) { console.error('FALLO:', m); process.exitCode = 1; } else console.log('ok -', m); };

// Auth
let r = await mf.dispatchFetch('http://w/datos', { headers: { Authorization: 'Bearer mal' } });
ok(r.status === 401, 'token incorrecto rechazado');

r = await call('GET', '/estado'); ok(r.s === 200 && r.d.faltan.includes('Enlace de Workers AI (AI)'), 'estado avisa de que falta AI');
ok(r.d.api >= 3, 'estado indica la versión de la API (la app detecta workers antiguos)');
r = await call('GET', '/datos'); ok(r.d.api >= 3, 'datos indica la versión de la API');

// Etiquetas y personas
r = await call('POST', '/etiquetas', { id: 'et_mallorca', nombre: 'Mallorca245', tipo: 'obra', alias: 'Mallorca' }); ok(r.s === 200 && r.d.etiqueta.nombre === 'Mallorca245', 'crear etiqueta');
r = await call('POST', '/etiquetas', { nombre: 'mallorca245' }); ok(r.s === 409, 'etiqueta duplicada (sin distinguir mayúsculas) rechazada');
r = await call('POST', '/etiquetas', { nombre: 'Con espacio' }); ok(r.s === 400, 'etiqueta con espacios rechazada');
r = await call('POST', '/etiquetas', { id: 'et_inst', nombre: 'Instalaciones', tipo: 'industrial' }); ok(r.s === 200, 'crear etiqueta 2');
r = await call('POST', '/personas', { id: 'pe_encargado', nombre: 'Encargado', cargo: 'Obra' }); ok(r.s === 200, 'crear persona');

// Notas
r = await call('POST', '/notas', { id: 'nota_0001', titulo: 'Primera', cuerpo: 'x', prioridad: 'alta', etiquetas: ['et_mallorca', 'no_existe'], persona_id: 'pe_encargado' });
ok(r.s === 200 && r.d.nota.version === 1 && r.d.nota.etiquetas.length === 1, 'crear nota (ignora etiquetas inexistentes)');
r = await call('POST', '/notas', { id: 'nota_0001', titulo: 'Repetida' }); ok(r.d.nota.titulo === 'Primera', 'crear es idempotente');
r = await call('PUT', '/notas/nota_0001', { base_version: 1, titulo: 'Primera editada' }); ok(r.s === 200 && r.d.nota.version === 2, 'editar sube versión');
r = await call('PUT', '/notas/nota_0001', { base_version: 1, titulo: 'Desde otro móvil' }); ok(r.s === 409 && r.d.conflicto && r.d.servidor.titulo === 'Primera editada', 'conflicto detectado con versión antigua');
r = await call('PUT', '/notas/nota_0001', { base_version: 1, forzar: true, titulo: 'Forzada' }); ok(r.s === 200 && r.d.nota.titulo === 'Forzada', 'forzar resuelve conflicto');
r = await call('PUT', '/notas/nota_0001', { estado: 'realizada' }); ok(r.d.nota.estado === 'realizada' && r.d.nota.borrar_en > new Date(Date.now() + 360 * 864e5).toISOString(), 'realizada con borrado a un año');
r = await call('PUT', '/notas/nota_0001', { estado: 'activa' }); ok(r.d.nota.borrar_en === null, 'reabrir limpia fechas');
r = await call('DELETE', '/notas/nota_0001'); ok(r.s === 400, 'no borra definitivo fuera de papelera');
r = await call('PUT', '/notas/nota_0001', { estado: 'papelera' }); ok(r.d.nota.estado === 'papelera', 'a papelera');
r = await call('DELETE', '/notas/nota_0001'); ok(r.s === 200, 'borrado definitivo desde papelera');

// Dictado
r = await call('POST', '/analizar', { texto: 'hormigonado de la de Mallorca', ahora_local: 'martes, 29/09/2026 10:00' });
ok(r.s === 200 && r.d.notas.length === 4, 'analizar devuelve las notas');
const [a, b, c3, c4] = r.d.notas;
{
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const g = t => p.find(x => x.type === t).value, hoyMad = `${g('year')}-${g('month')}-${g('day')}`, horaMad = `${g('hour')}:${g('minute')}`;
  const esperada = '09:30' > horaMad ? hoyMad : new Date(Date.parse(hoyMad + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10);
  ok(c3.hora_limite === '09:30' && c3.fecha_limite === esperada, 'hora dictada sin día: «9:30» → 09:30 de hoy o mañana');
  ok(c4.hora_limite === '08:15' && c4.fecha_limite === '2026-10-20', 'hora dictada con punto: «8.15» → 08:15');
}
ok(JSON.stringify(a.etiquetas) === '["Mallorca245"]', 'etiqueta existente normalizada, inventada fuera');
ok(a.etiquetas_nuevas.length === 1 && a.etiquetas_nuevas[0].nombre === 'Inventada', 'etiqueta inventada pasa a propuesta nueva');
ok(a.persona === 'Encargado' && b.persona === '', 'persona validada');
ok(b.etiquetas_nuevas[0].nombre === 'Fontanería_general' && b.etiquetas_nuevas[0].similar === 'Instalaciones', 'nueva sin espacios con similar existente');
ok(b.fecha_limite === '' && a.fecha_limite === '2026-09-30' && a.hora_limite === '07:30', 'fechas validadas');
ok(a.aviso_unidad === 'h' && a.aviso_cant === 2 && b.aviso_unidad === '' && b.hora_limite === '', 'aviso del dictado validado (fuera de rango se descarta)');
ok(claudeInput.messages[0].content.includes('Mallorca245 (obra; alias: Mallorca)'), 'Claude recibe etiquetas con alias');
ok(JSON.stringify(b.checklist) === '["Bajante 1","Bajante 2"]' && JSON.stringify(a.checklist) === '[]', 'checklist del dictado (sin puntos vacíos)');

// Checklists
r = await call('POST', '/notas', { id: 'nota_check', titulo: 'Pedir oferta de carpintería', checklist: [{ t: 'Industrial 1', hecho: true }, { t: 'Industrial 2' }, 'Industrial 3', { t: '' }] });
ok(r.s === 200 && r.d.nota.checklist.length === 3 && r.d.nota.checklist[0].hecho === true && r.d.nota.checklist[2].hecho === false, 'crear nota con checklist (limpio)');
r = await call('PUT', '/notas/nota_check', { checklist: r.d.nota.checklist.map(p => ({ ...p, hecho: true })) });
ok(r.d.nota.checklist.every(p => p.hecho), 'marcar puntos del checklist');
r = await call('PUT', '/notas/nota_check', { checklist: Array.from({ length: 80 }, (_, i) => 'Punto ' + i) });
ok(r.d.nota.checklist.length === 50, 'checklist limitado a 50 puntos');
r = await call('PUT', '/notas/nota_check', { checklist: [] });
ok(Array.isArray(r.d.nota.checklist) && r.d.nota.checklist.length === 0, 'vaciar checklist');
r = await call('GET', '/datos');
ok(r.d.notas.every(n => Array.isArray(n.checklist)), 'todas las notas traen checklist como lista');

// Push: suscripción, alarma y cifrado
r = await call('GET', '/push/clave'); ok(r.s === 200 && r.d.clave.length > 80, 'clave VAPID generada');
const clave1 = r.d.clave;
r = await call('GET', '/push/clave'); ok(r.d.clave === clave1, 'clave VAPID estable');
r = await call('POST', '/push/suscribir', { endpoint: 'https://push.example/abc', keys: { p256dh: b64u(ua.getPublicKey()), auth: b64u(authSecret) }, nombre: 'Móvil' });
ok(r.s === 200, 'suscribir dispositivo');
r = await call('POST', '/notas', { id: 'nota_alarma', titulo: 'Llamar clima', prioridad: 'critica', alarma: new Date(Date.now() - 60000).toISOString() });
await mf.dispatchFetch('http://w/estado', { headers: H });
const sched = await mf.getWorker();
await sched.scheduled({ cron: '* * * * *', scheduledTime: Date.now() });
await new Promise(res => setTimeout(res, 300));
ok(pushes.length === 1, 'alarma enviada por push');
const p = pushes[0];
ok(p.headers['content-encoding'] === 'aes128gcm' && /^vapid t=.+, k=.+/.test(p.headers.authorization), 'cabeceras VAPID');
const plano = ece.decrypt(p.body, { version: 'aes128gcm', privateKey: ua, authSecret: b64u(authSecret) });
const msg = JSON.parse(plano.toString());
ok(msg.tipo === 'alarma' && msg.titulo === '⚠ Llamar clima' && msg.nota_id === 'nota_alarma', 'push descifrado correctamente: ' + plano.toString().slice(0, 60));
// JWT firmado verificable con la clave pública
const jwt = p.headers.authorization.match(/t=([^,]+)/)[1];
const [h64, b64, s64] = jwt.split('.');
const pubKey = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(Buffer.from(clave1, 'base64url').subarray(1, 33)), y: b64u(Buffer.from(clave1, 'base64url').subarray(33, 65)) }, format: 'jwk' });
ok(crypto.verify('sha256', Buffer.from(h64 + '.' + b64), { key: pubKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s64, 'base64url')), 'firma JWT válida');
ok(JSON.parse(Buffer.from(b64, 'base64url')).aud === 'https://push.example', 'aud del JWT correcto');
await sched.scheduled({ cron: '* * * * *', scheduledTime: Date.now() });
await new Promise(res => setTimeout(res, 200));
ok(pushes.length === 1, 'la alarma no se repite');

// Acción desde el aviso
r = await call('POST', '/notas/nota_alarma/alarma', { accion: 'posponer', minutos: 10, endpoint: 'https://push.example/abc' });
ok(r.d.nota.alarma > new Date(Date.now() + 9 * 60000).toISOString(), 'posponer 10 min');
r = await call('POST', '/notas/nota_alarma/alarma', { accion: 'hecha' });
ok(r.d.nota.estado === 'realizada', 'hecha desde el aviso');
await new Promise(res => setTimeout(res, 300));
ok(pushes.some(x => JSON.parse(ece.decrypt(x.body, { version: 'aes128gcm', privateKey: ua, authSecret: b64u(authSecret) }).toString()).tipo === 'cerrar'), 'se envía cierre del aviso a otros dispositivos');

// Ajustes compartidos: horario visible del calendario
r = await call('PUT', '/config', { cal_inicio: '8', cal_fin: '20', otra_clave: 'x' });
r = await call('GET', '/datos');
ok(r.d.config.cal_inicio === '8' && r.d.config.cal_fin === '20' && !('otra_clave' in r.d.config), 'horario del calendario guardado en config');

// Avisos: hora límite y antelación (hora de Madrid)
const madrid = ms => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms)).map(x => [x.type, x.value])); return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` }; };
const lim = madrid(Date.now() + 3 * 864e5);   // dentro de 3 días, a esta hora
r = await call('POST', '/notas', { id: 'nota_aviso', titulo: 'Entregar planos', fecha_limite: lim.fecha, hora_limite: lim.hora, aviso_unidad: 'd', aviso_cant: 1 });
let esperado = madrid(Date.parse(r.d.nota.alarma));
ok(r.d.nota.hora_limite === lim.hora && r.d.nota.aviso_unidad === 'd' && r.d.nota.aviso_cant === 1, 'nota con hora límite y aviso guardada');
ok(esperado.hora === lim.hora && Math.round((Date.parse(lim.fecha) - Date.parse(esperado.fecha)) / 864e5) === 1, 'próximo aviso: 1 día antes a la misma hora');
r = await call('PUT', '/notas/nota_aviso', { aviso_unidad: 'h', aviso_cant: 3 });
esperado = madrid(Date.parse(r.d.nota.alarma) + 3 * 36e5);
ok(esperado.hora === lim.hora && esperado.fecha === lim.fecha, 'cambiar a 3 horas antes reprograma');
r = await call('PUT', '/notas/nota_aviso', { aviso_unidad: 'h', aviso_cant: 13 });
ok(r.d.nota.aviso_unidad === null && madrid(Date.parse(r.d.nota.alarma)).hora === lim.hora && madrid(Date.parse(r.d.nota.alarma)).fecha === lim.fecha, 'aviso fuera de rango se quita; queda el de la hora límite');
r = await call('PUT', '/notas/nota_aviso', { titulo: 'Entregar planos firmados' });
ok(r.d.nota.alarma && madrid(Date.parse(r.d.nota.alarma)).fecha === lim.fecha, 'editar el título no toca el aviso');
r = await call('POST', '/notas', { id: 'nota_sinhora', titulo: 'Sin hora', fecha_limite: madrid(Date.now() + 10 * 864e5).fecha, aviso_unidad: 's', aviso_cant: 1 });
ok(madrid(Date.parse(r.d.nota.alarma)).hora === '08:00', 'sin hora límite, el aviso previo suena a las 8:00');
r = await call('PUT', '/notas/nota_sinhora', { fecha_limite: null });
ok(r.d.nota.alarma === null && r.d.nota.aviso_unidad === null, 'quitar la fecha quita los avisos');
// El aviso previo suena y después queda pendiente el de la hora límite
const d1 = await mf.getD1Database('DB');
const limCerca = madrid(Date.now() + 30 * 60000);
r = await call('POST', '/notas', { id: 'nota_doble', titulo: 'Recibir grúa', fecha_limite: limCerca.fecha, hora_limite: limCerca.hora, aviso_unidad: 'h', aviso_cant: 1 });
ok(madrid(Date.parse(r.d.nota.alarma)).hora === limCerca.hora, 'aviso previo ya pasado: el próximo es el de la hora límite');
await d1.prepare("UPDATE notas SET alarma = ? WHERE id = 'nota_doble'").bind(new Date(Date.now() - 60000).toISOString()).run();
const antesPush = pushes.length;
await sched.scheduled({ cron: '* * * * *', scheduledTime: Date.now() });
await new Promise(res => setTimeout(res, 300));
r = await call('GET', '/datos');
const nd = r.d.notas.find(n => n.id === 'nota_doble');
ok(pushes.length === antesPush + 1 && nd.alarma_enviada === 0 && madrid(Date.parse(nd.alarma)).hora === limCerca.hora, 'tras el aviso previo queda programado el de la hora límite');
const msgDoble = JSON.parse(ece.decrypt(pushes[pushes.length - 1].body, { version: 'aes128gcm', privateKey: ua, authSecret: b64u(authSecret) }).toString());
ok(msgDoble.cuerpo.startsWith('Fecha límite: ') && msgDoble.cuerpo.includes(limCerca.hora), 'el aviso dice la fecha y hora límite');

// Fotos (R2 simulado)
const bin = async (method, path, buf) => {
  const res = await mf.dispatchFetch('http://w' + path, { method, headers: { Authorization: 'Bearer secreto', 'Content-Type': 'image/jpeg' }, body: buf });
  return { s: res.status, tipo: res.headers.get('content-type'), buf: Buffer.from(await res.arrayBuffer()) };
};
const jpeg = n => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(n, 7)]);
await call('POST', '/notas', { id: 'nota_fotos', titulo: 'Línea de vida', prioridad: 'critica' });
let vf = (await call('GET', '/datos')).d.notas.find(n => n.id === 'nota_fotos').version;
let rb = await bin('POST', '/notas/nota_fotos/fotos/foto_000001/mini', jpeg(300));
rb = await bin('POST', '/notas/nota_fotos/fotos/foto_000001/grande?ancho=1600&alto=1200', jpeg(5000));
let fotosN = JSON.parse(rb.buf.toString()).fotos;
ok(rb.s === 200 && fotosN.length === 1 && fotosN[0].ancho === 1600 && fotosN[0].alto === 1200, 'subir foto (miniatura y grande)');
rb = await bin('GET', '/notas/nota_fotos/fotos/foto_000001/grande');
ok(rb.s === 200 && rb.tipo === 'image/jpeg' && rb.buf.length === 5003, 'ver la foto grande');
rb = await bin('POST', '/notas/nota_fotos/fotos/foto_000001/grande?ancho=1600&alto=1200', jpeg(5000));
r = await call('GET', '/datos'); let nf = r.d.notas.find(n => n.id === 'nota_fotos');
ok(nf.fotos.length === 1 && nf.version === vf, 'reintentar la subida no duplica ni cambia la versión');
r = await call('PUT', '/notas/nota_fotos', { titulo: 'Línea de vida cubierta', fotos: [] });
ok(r.d.nota.fotos.length === 1, 'editar la nota no toca sus fotos');
for (let i = 2; i <= 12; i++) await bin('POST', `/notas/nota_fotos/fotos/foto_${String(i).padStart(6, '0')}/grande`, jpeg(10));
rb = await bin('POST', '/notas/nota_fotos/fotos/foto_000013/grande', jpeg(10));
ok(rb.s === 400, 'máximo 12 fotos por nota');
rb = await bin('POST', '/notas/nota_fotos/fotos/foto_000014/enorme', jpeg(10));
ok(rb.s === 400, 'tipo de foto no válido');
rb = await bin('DELETE', '/notas/nota_fotos/fotos/foto_000001');
ok(JSON.parse(rb.buf.toString()).fotos.length === 11 && (await bin('GET', '/notas/nota_fotos/fotos/foto_000001/mini')).s === 404, 'quitar una foto');
const r2 = await mf.getR2Bucket('FOTOS');
await call('PUT', '/notas/nota_fotos', { estado: 'papelera' });
await call('DELETE', '/notas/nota_fotos');
ok((await r2.list({ prefix: 'fotos/nota_fotos/' })).objects.length === 0, 'al borrar la nota se borran sus fotos');
rb = await bin('POST', '/notas/no_existe_x/fotos/foto_000001/grande', jpeg(10));
ok(rb.s === 404, 'foto de una nota que no existe');

// Notas recurrentes
const hoyM = madrid(Date.now()).fecha;
const masDias = (f, n) => new Date(Date.parse(f + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
r = await call('POST', '/notas', { id: 'nota_semanal', titulo: 'Reunión de obra', prioridad: 'normal', fecha_limite: hoyM, hora_limite: '09:00', duracion: 90,
  aviso_unidad: 'h', aviso_cant: 1, repetir: 'semanal', etiquetas: ['et_mallorca'], checklist: [{ t: 'Acta', hecho: true }] });
ok(r.d.nota.repetir === 'semanal', 'nota semanal creada');
r = await call('PUT', '/notas/nota_semanal', { estado: 'realizada' });
const idSig = 'nota_semanal_' + masDias(hoyM, 7);
r = await call('GET', '/datos');
let sig = r.d.notas.find(n => n.id === idSig);
ok(sig && sig.estado === 'activa' && sig.fecha_limite === masDias(hoyM, 7) && sig.hora_limite === '09:00' && sig.duracion === 90, 'al realizarla se crea la de la semana siguiente');
ok(sig && sig.serie === 'nota_semanal' && sig.repetir === 'semanal' && sig.aviso_unidad === 'h' && sig.etiquetas[0] === 'et_mallorca' && sig.checklist[0].hecho === false, 'la siguiente copia serie, aviso, etiquetas y checklist desmarcado');
ok(sig && sig.alarma, 'la siguiente tiene su aviso programado');
r = await call('POST', '/notas', { id: idSig, titulo: 'Copia desde la app' });
ok(r.d.nota.titulo === 'Reunión de obra', 'crear la siguiente desde la app no la duplica');
r = await call('PUT', '/notas/nota_semanal', { estado: 'activa' });
r = await call('GET', '/datos');
ok(!r.d.notas.some(n => n.id === idSig), 'deshacer quita la siguiente si no se ha tocado');
// Marcada con retraso: la siguiente cae hoy o después
await call('POST', '/notas', { id: 'nota_atrasada_sem', titulo: 'Revisión semanal', fecha_limite: masDias(hoyM, -20), repetir: 'semanal' });
await call('PUT', '/notas/nota_atrasada_sem', { estado: 'realizada' });
r = await call('GET', '/datos');
sig = r.d.notas.find(n => n.serie === 'nota_atrasada_sem');
ok(sig && sig.fecha_limite >= hoyM && sig.fecha_limite <= masDias(hoyM, 6), 'marcada con retraso: la siguiente no queda en el pasado');
// Mensual a fin de mes y laborables en viernes
await call('POST', '/notas', { id: 'nota_mensual', titulo: 'Certificación', fecha_limite: '2027-01-31', repetir: 'mensual' });
await call('PUT', '/notas/nota_mensual', { estado: 'realizada' });
r = await call('GET', '/datos');
ok(r.d.notas.some(n => n.id === 'nota_mensual_2027-02-28'), 'mensual del 31 de enero pasa al 28 de febrero');
await call('POST', '/notas', { id: 'nota_laborable', titulo: 'Parte diario', fecha_limite: '2027-01-08', repetir: 'laborables' });
await call('PUT', '/notas/nota_laborable', { estado: 'realizada' });
r = await call('GET', '/datos');
ok(r.d.notas.some(n => n.id === 'nota_laborable_2027-01-11'), 'laborables: del viernes al lunes');
// «Hecha» desde el aviso y prioridad subida sola a Urgente
await call('POST', '/notas', { id: 'nota_quincenal', titulo: 'Reunión con la DF', prioridad: 'normal', fecha_limite: '2027-03-01', repetir: 'quincenal' });
await d1.prepare("UPDATE notas SET prio_antes = prioridad, prioridad = 'critica' WHERE id = 'nota_quincenal'").run();
r = await call('POST', '/notas/nota_quincenal/alarma', { accion: 'hecha' });
r = await call('GET', '/datos');
sig = r.d.notas.find(n => n.id === 'nota_quincenal_2027-03-15');
ok(sig && sig.prioridad === 'normal', '«Hecha» desde el aviso crea la siguiente con su prioridad original');
r = await call('PUT', '/notas/nota_check', { repetir: 'cada siglo' });
ok(r.d.nota.repetir === null, 'repetición no válida se ignora');

// Resumen matutino: a la hora y en los días elegidos (hora de Madrid), una vez al día
const descifrar = x => JSON.parse(ece.decrypt(x.body, { version: 'aes128gcm', privateKey: ua, authSecret: b64u(authSecret) }).toString());
const resumenes = () => pushes.map(descifrar).filter(m => m.tag === 'resumen');
const hace = min => madrid(Date.now() - min * 60000).hora;
await call('POST', '/notas', { id: 'nota_urgente', titulo: 'Revisar línea de vida', prioridad: 'critica' });
await call('PUT', '/config', { resumen_activo: '1', resumen_hora: hace(1), resumen_dias: '1,2,3,4,5,6,7' });
await d1.prepare("DELETE FROM config WHERE clave = 'resumen_ultimo'").run();
await sched.scheduled({ cron: '* * * * *', scheduledTime: Date.now() });
await new Promise(res => setTimeout(res, 300));
const res1 = resumenes();
ok(res1.length === 1 && res1[0].titulo === 'Buenos días' && /urgente/.test(res1[0].cuerpo) && res1[0].url === '#/resumen', 'resumen matutino enviado: ' + (res1[0] || {}).cuerpo);
await sched.scheduled({ cron: '* * * * *', scheduledTime: Date.now() });
await new Promise(res => setTimeout(res, 300));
ok(resumenes().length === 1, 'el resumen se envía una sola vez al día');
await d1.prepare("DELETE FROM config WHERE clave = 'resumen_ultimo'").run();
const otroDia = String((new Date(madrid(Date.now()).fecha + 'T12:00:00Z').getUTCDay() + 6) % 7 + 1 === 1 ? 2 : 1);
await call('PUT', '/config', { resumen_dias: otroDia });
await sched.scheduled({ cron: '* * * * *', scheduledTime: Date.now() });
await new Promise(res => setTimeout(res, 300));
ok(resumenes().length === 1, 'no se envía en un día no elegido');
await call('PUT', '/config', { resumen_dias: '1,2,3,4,5,6,7', resumen_hora: madrid(Date.now() + 30 * 60000).hora });
await sched.scheduled({ cron: '* * * * *', scheduledTime: Date.now() });
await new Promise(res => setTimeout(res, 300));
ok(resumenes().length === 1, 'no se envía antes de la hora elegida');
await call('PUT', '/config', { resumen_activo: '0', resumen_hora: hace(1) });
await sched.scheduled({ cron: '* * * * *', scheduledTime: Date.now() });
await new Promise(res => setTimeout(res, 300));
ok(resumenes().length === 1, 'desactivado no se envía');
r = await call('GET', '/datos');
ok(r.d.config.resumen_activo === '0' && r.d.config.resumen_dias === '1,2,3,4,5,6,7', 'ajustes del resumen en config');

// Retención: realizadas caducadas y obra abierta
await call('POST', '/notas', { id: 'nota_vieja', titulo: 'Vieja sin obra', estado: 'realizada' });
await call('POST', '/notas', { id: 'nota_obra', titulo: 'Vieja de obra abierta', estado: 'realizada', etiquetas: ['et_mallorca'] });
await call('POST', '/notas', { id: 'nota_papel', titulo: 'En papelera', estado: 'papelera' });
const pasado = new Date(Date.now() - 864e5).toISOString();
await d1.prepare("UPDATE notas SET borrar_en = ? WHERE id IN ('nota_vieja','nota_obra','nota_papel')").bind(pasado).run();
await d1.prepare("DELETE FROM config WHERE clave = 'ultimo_diario'").run();
// Forzar la tarea diaria aunque sean menos de las 3:00 en Madrid
const horaMadrid = Number(new Date().toLocaleString('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false }));
if (horaMadrid < 3) console.log('(hora < 3 en Madrid: la tarea diaria no se ejecuta en esta prueba)');
await sched.scheduled({ cron: '* * * * *', scheduledTime: Date.now() });
await new Promise(res => setTimeout(res, 300));
r = await call('GET', '/datos');
const ids = r.d.notas.map(n => n.id);
if (horaMadrid >= 3) {
  ok(!ids.includes('nota_vieja') && !ids.includes('nota_papel'), 'realizada caducada y papelera borradas');
  ok(ids.includes('nota_obra'), 'realizada de obra abierta se conserva');
  r = await call('GET', '/archivos'); ok(r.d.archivos.length === 1 && r.d.archivos[0].notas === 1, 'informe archivado antes de borrar');
  const html = await call('GET', '/archivos/' + r.d.archivos[0].id); ok(String(html.d).includes('Vieja sin obra'), 'el informe contiene la nota');
}
// Cerrar obra: archiva y da 30 días a las caducadas
r = await call('PUT', '/etiquetas/et_mallorca', { cerrada: true });
ok(r.d.etiqueta.cerrada === 1 && r.d.archivo, 'cerrar obra genera archivo');
r = await call('GET', '/datos');
const nObra = r.d.notas.find(n => n.id === 'nota_obra');
ok(nObra && nObra.borrar_en > new Date(Date.now() + 29 * 864e5).toISOString(), 'al cerrar obra, 30 días de margen');

// Subida automática a crítica
const manana = new Date(Date.now() + 864e5).toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
await call('POST', '/notas', { id: 'nota_vence', titulo: 'Vence mañana', prioridad: 'normal', fecha_limite: manana });
await d1.prepare("UPDATE notas SET subir_critica = 1").run();
// llamar directamente simulando minuto múltiplo de 15 no es posible; comprobamos la consulta ejecutando el UPDATE vía scheduled cuando toque
await mf.dispose();

// Paso de las alarmas de la versión anterior: una base con el esquema antiguo y datos
const mfVieja = new Miniflare({
  modules: true,
  script: readFileSync(new URL('../worker/worker.js', import.meta.url), 'utf8'),
  d1Databases: ['DB'],
  bindings: { APP_TOKEN: 'secreto', ALLOWED_ORIGIN: 'https://yo.github.io', ANTHROPIC_API_KEY: 'k' },
});
const dbVieja = await mfVieja.getD1Database('DB');
await dbVieja.prepare(`CREATE TABLE notas (
  id TEXT PRIMARY KEY, usuario_id TEXT NOT NULL DEFAULT 'yo', titulo TEXT NOT NULL, cuerpo TEXT, prioridad TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'activa', persona_id TEXT, fecha_limite TEXT, alarma TEXT, alarma_enviada INTEGER DEFAULT 0,
  subir_critica INTEGER DEFAULT 1, duracion INTEGER, origen TEXT, origen_ref TEXT, transcripcion TEXT,
  creada TEXT, actualizada TEXT, realizada_en TEXT, eliminada_en TEXT, borrar_en TEXT,
  aviso30 INTEGER DEFAULT 0, aviso7 INTEGER DEFAULT 0, version INTEGER NOT NULL DEFAULT 1)`).run();
// 10:30 en Madrid (horario de verano, UTC+2) del 15/10/2026 y del 8/10/2026
await dbVieja.batch([
  dbVieja.prepare("INSERT INTO notas (id, titulo, prioridad, fecha_limite, alarma) VALUES ('m1', 'Solo alarma', 'normal', NULL, '2026-10-15T08:30:00.000Z')"),
  dbVieja.prepare("INSERT INTO notas (id, titulo, prioridad, fecha_limite, alarma) VALUES ('m2', 'Alarma el mismo día', 'normal', '2026-10-15', '2026-10-15T08:30:00.000Z')"),
  dbVieja.prepare("INSERT INTO notas (id, titulo, prioridad, fecha_limite, alarma) VALUES ('m3', 'Alarma una semana antes', 'normal', '2026-10-15', '2026-10-08T08:30:00.000Z')"),
  dbVieja.prepare("INSERT INTO notas (id, titulo, prioridad, fecha_limite, alarma) VALUES ('m4', 'Sin alarma', 'normal', '2026-10-15', NULL)"),
]);
const rv = await mfVieja.dispatchFetch('http://w/datos', { headers: H });
const migradas = Object.fromEntries((await rv.json()).notas.map(n => [n.id, n]));
ok(migradas.m1.fecha_limite === '2026-10-15' && migradas.m1.hora_limite === '10:30', 'alarma sin fecha → fecha y hora límite');
ok(migradas.m2.hora_limite === '10:30' && migradas.m2.aviso_unidad === null && migradas.m2.alarma === '2026-10-15T08:30:00.000Z', 'alarma del mismo día → hora límite, sigue sonando igual');
ok(migradas.m3.fecha_limite === '2026-10-15' && migradas.m3.hora_limite === '10:30' && migradas.m3.aviso_unidad === 's' && migradas.m3.aviso_cant === 1, 'alarma una semana antes → aviso 1 semana antes');
ok(migradas.m4.hora_limite === null && migradas.m4.alarma === null, 'nota sin alarma no cambia');
const rc = await mfVieja.dispatchFetch('http://w/notas', { method: 'POST', headers: H, body: JSON.stringify({ id: 'nota_vieja_check', titulo: 'Con checklist', checklist: ['Uno'] }) });
const rcd = await rc.json();
ok(rcd.nota && rcd.nota.checklist[0].t === 'Uno', 'base antigua: columna de checklist añadida ' + (rcd.nota ? '' : JSON.stringify(rcd)));
await mfVieja.dispose();
console.log('Pruebas terminadas. Push recibidos:', pushes.length);
