import { Router } from "express";
import { pool } from "../db";
import { requireAuth } from "../auth";
import { asyncHandler } from "../asyncHandler";

const router = Router();

async function upsertSetting(key: string, value: string) {
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $2`,
    [key, value]
  );
}

// Semua pengaturan sekaligus (dipakai halaman Pengaturan admin).
router.get(
  "/",
  requireAuth("admin"),
  asyncHandler(async (_req, res) => {
    const result = await pool.query("SELECT key, value FROM settings");
    const map: Record<string, string> = {};
    for (const row of result.rows) map[row.key] = row.value;
    res.json({
      radiusKm: Number(map["radius_dekat_km"] ?? 3),
      stokThreshold: Number(map["stok_menipis_threshold"] ?? 5),
    });
  })
);

router.get(
  "/radius",
  asyncHandler(async (_req, res) => {
    const result = await pool.query("SELECT value FROM settings WHERE key = 'radius_dekat_km'");
    const radiusKm = Number(result.rows[0]?.value ?? 3);
    res.json({ radiusKm });
  })
);

router.put(
  "/radius",
  requireAuth("admin"),
  asyncHandler(async (req, res) => {
    const { radiusKm } = req.body;
    if (typeof radiusKm !== "number" || !Number.isFinite(radiusKm) || radiusKm <= 0) {
      return res.status(400).json({ error: "radiusKm harus angka positif" });
    }
    await upsertSetting("radius_dekat_km", String(radiusKm));
    res.json({ radiusKm });
  })
);

// Batas "stok menipis" untuk alert di halaman Cek Stok Otomatis.
router.put(
  "/stok-threshold",
  requireAuth("admin"),
  asyncHandler(async (req, res) => {
    const { threshold } = req.body;
    if (!Number.isInteger(threshold) || threshold < 0) {
      return res.status(400).json({ error: "threshold harus bilangan bulat >= 0" });
    }
    await upsertSetting("stok_menipis_threshold", String(threshold));
    res.json({ threshold });
  })
);

export default router;
