import type { Server } from "socket.io";
import { pool } from "./db";

// Referensi ke instance Socket.IO agar route HTTP bisa broadcast perubahan
// (mis. stok berkurang saat kasir mencatat transaksi) secara realtime ke semua
// klien: kang lauk, admin, dan pembeli yang sedang melihat menu penjual itu.
let io: Server | null = null;

export function setIo(server: Server) {
  io = server;
}

// Broadcast stok hari ini milik satu penjual. Selalu query ulang dari DB supaya
// nilai yang dikirim konsisten (tidak drift akibat patch parsial di klien).
export async function broadcastStok(penjualId: number) {
  if (!io) return;
  try {
    const result = await pool.query(
      `SELECT id, nama_barang, harga, stok_awal, stok_terjual, stok_akhir
       FROM stok WHERE penjual_id = $1 AND tanggal = CURRENT_DATE
       ORDER BY nama_barang ASC`,
      [penjualId]
    );
    io.emit("stok:update", { penjualId, items: result.rows });
  } catch (err) {
    console.error("broadcastStok error:", err);
  }
}

// Broadcast posisi penjual ke semua klien (peta admin & pembeli). Dipakai oleh
// jalur HTTP POST /tracking/lokasi — penting untuk aplikasi Android yang mengirim
// lokasi lewat HTTP di background (bukan via socket).
export function emitPenjualUpdate(payload: { id: number; name: string; lat: number; lng: number }) {
  io?.emit("penjual:update", payload);
}

// Sinyal transaksi baru — dipakai admin untuk feed aktivitas live.
export function emitTransaksi(payload: {
  penjualId: number;
  penjualName?: string;
  items: Array<{ nama_barang: string; jumlah: number; harga: number }>;
  total: number;
}) {
  io?.emit("kasir:baru", payload);
}
