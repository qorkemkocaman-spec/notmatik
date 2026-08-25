// ============================================================
// OtoNot — api/kazanimlar.js
// İstemciden (index.html) çağrılan tek nokta. Supabase'den okur,
// istemiçi görmeye gerek duyulmayan sunucu tarafı bir katmandır.
// ============================================================
// Vercel: bu dosya `api/kazanimlar.js` olarak otomatik function olur.

import { createClient } from "@supabase/supabase-js";

// Sunucu tarafı tek okuma için service role kullanıyoruz.
// SupabaseDashboard -> Settings -> API -> service_role
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  // Sadece GET
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Yalnızca GET desteklenir." });
  }

  if (!url || !key) {
    return res
      .status(500)
      .json({ error: "Sunucu tarafında SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY tanımlı değil." });
  }

  try {
    const supabase = createClient(url, key);

    // İsteğe bağlı filtreler: /api/kazanimlar?sinif=10&kategori=Fen&ders=Kimya
    const { sinif, kategori, ders } = req.query;

    let q = supabase
      .from("kazanimlar")
      .select("sinif,kategori,ders,unite,kazanim,puan_varsayilan,kaynak,kaynak_url");

    if (sinif) q = q.eq("sinif", sinif);
    if (kategori) q = q.eq("kategori", kategori);
    if (ders) q = q.eq("ders", ders);

    q = q.order("sinif").order("kategori").order("ders");

    const { data, error } = await q;
    if (error) {
      throw new Error(error.message);
    }

    return res.status(200).json({ data });
  } catch (err) {
    return res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
}