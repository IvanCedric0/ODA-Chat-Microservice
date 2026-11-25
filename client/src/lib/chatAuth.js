export const parseAllowedParentOrigins = (value) => {
  if (!value?.trim()) return [];

  return value.split(',').map((entry) => {
    const origin = entry.trim();
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`Origine hôte invalide dans VITE_CHAT_PARENT_ORIGINS : ${origin}`);
    }

    if (
      !['http:', 'https:'].includes(parsed.protocol)
      || origin.includes('*')
      || parsed.origin !== origin
      || parsed.username
      || parsed.password
    ) {
      throw new Error(`Utilisez une origine HTTP(S) exacte dans VITE_CHAT_PARENT_ORIGINS : ${origin}`);
    }

    return parsed.origin;
  });
};

export const getParentOrigin = (referrer) => {
  try {
    return new URL(referrer).origin;
  } catch {
    return '';
  }
};

const isTrustedParentMessage = (event, allowedOrigins, parentWindow) => (
  event.source === parentWindow
  && allowedOrigins.includes(event.origin)
  && event.data
  && typeof event.data === 'object'
);

export const isTrustedAuthMessage = (event, allowedOrigins, parentWindow) => (
  isTrustedParentMessage(event, allowedOrigins, parentWindow)
  && event.data.type === 'SET_AUTH_TOKEN'
  && typeof event.data.token === 'string'
  && event.data.token.trim().length > 0
);

export const getTrustedOnlineUsers = (event, allowedOrigins, parentWindow) => {
  if (
    !isTrustedParentMessage(event, allowedOrigins, parentWindow)
    || event.data.type !== 'SET_ONLINE_USERS'
    || !Array.isArray(event.data.users)
    || event.data.users.length > 200
  ) {
    return null;
  }

  const users = new Map();
  for (const user of event.data.users) {
    if (
      !user
      || !Number.isInteger(user.id)
      || user.id <= 0
      || typeof user.name !== 'string'
      || !user.name.trim()
      || user.name.trim().length > 100
    ) {
      return null;
    }
    users.set(user.id, { id: user.id, name: user.name.trim() });
  }
  return Array.from(users.values());
};
