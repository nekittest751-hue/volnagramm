const API_BASE = 'https://volnagramm.onrender.com';

const state = {
  token: localStorage.getItem('volnagramm_token') || '',
  user: JSON.parse(localStorage.getItem('volnagramm_user') || 'null'),
  chats: [],
  currentChat: null,
  currentChatMeta: null,
  messagesByChat: new Map(),
  es: null,
  streamConnected: false,
  pendingRequests: 0,
  internetOnline: navigator.onLine,
  currentCall: null,
  localStream: null,
  peer: null,
};

const $ = (id) => document.getElementById(id);
const els = {
  authScreen: $('authScreen'),
  appShell: $('appShell'),
  authError: $('authError'),
  loginForm: $('loginForm'),
  registerForm: $('registerForm'),
  loginUsername: $('loginUsername'),
  loginPassword: $('loginPassword'),
  registerUsername: $('registerUsername'),
  registerDisplayName: $('registerDisplayName'),
  registerPassword: $('registerPassword'),
  showLoginTab: $('showLoginTab'),
  showRegisterTab: $('showRegisterTab'),
  meName: $('meName'),
  meUsername: $('meUsername'),
  meAvatar: $('meAvatar'),
  chatList: $('chatList'),
  messages: $('messages'),
  searchInput: $('searchInput'),
  searchResults: $('searchResults'),
  groupTitle: $('groupTitle'),
  groupMemberIds: $('groupMemberIds'),
  createGroupBtn: $('createGroupBtn'),
  chatTitle: $('chatTitle'),
  chatSubtitle: $('chatSubtitle'),
  messageForm: $('messageForm'),
  messageInput: $('messageInput'),
  fileInput: $('fileInput'),
  logoutBtn: $('logoutBtn'),
  syncStatus: $('syncStatus'),
  headerStatus: $('headerStatus'),
  internetStatus: [$('internetStatus'), $('internetStatusApp')],
  serverStatus: [$('serverStatusAuth'), $('serverStatusApp')],
  audioCallBtn: $('audioCallBtn'),
  videoCallBtn: $('videoCallBtn'),
  callModal: $('callModal'),
  callTitle: $('callTitle'),
  callText: $('callText'),
  acceptCallBtn: $('acceptCallBtn'),
  rejectCallBtn: $('rejectCallBtn'),
  endCallBtn: $('endCallBtn'),
  localVideo: $('localVideo'),
  remoteVideo: $('remoteVideo'),
};

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function setStatusChip(node, text, kind = 'neutral') {
  if (!node) return;
  node.textContent = text;
  node.className = `status-chip ${kind}`;
}

function setInternetStatus() {
  const text = state.internetOnline ? 'Интернет есть' : 'Нет интернета';
  const kind = state.internetOnline ? 'connected' : 'error';
  els.internetStatus.forEach((el) => setStatusChip(el, text, kind));
}

function setServerStatus(text, kind) {
  els.serverStatus.forEach((el) => setStatusChip(el, text, kind));
  setStatusChip(els.headerStatus, text, kind);
}

function setSync(text) {
  els.syncStatus.textContent = text;
}

function authHeaders(extra = {}) {
  return {
    ...extra,
    Authorization: `Bearer ${state.token}`,
  };
}

async function api(path, options = {}) {
  const headers = options.body instanceof FormData
    ? authHeaders(options.headers || {})
    : authHeaders({ 'Content-Type': 'application/json', ...(options.headers || {}) });

  state.pendingRequests += 1;
  setSync('Обновление…');
  try {
    const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  } finally {
    state.pendingRequests -= 1;
    setSync(state.pendingRequests > 0 ? 'Обновление…' : 'Синхронизировано');
  }
}

async function pingServer() {
  try {
    const res = await fetch(`${API_BASE}/health`, { cache: 'no-store' });
    if (!res.ok) throw new Error('health fail');
    setServerStatus(state.streamConnected ? 'Подключено к серверу' : 'Сервер доступен', 'connected');
  } catch {
    setServerStatus('Проблема с сервером', 'error');
  }
}

function setAuthMode(mode) {
  const login = mode === 'login';
  els.loginForm.classList.toggle('hidden', !login);
  els.registerForm.classList.toggle('hidden', login);
  els.showLoginTab.classList.toggle('active', login);
  els.showRegisterTab.classList.toggle('active', !login);
  els.authError.classList.add('hidden');
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
  state.chats = [];
  state.currentChat = null;
  state.currentChatMeta = null;
  state.messagesByChat.clear();
  localStorage.removeItem('volnagramm_token');
  localStorage.removeItem('volnagramm_user');
  if (state.es) state.es.close();
  state.es = null;
  state.streamConnected = false;
}

