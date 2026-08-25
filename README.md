# OtoNot (notmatik)

Eğitim otomasyonları — Sınav Analizi & Performans/Proje dağıtımı.
Vercel (serverless) + GitHub + Supabase (veri) ile çalışır.

## Özellikler
- **Sınav Analizi:** E-Okul Excel verisini içe aktar, sınav notunu sorulara organik dağıt, istatistik + grafikli PDF rapor üret.
- **Performans & Proje:** Ölçüt çizelgeleri, ödev/proje/uygulama formları, öğrenci bazlı proje formu.
- **Kazanım Havuzu:** MEB kazanım/öğrenme çıktıları Supabase'den ön uca gelir.

## Kazanım havuzu mimarisi
| Katman | Ne | Nerede |
|---|---|---|
| Arayüz | `index.html` — `/api/kazanimlar` çağırır | Vercel |
| API | `api/kazanimlar.js` — Supabase'den okur | Vercel serverless |
| Veri | Supabase (Postgres) `public.kazanimlar` tablosu | Supabase |
| Migration | `supabase/migrations/...sql` | SQL Editor'da çalıştır |
| Seed | `scripts/seed-from-csv.js` — Sheets/Excel→DB | yerel |

**Güvenlik:** Anon/public okuma RLS ile kapalıdır; veri isticmine ham düşmez, yalnızca sunucu API üzerinden sunulur.

---

## Kurulum (ilk kez)

### 1) Supabase projesi oluştur
1. [supabase.com](https://supabase.com) üye ol + yeni proje başlat.
2. **Settings → API** bölümünden `Project URL` ve `service_role` (secret) anahtarını kopyala.
3. **SQL Editor** aç, `supabase/migrations/20260101000000_create_kazanimlar.sql` içeriğini yapıştır ve çalıştır (tablo + indeksler + RLS).

### 2) Ortam değişkenleri
Vercel project → **Settings → Environment Variables** ekle:
```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...service...role...
```
`.env`'yi **asla Git'e ekleme** (`.gitignore` tarafından gizli tutulur).

### 3) Veriyi taşı (migration / seed)
1. Google Sheets dışa aktar: **Dosya → İndir → CSV**, `data/kazanimlar.csv` olarak kaydet.
2. `.env` dosyasına `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` yaz.
3. Çalıştır:
   ```
   npm install
   npm run seed
   ```
   (Sütun sırası başlık satırından algılanır: `sinif, kategori, ders, kazanim[, puan, unite]`.)

### 4) Deploy
- Vercel'e GitHub repo'yu bağla. `api/` otomatik serverless function olarak algılanır; `index.html` ana sayfa olur.
- Ortam değişkenlerini Vercel'e eklediğinden emin ol.

---

## MEB senkronizasyonu (otomatik, opsiyonel)
MEB (`mufredat.meb.gov.tr`) kazanımları API'yle değil, **ders PDF'leri içinde** sunar.
- `scripts/sync-meb.js` (taslak): Tüm ders programlarını + PDF adreslerini `data/meb_programlar.json`'a toplar. `node scripts/sync-meb.js`
- Ünite/konu/kazanım tablo çözücü + Vercel Cron ile yıllık otomatik `upsert` sonraki adımdır.

## Yerel geliştirme
```
npm install
npx vercel dev        # /api/kazanimlar lokal çalışır; index.html sunulur
```

## Teknik notlar
- Kazanım havuzu artık Google Sheets değil, Supabase'den beslenir.
- `MAX_SORU` / `MAX_OGRENCI` sabitleri yapılandırılabilir hale getirilebilir (gelecekte).
- MEB sayfası form tabanlı (ASPNET) ama program linkleri statik `ProgramDetay.aspx?PID=` olduğundan taranması basit.