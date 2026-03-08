const API_BASE = "https://volnagramm.onrender.com";

const state = {
  token: localStorage.getItem("volnagramm_token") || "",
  me: null,
  chats: [],
  activeChatId: null,
  stream: null,
};

const el = {
  authScreen: document.getElementById("authScreen"),
  appScreen: document.getElementById("appScreen"),
  username: document.getElementById("username"),
  displayName: document.getElementById("displayName"),
  password: document.getElementById("password"),
  loginBtn: document.getElementById("loginBtn"),
  registerBtn: document.getElementById("registerBtn"),
  logoutBtn: document.getElementById("logoutBtn"),
  authError: document.getElementById("authError"),
  globalStatus: document.getElementById("globalStatus"),
  meBox: document.getElementById("meBox"),
  chatsList: document.getElementById("chatsList"),
  activeChatTitle: document.getElementById("activeChatTitle"),
  activeChatSubtitle: document.getElementById("activeChatSubtitle"),
  chatAvatar: document.getElementById("chatAvatar"),
  messages: document.getElementById("messages"),
  messageInput: document.getElementById("messageInput"),
  sendBtn: document.getElementById("sendBtn"),
  userSearch: document.getElementById("userSearch"),
  userResults: document.getElementById("userResults"),
  groupTitle: document.getElementById("groupTitle"),
  groupMembers: document.getElementById("groupMembers"),
  createGroupBtn: document.getElementById("createGroupBtn"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setStatus(text) {
  el.globalStatus.textContent = text;
}

function setAuthError(text = "") {
  el.authError.textContent = text;
}

function showAuth() {
  el.authScreen.classList.remove("hidden");
  el.appScreen.classList.add("hidden");
}

function showApp() {
  el.authScreen.classList.add("hidden");
  el.appScreen.classList.remove("hidden");
}

function headers(json = true) {
  const h = {};
  if (json) h["Content-Type"] = "application/json";
  if (state.token) h["Authorization"] = `Bearer ${state.token}`;
  return h;
}

async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, options);
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }

  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }

  return data;
}

function renderMe() {
  if (!state.me) {
    el.meBox.innerHTML = "";
    return;
  }

  el.meBox.innerHTML = `
    <div><strong>${escapeHtml(state.me.display_name || state.me.username)}</strong></div>
    <div style="color:#8ea0b8; margin-top:4px;">@${escapeHtml(state.me.username)}</div>
  `;
}

function renderChats() {
  if (!state.chats.length) {
    el.chatsList.innerHTML = `<div class="empty-chat">Чатов пока нет</div>`;
    return;
  }

  el.chatsList.innerHTML = state.chats.map(chat => `
    <div class="chat-item ${Number(chat.id) === Number(state.activeChatId) ? "active" : ""}" data-id="${chat.id}">
      <strong>${escapeHtml(chat.title || "Чат")}</strong>
      <span>${escapeHtml(chat.last_message || chat.subtitle || "")}</span>
    </div>
  `).join("");

  document.querySelectorAll(".chat-item").forEach(node => {
    node.addEventListener("click", () => openChat(Number(node.dataset.id)));
  });
}

function renderMessages(messages) {
  if (!messages.length) {
    el.messages.innerHTML = `<div class="empty-chat">Сообщений пока нет</div>`;
    return;
  }

  el.messages.innerHTML = messages.map(msg => {
    const mine = Number(msg.sender_id) === Number(state.me?.id);
    return `
      <div class="message ${mine ? "me" : "other"}">
        <div class="meta">${escapeHtml(msg.sender_display_name || msg.sender_username || "")}</div>
        <div>${escapeHtml(msg.text || "")}</div>
      </div>
    `;
  }).join("");

  el.messages.scrollTop = el.messages.scrollHeight;
}

async function loadChats() {
  const data = await api("/api/chats", {
    headers: headers(false)
  });
  state.chats = data.chats || [];
  renderChats();
}

async function openChat(chatId) {
  state.activeChatId = chatId;
  renderChats();

  const meta = await api(`/api/chats/${chatId}`, {
    headers: headers(false)
  });

  const chat = meta.chat;
  el.activeChatTitle.textContent = chat.title || "Чат";
  el.activeChatSubtitle.textContent = chat.subtitle || "личный чат";
  el.chatAvatar.textContent = (chat.title || "V").charAt(0).toUpperCase();

  const msgs = await api(`/api/chats/${chatId}/messages`, {
    headers: headers(false)
  });

  renderMessages(msgs.messages || []);
}

async function sendMessage() {
  const text = el.messageInput.value.trim();
  if (!state.activeChatId || !text) return;

  await api(`/api/chats/${state.activeChatId}/messages`, {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify({ text })
  });

  el.messageInput.value = "";
  await openChat(state.activeChatId);
  await loadChats();
}

