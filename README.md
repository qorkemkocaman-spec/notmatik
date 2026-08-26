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

## MEB kazanım senkronizasyonu (otomatik)

MEB (`mufredat.meb.gov.tr`) kazanımları API'yle değil, **ders PDF'leri içinde** sunar. Proje iki dosya ile bunu tam otomatik hale getirir:

| Dosya | İşi |
|---|---|
| `scripts/sync-meb.js` | Programlar sayfasını tarar → tüm derslerin PDF adreslerini `data/meb_programlar.json`'a toplar |
| `scripts/collect-meb.js` | Her PDF'i indirip içindeki **öğrenme çıktılarını** (TYMM formatı) çözer ve **Supabase'e yazar** (upsert) |
| `.github/workflows/meb-sync.yml` | GitHub Actions: **her yıl 1 Ekim'de otomatik** yukarıdaki iki script'i çalıştırır |

### Nasıl çalışır (elle) teste
```bash
npm install
node scripts/sync-meb.js        # envanter güncelle
node scripts/collect-meb.js --ders MANTIK   # sadece Mantık (test)
node scripts/collect-meb.js     # TÜM dersler
```

### Otomatik (yılda 1 kez — 1 Ekim)
MEB'in PDF'lerini indirip parse etmek 535 ders için uzun sürer ve **Vercel'in 60sn timeout'una sığmaz**. Bu yüzden asıl otomasyon **GitHub Actions** ile yapılır (bedava, bir saate kadar çalışabilir):

1. GitHub'da repo → **Settings → Secrets and variables → Actions → New repository secret**:
   - `SUPABASE_URL` = `https://xxxx.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` = gizli anahtar
2. Workflow (`meb-sync.yml`) **her yıl 1 Ekim saat 04:00 TR** otomatik çalışır (cron `0 1 1 10 *`).
3. İstersen **Actions sekmesinden "Run workflow"** butonuna basarak istediğin zaman elle de tetikleyebilirsin.

> **Not:** Yeni MEB-TYMM (2026) formatı mükemmel çözülür; eski/geçiş dönemi formatlar (`I, II ve III. Kademeler`, klasik lise) farklı yapıda olduğundan bazı derslerde öğrenme çıktısı bulunamayabilir. Bu sınır bilinerek kullanılmalıdır.

### Vercel tarafı (opsiyonel, manuel)
- `api/kazanimlar.js` ön uca veri sağlar (asıl işlev).
- Asıl MEB otomasyonu GitHub Actions'ta çalışır; Vercel'de `api/` yalnızca veri okuma içindir, böylece build hızlı ve stabil kalır.


## Yerel geliştirme
```
npm install
npx vercel dev        # /api/kazanimlar lokal çalışır; index.html sunulur
```

## Teknik notlar
- Kazanım havuzu artık Google Sheets değil, Supabase'den beslenir.
- `MAX_SORU` / `MAX_OGRENCI` sabitleri yapılandırılabilir hale getirilebilir (gelecekte).
- MEB sayfası form tabanlı (ASPNET) ama program linkleri statik `ProgramDetay.aspx?PID=` olduğundan taranması basit.

## 🔐 Admin Paneli (Kazanım Yönetimi)
Uygulamanın **"Admin"** sekmesinde kazanım havuzunu Excel şablonu ile kendin yönetebilirsin.

### Nasıl kullanılır
1. **Admin** sekmesine tıkla → admin anahtarını gir (Vercel'de `ADMIN_KEY` env'iyle tanımlı).
2. **"Kazanım Şablonu İndir (CSV)"** → Excel'de doldur.
3. Sütunlar: `sinif; kategori; ders; unite; kazanim; puan_varsayilan; kaynak; kaynak_url`
   - Zorunlu: `ders`, `kazanim`, `sinif`
4. Doldurduğun CSV'yi yükle → kazanımlar Supabase'e işlenir (tekrar edenler güncellenir).
5. **"Kazanımları Listele"** ile mevcut veriyi gör.

### Kurulum (admin anahtarı)
1. Vercel → proje → **Environment Variables** → `ADMIN_KEY=<güçlü-değer>` ekle.
2. (Lokal test için `.env` içine `ADMIN_KEY=...` yaz.)
3. Admin sayfasında bu anahtarı girerek paneli açarsın.

> 🔒 **Güvenlik:** Admin anahtarını kimseyle paylaşma; kod içine yazma (yalnızca Vercel env'inde sakla). Kazanım yazma/okuma işlemleri sunucu tarafı API'lerden (`api/admin-yukle.js`, `api/admin-dogrula.js`) yapılır.