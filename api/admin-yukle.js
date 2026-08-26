// ============================================================
// OtoNot — api/admin-yukle.js
// Admin sayfasından gelen kazanım CSV'sini Supabase'e işler.
// Koruma: x-admin-key başlığındaki anahtarı ADMIN_KEY env'iyle doğrular.
// ============================================================
import { createClient } from "@supabase/supabase-js";

const ADMIN_KEY = process.env.ADMIN_KEY || "";
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Yalnızca POST desteklenir." });
  }

  // Admin anahtarı doğrula
  const gelen = req.headers["x-admin-key"];
  if (!ADMIN_KEY || !gelen || gelen !== ADMIN_KEY) {
    return res.status(401).json({ error: "Geçersiz admin anahtarı." });
  }

  if (!url || !key) {
    return res.status(500).json({ error: "SUPABASE env eksik." });
  }

  try {
    // JSON gövde: { rows: [ {sinif,kategori,ders,unite,kazanim,puan_varsayilan,kaynak,kaynak_url}, ... ] }
    let body;
    try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
    catch { return res.status(400).json({ error: "Geçersiz JSON gövde." }); }

    const rows = Array.isArray(body?.rows) ? body.rows : [];
    if (rows.length === 0) return res.status(400).json({ error: "Satır bulunamadı." });

    // Satırları temizle / doğrula
    const temiz = rows
      .map((r) => ({
        sinif: String(r.sinif ?? "").trim(),
        kategori: String(r.kategori ?? "").trim(),
        ders: String(r.ders ?? "").trim(),
        unite: String(r.unite ?? "").trim(),
        kazanim: String(r.kazanim ?? "").trim(),
        puan_varsayilan: parseInt(r.puan_varsayilan ?? 10, 10) || 10,
        kaynak: String(r.kaynak ?? "MEB").trim(),
        kaynak_url: String(r.kaynak_url ?? "").trim(),
      }))
      .filter((r) => r.ders && r.kazanim && r.sinif);

    if (temiz.length === 0) return res.status(400).json({ error: "Geçerli (ders+kazanım+sınıf) satırı bulunamadı." });

    const supabase = createClient(url, key);
    const BATCH = 500;
    let islenen = 0;
    for (let i = 0; i < temiz.length; i += BATCH) {
      const chunk = temiz.slice(i, i + BATCH);
      const { error } = await supabase
        .from("kazanimlar")
        .upsert(chunk, { onConflict: "sinif,kategori,ders,unite,kazanim", ignoreDuplicates: true });
      if (error) throw new Error(error.message);
      islenen += chunk.length;
    }

    return res.status(200).json({ ok: true, islenen, toplam: temiz.length });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}