function showAuthError(text) {
  els.authError.textContent = text;
  els.authError.classList.remove('hidden');
}

function initials(name) {
  return (name || 'V').trim().slice(0, 1).toUpperCase();
}

function relativeTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
}

function formatSize(size) {
  if (!size) return '';
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let v = size;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function renderShell() {
  const loggedIn = !!state.token && !!state.user;
  els.authScreen.classList.toggle('hidden', loggedIn);
  els.appShell.classList.toggle('hidden', !loggedIn);
  if (!loggedIn) return;
  els.meName.textContent = state.user.display_name;
  els.meUsername.textContent = `@${state.user.username}`;
  els.meAvatar.textContent = initials(state.user.display_name || state.user.username);
  renderChats();
  renderMessages();
}

function chatSubtitle(chat) {
  if (!chat) return 'После входа здесь появятся переписки';
  if (!chat.is_group && chat.peer_status) return chat.peer_status;
  return chat.is_group ? 'группа' : 'личный чат';
}

function lastPreview(chat) {
  if (chat.last_message_type === 'file') return `Файл: ${chat.last_file_name || 'вложение'}`;
  return chat.last_message || 'Нет сообщений';
}

function renderChats() {
  if (!state.chats.length) {
    els.chatList.innerHTML = '<div class="muted">Чатов пока нет</div>';
    return;
  }
  els.chatList.innerHTML = state.chats.map((chat) => `
    <div class="chat-item ${state.currentChat?.id === chat.id ? 'active' : ''}" data-chat-id="${chat.id}">
      <div class="chat-top">
        <strong>${escapeHtml(chat.is_group ? chat.title : (chat.peer_display_name || chat.title))}</strong>
        <span class="chat-time">${escapeHtml(relativeTime(chat.last_message_at || chat.created_at))}</span>
      </div>
      <div class="chat-sub">${escapeHtml(lastPreview(chat))}</div>
      ${!chat.is_group ? `<div class="chat-time">${escapeHtml(chat.peer_status || '')}</div>` : ''}
    </div>
  `).join('');

  [...els.chatList.querySelectorAll('.chat-item')].forEach((node) => {
    node.addEventListener('click', () => openChat(Number(node.dataset.chatId)));
  });
}

function renderMessages() {
  const chatId = state.currentChat?.id;
  const messages = chatId ? (state.messagesByChat.get(chatId) || []) : [];
  const canCall = !!state.currentChat && !state.currentChat.is_group && !!state.currentChat.peer_id;
  els.audioCallBtn.classList.toggle('hidden', !canCall);
  els.videoCallBtn.classList.toggle('hidden', !canCall);
  els.messageForm.classList.toggle('hidden', !state.currentChat);

  if (!state.currentChat) {
    els.messages.innerHTML = `<div class="empty-state"><div class="empty-icon">✈</div><h2>Добро пожаловать в Volnagramm</h2><p>Найди пользователя слева или создай группу, чтобы начать общение.</p></div>`;
    els.chatTitle.textContent = 'Выбери чат';
    els.chatSubtitle.textContent = 'После входа здесь появятся переписки';
    return;
  }

  els.chatTitle.textContent = state.currentChat.is_group ? state.currentChat.title : (state.currentChat.peer_display_name || state.currentChat.title);
  els.chatSubtitle.textContent = chatSubtitle(state.currentChat);

  if (!messages.length) {
    els.messages.innerHTML = '<div class="empty-state"><div class="empty-icon">💬</div><h2>Пока пусто</h2><p>Напиши первое сообщение.</p></div>';
    return;
  }

  els.messages.innerHTML = messages.map((msg) => {
    const mine = msg.sender_id === state.user.id;
    const fileBlock = msg.type === 'file'
      ? `<a class="message-file" href="${API_BASE}${msg.file_url}" target="_blank" rel="noreferrer">📎 <span>${escapeHtml(msg.file_name || 'file')}</span> <small>${escapeHtml(formatSize(msg.file_size))}</small></a>`
      : '';
    return `
      <div class="message ${mine ? 'mine' : ''}">
        <div class="message-head">
          <strong>${escapeHtml(msg.sender_display_name || msg.sender_username)}</strong>
          <span>${escapeHtml(relativeTime(msg.created_at))}</span>
        </div>
        ${msg.text ? `<div class="message-text">${escapeHtml(msg.text)}</div>` : ''}
        ${fileBlock}
      </div>
    `;
  }).join('');
  els.messages.scrollTop = els.messages.scrollHeight;
}

async function loadChats() {
  const { chats } = await api('/api/chats');
  state.chats = chats;
  if (state.currentChat) {
    const fresh = chats.find((c) => c.id === state.currentChat.id);
    state.currentChat = fresh || state.currentChat;
  }
  renderChats();
  renderMessages();
}

async function openChat(chatId) {
  const chat = state.chats.find((c) => c.id === chatId);
  state.currentChat = chat || null;
  renderChats();
  renderMessages();
  const [{ messages }, meta] = await Promise.all([
    api(`/api/chats/${chatId}/messages`),
    api(`/api/chats/${chatId}/meta`)
  ]);
  state.messagesByChat.set(chatId, messages);
  state.currentChatMeta = meta;
  if (!state.currentChat.is_group) {
    const peer = meta.members.find((m) => m.id !== state.user.id);
    if (peer) {
      state.currentChat.peer_id = peer.id;
      state.currentChat.peer_display_name = peer.display_name;
      state.currentChat.peer_status = peer.status;
      state.currentChat.peer_online = peer.online;
    }
  }
  renderChats();
  renderMessages();
}

async function searchUsers() {
  const q = els.searchInput.value.trim();
  if (!q) {
    els.searchResults.innerHTML = '';
    return;
  }
  const { users } = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
  els.searchResults.innerHTML = users.map((user) => `
    <div class="result-item" data-user-id="${user.id}">
      <div class="result-top"><strong>${escapeHtml(user.display_name)}</strong><span>${user.online ? '●' : ''}</span></div>
      <div class="result-sub">@${escapeHtml(user.username)} · ${escapeHtml(user.status)}</div>
    </div>
  `).join('');
  [...els.searchResults.querySelectorAll('.result-item')].forEach((node) => {
    node.addEventListener('click', async () => {
      const userId = Number(node.dataset.userId);
      const { chat } = await api('/api/chats/direct', { method: 'POST', body: JSON.stringify({ userId }) });
      await loadChats();
      await openChat(chat.id);
    });
  });
}

function connectStream() {
  if (!state.token) return;
  if (state.es) state.es.close();
  setServerStatus('Подключение…', 'warning');
  const es = new EventSource(`${API_BASE}/api/stream?token=${encodeURIComponent(state.token)}`);
  state.es = es;

  es.addEventListener('ready', () => {
    state.streamConnected = true;
    setServerStatus('Подключено к серверу', 'connected');
  });

  es.addEventListener('message:new', async (ev) => {
    const { message } = JSON.parse(ev.data);
    const list = state.messagesByChat.get(message.chat_id) || [];
    state.messagesByChat.set(message.chat_id, [...list, message]);
    await loadChats();
    if (state.currentChat?.id === message.chat_id) renderMessages();
  });

  es.addEventListener('chat:new', async () => {
    await loadChats();
  });

  es.addEventListener('presence:update', (ev) => {
    const payload = JSON.parse(ev.data);
    state.chats = state.chats.map((chat) => {
      if (!chat.is_group && chat.peer_id === payload.userId) {
        return { ...chat, peer_status: payload.status, peer_online: payload.online, peer_last_seen: payload.lastSeen };
      }
      return chat;
    });
    if (state.currentChat && !state.currentChat.is_group && state.currentChat.peer_id === payload.userId) {
      state.currentChat = { ...state.currentChat, peer_status: payload.status, peer_online: payload.online, peer_last_seen: payload.lastSeen };
      renderMessages();
    }
    renderChats();
  });

  es.addEventListener('call:incoming', (ev) => onIncomingCall(JSON.parse(ev.data)));
  es.addEventListener('call:accepted', () => {
    if (state.currentCall) {
      els.callText.textContent = 'Собеседник ответил. Устанавливаем соединение…';
    }
  });
  es.addEventListener('call:rejected', () => {
    els.callText.textContent = 'Звонок отклонён';
    teardownCall();
  });
  es.addEventListener('call:signal', async (ev) => handleSignal(JSON.parse(ev.data)));
  es.addEventListener('call:ended', () => {
    els.callText.textContent = 'Звонок завершён';
    teardownCall();
  });

  es.onerror = () => {
    state.streamConnected = false;
    setServerStatus(state.internetOnline ? 'Проблема с сервером' : 'Нет интернета', 'error');
  };
}

async function handleLogin(ev) {
  ev.preventDefault();
  try {
    const { token, user } = await fetch(`${API_BASE}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: els.loginUsername.value.trim(), password: els.loginPassword.value })
    }).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Login failed');
      return data;
    });
    setSession(token, user);
    renderShell();
    connectStream();
    await loadChats();
  } catch (err) {
    showAuthError(err.message);
  }
}

async function handleRegister(ev) {
  ev.preventDefault();
  try {
    const { token, user } = await fetch(`${API_BASE}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: els.registerUsername.value.trim(),
        displayName: els.registerDisplayName.value.trim(),
        password: els.registerPassword.value
      })
    }).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Register failed');
      return data;
    });
    setSession(token, user);
    renderShell();
    connectStream();
    await loadChats();
  } catch (err) {
    showAuthError(err.message);
  }
}

