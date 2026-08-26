// ============================================================
// OtoNot — scripts/meb-lib.js
// MEB program PDF'lerini indirip içindeki öğrenme çıktılarını
// (kazanımları) çözmek için yardımcı fonksiyonlar.
// ============================================================
import { readFileSync } from "node:fs";

// Ders adından sınıf ARALIĞINI bul: "(1-4)", "(5-8)", "(9-12)" gibi.
// Not: bu yalnızca GEÇERLİ değerleri doğrulamak için kullanılır; veriye
// aralık değil TEK değer yazılır.
export function sinifAraligi(dersAdi) {
  const m = dersAdi.match(/\((\d+)\s*-\s*(\d+)\)/);
  if (m) return [parseInt(m[1], 10), parseInt(m[2], 10)];
  if (/ORTAÖĞRETİM|LİSE|İMAM HATİP/i.test(dersAdi)) return [9, 12];
  if (/ORTAOKUL/i.test(dersAdi)) return [5, 8];
  if (/İLKOKUL/i.test(dersAdi)) return [1, 4];
  if (/OKUL ÖNCESİ/i.test(dersAdi)) return [0, 0];
  if (/TEMEL EĞİTİM/i.test(dersAdi)) return [1, 8];
  return null;
}

// Ders için verilen bir sınıf değerinin geçerli olup olmadığını kontrol et
export function sinifAraligaUygun(dersAdi, sinif) {
  const ar = sinifAraligi(dersAdi);
  return !ar || (sinif >= ar[0] && sinif <= ar[1]);
}

// Ders adını temizle: kademe/parantez artıklarını at, okunaklı bırak.
// Ör: "ORTAÖĞRETİM MANTIK DERSİ (2026)" -> "Mantık"; "İLKOKUL MATEMATİK DERSİ (1-4) (2026)" -> "Matematik"
export function dersAdiTemizle(dersAdi) {
  let d = dersAdi.replace(/^\[TYMM\]\s*/i, "");
  const orj = d;
  // TYMM öğretim programı ortak metni / özel başlıklar
  if (/\bORTAK METNİ\b/i.test(d)) return d.trim();
  d = d.replace(/\(.*?\)/g, "");            // parantezleri (tümünü) at
  d = d.replace(/ÖĞRETİM PROGRAMI/gi, "");
  d = d.replace(/\bDERSİ\b/gi, "");
  d = d.replace(/\bDERS\b/gi, "");
  // Baştaki kademe kelimelerini at (ORTAÖĞRETİM, İLKOKUL, ORTAOKUL, LİSE, TEMEL EĞİTİM ...)
  d = d.replace(/^(ORTAÖĞRETİM|İLKOKUL|ORTAOKUL|LİSE|TEMEL EĞİTİM|HAZIRLIK|SPOR LİSELERİ|SL)\s+/i, "");
  d = d.replace(/\s+/g, " ").trim();
  // Boşu boşuna düşmesin: eğer çok kısaldıysa orijinali döndür
  if (d.length < 3) return orj.trim();
  return d.trim();
}

// Bir metindeki öğrenme çıktısı / kazanım kodlarını ve başlıklarını çıkar.
//
// Kod formu (çok parçalı kısaltma + 3 sayı):
//   YENİ (TYMM):  MBU.MU.1.1.1. Günlük hayatta ... toplayabilme   ("-ebilme/-abilme")
//   ESKİ:         MBU.MU 1.1.1. Evde ... örnekler verir.          (geniş zaman fiili)
// Süreç bileşenleri (a) b) c) ...) HİÇBİRİNE dahil edilmez.
export function parseOgrenmeCiktilari(text) {
  // PDF'te " | " hücre ayırıcıları ve kırılımlar vardır; düz metne çevir
  const flat = text
    .replace(/\s*\|/g, " ")
    .replace(/\|\s*/g, " ")
    .replace(/\s+/g, " ");

  // Kod: 1-5 harflik parçalardan oluşan kısaltma (nokta ile ayrılmış), sonra 2-4 sayısal parça.
  // Ör: MBU.MU.1.1.1. (3)  |  MAN.1.1. (2)  |  TAR.9.1.1. (3)
  const kodRe = /(?:[A-ZÇĞİÖŞÜ]{1,5})(?:\.[A-ZÇĞİÖŞÜ]{1,5})*\.\d{1,2}(?:\.\d{1,2}){1,3}\./;
  const re = /((?:[A-ZÇĞİÖŞÜ]{1,5})(?:\.[A-ZÇĞİÖŞÜ]{1,5})*\.\d{1,2}(?:\.\d{1,2}){1,3}\.)\s*([A-Za-zÀ-ž0-9ÇĞİÖŞÜçğıöşüÂâÎîÛû].{0,300}?)(?=\s+(?:(?:[abcçdefgğhıijklmnoöprsştuüvyz])\s*\)\s|(?:[A-ZÇĞİÖŞÜ]{1,5})(?:\.[A-ZÇĞİÖŞÜ]{1,5})*\.\d{1,2}(?:\.\d{1,2}){1,3}\.|İÇERİK ÇERÇEVESİ|ÖĞRENME ÖĞRETME UYGULAMALARI)|$)/g;

  const result = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(flat)) !== null) {
    const kod = m[1].replace(/\.$/, "");
    if (seen.has(kod)) continue;
    seen.add(kod);
    let baslik = m[2].replace(/\s+/g, " ").trim();
    // Süreç bileşeni başlangıcını temizle (a) b) c) ...)
    baslik = baslik.split(/\s+[abcçdefgğhıijklmnoöprsştuüvyz]\s*\)\s/)[0].trim();
    baslik = baslik.split(/İÇERİK ÇERÇEVESİ/)[0].trim();
    baslik = baslik.split(/ÖĞRENME ÖĞRETME UYGULAMALARI/)[0].trim();
    baslik = baslik.split(/ÖĞRENME KANITLARI/)[0].trim();
    // Başlık içinde ikinci bir kod kalırsa orada kes
    const ekKod = baslik.search(kodRe);
    if (ekKod > 0) baslik = baslik.slice(0, ekKod).trim();
    if (!baslik || baslik.length < 6) continue;

    // Kod sayıları: MBU.MU.1.1.1 -> [MBU,MU,1,1,1]
    const parts = kod.split(".");
    // Sayısal parçalar (son 3): [tema, s1, s2] ; sınıf adayı = ilk sayısal parça
    const sayilar = parts.filter((p) => /^\d+$/.test(p));
    // TYMM: MBU.MU.1.1.1 -> sayilar = [1,1,1]; ünite = ilk sayı
    const uniteNo = sayilar[0] || "1";
    result.push({ kod, uniteNo, baslik, sayilar });
  }
  return result;
}

// local olarak indirilmiş bir PDF dosyasının metnini çıkarır
export async function pdfMetniniCikar(fileBytes) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.js");
  const doc = await getDocument({ data: new Uint8Array(fileBytes) }).promise;
  let out = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    out += tc.items.map((it) => it.str).join(" ") + "\n";
  }
  return out;
}

export async function pdfiIndirAndCikar(pdfUrl) {
  const res = await fetch(pdfUrl);
  if (!res.ok) throw new Error(`PDF HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return await pdfMetniniCikar(buf);
}

export function readFileBytes(p) {
  return readFileSync(p);
}