async function login() {
  setAuthError("");
  const username = el.username.value.trim();
  const password = el.password.value;

  if (!username || !password) {
    setAuthError("Введи username и password");
    return;
  }

  try {
    const data = await api("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });

    state.token = data.token;
    state.me = data.user;
    localStorage.setItem("volnagramm_token", state.token);

    showApp();
    renderMe();
    await loadChats();
    connectStream();
    setStatus("Подключено к серверу");
  } catch (err) {
    setAuthError(err.message || "Ошибка входа");
  }
}

async function register() {
  setAuthError("");
  const username = el.username.value.trim();
  const displayName = el.displayName.value.trim();
  const password = el.password.value;

  if (!username || !displayName || !password) {
    setAuthError("Заполни все поля");
    return;
  }

  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    setAuthError("Username: 3-20 символов, латиница, цифры и _");
    return;
  }

  try {
    const data = await api("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, displayName })
    });

    state.token = data.token;
    state.me = data.user;
    localStorage.setItem("volnagramm_token", state.token);

    showApp();
    renderMe();
    await loadChats();
    connectStream();
    setStatus("Подключено к серверу");
  } catch (err) {
    setAuthError(err.message || "Ошибка регистрации");
  }
}

async function restoreSession() {
  if (!state.token) {
    showAuth();
    return;
  }

  try {
    const data = await api("/api/me", {
      headers: headers(false)
    });
    state.me = data.user;
    showApp();
    renderMe();
    await loadChats();
    connectStream();
    setStatus("Подключено к серверу");
  } catch {
    localStorage.removeItem("volnagramm_token");
    state.token = "";
    showAuth();
  }
}

function logout() {
  localStorage.removeItem("volnagramm_token");
  state.token = "";
  state.me = null;
  state.chats = [];
  state.activeChatId = null;

  if (state.stream) {
    state.stream.close();
    state.stream = null;
  }

  el.username.value = "";
  el.displayName.value = "";
  el.password.value = "";
  el.chatsList.innerHTML = "";
  el.messages.innerHTML = `<div class="empty-chat">Открой чат слева или найди пользователя.</div>`;
  el.activeChatTitle.textContent = "Выбери чат";
  el.activeChatSubtitle.textContent = "Сообщения будут здесь";
  showAuth();
  setStatus("Сервер доступен");
}

function connectStream() {
  if (!state.token) return;
  if (state.stream) state.stream.close();

  const es = new EventSource(`${API_BASE}/api/stream?token=${encodeURIComponent(state.token)}`);
  state.stream = es;

  es.addEventListener("ready", () => {
    setStatus("Подключено к серверу");
  });

  es.addEventListener("ping", () => {
    setStatus("Подключено к серверу");
  });

  es.addEventListener("message:new", async () => {
    await loadChats();
    if (state.activeChatId) await openChat(state.activeChatId);
  });

  es.addEventListener("chat:new", async () => {
    await loadChats();
  });

  es.onerror = () => {
    setStatus(navigator.onLine ? "Проблема с сервером" : "Нет интернета");
  };
}

async function searchUsers() {
  const q = el.userSearch.value.trim();
  if (!q) {
    el.userResults.innerHTML = "";
    return;
  }

  const data = await api(`/api/users/search?q=${encodeURIComponent(q)}`, {
    headers: headers(false)
  });

  const users = data.users || [];
  el.userResults.innerHTML = users.map(user => `
    <div class="search-user">
      <div class="name">
        <strong>${escapeHtml(user.display_name || user.username)}</strong>
        <span>@${escapeHtml(user.username)}</span>
      </div>
      <button type="button" data-user-id="${user.id}">Чат</button>
    </div>
  `).join("");

  el.userResults.querySelectorAll("button[data-user-id]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const userId = Number(btn.dataset.userId);
      const data = await api("/api/chats/direct", {
        method: "POST",
        headers: headers(true),
        body: JSON.stringify({ userId })
      });
      await loadChats();
      if (data.chat?.id) await openChat(data.chat.id);
    });
  });
}

async function createGroup() {
  const title = el.groupTitle.value.trim();
  const memberIds = el.groupMembers.value
    .split(",")
    .map(v => Number(v.trim()))
    .filter(Boolean);

  if (!title) return;

  const data = await api("/api/chats/group", {
    method: "POST",
    headers: headers(true),
    body: JSON.stringify({ title, memberIds })
  });

  el.groupTitle.value = "";
  el.groupMembers.value = "";
  await loadChats();
  if (data.chat?.id) await openChat(data.chat.id);
}

async function pingHealth() {
  try {
    const res = await fetch(`${API_BASE}/health`, { cache: "no-store" });
    if (res.ok) {
      setStatus(state.token ? "Подключено к серверу" : "Сервер доступен");
    } else {
      setStatus("Проблема с сервером");
    }
  } catch {
    setStatus(navigator.onLine ? "Проблема с сервером" : "Нет интернета");
  }
}

function bind() {
  el.loginBtn.addEventListener("click", login);
  el.registerBtn.addEventListener("click", register);
  el.logoutBtn.addEventListener("click", logout);
  el.sendBtn.addEventListener("click", sendMessage);
  el.createGroupBtn.addEventListener("click", createGroup);

  el.password.addEventListener("keydown", (e) => {
    if (e.key === "Enter") login();
  });

  el.messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendMessage();
  });

  el.userSearch.addEventListener("input", () => {
    searchUsers().catch(console.error);
  });

  window.addEventListener("online", pingHealth);
  window.addEventListener("offline", pingHealth);
}

async function init() {
  bind();
  await pingHealth();
  await restoreSession();
}

init().catch(console.error);