async function handleSendMessage(ev) {
  ev.preventDefault();
  if (!state.currentChat) return;
  const text = els.messageInput.value.trim();
  if (!text) return;
  await api(`/api/chats/${state.currentChat.id}/messages`, { method: 'POST', body: JSON.stringify({ text }) });
  els.messageInput.value = '';
}

async function handleFileUpload() {
  if (!state.currentChat || !els.fileInput.files[0]) return;
  const form = new FormData();
  form.append('file', els.fileInput.files[0]);
  const caption = els.messageInput.value.trim();
  if (caption) form.append('caption', caption);
  try {
    await api(`/api/chats/${state.currentChat.id}/upload`, { method: 'POST', body: form, headers: {} });
    els.fileInput.value = '';
    els.messageInput.value = '';
  } catch (err) {
    alert(err.message);
  }
}

async function handleCreateGroup() {
  const title = els.groupTitle.value.trim();
  const memberIds = els.groupMemberIds.value.split(',').map((x) => Number(x.trim())).filter(Boolean);
  if (!title) return;
  const { chat } = await api('/api/chats/group', { method: 'POST', body: JSON.stringify({ title, memberIds }) });
  els.groupTitle.value = '';
  els.groupMemberIds.value = '';
  await loadChats();
  await openChat(chat.id);
}

