// ============================================================
// OtoNot — scripts/sync-meb.js
// MEB "Programlar.aspx" sayfasını tarar; her ders programını
// MEB'in accordion gruplarına göre KATEGORİYE ayırır ve PDF
// adreslerini toplar.
//
// Kullanım:   node scripts/sync-meb.js
// Çıktı:      data/meb_programlar.json  (her kayıtta ...kategori... alanı)
// ============================================================

import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const BASE = "https://mufredat.meb.gov.tr/";

// --- Seçmeli dersler: adında "SEÇMELİ" geçmeyen ama ortaokulda seçmeli olarak
// -- okutulan (çizelgeden teyit edilen) dersler. Bu dersler kategori olarak
// -- "<Grup> Seçmeli" altına alınır.
const ORTAOKUL_SECMELI_LISTESI = [
  "matematik ve bilim uygulamaları",
  "okuma becerileri",
  "yazarlık ve yazma becerileri",
  "yaşayan diller ve lehçeler",
  "çevre eğitimi ve iklim değişikliği",
  "hukuk ve adalet",
  "düşünme eğitimi",
  "robotik kodlama",
  "yapay zek",
  "proje tasarımı ve uygulamaları",
  "okul temelli sosyal sorumluluk",
  "medya okuryazarlığı",
  "afet bilinci",
  "temel yaşam becerileri",
  "türk sosyal hayatında aile",
  "peygamberimizin hayatı",
  "kültür ve medeniyetimize yön verenler",
  "ahlak ve vatandaşlık eğitimi",
  "görgü kuralları ve nezaket",
  "masal ve destanlarımız",
  "geleneksel sanatlar",
  "dijital sanatlar",
  "oyun ve oyun etkinlikleri",
  "trafik güvenliği",
  "insan hakları vatandaşlık ve demokrasi",
  "halk oyunları",
];

// Bir ders adının seçmeli olup olmadığını belirler.
export function isSecmeli(dersAdi) {
  const ust = dersAdi.toUpperCase();
  if (ust.includes("SEÇMELİ") || ust.includes("SECMELI")) return true;
  const kup = dersAdi.toLowerCase();
  return ORTAOKUL_SECMELI_LISTESI.some((s) => kup.includes(s));
}

// Seçmeli bir dersin "<Grup> Seçmeli" kategori adını üretir.
export function secmeliKategori(grup) {
  // Ortaokul / temel eğitim seçmeli dersleri tek başlıkta topla
  const g = (grup || "").toLowerCase();
  if (g.includes("ortaöğretim")) return "Ortaöğretim Seçmeli";
  if (g.includes("imam hatip")) return "İmam Hatip Seçmeli";
  if (g.includes("güzel sanatlar") || g.includes("guzel sanatlar")) return "Güzel Sanatlar Seçmeli";
  if (g.includes("müzik okulları") || g.includes("muzik")) return "Müzik Okulları Seçmeli";
  if (g.includes("spor lisesi")) return "Spor Liseleri Seçmeli";
  if (g.includes("özel eğitim")) return "Özel Eğitim Seçmeli";
  // Temel Eğitim / TYMM Temel Eğitim (ilkokul+ortaokul) seçmeli dersleri
  if (g.includes("temel eğitim")) return "Ortaokul Seçmeli";
  return `${grup} Seçmeli`;
}

function stripHtml(s) {
  return s.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

// Sayfayı kategori (accordion grubu) bazında çözer:
//   her "panel-collapse" bloğu içindeki ders listesini o kategoriye atar.
// Kategori adları (accordion-toggle) ve collapse blokları sıralı eşleştirilir.
async function main() {
  console.log("MEB programları listesi taranıyor...");
  const html = await fetchText(BASE + "Programlar.aspx");

  // 1) Kategori adlarını sırayla al
  const katRe = /<a class="accordion-toggle boldyazi">\s*([^<]+?)\s*<\/a>/g;
  const kategoriAdlari = [];
  let km;
  while ((km = katRe.exec(html)) !== null) {
    kategoriAdlari.push(stripHtml(km[1]));
  }

  // 2) Her collapse bloğunu, sıradaki kategoriyle eşleştir.
  //    ASP.NET her kategoriyi Repeater_Kategori ile sıralı üretir.
  const collapses = [];
  const colRe = /<div id='collapse(\d+)' class="panel-collapse collapse"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g;
  let cm;
  while ((cm = colRe.exec(html)) !== null) {
    collapses.push({ id: cm[1], body: cm[2] });
  }

  // Kategori sayısı kadar collapse olmalı; güvenli eşleştirme:
  const programs = [];
  const seen = new Set();

  collapses.forEach((col, idx) => {
    const kategori = kategoriAdlari[idx] || `Grup ${idx + 1}`;
    const liRe = /href="ProgramDetay\.aspx\?PID=(\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let lm;
    while ((lm = liRe.exec(col.body)) !== null) {
      const pid = Number(lm[1]);
      if (seen.has(pid)) continue;
      seen.add(pid);
      const ad = stripHtml(lm[2]);
      const kademe = ad.startsWith("[TYMM]") ? "TYMM" : "Klasik";
      const orjKategori = kategori;
      const secmeli = isSecmeli(ad);
      programs.push({
        pid,
        kademe,
        kategori: secmeli ? secmeliKategori(orjKategori) : orjKategori,
        secmeli,
        ders: ad.replace(/^\[TYMM\]\s*/, ""),
        programDetayUrl: `${BASE}ProgramDetay.aspx?PID=${pid}`,
        pdf: null,
      });
    }
  });

  console.log(`${programs.length} program bulundu (${kategoriAdlari.length} kategori). Detay PDF adresleri aranıyor...`);

  // 3) Her programın PDF adresini bul
  for (const p of programs) {
    try {
      const dhtml = await fetchText(p.programDetayUrl);
      const pdf = dhtml.match(/href="(Dosyalar\/[^"]+\.pdf)"[^>]*>\s*(?:İndir|İNDİR)/i) ||
                  dhtml.match(/href="(Dosyalar\/[^"]+\.pdf)"[^>]*download/i);
      if (pdf) p.pdf = BASE + "/" + pdf[1];
    } catch (e) {
      // tek programın hatası tüm taramayı durdurmasın
    }
  }

  const outDir = path.join(rootDir, "data");
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "meb_programlar.json");
  writeFileSync(outFile, JSON.stringify(programs, null, 2), "utf8");

  const pdfVar = programs.filter((p) => p.pdf).length;
  console.log(`Tamamlandı. ${programs.length} program, ${kategoriAdlari.length} kategori, ${pdfVar} PDF adresi bulundu.`);
  console.log(`Envanter: ${outFile}`);
}

async function fetchText(u) {
  const res = await fetch(u);
  if (!res.ok) throw new Error(`HTTP ${res.status} -> ${u}`);
  return await res.text();
}

// Sadece doğrudan çalıştırıldığında main() koş (import edildiğinde koşma)
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  main().catch((e) => {
    console.error("Hata:", e.message);
    process.exit(1);
  });
}

export { main };