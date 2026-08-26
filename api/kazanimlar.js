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

    // Filtreler: /api/kazanimlar?kademe=Ortaokul&kategori=Ortak Ders&ders=Matematik
    // kademe -> sinif sütununda saklanır (İlkokul, Ortaokul, İHO, Lise, Spor Lisesi, Güzel Sanatlar, Meslek Lisesi)
    const { kademe, kategori, ders } = req.query;

    let q = supabase
      .from("kazanimlar")
      .select("id,sinif,kategori,ders,unite,kazanim,puan_varsayilan,kaynak,kaynak_url");

    if (kademe) q = q.eq("sinif", kademe);
    if (kategori) q = q.eq("kategori", kategori);
    if (ders) q = q.eq("ders", ders);

    q = q.order("sinif", { ascending: true }).order("ders", { ascending: true });

    const { data, error } = await q;
    if (error) {
      throw new Error(error.message);
    }

    // kademe adıyla döndür (ön uç için)
    const sonuc = (data || []).map((r) => ({ ...r, kademe: r.sinif }));
    return res.status(200).json({ data: sonuc });
  } catch (err) {
    return res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
}