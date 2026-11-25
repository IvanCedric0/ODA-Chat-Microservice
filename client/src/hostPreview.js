import './hostPreview.css';

const form = document.querySelector('#host-form');
const topicIdInput = document.querySelector('#topic-id');
const tokenInput = document.querySelector('#auth-token');
const usersInput = document.querySelector('#online-users');
const frameWrap = document.querySelector('#chat-frame-wrap');
const frame = document.querySelector('#chat-frame');
const status = document.querySelector('#host-status');
const updatePresenceButton = document.querySelector('#update-presence');
const presenceChannel = typeof BroadcastChannel === 'function'
  ? new BroadcastChannel('oda-chat-host-presence')
  : null;

let authToken = '';
let onlineUsers = [];
let widgetReady = false;
let currentTopicId = null;

const setStatus = (message) => {
  status.textContent = message;
};

const readOnlineUsers = () => {
  const users = JSON.parse(usersInput.value);
  if (!Array.isArray(users)) {
    throw new Error('La présence doit être un tableau JSON.');
  }
  return users;
};

const applyPresenceUpdate = (topicId, user, isJoining, broadcast) => {
  if (topicId !== currentTopicId) return;

  const existingUser = onlineUsers.find((onlineUser) => onlineUser.id === user.id);
  onlineUsers = onlineUsers.filter((onlineUser) => onlineUser.id !== user.id);
  if (isJoining) {
    onlineUsers.push({
      id: user.id,
      name: user.name?.trim() || existingUser?.name || `Utilisateur ${user.id}`,
    });
  }

  usersInput.value = JSON.stringify(onlineUsers);
  if (widgetReady && frame.contentWindow) {
    frame.contentWindow.postMessage(
      { type: 'SET_ONLINE_USERS', users: onlineUsers },
      window.location.origin,
    );
  }
  if (broadcast) {
    presenceChannel?.postMessage({
      type: isJoining ? 'CHAT_PARTICIPANT_JOINED' : 'CHAT_PARTICIPANT_LEFT',
      topicId,
      user: {
        id: user.id,
        name: user.name?.trim() || existingUser?.name || `Utilisateur ${user.id}`,
      },
    });
  }
};

const sendWidgetData = () => {
  if (!widgetReady || !frame.contentWindow) return;

  const targetOrigin = window.location.origin;
  frame.contentWindow.postMessage({ type: 'SET_AUTH_TOKEN', token: authToken }, targetOrigin);
  frame.contentWindow.postMessage({ type: 'SET_ONLINE_USERS', users: onlineUsers }, targetOrigin);
  updatePresenceButton.disabled = false;
  setStatus('Le widget a reçu le token et la liste de présence.');
};

window.addEventListener('message', (event) => {
  if (event.source !== frame.contentWindow || event.origin !== window.location.origin) return;

  if (event.data?.type === 'CHAT_READY') {
    widgetReady = true;
    sendWidgetData();
  } else if (event.data?.type === 'CHAT_JOIN' || event.data?.type === 'CHAT_LEAVE') {
    const { topicId, userId } = event.data;
    if (
      !Number.isInteger(topicId)
      || topicId <= 0
      || !Number.isInteger(userId)
      || userId <= 0
    ) {
      return;
    }

    const user = onlineUsers.find((onlineUser) => onlineUser.id === userId)
      || { id: userId, name: `Utilisateur ${userId}` };
    const isJoining = event.data.type === 'CHAT_JOIN';
    applyPresenceUpdate(topicId, user, isJoining, true);
    if (!isJoining) setStatus('Vous avez quitté le salon.');
  }
});

presenceChannel?.addEventListener('message', ({ data }) => {
  if (
    !data
    || !['CHAT_PARTICIPANT_JOINED', 'CHAT_PARTICIPANT_LEFT'].includes(data.type)
    || !Number.isInteger(data.topicId)
    || data.topicId <= 0
    || !data.user
    || !Number.isInteger(data.user.id)
    || data.user.id <= 0
    || typeof data.user.name !== 'string'
  ) {
    return;
  }

  applyPresenceUpdate(
    data.topicId,
    data.user,
    data.type === 'CHAT_PARTICIPANT_JOINED',
    false,
  );
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const topicId = Number(topicIdInput.value);
  const token = tokenInput.value.trim();

  if (!Number.isInteger(topicId) || topicId <= 0 || !token) {
    setStatus('Entrez un ID de salon valide et un JWT.');
    return;
  }

  try {
    onlineUsers = readOnlineUsers();
  } catch (error) {
    setStatus(error.message);
    return;
  }

  currentTopicId = topicId;
  authToken = token;
  widgetReady = false;
  updatePresenceButton.disabled = true;
  frameWrap.hidden = false;
  frame.src = `${window.location.origin}/embed/?topicId=${encodeURIComponent(topicId)}`;
  setStatus('Chargement du widget...');
});

updatePresenceButton.addEventListener('click', () => {
  try {
    onlineUsers = readOnlineUsers();
    if (widgetReady && frame.contentWindow) {
      frame.contentWindow.postMessage(
        { type: 'SET_ONLINE_USERS', users: onlineUsers },
        window.location.origin,
      );
      setStatus('Liste de présence envoyée au widget.');
    }
  } catch (error) {
    setStatus(error.message);
  }
});
