-- Qnote — skema Supabase/Postgres.
-- Jalankan sekali di SQL Editor Supabase (Dashboard → SQL → New query).
--
-- Bentuknya sengaja IDENTIK dengan skema Dexie di src/db/types.ts:
--   · parent_id memakai sentinel '' untuk akar, bukan NULL
--     (IndexedDB tidak bisa mengindeks NULL — lihat DECISIONS.md D1)
--   · boolean disimpan smallint 0/1
--     (IndexedDB tidak menerima boolean sebagai key — D2)
--   · tidak ada FOREIGN KEY antar tabel sync
--     (upsert batch tidak perlu diurutkan secara topologis — D3)
--   · deleted_at ada di semua tabel; hard delete DILARANG, karena akan
--     membangkitkan kembali baris terhapus saat sync berikutnya.
--
-- Tabel `ayat` TIDAK ada di sini: data seed read-only, tidak pernah ikut sync.

-- ──────────────────────────────────────────────────────────────────────────────
-- Tabel
-- ──────────────────────────────────────────────────────────────────────────────

create table if not exists public.documents (
  id          uuid primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  title       text not null default '',
  order_key   text not null default 'a0',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table if not exists public.blocks (
  id           uuid primary key,
  user_id      uuid not null references auth.users (id) on delete cascade,
  document_id  uuid not null,
  parent_id    text not null default '',      -- '' = akar dokumen
  order_key    text not null,                 -- fractional index
  block_type   text not null default 'text',  -- 'text' | 'ayat'
  content      text not null default '',
  search_norm  text not null default '',
  is_promoted  smallint not null default 0,
  is_collapsed smallint not null default 0,
  ayat_surah   integer,
  ayat_number  integer,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  constraint blocks_block_type_check check (block_type in ('text', 'ayat')),
  constraint blocks_flags_check check (
    is_promoted in (0, 1) and is_collapsed in (0, 1)
  )
);

create table if not exists public.tags (
  id         uuid primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.categories (
  id         uuid primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  parent_id  text not null default '',
  path       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.block_tags (
  id         uuid primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  block_id   uuid not null,
  tag_id     uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.block_categories (
  id          uuid primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  block_id    uuid not null,
  category_id uuid not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table if not exists public.block_links (
  id            uuid primary key,
  user_id       uuid not null references auth.users (id) on delete cascade,
  from_block_id uuid not null,
  to_block_id   uuid not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create table if not exists public.review_states (
  id             uuid primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  mode           text not null,        -- 'A' | 'B' | 'C'
  target_type    text not null,        -- 'block' | 'ayat'
  target_id      text not null,        -- block id, atau "2:153" untuk mode B & C
  due            timestamptz not null,
  stability      double precision not null default 0,
  difficulty     double precision not null default 0,
  elapsed_days   double precision not null default 0,
  scheduled_days double precision not null default 0,
  reps           integer not null default 0,
  lapses         integer not null default 0,
  state          smallint not null default 0,
  last_review    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  constraint review_states_mode_check check (mode in ('A', 'B', 'C')),
  constraint review_states_target_check check (target_type in ('block', 'ayat'))
);

-- ──────────────────────────────────────────────────────────────────────────────
-- Indeks — pull delta selalu `updated_at > last_synced_at` per user.
-- ──────────────────────────────────────────────────────────────────────────────

create index if not exists documents_sync_idx        on public.documents (user_id, updated_at);
create index if not exists blocks_sync_idx           on public.blocks (user_id, updated_at);
create index if not exists tags_sync_idx             on public.tags (user_id, updated_at);
create index if not exists categories_sync_idx       on public.categories (user_id, updated_at);
create index if not exists block_tags_sync_idx       on public.block_tags (user_id, updated_at);
create index if not exists block_categories_sync_idx on public.block_categories (user_id, updated_at);
create index if not exists block_links_sync_idx      on public.block_links (user_id, updated_at);
create index if not exists review_states_sync_idx    on public.review_states (user_id, updated_at);

create index if not exists blocks_document_idx on public.blocks (user_id, document_id);
create unique index if not exists tags_user_name_idx on public.tags (user_id, name);
create unique index if not exists categories_user_path_idx on public.categories (user_id, path);
create unique index if not exists review_states_target_idx
  on public.review_states (user_id, mode, target_type, target_id);

-- ──────────────────────────────────────────────────────────────────────────────
-- RLS — SATU-SATUNYA lapisan keamanan yang nyata.
-- Anon key ikut terbundel di JS publik dan bisa dibaca siapa pun (brief §9.2),
-- jadi tanpa RLS aktif seluruh data terbuka. Jangan pernah nonaktifkan ini.
-- ──────────────────────────────────────────────────────────────────────────────

do $$
declare
  t text;
begin
  foreach t in array array[
    'documents', 'blocks', 'tags', 'categories',
    'block_tags', 'block_categories', 'block_links', 'review_states'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner', t);
    execute format(
      'create policy %I on public.%I
         for all
         to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))',
      t || '_owner', t
    );
  end loop;
end $$;

-- ──────────────────────────────────────────────────────────────────────────────
-- updated_at dipegang KLIEN, bukan server.
-- Last-write-wins per baris berbasis `updated_at` hanya benar kalau nilainya
-- berasal dari device yang menulis. Trigger `now()` di server akan membuat
-- setiap push terlihat sebagai tulisan terbaru dan merusak resolusi konflik.
-- Karena itu: TIDAK ADA trigger updated_at di sini. Ini disengaja.
-- ──────────────────────────────────────────────────────────────────────────────
