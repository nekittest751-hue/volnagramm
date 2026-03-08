const API_BASE = 'https://volnagramm.onrender.com';

const state = {
  token: localStorage.getItem('volnagramm_token') || '',
  user: JSON.parse(localStorage.getItem('volnagramm_user') || 'null'),
  chats: [],
  currentChat: null,
  es: null,
};

const $ = (id) => document.getElementById(id);
const authBox = $('authBox');
const userBox = $('userBox');
const searchBox = $('searchBox');
const groupBox = $('groupBox');
const chatsPanel = $('chatsPanel');
const chatList = $('chatList');
const messages = $('messages');
const messageForm = $('messageForm');
const messageInput = $('messageInput');
const chatHeader = $('chatHeader');

function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  return fetch(`${API_BASE}${path}`, { ...options, headers }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  });
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
  localStorage.removeItem('volnagramm_token');
  localStorage.removeItem('volnagramm_user');
  if (state.es) state.es.close();
  state.es = null;
}

function showAuth() {
  authBox.classList.remove('hidden');
  userBox.classList.add('hidden');
  searchBox.classList.add('hidden');
  groupBox.classList.add('hidden');
  chatsPanel.classList.add('hidden');
  messageForm.classList.add('hidden');
  chatHeader.textContent = 'Выбери чат';
  messages.innerHTML = '';
}

function showApp() {
  authBox.classList.add('hidden');
  userBox.classList.remove('hidden');
  searchBox.classList.remove('hidden');
  groupBox.classList.remove('hidden');
  chatsPanel.classList.remove('hidden');
  $('meName').textContent = state.user.display_name;
  $('meUsername').textContent = '@' + state.user.username;
  connectStream();
  loadChats();
}

function connectStream() {
  if (state.es) state.es.close();
  state.es = new EventSource(`${API_BASE}/api/stream?token=${encodeURIComponent(state.token)}`);
  state.es.addEventListener('message:new', async (e) => {
    const data = JSON.parse(e.data);
    if (state.currentChat && Number(state.currentChat.id) === Number(data.message.chat_id)) {
      appendMessage(data.message);
    }
    loadChats();
  });
  state.es.addEventListener('chat:new', () => loadChats());
}

function renderChats() {
  chatList.innerHTML = '';
  if (!state.chats.length) {
    chatList.innerHTML = '<div class="itemSub">Пока нет чатов</div>';
    return;
  }
  for (const chat of state.chats) {
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML = `
      <div class="itemTitle">${escapeHtml(chat.title)}</div>
      <div class="itemSub">${chat.last_message ? escapeHtml(chat.last_message) : 'Без сообщений'}</div>
    `;
    el.onclick = () => openChat(chat);
    chatList.appendChild(el);
  }
}

async function loadChats() {
  const data = await api('/api/chats');
  state.chats = data.chats;
  renderChats();
}

async function openChat(chat) {
  state.currentChat = chat;
  chatHeader.textContent = chat.title;
  messageForm.classList.remove('hidden');
  const data = await api(`/api/chats/${chat.id}/messages`);
  messages.innerHTML = '';
  data.messages.forEach(appendMessage);
  messages.scrollTop = messages.scrollHeight;
}

function appendMessage(message) {
  const el = document.createElement('div');
  const mine = Number(message.sender_id) === Number(state.user.id);
  el.className = 'msg' + (mine ? ' me' : '');
  el.innerHTML = `
    <div class="msgMeta">${escapeHtml(message.sender_display_name)} · ${new Date(message.created_at).toLocaleString()}</div>
    <div>${escapeHtml(message.text)}</div>
  `;
  messages.appendChild(el);
  messages.scrollTop = messages.scrollHeight;
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

$('loginBtn').onclick = async () => {
  try {
    const data = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({
        username: $('username').value.trim(),
        password: $('password').value,
      }),
    });
    setSession(data.token, data.user);
    showApp();
  } catch (e) {
    alert(e.message);
  }
};

$('registerBtn').onclick = async () => {
  try {
    const data = await api('/api/register', {
      method: 'POST',
      body: JSON.stringify({
        username: $('username').value.trim(),
        password: $('password').value,
        displayName: $('displayName').value.trim() || $('username').value.trim(),
      }),
    });
    setSession(data.token, data.user);
    showApp();
  } catch (e) {
    alert(e.message);
  }
};

$('logoutBtn').onclick = () => {
  clearSession();
  showAuth();
};

$('searchInput').oninput = async (e) => {
  const q = e.target.value.trim();
  const box = $('searchResults');
  if (!q) {
    box.innerHTML = '';
    return;
  }
  try {
    const data = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
    box.innerHTML = '';
    data.users.forEach((user) => {
      const el = document.createElement('div');
      el.className = 'item';
      el.innerHTML = `
        <div class="itemTitle">${escapeHtml(user.display_name)} <span class="muted">@${escapeHtml(user.username)}</span></div>
        <div class="itemSub">id: ${user.id}</div>
      `;
      el.onclick = async () => {
        try {
          const result = await api('/api/chats/direct', {
            method: 'POST',
            body: JSON.stringify({ userId: user.id }),
          });
          await loadChats();
          await openChat(result.chat);
        } catch (err) {
          alert(err.message);
        }
      };
      box.appendChild(el);
    });
    if (!data.users.length) box.innerHTML = '<div class="itemSub">Никого не найдено</div>';
  } catch (err) {
    box.innerHTML = `<div class="itemSub">${escapeHtml(err.message)}</div>`;
  }
};

$('createGroupBtn').onclick = async () => {
  try {
    const ids = $('groupMemberIds').value
      .split(',')
      .map((x) => Number(x.trim()))
      .filter(Boolean);
    const data = await api('/api/chats/group', {
      method: 'POST',
      body: JSON.stringify({
        title: $('groupTitle').value.trim(),
        memberIds: ids,
      }),
    });
    $('groupTitle').value = '';
    $('groupMemberIds').value = '';
    await loadChats();
    await openChat(data.chat);
  } catch (e) {
    alert(e.message);
  }
};

messageForm.onsubmit = async (e) => {
  e.preventDefault();
  if (!state.currentChat) return;
  const text = messageInput.value.trim();
  if (!text) return;
  try {
    await api(`/api/chats/${state.currentChat.id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
    messageInput.value = '';
  } catch (err) {
    alert(err.message);
  }
};

(async function init() {
  if (!state.token || !state.user) return showAuth();
  try {
    const data = await api('/api/me');
    state.user = data.user;
    localStorage.setItem('volnagramm_user', JSON.stringify(data.user));
    showApp();
  } catch {
    clearSession();
    showAuth();
  }
})();
