import { Router } from "express";
import { pool } from "../db";
import { requireAuth, AuthedRequest } from "../auth";
import { asyncHandler } from "../asyncHandler";
import { broadcastStok, emitTransaksi } from "../realtime";

const router = Router();

// Menerima satu atau beberapa barang sekaligus dalam satu transaksi (keranjang),
// diproses atomik: kalau salah satu item gagal (stok kurang dsb), semuanya batal.
router.post(
  "/transaksi",
  requireAuth("penjual"),
  asyncHandler(async (req: AuthedRequest, res) => {
    const items: Array<{ stok_id: number; jumlah: number }> = Array.isArray(req.body.items)
      ? req.body.items
      : req.body.stok_id
      ? [{ stok_id: req.body.stok_id, jumlah: req.body.jumlah }]
      : [];

    if (
      items.length === 0 ||
      items.some((it) => !Number.isInteger(it.stok_id) || !Number.isInteger(it.jumlah) || it.jumlah <= 0)
    ) {
      return res.status(400).json({ error: "Minimal satu barang dengan stok_id dan jumlah (bulat positif) wajib diisi" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const transaksiList = [];
      const stokList = [];
      for (const item of items) {
        const stokResult = await client.query(
          "SELECT * FROM stok WHERE id = $1 AND penjual_id = $2 FOR UPDATE",
          [item.stok_id, req.user!.id]
        );
        const stok = stokResult.rows[0];
        if (!stok) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: `Stok tidak ditemukan (id ${item.stok_id})` });
        }
        if (stok.stok_akhir < item.jumlah) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: `Stok ${stok.nama_barang} tidak cukup (sisa ${stok.stok_akhir})` });
        }
        // Harga selalu diambil dari data stok yang dikirim admin, bukan dari input
        // klien, supaya kasir tidak bisa mengubah harga jual barang.
        const transaksi = await client.query(
          "INSERT INTO transaksi_kasir (penjual_id, stok_id, jumlah, harga) VALUES ($1, $2, $3, $4) RETURNING *",
          [req.user!.id, item.stok_id, item.jumlah, stok.harga]
        );
        const updatedStok = await client.query(
          `UPDATE stok SET stok_terjual = stok_terjual + $1, stok_akhir = stok_akhir - $1
           WHERE id = $2 RETURNING *`,
          [item.jumlah, item.stok_id]
        );
        transaksiList.push({ ...transaksi.rows[0], nama_barang: stok.nama_barang });
        stokList.push(updatedStok.rows[0]);
      }
      await client.query("COMMIT");
      // Broadcast realtime: stok berkurang untuk semua yang memantau (kang lauk
      // sendiri, admin, pembeli yang membuka menu). emitTransaksi = feed admin.
      broadcastStok(req.user!.id);
      emitTransaksi({
        penjualId: req.user!.id,
        penjualName: req.user!.name,
        items: transaksiList.map((t) => ({ nama_barang: t.nama_barang, jumlah: t.jumlah, harga: Number(t.harga) })),
        total: transaksiList.reduce((s, t) => s + t.jumlah * Number(t.harga), 0),
      });
      res.status(201).json({ transaksi: transaksiList, stok: stokList });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  })
);

// Batalkan (void) transaksi: stok dikembalikan secara atomik. Penjual hanya bisa
// membatalkan transaksinya sendiri di hari yang sama; admin bisa kapan saja.
router.delete(
  "/transaksi/:id",
  requireAuth("penjual", "admin"),
  asyncHandler(async (req: AuthedRequest, res) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const trxResult = await client.query("SELECT * FROM transaksi_kasir WHERE id = $1 FOR UPDATE", [
        req.params.id,
      ]);
      const trx = trxResult.rows[0];
      if (!trx) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Transaksi tidak ditemukan" });
      }
      if (req.user!.role === "penjual") {
        if (trx.penjual_id !== req.user!.id) {
          await client.query("ROLLBACK");
          return res.status(403).json({ error: "Bukan transaksi Anda" });
        }
        const sameDay = await client.query("SELECT (waktu::date = CURRENT_DATE) AS ok FROM transaksi_kasir WHERE id = $1", [trx.id]);
        if (!sameDay.rows[0]?.ok) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "Transaksi hari sebelumnya hanya bisa dibatalkan admin" });
        }
      }
      await client.query(
        `UPDATE stok SET stok_terjual = GREATEST(stok_terjual - $1, 0), stok_akhir = stok_akhir + $1 WHERE id = $2`,
        [trx.jumlah, trx.stok_id]
      );
      await client.query("DELETE FROM transaksi_kasir WHERE id = $1", [trx.id]);
      await client.query("COMMIT");
      broadcastStok(trx.penjual_id);
      res.json({ ok: true });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  })
);

