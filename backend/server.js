// backend/server.js - Dashboard Vicebot (con Comentarios)

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// ══════════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ══════════════════════════════════════════════════════════════════════════════

const PORT = Number(process.env.DASHBOARD_PORT) || 3031;

// Rutas - Buscar la BD del bot
const PROJECT_ROOT = process.env.VICEBOT_PROJECT_PATH || 
  path.resolve(__dirname, '..', '..', 'proyecto');

const DB_PATH = process.env.VICEBOT_DB_PATH || 
  path.join(PROJECT_ROOT, 'data', 'vicebot.sqlite');

const ATTACHMENTS_PATH = process.env.VICEBOT_ATTACHMENTS_PATH || 
  path.join(PROJECT_ROOT, 'data', 'attachments');

const USERS_PATH = process.env.VICEBOT_USERS_PATH || 
  path.join(PROJECT_ROOT, 'data', 'users.json');

console.log('[BOOT] DB Path:', DB_PATH);
console.log('[BOOT] Attachments:', ATTACHMENTS_PATH);
console.log('[BOOT] Users:', USERS_PATH);

// ══════════════════════════════════════════════════════════════════════════════
// USERS LOOKUP (para mostrar nombres en lugar de chat_id)
// ══════════════════════════════════════════════════════════════════════════════

let usersCache = {};
let usersCacheTime = 0;
const USERS_CACHE_TTL = 60000; // Recargar cada 60 segundos

function loadUsers() {
  try {
    if (!fs.existsSync(USERS_PATH)) {
      console.warn('[USERS] users.json not found at:', USERS_PATH);
      return {};
    }
    const data = fs.readFileSync(USERS_PATH, 'utf8');
    const users = JSON.parse(data);
    console.log('[USERS] Loaded', Object.keys(users).length, 'users');
    return users;
  } catch (e) {
    console.error('[USERS] Error loading users.json:', e.message);
    return {};
  }
}

function getUsers() {
  const now = Date.now();
  if (now - usersCacheTime > USERS_CACHE_TTL) {
    usersCache = loadUsers();
    usersCacheTime = now;
  }
  return usersCache;
}

/**
 * Obtiene el nombre formateado de un usuario por su chat_id
 * @param {string} chatId - ej: "5217751801318@c.us" o "220091455148195@lid"
 * @returns {string|null} - ej: "Gustavo Peralta (IT Auxiliar)" o null
 */
function getUserDisplay(chatId) {
  if (!chatId) return null;
  const users = getUsers();
  
  // Intento 1: Buscar directamente por el ID completo
  let user = users[chatId];
  
  // Intento 2: Si es un @lid, extraer el número e intentar buscar con @c.us
  if (!user && chatId.includes('@lid')) {
    const num = chatId.split('@')[0];
    // Buscar si existe con @c.us
    user = users[`${num}@c.us`];
  }
  
  // Intento 3: Si es un @c.us, extraer el número e intentar buscar con @lid
  if (!user && chatId.includes('@c.us')) {
    const num = chatId.split('@')[0];
    user = users[`${num}@lid`];
  }
  
  // Intento 4: Buscar por número parcial en todas las claves
  if (!user) {
    const num = chatId.split('@')[0];
    // Solo buscar si el número tiene al menos 10 dígitos
    if (num && num.length >= 10) {
      for (const [key, val] of Object.entries(users)) {
        const keyNum = key.split('@')[0];
        // Comparar los últimos 10 dígitos (por variaciones de código de país)
        if (keyNum.slice(-10) === num.slice(-10)) {
          user = val;
          break;
        }
      }
    }
  }
  
  if (!user) return null;
  
  const nombre = user.nombre || user.name;
  const cargo = user.cargo || user.position || user.role;
  
  if (nombre && cargo) {
    return `${nombre} (${cargo})`;
  }
  return nombre || null;
}

