const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const rootDir = process.cwd();
const dataDir = path.join(rootDir, 'data');
const uploadsDir = path.join(rootDir, 'uploads');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const db = new sqlite3.Database(path.join(dataDir, 'volnagramm.sqlite'));

app.use(cors({ origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN }));
app.use(express.json({ limit: '3mb' }));
app.use('/uploads', express.static(uploadsDir));
app.use(express.static(path.resolve('public')));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '');
      const safeBase = path.basename(file.originalname || 'file', ext).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48) || 'file';
      cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 10)}_${safeBase}${ext}`);
    }
  }),
  limits: { fileSize: 15 * 1024 * 1024 }
});

const sseClients = new Map();
const activeCalls = new Map();

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function nowIso() {
  return new Date().toISOString();
}

async function touchLastSeen(userId) {
  await run('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?', [userId]);
}

function presenceLabel(userRow) {
  if (!userRow) return 'неизвестно';
  if (sseClients.has(String(userRow.id))) return 'в сети';
  if (!userRow.last_seen) return 'давно не заходил';

  const last = new Date(userRow.last_seen).getTime();
  const diffMin = Math.max(0, Math.round((Date.now() - last) / 60000));
  if (diffMin <= 2) return 'был только что';
  if (diffMin < 60) return `был ${diffMin} мин назад`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `был ${diffH} ч назад`;
  const diffD = Math.round(diffH / 24);
  return `был ${diffD} дн назад`;
}

function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
}

async function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await get('SELECT id, username, display_name, bio, last_seen FROM users WHERE id = ?', [decoded.id]);
    if (!user) return res.status(401).json({ error: 'Invalid token' });
    req.user = user;
    await touchLastSeen(user.id);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

async function ensureMember(userId, chatId) {
  const row = await get('SELECT 1 FROM chat_members WHERE user_id = ? AND chat_id = ?', [userId, chatId]);
  return !!row;
}

function sendSse(userId, event, payload) {
  const clients = sseClients.get(String(userId));
  if (!clients) return false;
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    res.write(data);
  }
  return true;
}

async function broadcastToChat(chatId, event, payload) {
  const members = await all('SELECT user_id FROM chat_members WHERE chat_id = ?', [chatId]);
  for (const member of members) {
    sendSse(member.user_id, event, payload);
  }
}

async function notifyPresence(userId) {
  const chats = await all('SELECT DISTINCT chat_id FROM chat_members WHERE user_id = ?', [userId]);
  const user = await get('SELECT id, username, display_name, last_seen FROM users WHERE id = ?', [userId]);
  const payload = {
    userId,
    status: presenceLabel(user),
    online: sseClients.has(String(userId)),
    lastSeen: user?.last_seen || null
  };
  for (const chat of chats) {
    await broadcastToChat(chat.chat_id, 'presence:update', payload);
  }
}

async function initDb() {
  await run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    bio TEXT DEFAULT '',
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  try {
    await run('ALTER TABLE users ADD COLUMN last_seen DATETIME');
  } catch {}

  await run(`CREATE TABLE IF NOT EXISTS chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    is_group INTEGER DEFAULT 0,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  await run(`CREATE TABLE IF NOT EXISTS chat_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    UNIQUE(chat_id, user_id)
  )`);

  await run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id INTEGER NOT NULL,
    sender_id INTEGER NOT NULL,
    text TEXT DEFAULT '',
    type TEXT DEFAULT 'text',
    file_url TEXT DEFAULT NULL,
    file_name TEXT DEFAULT NULL,
    file_size INTEGER DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  try { await run("ALTER TABLE messages ADD COLUMN type TEXT DEFAULT 'text'"); } catch {}
  try { await run('ALTER TABLE messages ADD COLUMN file_url TEXT DEFAULT NULL'); } catch {}
  try { await run('ALTER TABLE messages ADD COLUMN file_name TEXT DEFAULT NULL'); } catch {}
  try { await run('ALTER TABLE messages ADD COLUMN file_size INTEGER DEFAULT NULL'); } catch {}

  const demo = await get('SELECT id FROM users WHERE username = ?', ['ocean']);
  if (!demo) {
    const hash = await bcrypt.hash('volna123', 10);
    await run(
      'INSERT INTO users (username, password_hash, display_name, bio, last_seen) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)',
      ['ocean', hash, 'Ocean', 'Demo account']
    );
  }
}

