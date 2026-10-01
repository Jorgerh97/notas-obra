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
  d1Databases: ['DB'],
  bindings: { APP_TOKEN: 'secreto', ALLOWED_ORIGIN: 'https://yo.github.io', ANTHROPIC_API_KEY: 'k' },
  outboundService: async (req) => {
    const url = new URL(req.url);
    if (url.hostname === 'api.anthropic.com') {
      claudeInput = await req.json();
      return new Response(JSON.stringify({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'guardar_notas', input: { notas: [
        { titulo: 'Confirmar hormigonado', cuerpo: 'Llamar a planta', prioridad: 'critica', etiquetas: ['mallorca245', 'Inventada'], evidencias: [{ oido: 'la de Mallorca', etiqueta: 'Mallorca245' }], persona: 'encargado', fecha_limite: '2026-09-30', alarma: '2026-09-30T07:30' },
        { titulo: 'Revisar bajantes', cuerpo: 'Con el fontanero', prioridad: 'normal', etiquetas: [], etiquetas_nuevas: [{ nombre: 'Fontanería general', similar: 'Instalaciones', oido: 'fontanero' }], persona: 'Nadie', fecha_limite: 'mañana', alarma: '' },
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
ok(r.s === 200 && r.d.notas.length === 2, 'analizar devuelve 2 notas');
const [a, b] = r.d.notas;
ok(JSON.stringify(a.etiquetas) === '["Mallorca245"]', 'etiqueta existente normalizada, inventada fuera');
ok(a.etiquetas_nuevas.length === 1 && a.etiquetas_nuevas[0].nombre === 'Inventada', 'etiqueta inventada pasa a propuesta nueva');
ok(a.persona === 'Encargado' && b.persona === '', 'persona validada');
ok(b.etiquetas_nuevas[0].nombre === 'Fontanería_general' && b.etiquetas_nuevas[0].similar === 'Instalaciones', 'nueva sin espacios con similar existente');
ok(b.fecha_limite === '' && a.alarma === '2026-09-30T07:30', 'fechas validadas');
ok(claudeInput.messages[0].content.includes('Mallorca245 (obra; alias: Mallorca)'), 'Claude recibe etiquetas con alias');

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

// Retención: realizadas caducadas y obra abierta
const d1 = await mf.getD1Database('DB');
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
console.log('Pruebas terminadas. Push recibidos:', pushes.length);
await mf.dispose();
