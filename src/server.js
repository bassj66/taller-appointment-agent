'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

// Load .env if present (built into Node 20.12+; ignored on older versions).
const ENV_FILE = path.join(__dirname, '..', '.env');
if (fs.existsSync(ENV_FILE) && typeof process.loadEnvFile === 'function') process.loadEnvFile(ENV_FILE);

const config = require('./config');
const { AppointmentStore } = require('./store');
const { createAgent } = require('./agent');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
const MAX_BODY = 20 * 1024;

function sendJson(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('Body too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  const file = path.normalize(path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname));
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return sendJson(res, 404, { error: 'No encontrado' });
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

/** Builds the HTTP handler. Everything is injectable so tests can run it in memory. */
function createApp({ store = new AppointmentStore(), agent = createAgent({ store }), adminToken = process.env.ADMIN_TOKEN } = {}) {
  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const route = `${req.method} ${url.pathname}`;

    try {
      switch (route) {
        case 'GET /api/health':
          return sendJson(res, 200, { ok: true, mode: agent.mode });

        case 'GET /api/services':
          return sendJson(res, 200, { workshop: config.workshop, services: config.services });

        case 'POST /api/chat': {
          const { sessionId, message } = await readJson(req);
          if (typeof sessionId !== 'string' || !sessionId || typeof message !== 'string' || !message.trim()) {
            return sendJson(res, 400, { error: 'sessionId y message son obligatorios' });
          }
          if (message.length > 2000) return sendJson(res, 400, { error: 'Mensaje demasiado largo' });
          try {
            const result = await agent.reply(sessionId, message);
            return sendJson(res, 200, { ...result, mode: agent.mode });
          } catch (err) {
            console.error('[chat] error:', err.message);
            return sendJson(res, 502, { error: 'El asistente no está disponible ahora mismo. Inténtalo de nuevo.' });
          }
        }

        case 'POST /api/chat/reset': {
          const { sessionId } = await readJson(req);
          if (sessionId) agent.reset(sessionId);
          return sendJson(res, 200, { ok: true });
        }

        // Workshop-side view of the agenda. Protected by a token when ADMIN_TOKEN is set.
        case 'GET /api/appointments': {
          if (adminToken && req.headers['x-admin-token'] !== adminToken) {
            return sendJson(res, 401, { error: 'No autorizado' });
          }
          const date = url.searchParams.get('date');
          return sendJson(res, 200, { appointments: date ? store.onDate(date) : store.all() });
        }

        default:
          if (req.method === 'GET') return serveStatic(req, res, url.pathname);
          return sendJson(res, 404, { error: 'No encontrado' });
      }
    } catch (err) {
      return sendJson(res, err.status || 500, { error: err.status ? err.message : 'Error interno' });
    }
  };
}

function createServer(options) {
  return http.createServer(createApp(options));
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createServer().listen(port, () => {
    const mode = process.env.ANTHROPIC_API_KEY ? 'Claude (IA real)' : 'DEMO (sin API key, reglas locales)';
    console.log(`\n🚗 ${config.workshop.name} — agente de citas`);
    console.log(`   Modo:   ${mode}`);
    console.log(`   Chat:   http://localhost:${port}`);
    console.log(`   Agenda: http://localhost:${port}/api/appointments\n`);
  });
}

module.exports = { createApp, createServer };