async function buildMessage(messageId) {
  return get(
    `SELECT m.id, m.chat_id, m.text, m.type, m.file_url, m.file_name, m.file_size, m.created_at,
            u.id AS sender_id,
            u.username AS sender_username,
            u.display_name AS sender_display_name
     FROM messages m
     JOIN users u ON u.id = m.sender_id
     WHERE m.id = ?`,
    [messageId]
  );
}

function humanError(err, fallback = 'Server error') {
  if (!err) return fallback;
  if (err.code === 'LIMIT_FILE_SIZE') return 'Файл слишком большой (до 15 МБ)';
  return fallback;
}

app.get('/health', (_req, res) => res.json({ ok: true, now: nowIso() }));

app.post('/api/register', async (req, res) => {
  try {
    const { username, password, displayName } = req.body;
    if (!username || !password || !displayName) {
      return res.status(400).json({ error: 'username, password and displayName required' });
    }
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return res.status(400).json({ error: 'Username must be 3-20 characters: letters, numbers, underscore' });
    }
    const exists = await get('SELECT id FROM users WHERE username = ?', [username]);
    if (exists) return res.status(409).json({ error: 'Username already exists' });
    const hash = await bcrypt.hash(password, 10);
    const result = await run(
      'INSERT INTO users (username, password_hash, display_name, last_seen) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
      [username, hash, displayName]
    );
    const user = { id: result.lastID, username, display_name: displayName, bio: '', last_seen: nowIso() };
    res.json({ token: signToken(user), user });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const userRow = await get('SELECT * FROM users WHERE username = ?', [username]);
    if (!userRow) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, userRow.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    await touchLastSeen(userRow.id);
    const user = { id: userRow.id, username: userRow.username, display_name: userRow.display_name, bio: userRow.bio, last_seen: nowIso() };
    res.json({ token: signToken(user), user });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/me', auth, async (req, res) => {
  const freshUser = await get('SELECT id, username, display_name, bio, last_seen FROM users WHERE id = ?', [req.user.id]);
  res.json({ user: freshUser, presence: { status: presenceLabel(freshUser), online: sseClients.has(String(req.user.id)) } });
});

app.get('/api/stream', async (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(401).end();
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await get('SELECT id FROM users WHERE id = ?', [decoded.id]);
    if (!user) return res.status(401).end();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);

    const key = String(decoded.id);
    const set = sseClients.get(key) || new Set();
    const wasOffline = set.size === 0;
    set.add(res);
    sseClients.set(key, set);
    await touchLastSeen(decoded.id);
    if (wasOffline) await notifyPresence(decoded.id);

    const ping = setInterval(() => {
      res.write(`event: ping\ndata: ${Date.now()}\n\n`);
    }, 25000);

    req.on('close', async () => {
      clearInterval(ping);
      const current = sseClients.get(key);
      if (current) {
        current.delete(res);
        if (current.size === 0) {
          sseClients.delete(key);
          await touchLastSeen(decoded.id);
          await notifyPresence(decoded.id);
        }
      }
    });
  } catch {
    res.status(401).end();
  }
});

app.get('/api/users/search', auth, async (req, res) => {
  const q = String(req.query.q || '').trim();
  const rows = await all(
    'SELECT id, username, display_name, bio, last_seen FROM users WHERE (username LIKE ? OR display_name LIKE ?) AND id != ? LIMIT 20',
    [`%${q}%`, `%${q}%`, req.user.id]
  );
  res.json({
    users: rows.map((row) => ({
      ...row,
      online: sseClients.has(String(row.id)),
      status: presenceLabel(row)
    }))
  });
});

app.get('/api/users/:userId/status', auth, async (req, res) => {
  const user = await get('SELECT id, username, display_name, last_seen FROM users WHERE id = ?', [Number(req.params.userId)]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ userId: user.id, online: sseClients.has(String(user.id)), lastSeen: user.last_seen, status: presenceLabel(user) });
});

