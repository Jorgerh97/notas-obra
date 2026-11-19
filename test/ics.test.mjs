// Importar calendarios (.ics): lector de eventos de la app con un calendario de ejemplo inventado al estilo de Outlook.
// Se carga el trozo «Importar calendario (.ics)» de app/app.js (la app no tiene módulos) con lo mínimo que necesita.
import { readFileSync } from 'fs';

const app = readFileSync(new URL('../app/app.js', import.meta.url), 'utf8');
const ini = app.indexOf('// ---------- Importar calendario (.ics) ----------'), fin = app.indexOf('// ---------- fin calendario ----------');
const fechaSiguiente = app.match(/function fechaSiguiente[\s\S]*?\n}\n/)[0];
const ayudas = ['ymd', 'addDias'].map(n => app.match(new RegExp('^const ' + n + ' = .*$', 'm'))[0]).join('\n');
const ok = (c, m) => { if (!c) { console.error('FALLO:', m); process.exitCode = 1; } else console.log('ok -', m); };
const HOY = '2026-11-19';
const cargar = new Function('S', `const uid = () => Math.random().toString(36).slice(2); const hoyYmd = () => '${HOY}'; const DURACION_DEF = 10;
  ${ayudas}\n${fechaSiguiente}\n${app.slice(ini, fin)}\nreturn { propuestasIcs, leerIcs, icsFecha };`);

