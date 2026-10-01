import { Miniflare } from 'miniflare';
import { readFileSync } from 'fs';
const mf = new Miniflare({
  modules: true, port: 8787,
  script: readFileSync(new URL('../worker/worker.js', import.meta.url), 'utf8'),
  d1Databases: ['DB'], d1Persist: false,
  bindings: { APP_TOKEN: 'secreto', ALLOWED_ORIGIN: 'http://localhost:8080', ANTHROPIC_API_KEY: 'k' },
  outboundService: async (req) => {
    const b = await req.json();
    const texto = b.messages[0].content;
    const notas = [
      { titulo: 'Confirmar hormigonado forjado 3', cuerpo: 'Llamar a la planta para confirmar el camión del jueves a las 8.', prioridad: 'critica', etiquetas: ['Mallorca245'], evidencias: [{ oido: 'la de Mallorca', etiqueta: 'Mallorca245' }], persona: 'Encargado', fecha_limite: '2026-10-01', alarma: '2026-09-30T07:30' },
      { titulo: 'Pedir presupuesto de bajantes', cuerpo: 'Al fontanero, para la fachada norte.', prioridad: 'normal', etiquetas: [], etiquetas_nuevas: [{ nombre: 'Fontaneria', similar: 'Instalaciones', oido: 'el fontanero' }], persona: '', fecha_limite: '', alarma: '' },
    ];
    return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'guardar_notas', input: { notas } }] }), { headers: { 'content-type': 'application/json' } });
  },
});
await mf.ready; console.log('worker listo');
