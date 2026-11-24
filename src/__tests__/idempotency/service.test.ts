jest.mock('../../adapters/db/idempotencyRepo');

import * as idempotencyRepo from '../../adapters/db/idempotencyRepo';
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  failIdempotentRequest,
} from '../../domain/services/idempotencyService';
import { IdempotencyRecord } from '../../adapters/db/idempotencyRepo';

const mockRepo = jest.mocked(idempotencyRepo);

const OWNER = '7';
const KEY = '11111111-1111-1111-1111-111111111111';

const processingRecord: IdempotencyRecord = {
  owner_key: OWNER,
  idempotency_key: KEY,
  status: 'processing',
  response_code: null,
  response_body: null,
  created_at: '2026-06-05 10:00:00',
};

const completedRecord: IdempotencyRecord = {
  owner_key: OWNER,
  idempotency_key: KEY,
  status: 'completed',
  response_code: 201,
  response_body: { id: 42, ok: true },
  created_at: '2026-06-05 10:00:00',
};

describe('idempotencyService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Test 1 - Happy path (brand new key)', () => {
    it('acquires the lock when the atomic insert wins', async () => {
      mockRepo.insertProcessingKey.mockResolvedValue(processingRecord);

      const outcome = await beginIdempotentRequest(OWNER, KEY);

      expect(outcome).toEqual({ type: 'acquired' });
      expect(mockRepo.insertProcessingKey).toHaveBeenCalledWith(OWNER, KEY);
      expect(mockRepo.getKey).not.toHaveBeenCalled();
    });

    it('persists the captured response when completing', async () => {
      mockRepo.completeKey.mockResolvedValue(completedRecord);

      await completeIdempotentRequest(OWNER, KEY, { code: 201, body: { id: 42, ok: true } });

      expect(mockRepo.completeKey).toHaveBeenCalledWith(OWNER, KEY, {
        code: 201,
        body: { id: 42, ok: true },
      });
    });
  });

  describe('Test 2 - Replay path (key already completed)', () => {
    it('returns the cached code and body without re-running', async () => {
      mockRepo.insertProcessingKey.mockResolvedValue(null);
      mockRepo.getKey.mockResolvedValue(completedRecord);

      const outcome = await beginIdempotentRequest(OWNER, KEY);

      expect(outcome).toEqual({
        type: 'replay',
        response: { code: 201, body: { id: 42, ok: true } },
      });
    });
  });

  describe('Test 3 - Race condition / concurrency', () => {
    it('only one of two concurrent acquirers wins; the other sees a conflict', async () => {
      mockRepo.insertProcessingKey
        .mockResolvedValueOnce(processingRecord)
        .mockResolvedValueOnce(null);
      mockRepo.getKey.mockResolvedValue(processingRecord);

      const [first, second] = await Promise.all([
        beginIdempotentRequest(OWNER, KEY),
        beginIdempotentRequest(OWNER, KEY),
      ]);

      const outcomes = [first.type, second.type].sort();
      expect(outcomes).toEqual(['acquired', 'conflict']);
    });

    it('returns conflict when the existing row is still processing', async () => {
      mockRepo.insertProcessingKey.mockResolvedValue(null);
      mockRepo.getKey.mockResolvedValue(processingRecord);

      const outcome = await beginIdempotentRequest(OWNER, KEY);

      expect(outcome).toEqual({ type: 'conflict' });
    });

    it('returns conflict when the row vanished between insert and read', async () => {
      mockRepo.insertProcessingKey.mockResolvedValue(null);
      mockRepo.getKey.mockResolvedValue(null);

      const outcome = await beginIdempotentRequest(OWNER, KEY);

      expect(outcome).toEqual({ type: 'conflict' });
    });
  });

  describe('Test 4 - Failure recovery', () => {
    it('deletes the processing row so the key can be retried', async () => {
      mockRepo.deleteKey.mockResolvedValue(undefined);

      await failIdempotentRequest(OWNER, KEY);

      expect(mockRepo.deleteKey).toHaveBeenCalledWith(OWNER, KEY);
    });
  });
});
