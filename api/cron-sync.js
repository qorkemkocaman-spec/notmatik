// ============================================================
// OtoNot — api/cron-sync.js  (MANUEL/opsiyonel tetikleyici)
// MEB'den yeniden veri çeker. Not: Vercel serverless timeout
// 60s olduğundan TÜM 535 dersi burada işleyemezsin.
// Asıl tam otomasyon GitHub Actions workflow'unda çalışır:
//   .github/workflows/meb-sync.yml
// Bu endpoint yalnızca "hızlı deneme / küçük doğrulama" içindir.
//
// Çağırma (manuel):
//   Vercel -> Settings -> Environment Variables -> CALLER_TOKEN ekle
//   POST https://.../api/cron-sync   (header: x-auth-token: <token>)
// ============================================================
import { createClient } from "@supabase/supabase-js";
import { parseOgrenmeCiktilari, pdfiIndirAndCikar, sinifFromDersAdi, dersAdiTemizle } from "../scripts/meb-lib.js";

const TOKEN = process.env.CALLER_TOKEN;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST gerekli" });
  }
  if (!TOKEN || req.headers["x-auth-token"] !== TOKEN) {
    return res.status(401).json({ error: "Geçersiz token." });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return res.status(500).json({ error: "Env eksik" });
  }

  const supabase = createClient(url, key);
  try {
    const invRes = await fetch("https://mufredat.meb.gov.tr/Programlar.aspx");
    const html = await invRes.text();
    const pidRe = /href="ProgramDetay\.aspx\?PID=(\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const seen = new Set();
    const dersler = [];
    let m;
    while ((m = pidRe.exec(html)) !== null) {
      const pid = Number(m[1]);
      if (seen.has(pid)) continue;
      seen.add(pid);
      dersler.push({ pid, ad: m[2].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim() });
    }

    let islenen = 0, eklendi = 0;
    for (let i = 0; i < 3 && i < dersler.length; i++) {
      try {
        const d = await fetch(`https://mufredat.meb.gov.tr/ProgramDetay.aspx?PID=${dersler[i].pid}`);
        const dhtml = await d.text();
        const pdf = dhtml.match(/href="(Dosyalar\/[^"]+\.pdf)"[^>]*>İndir/i);
        if (!pdf) continue;
        const pdfUrl = "https://mufredat.meb.gov.tr/" + pdf[1];
        const metin = await pdfiIndirAndCikar(pdfUrl);
        const ocler = parseOgrenmeCiktilari(metin);
        if (ocler.length === 0) continue;
        const rows = ocler.map((o) => ({
          sinif: sinifFromDersAdi(dersler[i].ad) || "0",
          kategori: "MEB-TYMM",
          ders: dersAdiTemizle(dersler[i].ad) || dersler[i].ad,
          unite: `${o.uniteNo}. Ünite`,
          kazanim: `${o.kod} ${o.baslik}`.trim(),
          puan_varsayilan: 10,
          kaynak: "MEB-TYMM",
          kaynak_url: pdfUrl,
        }));
        const { error } = await supabase.from("kazanimlar").upsert(rows, { onConflict: "sinif,kategori,ders,unite,kazanim", ignoreDuplicates: true });
        if (error) throw new Error(error.message);
        islenen++;
        eklendi += rows.length;
      } catch (e) {
        // ders bazlı hata tümünü durdurmasın
      }
    }
    return res.status(200).json({ ok: true, islenenDers: islenen, eklenen: eklendi, not: "Tam senkron için GitHub Actions kullanın" });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}