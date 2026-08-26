// ============================================================
// OtoNot — api/admin-dogrula.js
// Admin anahtarını doğrular (servis koruması; anahtar sunucuda saklı).
// ============================================================
export default async function handler(req, res) {
  const ADMIN_KEY = process.env.ADMIN_KEY || "";
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST gerekli" });
  }
  const gelen = req.body?.anahtar;
  if (!ADMIN_KEY) return res.status(500).json({ error: "ADMIN_KEY tanımlı değil." });
  if (gelen === ADMIN_KEY) return res.status(200).json({ ok: true });
  return res.status(401).json({ ok: false, error: "Geçersiz anahtar." });
}