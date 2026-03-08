const API_BASE = 'https://volnagramm.onrender.com';

const state = {
  token: localStorage.getItem('volnagramm_token') || '',
  user: JSON.parse(localStorage.getItem('volnagramm_user') || 'null'),
  chats: [],
  currentChat: null,
  messagesByChat: new Map(),
  es: null,
  streamConnected: false,
  pendingRequests: 0,
};

const $ = (id) => document.getElementById(id);
const authScreen = $('authScreen');
const appShell = $('appShell');
const authError = $('authError');
const loginForm = $('loginForm');
const registerForm = $('registerForm');
const messageForm = $('messageForm');
const messagesEl = $('messages');
const chatList = $('chatList');
const searchResults = $('searchResults');

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function setAuthMode(mode) {
  const isLogin = mode === 'login';
  $('tabLogin').classList.toggle('active', isLogin);
  $('tabRegister').classList.toggle('active', !isLogin);
  loginForm.classList.toggle('hidden', !isLogin);
  registerForm.classList.toggle('hidden', isLogin);
  authError.classList.add('hidden');
}

function showAuthError(message) {
  authError.textContent = message;
  authError.classList.remove('hidden');
}

function setSession(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem('volnagramm_token', token);
  localStorage.setItem('volnagramm_user', JSON.stringify(user));
}

function clearSession() {
  state.token = '';
  state.user = null;
  state.currentChat = null;
  state.chats = [];
  state.messagesByChat.clear();
  localStorage.removeItem('volnagramm_token');
  localStorage.removeItem('volnagramm_user');
  if (state.es) state.es.close();
  state.es = null;
  state.streamConnected = false;
}

function requestStarted(label = 'Обновление…') {
  state.pendingRequests += 1;
  setSyncStatus(label);
}

function requestFinished() {
  state.pendingRequests = Math.max(0, state.pendingRequests - 1);
  if (state.pendingRequests === 0) setSyncStatus('Все обновлено');
}

async function api(path, options = {}) {
  requestStarted(options.syncLabel || 'Обновление…');
  try {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
    return data;
  } finally {
    requestFinished();
    refreshStatuses();
  }
}

function setStatusChip(el, text, mode) {
  el.textContent = text;
  el.className = `status-chip ${mode}`;
}

function setSyncStatus(text) {
  $('syncStatus').textContent = text;
}

function refreshStatuses() {
  const online = navigator.onLine;
  const authStatus = $('authNetStatus');
  const serverStatus = $('serverStatus');
  const headerStatus = $('headerStatus');

  if (!online) {
    setStatusChip(authStatus, 'Нет интернета', 'error');
    if (!appShell.classList.contains('hidden')) {
      setStatusChip(serverStatus, 'Нет интернета', 'error');
      setStatusChip(headerStatus, 'Оффлайн', 'error');
      setSyncStatus('Проверь подключение к интернету');
    }
    return;
  }

  if (state.pendingRequests > 0) {
    setStatusChip(authStatus, 'Обновление…', 'warning');
    if (!appShell.classList.contains('hidden')) {
      setStatusChip(serverStatus, state.streamConnected ? 'Подключено' : 'Подключение…', state.streamConnected ? 'connected' : 'warning');
      setStatusChip(headerStatus, 'Обновление…', 'warning');
    }
    return;
  }

  setStatusChip(authStatus, 'Интернет есть', 'connected');
  if (!appShell.classList.contains('hidden')) {
    if (state.streamConnected) {
      setStatusChip(serverStatus, 'Подключено к серверу', 'connected');
      setStatusChip(headerStatus, 'Подключено', 'connected');
    } else {
      setStatusChip(serverStatus, 'Сервер недоступен', 'error');
      setStatusChip(headerStatus, 'Нет связи с сервером', 'error');
    }
  }
}

async function probeServer() {
  try {
    requestStarted('Проверка сервера…');
    const res = await fetch(`${API_BASE}/health`, { cache: 'no-store' });
    state.streamConnected = res.ok && state.streamConnected;
  } catch {
    // ignore
  } finally {
    requestFinished();
    refreshStatuses();
  }
}

