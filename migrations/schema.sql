CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'penjual')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS penjual_profile (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online', 'offline')),
  current_lat DOUBLE PRECISION,
  current_lng DOUBLE PRECISION,
  last_seen TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS stok (
  id SERIAL PRIMARY KEY,
  penjual_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tanggal DATE NOT NULL DEFAULT CURRENT_DATE,
  nama_barang TEXT NOT NULL,
  stok_awal INTEGER NOT NULL DEFAULT 0,
  stok_terjual INTEGER NOT NULL DEFAULT 0,
  stok_akhir INTEGER NOT NULL DEFAULT 0,
  harga NUMERIC(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE stok ADD COLUMN IF NOT EXISTS harga NUMERIC(12, 2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS transaksi_kasir (
  id SERIAL PRIMARY KEY,
  penjual_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stok_id INTEGER NOT NULL REFERENCES stok(id) ON DELETE CASCADE,
  jumlah INTEGER NOT NULL,
  harga NUMERIC(12, 2) NOT NULL,
  waktu TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_opname (
  id SERIAL PRIMARY KEY,
  stok_id INTEGER NOT NULL REFERENCES stok(id) ON DELETE CASCADE,
  stok_fisik INTEGER NOT NULL,
  selisih INTEGER NOT NULL,
  catatan TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rute (
  id SERIAL PRIMARY KEY,
  nama TEXT NOT NULL,
  dibuat_oleh_admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  waypoints JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rute_assignment (
  id SERIAL PRIMARY KEY,
  rute_id INTEGER NOT NULL REFERENCES rute(id) ON DELETE CASCADE,
  penjual_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tanggal DATE NOT NULL DEFAULT CURRENT_DATE
);

CREATE TABLE IF NOT EXISTS lokasi_history (
  id SERIAL PRIMARY KEY,
  penjual_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  "timestamp" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lokasi_history_penjual_time ON lokasi_history (penjual_id, "timestamp");
CREATE INDEX IF NOT EXISTS idx_stok_penjual_tanggal ON stok (penjual_id, tanggal);
CREATE INDEX IF NOT EXISTS idx_transaksi_penjual_waktu ON transaksi_kasir (penjual_id, waktu);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES ('radius_dekat_km', '3')
ON CONFLICT (key) DO NOTHING;

INSERT INTO settings (key, value) VALUES ('stok_menipis_threshold', '5')
ON CONFLICT (key) DO NOTHING;
