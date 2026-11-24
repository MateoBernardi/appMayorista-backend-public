import 'dotenv/config';
import * as fs from 'fs';
import { uploadImageToCloudflare } from '../src/adapters/images/uploadImages';
import { createImage } from '../src/adapters/db/web/imagesRepo';
import { createNovedadWeb } from '../src/adapters/db/web/novedadesWebRepo';
import { pool } from '../src/adapters/db/pgClient';

async function main() {
  const filePath = __dirname + '/../src/assets/logoItalo.png';
  const file = fs.readFileSync(filePath);

  console.log('Subiendo imagen a Cloudflare Images...');
  const cf = await uploadImageToCloudflare({
    file,
    filename: 'novedad-nueva-planta-almacenaje.png',
    requireSignedURLs: false,
  });
  const imageUrl = cf.result.variants[0];
  console.log('Cloudflare OK:', cf.result.id, imageUrl);

  console.log('Insertando en tabla images...');
  const imageRecord = await createImage({
    url: imageUrl,
    section: 'novedades',
    description: 'Novedad — nueva planta de almacenaje',
    cf_image_id: cf.result.id,
    media_type: 'image',
  });
  console.log('images row:', imageRecord.id, imageRecord.url);

  console.log('Insertando novedad...');
  const novedad = await createNovedadWeb({
    titulo: 'Nueva planta de almacenaje para la campaña gruesa',
    preview:
      'Seis silos y 12.000 toneladas más de acopio a 3 km de San Basilio, listos para la cosecha 2027. Los asociados tendrán prioridad y tarifa diferencial.',
    cuerpo:
      'La cooperativa comenzó el montaje de una nueva planta de almacenaje a tres kilómetros de San Basilio. Con seis silos de 2.000 toneladas, la capacidad de acopio de la zona crece en 12.000 toneladas y estará operativa para la cosecha gruesa 2027.\n\nEn las últimas tres campañas, la capacidad quedó chica. En los picos de cosecha, muchos productores tuvieron que esperar en ruta o llevar su grano a más de 60 kilómetros. La planta fue un pedido repetido en cada asamblea y se aprobó por unanimidad en abril.\n\nLos asociados tendrán prioridad en la recepción y tarifa diferencial de secado y acopio. El stock y las liquidaciones se van a poder seguir desde Mi cuenta.',
    imagen: imageRecord.url,
    estado: 'Publicada',
    created_by: 13,
  });
  console.log('novedades_web row:', novedad);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
