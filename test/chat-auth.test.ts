import { describe, expect, it } from 'vitest';
import {
  getParentOrigin,
  getTrustedOnlineUsers,
  isTrustedAuthMessage,
  parseAllowedParentOrigins,
} from '../client/src/lib/chatAuth.js';
import { sendChatMessage } from '../client/src/lib/socket.js';

describe('chat widget authentication messages', () => {
  it('parses exact allowed HTTP(S) origins', () => {
    expect(parseAllowedParentOrigins('http://localhost:3001,https://app.example.com'))
      .toEqual(['http://localhost:3001', 'https://app.example.com']);
  });

  it('rejects wildcard and URL-path origins', () => {
    expect(() => parseAllowedParentOrigins('https://*.example.com')).toThrow();
    expect(() => parseAllowedParentOrigins('https://app.example.com/chat')).toThrow();
  });

  it('derives only the origin from the embedding page referrer', () => {
    expect(getParentOrigin('https://app.example.com/path/page')).toBe('https://app.example.com');
    expect(getParentOrigin('')).toBe('');
  });

  it('accepts a token only from the allowed parent window and origin', () => {
    const parentWindow = {};
    const event = {
      source: parentWindow,
      origin: 'https://app.example.com',
      data: { type: 'SET_AUTH_TOKEN', token: 'signed.jwt.token' },
    };

    expect(isTrustedAuthMessage(event, ['https://app.example.com'], parentWindow)).toBe(true);
    expect(isTrustedAuthMessage(event, ['https://other.example.com'], parentWindow)).toBe(false);
    expect(isTrustedAuthMessage({ ...event, source: {} }, ['https://app.example.com'], parentWindow))
      .toBe(false);
    expect(isTrustedAuthMessage({
      ...event,
      data: { type: 'SET_AUTH_TOKEN', token: ' ' },
    }, ['https://app.example.com'], parentWindow)).toBe(false);
  });

  it('accepts online users only from the trusted host with valid identities', () => {
    const parentWindow = {};
    const event = {
      source: parentWindow,
      origin: 'https://app.example.com',
      data: {
        type: 'SET_ONLINE_USERS',
        users: [{ id: 21, name: 'Amira' }, { id: 22, name: 'Noah' }],
      },
    };

    expect(getTrustedOnlineUsers(event, ['https://app.example.com'], parentWindow))
      .toEqual([{ id: 21, name: 'Amira' }, { id: 22, name: 'Noah' }]);
    expect(getTrustedOnlineUsers({
      ...event,
      data: { ...event.data, users: [{ id: 0, name: 'Invalid' }] },
    }, ['https://app.example.com'], parentWindow)).toBeNull();
    expect(getTrustedOnlineUsers(event, ['https://other.example.com'], parentWindow)).toBeNull();
  });
});

describe('chat message sending', () => {
  it('returns an explicit failure when the socket is disconnected', async () => {
    await expect(sendChatMessage({ connected: false }, 'Hello')).resolves.toEqual({
      ok: false,
      error: 'Vous êtes déconnecté.',
    });
  });

  it('reports a missing acknowledgement instead of waiting forever', async () => {
    const socket = {
      connected: true,
      timeout: () => ({
        emit: (_event, _payload, acknowledge) => acknowledge(new Error('timeout')),
      }),
    };

    await expect(sendChatMessage(socket, 'Hello')).resolves.toEqual({
      ok: false,
      error: 'Le serveur ne confirme pas l’envoi. Réessayez.',
    });
  });

  it('returns the server acknowledgement when the send succeeds', async () => {
    const socket = {
      connected: true,
      timeout: () => ({
        emit: (_event, _payload, acknowledge) => acknowledge(null, { ok: true }),
      }),
    };

    await expect(sendChatMessage(socket, 'Hello')).resolves.toEqual({ ok: true });
  });
});
