// backend/server.js - Dashboard Vicebot (FIXED para better-sqlite3)

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const {
  findUserByUsername,
  validatePassword,
  generateToken,
  verifyToken,
  requireAuth
} = require('./auth-middleware');

const PORT = Number(process.env.DASHBOARD_PORT) || 3031;

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
// USERS LOOKUP
// ══════════════════════════════════════════════════════════════════════════════

let usersCache = {};
let usersCacheTime = 0;
const USERS_CACHE_TTL = 60000;

function loadUsers() {
  try {
    if (!fs.existsSync(USERS_PATH)) {
      console.warn('[USERS] users.json not found');
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
 */
function getUserDisplay(chatId) {
  if (!chatId) return null;
  const users = getUsers();
  
  let user = users[chatId];
  
  if (!user && chatId.includes('@lid')) {
    const num = chatId.split('@')[0];
    user = users[`${num}@c.us`];
  }
  
  if (!user && chatId.includes('@c.us')) {
    const num = chatId.split('@')[0];
    user = users[`${num}@lid`];
  }
  
  if (!user) {
    const num = chatId.split('@')[0];
    if (num && num.length >= 10) {
      for (const [key, val] of Object.entries(users)) {
        const keyNum = key.split('@')[0];
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
// BETTER-SQLITE3 SETUP
// ══════════════════════════════════════════════════════════════════════════════

const Database = require('better-sqlite3');
let db = null;

function initializeDB() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      console.log('[BOOT] ⚠️  Base de datos no encontrada:', DB_PATH);
      return;
    }

    db = new Database(DB_PATH, {
      readonly: false,
      fileMustExist: true,
      timeout: 5000
    });

    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = 10000');

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    console.log('[BOOT] Tablas encontradas:', tables.map(t => t.name).join(', '));

    const count = db.prepare('SELECT COUNT(*) as total FROM incidents').get();
    console.log('[BOOT] Incidencias en BD:', count.total);

    console.log('[BOOT] ✅ better-sqlite3 inicializado correctamente');
  } catch (err) {
    console.error('[BOOT] Error inicializando BD:', err);
    db = null;
  }
}

function withDb(callback) {
  if (!db) {
    throw new Error(`Database not found: ${DB_PATH}`);
  }
  try {
    return callback(db);
  } catch (err) {
    console.error('[DB] Query error:', err.message);
    throw err;
  }
}

function withDbWrite(callback) {
  if (!db) {
    throw new Error(`Database not found: ${DB_PATH}`);
  }
  try {
    const result = db.transaction(() => {
      return callback(db);
    })();
    return result;
  } catch (err) {
    console.error('[DB] Write error:', err.message);
    throw err;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// EXPRESS APP
// ══════════════════════════════════════════════════════════════════════════════

const app = express();
app.use(cors());
app.use(express.json());

// Servir login sin protección
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'login.html'));
});

// Servir archivos estáticos SIN verificar token (el frontend lo maneja)
app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.use('/attachments', express.static(ATTACHMENTS_PATH));
console.log('[BOOT] Serving attachments from:', ATTACHMENTS_PATH);

const safeParse = (s, def = []) => {
  if (!s) return def;
  try { return JSON.parse(s); } 
  catch { return def; }
};

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

// ══════════════════════════════════════════════════════════════════════════════
// SSE
// ══════════════════════════════════════════════════════════════════════════════

const sseClients = new Set();

function broadcastSSE(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  let sent = 0;
  for (const res of sseClients) {
    try {
      res.write(msg);
      sent++;
    } catch (e) {
      sseClients.delete(res);
    }
  }
  if (sent > 0) {
    console.log(`[SSE] Broadcast to ${sent} clients:`, data.type);
  }
}

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
  
  sseClients.add(res);
  console.log(`[SSE] Client connected (total: ${sseClients.size})`);

  const pingInterval = setInterval(() => {
    try {
      res.write(`data: ${JSON.stringify({ type: 'ping', time: Date.now() })}\n\n`);
    } catch {
      clearInterval(pingInterval);
    }
  }, 30000);

  req.on('close', () => {
    clearInterval(pingInterval);
    sseClients.delete(res);
    console.log(`[SSE] Client disconnected (total: ${sseClients.size})`);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// WEBHOOK
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/webhook/incident', express.json(), (req, res) => {
  const { type, incidentId, folio, status } = req.body;
  console.log('[WEBHOOK] Received:', type, { incidentId, folio, status });
  
  broadcastSSE({
    type: type || 'incident_update',
    incidentId,
    folio,
    status
  });
  
  res.json({ ok: true });
});

// POST /api/auth/login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ 
      error: 'missing_credentials',
      message: 'Usuario y contraseña son requeridos' 
    });
  }
  
  const user = findUserByUsername(username);
  
  if (!user) {
    console.log(`[AUTH] User not found: ${username}`);
    return res.status(401).json({ 
      error: 'invalid_credentials',
      message: 'Usuario no encontrado' 
    });
  }
  
  if (!validatePassword(user, password)) {
    console.log(`[AUTH] Invalid password for: ${username}`);
    return res.status(401).json({ 
      error: 'invalid_credentials',
      message: 'Contraseña incorrecta' 
    });
  }
  
  const token = generateToken(user);
  
  console.log(`[AUTH] ✅ Login successful: ${user.nombre} (${user.cargo})`);
  
  res.json({ 
    ok: true,
    token,
    user: {
      phoneId: user.phoneId,
      nombre: user.nombre,
      cargo: user.cargo,
      rol: user.rol,
      team: user.team
    }
  });
});

