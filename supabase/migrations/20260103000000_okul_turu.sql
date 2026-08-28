-- ============================================================
-- OtoNot: kazanımlar tablosuna TTKB okul türü kolonu ekler.
-- Çalıştırma: Supabase Dashboard -> SQL Editor -> bu dosyayı yapıştır -> Run
-- (collect-meb.js okul_turu alanı artık satır başına yazar.)
-- ============================================================

alter table public.kazanimlar add column if not exists okul_turu text not null default '';

-- Okul türüne göre filtreleme için indeks
create index if not exists ix_kazanimlar_okul_turu on public.kazanimlar (okul_turu);