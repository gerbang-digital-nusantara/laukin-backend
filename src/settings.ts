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

// QR pembayaran (DANA/QRIS) — disimpan sebagai data URL base64 di DB agar admin
// bisa mengganti kapan saja tanpa build ulang. Publik supaya Kasir & pembeli bisa
// menampilkannya.
router.get(
  "/qr",
  asyncHandler(async (_req, res) => {
    const result = await pool.query("SELECT value FROM settings WHERE key = 'qr_pembayaran'");
    res.json({ qr: result.rows[0]?.value ?? null });
  })
);

router.put(
  "/qr",
  requireAuth("admin"),
  asyncHandler(async (req, res) => {
    const { qr } = req.body;
    if (typeof qr !== "string" || !qr.startsWith("data:image/") || qr.length > 4_000_000) {
      return res.status(400).json({ error: "Gambar QR tidak valid (harus gambar, maksimal ~3MB)" });
    }
    await upsertSetting("qr_pembayaran", qr);
    res.json({ ok: true });
  })
);

router.delete(
  "/qr",
  requireAuth("admin"),
  asyncHandler(async (_req, res) => {
    await pool.query("DELETE FROM settings WHERE key = 'qr_pembayaran'");
    res.json({ ok: true });
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
