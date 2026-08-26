// ============================================================
// OtoNot — scripts/meb-lib.js
// MEB program PDF'lerini indirip içindeki öğrenme çıktılarını
// (kazanımları) çözmek için yardımcı fonksiyonlar.
//
// HEDEF ŞABLON (her satır) — collect-meb.js bu şablonu üretir:
//   kademe; kategori; ders; unite; kazanim; puan
//   kademe  = İlkokul | Ortaokul | İHO | Lise | Spor Lisesi |
//             Güzel Sanatlar Lisesi | Meslek Lisesi   (DB'de `sinif` sütunu)
//   kategori= Ortak Ders | Seçmeli Ders
//   unite   = "9. Sınıf 1. Tema: YAŞAM"  (TYMM'de bölüm adı "tema" ya da "ünite")
//   kazanim = "BİY.9.1.1 Biyolojideki dönüm noktalarını ... sorgulayabilme"
//   puan    = 10
// ============================================================
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

// Seçmeli dersler: adında "SEÇMELİ" geçmeyen ama ortaokul/temel eğitimde
// seçmeli olarak okutulan dersler. Envanterin `secmeli` alanı yanlış üretilmiş
// olabileceğinden, kategori kararında ad-bazlı bu liste de kullanılır.
const SECMELI_DERS_LISTESI = [
  "matematik uygulamaları", "matematik ve bilim uygulamaları",
  "okuma becerileri", "yazarlık ve yazma becerileri",
  "yaşayan diller ve lehçeler", "çevre eğitimi ve iklim değişikliği", "çevre eğitimi",
  "hukuk ve adalet", "düşünme eğitimi", "robotik kodlama", "yapay zekâ", "yapay zek",
  "proje tasarımı ve uygulamaları", "okul temelli sosyal sorumluluk",
  "medya okuryazarlığı", "afet bilinci", "temel yaşam becerileri",
  "türk sosyal hayatında aile", "peygamberimizin hayatı",
  "kültür ve medeniyetimize yön verenler", "ahlak ve vatandaşlık eğitimi",
  "görgü kuralları ve nezaket", "masal ve destanlarımız", "geleneksel sanatlar",
  "dijital sanatlar", "oyun ve oyun etkinlikleri", "trafik güvenliği",
  "insan hakları vatandaşlık ve demokrasi", "halk oyunları",
];

// Bir ders adının seçmeli olup olmadığını belirler (adi bazlı).
export function isSecmeliDers(dersAdi) {
  const ust = String(dersAdi || "").toLocaleUpperCase("tr-TR");
  if (ust.includes("SEÇMELİ") || ust.includes("SECMELI")) return true;
  const kup = String(dersAdi || "").toLocaleLowerCase("tr-TR");
  return SECMELI_DERS_LISTESI.some((s) => kup.includes(s));
}

// Ders adından sınıf ARALIĞINI bul: "(1-4)", "(5-8)", "(9-12)", "(4. Sınıf)" ...
export function sinifAraligi(dersAdi) {
  const m = dersAdi.match(/\((\d{1,2})\s*-\s*(\d{1,2})\)/);
  if (m) return [parseInt(m[1], 10), parseInt(m[2], 10)];
  const t = dersAdi.match(/\((\d{1,2})\.\s*SINIF\)/i);
  if (t) return [parseInt(t[1], 10), parseInt(t[1], 10)];
  if (/ORTAÖĞRETİM|LİSE|İMAM HATİP/i.test(dersAdi)) return [9, 12];
  if (/ORTAOKUL/i.test(dersAdi)) return [5, 8];
  if (/İLKOKUL/i.test(dersAdi)) return [1, 4];
  if (/OKUL ÖNCESİ/i.test(dersAdi)) return [0, 0];
  if (/TEMEL EĞİTİM/i.test(dersAdi)) return [1, 8];
  return null;
}

export function sinifAraligaUygun(dersAdi, sinif) {
  const ar = sinifAraligi(dersAdi);
  return !ar || (sinif >= ar[0] && sinif <= ar[1]);
}

