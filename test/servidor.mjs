import { Miniflare } from 'miniflare';
import { readFileSync } from 'fs';
const mf = new Miniflare({
  modules: true, port: 8787,
  script: readFileSync(new URL('../worker/worker.js', import.meta.url), 'utf8'),
  d1Databases: ['DB'], d1Persist: false, r2Buckets: ['FOTOS'], r2Persist: false,
  bindings: { APP_TOKEN: 'secreto', ALLOWED_ORIGIN: 'http://localhost:8080', ANTHROPIC_API_KEY: 'k' },
  outboundService: async (req) => {
    const b = await req.json();
    const texto = b.messages[0].content;
    const notas = [
      { titulo: 'Confirmar hormigonado forjado 3', cuerpo: 'Llamar a la planta para confirmar el camión del jueves a las 8.', prioridad: 'critica', etiquetas: ['Mallorca245'], evidencias: [{ oido: 'la de Mallorca', etiqueta: 'Mallorca245' }], persona: 'Encargado', fecha_limite: '2026-10-01', hora_limite: '07:30', aviso_unidad: 'h', aviso_cant: 1 },
      { titulo: 'Pedir presupuesto de bajantes', cuerpo: 'Al fontanero, para la fachada norte.', prioridad: 'normal', etiquetas: [], etiquetas_nuevas: [{ nombre: 'Fontaneria', similar: 'Instalaciones', oido: 'el fontanero' }], persona: '', fecha_limite: '', checklist: ['Bajante norte', 'Bajante patio'] },
      { titulo: 'Reunión de obra', cuerpo: 'Con la DF y el encargado.', prioridad: 'normal', etiquetas: [], persona: '', fecha_limite: '2026-10-05', hora_limite: '09:00', duracion: 90, repetir: 'semanal' },
    ];
    return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'guardar_notas', input: { notas } }] }), { headers: { 'content-type': 'application/json' } });
  },
});
await mf.ready; console.log('worker listo');
