const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');
const dataDir = path.join(__dirname, 'data');
const reviewsFile = path.join(dataDir, 'reviews.json');
const adminsFile = path.join(dataDir, 'admins.json');
const sessions = new Map();

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function ensureDataFiles() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(reviewsFile)) fs.writeFileSync(reviewsFile, '[]', 'utf8');
  if (!fs.existsSync(adminsFile)) fs.writeFileSync(adminsFile, '[]', 'utf8');
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, message) {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(message);
}

function sanitizeText(value, maxLength) {
  return String(value || '').replace(/[<>]/g, '').trim().slice(0, maxLength);
}

function readJson(filePath) {
  ensureDataFiles();
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function readReviews() { return readJson(reviewsFile); }
function saveReviews(reviews) { writeJson(reviewsFile, reviews); }
function readAdmins() { return readJson(adminsFile); }
function saveAdmins(admins) { writeJson(adminsFile, admins); }

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1e6) {
        req.socket.destroy();
        reject(new Error('Request too large.'));
      }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(new Error('Invalid JSON payload.')); }
    });
    req.on('error', reject);
  });
}

function serveFile(filePath, res) {
  fs.readFile(filePath, (error, data) => {
    if (error) return sendText(res, 404, 'Not found');
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, originalHash] = String(storedHash).split(':');
  if (!salt || !originalHash) return false;
  const hashBuffer = Buffer.from(originalHash, 'hex');
  const testBuffer = crypto.scryptSync(password, salt, 64);
  return hashBuffer.length === testBuffer.length && crypto.timingSafeEqual(hashBuffer, testBuffer);
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return header.split(';').reduce((acc, part) => {
    const [key, ...rest] = part.trim().split('=');
    if (!key) return acc;
    acc[key] = decodeURIComponent(rest.join('='));
    return acc;
  }, {});
}

function getAuthenticatedAdmin(req) {
  const cookies = parseCookies(req);
  const sessionId = cookies.admin_session;
  if (!sessionId || !sessions.has(sessionId)) return null;
  const session = sessions.get(sessionId);
  if (session.expiresAt < Date.now()) {
    sessions.delete(sessionId);
    return null;
  }
  return session;
}

function requireAdmin(req, res) {
  const admin = getAuthenticatedAdmin(req);
  if (!admin) {
    sendJson(res, 401, { error: 'Admin login required.' });
    return null;
  }
  return admin;
}

function createSession(username) {
  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, { username, expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 7 });
  return sessionId;
}

function authCookie(sessionId) {
  return `admin_session=${sessionId}; HttpOnly; Path=/; Max-Age=604800; SameSite=Lax`;
}

function clearAuthCookie() {
  return 'admin_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax';
}

function reviewSummary(review) {
  return {
    id: review.id,
    name: review.name,
    message: review.message,
    rating: review.rating,
    createdAt: review.createdAt,
    reply: review.reply || null
  };
}

async function handlePublicReviews(req, res) {
  if (req.method === 'GET') {
    const reviews = readReviews().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).map(reviewSummary);
    return sendJson(res, 200, reviews);
  }

  if (req.method === 'POST') {
    try {
      const parsed = await parseJsonBody(req);
      const name = sanitizeText(parsed.name, 60);
      const message = sanitizeText(parsed.message, 300);
      const rating = Number(parsed.rating);
      if (!name || !message || !Number.isInteger(rating) || rating < 1 || rating > 5) {
        return sendJson(res, 400, { error: 'Please send a valid name, review, and rating.' });
      }
      const reviews = readReviews();
      const review = { id: Date.now(), name, message, rating, createdAt: new Date().toISOString(), reply: null };
      reviews.push(review);
      saveReviews(reviews);
      return sendJson(res, 201, reviewSummary(review));
    } catch (error) {
      return sendJson(res, 400, { error: error.message });
    }
  }

  return sendJson(res, 405, { error: 'Method not allowed.' });
}

