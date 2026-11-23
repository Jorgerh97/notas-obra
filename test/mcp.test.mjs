// 1.9.0: conector para Claude (MCP). Solo puede crear notas; no lee nada. Datos inventados.
import { Miniflare } from 'miniflare';
import { readFileSync } from 'fs';

const mf = new Miniflare({
  modules: true,
  script: readFileSync(new URL('../worker/worker.js', import.meta.url), 'utf8'),
  d1Databases: ['DB'], r2Buckets: ['FOTOS'],
  bindings: { APP_TOKEN: 'secreto', ALLOWED_ORIGIN: 'http://localhost:8080' },
  outboundService: async () => new Response(null, { status: 201 }),
});
const ok = (c, m) => { if (!c) { console.error('FALLO:', m); process.exitCode = 1; } else console.log('ok -', m); };
const llamar = token => async (method, path, body) => {
  const r = await mf.dispatchFetch('http://w' + path, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'X-Dispositivo': 'Prueba' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = t; }
  return { s: r.status, d };
};
const yo = llamar('secreto');
let idRpc = 0;
const mcp = async (ruta, method, params, sinId) => {
  const cuerpo = { jsonrpc: '2.0', method, ...(params ? { params } : {}), ...(sinId ? {} : { id: ++idRpc }) };
  const r = await mf.dispatchFetch('http://w' + ruta, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify(cuerpo) });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = t; }
  return { s: r.status, d };
};

// Catálogo de prueba
await yo('POST', '/etiquetas', { id: 'et_obra_mcp', nombre: 'Mallorca245', tipo: 'obra', alias: 'la de Mallorca, Mallorca' });
await yo('POST', '/personas', { id: 'per_gruista', nombre: 'Pere Gruista' });
let r = await yo('POST', '/usuarios', { nombre: 'Julián Prueba' });
const idJ = r.d.usuario.id, jul = llamar(r.d.token);
await yo('POST', '/notas', { id: 'nota_privada_1', titulo: 'Nota privada de Jorge', prioridad: 'alta' });

// ---------- Crear y anular la dirección ----------
r = await yo('GET', '/conector');
ok(r.s === 200 && r.d.activo === false, 'al principio no hay conector');
r = await yo('POST', '/conector');
ok(r.s === 200 && /^http:\/\/w\/mcp\/mc_[A-Za-z0-9_-]{40,}$/.test(r.d.url), 'crear el conector devuelve la dirección secreta');
const ruta = new URL(r.d.url).pathname;
r = await yo('GET', '/conector');
ok(r.d.activo === true && !JSON.stringify(r.d).includes('mc_'), 'el estado no vuelve a mostrar la clave');
r = await mf.dispatchFetch('http://w' + ruta, { method: 'GET' });
ok(r.status === 405, 'el conector solo admite POST');

// ---------- Protocolo ----------
r = await mcp(ruta, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'prueba', version: '1' } });
ok(r.s === 200 && r.d.result.protocolVersion === '2025-06-18' && r.d.result.capabilities.tools, 'initialize responde con la versión pedida y herramientas');
r = await mcp(ruta, 'notifications/initialized', null, true);
ok(r.s === 202, 'las notificaciones no tienen respuesta (202)');
r = await mcp(ruta, 'tools/list');
const tools = r.d.result.tools;
ok(tools.length === 1 && tools[0].name === 'crear_notas', 'solo hay una herramienta: crear_notas');
ok(/Hoy es \S+ \d{4}-\d{2}-\d{2}/.test(tools[0].description), 'la herramienta indica la fecha de hoy');
ok(!JSON.stringify(tools).includes('Mallorca245') && !JSON.stringify(tools).includes('Pere'), 'la lista de herramientas no revela etiquetas ni personas');
r = await mcp(ruta, 'tools/call', { name: 'leer_notas', arguments: {} });
ok(r.d.error && r.d.error.code === -32602, 'cualquier otra herramienta se rechaza');
r = await mcp(ruta, 'resources/list');
ok(r.d.result && r.d.result.resources.length === 0, 'no hay recursos que leer');