// GET /api/auth/verify
app.get('/api/auth/verify', (req, res) => {
  const authHeader = req.headers['authorization'];
  
  if (!authHeader) {
    return res.json({ valid: false });
  }
  
  const token = authHeader.replace('Bearer ', '');
  const decoded = verifyToken(token);
  
  if (!decoded) {
    return res.json({ valid: false });
  }
  
  res.json({ 
    valid: true,
    user: {
      phoneId: decoded.phoneId,
      nombre: decoded.nombre,
      cargo: decoded.cargo,
      rol: decoded.rol,
      team: decoded.team
    }
  });
});

// GET /api/auth/me
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ 
    ok: true,
    user: req.user
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// API ENDPOINTS
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/health', (req, res) => {
  const dbExists = fs.existsSync(DB_PATH);
  res.json({ 
    ok: dbExists, 
    db: DB_PATH,
    attachments: ATTACHMENTS_PATH,
    users: USERS_PATH
  });
});

app.get('/api/users', requireAuth, (req, res) => {
  try {
    const users = getUsers();
    res.json(users);
  } catch (e) {
    console.error('[API] /users error', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/incidents
app.get('/api/incidents', requireAuth, (req, res) => {
  try {
    const { status, area, q, sort, limit, offset } = req.query;
    
    const result = withDb(db => {
      const where = [];
      const params = [];

      if (status) {
        where.push('status = ?');
        params.push(status);
      }
      if (area) {
        where.push('area_destino = ?');
        params.push(area.toUpperCase());
      }
      if (q) {
        where.push('(descripcion LIKE ? OR interpretacion LIKE ? OR lugar LIKE ? OR folio LIKE ?)');
        const qVal = `%${q}%`;
        params.push(qVal, qVal, qVal, qVal);
      }

      const [sortFieldRaw, sortDirRaw] = String(sort || '').split(':');
      const allowedSort = new Set(['created_at', 'updated_at', 'folio']);
      const sortField = allowedSort.has(sortFieldRaw) ? sortFieldRaw : 'created_at';
      const sortDir = (sortDirRaw || 'desc').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

      const W = where.length ? ('WHERE ' + where.join(' AND ')) : '';
      
      const limitNum = clamp(Number(limit) || 50, 1, 200);
      const offsetNum = Math.max(0, Number(offset) || 0);
      
      const totalParams = [...params];
      const total = db.prepare(`SELECT COUNT(*) as total FROM incidents ${W}`).get(totalParams)?.total || 0;
      
      params.push(limitNum, offsetNum);
      const rows = db.prepare(`
        SELECT id, folio, created_at, updated_at, status, chat_id,
               descripcion, interpretacion, lugar, area_destino, attachments_json
        FROM incidents
        ${W}
        ORDER BY ${sortField} ${sortDir}
        LIMIT ? OFFSET ?
      `).all(params);
      
      return { total, rows };
    });

    const items = result.rows.map(r => ({
      ...r,
      attachments: safeParse(r.attachments_json, []),
      // Resolver nombre para display usando chat_id
      origin_display: getUserDisplay(r.chat_id) || r.chat_id
    }));

    res.json({ ok: true, total: result.total, items });
  } catch (e) {
    console.error('[API] /incidents error', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/incidents/:id
app.get('/api/incidents/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    
    const result = withDb(db => {
      const incident = db.prepare(`
        SELECT * FROM incidents 
        WHERE id = ? OR folio = ?
        LIMIT 1
      `).get(id, id);
      
      if (!incident) return null;
      
      const events = db.prepare(`
        SELECT * FROM incident_events 
        WHERE incident_id = ?
        ORDER BY created_at ASC
      `).all(incident.id);
      
      return {
        ...incident,
        attachments: safeParse(incident.attachments_json, []),
        // Resolver nombre para display usando chat_id
        origin_display: getUserDisplay(incident.chat_id) || incident.chat_id,
        events: events.map(e => ({
          ...e,
          payload: safeParse(e.payload_json, {})
        }))
      };
    });

    if (!result) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    res.json(result);
  } catch (e) {
    console.error('[API] /incidents/:id error', e);
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/incidents/:id/status
app.patch('/api/incidents/:id/status', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    const result = withDbWrite(db => {
      const incident = db.prepare('SELECT id, status, folio FROM incidents WHERE id = ? OR folio = ?').get(id, id);
      
      if (!incident) return null;
      
      const oldStatus = incident.status;
      const ts = new Date().toISOString();
      const eventId = require('crypto').randomUUID();
      
      db.prepare('UPDATE incidents SET status = ?, updated_at = ? WHERE id = ?')
        .run(status, ts, incident.id);
      
      db.prepare(`
        INSERT INTO incident_events (id, incident_id, created_at, event_type, payload_json)
        VALUES (?, ?, ?, 'status_change', ?)
      `).run(
        eventId,
        incident.id,
        ts,
        JSON.stringify({ from: oldStatus, to: status, source: 'dashboard' })
      );
      
      return { 
        ok: true, 
        folio: incident.folio,
        oldStatus: oldStatus
      };
    });

    if (!result) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    // Notificar al bot
    fetch('http://localhost:3030/api/webhook/status-change', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        incidentId: id,
        folio: result.folio,
        from: result.oldStatus,
        to: status,
        source: 'dashboard'
      })
    }).then(r => {
      console.log('[DASHBOARD] Bot notified:', r.ok ? 'OK' : 'FAILED');
    }).catch(err => {
      console.warn('[DASHBOARD] Bot notification failed:', err.message);
    });

    broadcastSSE({
      type: 'status_change',
      incidentId: id,
      status
    });

    res.json({ ok: result.ok, folio: result.folio });
  } catch (e) {
    console.error('[API] PATCH status error', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/incidents/:id/comment
app.post('/api/incidents/:id/comment', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const { text } = req.body;
    
    const result = withDbWrite(db => {
      const incident = db.prepare('SELECT id, folio, chat_id, area_destino FROM incidents WHERE id = ? OR folio = ?').get(id, id);
      
      if (!incident) return null;
      
      const ts = new Date().toISOString();
      const eventId = require('crypto').randomUUID();
      
      db.prepare(`
        INSERT INTO incident_events (id, incident_id, created_at, event_type, payload_json)
        VALUES (?, ?, ?, 'comment_text', ?)
      `).run(
        eventId,
        incident.id,
        ts,
        JSON.stringify({ text, by: 'dashboard', source: 'dashboard' })
      );
      
      return { 
        ok: true, 
        folio: incident.folio,
        chat_id: incident.chat_id,
        area_destino: incident.area_destino
      };
    });

    if (!result) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    // Notificar al bot para que envíe el comentario
    fetch('http://localhost:3030/api/webhook/comment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        incidentId: id,
        folio: result.folio,
        chat_id: result.chat_id,
        area_destino: result.area_destino,
        text,
        source: 'dashboard'
      })
    }).then(r => {
      console.log('[DASHBOARD] Bot notified for comment:', r.ok ? 'OK' : 'FAILED');
    }).catch(err => {
      console.warn('[DASHBOARD] Bot notification failed:', err.message);
    });

    broadcastSSE({
      type: 'new_comment',
      incidentId: id
    });

    res.json({ ok: result.ok, folio: result.folio });
  } catch (e) {
    console.error('[API] POST comment error', e);
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// START SERVER
// ══════════════════════════════════════════════════════════════════════════════

initializeDB();

app.listen(PORT, () => {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  🖥️  VICEBOT DASHBOARD');
  console.log(`  📍 http://localhost:${PORT}`);
  console.log('═══════════════════════════════════════════════════════════');
});

// ══════════════════════════════════════════════════════════════════════════════
// REPORTES
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/reports/preview
app.get('/api/reports/preview', requireAuth, (req, res) => {
  try {
    const { startDate, endDate, areas, statuses, limit } = req.query;
    
    const result = withDb(db => {
      const where = [];
      const params = [];

      if (startDate) {
        where.push('created_at >= ?');
        params.push(`${startDate}T00:00:00.000Z`);
      }
      if (endDate) {
        where.push('created_at <= ?');
        params.push(`${endDate}T23:59:59.999Z`);
      }
      if (areas) {
        const areasList = areas.split(',').map(a => a.trim().toUpperCase());
        where.push(`area_destino IN (${areasList.map(() => '?').join(',')})`);
        params.push(...areasList);
      }
      if (statuses) {
        const statusList = statuses.split(',').map(s => s.trim());
        where.push(`status IN (${statusList.map(() => '?').join(',')})`);
        params.push(...statusList);
      }

      const W = where.length ? ('WHERE ' + where.join(' AND ')) : '';
      const limitNum = Math.min(Number(limit) || 100, 1000);

      // Estadísticas
      const total = db.prepare(`SELECT COUNT(*) as total FROM incidents ${W}`).get(params)?.total || 0;
      
      const byStatus = {};
      const statusRows = db.prepare(`
        SELECT status, COUNT(*) as count 
        FROM incidents ${W}
        GROUP BY status
      `).all(params);
      statusRows.forEach(r => { byStatus[r.status] = r.count; });

      const byArea = {};
      const areaRows = db.prepare(`
        SELECT area_destino, COUNT(*) as count 
        FROM incidents ${W}
        GROUP BY area_destino
      `).all(params);
      areaRows.forEach(r => { byArea[r.area_destino] = r.count; });

      // Vista previa
      params.push(limitNum);
      const preview = db.prepare(`
        SELECT folio, created_at as fecha, status as estado, area_destino as area, 
               lugar, descripcion
        FROM incidents ${W}
        ORDER BY created_at DESC
        LIMIT ?
      `).all(params);

      return {
        stats: { total, byStatus, byArea },
        preview
      };
    });

    res.json(result);
  } catch (e) {
    console.error('[API] /reports/preview error', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/reports/generate - PROFESIONAL
app.post('/api/reports/generate', requireAuth, async (req, res) => {
  try {
    const { startDate, endDate, areas, statuses } = req.body;
    
    const ExcelJS = require('exceljs');
    
    // Helper functions para formato profesional
    const COLORS = {
      primary: 'CC7722',
      primaryDark: 'A65D00',
      lightGray: 'F8F9FA',
      mediumGray: 'E9ECEF',
      borderGray: 'DEE2E6',
      statusOpen: 'E3F2FD',
      statusProgress: 'FFF8E1',
      statusDone: 'E8F5E9',
      statusCanceled: 'FFEBEE',
      white: 'FFFFFF',
      textDark: '212529',
      textMuted: '6C757D',
    };
    
    const prettyStatus = (status) => {
      const map = {
        open: 'Abierto',
        in_progress: 'En Progreso',
        done: 'Completado',
        canceled: 'Cancelado',
      };
      return map[status] || status;
    };
    
    const prettyArea = (area) => {
      const map = {
        it: 'SISTEMAS',
        mant: 'MANTENIMIENTO',
        ama: 'AMA DE LLAVES',
        seg: 'SEGURIDAD',
        rs: 'ROOM SERVICE',
        exp: 'EXPERIENCIAS',
      };
      return map[String(area || '').toLowerCase()] || String(area || '').toUpperCase();
    };
    
    const applyStatusColor = (cell, status) => {
      const colorMap = {
        open: COLORS.statusOpen,
        in_progress: COLORS.statusProgress,
        done: COLORS.statusDone,
        canceled: COLORS.statusCanceled,
      };
      const color = colorMap[status];
      if (color) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: color }
        };
      }
    };

    // Obtener datos
    const data = withDb(db => {
      const where = [];
      const params = [];

      if (startDate) {
        where.push('created_at >= ?');
        params.push(`${startDate}T00:00:00.000Z`);
      }
      if (endDate) {
        where.push('created_at <= ?');
        params.push(`${endDate}T23:59:59.999Z`);
      }
      if (areas && areas.length > 0) {
        const areasList = areas.map(a => a.toUpperCase());
        where.push(`area_destino IN (${areasList.map(() => '?').join(',')})`);
        params.push(...areasList);
      }
      if (statuses && statuses.length > 0) {
        where.push(`status IN (${statuses.map(() => '?').join(',')})`);
        params.push(...statuses);
      }

      const W = where.length ? ('WHERE ' + where.join(' AND ')) : '';

      return db.prepare(`
        SELECT folio, created_at, status, area_destino, lugar, descripcion, 
               chat_id, updated_at
        FROM incidents ${W}
        ORDER BY created_at DESC
      `).all(params);
    });

    // Crear workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Incidencias');

    // Definir columnas
    const columns = [
      { header: 'Folio', key: 'folio', width: 15 },
      { header: 'Estado', key: 'status', width: 18 },
      { header: 'Área', key: 'area', width: 18 },
      { header: 'Ubicación', key: 'lugar', width: 25 },
      { header: 'Descripción', key: 'descripcion', width: 50 },
      { header: 'Reportado por', key: 'reportado_por', width: 30 },
      { header: 'Fecha Creación', key: 'created', width: 20 },
      { header: 'Última Actualización', key: 'updated', width: 20 }
    ];
    
    worksheet.columns = columns;

    // Agregar datos
    data.forEach(row => {
      worksheet.addRow({
        folio: row.folio,
        status: prettyStatus(row.status),
        area: prettyArea(row.area_destino),
        lugar: row.lugar,
        descripcion: row.descripcion,
        reportado_por: getUserDisplay(row.chat_id) || row.chat_id,
        created: new Date(row.created_at).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }),
        updated: new Date(row.updated_at).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })
      });
    });

    // HEADER PROFESIONAL
    worksheet.spliceRows(1, 0, [], []);
    
    // Fila 1: Título
    worksheet.getRow(1).height = 40;
    worksheet.mergeCells(1, 1, 1, columns.length);
    const titleCell = worksheet.getCell(1, 1);
    titleCell.value = '📊  REPORTE DE INCIDENCIAS';
    titleCell.font = { bold: true, size: 18, color: { argb: COLORS.white } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.primary } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    
    for (let col = 1; col <= columns.length; col++) {
      worksheet.getCell(1, col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.primary } };
    }
    
    // Fila 2: Subtítulo
    worksheet.getRow(2).height = 22;
    worksheet.mergeCells(2, 1, 2, columns.length);
    const subtitleCell = worksheet.getCell(2, 1);
    
    const subtitleParts = [];
    if (startDate && endDate) {
      subtitleParts.push(`Periodo: ${startDate} - ${endDate}`);
    } else {
      subtitleParts.push('Periodo: Todo el historial');
    }
    if (areas?.length) {
      subtitleParts.push(`Áreas: ${areas.map(a => prettyArea(a)).join(', ')}`);
    } else {
      subtitleParts.push('Áreas: Todas');
    }
    subtitleParts.push(`Generado: ${new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}`);
    
    subtitleCell.value = subtitleParts.join('  │  ');
    subtitleCell.font = { italic: true, size: 10, color: { argb: COLORS.textMuted } };
    subtitleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.mediumGray } };
    subtitleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    
    for (let col = 1; col <= columns.length; col++) {
      worksheet.getCell(2, col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.mediumGray } };
    }
    
    // Fila 3: Headers
    worksheet.getRow(3).height = 28;
    for (let col = 1; col <= columns.length; col++) {
      const cell = worksheet.getCell(3, col);
      cell.font = { bold: true, size: 11, color: { argb: COLORS.white } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.primaryDark } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = {
        top: { style: 'medium', color: { argb: COLORS.primaryDark } },
        bottom: { style: 'medium', color: { argb: COLORS.primaryDark } },
        left: { style: 'thin', color: { argb: COLORS.primaryDark } },
        right: { style: 'thin', color: { argb: COLORS.primaryDark } },
      };
    }
    
    // Estilizar filas de datos
    const dataStartRow = 4;
    const dataEndRow = 3 + data.length;
    
    for (let row = dataStartRow; row <= dataEndRow; row++) {
      const isEven = (row - dataStartRow) % 2 === 0;
      const statusValue = data[row - 4]?.status;
      
      for (let col = 1; col <= columns.length; col++) {
        const cell = worksheet.getCell(row, col);
        cell.font = { size: 10, color: { argb: COLORS.textDark } };
        cell.alignment = { vertical: 'middle', wrapText: true };
        cell.border = {
          top: { style: 'thin', color: { argb: COLORS.borderGray } },
          bottom: { style: 'thin', color: { argb: COLORS.borderGray } },
          left: { style: 'thin', color: { argb: COLORS.borderGray } },
          right: { style: 'thin', color: { argb: COLORS.borderGray } },
        };
        
        // Filas alternas (excepto columna de estado)
        if (!isEven && col !== 2) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: COLORS.lightGray }
          };
        }
        
        // Color de estado (columna 2)
        if (col === 2) {
          applyStatusColor(cell, statusValue);
        }
      }
    }
    
    // Filtros automáticos y freeze
    worksheet.autoFilter = `A3:H3`;
    worksheet.views = [{ state: 'frozen', ySplit: 3 }];

    // Generar archivo
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `incidencias_${timestamp.replace('T', '_').slice(0, 15).replace(/-/g, '')}.xlsx`;
    const filepath = path.join(ATTACHMENTS_PATH, filename);

    await workbook.xlsx.writeFile(filepath);

    res.json({
      ok: true,
      fileName: filename,
      downloadUrl: `/attachments/${filename}`,
      recordCount: data.length
    });

  } catch (e) {
    console.error('[API] /reports/generate error', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});


