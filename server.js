const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const db = new sqlite3.Database(path.join(dataDir, 'volnagramm.sqlite'));

app.use(cors({ origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const sseClients = new Map();

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

async function initDb() {
  await run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    bio TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

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
    text TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  const demo = await get('SELECT id FROM users WHERE username = ?', ['ocean']);
  if (!demo) {
    const hash = await bcrypt.hash('volna123', 10);
    await run(
      'INSERT INTO users (username, password_hash, display_name, bio) VALUES (?, ?, ?, ?)',
      ['ocean', hash, 'Ocean', 'Demo account']
    );
  }
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
    const user = await get('SELECT id, username, display_name, bio FROM users WHERE id = ?', [decoded.id]);
    if (!user) return res.status(401).json({ error: 'Invalid token' });
    req.user = user;
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
  if (!clients) return;
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    res.write(data);
  }
}

async function broadcastToChat(chatId, event, payload) {
  const members = await all('SELECT user_id FROM chat_members WHERE chat_id = ?', [chatId]);
  for (const member of members) {
    sendSse(member.user_id, event, payload);
  }
}

app.get('/health', (req, res) => res.json({ ok: true }));

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
      'INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)',
      [username, hash, displayName]
    );
    const user = { id: result.lastID, username, display_name: displayName, bio: '' };
    res.json({ token: signToken(user), user });
  } catch (err) {
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
    const user = { id: userRow.id, username: userRow.username, display_name: userRow.display_name, bio: userRow.bio };
    res.json({ token: signToken(user), user });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/me', auth, async (req, res) => {
  res.json({ user: req.user });
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
    set.add(res);
    sseClients.set(key, set);

    const ping = setInterval(() => {
      res.write(`event: ping\ndata: ${Date.now()}\n\n`);
    }, 25000);

    req.on('close', () => {
      clearInterval(ping);
      const current = sseClients.get(key);
      if (current) {
        current.delete(res);
        if (current.size === 0) sseClients.delete(key);
      }
    });
  } catch {
    res.status(401).end();
  }
});

app.get('/api/users/search', auth, async (req, res) => {
  const q = String(req.query.q || '').trim();
  const rows = await all(
    'SELECT id, username, display_name, bio FROM users WHERE (username LIKE ? OR display_name LIKE ?) AND id != ? LIMIT 20',
    [`%${q}%`, `%${q}%`, req.user.id]
  );
  res.json({ users: rows });
});

app.get('/api/chats', auth, async (req, res) => {
  const chats = await all(
    `SELECT c.id, c.title, c.is_group,
      (SELECT text FROM messages m WHERE m.chat_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_message,
      (SELECT created_at FROM messages m WHERE m.chat_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_message_at
     FROM chats c
     JOIN chat_members cm ON cm.chat_id = c.id
     WHERE cm.user_id = ?
     ORDER BY COALESCE(last_message_at, c.created_at) DESC`,
    [req.user.id]
  );
  res.json({ chats });
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

  const title = other.display_name;
  const chat = await run('INSERT INTO chats (title, is_group, created_by) VALUES (?, 0, ?)', [title, req.user.id]);
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

app.get('/api/chats/:chatId/messages', auth, async (req, res) => {
  const chatId = Number(req.params.chatId);
  const member = await ensureMember(req.user.id, chatId);
  if (!member) return res.status(403).json({ error: 'Forbidden' });

  const messages = await all(
    `SELECT m.id, m.chat_id, m.text, m.created_at,
            u.id AS sender_id, u.username AS sender_username, u.display_name AS sender_display_name
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

  const result = await run('INSERT INTO messages (chat_id, sender_id, text) VALUES (?, ?, ?)', [chatId, req.user.id, String(text).trim()]);
  const message = await get(
    `SELECT m.id, m.chat_id, m.text, m.created_at,
            u.id AS sender_id, u.username AS sender_username, u.display_name AS sender_display_name
     FROM messages m
     JOIN users u ON u.id = m.sender_id
     WHERE m.id = ?`,
    [result.lastID]
  );
  await broadcastToChat(chatId, 'message:new', { message });
  res.json({ message });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Volnagramm running on http://localhost:${PORT}`);
  });
});
