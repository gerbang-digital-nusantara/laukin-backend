import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

const connectionString = process.env.DATABASE_URL;
const needsSsl = connectionString?.includes("sslmode=require") || process.env.PGSSL === "true";

export const pool = new Pool({
  connectionString,
  // Provider Postgres terkelola (Neon, Supabase, dll) umumnya di belakang proxy
  // dengan sertifikat yang tidak selalu ter-verifikasi rantainya oleh Node —
  // rejectUnauthorized: false umum dipakai untuk koneksi semacam ini.
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
});
