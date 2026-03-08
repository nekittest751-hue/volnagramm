const API_BASE =
  location.protocol === "file:"
    ? "https://volnagramm.onrender.com"
    : "";

const state = {
  token: localStorage.getItem("volnagramm_token") || "",
  me: null,
  chats: [],
  activeChatId: null,
  stream: null,
  healthTimer: null,
  searchTimer: null,
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
  userSearch: document.getElementById("userSearch"),
  userResults: document.getElementById("userResults"),
  groupTitle: document.getElementById("groupTitle"),
  groupMembers: document.getElementById("groupMembers"),
  createGroupBtn: document.getElementById("createGroupBtn"),
  chatsList: document.getElementById("chatsList"),
  activeChatTitle: document.getElementById("activeChatTitle"),
  activeChatSubtitle: document.getElementById("activeChatSubtitle"),
  chatAvatar: document.getElementById("chatAvatar"),
  messages: document.getElementById("messages"),
  messageInput: document.getElementById("messageInput"),
  sendBtn: document.getElementById("sendBtn"),
  fileInput: document.getElementById("fileInput"),
  audioCallBtn: document.getElementById("audioCallBtn"),
  videoCallBtn: document.getElementById("videoCallBtn"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setAuthError(text = "") {
  if (el.authError) el.authError.textContent = text;
}

function setGlobalStatus(text) {
  if (el.globalStatus) el.globalStatus.textContent = text;
}

function getAuthHeaders(isJson = true) {
  const headers = {};
  if (isJson) headers["Content-Type"] = "application/json";
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  return headers;
}

async function api(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, options);
  let data = null;

  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const msg = data?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return data;
}

function isValidUsername(username) {
  return /^[a-zA-Z0-9_]{3,20}$/.test(username);
}

function formatTime(dateString) {
  if (!dateString) return "";
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function showAuth() {
  el.authScreen.classList.remove("hidden");
  el.appScreen.classList.add("hidden");
}

function showApp() {
  el.authScreen.classList.add("hidden");
  el.appScreen.classList.remove("hidden");
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

function getChatSubtitle(chat) {
  if (chat?.subtitle) return chat.subtitle;
  if (chat?.peer?.status_text) return chat.peer.status_text;
  if (chat?.is_group) return "группа";
  return "личный чат";
}

function getChatTitle(chat) {
  if (chat?.peer?.display_name) return chat.peer.display_name;
  return chat?.title || "Чат";
}

function getAvatarLetter(chat) {
  const title = getChatTitle(chat);
  return title ? title.charAt(0).toUpperCase() : "V";
}

function renderChats() {
  if (!state.chats.length) {
    el.chatsList.innerHTML = `<div class="empty-chat">Чатов пока нет</div>`;
    return;
  }

  el.chatsList.innerHTML = state.chats
    .map((chat) => {
      const active = Number(chat.id) === Number(state.activeChatId) ? "active" : "";
      return `
        <div class="chat-item ${active}" data-chat-id="${chat.id}">
          <strong>${escapeHtml(getChatTitle(chat))}</strong>
          <span>${escapeHtml(chat.last_message || getChatSubtitle(chat))}</span>
        </div>
      `;
    })
    .join("");

  [...el.chatsList.querySelectorAll(".chat-item")].forEach((item) => {
    item.addEventListener("click", () => {
      const chatId = Number(item.dataset.chatId);
      openChat(chatId);
    });
  });
}

function renderMessages(messages) {
  if (!messages.length) {
    el.messages.innerHTML = `<div class="empty-chat">Сообщений пока нет</div>`;
    return;
  }

  el.messages.innerHTML = messages
    .map((msg) => {
      const mine = Number(msg.sender_id) === Number(state.me?.id);
      return `
        <div class="message ${mine ? "me" : "other"}">
          <div class="meta">
            ${escapeHtml(msg.sender_display_name || msg.sender_username || "")}
            · ${escapeHtml(formatTime(msg.created_at))}
          </div>
          <div>${escapeHtml(msg.text || "")}</div>
        </div>
      `;
    })
    .join("");

  el.messages.scrollTop = el.messages.scrollHeight;
}

async function loadChats() {
  try {
    const data = await api("/api/chats", {
      headers: getAuthHeaders(),
    });
    state.chats = data.chats || [];
    renderChats();

    if (state.activeChatId) {
      const stillExists = state.chats.find((c) => Number(c.id) === Number(state.activeChatId));
      if (!stillExists) {
        state.activeChatId = null;
        el.activeChatTitle.textContent = "Выбери чат";
        el.activeChatSubtitle.textContent = "Сообщения будут здесь";
        el.messages.innerHTML = `<div class="empty-chat">Открой чат слева или найди пользователя.</div>`;
      }
    }
  } catch (err) {
    console.error("loadChats error", err);
  }
}

async function openChat(chatId) {
  state.activeChatId = Number(chatId);

  const chat = state.chats.find((c) => Number(c.id) === Number(chatId));
  if (chat) {
    el.activeChatTitle.textContent = getChatTitle(chat);
    el.activeChatSubtitle.textContent = getChatSubtitle(chat);
    el.chatAvatar.textContent = getAvatarLetter(chat);
  }

  renderChats();

  try {
    const meta = await api(`/api/chats/${chatId}`, {
      headers: getAuthHeaders(),
    });

    if (meta?.chat) {
      const idx = state.chats.findIndex((c) => Number(c.id) === Number(chatId));
      if (idx >= 0) {
        state.chats[idx] = { ...state.chats[idx], ...meta.chat };
      }
      el.activeChatTitle.textContent = getChatTitle(meta.chat);
      el.activeChatSubtitle.textContent = getChatSubtitle(meta.chat);
      el.chatAvatar.textContent = getAvatarLetter(meta.chat);
      renderChats();
    }
  } catch (err) {
    console.error("chat meta error", err);
  }

  try {
    const data = await api(`/api/chats/${chatId}/messages`, {
      headers: getAuthHeaders(),
    });
    renderMessages(data.messages || []);
  } catch (err) {
    console.error("messages error", err);
    el.messages.innerHTML = `<div class="empty-chat">Не удалось загрузить сообщения</div>`;
  }
}

async function sendMessage() {
  if (!state.activeChatId) return;
  const text = el.messageInput.value.trim();
  if (!text) return;

  el.sendBtn.disabled = true;
  try {
    await api(`/api/chats/${state.activeChatId}/messages`, {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ text }),
    });
    el.messageInput.value = "";
    await openChat(state.activeChatId);
    await loadChats();
  } catch (err) {
    alert(err.message || "Ошибка отправки");
  } finally {
    el.sendBtn.disabled = false;
  }
}

async function searchUsers() {
  const q = el.userSearch.value.trim();
  if (!q) {
    el.userResults.innerHTML = "";
    return;
  }

  try {
    const data = await api(`/api/users/search?q=${encodeURIComponent(q)}`, {
      headers: getAuthHeaders(false),
    });

    const users = data.users || [];
    if (!users.length) {
      el.userResults.innerHTML = `<div class="empty-chat">Ничего не найдено</div>`;
      return;
    }

    el.userResults.innerHTML = users
      .map(
        (user) => `
          <div class="search-user">
            <div class="name">
              <strong>${escapeHtml(user.display_name || user.username)}</strong>
              <span>@${escapeHtml(user.username)} · ${escapeHtml(user.status_text || "был недавно")}</span>
            </div>
            <button type="button" data-user-id="${user.id}">Чат</button>
          </div>
        `
      )
      .join("");

    [...el.userResults.querySelectorAll("button[data-user-id]")].forEach((btn) => {
      btn.addEventListener("click", async () => {
        const userId = Number(btn.dataset.userId);
        try {
          const data = await api("/api/chats/direct", {
            method: "POST",
            headers: getAuthHeaders(),
            body: JSON.stringify({ userId }),
          });
          await loadChats();
          if (data?.chat?.id) {
            await openChat(data.chat.id);
          }
        } catch (err) {
          alert(err.message || "Не удалось создать чат");
        }
      });
    });
  } catch (err) {
    console.error("search error", err);
  }
}

async function createGroup() {
  const title = el.groupTitle.value.trim();
  const memberIds = el.groupMembers.value
    .split(",")
    .map((v) => Number(v.trim()))
    .filter(Boolean);

  if (!title) {
    alert("Введи название группы");
    return;
  }

  try {
    const data = await api("/api/chats/group", {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({ title, memberIds }),
    });

    el.groupTitle.value = "";
    el.groupMembers.value = "";
    await loadChats();

    if (data?.chat?.id) {
      await openChat(data.chat.id);
    }
  } catch (err) {
    alert(err.message || "Не удалось создать группу");
  }
}

function connectStream() {
  if (!state.token) return;

  if (state.stream) {
    state.stream.close();
    state.stream = null;
  }

  const streamUrl = `${API_BASE}/api/stream?token=${encodeURIComponent(state.token)}`;
  const es = new EventSource(streamUrl);
  state.stream = es;

  es.addEventListener("ready", () => {
    setGlobalStatus("Подключено к серверу");
  });

  es.addEventListener("ping", () => {
    if (navigator.onLine) {
      setGlobalStatus("Подключено к серверу");
    }
  });

  es.addEventListener("message:new", async (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (Number(payload?.message?.chat_id) === Number(state.activeChatId)) {
        await openChat(state.activeChatId);
      }
      await loadChats();
    } catch (err) {
      console.error(err);
    }
  });

  es.addEventListener("chat:new", async () => {
    await loadChats();
  });

  es.onerror = () => {
    if (!navigator.onLine) {
      setGlobalStatus("Нет интернета");
    } else {
      setGlobalStatus("Проблема с сервером");
    }
  };
}

