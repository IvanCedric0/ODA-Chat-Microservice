export const createHistoryQuery = (limit, beforeId) => {
  const query = new URLSearchParams({ limit: String(limit) });
  if (beforeId !== null && beforeId !== undefined) {
    query.set('beforeId', String(beforeId));
  }
  return query;
};

export const getOldestMessageId = (messages) => (
  messages.length ? Math.min(...messages.map((message) => message.id)) : null
);
