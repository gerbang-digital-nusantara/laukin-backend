import express from "express";
import http from "http";
import cors from "cors";
import dotenv from "dotenv";
import { Server } from "socket.io";
import { pool } from "./db";
import { verifyToken } from "./auth";
import { recordLocation } from "./locationStore";

import authRoutes from "./routes/auth";
import stokRoutes from "./routes/stok";
import kasirRoutes from "./routes/kasir";
import ruteRoutes from "./routes/rute";
import trackingRoutes from "./routes/tracking";
import penjualRoutes from "./routes/penjual";
import settingsRoutes from "./routes/settings";

dotenv.config();

const app = express();
const server = http.createServer(app);
const allowedOrigins = (process.env.CORS_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean);

// Selain origin yang dikonfigurasi, localhost/127.0.0.1 port berapa pun selalu
// diizinkan — Vite otomatis pindah port (5174 dst) kalau port default terpakai,
// dan tanpa ini request dev diblokir CORS ("login gagal" padahal backend hidup).
const isLocalhost = (origin: string) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
const corsOrigin = allowedOrigins.length
  ? (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
      if (!origin || allowedOrigins.includes(origin) || isLocalhost(origin)) return cb(null, true);
      cb(null, false);
    }
  : true;

app.use(cors({ origin: corsOrigin as any }));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/auth", authRoutes);
app.use("/stok", stokRoutes);
app.use("/kasir", kasirRoutes);
app.use("/rute", ruteRoutes);
app.use("/tracking", trackingRoutes);
app.use("/penjual", penjualRoutes);
app.use("/settings", settingsRoutes);

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  if (!res.headersSent) {
    res.status(500).json({ error: "Internal server error" });
  }
});

const io = new Server(server, {
  cors: { origin: corsOrigin as any },
});

io.on("connection", (socket) => {
  let trackedUserId: number | null = null;

  // Error database di dalam handler socket tidak boleh menjatuhkan proses —
  // cukup dicatat; klien akan mengirim ulang lokasi beberapa detik kemudian.
  socket.on("penjual:lokasi", async (payload: { token: string; lat: number; lng: number }) => {
    try {
      const user = verifyToken(payload?.token);
      if (!user || user.role !== "penjual") return;
      if (typeof payload.lat !== "number" || typeof payload.lng !== "number") return;
      trackedUserId = user.id;
      await recordLocation(user.id, payload.lat, payload.lng);
      io.emit("penjual:update", { id: user.id, name: user.name, lat: payload.lat, lng: payload.lng });
    } catch (err) {
      console.error("penjual:lokasi error:", err);
    }
  });

  socket.on("penjual:offline", async (payload: { token: string }) => {
    try {
      const user = verifyToken(payload?.token);
      if (!user || user.role !== "penjual") return;
      await pool.query("UPDATE penjual_profile SET status = 'offline', last_seen = now() WHERE user_id = $1", [
        user.id,
      ]);
      io.emit("penjual:offline", { id: user.id });
    } catch (err) {
      console.error("penjual:offline error:", err);
    }
  });

  // Kalau koneksi socket putus (app ditutup paksa, HP mati, sinyal hilang) tanpa
  // sempat kirim event "penjual:offline", tandai offline supaya tidak nyangkut online.
  socket.on("disconnect", async () => {
    if (trackedUserId == null) return;
    try {
      await pool.query("UPDATE penjual_profile SET status = 'offline', last_seen = now() WHERE user_id = $1", [
        trackedUserId,
      ]);
      io.emit("penjual:offline", { id: trackedUserId });
    } catch (err) {
      console.error("disconnect cleanup error:", err);
    }
  });
});

const port = Number(process.env.PORT) || 4000;
server.listen(port, () => {
  console.log(`Kang Lauk backend listening on port ${port}`);
});
