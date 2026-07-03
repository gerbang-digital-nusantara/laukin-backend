import { Router } from "express";
import { pool } from "../db";
import { requireAuth, AuthedRequest } from "../auth";
import { asyncHandler } from "../asyncHandler";

const router = Router();

function validWaypoints(waypoints: unknown): waypoints is Array<{ lat: number; lng: number }> {
  return (
    Array.isArray(waypoints) &&
    waypoints.length >= 2 &&
    waypoints.every((w) => typeof w?.lat === "number" && typeof w?.lng === "number")
  );
}

router.post(
  "/",
  requireAuth("admin"),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { nama, waypoints } = req.body;
    if (!nama || typeof nama !== "string" || !nama.trim() || !validWaypoints(waypoints)) {
      return res.status(400).json({ error: "nama dan minimal 2 waypoints (lat/lng) wajib diisi" });
    }
    const result = await pool.query(
      "INSERT INTO rute (nama, dibuat_oleh_admin_id, waypoints) VALUES ($1, $2, $3) RETURNING *",
      [nama.trim(), req.user!.id, JSON.stringify(waypoints)]
    );
    res.status(201).json(result.rows[0]);
  })
);

router.get(
  "/",
  requireAuth(),
  asyncHandler(async (_req, res) => {
    const result = await pool.query("SELECT * FROM rute ORDER BY created_at DESC");
    res.json(result.rows);
  })
);

// Admin: perbarui rute yang sudah ada (nama dan/atau titik-titiknya).
router.put(
  "/:id",
  requireAuth("admin"),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { nama, waypoints } = req.body;
    if (!nama || typeof nama !== "string" || !nama.trim() || !validWaypoints(waypoints)) {
      return res.status(400).json({ error: "nama dan minimal 2 waypoints (lat/lng) wajib diisi" });
    }
    const result = await pool.query(
      "UPDATE rute SET nama = $1, waypoints = $2 WHERE id = $3 RETURNING *",
      [nama.trim(), JSON.stringify(waypoints), req.params.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: "Rute tidak ditemukan" });
    res.json(result.rows[0]);
  })
);

// Admin: hapus rute beserta penugasannya (cascade).
router.delete(
  "/:id",
  requireAuth("admin"),
  asyncHandler(async (req, res) => {
    const result = await pool.query("DELETE FROM rute WHERE id = $1 RETURNING id", [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: "Rute tidak ditemukan" });
    res.json({ ok: true });
  })
);

// Admin: daftar penugasan (default hari ini) lengkap dengan nama rute & penjual.
router.get(
  "/assignments",
  requireAuth("admin"),
  asyncHandler(async (req, res) => {
    const { tanggal } = req.query;
    const values: any[] = [];
    let where = "WHERE ra.tanggal = CURRENT_DATE";
    if (tanggal) {
      values.push(tanggal);
      where = "WHERE ra.tanggal = $1";
    }
    const result = await pool.query(
      `SELECT ra.id, ra.tanggal::text AS tanggal, ra.rute_id, ra.penjual_id, r.nama AS rute_nama, u.name AS penjual_nama
       FROM rute_assignment ra
       JOIN rute r ON r.id = ra.rute_id
       JOIN users u ON u.id = ra.penjual_id
       ${where} ORDER BY ra.id DESC`,
      values
    );
    res.json(result.rows);
  })
);

// Admin: batalkan satu penugasan.
router.delete(
  "/assignments/:id",
  requireAuth("admin"),
  asyncHandler(async (req, res) => {
    const result = await pool.query("DELETE FROM rute_assignment WHERE id = $1 RETURNING id", [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: "Penugasan tidak ditemukan" });
    res.json({ ok: true });
  })
);

router.post(
  "/:id/assign",
  requireAuth("admin"),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { penjual_id, tanggal } = req.body;
    if (!penjual_id) return res.status(400).json({ error: "penjual_id wajib diisi" });
    // Cegah penugasan ganda: rute sama, penjual sama, tanggal sama.
    const dup = await pool.query(
      "SELECT id FROM rute_assignment WHERE rute_id = $1 AND penjual_id = $2 AND tanggal = COALESCE($3, CURRENT_DATE)",
      [req.params.id, penjual_id, tanggal ?? null]
    );
    if (dup.rowCount) {
      return res.status(409).json({ error: "Rute ini sudah ditugaskan ke penjual tersebut untuk tanggal itu" });
    }
    const result = await pool.query(
      "INSERT INTO rute_assignment (rute_id, penjual_id, tanggal) VALUES ($1, $2, COALESCE($3, CURRENT_DATE)) RETURNING *",
      [req.params.id, penjual_id, tanggal ?? null]
    );
    res.status(201).json(result.rows[0]);
  })
);

router.get(
  "/mine",
  requireAuth("penjual"),
  asyncHandler(async (req: AuthedRequest, res) => {
    const result = await pool.query(
      `SELECT r.*, ra.tanggal::text AS assigned_tanggal
       FROM rute_assignment ra JOIN rute r ON r.id = ra.rute_id
       WHERE ra.penjual_id = $1 ORDER BY ra.tanggal DESC, ra.id DESC LIMIT 60`,
      [req.user!.id]
    );
    res.json(result.rows);
  })
);

export default router;
