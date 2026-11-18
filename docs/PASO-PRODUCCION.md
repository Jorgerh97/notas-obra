# Paso a producción de la versión multiusuario (fases 0 a 3)

Preparado el 18 nov 2026. **Nada de esto está hecho todavía.** Cada paso que publica, escribe en producción o borra
se hace solo con la confirmación de Jorge, en el momento.

## Qué se publica
- Rama `fase4-multiusuario` (5 commits sobre `main` = `ce3c4d5`, la 1.5.3). La unión con `main` es directa
  (fast-forward), sin conflictos.
- **Worker**: usuarios con token propio, permiso de dictado, notas compartidas por responsables, `realizada_por`,
  catálogo común de etiquetas y personas, traspaso de persona a usuario, `/registro`.
- **App 1.7.1**: Dictar solo con permiso, varios responsables, barra lateral con usuarios y personas,
  «Tareas hechas compartidas».

## Comprobado antes (18 nov 2026, solo lectura)
| Comprobación | Resultado |
|---|---|
| Esquema de producción frente al de la prueba de migración (`test/esquema-fase0.mjs`) | **Igual** (14 sentencias) |
| Filas de producción | notas 219 · etiquetas 35 · nota_etiquetas 278 · personas 3 · vistas 8 · cambios 615 · suscripciones 1 · config 3 · archivos 0 |
| Simulación del despliegue de producción desde la rama | `notas-obra-db`, `notas-obra-fotos`, AI, `ALLOWED_ORIGIN = https://jorgerh97.github.io`, cron cada minuto |
| Secretos de producción | `ANTHROPIC_API_KEY` y `APP_TOKEN` (no cambian) |
| Worker de producción en marcha (para volver atrás) | versión `79c96957-ff07-40f5-ad15-5d131b10aa1e` (3 nov 2026) |
| Pruebas | `npm test`: 250 comprobaciones, todas bien |
| Ensayo con la copia de producción en `--env dev` | filas iguales; 33 notas conservan su responsable; Jorge lo ha probado con 2 usuarios |

## Qué pasa con lo que ya existe
- Tu `APP_TOKEN` de siempre es tu usuario («yo», administrador): **tus dispositivos siguen funcionando sin tocar nada**,
  también con la app antigua mientras no se actualizan.
- La migración solo **añade** tablas y columnas. Todo lo existente queda como tuyo, tus ajustes se copian a tu usuario
  y el responsable de cada nota pasa a la lista de responsables.
- La app antigua sigue funcionando con el worker nuevo (sigue enviando el responsable único).

## Antes de empezar (Jorge)
1. Probar en el móvil, contra desarrollo, lo que no se puede automatizar: avisos push entre dos usuarios (asignar y
   «hecha»), dictado y fotos.
2. Elegir un momento con poco uso: hay unos minutos en los que los dispositivos pueden tener la app antigua.

## Pasos (en PowerShell, desde la carpeta `notas-obra`)

### 1. Copia de seguridad (solo lectura)
```
mkdir ..\copias-seguridad\AAAA-MM-DD
npx.cmd wrangler d1 export notas-obra-db --remote --output ..\copias-seguridad\AAAA-MM-DD\notas-obra-db.sql
```
Anotar el número de filas de cada tabla (lo hace Claude con una consulta de solo lectura).

### 2. Marca para volver atrás (local, sin publicar)
```
git tag v1.5.3 ce3c4d5
```

### 3. Publicar el worker
```
npx.cmd wrangler deploy --env ""
```
`--env ""` es producción (desde que existe `--env dev`, sin él wrangler muestra un aviso, pero también publica producción).
Después:
- Abrir la app en un dispositivo (la primera petición aplica la migración).
- Claude cuenta las filas otra vez: deben coincidir con el paso 1, y además deben existir `usuarios` (1, «yo»),
  `nota_responsables` (33) y `config_usuario`.
- Comprobación con el script (pide el token de producción sin mostrarlo):
  ```
  powershell -ExecutionPolicy Bypass -File ..\comprobar-dev.ps1 -Entorno prod
  ```
  Debe decir `Usuario: Jorge (id yo, administrador: True)` y las mismas notas.
- En la app: Ajustes → «Enviar aviso de prueba».

### 4. Publicar la app 1.7.1
```
git switch main
git merge --ff-only fase4-multiusuario
npm test
git push origin main
```
Comprobar que la acción «Publicar app» termina (`gh run list`; si no arranca, `gh workflow run pages.yml --ref main`)
y que la web sirve `notas-v1.7.1`. En cada dispositivo: abrir la app y pulsar «Hay una versión nueva».

### 5. Dar de alta a los usuarios reales
```
powershell -ExecutionPolicy Bypass -File ..\crear-usuario-dev.ps1 -Entorno prod
```
- El token de cada usuario se muestra **una sola vez** en tu terminal; dáselo a esa persona por un canal privado
  (nunca por el chat). Cada uno lo pone en Ajustes de su app.
- Sin permiso de dictado por defecto.
- Si esa persona ya estaba como responsable: Ajustes → Responsables → Editar → «Pasar sus notas a ese usuario».

## Volver atrás si algo falla
- **Worker**: `npx.cmd wrangler rollback 79c96957-ff07-40f5-ad15-5d131b10aa1e` (vuelve el worker de la 1.5.3).
- **App**: `git revert --no-edit ce3c4d5..main` y `git push origin main` (vuelve a publicar la 1.5.3 sin borrar historia).
- **Base de datos**: no hace falta tocarla. Las tablas y columnas nuevas no molestan a la versión antigua, que solo
  ve las notas de «yo». Si hiciera falta, la copia del paso 1 permite recuperar el estado anterior (eso sí borra
  datos: solo con confirmación de Jorge).

## Después
- Actualizar `CLAUDE.md` (la versión multiusuario pasa a ser la de producción y el comando de publicar el worker
  es `npx wrangler deploy --env ""`) y `docs/ARQUITECTURA.md`.
- El entorno de desarrollo (`--env dev`) se queda para las próximas pruebas. Sus usuarios de prueba se pueden desactivar.
