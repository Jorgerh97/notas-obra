# Fase 3 multiusuario · notas compartidas por responsables

Diseño acordado con Jorge el 18 nov 2026. Rama `fase4-multiusuario`, solo entorno `--env dev` hasta que él lo apruebe.
Parte de las Fases 1 (usuarios y token propio) y 2 (permiso de dictado). Ver `docs/ARQUITECTURA.md` y `docs/PENDIENTE.md`.

## Decisiones de Jorge
| Tema | Decisión |
|---|---|
| Qué se comparte | Una nota tiene **uno o varios responsables**. La ven quien la creó y todos sus responsables con cuenta. Sin responsables con cuenta, la nota es privada (como ahora). |
| Permisos de un responsable | **Todo menos borrarla**: texto, fecha, hora, aviso, prioridad, checklist, fotos, etiquetas, responsables y darla por hecha o reabrirla. Papelera y borrado, solo quien la creó. |
| Etiquetas | **Un catálogo común** para todos los usuarios (la obra #605 es la misma para todos). |
| Avisos nuevos | **Al asignar** (al responsable nuevo) y **al darla por hecha** (a quien la creó y al resto de responsables, menos a quien la marcó). Los avisos de fecha y hora llegan a todos los que ven la nota. |
| Registro de tareas hechas | **Cada uno ve aquello en lo que ha participado** (creador o responsable); el administrador ve el de todos. |

## Modelo de datos (solo se añade, nunca se borra)
- `nota_responsables (nota_id, tipo, ref_id, asignado_por, asignado_en, PRIMARY KEY (nota_id, tipo, ref_id))`. `tipo`: `usuario` (con cuenta, ve la nota) o `persona` (nombre sin cuenta, no ve nada). Migración: cada `notas.persona_id` actual pasa a una fila `persona`; la columna `persona_id` se mantiene (la primera persona) para la app antigua.
- `personas.usuario_vinculado` (nuevo): al dar de alta en la app a alguien que ya estaba como persona, se vincula y sus notas pasan a estar compartidas con él.
- `notas.realizada_por` (usuario que la dio por hecha) junto a `realizada_en`. Reabrir la deja vacía; el historial (`cambios.usuario_id`) guarda quién hizo cada paso.
- `notas.usuario_id` sigue siendo **quien la creó** (dueño): papelera, borrado y repeticiones.
- Etiquetas comunes: se dejan de filtrar por `usuario_id` (la columna se conserva como «creada por»). Nombres repetidos entre usuarios: se resuelve en la migración (en producción hoy solo hay etiquetas de Jorge).
- Personas: catálogo común, igual que las etiquetas (supuesto: Jorge no lo ha dicho; confirmar).

## Visibilidad (worker)
- Un usuario ve una nota si es su dueño **o** si figura en `nota_responsables` como `usuario`, **o** como persona vinculada a él.
- `GET /datos` devuelve también las notas compartidas con él, con `dueño`, `responsables` y `realizada_por`.
- Conflictos entre dos usuarios: el mismo control por `version` que ya existe entre dispositivos (pantalla para elegir).

## App
- Editor: «Responsables» admite varios (usuarios de la app y personas sin cuenta) y marca quién tiene cuenta.
- Lista, Matriz y Calendario: en las notas compartidas, iconos de quién la creó y de sus responsables; en las hechas, «Hecha por Pedro · 26/11 17:30».
- **Registro de tareas hechas** (menú y barra lateral): tabla con fecha y hora, nota, obra, creada por, responsables y quién dio el OK. Filtros por usuario, obra y fechas. Exportar a PDF y CSV.

## Pasos de implementación
1. Esquema y migración (con pruebas desde el esquema actual de dev).
2. Worker: visibilidad, permisos (todo menos borrar), etiquetas y personas comunes, `realizada_por`.
3. Avisos al asignar y al completar.
4. App: varios responsables, marcas de nota compartida y «Hecha por…».
5. Registro de tareas hechas con filtros y exportación.
6. Pruebas, despliegue en dev y prueba de Jorge con dos usuarios.
