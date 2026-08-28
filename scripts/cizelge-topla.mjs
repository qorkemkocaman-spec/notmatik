// ============================================================
// OtoNot — scripts/cizelge-topla.mjs
// TTKB haftalık ders çizelgesi PDF'lerini indirir; her çizelgeden
// "ders adı -> hangi sınıflarda (sütun) ve seçmeli mi" bilgisini
// çıkarır ve data/cizelge_dersler.json olarak kaydeder.
// ============================================================
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");
const BASE = "https://ttkb.meb.gov.tr";
const PDF_DIR = path.join(rootDir, "data", "cizelgeler");

// En güncel (2025-2026) çizelge PDF'lerini seç; her biri "kademe türü" etiketi taşır.
// Başlık, kayıt başlığından gelir.
const CIZELGELER = [
  { id: "ilkogretim", etiket: "İlköğretim (İlkokul+Ortaokul)",
    url: "/meb_iys_dosyalar/2025_05/16094742_4nolukararilkogretimkurumlariilkokulveortaokulhaftalikderscizelgesi.pdf" },
  { id: "imamhatip-ortaokul", etiket: "İmam Hatip Ortaokulu",
    url: "/meb_iys_dosyalar/2026_08/6a75b9682ece2122547513_2025-103_SAYILI_KARAR.pdf" },
  { id: "anadolu-fen-sosyal", etiket: "Anadolu Lis / Fen Lisesi / Sosyal",
    url: "/meb_iys_dosyalar/2025_05/20144001_202505.pdf" },
  { id: "imamhatip_lise", etiket: "Anadolu İmam Hatip Lisesi",
    url: "/meb_iys_dosyalar/2025_08/05103624_202526.pdf" },
  { id: "spor_lise", etiket: "Spor Lisesi",
    url: "/meb_iys_dosyalar/2025_05/20144648_202509.pdf" },
  { id: "fen_lise", etiket: "Özel Prog Uygulayan Fen Lisesi",
    url: "/meb_iys_dosyalar/2025_08/05103529_202524.pdf" },
  { id: "gsl_muzik", etiket: "Güzel Sanatlar Lisesi Müzik",
    url: "/meb_iys_dosyalar/2025_05/20144526_202507.pdf" },
];

// PDF indir
async function indir(url, path) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("HTTP " + res.status + " " + url);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(path, buf);
  return buf;
}

// PDF metnini çıkar (pdfjs-dist)
async function pdfMetin(buf) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.js");
  const doc = await getDocument({ data: new Uint8Array(buf) }).promise;
  let out = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    out += "==PAGE " + i + "==\n" + tc.items.map((it) => it.str).join(" | ") + "\n";
  }
  return out;
}

async function main() {
  mkdirSync(PDF_DIR, { recursive: true });
  const sonuc = [];

  for (const c of CIZELGELER) {
    const pdfPath = path.join(PDF_DIR, c.id + ".pdf");
    let buf;
    try {
      if (!existsSync(pdfPath)) buf = await indir(BASE + c.url, pdfPath);
      else buf = readFileSync(pdfPath);
    } catch (e) {
      console.error("indirme hatası", c.id, e.message);
      continue;
    }
    const metin = await pdfMetin(buf);
    writeFileSync(path.join(PDF_DIR, c.id + ".txt"), metin, "utf8");
    sonuc.push({ id: c.id, etiket: c.etiket, sayfa_dosya: c.id + ".txt" });
    console.log("indirildi:", c.id, "len:", metin.length);
  }

  writeFileSync(path.join(rootDir, "data", "cizelge_listesi.json"), JSON.stringify(sonuc, null, 2), "utf8");
  console.log("cizelge_listesi.json yazildi");
}

main().catch((e) => { console.error(e); process.exit(1); });