// Ders adından yılı çıkar: "(2026)" -> 2026 (birden çoksa en yükseği)
export function yilCikar(dersAdi) {
  const ys = [...String(dersAdi).matchAll(/\((\d{4})\)/g)].map((m) => +m[1]);
  return ys.length ? Math.max(...ys) : null;
}

// Aynı dersin farklı yıl sürümlerini gruplamak için kullanılan çekirdek ad
// ("BİYOLOJİ DERSİ (9-12) (2026)" ve "(... 2024)" aynı çekirdeğe düşer)
export function dersCekirdegi(dersAdi) {
  return String(dersAdi)
    .replace(/^\[TYMM\]\s*/i, "")
    .replace(/\(\d{4}\)/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleUpperCase("tr-TR");
}

// Envanterden YALNIZCA TYMM + PDF adresi olan programları seçer ve aynı
// dersin (çekirdek adı aynı) birden çok yıl sürümü varsa EN GÜNCEL YILI tutar.
//   -> { dersler, atlanan }   (Klasik/eski müfredat AYRICA ve BİLEREK dahil edilmez)
export function enGuncelProgramlari(programlar) {
  const tymm = (programlar || []).filter((p) => p.kademe === "TYMM" && p.pdf);
  const gruplar = new Map();
  for (const p of tymm) {
    const key = dersCekirdegi(p.ders);
    if (!gruplar.has(key)) gruplar.set(key, []);
    gruplar.get(key).push(p);
  }
  const dersler = [];
  const atlanan = [];
  for (const g of gruplar.values()) {
    const yillilar = g.filter((p) => yilCikar(p.ders) != null);
    let sec;
    if (yillilar.length) {
      sec = yillilar.reduce((a, b) => (yilCikar(b.ders) > yilCikar(a.ders) ? b : a));
    } else {
      sec = g[0];
    }
    dersler.push(sec);
    for (const p of g) if (p !== sec) atlanan.push(p);
  }
  return { dersler, atlanan };
}

// Kategori: kullanıcı şablonu yalnızca "Ortak Ders" / "Seçmeli Ders" kabul eder.
export function kategoriBelirle(prog) {
  const secmeli = (prog && prog.secmeli) || isSecmeliDers(prog && prog.ders);
  return secmeli ? "Seçmeli Ders" : "Ortak Ders";
}

function sinifKademe(sinif) {
  if (sinif == null) return null;
  if (sinif <= 4) return "İlkokul";
  if (sinif <= 8) return "Ortaokul";
  return "Lise";
}

// Bir programı kullanıcının 7 kademe etiketinden birine eşler.
// `sinif` verilirse (TYMM çıktısının sınıfı) geçiş aralıklı derslerde
// doğru kademe seçilir (örn. "(4-8)": 4 -> İlkokul, 5-8 -> Ortaokul).
// Belirsiz/desteklenmeyen gruplarda null döner (collect bunları atlar, raporlar).
export function kademeBelirle(prog, sinif) {
  const K = (prog.kategori || "").toLocaleLowerCase("tr-TR");
  const ad = String(prog.ders || "").toLocaleUpperCase("tr-TR");

  if (K.includes("imam hatip")) return "İHO";
  if (K.includes("güzel sanatlar")) return "Güzel Sanatlar Lisesi";
  if (K.includes("spor lises")) return "Spor Lisesi";

  // Kullanıcının 7 kademe listesine doğrudan uymayan gruplar -> rapora
  if (
    K.includes("müzik okulları") ||
    K.includes("spor ortaokulları") ||
    K.includes("özel eğitim") ||
    K.includes("okul öncesi")
  ) {
    return null;
  }

  if (K.includes("ortaokul") || K.includes("temel eğitim")) {
    if (sinif != null && sinif !== "SINIF?") return sinifKademe(+sinif);
    const ar = sinifAraligi(ad);
    if (ar) {
      if (ar[1] <= 4) return "İlkokul";
      if (ar[0] >= 9) return "Lise";
      if (ar[0] === ar[1]) return sinifKademe(ar[0]);
    }
    return null;
  }
  if (K.includes("ortaöğretim")) {
    return /MESLEK/.test(ad) ? "Meslek Lisesi" : "Lise";
  }

  const ar = sinifAraligi(ad);
  if (ar) {
    if (ar[1] <= 4) return "İlkokul";
    if (ar[0] >= 9) return "Lise";
    return "Ortaokul";
  }
  return null;
}

// Ders adını temizle: kademe/parantez/yıl artıklarını at, okunaklı bırak.
//   "ORTAÖĞRETİM DİN KÜLTÜRÜ VE AHLAK BİLGİSİ DERSİ (9-12) (2026)" -> "Din Kültürü ve Ahlak Bilgisi"
export function dersAdiTemizle(dersAdi) {
  let d = String(dersAdi).replace(/^\[TYMM\]\s*/i, "");
  const orj = d;
  if (/\bORTAK METNİ\b/i.test(d)) return d.trim();
  d = d.replace(/\(.*?\)/g, ""); // parantezleri (yıl, sınıf aralığı ...) at
  d = d.replace(/ÖĞRETİM PROGRAMI/gi, "");
  // DERSİ / DERS kelime sonunu sil. DİKKAT: \b Türkçe İ/ı'yı kelime saymadığı
  // için boşluk sınırlı regex kullanıyoruz (aksi halde "BİYOLOJİ İ" kalırdı).
  d = d.replace(/\s+DERSİ(?=\s|$)/gi, " ");
  d = d.replace(/\s+DERS(?=\s|$)/gi, " ");
  d = d.replace(
    /^(ORTAÖĞRETİM|İLKOKUL|ORTAOKUL|LİSE|TEMEL EĞİTİM|HAZIRLIK|SPOR LİSESİ|SPOR LİSELERİ|GÜZEL SANATLAR LİSESİ|SL)\s+/i,
    ""
  );
  d = d.replace(/\s+/g, " ").trim();
  if (d.length < 3) return orj.trim();
  return d.trim();
}

// PDF'teki bölüm (TEMA/ÜNİTE) başlıklarını sırayla toplar.
// "1. TEMA YAŞAM Bu temanın ..." / "2. ÜNİTE NAMAZ Bu ünitede ..." -> {no, kelime, ad}
// "Bu ..." açıklaması olmayan eşleşmeler (içindekiler/tablo sahteleri) elenir.
export function bolumHaritasiCikar(flat) {
  // Bölüm başlığı "N. TEMA <Ad> Bu ..." / "N. ÜNİTE <Ad> Bu ..." biçimindedir.
  // Ad, "Bu" açıklamasına kadar (birden çok kelime) alınır; "Bu" şartı
  // içindekiler/tablo sahtelerini eler.
  const re =
    /(\d{1,2})\s*\.\s*(TEMA|ÜNİTE)\s*[:–.\-]?\s*([A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğıöşüÂâ0-9'’\- ]{1,70}?)(?=\s+Bu\s+(?:temanın|ünitede|bölümde|ünitelerde))/gi;
  const list = [];
  let m;
  while ((m = re.exec(flat)) !== null) {
    const ad = m[3].replace(/\s+/g, " ").trim();
    if (!ad) continue;
    list.push({ no: +m[1], kelime: m[2].trim(), ad });
  }
  // Ardışık tekrarları (bazı PDF'lerde aynı başlık iki kez) tekle; sıra korunur.
  const tek = [];
  for (const b of list) {
    const son = tek[tek.length - 1];
    if (son && son.no === b.no && son.kelime === b.kelime && son.ad === b.ad) continue;
    tek.push(b);
  }
  return tek;
}

// Kod formu (TYMM): <DERS>.<sınıf>.<tema|ünite>.<çıktı>
//   "BİY.9.1.1. Biyolojideki ... sorgulayabilme"
//   "DKAB.4.1.1. Günlük hayatta ... ayırt edebilme"
// Süreç bileşenleri (a) b) c) ...) ve açıklamalar HİÇBİRİNE dahil edilmez.
// Sadece ana öğrenme çıktıları döndürülür; her biri sınıf/bölüm adı ile zenginleştirilir.
export function parseOgrenmeCiktilari(text) {
  const flat = text.replace(/\s*\|\s*/g, " ").replace(/\s+/g, " ");
  const bolumler = bolumHaritasiCikar(flat);

  const kodRe = /(?:[A-ZÇĞİÖŞÜ]{1,5})(?:\.[A-ZÇĞİÖŞÜ]{1,5})*\.\d{1,2}(?:\.\d{1,2}){1,3}\./;
  const re =
    /((?:[A-ZÇĞİÖŞÜ]{1,5})(?:\.[A-ZÇĞİÖŞÜ]{1,5})*\.\d{1,2}(?:\.\d{1,2}){1,3}\.)\s*([A-Za-zÀ-ž0-9ÇĞİÖŞÜçğıöşüÂâÎîÛû].{0,300}?)(?=\s+(?:(?:[abcçdefgğhıijklmnoöprsştuüvyz])\s*\)\s|(?:[A-ZÇĞİÖŞÜ]{1,5})(?:\.[A-ZÇĞİÖŞÜ]{1,5})*\.\d{1,2}(?:\.\d{1,2}){1,3}\.|İÇERİK ÇERÇEVESİ|ÖĞRENME ÖĞRETME UYGULAMALARI)|$)/g;

  const result = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(flat)) !== null) {
    const kod = m[1].replace(/\.$/, "");
    const parts = kod.split(".");
    const sayilar = parts.filter((p) => /^\d+$/.test(p)).map((p) => parseInt(p, 10));
    // Ana öğrenme çıktısı gereği en az 3 sayısal parça (sınıf.bölüm.çıktı).
    // İki parçalı eşleşmeler (örn. "BİY.9.1") tema/ünite etiketi olup atlanır.
    if (sayilar.length < 3) continue;
    if (seen.has(kod)) continue;
    seen.add(kod);

    let baslik = m[2].replace(/\s+/g, " ").trim();
    baslik = baslik.split(/\s+[abcçdefgğhıijklmnoöprsştuüvyz]\s*\)\s/)[0].trim();
    baslik = baslik.split(/İÇERİK ÇERÇEVESİ/)[0].trim();
    baslik = baslik.split(/ÖĞRENME ÖĞRETME UYGULAMALARI/)[0].trim();
    baslik = baslik.split(/ÖĞRENME KANITLARI/)[0].trim();
    const ekKod = baslik.search(kodRe);
    if (ekKod > 0) baslik = baslik.slice(0, ekKod).trim();
    if (!baslik || baslik.length < 6) continue;

    const sinif = sayilar[0];
    const bolumNo = sayilar[1] || 1;
    result.push({ kod, sinif, bolumNo, sayilar, baslik });
  }

  // Bölüm adlarını, çıktıların sırasındaki benzersiz (sınıf,bölüm) kombinasyonları
  // ile birebir eşleştir (her sınıfta bölümler 1'den yeniden başlar).
  const combos = [];
  const seenCombo = new Set();
  for (const o of result) {
    const key = o.sinif + "-" + o.bolumNo;
    if (!seenCombo.has(key)) {
      seenCombo.add(key);
      combos.push(key);
    }
  }
  const adOf = new Map();
  combos.forEach((key, i) => {
    const b = bolumler[i];
    adOf.set(key, b ? { kelime: b.kelime, ad: b.ad } : null);
  });

  for (const o of result) {
    const b = adOf.get(o.sinif + "-" + o.bolumNo);
    const kelime = b && b.kelime ? b.kelime : "ÜNİTE";
    const ad = b && b.ad ? b.ad : "";
    o.bolumKelime = kelime;
    o.bolumAdi = ad;
    // "9. Sınıf 1. Tema: YAŞAM"  |  "4. Sınıf 1. Ünite: GÜNLÜK HAYAT VE DİN"
    o.unite = `${o.sinif}. Sınıf ${o.bolumNo}. ${kelime}${ad ? ": " + ad : ""}`;
  }
  return result;
}

// Kazanım metninin md5'i — unique indeks (sinif,kategori,ders,unite,kazanim_hash) için.
export function kazanimHash(kod, baslik) {
  return createHash("md5").update(`${kod} ${baslik}`).digest("hex");
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