async function startCall(kind) {
  if (!state.currentChat || state.currentChat.is_group || !state.currentChat.peer_id) return;
  try {
    const { callId } = await api('/api/calls/start', { method: 'POST', body: JSON.stringify({ chatId: state.currentChat.id, targetUserId: state.currentChat.peer_id, kind }) });
    state.currentCall = { callId, kind, targetUserId: state.currentChat.peer_id, incoming: false };
    await prepareCallMedia(kind);
    await createPeer(true);
    showCallModal(`${kind === 'video' ? 'Видеозвонок' : 'Аудиозвонок'}`, 'Звоним…');
  } catch (err) {
    alert(err.message);
  }
}

function showCallModal(title, text, options = {}) {
  els.callTitle.textContent = title;
  els.callText.textContent = text;
  els.callModal.classList.remove('hidden');
  els.acceptCallBtn.classList.toggle('hidden', !options.showAccept);
  els.rejectCallBtn.classList.toggle('hidden', !options.showReject);
  els.endCallBtn.classList.toggle('hidden', !options.showEnd);
}

async function onIncomingCall(payload) {
  state.currentCall = { callId: payload.callId, kind: payload.kind, targetUserId: payload.fromUserId, incoming: true };
  showCallModal(payload.kind === 'video' ? 'Входящий видеозвонок' : 'Входящий звонок', `${payload.fromName} звонит…`, { showAccept: true, showReject: true });
}

async function prepareCallMedia(kind) {
  const constraints = kind === 'video' ? { audio: true, video: true } : { audio: true, video: false };
  state.localStream = await navigator.mediaDevices.getUserMedia(constraints);
  els.localVideo.srcObject = state.localStream;
}

async function createPeer(isInitiator) {
  state.peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  if (state.localStream) {
    state.localStream.getTracks().forEach((track) => state.peer.addTrack(track, state.localStream));
  }
  state.peer.ontrack = (ev) => {
    els.remoteVideo.srcObject = ev.streams[0];
    els.callText.textContent = 'Соединение установлено';
  };
  state.peer.onicecandidate = async (ev) => {
    if (!ev.candidate || !state.currentCall) return;
    await api(`/api/calls/${state.currentCall.callId}/signal`, {
      method: 'POST',
      body: JSON.stringify({ targetUserId: state.currentCall.targetUserId, signalType: 'ice', data: ev.candidate })
    });
  };
  if (isInitiator) {
    const offer = await state.peer.createOffer();
    await state.peer.setLocalDescription(offer);
    await api(`/api/calls/${state.currentCall.callId}/signal`, {
      method: 'POST',
      body: JSON.stringify({ targetUserId: state.currentCall.targetUserId, signalType: 'offer', data: offer })
    });
    els.endCallBtn.classList.remove('hidden');
  }
}

