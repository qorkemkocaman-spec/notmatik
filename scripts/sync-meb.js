// ============================================================
// OtoNot — scripts/sync-meb.js  (TASLAK)
// MEB "Programlar.aspx" sayfasından program listesini ve her
// dersin PDF adresini toplar. Kazanımları PDF içinden çıkaran
// ayrıştırıcı (ünite/konu/kazanım tablo çözücü) sonraki adımdır.
//
// Kullanım:   node scripts/sync-meb.js
// Çıktı:      data/meb_programlar.json
// ============================================================

import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const BASE = "https://mufredat.meb.gov.tr/";

// Basit HTML etiketi temizleyici
function stripHtml(s) {
  return s.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

async function fetchText(u) {
  const res = await fetch(u);
  if (!res.ok) throw new Error(`HTTP ${res.status} -> ${u}`);
  return await res.text();
}

async function main() {
  console.log("MEB programları listesi taranıyor...");
  const html = await fetchText(BASE + "Programlar.aspx");

  const pidRegex = /href="ProgramDetay\.aspx\?PID=(\d+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const programs = [];
  const seen = new Set();
  let m;
  while ((m = pidRegex.exec(html)) !== null) {
    const pid = Number(m[1]);
    if (seen.has(pid)) continue;
    seen.add(pid);
    const ad = stripHtml(m[2]);
    const kademe = ad.startsWith("[TYMM]") ? "TYMM" : "Klasik";
    programs.push({
      pid,
      kademe,
      ders: ad.replace(/^\[TYMM\]\s*/, ""),
      programDetayUrl: `${BASE}ProgramDetay.aspx?PID=${pid}`,
      pdf: null,
    });
  }

  console.log(`${programs.length} program bulundu. Detay PDF adresleri aranıyor...`);
  for (const p of programs) {
    try {
      const dhtml = await fetchText(p.programDetayUrl);
      // Örnek: <a href="Dosyalar/2026625151757399-Mantık döp.pdf" download ...>İndir</a>
      const pdf = dhtml.match(/href="(Dosyalar\/[^"]+\.pdf)"[^>]*>\s*İndir/i);
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
  console.log(`Tamamlandı. ${programs.length} program, ${pdfVar} PDF adresi bulundu.`);
  console.log(`Envanter: ${outFile}`);
}

main().catch((e) => {
  console.error("Hata:", e.message);
  process.exit(1);
});