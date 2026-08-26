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

// ---- Doğal (natural) sıralama yardımcıları ----
// "9.1.2" < "9.1.10", "DKAB.9.1.1" < "DKAB.9.1.2" sağlar; metinler Türkçe alfabetik karşılaştırılır.
function tokenize(s) {
  const out = [];
  const t = String(s ?? "");
  const re = /[0-9]+|[^\d\s_.-]+/g;
  let m;
  while ((m = re.exec(t))) {
    const v = m[0];
    if (/^[0-9]+$/.test(v)) out.push(parseInt(v, 10));
    else if (/[a-zA-ZğüşöçıİĞÜŞÖÇ]/.test(v)) out.push(v.toLocaleLowerCase("tr-TR"));
    else out.push(v);
  }
  return out;
}
function naturalCompare(a, b) {
  const ka = tokenize(a);
  const kb = tokenize(b);
  const n = Math.max(ka.length, kb.length);
  for (let i = 0; i < n; i++) {
    const x = ka[i];
    const y = kb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (typeof x === "number" && typeof y === "number") {
      if (x !== y) return x - y;
    } else {
      const xs = String(x);
      const ys = String(y);
      if (xs !== ys) return xs < ys ? -1 : 1;
    }
  }
  return 0;
}
function kazanimSira(a, b) {
  // Kademe -> kategori -> ders -> ünite -> kazanım şeklinde doğal sırala
  const alanlar = ["sinif", "kategori", "ders", "unite", "kazanim"];
  for (const al of alanlar) {
    const c = naturalCompare(a[al], b[al]);
    if (c !== 0) return c;
  }
  return 0;
}

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

    const { data, error } = await q;
    if (error) {
      throw new Error(error.message);
    }

    // Kademe -> kategori -> ders -> ünite -> kazanım (doğal) sıralaması
    const sirali = (data || []).slice().sort(kazanimSira);

    // kademe adıyla döndür (ön uç için)
    const sonuc = sirali.map((r) => ({ ...r, kademe: r.sinif }));
    return res.status(200).json({ data: sonuc });
  } catch (err) {
    return res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
}