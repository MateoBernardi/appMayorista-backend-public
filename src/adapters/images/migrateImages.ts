import { S3Client, GetObjectCommand, ListObjectsV2Command, ListObjectsV2CommandOutput } from "@aws-sdk/client-s3";
import {pool} from "../db/pgClient"; // tu cliente PostgreSQL
import FormData from "form-data";
import streamToBuffer from "stream-to-buffer";
import fetch from "node-fetch"; // npm i node-fetch@2 para CommonJS o v3 para ESM

// Configuración R2
const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY!,
    secretAccessKey: process.env.R2_SECRET_KEY!,
  },
});

// Configuración Cloudflare
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID!;
const CF_API_TOKEN = process.env.CF_API_TOKEN!;

async function migrateImages() {
  // 1️⃣ Listar todas las imágenes en R2
  const listObjectsResult = await r2.send(
    new ListObjectsV2Command({ Bucket: process.env.R2_BUCKET! })
  ) as ListObjectsV2CommandOutput;

  const objects = listObjectsResult.Contents || [];

  for (const obj of objects) {
    const r2Key = obj.Key;
    try {
      // 2️⃣ Descargar desde R2
      const object = await r2.send(
        new GetObjectCommand({ Bucket: process.env.R2_BUCKET!, Key: r2Key })
      );

      const buffer: Buffer = await new Promise((resolve, reject) => {
        streamToBuffer(object.Body as NodeJS.ReadableStream, (err: Error | null, buf: Buffer) => (err ? reject(err) : resolve(buf)));
      });

      // 3️⃣ Subir a Cloudflare Images
      const form = new FormData();
      form.append("file", buffer, r2Key);
      form.append("requireSignedURLs", "false");

      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/images/v1`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${CF_API_TOKEN}` },
          body: form as any,
        }
      );

      const data = await response.json() as {
        success: boolean;
        errors?: any;
        result: { id: string; variants: string[] };
      };
      if (!data.success) throw new Error(JSON.stringify(data.errors));

      const { id: cfImageId, variants } = data.result;
      const newUrl = variants[0];

      // 4️⃣ Actualizar DB: buscar por nombre de imagen en la URL
      const updateResult = await pool.query(
        `UPDATE images SET cf_image_id=$1, url=$2, updated_at=NOW() WHERE url LIKE $3`,
        [cfImageId, newUrl, `%${r2Key}%`]
      );

      if ((updateResult.rowCount ?? 0) > 0) {
      } else {
      }
    } catch (err) {
    }
  }

}

migrateImages();
