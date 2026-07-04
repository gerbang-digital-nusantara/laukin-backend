import { Router } from "express";
import { pool } from "../db";
import { requireAuth, AuthedRequest } from "../auth";
import { asyncHandler } from "../asyncHandler";
import { totalRouteKm } from "../haversine";
import { recordLocation } from "../locationStore";
import { emitPenjualUpdate } from "../realtime";

const router = Router();

router.post(
  "/lokasi",
  requireAuth("penjual"),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { lat, lng } = req.body;
    if (typeof lat !== "number" || typeof lng !== "number") {
      return res.status(400).json({ error: "lat dan lng wajib diisi (angka)" });
    }
    await recordLocation(req.user!.id, lat, lng);
    // Broadcast live ke peta admin/pembeli (jalur ini dipakai aplikasi Android
    // saat mengirim lokasi di background lewat HTTP).
    emitPenjualUpdate({ id: req.user!.id, name: req.user!.name, lat, lng });
    res.status(201).json({ ok: true });
  })
);

router.post(
  "/status",
  requireAuth("penjual"),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { status } = req.body;
    if (!["online", "offline"].includes(status)) return res.status(400).json({ error: "status tidak valid" });
    await pool.query("UPDATE penjual_profile SET status = $1, last_seen = now() WHERE user_id = $2", [
      status,
      req.user!.id,
    ]);
    res.json({ ok: true });
  })
);

router.get(
  "/history/:penjualId",
  requireAuth("admin", "penjual"),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { penjualId } = req.params;
    // Penjual hanya boleh melihat riwayat lokasinya sendiri.
    if (req.user!.role === "penjual" && Number(penjualId) !== req.user!.id) {
      return res.status(403).json({ error: "Hanya boleh melihat riwayat sendiri" });
    }
    const { tanggal } = req.query;
    const values: any[] = [penjualId];
    let dateFilter = "timestamp::date = CURRENT_DATE";
    if (tanggal) {
      values.push(tanggal);
      dateFilter = `timestamp::date = $2`;
    }
    const result = await pool.query(
      `SELECT lat, lng, "timestamp" FROM lokasi_history WHERE penjual_id = $1 AND ${dateFilter} ORDER BY "timestamp" ASC`,
      values
    );
    const totalKm = totalRouteKm(result.rows);
    res.json({ points: result.rows, totalKm: Number(totalKm.toFixed(2)) });
  })
);

export default router;