app.get('/api/chats', auth, async (req, res) => {
  const chats = await all(
    `SELECT c.id, c.title, c.is_group, c.created_at,
      (SELECT text FROM messages m WHERE m.chat_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_message,
      (SELECT type FROM messages m WHERE m.chat_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_message_type,
      (SELECT file_name FROM messages m WHERE m.chat_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_file_name,
      (SELECT created_at FROM messages m WHERE m.chat_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_message_at,
      (SELECT u2.id
         FROM chat_members cm2
         JOIN users u2 ON u2.id = cm2.user_id
        WHERE cm2.chat_id = c.id AND u2.id != ?
        LIMIT 1) AS peer_id,
      (SELECT u2.username
         FROM chat_members cm2
         JOIN users u2 ON u2.id = cm2.user_id
        WHERE cm2.chat_id = c.id AND u2.id != ?
        LIMIT 1) AS peer_username,
      (SELECT u2.display_name
         FROM chat_members cm2
         JOIN users u2 ON u2.id = cm2.user_id
        WHERE cm2.chat_id = c.id AND u2.id != ?
        LIMIT 1) AS peer_display_name,
      (SELECT u2.last_seen
         FROM chat_members cm2
         JOIN users u2 ON u2.id = cm2.user_id
        WHERE cm2.chat_id = c.id AND u2.id != ?
        LIMIT 1) AS peer_last_seen
     FROM chats c
     JOIN chat_members cm ON cm.chat_id = c.id
     WHERE cm.user_id = ?
     ORDER BY COALESCE(last_message_at, c.created_at) DESC`,
    [req.user.id, req.user.id, req.user.id, req.user.id, req.user.id]
  );

  res.json({
    chats: chats.map((chat) => ({
      ...chat,
      peer_online: chat.peer_id ? sseClients.has(String(chat.peer_id)) : false,
      peer_status: chat.peer_id ? presenceLabel({ id: chat.peer_id, last_seen: chat.peer_last_seen }) : null
    }))
  });
});

app.post('/api/chats/direct', auth, async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  if (Number(userId) === Number(req.user.id)) return res.status(400).json({ error: 'Cannot chat with yourself' });

  const other = await get('SELECT id, display_name FROM users WHERE id = ?', [userId]);
  if (!other) return res.status(404).json({ error: 'User not found' });

  const existing = await get(
    `SELECT c.id, c.title, c.is_group FROM chats c
     JOIN chat_members a ON a.chat_id = c.id AND a.user_id = ?
     JOIN chat_members b ON b.chat_id = c.id AND b.user_id = ?
     WHERE c.is_group = 0
       AND (SELECT COUNT(*) FROM chat_members WHERE chat_id = c.id) = 2
     LIMIT 1`,
    [req.user.id, other.id]
  );
  if (existing) return res.json({ chat: existing });

  const chat = await run('INSERT INTO chats (title, is_group, created_by) VALUES (?, 0, ?)', [other.display_name, req.user.id]);
  await run('INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?)', [chat.lastID, req.user.id]);
  await run('INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?)', [chat.lastID, other.id]);
  const created = await get('SELECT id, title, is_group FROM chats WHERE id = ?', [chat.lastID]);
  await broadcastToChat(chat.lastID, 'chat:new', { chat: created });
  res.json({ chat: created });
});

app.post('/api/chats/group', auth, async (req, res) => {
  const { title, memberIds } = req.body;
  if (!title || !Array.isArray(memberIds)) return res.status(400).json({ error: 'title and memberIds required' });
  const ids = [...new Set(memberIds.map(Number).filter(Boolean).concat(req.user.id))];
  const chat = await run('INSERT INTO chats (title, is_group, created_by) VALUES (?, 1, ?)', [title, req.user.id]);
  for (const id of ids) {
    await run('INSERT OR IGNORE INTO chat_members (chat_id, user_id) VALUES (?, ?)', [chat.lastID, id]);
  }
  const created = await get('SELECT id, title, is_group FROM chats WHERE id = ?', [chat.lastID]);
  await broadcastToChat(chat.lastID, 'chat:new', { chat: created });
  res.json({ chat: created });
});

app.get('/api/chats/:chatId/meta', auth, async (req, res) => {
  const chatId = Number(req.params.chatId);
  const member = await ensureMember(req.user.id, chatId);
  if (!member) return res.status(403).json({ error: 'Forbidden' });

  const chat = await get('SELECT id, title, is_group FROM chats WHERE id = ?', [chatId]);
  if (!chat) return res.status(404).json({ error: 'Chat not found' });

  const members = await all(
    'SELECT u.id, u.username, u.display_name, u.last_seen FROM chat_members cm JOIN users u ON u.id = cm.user_id WHERE cm.chat_id = ?',
    [chatId]
  );

  res.json({
    chat,
    members: members.map((m) => ({ ...m, online: sseClients.has(String(m.id)), status: presenceLabel(m) }))
  });
});

app.get('/api/chats/:chatId/messages', auth, async (req, res) => {
  const chatId = Number(req.params.chatId);
  const member = await ensureMember(req.user.id, chatId);
  if (!member) return res.status(403).json({ error: 'Forbidden' });

  const messages = await all(
    `SELECT m.id, m.chat_id, m.text, m.type, m.file_url, m.file_name, m.file_size, m.created_at,
            u.id AS sender_id,
            u.username AS sender_username,
            u.display_name AS sender_display_name
     FROM messages m
     JOIN users u ON u.id = m.sender_id
     WHERE m.chat_id = ?
     ORDER BY m.id ASC`,
    [chatId]
  );
  res.json({ messages });
});

