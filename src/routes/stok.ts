import { Router } from "express";
import { pool } from "../db";
import { requireAuth, AuthedRequest } from "../auth";
import { asyncHandler } from "../asyncHandler";

const router = Router();

async function getStokThreshold(): Promise<number> {
  const result = await pool.query("SELECT value FROM settings WHERE key = 'stok_menipis_threshold'");
  const n = Number(result.rows[0]?.value);
  return Number.isFinite(n) && n >= 0 ? n : 5;
}

// Admin mengirim stok (barang + harga jual) ke kang lauk tertentu. Kalau barang
// dengan nama sama sudah ada di tanggal itu, stoknya ditambahkan ke baris yang
// ada (bukan membuat duplikat yang membingungkan kasir).
router.post(
  "/",
  requireAuth("admin"),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { penjual_id, nama_barang, stok_awal, harga, tanggal } = req.body;
    if (!penjual_id || !nama_barang || typeof nama_barang !== "string" || !nama_barang.trim()) {
      return res.status(400).json({ error: "penjual_id dan nama_barang wajib diisi" });
    }
    if (!Number.isInteger(stok_awal) || stok_awal <= 0) {
      return res.status(400).json({ error: "stok_awal harus bilangan bulat positif" });
    }
    if (typeof harga !== "number" || !Number.isFinite(harga) || harga < 0) {
      return res.status(400).json({ error: "harga harus angka >= 0" });
    }
    const namaBersih = nama_barang.trim();

    const existing = await pool.query(
      `SELECT * FROM stok
       WHERE penjual_id = $1 AND tanggal = COALESCE($2, CURRENT_DATE) AND lower(nama_barang) = lower($3)`,
      [penjual_id, tanggal ?? null, namaBersih]
    );
    if (existing.rowCount) {
      const result = await pool.query(
        `UPDATE stok SET stok_awal = stok_awal + $1, stok_akhir = stok_akhir + $1, harga = $2
         WHERE id = $3 RETURNING *`,
        [stok_awal, harga, existing.rows[0].id]
      );
      return res.status(200).json({ ...result.rows[0], merged: true });
    }

    const result = await pool.query(
      `INSERT INTO stok (penjual_id, tanggal, nama_barang, stok_awal, stok_terjual, stok_akhir, harga)
       VALUES ($1, COALESCE($2, CURRENT_DATE), $3, $4, 0, $4, $5) RETURNING *`,
      [penjual_id, tanggal ?? null, namaBersih, stok_awal, harga]
    );
    res.status(201).json(result.rows[0]);
  })
);

router.get(
  "/",
  requireAuth("penjual", "admin"),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { penjualId, tanggal } = req.query;
    const targetPenjual = req.user!.role === "admin" ? penjualId : req.user!.id;
    // Penjual hanya melihat rekap hari ini secara default (reset harian) kecuali
    // eksplisit minta tanggal lain. Admin bebas lihat histori penuh lintas hari.
    const conditions: string[] = [];
    const values: any[] = [];
    if (targetPenjual) {
      values.push(targetPenjual);
      conditions.push(`penjual_id = $${values.length}`);
    }
    if ((req.user!.role === "penjual" && !tanggal) || tanggal === "today") {
      conditions.push(`tanggal = CURRENT_DATE`);
    } else if (tanggal) {
      values.push(tanggal);
      conditions.push(`tanggal = $${values.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    // tanggal dikirim sebagai teks "YYYY-MM-DD" (bukan objek Date yang
    // diserialisasi ke ISO UTC) supaya tidak bergeser sehari di server non-UTC.
    const result = await pool.query(
      `SELECT id, penjual_id, tanggal::text AS tanggal, nama_barang, stok_awal, stok_terjual, stok_akhir, harga, created_at
       FROM stok ${where} ORDER BY tanggal DESC, id DESC`,
      values
    );
    res.json(result.rows);
  })
);

// Admin: koreksi stok yang salah kirim (nama, jumlah awal, harga).
// stok_akhir ikut bergeser sebesar selisih stok_awal; tidak boleh membuat
// stok_akhir jadi negatif (barang yang sudah terjual tidak bisa ditarik).
router.put(
  "/:id",
  requireAuth("admin"),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { nama_barang, stok_awal, harga } = req.body;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query("SELECT * FROM stok WHERE id = $1 FOR UPDATE", [req.params.id]);
      const stok = existing.rows[0];
      if (!stok) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Stok tidak ditemukan" });
      }
      const newNama =
        typeof nama_barang === "string" && nama_barang.trim() ? nama_barang.trim() : stok.nama_barang;
      const newHarga = typeof harga === "number" && Number.isFinite(harga) && harga >= 0 ? harga : Number(stok.harga);
      let newAwal = stok.stok_awal;
      let newAkhir = stok.stok_akhir;
      if (stok_awal != null) {
        if (!Number.isInteger(stok_awal) || stok_awal <= 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "stok_awal harus bilangan bulat positif" });
        }
        if (stok_awal < stok.stok_terjual) {
          await client.query("ROLLBACK");
          return res
            .status(400)
            .json({ error: `Stok awal tidak boleh kurang dari yang sudah terjual (${stok.stok_terjual})` });
        }
        newAkhir = stok.stok_akhir + (stok_awal - stok.stok_awal);
        newAwal = stok_awal;
      }
      const result = await client.query(
        "UPDATE stok SET nama_barang = $1, stok_awal = $2, stok_akhir = $3, harga = $4 WHERE id = $5 RETURNING *",
        [newNama, newAwal, newAkhir, newHarga, req.params.id]
      );
      await client.query("COMMIT");
      res.json(result.rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  })
);

// Admin: hapus entri stok. Transaksi kasir & SO yang menempel ikut terhapus
// (cascade) — konfirmasi ada di sisi UI.
router.delete(
  "/:id",
  requireAuth("admin"),
  asyncHandler(async (req: AuthedRequest, res) => {
    const result = await pool.query("DELETE FROM stok WHERE id = $1 RETURNING id", [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: "Stok tidak ditemukan" });
    res.json({ ok: true });
  })
);

router.get(
  "/cek-otomatis",
  requireAuth("admin"),
  asyncHandler(async (_req, res) => {
    const threshold = await getStokThreshold();
    const result = await pool.query(
      `SELECT s.*, u.name AS penjual_nama
       FROM stok s
       JOIN users u ON u.id = s.penjual_id
       WHERE s.tanggal = CURRENT_DATE AND s.stok_akhir <= $1
       ORDER BY s.stok_akhir ASC`,
      [threshold]
    );
    res.json({ threshold, alerts: result.rows });
  })
);

export default router;
