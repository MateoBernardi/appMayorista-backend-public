import { pool } from './pgClient';

export interface CapturedResponse {
  code: number;
  body: unknown;
}

export interface IdempotencyRecord {
  owner_key: string;
  idempotency_key: string;
  status: 'processing' | 'completed';
  response_code: number | null;
  response_body: unknown | null;
  created_at: string;
}

export const insertProcessingKey = async (
  ownerKey: string,
  idempotencyKey: string,
  client?: any
): Promise<IdempotencyRecord | null> => {
  const db = client || pool;
  const query = `
    INSERT INTO idempotency_keys (owner_key, idempotency_key, status)
    VALUES ($1, $2, 'processing')
    ON CONFLICT (owner_key, idempotency_key) DO NOTHING
    RETURNING owner_key, idempotency_key, status, response_code, response_body, created_at;
  `;
  const { rows } = await db.query(query, [ownerKey, idempotencyKey]);
  return rows[0] ?? null;
};

export const getKey = async (
  ownerKey: string,
  idempotencyKey: string,
  client?: any
): Promise<IdempotencyRecord | null> => {
  const db = client || pool;
  const query = `
    SELECT owner_key, idempotency_key, status, response_code, response_body, created_at
    FROM idempotency_keys
    WHERE owner_key = $1 AND idempotency_key = $2;
  `;
  const { rows } = await db.query(query, [ownerKey, idempotencyKey]);
  return rows[0] ?? null;
};

export const completeKey = async (
  ownerKey: string,
  idempotencyKey: string,
  response: CapturedResponse,
  client?: any
): Promise<IdempotencyRecord | null> => {
  const db = client || pool;
  const query = `
    UPDATE idempotency_keys
    SET status = 'completed',
        response_code = $3,
        response_body = $4
    WHERE owner_key = $1 AND idempotency_key = $2
    RETURNING owner_key, idempotency_key, status, response_code, response_body, created_at;
  `;
  const { rows } = await db.query(query, [
    ownerKey,
    idempotencyKey,
    response.code,
    JSON.stringify(response.body ?? null),
  ]);
  return rows[0] ?? null;
};

export const deleteKey = async (
  ownerKey: string,
  idempotencyKey: string,
  client?: any
): Promise<void> => {
  const db = client || pool;
  await db.query(
    `DELETE FROM idempotency_keys WHERE owner_key = $1 AND idempotency_key = $2;`,
    [ownerKey, idempotencyKey]
  );
};

export const deleteExpiredKeys = async (maxAgeHours: number, client?: any): Promise<number> => {
  const db = client || pool;
  const query = `
    DELETE FROM idempotency_keys
    WHERE created_at < NOW() - make_interval(hours => $1);
  `;
  const { rowCount } = await db.query(query, [maxAgeHours]);
  return rowCount ?? 0;
};
