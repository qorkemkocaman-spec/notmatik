// ============================================================
// OtoNot — scripts/collect-meb.js
// data/meb_programlar.json'daki MEB programlarını okuyup her TYMM
// dersin (yalnızca en güncel yıl sürümü) PDF'ini indirir, öğrenme
// çıktılarını çözer ve şablona göre Supabase'e yazar (upsert).
//
// ŞABLON:  kademe; kategori; ders; unite; kazanim; puan
//   DB'ye: sinif(kademe); kategori; ders; unite; kazanim; puan_varsayilan
//
// Kural özeti:
//   - Yalnızca TYMM müfredatı işlenir (eski "Klasik" müfredat bu sene
//     4, 8 ve 12. sınıflar için bilerek dokunulmadan bırakılır).
//   - Aynı dersin 2024 / 2026 gibi birden çok yıl sürümü varsa EN GÜNCELİ seçilir.
//   - kademe  = İlkokul | Ortaokul | İHO | Lise | Spor Lisesi |
//               Güzel Sanatlar Lisesi | Meslek Lisesi
//   - kategori= Ortak Ders | Seçmeli Ders
//   - unite   = "9. Sınıf 1. Tema: YAŞAM" (TYMM'de tema, bazı derslerde ünite)
//   - kazanim = kod + ana öğrenme çıktısı metni (süreç bileşenleri hariç)
//
// Kullanım:
//   node scripts/collect-meb.js               // tüm TYMM dersleri
//   node scripts/collect-meb.js --limit 3     // ilk 3 ders (test)
//   node scripts/collect-meb.js --ders BIYOLOJI
// ============================================================

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import {
  parseOgrenmeCiktilari,
  pdfiIndirAndCikar,
  enGuncelProgramlari,
  kademeBelirle,
  okulTuruBelirle,
  kategoriBelirle,
  dersAdiTemizle,
  sinifAraligaUygun,
  kazanimHash,
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

  // Yalnızca TYMM + en güncel yıl sürümlerini seç (eski Klasik dahil edilmez)
  const { dersler, atlanan } = enGuncelProgramlari(programs);
  const hedef = dersler
    .filter((p) => !dersFiltre || p.ders.toUpperCase().includes(dersFiltre))
    .slice(0, limit);

  const supabase = createClient(url, key);
  console.log(`${hedef.length} TYMM ders işlenecek (en güncel yıl; ${atlanan.length} eski yıl sürümü atlandı).`);

  const durum = { toplam: 0, rapor_hatali: [] };
  const rapor = { kademeYok: [], sınıfSorunlu: [], ciktisiz: [], hatali: durum.rapor_hatali };

  // Tek ders işleyicisi (paralel çalıştırılabilir; durum/rapor ortak ve mutasyona açık)
  async function dersIslet(p) {
    let sinifBelirsiz = false;
    const metin = await pdfiIndirAndCikar(p.pdf);
    const oc = parseOgrenmeCiktilari(metin);
    if (oc.length === 0) {
      rapor.ciktisiz.push({ ders: p.ders, kategori: p.kategori });
      console.log(`  ${p.ders}: öğrenme çıktısı bulunamadı (format farklı).`);
      return;
    }

    const kategori = kategoriBelirle(p);
    const dersAdi = dersAdiTemizle(p.ders) || p.ders;
    const okulTuru = okulTuruBelirle(p) || "";

    const rows = oc
      .map((o) => {
        const kademe = kademeBelirle(p, o.sinif);
        if (!kademe) {
          if (!sinifBelirsiz) {
            sinifBelirsiz = true;
            rapor.kademeYok.push({ ders: p.ders, kategori: p.kategori, yil: p.ders.match(/\((\d{4})\)/)?.[1] || "" });
          }
          return null;
        }
        const kaz = `${o.kod} ${o.baslik}`.trim();
        if (!sinifAraligaUygun(p.ders, o.sinif)) {
          rapor.sınıfSorunlu.push({ ders: p.ders, kod: o.kod, sinif: o.sinif });
        }
        return {
          sinif: kademe,                 // "kademe" sütunu
          okul_turu: okulTuru,           // TTKB okul türü (kademe bandından ayrı)
          kazanim_hash: kazanimHash(o.kod, o.baslik),
          kategori,                      // Ortak Ders | Seçmeli Ders
          ders: dersAdi,                 // "ders" sütunu (temiz ad)
          unite: o.unite,                // "Sınıf X Tema/Ünite Y: Ad"
          kazanim: kaz,                  // "kazanim" sütunu (kod + ana çıktı)
          puan_varsayilan: 10,           // "puan" sütunu
          kaynak: "MEB-TYMM",
          kaynak_url: p.pdf,
        };
      })
      .filter(Boolean);

    if (rows.length === 0) {
      console.log(`  [KADEME?] ${p.ders} -> 7 kademeye eşlenemedi (atlandı)`);
      return;
    }

    const { error } = await supabase
      .from("kazanimlar")
      .upsert(rows, { onConflict: "sinif,kategori,ders,unite,kazanim_hash", ignoreDuplicates: false });
    if (error) throw new Error(error.message);

    durum.toplam += rows.length;
    console.log(`  [OK] ${dersAdi} (${rows[0].sinif}): ${rows.length} kazanım -> toplam ${durum.toplam}`);
  }

  // Kuyruk: aynı anda en fazla ES ders işlenir (paralel indirme + parse)
  const ES = 4;
  let aktif = 0;
  let sira = 0;
  await new Promise((resolve) => {
    const planla = () => {
      while (aktif < ES && sira < hedef.length) {
        const p = hedef[sira++];
        aktif++;
        dersIslet(p)
          .catch((e) => {
            rapor.hatali.push({ ders: p.ders, hata: String(e.message) });
            console.error(`  [HATA] ${p.ders}: ${e.message}`);
          })
          .finally(() => {
            aktif--;
            planla();
          });
      }
      if (sira >= hedef.length && aktif === 0) resolve();
    };
    planla();
  });

  const toplamEklendi = durum.toplam;

  const raporPath = path.join(rootDir, "data", "sinif_raporu.json");
  writeFileSync(raporPath, JSON.stringify(rapor, null, 2), "utf8");

  console.log(
    `\nBitti. Eklenen/güncellenen kazanım: ${toplamEklendi}` +
      ` | kademeYok: ${rapor.kademeYok.length} | sınıfSorunlu: ${rapor.sınıfSorunlu.length}` +
      ` | ciktisiz: ${rapor.ciktisiz.length} | hatali: ${rapor.hatali.length}`
  );
  console.log(`Ayrıntı raporu: ${raporPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
