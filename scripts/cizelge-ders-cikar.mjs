// ============================================================
// OtoNot — scripts/cizelge-ders-cikar.mjs
// data/cizelgeler/*.txt çizelgelerinden ders -> (sınıflar, seçmeli)
// eşlemesini çıkarır ve MEB envanterindeki derslerle eşleştirir;
// sonucu data/sinif_sablonu_ondoldurulmus.csv şablonuna yazar.
//
// Kural:
//  - Ortaokul çizelgeleri (ilkogretim, imamhatip-ortaokul):
//      parantezli dersler seçmeli, sınıflar 5,6,7,8
//  - Lise çizelgeleri: seçmeli -> 9,10,11,12; zorunlu dersler de 9-12
// ============================================================
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const CIZ_DIR = path.join(rootDir, "data", "cizelgeler");

const ISLER = [
  { id: "ilkogretim", kademe: "ortaokul", siniflar: [5, 6, 7, 8] },
  { id: "imamhatip-ortaokul", kademe: "ortaokul", siniflar: [5, 6, 7, 8] },
  { id: "anadolu-fen-sosyal", kademe: "lise", siniflar: [9, 10, 11, 12] },
  { id: "imamhatip_lise", kademe: "lise", siniflar: [9, 10, 11, 12] },
  { id: "spor_lise", kademe: "lise", siniflar: [9, 10, 11, 12] },
  { id: "fen_lise", kademe: "lise", siniflar: [9, 10, 11, 12] },
  { id: "gsl_muzik", kademe: "lise", siniflar: [9, 10, 11, 12] },
];

function trLower(s) {
  return s.toLowerCase().replace(/İ/g, "i").replace(/Ğ/g, "ğ").replace(/Ü/g, "ü").replace(/Ş/g, "ş").replace(/Ö/g, "ö").replace(/Ç/g, "ç");
}

// Bir satırdaki " | " hücrelerinden ders adı olanları çıkar
function hucrelerdenDersler(satir) {
  const sonuc = [];
  // " | " ayırıcı
  const hucreler = satir.split("|").map((h) => h.trim()).filter(Boolean);
  for (const h of hucreler) {
    if (h.length < 4) continue;
    if (!/^[A-Za-zÇĞİÖŞÜ]/.test(h)) continue;
    if (/^(T\.C\.|MİLLİ|TALİM VE|KONU|SAYI|UYGUNDUR|REHBERLİK)/i.test(h)) continue;
    if (/^(1|2|3|4|5|6|7|8|9|10|11|12)\s*$/.test(h.trim())) continue; // sadece sayı değil
    if (/[a-zçğıöşü]\s+[A-Z]/.test(h)) continue; // başka hücreyle birleşme riski
    sonuc.push(h);
  }
  return sonuc;
}

