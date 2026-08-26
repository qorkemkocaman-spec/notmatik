-- ============================================================
-- OtoNot: uzun kazanım metinleri btree index sınırını (2704 B) aşabiliyordu.
-- "index row size 6072 exceeds btree version 4 maximum 2704 for index ux_kazanimlar_unik"
--
-- Çözüm: unique index'i uzun 'kazanim' metni yerine metnin sabit uzunluktaki
-- md5 hash'ine (32 karakter) taşıyoruz. Böylece uzunluktan bağımsız çalışır.
--
-- Çalıştırma: Supabase Dashboard -> SQL Editor -> bu dosyayı yapıştır -> Run
-- ============================================================

-- 1) Eski unique index'i / constraint'i kaldır (ikisinden hangisi varsa)
drop index if exists public.ux_kazanimlar_unik;
alter table public.kazanimlar drop constraint if exists ux_kazanimlar_unik;

-- 2) Hash sütununu ekle (yoksa)
alter table public.kazanimlar add column if not exists kazanim_hash text;

-- 3) Mevcut satırlara hash doldur
update public.kazanimlar set kazanim_hash = md5(kazanim) where kazanim_hash is null;

-- 4) Yeni unique index — hash sabit 32 karakter olduğundan sınır bir daha aşılmaz
create unique index if not exists ux_kazanimlar_unik
    on public.kazanimlar (sinif, kategori, ders, unite, kazanim_hash);

-- 5) Güvence: herhangi bir yoldan eklenen/güncellenen satırda hash otomatik dolsun
create or replace function public.set_kazanim_hash()
returns trigger as $$
begin
    new.kazanim_hash := md5(new.kazanim);
    return new;
end;
$$ language plpgsql;

drop trigger if exists trg_kazanimlar_hash on public.kazanimlar;
create trigger trg_kazanimlar_hash
    before insert or update of kazanim on public.kazanimlar
    for each row execute function public.set_kazanim_hash();