import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db";
import { requireAuth } from "../auth";
import { asyncHandler } from "../asyncHandler";

const router = Router();

// Status dianggap online hanya jika masih mengirim lokasi dalam 15 detik terakhir
// (penjual mengirim tiap 3 detik). Ini mencegah status "online" nyangkut kalau
// penjual menutup app/kehilangan koneksi tanpa sempat klik "Berhenti Berjualan".
const STALE_THRESHOLD = "15 seconds";

// Public endpoint: only non-sensitive fields for user-app map.
router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `SELECT u.id, u.name,
         CASE WHEN p.status = 'online' AND p.last_seen > now() - interval '${STALE_THRESHOLD}'
              THEN 'online' ELSE 'offline' END AS status,
         p.current_lat, p.current_lng, p.last_seen
       FROM users u JOIN penjual_profile p ON p.user_id = u.id
       WHERE u.role = 'penjual'
       ORDER BY status DESC, u.name ASC`
    );
    res.json(result.rows);
  })
);

// Admin: daftar akun kang lauk lengkap dengan email (tidak dipublikasikan lewat GET / publik).
router.get(
  "/accounts",
  requireAuth("admin"),
  asyncHandler(async (_req, res) => {
    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.created_at, p.phone,
         CASE WHEN p.status = 'online' AND p.last_seen > now() - interval '${STALE_THRESHOLD}'
              THEN 'online' ELSE 'offline' END AS status,
         p.last_seen
       FROM users u JOIN penjual_profile p ON p.user_id = u.id
       WHERE u.role = 'penjual'
       ORDER BY u.name ASC`
    );
    res.json(result.rows);
  })
);

// Admin: rename akun kang lauk agar jadi tanda yang lebih jelas.
router.put(
  "/:id/name",
  requireAuth("admin"),
  asyncHandler(async (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "Nama tidak boleh kosong" });
    }
    const result = await pool.query(
      "UPDATE users SET name = $1 WHERE id = $2 AND role = 'penjual' RETURNING id, name",
      [name.trim(), req.params.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: "Akun tidak ditemukan" });
    res.json(result.rows[0]);
  })
);

// Admin: ganti email akun kang lauk.
router.put(
  "/:id/email",
  requireAuth("admin"),
  asyncHandler(async (req, res) => {
    const { email } = req.body;
    if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Email tidak valid" });
    }
    const normalized = email.trim().toLowerCase();
    const existing = await pool.query("SELECT id FROM users WHERE lower(email) = $1 AND id != $2", [
      normalized,
      req.params.id,
    ]);
    if (existing.rowCount) {
      return res.status(409).json({ error: "Email sudah dipakai akun lain" });
    }
    const result = await pool.query(
      "UPDATE users SET email = $1 WHERE id = $2 AND role = 'penjual' RETURNING id, email",
      [normalized, req.params.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: "Akun tidak ditemukan" });
    res.json(result.rows[0]);
  })
);

// Admin: reset password akun kang lauk.
router.post(
  "/:id/reset-password",
  requireAuth("admin"),
  asyncHandler(async (req, res) => {
    const { password } = req.body;
    if (!password || password.length < 6) {
      return res.status(400).json({ error: "Password minimal 6 karakter" });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      "UPDATE users SET password_hash = $1 WHERE id = $2 AND role = 'penjual' RETURNING id",
      [passwordHash, req.params.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: "Akun tidak ditemukan" });
    res.json({ ok: true });
  })
);

// Admin: reset rekap stok & kasir hari ini untuk satu kang lauk (histori hari
// sebelumnya tidak tersentuh). Transaksi kasir & SO ikut terhapus lewat cascade.
router.post(
  "/:id/reset-harian",
  requireAuth("admin"),
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      "DELETE FROM stok WHERE penjual_id = $1 AND tanggal = CURRENT_DATE RETURNING id",
      [req.params.id]
    );
    res.json({ ok: true, deleted: result.rowCount });
  })
);

// Admin: hapus akun kang lauk beserta seluruh datanya (stok, transaksi,
// riwayat lokasi — cascade). Konfirmasi berlapis ada di sisi UI.
router.delete(
  "/:id",
  requireAuth("admin"),
  asyncHandler(async (req, res) => {
    const result = await pool.query("DELETE FROM users WHERE id = $1 AND role = 'penjual' RETURNING id", [
      req.params.id,
    ]);
    if (!result.rowCount) return res.status(404).json({ error: "Akun tidak ditemukan" });
    res.json({ ok: true });
  })
);

export default router;
