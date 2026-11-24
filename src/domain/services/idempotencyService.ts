import {
  insertProcessingKey,
  getKey,
  completeKey,
  deleteKey,
  CapturedResponse,
} from '../../adapters/db/idempotencyRepo';

export type IdempotencyOutcome =
  | { type: 'acquired' }
  | { type: 'replay'; response: CapturedResponse }
  | { type: 'conflict' };

export const beginIdempotentRequest = async (
  ownerKey: string,
  idempotencyKey: string
): Promise<IdempotencyOutcome> => {
  const inserted = await insertProcessingKey(ownerKey, idempotencyKey);
  if (inserted) {
    return { type: 'acquired' };
  }

  const existing = await getKey(ownerKey, idempotencyKey);
  if (existing && existing.status === 'completed' && existing.response_code !== null) {
    return {
      type: 'replay',
      response: { code: existing.response_code, body: existing.response_body },
    };
  }

  return { type: 'conflict' };
};

export const completeIdempotentRequest = async (
  ownerKey: string,
  idempotencyKey: string,
  response: CapturedResponse
): Promise<void> => {
  await completeKey(ownerKey, idempotencyKey, response);
};

export const failIdempotentRequest = async (
  ownerKey: string,
  idempotencyKey: string
): Promise<void> => {
  await deleteKey(ownerKey, idempotencyKey);
};
