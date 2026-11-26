import assert from 'node:assert/strict';
import test from 'node:test';
import { createHistoryQuery, getOldestMessageId } from './historyPagination.js';

test('uses the API beforeId cursor parameter', () => {
  const query = createHistoryQuery(50, 51);

  assert.equal(query.get('limit'), '50');
  assert.equal(query.get('beforeId'), '51');
  assert.equal(query.has('before_id'), false);
});

test('uses the oldest message ID from a descending page as the next cursor', () => {
  const page = [{ id: 100 }, { id: 99 }, { id: 51 }];

  assert.equal(getOldestMessageId(page), 51);
  assert.equal(getOldestMessageId([]), null);
});