const ev = (lineas) => ['BEGIN:VEVENT', ...lineas, 'END:VEVENT'].join('\r\n');
const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Microsoft Corporation//Outlook 16.0 MIMEDIR//EN',
  ev(['UID:evento-1', 'SUMMARY:Reunión con la DF\\, obra 605\\; planta 2', 'DTSTART;TZID="Romance Standard Time":20261125T090000',
    'DTEND;TZID="Romance Standard Time":20261125T103000', 'LOCATION:Caseta de obra',
    'DESCRIPTION:Revisar armados del forjado\\npendientes de la ', ' semana pasada\\n\\n________________________________________________\\nReunión de Microsoft Teams\\nUnirse: https://teams.example/xyz',
    'BEGIN:VALARM', 'TRIGGER:-PT15M', 'ACTION:DISPLAY', 'END:VALARM']),
  ev(['UID:evento-2', 'SUMMARY:Llamar a la central de hormigón', 'DTSTART:20261126T080000Z', 'DTEND:20261126T081500Z']),
  ev(['UID:evento-3', 'SUMMARY:Inspección de la propiedad', 'DTSTART;VALUE=DATE:20261127', 'DTEND;VALUE=DATE:20261128',
    'BEGIN:VALARM', 'TRIGGER:-PT15H', 'END:VALARM']),
  ev(['UID:evento-pasado', 'SUMMARY:Ya pasó', 'DTSTART;TZID=Romance Standard Time:20261101T090000']),
  ev(['UID:evento-semanal', 'SUMMARY:Reunión semanal de obra', 'DTSTART;TZID=Europe/Madrid:20261005T080000', 'DTEND;TZID=Europe/Madrid:20261005T090000',
    'RRULE:FREQ=WEEKLY;BYDAY=MO', 'BEGIN:VALARM', 'TRIGGER:-PT1H', 'END:VALARM']),
  ev(['UID:evento-cancelado', 'SUMMARY:Cancelado: Visita', 'STATUS:CANCELLED', 'DTSTART:20261130T090000Z']),
  ev(['UID:evento-semanal', 'RECURRENCE-ID;TZID=Europe/Madrid:20261123T080000', 'SUMMARY:Reunión semanal (movida)', 'DTSTART;TZID=Europe/Madrid:20261123T100000']),
  ev(['UID:evento-laborables', 'SUMMARY:Parte diario', 'DTSTART;TZID=Romance Standard Time:20261102T183000', 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR']),
  ev(['UID:evento-anual', 'SUMMARY:Revisión anual de la grúa', 'DTSTART;VALUE=DATE:20261215', 'RRULE:FREQ=YEARLY']),
  ev(['UID:serie-terminada', 'SUMMARY:Serie acabada', 'DTSTART;TZID=Europe/Madrid:20261001T090000', 'RRULE:FREQ=WEEKLY;UNTIL=20261031T080000Z']),
  ev(['UID:ya-importado', 'SUMMARY:Ya está en la app', 'DTSTART:20261201T090000Z']),
  ev(['UID:zona-rara', 'SUMMARY:Zona desconocida', 'DTSTART;TZID=Base de Marte:20261202T090000']),
  ev(['UID:verano', 'SUMMARY:Entrega en verano', 'DTSTART;TZID=Romance Standard Time:20270615T090000', 'BEGIN:VALARM', 'TRIGGER:-P2D', 'END:VALARM']),
  ev(['UID:mensual', 'SUMMARY:Certificación', 'DTSTART;VALUE=DATE:20261222', 'RRULE:FREQ=MONTHLY;BYMONTHDAY=22']),
  'END:VCALENDAR'].join('\r\n');

const S = { notas: [{ origen: 'ics', origen_ref: 'ics:ya-importado', estado: 'activa' }] };
const { propuestasIcs, leerIcs } = cargar(S);
ok(leerIcs(ics).length === 14, 'lee los 14 eventos (líneas partidas incluidas)');
const { propuestas, omitidos } = propuestasIcs(ics, 'calendario.ics');
const p = uid => propuestas.find(x => x.origen_ref === 'ics:' + uid);

const e1 = p('evento-1');
ok(e1 && e1.titulo === 'Reunión con la DF, obra 605; planta 2', 'título con comas y puntos y coma escapados');
ok(e1.fecha_limite === '2026-11-25' && e1.hora_limite === '09:00' && e1.duracion === 90, 'zona de Windows (Romance Standard Time): fecha, hora y duración');
ok(e1.cuerpo === 'Lugar: Caseta de obra\nRevisar armados del forjado\npendientes de la semana pasada', 'descripción con lugar, líneas unidas y sin el bloque de Teams: ' + JSON.stringify(e1.cuerpo));
ok(e1.aviso_unidad === '' && e1.info.some(t => /15 min/.test(t)), 'un recordatorio de 15 min no es aviso previo (ya avisa a la hora) y se explica');
ok(e1.origen === 'ics' && e1.prioridad === 'normal' && e1.incluir && e1.donde.startsWith('calendario.ics · 25/11/2026 09:00'), 'origen ics, prioridad normal, incluida y de qué archivo viene');
const e2 = p('evento-2');
ok(e2.hora_limite === '09:00' && e2.duracion === 15, 'hora en UTC pasada a la de Madrid (invierno, +1)');
const e3 = p('evento-3');
ok(e3.fecha_limite === '2026-11-27' && e3.hora_limite === '' && e3.aviso_unidad === 'd' && e3.aviso_cant === 1 && e3.durDefecto, 'evento de todo el día: sin hora, recordatorio de 15 h → aviso 1 día antes');
const sem = p('evento-semanal');
ok(sem && sem.repetir === 'semanal' && sem.fecha_limite === '2026-11-23' && sem.hora_limite === '08:00' && sem.aviso_unidad === 'h' && sem.aviso_cant === 1,
  'serie semanal empezada en el pasado: se importa la próxima (lunes 23/11) con aviso 1 hora antes');
ok(propuestas.filter(x => x.origen_ref === 'ics:evento-semanal').length === 1, 'el cambio de una sola repetición no crea otra nota');
const lab = p('evento-laborables');
ok(lab.repetir === 'laborables' && lab.fecha_limite === '2026-11-19' && lab.hora_limite === '18:30', 'de lunes a viernes → laborables, desde hoy');
const anual = p('evento-anual');
ok(anual.repetir === '' && anual.fecha_limite === '2026-12-15' && anual.info.some(t => /no admite/.test(t)), 'repetición anual no admitida: se importa la próxima y se avisa');
ok(p('mensual').repetir === 'mensual', 'repetición mensual');
const rara = p('zona-rara');
ok(rara.hora_limite === '09:00' && rara.avisos.some(t => /desconocida/.test(t)), 'zona horaria desconocida: hora tal cual y aviso en naranja');
const ver = p('verano');
ok(ver.hora_limite === '09:00' && ver.aviso_unidad === 'd' && ver.aviso_cant === 2, 'horario de verano y aviso de 2 días');
ok(!p('evento-pasado') && !p('serie-terminada') && !p('evento-cancelado') && !p('ya-importado'), 'no se importan pasados, series acabadas, cancelados ni ya importados');
ok(omitidos.pasados === 2 && omitidos.cancelados === 1 && omitidos.importados === 1 && omitidos.cambios === 1, 'cuenta lo omitido: ' + JSON.stringify(omitidos));
ok(propuestas.length === 9 && propuestas.every((x, i) => i === 0 || propuestas[i - 1].orden <= x.orden), '9 notas, ordenadas por fecha');
// El mismo evento en dos archivos: solo una vez
const doble = propuestasIcs(ics + '\r\n' + ics, 'doble.ics');
ok(doble.propuestas.length === 9, 'el mismo evento repetido en el archivo no se duplica');
console.log('Pruebas de calendario terminadas.');
