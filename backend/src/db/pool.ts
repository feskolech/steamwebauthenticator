import mysql, { type ResultSetHeader } from 'mysql2/promise';
import { env } from '../config/env';

export const db = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  database: env.DB_NAME,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  waitForConnections: true,
  connectionLimit: 20,
  queueLimit: 0,
  decimalNumbers: true
});

export async function queryRows<T = any[]>(sql: string, params: unknown[] = []): Promise<T> {
  const [rows] = await db.query(sql, params as any);
  return rows as T;
}

export async function execute(sql: string, params: unknown[] = []): Promise<ResultSetHeader> {
  const [result] = await db.execute(sql, params as any);
  return result as ResultSetHeader;
}
