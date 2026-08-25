// ============================================================
// OtoNot — scripts/meb-lib.js
// MEB program PDF'lerini indirip içindeki öğrenme çıktılarını
// (kazanımları) çözmek için yardımcı fonksiyonlar.
// ============================================================
import { readFileSync } from "node:fs";

// Ders adından sınıf aralığını bul: "(1-4)", "(5-8)", "(9-12)" gibi
export function sinifFromDersAdi(dersAdi) {
  const m = dersAdi.match(/\((\d+\s*-\s*\d+)\)/);
  if (m) return m[1].replace(/\s+/g, "");
  // Sınıf aralığı verilmemişse genel kademe etiketi
  if (/ORTAÖĞRETİM|LİSE/i.test(dersAdi)) return "9-12";
  if (/TEMEL EĞİTİM/i.test(dersAdi)) return "1-8";
  if (/ORTAOKUL/i.test(dersAdi)) return "5-8";
  if (/İLKOKUL/i.test(dersAdi)) return "1-4";
  if (/OKUL ÖNCESİ/i.test(dersAdi)) return "0";
  return "";
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

// Bir metindeki öğrenme çıktısı kodlarını ve başlıklarını çıkar.
// TYMM formatı:  KISALTMA.UNITE.ÇIKTI  ->  MAN.1.1. Mantığı ... sorgulayabilme
export function parseOgrenmeCiktilari(text) {
  // PDF'te " | " hücre ayırıcıları ve " - " kırılımları vardır; düz metne çevir
  const flat = text
    .replace(/\s*\|/g, " ")
    .replace(/\|\s*/g, " ")
    .replace(/\s+/g, " ");

  const result = [];
  const seen = new Set();
  // Kod: 2-5 büyük harf, sonra ünite no, çıktı no (örn. MAN.1.1.)
  const kodRe = /[A-ZÇĞİÖŞÜ]{2,5}\.\d{1,2}\.\d{1,2}\./;
  const re = /([A-ZÇĞİÖŞÜ]{2,5}\.\d{1,2}\.\d{1,2}\.)\s*([A-Za-zÇĞİÖŞÜçğıöşü].{0,260}?)(?=\s+[A-ZÇĞİÖŞÜ]{2,5}\.\d{1,2}\.\d{1,2}\.|$)/g;
  let m;
  while ((m = re.exec(flat)) !== null) {
    const kod = m[1];
    if (seen.has(kod)) continue;
    seen.add(kod);
    let baslik = m[2].replace(/\s+/g, " ").trim();
    // İlk "a) " / "a ) " alt maddesinde ve açıklayıcı başlıklarda kes
    baslik = baslik.split(/\s+[abcçğ]\s*\)\s/)[0].trim();
    baslik = baslik.split(/İÇERİK ÇERÇEVESİ/)[0].trim();
    baslik = baslik.split(/ÖĞRENME ÖĞRETME UYGULAMALARI/)[0].trim();
    if (!baslik || baslik.length < 8) continue;
    // Başlık içinde ikinci bir öğrenme çıktısı kodu kalırsa orada da kes
    const ekKod = baslik.search(kodRe);
    if (ekKod > 0) baslik = baslik.slice(0, ekKod).trim();
    if (!baslik) continue;
    // Ünite numarası: kod MAN.1.1 -> 1
    const parca = kod.split(".");
    const uniteNo = parca[1];
    result.push({ kod: kod.replace(/\.$/, ""), uniteNo, baslik });
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