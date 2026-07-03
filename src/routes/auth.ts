import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db";
import { requireAuth, signToken, verifyToken, AuthedRequest } from "../auth";
import { asyncHandler } from "../asyncHandler";

const router = Router();

function isValidEmail(email: unknown): email is string {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Registrasi hanya boleh dilakukan admin. Pengecualian satu-satunya: saat
// database masih kosong (bootstrap), akun pertama boleh dibuat tanpa token
// supaya sistem bisa mulai dipakai.
router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const { name, email, password, role, phone } = req.body;
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "Nama wajib diisi" });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Email tidak valid" });
    }
    if (!password || typeof password !== "string" || password.length < 6) {
      return res.status(400).json({ error: "Password minimal 6 karakter" });
    }
    if (!["admin", "penjual"].includes(role)) {
      return res.status(400).json({ error: "Role tidak valid" });
    }

    const userCount = await pool.query("SELECT COUNT(*)::int AS count FROM users");
    const isBootstrap = userCount.rows[0].count === 0;
    if (!isBootstrap) {
      const header = req.headers.authorization;
      const caller = header?.startsWith("Bearer ") ? verifyToken(header.slice(7)) : null;
      if (!caller || caller.role !== "admin") {
        return res.status(403).json({ error: "Hanya admin yang dapat membuat akun baru" });
      }
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await pool.query("SELECT id FROM users WHERE lower(email) = $1", [normalizedEmail]);
    if (existing.rowCount) {
      return res.status(409).json({ error: "Email sudah terdaftar" });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      "INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role",
      [name.trim(), normalizedEmail, passwordHash, role]
    );
    const user = result.rows[0];
    if (role === "penjual") {
      await pool.query("INSERT INTO penjual_profile (user_id, phone) VALUES ($1, $2)", [user.id, phone ?? null]);
    }
    const token = signToken({ id: user.id, name: user.name, role: user.role });
    res.status(201).json({ token, user });
  })
);

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    if (typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({ error: "Email dan password wajib diisi" });
    }
    const result = await pool.query("SELECT * FROM users WHERE lower(email) = $1", [email.trim().toLowerCase()]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Email atau password salah" });
    }
    const token = signToken({ id: user.id, name: user.name, role: user.role });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  })
);

router.get("/me", requireAuth(), (req: AuthedRequest, res) => {
  res.json({ user: req.user });
});

// Ganti password sendiri (admin maupun penjual) — wajib tahu password lama.
router.post(
  "/change-password",
  requireAuth(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const { oldPassword, newPassword } = req.body;
    if (typeof oldPassword !== "string" || typeof newPassword !== "string" || newPassword.length < 6) {
      return res.status(400).json({ error: "Password baru minimal 6 karakter" });
    }
    const result = await pool.query("SELECT password_hash FROM users WHERE id = $1", [req.user!.id]);
    const row = result.rows[0];
    if (!row || !(await bcrypt.compare(oldPassword, row.password_hash))) {
      return res.status(401).json({ error: "Password lama salah" });
    }
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [passwordHash, req.user!.id]);
    res.json({ ok: true });
  })
);

export default router;
