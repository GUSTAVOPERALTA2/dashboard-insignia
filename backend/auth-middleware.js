// auth-middleware.js
// Middleware de autenticación con JWT usando users.json

const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

// Secreto para firmar tokens (debe estar en .env en producción)
const JWT_SECRET = process.env.JWT_SECRET || 'vicebot-secret-change-this-in-production';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '24h';

// Path al archivo users.json
const PROJECT_ROOT = process.env.VICEBOT_PROJECT_PATH || 
  path.resolve(__dirname, '..', '..', 'proyecto');
const USERS_PATH = process.env.VICEBOT_USERS_PATH || 
  path.join(PROJECT_ROOT, 'data', 'users.json');

console.log('[AUTH] Users file:', USERS_PATH);

let usersCache = null;
let usersCacheTime = 0;
const CACHE_TTL = 60000; // 1 minuto

/**
 * Cargar usuarios desde users.json
 * Estructura: { "phoneId@c.us": { nombre, cargo, rol, team, titulo } }
 */
function loadUsers() {
  const now = Date.now();
  
  // Usar cache si es reciente
  if (usersCache && (now - usersCacheTime) < CACHE_TTL) {
    return usersCache;
  }
  
  try {
    if (!fs.existsSync(USERS_PATH)) {
      console.error('[AUTH] users.json not found at:', USERS_PATH);
      return {};
    }
    
    const data = fs.readFileSync(USERS_PATH, 'utf8');
    const users = JSON.parse(data);
    
    usersCache = users;
    usersCacheTime = now;
    
    const adminCount = Object.values(users).filter(u => u.rol === 'admin').length;
    console.log(`[AUTH] Loaded ${Object.keys(users).length} users (${adminCount} admins)`);
    
    return users;
  } catch (e) {
    console.error('[AUTH] Error loading users.json:', e.message);
    return {};
  }
}

/**
 * Buscar usuario por username (puede ser phoneId completo o solo el número)
 */
function findUserByUsername(username) {
  const users = loadUsers();
  
  // Intento 1: Buscar directamente por key (phoneId@c.us)
  if (users[username]) {
    return { phoneId: username, ...users[username] };
  }
  
  // Intento 2: Buscar por número sin @c.us
  const withSuffix = `${username}@c.us`;
  if (users[withSuffix]) {
    return { phoneId: withSuffix, ...users[withSuffix] };
  }
  
  // Intento 3: Buscar por los últimos 10 dígitos (por si tiene código de país diferente)
  const cleanNumber = username.replace(/\D/g, '').slice(-10);
  
  for (const [phoneId, userData] of Object.entries(users)) {
    const userNumber = phoneId.split('@')[0].slice(-10);
    if (userNumber === cleanNumber) {
      return { phoneId, ...userData };
    }
  }
  
  return null;
}

/**
 * Validar contraseña
 * Para desarrollo: usar los últimos 4 dígitos del teléfono como password
 * Para producción: agregar campo 'password' en users.json o usar bcrypt
 */
function validatePassword(user, password) {
  // Si el usuario tiene password definido, usarlo
  if (user.password) {
    return user.password === password;
  }
  
  // Password por defecto: últimos 4 dígitos del teléfono
  const phoneNumber = user.phoneId.split('@')[0];
  const defaultPassword = phoneNumber.slice(-4);
  
  return password === defaultPassword;
}

/**
 * Generar token JWT
 */
function generateToken(user) {
  const payload = {
    phoneId: user.phoneId,
    username: user.phoneId,
    nombre: user.nombre,
    cargo: user.cargo,
    rol: user.rol || 'user',
    team: user.team
  };
  
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

/**
 * Verificar token JWT
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

/**
 * Middleware para proteger rutas
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  
  if (!authHeader) {
    return res.status(401).json({ error: 'unauthorized', message: 'No token provided' });
  }
  
  const token = authHeader.replace('Bearer ', '');
  const decoded = verifyToken(token);
  
  if (!decoded) {
    return res.status(401).json({ error: 'unauthorized', message: 'Invalid or expired token' });
  }
  
  // Adjuntar usuario al request
  req.user = decoded;
  next();
}

/**
 * Middleware para requerir rol admin
 */
function requireAdmin(req, res, next) {
  const authHeader = req.headers['authorization'];
  
  if (!authHeader) {
    return res.status(401).json({ error: 'unauthorized', message: 'No token provided' });
  }
  
  const token = authHeader.replace('Bearer ', '');
  const decoded = verifyToken(token);
  
  if (!decoded) {
    return res.status(401).json({ error: 'unauthorized', message: 'Invalid or expired token' });
  }
  
  if (decoded.rol !== 'admin') {
    return res.status(403).json({ error: 'forbidden', message: 'Admin access required' });
  }
  
  req.user = decoded;
  next();
}

/**
 * Middleware opcional - permite acceso sin auth pero adjunta usuario si existe
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  
  if (authHeader) {
    const token = authHeader.replace('Bearer ', '');
    const decoded = verifyToken(token);
    if (decoded) {
      req.user = decoded;
    }
  }
  
  next();
}

module.exports = {
  loadUsers,
  findUserByUsername,
  validatePassword,
  generateToken,
  verifyToken,
  requireAuth,
  requireAdmin,
  optionalAuth,
  JWT_SECRET
};