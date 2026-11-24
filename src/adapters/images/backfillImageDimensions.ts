/**
 * Backfill de dimensiones originales (width/height) para imágenes ya subidas a Cloudflare Images.
 *
 * Requiere la migración 069_add_image_dimensions.sql aplicada y en el .env:
 *   PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DATABASE, CF_ACCOUNT_ID, CF_API_TOKEN
 *
 * Cómo correrlo (desde la raíz del repo):
 *   npx ts-node --files src/adapters/images/backfillImageDimensions.ts
 * o, compilado:
 *   npm run build && node dist/adapters/images/backfillImageDimensions.js
 *
 * Es idempotente: solo procesa filas con width IS NULL, así que puede re-ejecutarse
 * para reintentar las que fallaron.
 */
import { pool } from "../db/pgClient";
import fetch from "node-fetch";
import { readImageDimensions } from "./imageDimensions";

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID!;
const CF_API_TOKEN = process.env.CF_API_TOKEN!;

const CONCURRENCY = 8;
const LOW_RES_THRESHOLD = 1200;

interface PendingRow {
  id: number;
  cf_image_id: string;
}

async function fetchOriginal(cfImageId: string): Promise<Buffer> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/images/v1/${encodeURIComponent(cfImageId)}/blob`,
    { headers: { Authorization: `Bearer ${CF_API_TOKEN}` } }
  );
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function backfillImageDimensions() {
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
    throw new Error("Faltan CF_ACCOUNT_ID / CF_API_TOKEN en el entorno");
  }

  const { rows } = await pool.query<PendingRow>(
    `SELECT id, cf_image_id
       FROM images
      WHERE cf_image_id IS NOT NULL
        AND width IS NULL
        AND (media_type IS NULL OR media_type = 'image')
        AND deleted_at IS NULL
      ORDER BY id`
  );

  console.log(`🔎 ${rows.length} imágenes sin dimensiones`);

  let processed = 0;
  let failed = 0;
  let lowRes = 0;
  let next = 0;

  const worker = async () => {
    while (next < rows.length) {
      const row = rows[next++]!;
      try {
        const buffer = await fetchOriginal(row.cf_image_id);
        const dims = readImageDimensions(buffer);
        if (!dims) throw new Error("No se pudieron leer las dimensiones");

        await pool.query(
          `UPDATE images SET width = $1, height = $2 WHERE id = $3`,
          [dims.width, dims.height, row.id]
        );

        processed++;
        if (Math.max(dims.width, dims.height) < LOW_RES_THRESHOLD) lowRes++;
        console.log(`✅ #${row.id} (${row.cf_image_id}): ${dims.width}x${dims.height}`);
      } catch (err) {
        failed++;
        console.error(`❌ #${row.id} (${row.cf_image_id}):`, err instanceof Error ? err.message : err);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));

  console.log("──────── Resumen ────────");
  console.log(`Procesadas: ${processed}`);
  console.log(`Fallidas:   ${failed}`);
  console.log(`Baja resolución (lado mayor < ${LOW_RES_THRESHOLD}px): ${lowRes}`);
}

backfillImageDimensions()
  .catch((err) => {
    console.error("Error en el backfill:", err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