// ══════════════════════════════════════════════════════════════════════════════
// ENDPOINTS ADICIONALES
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/debug - Información de debug
app.get('/api/debug', requireAuth, (req, res) => {
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
          const tablesResult = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
          const tableNames = tablesResult.map(t => t.name);
          
          let count = 0;
          let sample = [];
          
          if (tableNames.includes('incidents')) {
            const countResult = db.prepare('SELECT COUNT(*) as c FROM incidents').get();
            count = countResult?.c || 0;
            sample = db.prepare('SELECT id, folio, status, created_at FROM incidents ORDER BY created_at DESC LIMIT 5').all();
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

// GET /api/reports/download/:filename
app.get('/api/reports/download/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    
    // Validar nombre de archivo (seguridad)
    if (!filename || !/^incidencias_[\w\-]+\.xlsx$/.test(filename)) {
      return res.status(400).json({ error: 'invalid_filename' });
    }
    
    const filePath = path.join(ATTACHMENTS_PATH, filename);
    
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

// POST /api/incidents/create - Crear nueva incidencia desde dashboard
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

app.post('/api/incidents/create', requireAuth, upload.array('attachments', 5), async (req, res) => {
  try {
    const { descripcion, area_destino, lugar, chat_id } = req.body;
    const files = req.files || [];
    
    // Validar campos requeridos
    if (!descripcion || !area_destino || !lugar || !chat_id) {
      return res.status(400).json({ 
        error: 'missing_fields',
        message: 'Faltan campos requeridos: descripcion, area_destino, lugar, chat_id'
      });
    }
    
    // Preparar datos para el bot
    const incidentData = {
      descripcion: descripcion.trim(),
      area_destino: area_destino.toUpperCase(),
      lugar: lugar.trim(),
      chat_id: chat_id.trim(),
      source: 'dashboard',
      attachments: files.map(f => ({
        filename: f.originalname,
        mimetype: f.mimetype,
        size: f.size,
        data: f.buffer.toString('base64')
      }))
    };
    
    console.log('[DASHBOARD] Creating incident from dashboard:', {
      area: incidentData.area_destino,
      lugar: incidentData.lugar,
      chat_id: incidentData.chat_id,
      attachments: incidentData.attachments.length
    });
    
    // Enviar al BOT para que cree la incidencia y notifique
    const BOT_WEBHOOK_URL = process.env.BOT_WEBHOOK_URL || 'http://localhost:3030/api/webhook/create-incident';
    
    try {
      const botResponse = await fetch(BOT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(incidentData)
      });
      
      if (!botResponse.ok) {
        const botError = await botResponse.json().catch(() => ({}));
        throw new Error(botError.message || `Bot returned ${botResponse.status}`);
      }
      
      const botResult = await botResponse.json();
      console.log('[DASHBOARD] Incident created by bot:', botResult.folio);
      
      // Broadcast a clientes SSE
      broadcastSSE({ 
        type: 'new_incident', 
        incidentId: botResult.incidentId,
        folio: botResult.folio
      });
      
      res.json({ 
        ok: true, 
        incidentId: botResult.incidentId,
        folio: botResult.folio,
        message: 'Incidencia creada correctamente'
      });
      
    } catch (botErr) {
      console.error('[DASHBOARD] Bot error creating incident:', botErr.message);
      return res.status(502).json({ 
        error: 'bot_unavailable', 
        message: 'No se pudo crear la incidencia. Verifica que el bot esté corriendo.',
        details: botErr.message
      });
    }
    
  } catch (e) {
    console.error('[API] POST /incidents/create error', e);
    res.status(500).json({ error: 'internal_error', message: e.message });
  }
});

// POST /api/webhook/notify - Webhook alternativo
app.post('/api/webhook/notify', express.json(), (req, res) => {
  const { type, incidentId, folio, status } = req.body;
  console.log('[WEBHOOK] Notify received:', type, { incidentId, folio, status });
  
  broadcastSSE({
    type: type || 'incident_update',
    incidentId,
    folio,
    status
  });
  
  res.json({ ok: true });
});