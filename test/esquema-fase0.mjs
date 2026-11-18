// Esquema EXACTO de la base de producción al empezar la Fase 1 (18 nov 2026), sacado de la copia de
// seguridad: solo las sentencias CREATE, sin ningún dato. Sirve para probar las migraciones.
export const ESQUEMA_FASE0 = [
 "CREATE TABLE notas (\n     id TEXT PRIMARY KEY, usuario_id TEXT NOT NULL DEFAULT 'yo', titulo TEXT NOT NULL, cuerpo TEXT, prioridad TEXT NOT NULL,\n     estado TEXT NOT NULL DEFAULT 'activa', persona_id TEXT, fecha_limite TEXT, alarma TEXT, alarma_enviada INTEGER DEFAULT 0,\n     subir_critica INTEGER DEFAULT 1, duracion INTEGER, origen TEXT, origen_ref TEXT, transcripcion TEXT,\n     creada TEXT, actualizada TEXT, realizada_en TEXT, eliminada_en TEXT, borrar_en TEXT,\n     aviso30 INTEGER DEFAULT 0, aviso7 INTEGER DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, hora_limite TEXT, aviso_cant INTEGER, aviso_unidad TEXT, checklist TEXT, repetir TEXT, serie TEXT, prio_antes TEXT, fotos TEXT)",
 "CREATE TABLE etiquetas (\n     id TEXT PRIMARY KEY, usuario_id TEXT NOT NULL DEFAULT 'yo', nombre TEXT NOT NULL, tipo TEXT NOT NULL DEFAULT 'otra',\n     alias TEXT, cerrada INTEGER DEFAULT 0, cerrada_en TEXT, creada TEXT, actualizada TEXT)",
 "CREATE TABLE nota_etiquetas (nota_id TEXT NOT NULL, etiqueta_id TEXT NOT NULL, PRIMARY KEY (nota_id, etiqueta_id))",
 "CREATE TABLE personas (id TEXT PRIMARY KEY, usuario_id TEXT NOT NULL DEFAULT 'yo', nombre TEXT NOT NULL, cargo TEXT, creada TEXT)",
 "CREATE TABLE vistas (id TEXT PRIMARY KEY, usuario_id TEXT NOT NULL DEFAULT 'yo', nombre TEXT NOT NULL, filtro TEXT NOT NULL, orden INTEGER DEFAULT 0)",
 "CREATE TABLE cambios (id INTEGER PRIMARY KEY AUTOINCREMENT, nota_id TEXT, fecha TEXT, dispositivo TEXT, accion TEXT, antes TEXT)",
 "CREATE TABLE suscripciones (\n     id TEXT PRIMARY KEY, endpoint TEXT UNIQUE NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, nombre TEXT,\n     plataforma TEXT, activo INTEGER DEFAULT 1, creada TEXT, ultimo_uso TEXT)",
 "CREATE TABLE config (clave TEXT PRIMARY KEY, valor TEXT)",
 "CREATE TABLE archivos (id TEXT PRIMARY KEY, titulo TEXT, motivo TEXT, creado TEXT, notas INTEGER, html TEXT)",
 "CREATE INDEX idx_notas_estado ON notas(estado)",
 "CREATE INDEX idx_notas_alarma ON notas(alarma)",
 "CREATE INDEX idx_notas_origen ON notas(origen, origen_ref)",
 "CREATE INDEX idx_ne_etiqueta ON nota_etiquetas(etiqueta_id)",
 "CREATE INDEX idx_cambios_nota ON cambios(nota_id)"
];