// ══════════════════════════════════════════════════════════════════════════════
// SQL.JS SETUP
// ══════════════════════════════════════════════════════════════════════════════

const initSqlJs = require('sql.js');
let SQL = null;

// Inicializar sql.js
async function initDatabase() {
  SQL = await initSqlJs();
  console.log('[BOOT] sql.js initialized');
}

/**
 * Lee la BD combinando el archivo principal + WAL si existe
 */
function withDb(callback) {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`Database not found: ${DB_PATH}`);
  }
  
  // Leer el archivo principal
  const buffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(buffer);
  
  try {
    return callback(db);
  } finally {
    db.close();
  }
}

/**
 * Ejecuta SELECT y devuelve array de objetos
 */
function dbAll(db, sql, params = {}) {
  try {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    
    const results = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      results.push(row);
    }
    stmt.free();
    return results;
  } catch (e) {
    console.error('[DB] Query error:', e.message);
    console.error('[DB] SQL:', sql);
    throw e;
  }
}

/**
 * Ejecuta SELECT y devuelve un solo objeto o null
 */
function dbGet(db, sql, params = {}) {
  const results = dbAll(db, sql, params);
  return results.length > 0 ? results[0] : null;
}

/**
 * Ejecuta INSERT/UPDATE/DELETE y guarda
 */
function withDbWrite(callback) {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`Database not found: ${DB_PATH}`);
  }
  
  const buffer = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(buffer);
  
  try {
    const result = callback(db);
    const data = db.export();
    const outBuffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, outBuffer);
    return result;
  } finally {
    db.close();
  }
}

function dbRun(db, sql, params = {}) {
  db.run(sql, params);
  return { changes: db.getRowsModified() };
}

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════

const safeParse = (s, def = []) => {
  if (!s) return def;
  try { return JSON.parse(s); } 
  catch { return def; }
};

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

// ══════════════════════════════════════════════════════════════════════════════
// EXPRESS APP
// ══════════════════════════════════════════════════════════════════════════════

const app = express();

app.use(cors());
app.use(express.json());

// Frontend estático
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Servir attachments
if (fs.existsSync(ATTACHMENTS_PATH)) {
  app.use('/attachments', express.static(ATTACHMENTS_PATH));
  console.log('[BOOT] Serving attachments from:', ATTACHMENTS_PATH);
}

// ══════════════════════════════════════════════════════════════════════════════
// SSE (Server-Sent Events) para tiempo real
// ══════════════════════════════════════════════════════════════════════════════

const sseClients = new Set();

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  
  // Enviar evento de conexión
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
  
  sseClients.add(res);
  console.log(`[SSE] Client connected (total: ${sseClients.size})`);
  
  // Heartbeat cada 25s para mantener conexión
  const heartbeat = setInterval(() => {
    res.write(`data: ${JSON.stringify({ type: 'ping', time: Date.now() })}\n\n`);
  }, 25000);
  
  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
    console.log(`[SSE] Client disconnected (total: ${sseClients.size})`);
  });
});

function broadcastSSE(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(client => {
    try {
      client.write(msg);
    } catch (e) {
      sseClients.delete(client);
    }
  });
  if (sseClients.size > 0) {
    console.log(`[SSE] Broadcast to ${sseClients.size} clients:`, data.type);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// WEBHOOK para recibir notificaciones del bot
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/webhook/notify', (req, res) => {
  const { type, incidentId, folio, status, eventType } = req.body;
  
  console.log('[WEBHOOK] Received:', type, { incidentId, folio, status });
  
  // Broadcast a todos los clientes SSE
  broadcastSSE({ 
    type: type || 'update', 
    incidentId, 
    folio, 
    status,
    eventType,
    time: Date.now() 
  });
  
  res.json({ ok: true, clients: sseClients.size });
});

// ══════════════════════════════════════════════════════════════════════════════
// API ENDPOINTS
// ══════════════════════════════════════════════════════════════════════════════

