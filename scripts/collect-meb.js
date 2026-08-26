// ============================================================
// OtoNot — scripts/collect-meb.js
// data/meb_programlar.json'daki MEB programlarını okuyup her
// dersin PDF'ini indirir, içinden öğrenme çıktılarını çözer ve
// Supabase'e yazar. Github Actions cron / Vercel ile ayda 1-2 veya
// yılda 1 otomatik koşturulur.
//
// Kullanım:
//   node scripts/collect-meb.js                 // tüm dersler
//   node scripts/collect-meb.js --limit 3       // ilk 3 ders (test)
//   node scripts/collect-meb.js --ders MANTIK   // adında "MANTIK" olan
// ============================================================

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  parseOgrenmeCiktilari,
  pdfiIndirAndCikar,
  sinifAraligi,
  sinifAraligaUygun,
  dersAdiTemizle,
} from "./meb-lib.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");

// ---------- Minimal .env yükleyici ----------
function loadEnv() {
  const envPath = path.join(rootDir, ".env");
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();

async function main() {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : Infinity;
  const dersIdx = args.indexOf("--ders");
  const dersFiltre = dersIdx >= 0 ? args[dersIdx + 1].toUpperCase() : null;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY .env içinde eksik.");
    process.exit(1);
  }

  const invPath = path.join(rootDir, "data", "meb_programlar.json");
  if (!existsSync(invPath)) {
    console.error("Envanter yok. Önce: node scripts/sync-meb.js");
    process.exit(1);
  }
  const programs = JSON.parse(readFileSync(invPath, "utf8"));

  const supabase = createClient(url, key);
  const hedef = programs.filter((p) => p.pdf && (!dersFiltre || p.ders.toUpperCase().includes(dersFiltre))).slice(0, limit);

  console.log(`${hedef.length} ders işlenecek.`);
  let toplamEklendi = 0, hata = 0;
  const rapor = [];               // sınıfı belirlenemeyen / şüpheli dersler

  for (const p of hedef) {
    try {
      const metin = await pdfiIndirAndCikar(p.pdf);
      const ocler = parseOgrenmeCiktilari(metin);
      if (ocler.length === 0) {
        console.log(`  ${p.ders}: öğrenme çıktısı bulunamadı (format farklı olabilir).`);
        continue;
      }
      const dersAdi = dersAdiTemizle(p.ders) || p.ders;
      const kategori = p.kategori || (p.kademe === "TYMM" ? "MEB-TYMM" : "MEB");

      // Sınıf belirleme: kodun ilk sayısal parçası sınıf adayıdır.
      // Dersin kademe aralığına uyuyorsa TEK sınıf olarak kullanılır;
      // uymuyorsa (ör. MBU'da ilk sayı tema) "SINIF?" işaretlenip rapora yazılır.
      const dersSiniflari = new Set();
      ocler.forEach((o) => {
        if (o.sayilar && o.sayilar.length > 0) dersSiniflari.add(parseInt(o.sayilar[0], 10));
      });

      // Tüm öğrenme çıktıları aynı tek sınıfa mı işaret ediyor + ders aralığına uyuyor mu?
      let sinif = "SINIF?";
      if (dersSiniflari.size === 1) {
        const aday = [...dersSiniflari][0];
        if (sinifAraligaUygun(p.ders, aday)) sinif = String(aday);
      }

      // SINIF? olanlar rapora eklenir (yine de normalize sınıf değeri ile yazılır)
      if (sinif === "SINIF?") {
        rapor.push({ ders: p.ders, kategori, aralik: sinifAraligi(p.ders) || [], ciktiSayisi: ocler.length, kodlar: [...ocler].slice(0, 3).map((o) => o.kod) });
      }

      const rows = ocler.map((o) => ({
        // Tek sınıf değeri yaz; belirsizse koddan adayı dene, olmazsa SINIF? -> sonradan düzenlenir
        sinif,
        kategori,
        ders: dersAdi,
        unite: `${o.uniteNo}. Ünite`,
        kazanim: `${o.kod} ${o.baslik}`.trim(),
        puan_varsayilan: 10,
        kaynak: p.kademe === "TYMM" ? "MEB-TYMM" : "MEB",
        kaynak_url: p.pdf,
      }));

      // upsert: aynı sinif+kategori+ders+unite+kazanim tekrar eklenmez
      const { error } = await supabase
        .from("kazanimlar")
        .upsert(rows, { onConflict: "sinif,kategori,ders,unite,kazanim", ignoreDuplicates: true });
      if (error) throw new Error(error.message);

      toplamEklendi += rows.length;
      console.log(`  [OK] ${p.ders}: ${rows.length} kazanım (sınıf=${sinif}) -> toplam ${toplamEklendi}`);
    } catch (e) {
      hata++;
      console.error(`  [HATA] ${p.ders}: ${e.message}`);
    }
  }

  // Rapor dosyası yaz
  const raporPath = path.join(rootDir, "data", "sinif_raporu.json");
  writeFileSync(raporPath, JSON.stringify(rapor, null, 2), "utf8");

  console.log(`\nBitti. Eklenen kazanım: ${toplamEklendi}, hatalı ders: ${hata}, SINIF? ders sayısı: ${rapor.length}`);
  console.log(`Sınıf raporu: ${raporPath}  (SINIF? olan dersler burada listelenmiştir; sınıf değerlerini buna göre düzenleyebilirsin)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});