async function handleSignal(payload) {
  if (!state.currentCall || payload.callId !== state.currentCall.callId) return;
  if (!state.peer) await createPeer(false);
  if (payload.signalType === 'offer') {
    await state.peer.setRemoteDescription(new RTCSessionDescription(payload.data));
    const answer = await state.peer.createAnswer();
    await state.peer.setLocalDescription(answer);
    await api(`/api/calls/${state.currentCall.callId}/signal`, {
      method: 'POST',
      body: JSON.stringify({ targetUserId: state.currentCall.targetUserId, signalType: 'answer', data: answer })
    });
    showCallModal(state.currentCall.kind === 'video' ? 'Видеозвонок' : 'Аудиозвонок', 'Соединяем…', { showEnd: true });
  } else if (payload.signalType === 'answer') {
    await state.peer.setRemoteDescription(new RTCSessionDescription(payload.data));
    els.callText.textContent = 'Соединяем…';
  } else if (payload.signalType === 'ice') {
    try { await state.peer.addIceCandidate(new RTCIceCandidate(payload.data)); } catch {}
  }
}

async function acceptCall() {
  if (!state.currentCall) return;
  await api(`/api/calls/${state.currentCall.callId}/accept`, { method: 'POST', body: JSON.stringify({}) });
  await prepareCallMedia(state.currentCall.kind);
  await createPeer(false);
  showCallModal(state.currentCall.kind === 'video' ? 'Видеозвонок' : 'Аудиозвонок', 'Ждём сигнал…', { showEnd: true });
}

async function rejectCall() {
  if (!state.currentCall) return;
  await api(`/api/calls/${state.currentCall.callId}/reject`, { method: 'POST', body: JSON.stringify({}) });
  teardownCall();
}

async function endCall() {
  if (state.currentCall) {
    await api(`/api/calls/${state.currentCall.callId}/end`, { method: 'POST', body: JSON.stringify({ targetUserId: state.currentCall.targetUserId }) }).catch(() => {});
  }
  teardownCall();
}

function teardownCall() {
  if (state.peer) {
    state.peer.close();
    state.peer = null;
  }
  if (state.localStream) {
    state.localStream.getTracks().forEach((t) => t.stop());
    state.localStream = null;
  }
  els.localVideo.srcObject = null;
  els.remoteVideo.srcObject = null;
  state.currentCall = null;
  els.callModal.classList.add('hidden');
}

function bindEvents() {
  els.showLoginTab.addEventListener('click', () => setAuthMode('login'));
  els.showRegisterTab.addEventListener('click', () => setAuthMode('register'));
  els.loginForm.addEventListener('submit', handleLogin);
  els.registerForm.addEventListener('submit', handleRegister);
  els.messageForm.addEventListener('submit', handleSendMessage);
  els.searchInput.addEventListener('input', () => {
    clearTimeout(bindEvents.searchTimer);
    bindEvents.searchTimer = setTimeout(searchUsers, 250);
  });
  els.createGroupBtn.addEventListener('click', handleCreateGroup);
  els.fileInput.addEventListener('change', handleFileUpload);
  els.logoutBtn.addEventListener('click', () => {
    clearSession();
    teardownCall();
    renderShell();
  });
  els.audioCallBtn.addEventListener('click', () => startCall('audio'));
  els.videoCallBtn.addEventListener('click', () => startCall('video'));
  els.acceptCallBtn.addEventListener('click', acceptCall);
  els.rejectCallBtn.addEventListener('click', rejectCall);
  els.endCallBtn.addEventListener('click', endCall);
  window.addEventListener('online', () => { state.internetOnline = true; setInternetStatus(); pingServer(); });
  window.addEventListener('offline', () => { state.internetOnline = false; setInternetStatus(); setServerStatus('Нет интернета', 'error'); });
}

async function boot() {
  bindEvents();
  setInternetStatus();
  await pingServer();
  setAuthMode('login');
  renderShell();
  if (state.token && state.user) {
    connectStream();
    try {
      await loadChats();
    } catch {
      setServerStatus('Проблема с сервером', 'error');
    }
  }
  setInterval(pingServer, 15000);
}

boot();