async function checkServerStatus() {
  if (!navigator.onLine) {
    setGlobalStatus("Нет интернета");
    return;
  }

  try {
    setGlobalStatus("Обновление...");
    const res = await fetch(`${API_BASE}/health`, { cache: "no-store" });
    if (res.ok) {
      setGlobalStatus(state.token ? "Подключено к серверу" : "Сервер доступен");
    } else {
      setGlobalStatus("Проблема с сервером");
    }
  } catch {
    setGlobalStatus("Проблема с сервером");
  }
}

async function login() {
  setAuthError("");

  const username = el.username.value.trim();
  const password = el.password.value;

  if (!username || !password) {
    setAuthError("Заполни username и password");
    return;
  }

  el.loginBtn.disabled = true;

  try {
    const data = await api("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    state.token = data.token;
    state.me = data.user;
    localStorage.setItem("volnagramm_token", state.token);

    showApp();
    renderMe();
    await loadChats();
    connectStream();
    await checkServerStatus();
  } catch (err) {
    setAuthError(err.message || "Ошибка входа");
  } finally {
    el.loginBtn.disabled = false;
  }
}

async function register() {
  setAuthError("");

  const username = el.username.value.trim();
  const displayName = el.displayName.value.trim();
  const password = el.password.value;

  if (!username || !displayName || !password) {
    setAuthError("Заполни username, display name и password");
    return;
  }

  if (!isValidUsername(username)) {
    setAuthError("Username: 3-20 символов, только английские буквы, цифры и _");
    return;
  }

  if (password.length < 4) {
    setAuthError("Пароль должен быть не короче 4 символов");
    return;
  }

  el.registerBtn.disabled = true;

  try {
    const data = await api("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, displayName }),
    });

    state.token = data.token;
    state.me = data.user;
    localStorage.setItem("volnagramm_token", state.token);

    showApp();
    renderMe();
    await loadChats();
    connectStream();
    await checkServerStatus();
  } catch (err) {
    setAuthError(err.message || "Ошибка регистрации");
  } finally {
    el.registerBtn.disabled = false;
  }
}

async function restoreSession() {
  if (!state.token) {
    showAuth();
    await checkServerStatus();
    return;
  }

  try {
    const data = await api("/api/me", {
      headers: getAuthHeaders(false),
    });

    state.me = data.user;
    showApp();
    renderMe();
    await loadChats();
    connectStream();
    await checkServerStatus();
  } catch {
    localStorage.removeItem("volnagramm_token");
    state.token = "";
    state.me = null;
    showAuth();
    await checkServerStatus();
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
  el.userSearch.value = "";
  el.userResults.innerHTML = "";
  el.chatsList.innerHTML = "";
  el.messages.innerHTML = `<div class="empty-chat">Открой чат слева или найди пользователя.</div>`;
  el.activeChatTitle.textContent = "Выбери чат";
  el.activeChatSubtitle.textContent = "Сообщения будут здесь";

  showAuth();
  checkServerStatus();
}

function bindEvents() {
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
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(searchUsers, 300);
  });

  window.addEventListener("online", checkServerStatus);
  window.addEventListener("offline", checkServerStatus);
}

async function init() {
  bindEvents();
  await restoreSession();

  if (state.healthTimer) clearInterval(state.healthTimer);
  state.healthTimer = setInterval(checkServerStatus, 15000);
}

init();