async function handleAdminAuth(req, res, pathname) {
  const admins = readAdmins();

  if (pathname === '/api/admin/status' && req.method === 'GET') {
    const session = getAuthenticatedAdmin(req);
    sendJson(res, 200, { setupRequired: admins.length === 0, authenticated: Boolean(session), username: session ? session.username : null });
    return true;
  }

  if (pathname === '/api/admin/signup' && req.method === 'POST') {
    if (admins.length > 0) {
      sendJson(res, 403, { error: 'Admin signup is already completed. Please log in.' });
      return true;
    }
    try {
      const parsed = await parseJsonBody(req);
      const username = sanitizeText(parsed.username, 32);
      const password = String(parsed.password || '').trim();
      if (!username || password.length < 6) {
        sendJson(res, 400, { error: 'Use a username and a password with at least 6 characters.' });
        return true;
      }
      const admin = { id: Date.now(), username, passwordHash: hashPassword(password), createdAt: new Date().toISOString() };
      saveAdmins([admin]);
      const sessionId = createSession(username);
      sendJson(res, 201, { message: 'Admin account created.', username }, { 'Set-Cookie': authCookie(sessionId) });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return true;
  }

  if (pathname === '/api/admin/login' && req.method === 'POST') {
    try {
      const parsed = await parseJsonBody(req);
      const username = sanitizeText(parsed.username, 32);
      const password = String(parsed.password || '');
      const admin = admins.find(item => item.username === username);
      if (!admin || !verifyPassword(password, admin.passwordHash)) {
        sendJson(res, 401, { error: 'Invalid username or password.' });
        return true;
      }
      const sessionId = createSession(admin.username);
      sendJson(res, 200, { message: 'Login successful.', username: admin.username }, { 'Set-Cookie': authCookie(sessionId) });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return true;
  }

  if (pathname === '/api/admin/logout' && req.method === 'POST') {
    const cookies = parseCookies(req);
    if (cookies.admin_session) sessions.delete(cookies.admin_session);
    sendJson(res, 200, { message: 'Logged out.' }, { 'Set-Cookie': clearAuthCookie() });
    return true;
  }

  return false;
}

async function handleAdminReviews(req, res, pathname) {
  if (pathname === '/api/admin/reviews' && req.method === 'GET') {
    const admin = requireAdmin(req, res);
    if (!admin) return true;
    const reviews = readReviews().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    sendJson(res, 200, { username: admin.username, reviews: reviews.map(reviewSummary) });
    return true;
  }

  const replyMatch = pathname.match(/^\/api\/admin\/reviews\/(\d+)\/reply$/);
  if (replyMatch && req.method === 'POST') {
    const admin = requireAdmin(req, res);
    if (!admin) return true;
    try {
      const parsed = await parseJsonBody(req);
      const reply = sanitizeText(parsed.reply, 300);
      if (!reply) {
        sendJson(res, 400, { error: 'Reply cannot be empty.' });
        return true;
      }
      const reviewId = Number(replyMatch[1]);
      const reviews = readReviews();
      const review = reviews.find(item => item.id === reviewId);
      if (!review) {
        sendJson(res, 404, { error: 'Review not found.' });
        return true;
      }
      review.reply = { text: reply, author: admin.username, createdAt: new Date().toISOString() };
      saveReviews(reviews);
      sendJson(res, 200, reviewSummary(review));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return true;
  }

  const deleteMatch = pathname.match(/^\/api\/admin\/reviews\/(\d+)$/);
  if (deleteMatch && req.method === 'DELETE') {
    const admin = requireAdmin(req, res);
    if (!admin) return true;
    const reviewId = Number(deleteMatch[1]);
    const reviews = readReviews();
    const nextReviews = reviews.filter(item => item.id !== reviewId);
    if (nextReviews.length === reviews.length) {
      sendJson(res, 404, { error: 'Review not found.' });
      return true;
    }
    saveReviews(nextReviews);
    sendJson(res, 200, { message: 'Review deleted.' });
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = requestUrl.pathname;

  if (pathname === '/api/reviews') {
    await handlePublicReviews(req, res);
    return;
  }

  if (pathname.startsWith('/api/admin/')) {
    if (await handleAdminAuth(req, res, pathname)) return;
    if (await handleAdminReviews(req, res, pathname)) return;
    sendJson(res, 404, { error: 'Admin route not found.' });
    return;
  }

  const safePath = pathname === '/' ? path.join(publicDir, 'index.html') : path.join(publicDir, pathname);
  const resolvedPath = path.normalize(safePath);
  if (!resolvedPath.startsWith(publicDir)) return sendText(res, 403, 'Forbidden');
  serveFile(resolvedPath, res);
});

if (require.main === module) {
  ensureDataFiles();
  server.listen(PORT, () => {
    console.log(`Personal blog running at http://localhost:${PORT}`);
  });
}

module.exports = server;
