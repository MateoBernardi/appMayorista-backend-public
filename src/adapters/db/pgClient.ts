import { Pool } from 'pg';
import dotenv from 'dotenv';
// Configurar el parser de tipos de PostgreSQL para evitar conversión automática de zonas horarias
// Esto hace que las fechas timestamp se devuelvan como strings en lugar de objetos Date
import { types } from 'pg';

dotenv.config();

export const pool = new Pool({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT),
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
});

// 1114 = timestamp without time zone
// 1082 = date
// 1700 = numeric/decimal (pg returns these as strings by default to avoid float precision loss)
types.setTypeParser(1114, (str) => str);
types.setTypeParser(1082, (str) => str);
types.setTypeParser(1700, (val) => parseFloat(val));