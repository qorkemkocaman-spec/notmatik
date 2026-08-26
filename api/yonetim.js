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
import { createHash } from "crypto";

const ADMIN_KEY = process.env.ADMIN_KEY || "";
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

function md5hex(s) {
  return createHash("md5").update(String(s ?? "")).digest("hex");
}

// ---- Doğal (natural) sıralama yardımcıları ----
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
  const alanlar = ["sinif", "kategori", "ders", "unite", "kazanim"];
  for (const al of alanlar) {
    const c = naturalCompare(a[al], b[al]);
    if (c !== 0) return c;
  }
  return 0;
}

// Supabase/PostgREST tek sorguda 1000 kaydı sınırlayabildiğinden,
// filtrelere uyan tüm kayıtları sayfa sayfa çekip birleştirir.
async function tumuGetir(supabase, filtre) {
  const BATCH = 1000;
  const tum = [];
  let from = 0;
  for (;;) {
    let q = supabase
      .from("kazanimlar")
      .select("id,sinif,kategori,ders,unite,kazanim,puan_varsayilan,kaynak,kaynak_url")
      .range(from, from + BATCH - 1);
    if (filtre.kademe) q = q.eq("sinif", filtre.kademe);
    if (filtre.kategori) q = q.eq("kategori", filtre.kategori);
    if (filtre.ders) q = q.eq("ders", filtre.ders);
    if (filtre.unite) q = q.eq("unite", filtre.unite);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const donen = data || [];
    tum.push(...donen);
    if (donen.length < BATCH) break;
    from += BATCH;
  }
  return tum;
}

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
      const data = await tumuGetir(supabase, { kademe, kategori, ders, unite });
      const sirali = data.slice().sort(kazanimSira);
      return res.status(200).json({ data: sirali.map((r) => ({ ...r, kademe: r.sinif })) });
    }

    // ----------- JSON gövde hazırlama -----------
    let body;
    try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
    catch { return res.status(400).json({ error: "Geçersiz JSON gövde." }); }

    // Alan eşleme: kademe -> sinif
    const alan = (r) => {
      const d = {
        sinif: String(r.kademe ?? r.sinif ?? "").trim(),
        kategori: String(r.kategori ?? "").trim(),
        ders: String(r.ders ?? "").trim(),
        unite: String(r.unite ?? "").trim(),
        kazanim: String(r.kazanim ?? "").trim(),
        puan_varsayilan: parseInt(r.puan_varsayilan ?? 10, 10) || 10,
        kaynak: String(r.kaynak ?? "OtoNot").trim(),
        kaynak_url: String(r.kaynak_url ?? "").trim(),
      };
      // Uzun metinler btree index sınırını aştığı için unique index hash üzerinde
      d.kazanim_hash = md5hex(d.kazanim);
      return d;
    };

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

      if (id) {
        // Tekli silme
        const { error } = await supabase.from("kazanimlar").delete().eq("id", id);
        if (error) throw new Error(error.message);
        return res.status(200).json({ ok: true, silinen: 1 });
      }

      // Toplu silme: filtreler query'den gelir
      const { kademe, kategori, ders, unite } = req.query;
      if (!ders && !kademe && !kategori && !unite) {
        return res.status(400).json({ error: "Silme için id veya en az bir filtre (ders, kademe, kategori, unite) gerekli." });
      }

      // Filtreye uyan tüm kayıtların id'lerini sayfa sayfa topla (1000 sınırını aşmak için)
      const satirlar = await tumuGetir(supabase, { kademe, kategori, ders, unite });
      const ids = satirlar.map((r) => r.id);

      let silinen = 0;
      const BATCH = 1000;
      for (let i = 0; i < ids.length; i += BATCH) {
        const chunk = ids.slice(i, i + BATCH);
        const { error } = await supabase.from("kazanimlar").delete().in("id", chunk);
        if (error) throw new Error(error.message);
        silinen += chunk.length;
      }
      return res.status(200).json({ ok: true, silinen });
    }

    res.setHeader("Allow", "GET,POST,PUT,DELETE");
    return res.status(405).json({ error: "Desteklenmeyen metod." });
  } catch (err) {
    return res.status(500).json({ error: String(err?.message || err) });
  }
}