router.get(
  "/transaksi",
  requireAuth("penjual", "admin"),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { penjualId, tanggal } = req.query;
    const targetPenjual = req.user!.role === "admin" ? penjualId : req.user!.id;
    const conditions: string[] = [];
    const values: any[] = [];
    if (targetPenjual) {
      values.push(targetPenjual);
      conditions.push(`t.penjual_id = $${values.length}`);
    }
    // "today" memakai CURRENT_DATE database — konsisten dengan tanggal stok
    // harian, bebas dari selisih timezone antara klien dan server.
    if (tanggal === "today") {
      conditions.push(`t.waktu::date = CURRENT_DATE`);
    } else if (tanggal) {
      values.push(tanggal);
      conditions.push(`t.waktu::date = $${values.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await pool.query(
      `SELECT t.*, s.nama_barang
       FROM transaksi_kasir t JOIN stok s ON s.id = t.stok_id
       ${where} ORDER BY t.waktu DESC LIMIT 200`,
      values
    );
    res.json(result.rows);
  })
);

// Ringkasan penjualan hari ini (untuk kartu statistik penjual/admin).
router.get(
  "/ringkasan",
  requireAuth("penjual", "admin"),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { penjualId } = req.query;
    const targetPenjual = req.user!.role === "admin" ? penjualId : req.user!.id;
    if (!targetPenjual) return res.status(400).json({ error: "penjualId wajib diisi" });
    const result = await pool.query(
      `SELECT COUNT(*)::int AS transaksi,
              COALESCE(SUM(jumlah), 0)::int AS item_terjual,
              COALESCE(SUM(jumlah * harga), 0)::numeric AS omzet
       FROM transaksi_kasir WHERE penjual_id = $1 AND waktu::date = CURRENT_DATE`,
      [targetPenjual]
    );
    res.json(result.rows[0]);
  })
);

// Omzet per hari dihitung penuh di SQL — tidak terpengaruh limit daftar
// transaksi, jadi rekap lintas hari selalu akurat.
router.get(
  "/omzet-harian",
  requireAuth("admin", "penjual"),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { penjualId } = req.query;
    const targetPenjual = req.user!.role === "admin" ? penjualId : req.user!.id;
    if (!targetPenjual) return res.status(400).json({ error: "penjualId wajib diisi" });
    const result = await pool.query(
      `SELECT waktu::date::text AS tanggal,
              COUNT(*)::int AS transaksi,
              COALESCE(SUM(jumlah), 0)::int AS item_terjual,
              COALESCE(SUM(jumlah * harga), 0)::numeric AS omzet
       FROM transaksi_kasir WHERE penjual_id = $1
       GROUP BY waktu::date ORDER BY waktu::date DESC`,
      [targetPenjual]
    );
    res.json(result.rows);
  })
);

// SO boleh diisi penjual (untuk stoknya sendiri) maupun admin — sesuai alur
// akhir hari: penjual menghitung fisik, sistem menyimpan selisihnya.
router.post(
  "/so",
  requireAuth("admin", "penjual"),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { stok_id, stok_fisik, catatan } = req.body;
    if (!stok_id || stok_fisik == null || !Number.isInteger(stok_fisik) || stok_fisik < 0) {
      return res.status(400).json({ error: "stok_id dan stok_fisik (bulat, >= 0) wajib diisi" });
    }
    const stokResult = await pool.query("SELECT * FROM stok WHERE id = $1", [stok_id]);
    const stok = stokResult.rows[0];
    if (!stok) return res.status(404).json({ error: "Stok tidak ditemukan" });
    if (req.user!.role === "penjual" && stok.penjual_id !== req.user!.id) {
      return res.status(403).json({ error: "Bukan stok Anda" });
    }
    const selisih = stok_fisik - stok.stok_akhir;
    const result = await pool.query(
      "INSERT INTO stock_opname (stok_id, stok_fisik, selisih, catatan) VALUES ($1, $2, $3, $4) RETURNING *",
      [stok_id, stok_fisik, selisih, catatan ?? null]
    );
    res.status(201).json({ ...result.rows[0], nama_barang: stok.nama_barang });
  })
);

router.get(
  "/so",
  requireAuth("admin", "penjual"),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { penjualId } = req.query;
    const targetPenjual = req.user!.role === "admin" ? penjualId : req.user!.id;
    const values: any[] = [];
    let where = "";
    if (targetPenjual) {
      values.push(targetPenjual);
      where = "WHERE s.penjual_id = $1";
    }
    const result = await pool.query(
      `SELECT so.*, s.nama_barang, s.penjual_id
       FROM stock_opname so JOIN stok s ON s.id = so.stok_id
       ${where} ORDER BY so.created_at DESC LIMIT 200`,
      values
    );
    res.json(result.rows);
  })
);

export default router;
