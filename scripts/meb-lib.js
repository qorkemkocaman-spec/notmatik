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
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

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

// ---- Çizelge DB (ders -> sınıflar) fallback yardımcıları ----
// TTKB çizelgelerinden üretilen data/cizelge_ders_db.json, sınıfı koddan
// çıkmayan 2-segmentli dersler (ör. ÇEVRE, HALK) için kademe tespitini sağlar.
let _cizelgeDb = null;
function cizelgeDb() {
  if (_cizelgeDb) return _cizelgeDb;
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const p = path.join(__dirname, "..", "data", "cizelge_ders_db.json");
  _cizelgeDb = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
  return _cizelgeDb;
}

// Ders adını eşleştirme için normalize eder: "DERSİ", yıl, parantezleri atar.
function adCekirdek(ad) {
  return String(ad || "")
    .toLocaleLowerCase("tr-TR")
    .replace(/\bdersi\b/gi, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/öğretim programı/gi, "")
    .replace(/[^a-zçğıöşü0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Normalize edilmiş iki ders çekirdeği arasındaki EŞLEŞME SKORU.
//   * tam eşitlik          -> çok yüksek (aynı ders)
//   * hedef, çizelge adını içeriyor -> yüksek (en yaygın: envanter adı uzun, çizelge adı kısa)
//   * tersi (çizelge adı hedefi içeriyor) -> düşük (zayıf; "Ritim ve HALK OYUNLARI" gibi yanlış eşleşmeyi ayıklar)
function cizelgeSkor(hedef, kc) {
  if (!hedef || !kc) return 0;
  if (kc === hedef) return 10000;
  if (hedef.includes(kc)) return 5000 + kc.length;
  if (kc.includes(hedef)) return kc.length;
  return 0;
}

// ders çekirdeği -> { kaynak, siniflar } eşleşmesini tüm çizelge kaynaklarından bulur.
function cizelgeSiniflari(dersAdi) {
  const db = cizelgeDb();
  if (!db) return null;
  const hedef = adCekirdek(dersAdi);
  let enIyi = null;
  let enSkor = 0;
  for (const [kaynakId, kaynak] of Object.entries(db.kaynaklar || {})) {
    for (const [kayitAd, siniflar] of Object.entries(kaynak.ders || {})) {
      if (!siniflar || !siniflar.length) continue;
      const skor = cizelgeSkor(hedef, adCekirdek(kayitAd));
      if (skor >= 5 && skor > enSkor) { enSkor = skor; enIyi = { kaynak: kaynakId, siniflar }; }
    }
  }
  return enIyi;
}

// ders çekirdeği -> eşleşen TÜM çizelge kaynaklarını (skor azalan) döndürür.
function cizelgeKaynaklari(dersAdi) {
  const db = cizelgeDb();
  if (!db) return [];
  const hedef = adCekirdek(dersAdi);
  const sonuc = [];
  for (const [kaynakId, kaynak] of Object.entries(db.kaynaklar || {})) {
    for (const [kayitAd, siniflar] of Object.entries(kaynak.ders || {})) {
      if (!siniflar || !siniflar.length) continue;
      const skor = cizelgeSkor(hedef, adCekirdek(kayitAd));
      if (skor >= 5) sonuc.push({ kaynak: kaynakId, siniflar, skor });
    }
  }
  sonuc.sort((a, b) => b.skor - a.skor);
  return sonuc;
}

// Çizelge sınıflarına göre kademe bandı.
export function kademeFromSiniflar(siniflar) {
  if (!siniflar || !siniflar.length) return null;
  const mn = Math.min(...siniflar);
  const mx = Math.max(...siniflar);
  if (mx >= 9) return "Lise";
  if (mx <= 4) return "İlkokul";
  return "Ortaokul";
}

// Ders adı -> çizelge sınıfları -> kademe fallback'i.
export function cizelgeKademe(dersAdi) {
  const e = cizelgeSiniflari(dersAdi);
  if (!e) return null;
  return kademeFromSiniflar(e.siniflar);
}

// TTKB çizelge kaynak id'si -> okul türü adı (kullanıcı dostu, standart).
export const OKUL_TURU_ADI = {
  ilkogretim: "İlkokul-Ortaokul",
  "imamhatip-ortaokul": "İmam Hatip Ortaokulu",
  "anadolu-fen-sosyal": "Anadolu/Fen/Sosyal Lisesi",
  imamhatip_lise: "Anadolu İmam Hatip Lisesi",
  spor_lise: "Spor Lisesi",
  fen_lise: "Fen Lisesi",
  gsl_muzik: "Güzel Sanatlar Lisesi",
};

// Bir programın TTKB okul türünü belirler (kademe BANDINDAN ayrı, tek değer).
//   - özel programlı kategoriler (İmam Hatip, GSL, Spor Lisesi, Meslek vb.) doğrudan
//   - genel derslerde çizelge DB'sinden kaynağın okul türü
//   - bulunamazsa kademe bandı adına düşer ("İlkokul"/"Ortaokul"/"Lise")
export function okulTuruBelirle(prog) {
  const K = (prog.kategori || "").toLocaleLowerCase("tr-TR");
  const ad = String(prog.ders || "");

  if (K.includes("imam hatip")) {
    const ar = sinifAraligi(ad);
    const lise = ar && ar[0] >= 9;
    return lise ? "Anadolu İmam Hatip Lisesi" : "İmam Hatip Ortaokulu";
  }
  if (K.includes("güzel sanatlar")) return "Güzel Sanatlar Lisesi";
  if (K.includes("spor lise")) return "Spor Lisesi";
  if (K.includes("müzik okul")) return "Güzel Sanatlar Lisesi (Müzik)";
  if (K.includes("spor ortaokul")) return "Spor Ortaokulu";
  if (K.includes("özel eğitim")) return "Özel Eğitim";

  // Genel derslerde çizelge DB kaynağından okul türü.
  // Ders birden çok çizelgede okutuluyorsa (örn. HALK hem normal hem İHO ortaokulda)
  // kademe BANDINA uyan kaynağı yeğle; yoksa en yüksek skorlu kaynak.
  const kad = kademeBelirle(prog, null);
  const adaylar = cizelgeKaynaklari(ad);
  if (adaylar.length) {
    const uygun = adaylar.find((a) => kademeFromSiniflar(a.siniflar) === kad);
    const sec = uygun || adaylar[0];
    if (OKUL_TURU_ADI[sec.kaynak]) return OKUL_TURU_ADI[sec.kaynak];
  }

  if (kad === "İlkokul" || kad === "Ortaokul" || kad === "Lise" || kad === "İHO") return kad;
  return null;
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

// Sınıf ARALIĞINDAN tek bir kademe seçer:
//   (1-4)/(1-3) -> İlkokul, (9-12)/(11-12) -> Lise,
//   dar/net (5-5) -> sınıf kademesi, geçiş aralıklı (1-8, 2-8, 3-8, 5-8) -> orta noktaya göre.
export function aralikKademe(ar) {
  if (!ar || !ar.length) return null;
  if (ar[1] <= 4) return "İlkokul";
  if (ar[0] >= 9) return "Lise";
  if (ar[0] === ar[1]) return sinifKademe(ar[0]);
  const mid = (ar[0] + ar[1]) / 2;
  return mid >= 5 ? "Ortaokul" : "İlkokul";
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
  if (K.includes("spor lise")) return "Spor Lisesi";

  // Kullanıcının 7 kademe listesine doğrudan uymayan gruplar -> rapora.
  // NOT: "müzik okulları" burada elenmez; o kategori (1-8)/(3-4)/(5-8) aralıklı genel
  // müzik derslerini (Bireysel Ses, Bireysel Çalgı, Koro, Müzik Kültürü ...) temsil eder
  // ve aşağıdaki aralık/sınıf mantığıyla kademeye düşülür.
  if (
    K.includes("spor ortaokulları") ||
    K.includes("özel eğitim") ||
    K.includes("okul öncesi")
  ) {
    return null;
  }

  if (K.includes("ortaokul") || K.includes("temel eğitim") || K.includes("müzik okulları")) {
    if (sinif != null && sinif !== "SINIF?") return sinifKademe(+sinif);
    const ar = sinifAraligi(ad);
    if (ar) return aralikKademe(ar);
    // Sınıfı koddan çıkmayan (2 segmentli) seçmeli/temel derslerde çizelge DB'sine bak.
    const cz = cizelgeKademe(prog.ders);
    return cz || null;
  }
  if (K.includes("ortaöğretim")) {
    return /MESLEK/.test(ad) ? "Meslek Lisesi" : "Lise";
  }

  const ar = sinifAraligi(ad);
  if (ar) return aralikKademe(ar);
  const cz = cizelgeKademe(prog.ders);
  return cz || null;
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
// TYMM Ortak Metni / çizelge bileşen kod önekleri. Bunlar öğrenme çıktısı DEĞİLDİR
// (alan becerisi SBAB/DAB/YDAB, kavramsal beceri KB, sosyal-duygusal beceri SDB,
// okuryazarlık becerisi OB, eğilim E, değer D ...). Kod regex'i bunları da yakalayabildiğinden
// (özellikle bitişik önekli formatlarda "SDB2.1.2." -> "SDB.2.1.2.") kara listeyle elenir.
const BILESEN_ON_EKLERI = new Set([
  "SDB", "KB", "SBAB", "DAB", "YDAB", "OB", "E", "D", "F", "B",
]);

export function parseOgrenmeCiktilari(text) {
  const flatRaw = text.replace(/\s*\|\s*/g, " ").replace(/\s+/g, " ");
  // Bitişik önek-kod formatı desteği: bazı derslerde "TDE1.1.1.", "RK2.4.1.",
  // "DİH1.2." biçiminde önek ile ilk hane bitişik yazılmış. Bunları ayır ki
  // gerçek öğrenme çıktıları da yakalanabilsin.
  const flat = flatRaw.replace(/([A-ZÇĞİÖŞÜÂÎÛ]{1,6})(\d{1,2}(?:\.\d{1,2}){1,3}\.)/g, "$1.$2");
  const bolumler = bolumHaritasiCikar(flat);

  const kodRe = /(?:[A-ZÇĞİÖŞÜ]{1,5})(?:\.[A-ZÇĞİÖŞÜ]{1,5})*\.\d{1,2}(?:\.\d{1,2}){1,3}\./;
  // Süreç bileşeni durdurucu: hem "a)" hem " a." biçimini tanır (GÖRGÜ gibi derslerde "a.").
  const re =
    /((?:[A-ZÇĞİÖŞÜ]{1,5})(?:\.[A-ZÇĞİÖŞÜ]{1,5})*\.\d{1,2}(?:\.\d{1,2}){1,3}\.)\s*([A-Za-zÀ-ž0-9ÇĞİÖŞÜçğıöşüÂâÎîÛû].{0,300}?)(?=\s+(?:(?:[abcçdefgğhıijklmnoöprsştuüvyz])(?:\s*\)\s|\s*\.\s)|(?:[A-ZÇĞİÖŞÜ]{1,5})(?:\.[A-ZÇĞİÖŞÜ]{1,5})*\.\d{1,2}(?:\.\d{1,2}){1,3}\.|İÇERİK ÇERÇEVESİ|ÖĞRENME ÖĞRETME UYGULAMALARI)|$)/g;

  const candidates = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(flat)) !== null) {
    const kod = m[1].replace(/\.$/, "");
    const parts = kod.split(".");
    const sayilar = parts.filter((p) => /^\d+$/.test(p)).map((p) => parseInt(p, 10));
    // En az 2 sayısal parça iste (1 sayısal -> bölüm/ünite etiketi eşleşmesi, e.g. "BİY.9.").
    if (sayilar.length < 2) continue;
    // Alan becerisi/eğilim/değer kodlarını (SDB, KB, E, D ...) öğrenme çıktısı sanma.
    if (BILESEN_ON_EKLERI.has(parts[0])) continue;

    let baslik = m[2].replace(/\s+/g, " ").trim();
    baslik = baslik.split(/\s+[abcçdefgğhıijklmnoöprsştuüvyz](?:\s*\)\s|\s*\.\s)/)[0].trim();
    baslik = baslik.split(/İÇERİK ÇERÇEVESİ/)[0].trim();
    baslik = baslik.split(/ÖĞRENME ÖĞRETME UYGULAMALARI/)[0].trim();
    baslik = baslik.split(/ÖĞRENME KANITLARI/)[0].trim();
    const ekKod = baslik.search(kodRe);
    if (ekKod > 0) baslik = baslik.slice(0, ekKod).trim();
    if (!baslik || baslik.length < 6) continue;

    // seen kontrolü başlık doğrulamasından SONRA yapılır: içindekiler/tablo sahtelerinde
    // aynı kod "bozuk/kısa başlık" ile ilk görünür; onu seen'e ekleyip gerçek çıktıyı
    // engellememek için ancak geçerli bir başlık varsa kod tescillenir.
    if (seen.has(kod)) continue;
    seen.add(kod);

    candidates.push({ kod, sayilar, baslik });
  }

  // DOKÜMAN BAZINDA ŞEMA TESPİTİ:
  //  - 3 sayısal parçalı (sınıf.bölüm.çıktı, BİY.9.1.1) gerçek çıktı VARSA -> bu
  //    doküman 3 segmentlidir; 2 sayısal eşleşmeler (BİY.9.1) tema/ünite etiketidir.
  //  - Hiç 3 sayısal yoksa (ÇEVRE, İNG, HALK gibi) -> 2 sayısal (bölüm.çıktı) gerçektir.
  const has3 = candidates.some((c) => c.sayilar.length >= 3);
  const result = candidates
    .filter((c) => (has3 ? c.sayilar.length >= 3 : true))
    .map((c) => {
      // 3 segmentte sınıf + bölüm; 2 segmentte sadece bölüm (sınıf kodda yok -> null).
      const sinif = c.sayilar.length >= 3 ? c.sayilar[0] : null;
      const bolumNo = c.sayilar.length >= 3 ? (c.sayilar[1] || 1) : c.sayilar[0];
      return { kod: c.kod, sinif, bolumNo, sayilar: c.sayilar, baslik: c.baslik };
    });

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
    // 3 segmentli: "9. Sınıf 1. Tema: YAŞAM" | 2 segmentli (sınıf yok): "1. ÜNİTE: İNSAN VE DOĞA"
    const ek = ad ? ": " + ad : "";
    o.unite =
      o.sinif == null
        ? `${o.bolumNo}. ${kelime}${ek}`
        : `${o.sinif}. Sınıf ${o.bolumNo}. ${kelime}${ek}`;
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