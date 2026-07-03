import { pool } from "./db";
import { haversineKm } from "./haversine";

// GPS yang diam di tempat tetap "bergoyang" beberapa meter (jitter). Kalau semua
// titik disimpan, riwayat membengkak dan total kilometer ikut menggelembung
// padahal penjual tidak bergerak. Titik baru hanya dicatat ke riwayat bila
// bergeser >= MIN_MOVE_METERS dari titik riwayat terakhir; posisi live tetap
// selalu diperbarui supaya peta admin/pembeli tidak tersendat.
const MIN_MOVE_METERS = 10;

const lastRecorded = new Map<number, { lat: number; lng: number }>();

export async function recordLocation(userId: number, lat: number, lng: number): Promise<void> {
  await pool.query(
    `UPDATE penjual_profile SET current_lat = $1, current_lng = $2, status = 'online', last_seen = now()
     WHERE user_id = $3`,
    [lat, lng, userId]
  );

  let last = lastRecorded.get(userId);
  if (!last) {
    // Setelah server restart cache kosong — ambil titik terakhir hari ini dari DB
    // sekali saja supaya filter jarak tetap bekerja.
    const result = await pool.query(
      `SELECT lat, lng FROM lokasi_history
       WHERE penjual_id = $1 AND "timestamp"::date = CURRENT_DATE
       ORDER BY "timestamp" DESC LIMIT 1`,
      [userId]
    );
    last = result.rows[0] ?? undefined;
    if (last) lastRecorded.set(userId, last);
  }

  if (last && haversineKm(last.lat, last.lng, lat, lng) * 1000 < MIN_MOVE_METERS) {
    return;
  }

  await pool.query("INSERT INTO lokasi_history (penjual_id, lat, lng) VALUES ($1, $2, $3)", [userId, lat, lng]);
  lastRecorded.set(userId, { lat, lng });
}
