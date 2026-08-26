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

// Supabase/PostgREST tek sorguda 1000 kaydı sınırlayabildiğinden,
// filtrelere uyan TÜM kayıtları sayfa sayfa çekip birleştirir.
// Performans için önce toplamı (count) alır, tüm sayfaları PARALEL çeker
// (sıralı bekleme yerine Promise.all) — böylece gecikme ~1-2 ağ turuna iner.
async function tumuGetir(supabase, filtre) {
  const BATCH = 1000;
  const cols = "id,sinif,kategori,ders,unite,kazanim,puan_varsayilan,kaynak,kaynak_url";

  // Filtreleri tek noktadan uygula
  const filtrele = (q) => {
    if (filtre.kademe) q = q.eq("sinif", filtre.kademe);
    if (filtre.kategori) q = q.eq("kategori", filtre.kategori);
    if (filtre.ders) q = q.eq("ders", filtre.ders);
    if (filtre.unite) q = q.eq("unite", filtre.unite);
    return q;
  };

  // 1) Toplam kayıt sayısını tek head count ile öğren
  const cnt = await filtrele(supabase.from("kazanimlar").select("id", { count: "exact", head: true }));
  if (cnt.error) throw new Error(cnt.error.message);
  const toplam = cnt.count || 0;

  // 2) Tüm sayfaları paralel çek
  const sayfaSayisi = Math.ceil(toplam / BATCH);
  const talepler = [];
  for (let i = 0; i < sayfaSayisi; i++) {
    const from = i * BATCH;
    const taleb = filtrele(supabase.from("kazanimlar").select(cols).range(from, from + BATCH - 1)).then((r) => {
      if (r.error) throw new Error(r.error.message);
      return r.data || [];
    });
    talepler.push(taleb);
  }
  return (await Promise.all(talepler)).flat();
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
    const { kademe, kategori, ders, unite } = req.query;

    // Filtrelere uyan tüm kayıtları sayfa sayfa çek
    const data = await tumuGetir(supabase, { kademe, kategori, ders, unite });

    // Kademe -> kategori -> ders -> ünite -> kazanım (doğal) sıralaması
    const sirali = data.slice().sort(kazanimSira);

    // kademe adıyla döndür (ön uç için)
    const sonuc = sirali.map((r) => ({ ...r, kademe: r.sinif }));
    return res.status(200).json({ data: sonuc });
  } catch (err) {
    return res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
}