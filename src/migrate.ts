import fs from "fs";
import path from "path";
import { pool } from "./db";

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, "..", "migrations", "schema.sql"), "utf-8");
  await pool.query(sql);
  console.log("Migration applied successfully.");
  await pool.end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