// ---------- Crear notas ----------
r = await mcp(ruta, 'tools/call', { name: 'crear_notas', arguments: { notas: [
  { titulo: 'Llamar al gruista', descripcion: 'Confirmar montaje', prioridad: 'urgente', fecha: '2030-05-14', hora: '9:30', etiquetas: ['la de Mallorca'], responsables: ['Pere'], aviso: { unidad: 'dias', cantidad: 1 }, duracion_minutos: 2880 },
  { titulo: 'Pedir ofertas de carpintería', etiquetas: ['#Mallorca245', 'Inventada'], responsables: ['Julián', 'Fulanito'], checklist: ['Roca', 'Vidal'] },
] } });
const texto = r.d.result.content[0].text;
ok(r.s === 200 && !r.d.result.isError && texto.startsWith('Creadas 2 notas'), 'crea dos notas y lo confirma');
ok(texto.includes('Inventada') && texto.includes('Fulanito') && texto.includes('no existe'), 'avisa de la etiqueta y el responsable que no existen');
ok(!texto.includes('Nota privada') && !texto.includes('nota_privada_1'), 'la respuesta no muestra otras notas');
r = await yo('GET', '/datos');
const n1 = r.d.notas.find(n => n.titulo === 'Llamar al gruista'), n2 = r.d.notas.find(n => n.titulo === 'Pedir ofertas de carpintería');
ok(n1 && n1.origen === 'claude' && n1.usuario_id === 'yo' && n1.prioridad === 'critica', 'la nota es del dueño de la clave, Urgente y con origen claude');
ok(n1.fecha_limite === '2030-05-14' && n1.hora_limite === '09:30' && n1.aviso_unidad === 'd' && n1.aviso_cant === 1 && n1.duracion === 2880 && n1.alarma, 'fecha, hora, aviso y duración');
ok(n1.etiquetas.includes('et_obra_mcp') && n1.responsables.some(x => x.tipo === 'persona' && x.id === 'per_gruista'), 'etiqueta por alias y persona por nombre de pila');
ok(n2.etiquetas.length === 1 && n2.responsables.length === 1 && n2.responsables[0].id === idJ && n2.checklist.length === 2, 'solo lo que existe; usuario de la app por nombre de pila; checklist');
r = await jul('GET', '/datos');
ok(r.d.notas.some(n => n.titulo === 'Pedir ofertas de carpintería') && !r.d.notas.some(n => n.titulo === 'Llamar al gruista'), 'el responsable con cuenta ve la nota compartida y no las demás');
r = await yo('GET', '/conector');
ok(r.d.notas === 2 && r.d.ultimo_uso, 'el estado cuenta las notas creadas y el último uso');
r = await mcp(ruta, 'tools/call', { name: 'crear_notas', arguments: { notas: [{ titulo: '' }] } });
ok(r.d.result.isError === true, 'sin título no se crea nada y se marca como error');

// ---------- Claves de cada usuario y anulación ----------
r = await jul('POST', '/conector');
const rutaJ = new URL(r.d.url).pathname;
await mcp(rutaJ, 'tools/call', { name: 'crear_notas', arguments: { notas: [{ titulo: 'Nota de Julián por Claude' }] } });
r = await jul('GET', '/datos');
ok(r.d.notas.some(n => n.titulo === 'Nota de Julián por Claude' && n.usuario_id === idJ), 'cada clave crea notas de su usuario');
r = await yo('POST', '/conector');
const ruta2 = new URL(r.d.url).pathname;
r = await mcp(ruta, 'tools/list');
ok(r.s === 404, 'al crear otra dirección, la anterior deja de funcionar');
r = await mcp(ruta2, 'tools/list');
ok(r.s === 200 && r.d.result.tools.length === 1, 'la nueva dirección funciona');
r = await yo('DELETE', '/conector');
r = await mcp(ruta2, 'tools/list');
ok(r.s === 404, 'desconectar anula la dirección');
r = await mcp('/mcp/mc_inventada_' + 'x'.repeat(30), 'tools/list');
ok(r.s === 404, 'una dirección inventada no funciona');
await yo('PUT', '/usuarios/' + idJ, { activo: false });
r = await mcp(rutaJ, 'tools/list');
ok(r.s === 404, 'un usuario desactivado no puede usar su conector');

console.log('Pruebas del conector terminadas.');
await mf.dispose();
