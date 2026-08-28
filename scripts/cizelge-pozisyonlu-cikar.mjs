// ============================================================
// OtoNot — scripts/cizelge-pozisyonlu-cikar.mjs
// TTKB haftalık ders çizelgesi PDF'lerini POZİSYON bazlı (x,y) parse eder:
//   - her SAYFAYI ayrı işler (sayfaların y uzayı karışmaz)
//   - sınıf sütun başlıklarının x koordinatlarını tespit eder
//   - her ders satırında sol-en-soldaki öğeyi ders adı, o sütunlardaki
//     değerleri de "ders o sınıfta var" olarak yorumlar
// Çıktı: data/cizelge_ders_db.json  (ders adı -> siniflar)
// Bu DB, sınıf bilgisi koddan çıkmayan derslerin kademe tespitinde
// (İlkokul/Ortaokul/Lise) kullanılmak üzere tasarlanmıştır.
// ============================================================
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const PDF_DIR = path.join(rootDir, "data", "cizelgeler");

const ISLER = [
  { id: "ilkogretim",            etiket: "İlköğretim (İlkokul+Ortaokul)" },
  { id: "imamhatip-ortaokul",   etiket: "İmam Hatip Ortaokulu" },
  { id: "anadolu-fen-sosyal",    etiket: "Anadolu/Fen/Sosyal Lisesi" },
  { id: "imamhatip_lise",        etiket: "Anadolu İmam Hatip Lisesi" },
  { id: "spor_lise",             etiket: "Spor Lisesi" },
  { id: "fen_lise",              etiket: "Fen Lisesi" },
  { id: "gsl_muzik",             etiket: "Güzel Sanatlar Lisesi Müzik" },
];

const EPS_Y = 3;
const COL_EPS = 6;
// Ders adı sol sütunda tek öğe olmalı; aşağıdaki sözcükler "ders adı" değil açıklama/metin.
const PROSE = /^(bu|öğrenci|öğrencilerin|öğrenciler|dersin|ders|yıl|sayı|kayd|ve|için|ancak|zümre|program|sınıf|eğitim|çizelge|bakan|kurul|madde)/i;

function requireExists(p) { try { readFileSync(p); return true; } catch { return false; } }
// PDF'i sayfa-bazlı {sayfa, ogeler:[{str,x,y}]} listesine çevirir.
async function sayfaOgelereCevir(buf) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.js");
  const doc = await getDocument({ data: new Uint8Array(buf) }).promise;
  const sayfalar = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const ogeler = tc.items.map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5] }));
    sayfalar.push({ sayfa: i, ogeler });
  }
  return sayfalar;
}

// Aynı sayfadaki öğeleri Y'ye göre satırlara gruplar.
function satirlaraAyir(ogeler) {
  const satirlar = [];
  for (const o of ogeler) {
    let s = satirlar.find((x) => Math.abs(x.y - o.y) < EPS_Y);
    if (!s) { s = { y: o.y, ogeler: [] }; satirlar.push(s); }
    s.ogeler.push(o);
  }
  satirlar.forEach((s) => s.ogeler.sort((a, b) => a.x - b.x));
  satirlar.sort((a, b) => b.y - a.y);
  return satirlar;
}

// Ders adı olarak kabul edilebilir mi?
function dersAdiMi(str) {
  const t = str.trim();
  if (t.length < 3 || t.length > 60) return false;
  if (PROSE.test(t)) return false;
  if (/^\d/.test(t)) return false;
  if ((t.match(/\./g) || []).length > 1) return false;
  return true;
}

// Satırdan, sınıf başlık x'lerine göre dolu sınıfları bulur.
function doluSiniflar(satir, sinifX) {
  const enler = satir.ogeler.filter((o) => /\d/.test(o.str));
  const siniflar = new Set();
  for (const [sinif, x] of sinifX) {
    if (enler.some((e) => Math.abs(e.x - x) < COL_EPS)) siniflar.add(sinif);
  }
  return siniflar;
}

// Sayfanın sınıf sütun x haritası ve ders gövdesinin başlangıç y değeri.
function sayfaSinifHaritasi(satirlar) {
  const baslik = satirlar.find((s) =>
    s.ogeler.some((o) => o.str.replace(/\s/g, "").toUpperCase().includes("SINIFLAR"))
  );
  if (!baslik) return null;
  const baslikY = baslik.y;
  const rakamSatir = satirlar.find(
    (s) => s.y < baslikY + 8 && s.y > baslikY - 40 && s.ogeler.some((o) => /^\d{1,2}$/.test(o.str.trim()))
  );
  if (!rakamSatir) return null;
  const harita = new Map();
  for (const o of rakamSatir.ogeler) {
    const n = parseInt(o.str.trim(), 10);
    if (!isNaN(n)) harita.set(n, o.x);
  }
  return { harita, goveyler: rakamSatir.y - EPS_Y };
}
async function main() {
  const sonuc = {};
  const uyarilar = [];
  for (const is of ISLER) {
    const dosya = path.join(PDF_DIR, is.id + ".pdf");
    if (!requireExists(dosya)) { uyarilar.push(is.id + ": PDF yok"); continue; }
    const buf = readFileSync(dosya);
    const sayfalar = await sayfaOgelereCevir(buf);

    const ders = {}; // ad -> Set(siniflar)
    let baslikliSayfa = 0;
    for (const sf of sayfalar) {
      const satirlar = satirlaraAyir(sf.ogeler);
      const h = sayfaSinifHaritasi(satirlar);
      if (!h) continue;
      baslikliSayfa++;
      const sinifX = h.harita;
      const ilkSinifX = Math.min(...sinifX.values());
      for (const s of satirlar) {
        if (s.y >= h.goveyler) continue;
        const adAdaylar = s.ogeler
          .filter((o) => o.x < ilkSinifX - 20 && o.str.trim().length > 0)
          .sort((a, b) => a.x - b.x);
        const adOge = adAdaylar[0];
        if (!adOge || !dersAdiMi(adOge.str)) continue;
        const ad = adOge.str.replace(/\s+/g, " ").trim();
        const siniflar = doluSiniflar(s, sinifX);
        if (siniflar.size === 0) continue;
        if (!ders[ad]) ders[ad] = new Set();
        siniflar.forEach((sn) => ders[ad].add(sn));
      }
    }

    const dersOut = {};
    for (const [ad, seti] of Object.entries(ders)) dersOut[ad] = [...seti].sort((a, b) => a - b);
    sonuc[is.id] = { etiket: is.etiket, baslikliSayfa, ders: dersOut };
    console.log(`${is.id}: ${Object.keys(dersOut).length} ders (${baslikliSayfa} sayfa)`);
    if (Object.keys(dersOut).length === 0) uyarilar.push(is.id + ": ders çıkmadı");
  }

  const outPath = path.join(rootDir, "data", "cizelge_ders_db.json");
  writeFileSync(outPath, JSON.stringify({ olusturma: new Date().toISOString(), kaynaklar: sonuc, uyarilar }, null, 2), "utf8");
  console.log("Yazildi:", outPath);
  if (uyarilar.length) console.log("Uyarilar:", uyarilar.join("; "));
}

main().catch((e) => { console.error(e); process.exit(1); });