// ============================================================
// OtoNot — scripts/seed-from-csv.js
// Google Sheets / Excel'den dışa aktarılan veriyi Supabase'e taşır.
//
// Beklenen CSV/TSV sütunları (başlık satırı opsiyoneldir):
//   sinif | kategori | ders | kazanim | puan (isteğe bağlı) | unite (isteğe bağlı)
//
// Kullanım:
//   1) Sheets tablonuzu "Dosya -> İndir -> CSV" ile export edip
//      `data/kazanimlar.csv` (veya .tsv) olarak kaydedin.
//   2) `.env` içine SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY yazın.
//   3)   npm run seed            (varsayılan: data/kazanimlar.csv)
//   4)   npm run seed -- data/dosyam.tsv
// ============================================================

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");

// ---------- Minimal .env yükleyici (dotenv bağımlılığı olmadan) ----------
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

// Kolaylaştırılmış CSV ayrıştırıcı (virgül veya tab ayırıcıyı otomatik algılar).
function parseDelimited(text) {
  const sep = text.includes("\t") ? "\t" : ",";
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === sep) {
      row.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = []; field = "";
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

function detectColumns(rows) {
  const header = rows[0].map((h) => h.toLowerCase().trim());
  const isHeader = header.some((h) =>
    ["sinif", "sınıf", "kategori", "ders", "kazanim", "kazanım", "unite", "ünite", "puan"].includes(h)
  );
  if (!isHeader) return { cols: { sinif:0, kategori:1, ders:2, kazanim:3, puan:4, unite:-1 }, hasHeader: isHeader };

  const idx = { sinif:-1, kategori:-1, ders:-1, kazanim:-1, puan:-1, unite:-1 };
  header.forEach((h, i) => {
    if (h.startsWith("sinif")) idx.sinif = i;
    else if (h.startsWith("sınıf")) idx.sinif = i;
    else if (h.startsWith("kategori")) idx.kategori = i;
    else if (h.startsWith("ders")) idx.ders = i;
    else if (h.startsWith("kazan")) idx.kazanim = i;
    else if (h.startsWith("unite")) idx.unite = i;
    else if (h.startsWith("ünite")) idx.unite = i;
    else if (h.startsWith("puan")) idx.puan = i;
  });
  return { cols: idx, hasHeader: true };
}

async function main() {
  const arg = process.argv[2] || path.join(rootDir, "data", "kazanimlar.csv");
  if (!existsSync(arg)) {
    console.error(`Dosya bulunamadı: ${arg}`);
    console.error("Lütfen Sheets/Excel verinizi CSV olarak dışa aktarıp data/kazanimlar.csv olarak koyun.");
    process.exit(1);
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY .env içinde eksik.");
    process.exit(1);
  }

  const text = readFileSync(arg, "utf8");
  const rows = parseDelimited(text);
  if (rows.length === 0) {
    console.error("Veri bulunamadı.");
    process.exit(1);
  }

  const { cols, hasHeader } = detectColumns(rows);
  const startRow = hasHeader ? 1 : 0;

  const supabase = createClient(url, key);
  const records = [];
  let skipped = 0;

  for (let i = startRow; i < rows.length; i++) {
    const r = rows[i];
    const sinif = (r[cols.sinif] ?? "").trim();
    const kategori = (r[cols.kategori] ?? "").trim();
    const ders = (r[cols.ders] ?? "").trim();
    const kazanim = (r[cols.kazanim] ?? "").trim();
    if (!sinif || !ders || !kazanim) { skipped++; continue; }
    const puanRaw = cols.puan >= 0 ? (r[cols.puan] ?? "").trim() : "";
    const puan = puanRaw ? parseInt(puanRaw, 10) || 10 : 10;
    const unite = cols.unite >= 0 ? (r[cols.unite] ?? "").trim() : "";
    records.push({ sinif, kategori, ders, unite, kazanim, puan_varsayilan: puan, kaynak: "MEB", kaynak_url: "" });
  }

  if (records.length === 0) {
    console.error("Aktarılacak geçerli satır bulunamadı.");
    process.exit(1);
  }

  // Upsert: tekrar eden unik anahtarlı satırları günceller, yenileri ekler
  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < records.length; i += BATCH) {
    const chunk = records.slice(i, i + BATCH);
    const { error } = await supabase
      .from("kazanimlar")
      .upsert(chunk, { onConflict: "sinif,kategori,ders,unite,kazanim", ignoreDuplicates: false });
    if (error) {
      console.error("Upsert hatası:", error.message);
      process.exit(1);
    }
    inserted += chunk.length;
  }

  console.log(`Tamamlandı. Aktif kayıt: ${records.length} (atlanan boş satır: ${skipped}). İlk paket ile eklendiler/güncellendiler.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});