app.post('/api/chats/:chatId/messages', auth, async (req, res) => {
  const chatId = Number(req.params.chatId);
  const { text } = req.body;
  if (!text || !String(text).trim()) return res.status(400).json({ error: 'Text required' });

  const member = await ensureMember(req.user.id, chatId);
  if (!member) return res.status(403).json({ error: 'Forbidden' });

  const result = await run('INSERT INTO messages (chat_id, sender_id, text, type) VALUES (?, ?, ?, ?)', [chatId, req.user.id, String(text).trim(), 'text']);
  const message = await buildMessage(result.lastID);
  await broadcastToChat(chatId, 'message:new', { message });
  res.json({ message });
});

app.post('/api/chats/:chatId/upload', auth, (req, res) => {
  const chatId = Number(req.params.chatId);
  upload.single('file')(req, res, async (err) => {
    try {
      if (err) return res.status(400).json({ error: humanError(err, 'Upload error') });
      const member = await ensureMember(req.user.id, chatId);
      if (!member) return res.status(403).json({ error: 'Forbidden' });
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

      const fileUrl = `/uploads/${req.file.filename}`;
      const result = await run(
        'INSERT INTO messages (chat_id, sender_id, text, type, file_url, file_name, file_size) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [chatId, req.user.id, req.body.caption || '', 'file', fileUrl, req.file.originalname, req.file.size]
      );
      const message = await buildMessage(result.lastID);
      await broadcastToChat(chatId, 'message:new', { message });
      res.json({ message });
    } catch (e) {
      console.error('Upload error:', e);
      res.status(500).json({ error: 'Upload failed' });
    }
  });
});

app.post('/api/calls/start', auth, async (req, res) => {
  const { chatId, targetUserId, kind } = req.body;
  if (!chatId || !targetUserId || !['audio', 'video'].includes(kind)) {
    return res.status(400).json({ error: 'chatId, targetUserId and kind required' });
  }
  const member = await ensureMember(req.user.id, Number(chatId));
  if (!member) return res.status(403).json({ error: 'Forbidden' });

  const callId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  activeCalls.set(callId, { callId, chatId: Number(chatId), fromUserId: req.user.id, toUserId: Number(targetUserId), kind, createdAt: nowIso() });
  sendSse(targetUserId, 'call:incoming', {
    callId,
    chatId: Number(chatId),
    fromUserId: req.user.id,
    fromName: req.user.display_name,
    kind
  });
  res.json({ ok: true, callId });
});

app.post('/api/calls/:callId/accept', auth, async (req, res) => {
  const call = activeCalls.get(req.params.callId);
  if (!call) return res.status(404).json({ error: 'Call not found' });
  sendSse(call.fromUserId, 'call:accepted', { callId: call.callId, byUserId: req.user.id });
  res.json({ ok: true });
});

app.post('/api/calls/:callId/reject', auth, async (req, res) => {
  const call = activeCalls.get(req.params.callId);
  if (!call) return res.status(404).json({ error: 'Call not found' });
  sendSse(call.fromUserId, 'call:rejected', { callId: call.callId, byUserId: req.user.id });
  activeCalls.delete(call.callId);
  res.json({ ok: true });
});

app.post('/api/calls/:callId/signal', auth, async (req, res) => {
  const call = activeCalls.get(req.params.callId);
  if (!call) return res.status(404).json({ error: 'Call not found' });
  const { targetUserId, signalType, data } = req.body;
  if (!targetUserId || !signalType) return res.status(400).json({ error: 'targetUserId and signalType required' });
  sendSse(targetUserId, 'call:signal', { callId: call.callId, fromUserId: req.user.id, signalType, data });
  res.json({ ok: true });
});

app.post('/api/calls/:callId/end', auth, async (req, res) => {
  const call = activeCalls.get(req.params.callId);
  if (!call) return res.json({ ok: true });
  const targetUserId = Number(req.body.targetUserId || (req.user.id === call.fromUserId ? call.toUserId : call.fromUserId));
  sendSse(targetUserId, 'call:ended', { callId: call.callId, byUserId: req.user.id });
  activeCalls.delete(call.callId);
  res.json({ ok: true });
});

app.get('*', (_req, res) => {
  res.sendFile(path.resolve('public', 'index.html'));
});

initDb()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Volnagramm running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Startup error:', err);
    process.exit(1);
  });