// Health check
app.get('/api/health', (_req, res) => {
  const dbExists = fs.existsSync(DB_PATH);
  res.json({ 
    ok: dbExists, 
    db: DB_PATH, 
    dbExists,
    time: new Date().toISOString() 
  });
});

// Debug endpoint
app.get('/api/debug', (req, res) => {
  try {
    const dbExists = fs.existsSync(DB_PATH);
    const walExists = fs.existsSync(DB_PATH + '-wal');
    const shmExists = fs.existsSync(DB_PATH + '-shm');
    
    let dbSize = 0;
    let walSize = 0;
    
    if (dbExists) {
      dbSize = fs.statSync(DB_PATH).size;
    }
    if (walExists) {
      walSize = fs.statSync(DB_PATH + '-wal').size;
    }
    
    let tableInfo = null;
    let incidentCount = 0;
    let tables = [];
    
    if (dbExists) {
      try {
        const result = withDb(db => {
          // Listar tablas
          const tablesResult = dbAll(db, "SELECT name FROM sqlite_master WHERE type='table'");
          const tableNames = tablesResult.map(t => t.name);
          
          // Si existe la tabla incidents, contar
          let count = 0;
          let sample = [];
          
          if (tableNames.includes('incidents')) {
            const countResult = dbGet(db, 'SELECT COUNT(*) as c FROM incidents');
            count = countResult?.c || 0;
            sample = dbAll(db, 'SELECT id, folio, status, created_at FROM incidents ORDER BY created_at DESC LIMIT 5');
          }
          
          return { tables: tableNames, count, sample };
        });
        
        tables = result.tables;
        incidentCount = result.count;
        tableInfo = result;
      } catch (e) {
        tableInfo = { error: e.message };
      }
    }
    
    res.json({
      db: {
        path: DB_PATH,
        exists: dbExists,
        size: dbSize,
        walExists,
        walSize,
        shmExists
      },
      tables,
      incidents: incidentCount,
      tableInfo,
      sseClients: sseClients.size
    });
    
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/incidents - Lista
app.get('/api/incidents', (req, res) => {
  try {
    const { status, area, q, sort, limit, offset } = req.query;
    
    const result = withDb(db => {
      const where = [];
      const params = {};

      if (status) {
        where.push('status = $status');
        params.$status = status;
      }
      if (area) {
        where.push('area_destino = $area');
        params.$area = area.toUpperCase();
      }
      if (q) {
        where.push('(descripcion LIKE $q OR interpretacion LIKE $q OR lugar LIKE $q OR folio LIKE $q)');
        params.$q = `%${q}%`;
      }

      const [sortFieldRaw, sortDirRaw] = String(sort || '').split(':');
      const allowedSort = new Set(['created_at', 'updated_at', 'folio']);
      const sortField = allowedSort.has(sortFieldRaw) ? sortFieldRaw : 'created_at';
      const sortDir = (sortDirRaw || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

      const W = where.length ? ('WHERE ' + where.join(' AND ')) : '';
      
      const limitNum = clamp(Number(limit) || 50, 1, 200);
      const offsetNum = Math.max(0, Number(offset) || 0);
      
      params.$limit = limitNum;
      params.$offset = offsetNum;

      const total = dbGet(db, `SELECT COUNT(*) as total FROM incidents ${W}`, params)?.total || 0;
      
      const rows = dbAll(db, `
        SELECT id, folio, created_at, updated_at, status, chat_id,
               descripcion, interpretacion, lugar, area_destino, attachments_json
        FROM incidents
        ${W}
        ORDER BY ${sortField} ${sortDir}
        LIMIT $limit OFFSET $offset
      `, params);
      
      return { total, rows };
    });

    if (result.error) {
      console.warn('[API] /incidents warning:', result.error);
    }

    const items = (result.rows || []).map(r => {
      const atts = safeParse(r.attachments_json, []);
      const first = Array.isArray(atts) && atts.length ? atts[0] : null;
      return {
        id: r.id,
        folio: r.folio,
        created_at: r.created_at,
        updated_at: r.updated_at,
        status: r.status,
        descripcion: r.descripcion,
        interpretacion: r.interpretacion,
        lugar: r.lugar,
        area_destino: r.area_destino,
        attachments_count: Array.isArray(atts) ? atts.length : 0,
        first_attachment_url: first?.url || null,
      };
    });

    const limitNum = clamp(Number(limit) || 50, 1, 200);
    const offsetNum = Math.max(0, Number(offset) || 0);
    const page = Math.floor(offsetNum / limitNum) + 1;

    res.json({
      items,
      total: result.total || 0,
      page,
      limit: limitNum,
      offset: offsetNum,
      rows: items  // Alias para compatibilidad
    });
    
  } catch (e) {
    console.error('[API] /incidents error', e);
    res.status(500).json({ 
      error: 'internal_error', 
      message: e.message,
      items: [],
      total: 0
    });
  }
});

// GET /api/incidents/:id - Detalle
app.get('/api/incidents/:id', (req, res) => {
  try {
    const { id } = req.params;
    
    const result = withDb(db => {
      const incident = dbGet(db, `
        SELECT * FROM incidents 
        WHERE id = $id OR folio = $id
        LIMIT 1
      `, { $id: id });
      
      if (!incident) return null;
      
      const events = dbAll(db, `
        SELECT id, event_type, payload_json, created_at, wa_msg_id
        FROM incident_events
        WHERE incident_id = $incidentId
        ORDER BY created_at ASC
      `, { $incidentId: incident.id });
      
      return { incident, events };
    });
    
    if (!result || !result.incident) {
      return res.status(404).json({ error: 'not_found' });
    }
    
    const inc = result.incident;
    const atts = safeParse(inc.attachments_json, []);
    const areas = safeParse(inc.areas_json, []);
    const notes = safeParse(inc.notes_json, []);
    
    // Calcular origin_display: usar el de BD si existe, sino buscar en users.json
    const originWa = inc.origin_name || inc.chat_id || null;
    const originDisplay = inc.origin_display || getUserDisplay(inc.chat_id) || getUserDisplay(inc.origin_name);
    
    res.json({
      id: inc.id,
      folio: inc.folio,
      created_at: inc.created_at,
      updated_at: inc.updated_at,
      status: inc.status,
      chat_id: inc.chat_id,
      descripcion: inc.descripcion,
      interpretacion: inc.interpretacion,
      lugar: inc.lugar,
      building: inc.building,
      floor: inc.floor,
      room: inc.room,
      area_destino: inc.area_destino,
      areas,
      notes,
      origin_name: inc.origin_name,
      origin_display: originDisplay,  // Nombre formateado del solicitante
      origin_wa: inc.origin_wa || inc.chat_id,  // WhatsApp ID original
      attachments: atts,
      events: (result.events || []).map(e => {
        const payload = safeParse(e.payload_json, {});
        
        // Resolver el nombre del autor si es un ID de WhatsApp
        if (payload.author && !payload.author_name) {
          const resolved = getUserDisplay(payload.author);
          if (resolved && resolved !== payload.author) {
            payload.author_name = resolved;
          }
        }
        
        return {
          id: e.id,
          event_type: e.event_type,
          payload,
          created_at: e.created_at,
          wa_msg_id: e.wa_msg_id
        };
      })
    });
    
  } catch (e) {
    console.error('[API] /incidents/:id error', e);
    res.status(500).json({ error: 'internal_error', message: e.message });
  }
});

// PATCH /api/incidents/:id/status - Cambiar estado
app.patch('/api/incidents/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    if (!status) {
      return res.status(400).json({ error: 'missing_status' });
    }
    
    const allowed = ['open', 'in_progress', 'done', 'canceled'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: 'invalid_status', allowed });
    }
    
    const result = withDbWrite(db => {
      const incident = dbGet(db, 'SELECT id, status, folio FROM incidents WHERE id = $id OR folio = $id', { $id: id });
      if (!incident) return null;
      
      const ts = new Date().toISOString();
      const eventId = require('crypto').randomUUID();
      
      db.run(`UPDATE incidents SET status = $status, updated_at = $ts WHERE id = $id`, {
        $id: incident.id,
        $status: status,
        $ts: ts
      });
      
      db.run(`
        INSERT INTO incident_events (id, incident_id, created_at, event_type, payload_json)
        VALUES ($id, $incidentId, $ts, 'status_change', $payload)
      `, {
        $id: eventId,
        $incidentId: incident.id,
        $ts: ts,
        $payload: JSON.stringify({ from: incident.status, to: status, source: 'dashboard' })
      });
      
      return { id: incident.id, folio: incident.folio, from: incident.status, to: status };
    });
    
    if (!result) {
      return res.status(404).json({ error: 'not_found' });
    }
    
    // Broadcast del cambio a clientes SSE
    broadcastSSE({ type: 'status_change', ...result });
    
    // ─────────────────────────────────────────────────────────────
    // Notificar al BOT para que envíe mensajes por WhatsApp
    // ─────────────────────────────────────────────────────────────
    const BOT_WEBHOOK_URL = process.env.BOT_WEBHOOK_URL || 'http://localhost:3030/api/webhook/status-change';
    
    try {
      const botResponse = await fetch(BOT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incidentId: result.id,
          folio: result.folio,
          from: result.from,
          to: result.to,
          source: 'dashboard'
        })
      });
      
      const botData = await botResponse.json().catch(() => ({}));
      console.log('[DASHBOARD] Bot notified:', botData.ok ? 'OK' : botData.error || 'failed');
      
      res.json({ ok: true, ...result, botNotified: botData.ok || false });
    } catch (botErr) {
      // El bot puede no estar corriendo, no es crítico
      console.warn('[DASHBOARD] Could not notify bot:', botErr?.message || 'connection failed');
      res.json({ ok: true, ...result, botNotified: false, botError: 'connection_failed' });
    }
    
  } catch (e) {
    console.error('[API] PATCH status error', e);
    res.status(500).json({ error: 'internal_error', message: e.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// MÓDULO DE REPORTES
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/reports/preview - Vista previa de datos para reporte
app.get('/api/reports/preview', (req, res) => {
  try {
    const { startDate, endDate, areas, statuses, limit = 100 } = req.query;
    
    // ═══════════════════════════════════════════════════════════════
    // 🔥 LOG: Ver qué filtros recibe
    // ═══════════════════════════════════════════════════════════════
    console.log('[PREVIEW] ═══════════════════════════════════════');
    console.log('[PREVIEW] Query params:', req.query);
    console.log('[PREVIEW] startDate:', startDate, 'type:', typeof startDate);
    console.log('[PREVIEW] endDate:', endDate, 'type:', typeof endDate);
    console.log('[PREVIEW] areas:', areas, 'type:', typeof areas);
    console.log('[PREVIEW] statuses:', statuses, 'type:', typeof statuses);
    console.log('[PREVIEW] ═══════════════════════════════════════');
    
    let conditions = [];
    let params = {};
    
    // Filtro por fechas
    if (startDate) {
      conditions.push('created_at >= $startDate');
      params.$startDate = `${startDate}T00:00:00.000Z`;
    }
    if (endDate) {
      conditions.push('created_at <= $endDate');
      params.$endDate = `${endDate}T23:59:59.999Z`;
    }
    
    // Filtro por áreas (puede ser string, array, o string separado por comas)
    if (areas) {
      let areaList = [];
      
      if (Array.isArray(areas)) {
        areaList = areas;
      } else if (typeof areas === 'string') {
        areaList = areas.split(',').map(a => a.trim()).filter(Boolean);
      }
      
      if (areaList.length > 0) {
        conditions.push(`LOWER(area_destino) IN (${areaList.map((_, i) => `$area${i}`).join(', ')})`);
        areaList.forEach((area, i) => {
          params[`$area${i}`] = String(area).toLowerCase();
        });
      }
    }
    
    // Filtro por estados (puede ser string, array, o string separado por comas)
    if (statuses) {
      let statusList = [];
      
      if (Array.isArray(statuses)) {
        statusList = statuses;
      } else if (typeof statuses === 'string') {
        statusList = statuses.split(',').map(s => s.trim()).filter(Boolean);
      }
      
      if (statusList.length > 0) {
        conditions.push(`LOWER(status) IN (${statusList.map((_, i) => `$status${i}`).join(', ')})`);
        statusList.forEach((status, i) => {
          params[`$status${i}`] = String(status).toLowerCase();
        });
      }
    }
    
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    
    // ═══════════════════════════════════════════════════════════════
    // 🔥 LOG: Ver query construida
    // ═══════════════════════════════════════════════════════════════
    console.log('[PREVIEW] ───────────────────────────────────────');
    console.log('[PREVIEW] WHERE:', whereClause);
    console.log('[PREVIEW] Params:', JSON.stringify(params, null, 2));
    console.log('[PREVIEW] ───────────────────────────────────────');
    
    const result = withDb(db => {
      // Total de registros que cumplen filtros
      const countRow = dbGet(db, `SELECT COUNT(*) as total FROM incidents ${whereClause}`, params);
      const total = countRow?.total || 0;
      
      // Obtener muestra de datos
      const sql = `
        SELECT 
          id, folio, created_at, updated_at, status, 
          area_destino, lugar, descripcion, origin_name
        FROM incidents 
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT $limit
      `;
      
      const incidents = dbAll(db, sql, { ...params, $limit: Number(limit) });
      
      // Estadísticas rápidas
      const stats = {
        total,
        byStatus: {},
        byArea: {}
      };
      
      // Contar por estado y área (sobre todos los registros, no solo la muestra)
      const allIncidents = dbAll(db, `SELECT status, area_destino FROM incidents ${whereClause}`, params);
      
      allIncidents.forEach(inc => {
        const status = inc.status || 'open';
        const area = inc.area_destino || 'sin_area';
        stats.byStatus[status] = (stats.byStatus[status] || 0) + 1;
        stats.byArea[area] = (stats.byArea[area] || 0) + 1;
      });
      
      return { incidents, stats };
    });
    
    // ═══════════════════════════════════════════════════════════════
    // 🔥 LOG: Ver resultados
    // ═══════════════════════════════════════════════════════════════
    console.log('[PREVIEW] ───────────────────────────────────────');
    console.log('[PREVIEW] Incidencias encontradas:', result.incidents?.length || 0);
    console.log('[PREVIEW] Stats:', JSON.stringify(result.stats, null, 2));
    console.log('[PREVIEW] ───────────────────────────────────────');
    
    res.json({
      ok: true,
      preview: result.incidents.map(inc => ({
        folio: inc.folio,
        fecha: inc.created_at,
        estado: inc.status,
        area: inc.area_destino,
        lugar: inc.lugar,
        descripcion: (inc.descripcion || '').substring(0, 100)
      })),
      stats: result.stats,
      filters: { startDate, endDate, areas, statuses }
    });
    
  } catch (e) {
    console.error('[API] /reports/preview error', e);
    res.status(500).json({ error: 'internal_error', message: e.message });
  }
});

// POST /api/reports/generate - Generar archivo Excel
app.post('/api/reports/generate', async (req, res) => {
  try {
    const { startDate, endDate, areas, statuses } = req.body;
    
    // Validar que exportXLSX.js existe
    const exportPath = path.join(PROJECT_ROOT, 'modules', 'reports', 'exportXLSX.js');
    if (!fs.existsSync(exportPath)) {
      return res.status(500).json({ 
        error: 'export_module_not_found',
        message: 'Módulo de exportación no encontrado',
        path: exportPath
      });
    }
    
    // ═══════════════════════════════════════════════════════════════
    // 🔥 CRITICAL: Limpiar caché del módulo para forzar recarga
    // ═══════════════════════════════════════════════════════════════
    delete require.cache[require.resolve(exportPath)];
    
    // ═══════════════════════════════════════════════════════════════
    // 🔥 IMPORTANTE: Establecer las rutas correctas ANTES de importar
    // Las constantes de exportXLSX se evalúan al momento de require()
    // ═══════════════════════════════════════════════════════════════
    process.env.VICEBOT_DB_PATH = DB_PATH;
    process.env.VICEBOT_USERS_PATH = USERS_PATH;
    process.env.VICEBOT_REPORTS_DIR = path.join(PROJECT_ROOT, 'data', 'reports');
    
    // Importar el módulo de exportación (DESPUÉS de configurar env vars)
    const { exportXLSX } = require(exportPath);
    
    // ═══════════════════════════════════════════════════════════════
    // 🔥 DEBUG: Verificar que la BD existe y hacer WAL checkpoint
    // ═══════════════════════════════════════════════════════════════
    console.log('[REPORTS] DB_PATH:', DB_PATH);
    console.log('[REPORTS] DB exists:', fs.existsSync(DB_PATH));
    console.log('[REPORTS] WAL exists:', fs.existsSync(DB_PATH + '-wal'));
    
    // Hacer checkpoint del WAL para asegurar que los datos estén en el archivo principal
    try {
      const sqlite3 = require('better-sqlite3');
      const tempDb = sqlite3(DB_PATH);
      
      // Verificar tablas
      const tables = tempDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
      console.log('[REPORTS] Tables found:', tables.map(t => t.name).join(', '));
      
      // Hacer checkpoint
      tempDb.pragma('wal_checkpoint(PASSIVE)');
      console.log('[REPORTS] WAL checkpoint done');
      
      tempDb.close();
    } catch (checkErr) {
      console.warn('[REPORTS] Checkpoint failed:', checkErr.message);
    }
    
    // Configurar opciones de exportación
    const options = {};
    if (startDate) options.startDate = startDate;
    if (endDate) options.endDate = endDate;
    if (areas && areas.length > 0) options.areas = areas;
    if (statuses && statuses.length > 0) options.statuses = statuses;
    
    // ═══════════════════════════════════════════════════════════════
    // 🔥 FIX: exportXLSX abre su propia conexión con better-sqlite3
    // NO pasar la conexión de sql.js porque son incompatibles
    // ═══════════════════════════════════════════════════════════════
    const filePath = await exportXLSX(options);
    
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error('El archivo no fue generado correctamente');
    }
    
    const fileName = path.basename(filePath);
    
    res.json({
      ok: true,
      fileName,
      downloadUrl: `/api/reports/download/${fileName}`,
      filePath
    });
    
  } catch (e) {
    console.error('[API] /reports/generate error', e);
    res.status(500).json({ 
      error: 'generation_failed', 
      message: e.message 
    });
  }
});

// GET /api/reports/download/:filename - Descargar archivo generado
app.get('/api/reports/download/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    
    // Validar nombre de archivo (seguridad)
    if (!filename || !/^incidencias_[\w\-]+\.xlsx$/.test(filename)) {
      return res.status(400).json({ error: 'invalid_filename' });
    }
    
    const REPORTS_DIR = process.env.VICEBOT_REPORTS_DIR || 
      path.join(PROJECT_ROOT, 'data', 'reports');
    
    const filePath = path.join(REPORTS_DIR, filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'file_not_found' });
    }
    
    res.download(filePath, filename, (err) => {
      if (err) {
        console.error('[API] Download error:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'download_failed' });
        }
      }
    });
    
  } catch (e) {
    console.error('[API] /reports/download error', e);
    res.status(500).json({ error: 'internal_error', message: e.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/incidents/:id/comment - Agregar comentario
// El dashboard NO escribe a la BD - solo envía al bot que es el único escritor
// ══════════════════════════════════════════════════════════════════════════════
app.post('/api/incidents/:id/comment', async (req, res) => {
  try {
    const { id } = req.params;
    const { text } = req.body;
    
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'missing_text' });
    }
    
    const commentText = text.trim();
    
    // Solo leer info del incidente, NO escribir
    const incident = withDb(db => {
      return dbGet(db, 'SELECT id, folio, chat_id, area_destino FROM incidents WHERE id = $id OR folio = $id', { $id: id });
    });
    
    if (!incident) {
      return res.status(404).json({ error: 'not_found' });
    }
    
    // ─────────────────────────────────────────────────────────────
    // Enviar al BOT - él guarda en la BD y envía por WhatsApp
    // ─────────────────────────────────────────────────────────────
    const BOT_WEBHOOK_URL = process.env.BOT_WEBHOOK_URL || 'http://localhost:3030/api/webhook/comment';
    
    let botResult = { ok: false, error: 'not_sent' };
    try {
      const botResponse = await fetch(BOT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incidentId: incident.id,
          folio: incident.folio,
          chat_id: incident.chat_id,
          area_destino: incident.area_destino,
          text: commentText,
          source: 'dashboard'
        })
      });
      
      botResult = await botResponse.json().catch(() => ({ ok: false, error: 'parse_error' }));
      console.log('[DASHBOARD] Bot notified for comment:', botResult.ok ? 'OK' : botResult.error || 'failed');
      
    } catch (botErr) {
      console.warn('[DASHBOARD] Could not notify bot for comment:', botErr?.message || 'connection failed');
      botResult = { ok: false, error: botErr?.message || 'connection_failed' };
    }
    
    if (!botResult.ok) {
      return res.status(502).json({ 
        error: 'bot_unavailable', 
        message: 'No se pudo enviar el comentario. Verifica que el bot esté corriendo.',
        details: botResult.error
      });
    }
    
    // Broadcast a clientes SSE para que refresquen
    broadcastSSE({ 
      type: 'new_comment', 
      incidentId: incident.id, 
      folio: incident.folio,
      text: commentText
    });
    
    res.json({ 
      ok: true, 
      incidentId: incident.id,
      folio: incident.folio,
      botNotified: true
    });
    
  } catch (e) {
    console.error('[API] POST comment error', e);
    res.status(500).json({ error: 'internal_error', message: e.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// INICIO DEL SERVIDOR
// ══════════════════════════════════════════════════════════════════════════════

async function start() {
  await initDatabase();
  
  app.listen(PORT, () => {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  🖥️  VICEBOT DASHBOARD');
    console.log(`  📍 http://localhost:${PORT}`);
    console.log('═══════════════════════════════════════════════════════════');
    
    // Verificar BD al inicio
    if (fs.existsSync(DB_PATH)) {
      try {
        withDb(db => {
          const tables = dbAll(db, "SELECT name FROM sqlite_master WHERE type='table'");
          console.log('[BOOT] Tablas encontradas:', tables.map(t => t.name).join(', ') || '(ninguna)');
          
          if (tables.some(t => t.name === 'incidents')) {
            const count = dbGet(db, 'SELECT COUNT(*) as c FROM incidents');
            console.log('[BOOT] Incidencias en BD:', count?.c || 0);
          }
        });
      } catch (e) {
        console.warn('[BOOT] Error leyendo BD:', e.message);
        console.warn('[BOOT] Esto puede ser normal si el bot está escribiendo (WAL)');
      }
    } else {
      console.warn('[BOOT] ⚠️  Base de datos no encontrada:', DB_PATH);
    }
  });
}

start().catch(e => {
  console.error('[FATAL]', e);
  process.exit(1);
});