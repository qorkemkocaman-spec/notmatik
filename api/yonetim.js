// ============================================================
// OtoNot — api/yonetim.js
// Yönetim sayfası (yonetim.html) için CRUD API'si.
// Koruma: x-admin-key başlığındaki anahtarı ADMIN_KEY ile doğrular.
//  GET    -> listele (isteğe bağlı filtre: ?kademe=&kategori=&ders=)
//  POST   -> yeni kayıt ekle
//  PUT    -> id ile güncelle
//  DELETE -> id ile sil
// ============================================================
import { createClient } from "@supabase/supabase-js";

const ADMIN_KEY = process.env.ADMIN_KEY || "";
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  // Admin yetkisi
  const gelen = req.headers["x-admin-key"];
  if (!ADMIN_KEY || !gelen || gelen !== ADMIN_KEY) {
    return res.status(401).json({ error: "Geçersiz admin anahtarı." });
  }
  if (!url || !key) return res.status(500).json({ error: "SUPABASE env eksik." });

  const supabase = createClient(url, key);
  const method = req.method;

  try {
    // ---------------- LISTELE ----------------
    if (method === "GET") {
      const { kademe, kategori, ders, unite } = req.query;
      let q = supabase
        .from("kazanimlar")
        .select("id,sinif,kategori,ders,unite,kazanim,puan_varsayilan,kaynak,kaynak_url")
        .order("sinif")
        .order("ders");
      if (kademe) q = q.eq("sinif", kademe);
      if (kategori) q = q.eq("kategori", kategori);
      if (ders) q = q.eq("ders", ders);
      if (unite) q = q.eq("unite", unite);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return res.status(200).json({ data: (data || []).map((r) => ({ ...r, kademe: r.sinif })) });
    }

    // ----------- JSON gövde hazırlama -----------
    let body;
    try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
    catch { return res.status(400).json({ error: "Geçersiz JSON gövde." }); }

    // Alan eşleme: kademe -> sinif
    const alan = (r) => ({
      sinif: String(r.kademe ?? r.sinif ?? "").trim(),
      kategori: String(r.kategori ?? "").trim(),
      ders: String(r.ders ?? "").trim(),
      unite: String(r.unite ?? "").trim(),
      kazanim: String(r.kazanim ?? "").trim(),
      puan_varsayilan: parseInt(r.puan_varsayilan ?? 10, 10) || 10,
      kaynak: String(r.kaynak ?? "OtoNot").trim(),
      kaynak_url: String(r.kaynak_url ?? "").trim(),
    });

    // ---------------- EKLE ----------------
    if (method === "POST") {
      const kayit = alan(body);
      if (!kayit.sinif || !kayit.ders || !kayit.kazanim) {
        return res.status(400).json({ error: "kademe, ders ve kazanim zorunludur." });
      }
      const { data, error } = await supabase.from("kazanimlar").insert(kayit).select("id").single();
      if (error) throw new Error(error.message);
      return res.status(200).json({ ok: true, id: data?.id });
    }

    // ---------------- GÜNCELLE ----------------
    if (method === "PUT") {
      const id = body.id;
      if (!id) return res.status(400).json({ error: "id gerekli." });
      const kayit = alan(body);
      const { error } = await supabase.from("kazanimlar").update(kayit).eq("id", id);
      if (error) throw new Error(error.message);
      return res.status(200).json({ ok: true });
    }

    // ---------------- SİL ----------------
    if (method === "DELETE") {
      const id = req.query.id || (body && body.id);
      let q = supabase.from("kazanimlar").delete();

      if (id) {
        // Tekli silme
        q = q.eq("id", id);
      } else {
        // Toplu silme: filtreler query'den gelir
        const { kademe, kategori, ders, unite } = req.query;
        if (ders) q = q.eq("ders", ders);
        if (kademe) q = q.eq("sinif", kademe);
        if (kategori) q = q.eq("kategori", kategori);
        if (unite) q = q.eq("unite", unite);

        // Güvenlik: en az bir filtre zorunlu (tüm tabloyu silme riskine karşı)
        if (!ders && !kademe && !kategori && !unite) {
          return res.status(400).json({ error: "Silme için id veya en az bir filtre (ders, kademe, kategori, unite) gerekli." });
        }
      }

      const { data, error } = await q.select("id");
      if (error) throw new Error(error.message);
      return res.status(200).json({ ok: true, silinen: (data || []).length });
    }

    res.setHeader("Allow", "GET,POST,PUT,DELETE");
    return res.status(405).json({ error: "Desteklenmeyen metod." });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}