function showAuth() {
  authScreen.classList.remove('hidden');
  appShell.classList.add('hidden');
  refreshStatuses();
}

function showApp() {
  authScreen.classList.add('hidden');
  appShell.classList.remove('hidden');
  $('meName').textContent = state.user.display_name;
  $('meUsername').textContent = `@${state.user.username}`;
  $('meAvatar').textContent = (state.user.display_name || state.user.username || 'V').slice(0, 1).toUpperCase();
  refreshStatuses();
}

function renderChats() {
  chatList.innerHTML = '';
  if (!state.chats.length) {
    chatList.innerHTML = '<div class="result-sub">Пока нет чатов</div>';
    return;
  }

  for (const chat of state.chats) {
    const item = document.createElement('div');
    item.className = 'chat-item' + (state.currentChat && Number(state.currentChat.id) === Number(chat.id) ? ' active' : '');
    item.innerHTML = `
      <div class="chat-top">
        <strong>${escapeHtml(chat.title)}</strong>
      </div>
      <div class="chat-sub">${escapeHtml(chat.last_message || 'Без сообщений')}</div>
    `;
    item.onclick = () => openChat(chat);
    chatList.appendChild(item);
  }
}

function renderEmptyChat() {
  messagesEl.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">✈</div>
      <h2>Добро пожаловать в Volnagramm</h2>
      <p>Найди пользователя слева или создай группу, чтобы начать общение.</p>
    </div>
  `;
}

function appendMessage(message) {
  const item = document.createElement('div');
  const mine = Number(message.sender_id) === Number(state.user.id);
  item.className = 'message' + (mine ? ' mine' : '');
  item.innerHTML = `
    <div class="message-head">
      <span>${escapeHtml(message.sender_display_name)}</span>
      <span>${new Date(message.created_at).toLocaleString()}</span>
    </div>
    <div class="message-text">${escapeHtml(message.text)}</div>
  `;
  messagesEl.appendChild(item);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderMessages(chatId) {
  messagesEl.innerHTML = '';
  const list = state.messagesByChat.get(Number(chatId)) || [];
  if (!list.length) {
    messagesEl.innerHTML = '<div class="empty-state"><div class="empty-icon">💬</div><h2>Пока пусто</h2><p>Напиши первое сообщение.</p></div>';
    return;
  }
  list.forEach(appendMessage);
}

async function loadChats() {
  const data = await api('/api/chats', { syncLabel: 'Обновление чатов…' });
  state.chats = data.chats;
  renderChats();
}

async function openChat(chat) {
  state.currentChat = chat;
  $('chatTitle').textContent = chat.title;
  $('chatSubtitle').textContent = chat.is_group ? 'Групповой чат' : 'Личный чат';
  messageForm.classList.remove('hidden');
  renderChats();

  const data = await api(`/api/chats/${chat.id}/messages`, { syncLabel: 'Загрузка сообщений…' });
  state.messagesByChat.set(Number(chat.id), data.messages);
  renderMessages(chat.id);
}

function upsertIncomingMessage(message) {
  const chatId = Number(message.chat_id);
  const list = state.messagesByChat.get(chatId) || [];
  if (!list.find((m) => Number(m.id) === Number(message.id))) {
    list.push(message);
    state.messagesByChat.set(chatId, list);
  }
  if (state.currentChat && Number(state.currentChat.id) === chatId) {
    renderMessages(chatId);
  }
}

function connectStream() {
  if (state.es) state.es.close();
  state.streamConnected = false;
  refreshStatuses();

  state.es = new EventSource(`${API_BASE}/api/stream?token=${encodeURIComponent(state.token)}`);
  state.es.addEventListener('ready', () => {
    state.streamConnected = true;
    setSyncStatus('Синхронизация включена');
    refreshStatuses();
  });
  state.es.addEventListener('ping', () => {
    state.streamConnected = true;
    refreshStatuses();
  });
  state.es.addEventListener('message:new', async (e) => {
    state.streamConnected = true;
    const data = JSON.parse(e.data);
    upsertIncomingMessage(data.message);
    await loadChats();
    refreshStatuses();
  });
  state.es.addEventListener('chat:new', async () => {
    state.streamConnected = true;
    await loadChats();
    refreshStatuses();
  });
  state.es.onerror = () => {
    state.streamConnected = false;
    setSyncStatus('Проблема с сервером или соединением');
    refreshStatuses();
  };
}

$('tabLogin').onclick = () => setAuthMode('login');
$('tabRegister').onclick = () => setAuthMode('register');

loginForm.onsubmit = async (e) => {
  e.preventDefault();
  try {
    const data = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({
        username: $('loginUsername').value.trim(),
        password: $('loginPassword').value,
      }),
      syncLabel: 'Вход…',
    });
    setSession(data.token, data.user);
    showApp();
    connectStream();
    await loadChats();
    renderEmptyChat();
  } catch (err) {
    showAuthError(err.message);
  }
};

registerForm.onsubmit = async (e) => {
  e.preventDefault();
  try {
    const data = await api('/api/register', {
      method: 'POST',
      body: JSON.stringify({
        username: $('registerUsername').value.trim(),
        password: $('registerPassword').value,
        displayName: $('registerDisplayName').value.trim() || $('registerUsername').value.trim(),
      }),
      syncLabel: 'Регистрация…',
    });
    setSession(data.token, data.user);
    showApp();
    connectStream();
    await loadChats();
    renderEmptyChat();
  } catch (err) {
    showAuthError(err.message);
  }
};

$('logoutBtn').onclick = () => {
  clearSession();
  renderEmptyChat();
  showAuth();
};

$('searchInput').oninput = async (e) => {
  const q = e.target.value.trim();
  if (!q) {
    searchResults.innerHTML = '';
    return;
  }
  try {
    const data = await api(`/api/users/search?q=${encodeURIComponent(q)}`, { syncLabel: 'Поиск…' });
    searchResults.innerHTML = '';
    if (!data.users.length) {
      searchResults.innerHTML = '<div class="result-sub">Никого не найдено</div>';
      return;
    }
    data.users.forEach((user) => {
      const el = document.createElement('div');
      el.className = 'result-item';
      el.innerHTML = `
        <div class="result-top">
          <strong>${escapeHtml(user.display_name)}</strong>
          <span class="muted">id ${user.id}</span>
        </div>
        <div class="result-sub">@${escapeHtml(user.username)}</div>
      `;
      el.onclick = async () => {
        try {
          const result = await api('/api/chats/direct', {
            method: 'POST',
            body: JSON.stringify({ userId: user.id }),
            syncLabel: 'Создание чата…',
          });
          await loadChats();
          await openChat(result.chat);
        } catch (err) {
          alert(err.message);
        }
      };
      searchResults.appendChild(el);
    });
  } catch (err) {
    searchResults.innerHTML = `<div class="result-sub">${escapeHtml(err.message)}</div>`;
  }
};

$('createGroupBtn').onclick = async () => {
  try {
    const ids = $('groupMemberIds').value.split(',').map((x) => Number(x.trim())).filter(Boolean);
    const result = await api('/api/chats/group', {
      method: 'POST',
      body: JSON.stringify({
        title: $('groupTitle').value.trim(),
        memberIds: ids,
      }),
      syncLabel: 'Создание группы…',
    });
    $('groupTitle').value = '';
    $('groupMemberIds').value = '';
    await loadChats();
    await openChat(result.chat);
  } catch (err) {
    alert(err.message);
  }
};

messageForm.onsubmit = async (e) => {
  e.preventDefault();
  if (!state.currentChat) return;
  const text = $('messageInput').value.trim();
  if (!text) return;
  try {
    const result = await api(`/api/chats/${state.currentChat.id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text }),
      syncLabel: 'Отправка сообщения…',
    });
    $('messageInput').value = '';
    upsertIncomingMessage(result.message);
    await loadChats();
  } catch (err) {
    alert(err.message);
  }
};

window.addEventListener('online', refreshStatuses);
window.addEventListener('offline', refreshStatuses);

(async function init() {
  setAuthMode('login');
  refreshStatuses();
  await probeServer();

  if (state.token && state.user) {
    showApp();
    connectStream();
    try {
      await loadChats();
      renderEmptyChat();
    } catch {
      clearSession();
      showAuth();
    }
  } else {
    showAuth();
  }
})();
