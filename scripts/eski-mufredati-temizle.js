// ============================================================
// OtoNot — scripts/eski-mufredati-temizle.js
// Eski (Klasik / TYMM olmayan) müfredat kayıtlarını Supabase'den siler.
//
// KURAL:
//   - Kaynak sütunu 'MEB' olan = eski müfredat (TYMM olmayan).
//   - Kaynak sütunu 'MEB-TYMM' olan = yeni müfredat -> SİLİNMEZ.
//
// NE ZAMAN?
//   Kullanıcı kararı: bu sene 4, 8 ve 12. sınıflarda hâlâ eski müfredat
//   uygulanıyor; bu yüzden eski kayıtlar bilerek korunur.
//   SENEYE (tamamen TYMM'ye geçildiğinde) bu script çalıştırılıp eski müfredat
//   temizlenir. GitHub Actions workflow'unda SIL_ESKI_MUFREDAT=true yapılınca
//   otomatik devreye girer.
//
// Kullanım:
//   node scripts/eski-mufredati-temizle.js
//   node scripts/eski-mufredati-temizle.js --dry  (sadetçe sayıyı göster, silme)
// ============================================================

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "..");

function loadEnv() {
  const envPath = path.join(rootDir, ".env");
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    process.env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
  }
}
loadEnv();

async function main() {
  const dry = process.argv.includes("--dry");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY .env içinde eksik.");
    process.exit(1);
  }
  const supabase = createClient(url, key);

  // Say (eski müfredat hariç TYMM korunur)
  const c = await supabase.from("kazanimlar").select("id", { count: "exact", head: true }).neq("kaynak", "MEB-TYMM");
  const hepsi = c.count || 0;
  const eski = await supabase.from("kazanimlar").select("id", { count: "exact", head: true }).eq("kaynak", "MEB");
  const sayi = eski.count || 0;

  console.log(`Kaynak 'MEB' (eski müfredat) kayıt sayısı: ${sayi}  (toplam kazanimlar: ${hepsi + sayi})`);

  if (dry) {
    console.log("--dry --: silinmedi (sayım yapıldı).");
    return;
  }

  const { error, count } = await supabase.from("kazanimlar").delete({ count: "exact" }).eq("kaynak", "MEB");
  if (error) {
    console.error("Silme hatası:", error.message);
    process.exit(1);
  }
  console.log(`Eski müfredat temizlendi: ${count ?? sayi} kayıt silindi. TYMM kayıtları korundu.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});