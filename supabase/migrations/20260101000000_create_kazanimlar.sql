-- ============================================================
-- OtoNot: kazanımlar tablosu + RLS (Supabase / Postgres)
-- Çalıştırma: Supabase Dashboard -> SQL Editor -> bu dosyayı yapıştır -> Run
-- ============================================================

-- 1) Genişletilebilir uzantı (uuid default için; Supabase genelde hazır gelir)
create extension if not exists "pgcrypto";

-- 2) Tablo
create table if not exists public.kazanimlar (
    id                uuid primary key default gen_random_uuid(),
    sinif             text not null,                 -- ör. "10"
    kategori          text not null default '',       -- ör: "Fen Bilimleri"
    ders              text not null,                 -- ör: "Kimya"
    unite             text not null default '',      -- ör: "Kimya Bilimi"  (MEB PDF'lerinde ünite bilgisi)
    kazanim           text not null,                 -- öğrenme çıktısı / kazanım metni
    puan_varsayilan   integer not null default 10,   -- seçildiğinde önerilen varsayılan puan
    kaynak            text not null default 'MEB',   -- 'MEB' | 'MEB-TYMM' | 'manual'
    kaynak_url        text not null default '',      -- kaynak program detay PDF adresi / PID
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);

-- 2b) Tekrar eden kazanımları önle (aynı sınıf+kategori+ders+ünite+kazanım)
create unique index if not exists ux_kazanimlar_unik
    on public.kazanimlar (sinif, kategori, ders, unite, kazanim);

-- 3) Arama / filtreleme indeksleri
create index if not exists ix_kazanimlar_sinif on public.kazanimlar (sinif);
create index if not exists ix_kazanimlar_ders on public.kazanimlar (ders);
create index if not exists ix_kazanimlar_kategori on public.kazanimlar (kategori);

-- 4) updated_at otomatik güncelle (trigger)
create or replace function public.set_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

drop trigger if exists trg_kazanimlar_updated on public.kazanimlar;
create trigger trg_kazanimlar_updated
    before update on public.kazanimlar
    for each row execute function public.set_updated_at();

-- 5) Güvenlik: RLS aç. Okuma yalnızca server (service role) üzerinden yapılacak.
--    Anon/public okuma tamamen kapalı -> veriler özel kalır.
alter table public.kazanimlar enable row level security;

-- (İsteğe bağlı) Yalnızca gerçek uygulama okuyucu hesabı için policy:
-- create policy "kazanimlar_read" on public.kazanimlar for select using (true);

-- 6) Service role (supabase service) RLS'den muaftır; ekstra yetki gerekmez.