async function main() {
  const harita = {}; // dersCore -> {ders, secmeli, siniflar:Set}

  for (const is of ISLER) {
    const dosya = path.join(CIZ_DIR, is.id + ".txt");
    if (!existsSync(dosya)) continue;
    const metin = readFileSync(dosya, "utf8").replace(/\r/g, "");
    const satirlar = metin.split("\n");

    for (const satir of satirlar) {
      const dersler = hucrelerdenDersler(satir);
      for (const ders of dersler) {
        const parantezli = /\(\d+\)/.test(ders);
        const dersCore = trLower(ders.replace(/\(\d+\)/g, "").replace(/\s+/g, " ").trim());
        if (!dersCore) continue;
        if (!harita[dersCore]) {
          harita[dersCore] = { ders: ders, secmeli: false, siniflar: new Set(), kaynaklar: [] };
        }
        const k = harita[dersCore];
        if (parantezli) k.secmeli = true;
        // Tüm dersler o çizelgenin kademesindeki sınıflarda okutulabilir
        is.siniflar.forEach((s) => k.siniflar.add(s));
        if (!k.kaynaklar.includes(is.id)) k.kaynaklar.push(is.id);
      }
    }
  }

  // MEB envanteri ile eşleştir ve şablonu doldur
  const programs = JSON.parse(readFileSync(path.join(rootDir, "data", "meb_programlar.json"), "utf8"));
  let csv = "\uFEFFders;kategori;sınıf;seçmeli;yorum\r\n";
  let eslenen = 0, eslenmeyen = 0;

  // Kategori -> hangi kademe çizelgeleri geçerli
  function kademeCizelgeler(kategori) {
    const k = trLower(kategori);
    if (k.includes("ortaöğretim")) return ["lise"];               // Ortaöğretim/TYMM Ortaöğretim -> lise
    if (k.includes("temel eğitim")) return ["ortaokul"];          // Temel Eğitim/TYMM Temel Eğitim -> ortaokul
    if (k.includes("güzel sanatlar")) return ["lise"];
    if (k.includes("spor lisesi")) return ["lise"];
    if (k.includes("müzik okul")) return ["lise"];
    if (k.includes("imam hatip")) return ["ortaokul", "lise"];
    if (k.includes("özel eğitim")) return ["ortaokul", "lise"];
    if (k.includes("okul öncesi")) return [];
    return ["ortaokul", "lise"]; // bilinmeyen -> her ikisi (gevşek)
  }

  for (const p of programs) {
    const ders = p.ders.replace(/;/g, ",");
    const dersKucuk = trLower(p.ders);
    const dersCoreEnv = dersKucuk.replace(/\(\d+\)/g, "").replace(/dersi|dersi\b/g, "").replace(/\s+/g, " ").trim();
    // İzin verilen çizelge kademeleri
    const izinliKademeler = new Set(kademeCizelgeler(p.kategori));

    let eslesme = null;
    let enIyiUzunluk = 0;
    for (const core in harita) {
      // Haritadaki çizelge kaynaklarının kademesini kontrol et
      const kademeler = new Set();
      harita[core].kaynaklar.forEach((k) => {
        const is = ISLER.find((i) => i.id === k);
        if (is) kademeler.add(is.kademe);
      });
      // En az bir izinli kademe eşleşsin
      const kademeUyum = [...kademeler].some((km) => izinliKademeler.has(km));
      if (!kademeUyum) continue;

      // Sıkı eşleşme: envanter adı çizelge adını İÇERİYOR ve kelime sınırı uyumlu
      // veya çizelge adı envanter adını içeriyor. Uzunluk skoru ile en iyiyi seç.
      const envTemiz = dersCoreEnv;
      const cizTemiz = core.replace(/\s+/g, " ").trim();
      let skor = 0;
      if (envTemiz.includes(cizTemiz)) skor = cizTemiz.length;
      else if (cizTemiz.includes(envTemiz)) skor = envTemiz.length;

      // Sadece yeterince anlamlı (>=4) eşleşmeleri kabul et
      if (skor >= 4 && skor > enIyiUzunluk) { eslesme = harita[core]; enIyiUzunluk = skor; }
    }

    let sınıf = eslesme ? [...eslesme.siniflar].sort((a, b) => a - b).join(",") : "";
    let secmeli = eslesme ? eslesme.secmeli : "";
    let yorum = eslesme ? (`çizelge(${eslesme.kaynaklar.join("+")})`) : "çizelgede bulunamadı - kontrol";

    // Kaynak bazlı zenginleştirme: adında SEÇMELİ geçen her ders zaten seçmelidir
    if (!secmeli && /SEÇMELİ|SECMELI/i.test(p.ders)) secmeli = true;

    if (eslesme) eslenen++; else eslenmeyen++;
    csv += `"${ders}";"${p.kategori}";"${sınıf}";"${secmeli ? "SEÇMELİ" : ""}";"${yorum}"\r\n`;
  }

  writeFileSync(path.join(rootDir, "data", "sinif_sablonu_ondoldurulmus.csv"), csv, "utf8");
  console.log(`tamam. eşlenen: ${eslenen}, eşlenmeyen: ${eslenmeyen}`);
}

main().catch((e) => { console.error(e); process.exit(1); });