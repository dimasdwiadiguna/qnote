# PLAN — Qnote (Tadabbur Outliner)

Rencana arsitektur untuk web app personal single-user: outliner katalog ayat & insight,
offline-first, mobile-first.

Dokumen ini adalah deliverable **M0**. Bagian §9 berisi argumentasi terhadap beberapa
keputusan di Bagian 2 brief (sesuai instruksi §12: kalau menilai ada yang keliru,
argumentasikan di sini — bukan diam-diam mengubahnya).

---

## 1. Prinsip yang mengunci semua keputusan lain

1. **Dexie adalah sumber kebenaran.** Tidak ada satu pun jalur UI yang menunggu jaringan.
   Supabase hanya konsumen dari outbox + produsen delta.
2. **Semua tulis bersifat lokal-sinkron.** `await db.blocks.put(...)` selesai dalam
   milidetik; UI sudah optimistis lewat `useLiveQuery`.
3. **Per-blok, bukan per-dokumen.** Unit sync, unit konflik, unit render, dan unit
   undo semuanya adalah satu baris `blocks`.
4. **Mengetik menang atas segalanya.** Bila ada trade-off antara kelengkapan fitur dan
   latency keystroke, keystroke menang.

---

## 2. Arsitektur aplikasi

```
main.tsx
 └── App (router hash-less, state layar di URL via history API)
      ├── boot()                    persist storage → migrasi Dexie → seed ayat
      ├── <OutlinePage>             layar utama (dokumen + zoom)
      ├── <CandidatesPage>          bullet ber-tag/kategori/ayat yang belum dipromosikan
      ├── <SearchPage>              full-text + filter tag/kategori
      ├── <DrillPage>               antrian FSRS 3 mode
      ├── <InspirasiPage>           kartu besar swipeable per tema
      └── <SettingsPage>            auth, sync, impor ayat, diagnostik storage
```

### 2.1 Lapisan

| Lapisan | Isi | Aturan |
|---|---|---|
| `src/db/` | Dexie schema, repositori, outbox, seed | Satu-satunya yang menyentuh IndexedDB |
| `src/lib/` | parser, kategori, normalisasi, fsrs, search | Murni, tanpa I/O, mudah di-unit-test |
| `src/sync/` | Supabase client, push outbox, pull delta | Boleh gagal diam-diam; tidak pernah blocking |
| `src/features/` | Komponen React per layar | Tidak boleh memanggil Dexie langsung selain lewat repo |

### 2.2 Alur tulis (satu keystroke)

```
onInput → setState lokal (instan, uncontrolled textarea)
        → debounce 400ms
        → repo.updateBlockContent(id, text)
             ├── db.blocks.update({content, updated_at})
             ├── reindex(blockId)   // parse → diff tag/kategori/link → tulis join tables
             └── outbox.enqueue('blocks', id)
```

`reindex` dijalankan di transaksi yang sama supaya join table tidak pernah tertinggal
dari `content`.

---

## 3. Model data (Dexie)

Skema identik dengan Postgres. Semua tabel: `created_at`, `updated_at` (ISO 8601 UTC),
`deleted_at | null`. **Soft delete wajib.**

```ts
documents        id, title, created_at, updated_at, deleted_at
blocks           id, document_id, parent_id, order_key, block_type,
                 content, is_promoted, is_collapsed,
                 ayat_surah, ayat_number, …timestamps
tags             id, name(lowercase, unik)
categories       id, name(lowercase), parent_id, path(cache turunan)
block_tags       id, block_id, tag_id
block_categories id, block_id, category_id
block_links      id, from_block_id, to_block_id
review_states    id, mode, target_type, target_id, …FSRS
ayat             [surah+number], surah, number, arabic, translation_id, search_id
```

### 3.1 Indeks Dexie

```
blocks:        id, document_id, parent_id, [document_id+parent_id], [parent_id+order_key],
               is_promoted, updated_at, deleted_at, [ayat_surah+ayat_number]
block_tags:    id, block_id, tag_id, [block_id+tag_id]
block_categories: id, block_id, category_id, [block_id+category_id]
block_links:   id, from_block_id, to_block_id
review_states: id, [mode+target_type+target_id], due, mode
ayat:          [surah+number], surah
outbox:        ++seq, table, row_id, [table+row_id]
```

`[parent_id+order_key]` adalah indeks terpenting: seluruh render outline adalah
serangkaian range-scan anak per parent, terurut, tanpa sort di memori.

### 3.2 `order_key` — fractional indexing

Library `fractional-indexing` (`generateKeyBetween`). Sisip antara A dan B =
satu tulis baris. Tidak ada renumbering saudara. Ini prasyarat sync per blok.
Kunci diurutkan sebagai **string** (lexicographic), jadi indeks compound
`[parent_id+order_key]` langsung memberi urutan tampilan yang benar.

### 3.3 Materialisasi vs computed

| Turunan | Cara | Alasan |
|---|---|---|
| `block_tags`, `block_categories` | **materialisasi** saat tulis | filter harus indeks, bukan scan teks |
| `block_links` | **materialisasi** saat tulis | backlink harus O(1) lookup |
| kategori **warisan** | **computed saat baca** | pindah parent harus langsung benar tanpa backfill |
| pohon kategori (`categories.parent_id`) | materialisasi | dibuat otomatis saat parse `a/b/c` |

Warisan dihitung sekali per render dengan satu pass menurun (parent → anak) pada
subtree yang sedang tampil, di-memo per `(rootId, versi outline)`. Biaya O(n) node
tampil, bukan O(n·depth).

Untuk **filter kategori lintas dokumen** (layar Search / Inspirasi), warisan tidak bisa
dihitung dari subtree tampil. Di sana dipakai jalur kedua: ambil blok yang punya
kategori langsung → naikkan ke seluruh keturunannya lewat traversal `parent_id`
(satu query per level, dibatasi kedalaman). Hasil di-cache per sesi query.

---

## 4. Parser penanda (`src/lib/parser.ts`)

Satu pass, prioritas eksplisit — **`[[ ]]` selalu dicoba sebelum `[ ]`**:

```
1. [[  ...  ]]   → wiki-link         (regex \[\[([^\[\]]+)\]\])
2. [   ...  ]    → kategori          (hanya yang tersisa setelah langkah 1 dimasking)
3. #kata         → tag               (batas kata; huruf unicode, angka, - dan _
                                        — TANPA `/`, karena tag itu datar; lihat §9.3)
```

Implementasi: scan karakter, bukan `String.replace` beruntun. Saat menemukan `[`,
cek `[[` dulu. Ini menutup kasus uji wajib:

```
lihat [[Blok A]] dalam [dakwah/manhaj] dan [ushul]
→ links: ["Blok A"]  categories: ["dakwah/manhaj", "ushul"]  tags: []
```

Kasus uji lain yang ditulis: `[[a]] [b]`, `[a] [[b]]`, `[[`, `]]` menggantung,
`[a/b/c]` (3 level), `#tag` di akhir baris, `#tag` di tengah kata (tidak match),
kurung siku bersarang, dan teks Arab + `#tag` (bidi tidak merusak offset).

Parser mengembalikan **token beroffset** (`start`, `end`), bukan cuma nilai — supaya
renderer bisa menggambar chip berwarna di tempat yang tepat tanpa parse ulang.

---

## 5. Editor outliner

### 5.1 Bentuk render

- Daftar **datar** hasil flatten pohon (menghormati `is_collapsed`), dengan `depth`.
  Flatten dilakukan di worker-free memo; input: semua blok dokumen (satu query),
  output: array node tampil.
- **TanStack Virtual** di atas array datar itu. Kartu ayat punya tinggi variabel →
  pakai `measureElement` (dynamic size), bukan tinggi tetap.
- Satu baris = `<textarea>` auto-grow **uncontrolled** (nilai awal dari Dexie, tidak
  di-`value`-kan tiap render). Alasan: `value` terkontrol + `useLiveQuery` =
  kursor melompat saat sync mengembalikan baris.

### 5.2 Keyboard

| Tombol | Aksi |
|---|---|
| `Enter` | bullet baru sebagai **saudara** setelahnya (di kartu ayat: **anak**) |
| `Enter` di bullet kosong ter-indent | outdent |
| `Backspace` di awal bullet kosong | gabung ke bullet sebelumnya (di kartu ayat: **tidak menghapus**) |
| `Tab` / `Shift+Tab` | indent / outdent **bersama seluruh anak** |
| `↑` / `↓` | pindah fokus ke bullet tampil sebelumnya/berikutnya, pertahankan kolom |
| `Esc` | tutup autocomplete |

Indent = ubah `parent_id` ke saudara sebelumnya + `order_key` baru di akhir anaknya.
Anak ikut **tanpa disentuh** karena mereka menunjuk `parent_id` bullet yang dipindah.
Ini satu tulis baris — itulah gunanya pohon adjacency + fractional index.

### 5.3 Toolbar mobile (wajib)

`position: fixed` + `bottom: env(safe-area-inset-bottom)`, dinaikkan oleh
**VisualViewport API** saat keyboard muncul (`visualViewport.height`+`offsetTop`).
`env(keyboard-inset-height)` belum bisa diandalkan di iOS Safari, jadi VisualViewport
adalah jalur utama, CSS env sebagai fallback.

```
[⇤ outdent] [⇥ indent] [#] [[ ]] [[[ ]]] [+ ayat] [★ promosi]
```

Semua tombol `onPointerDown` + `preventDefault` supaya **fokus textarea tidak hilang**
dan keyboard tidak berkedip. Ini detail kecil yang menentukan app terasa benar atau tidak.

### 5.4 Zoom-in

Klik bullet (di area bullet ●, bukan teks — tap teks = taruh kursor) → `?zoom=<blockId>`.
Breadcrumb dibangun dengan menaiki `parent_id` sampai akar dokumen.

---

## 6. Blok ayat

- `block_type='ayat'`, `content` = **anotasi user** (dan penanda miliknya sendiri),
  **bukan** teks ayat. Teks Arab + terjemah selalu di-join dari tabel `ayat` via
  `(ayat_surah, ayat_number)`, read-only.
- Warga kelas satu: boleh di akar, boleh punya anak, boleh dipromosikan, di-collapse,
  di-indent. Tidak ada cabang kode khusus di operasi pohon — hanya di render dan di
  tiga aturan keyboard (§5.2).
- Arab dirender di elemen **terpisah**: `<p dir="rtl" lang="ar" class="font-quran">`.
  Terjemah di `<p dir="ltr" lang="id">`. Tidak pernah dalam satu text node.
- **"Tutup semua kartu ayat"** = state tampilan `ayatCardsCollapsed` (global, bukan
  per-blok, tidak disimpan ke `blocks`) yang menciutkan Arab+terjemah jadi chip
  `QS 2:153`. **Terpisah total** dari `is_collapsed` yang menyembunyikan anak.

### 6.1 Sisip ayat

`[+ ayat]` atau ketik `@` → palet cari. Tiga bentuk query dikenali:
`2:153` / `2 153` (rujukan), `al baqarah 153` (nama surah + nomor, fuzzy tanpa
diakritik/tanda hubung), atau potongan terjemah (substring ternormalisasi).

Ayat disisipkan **sejajar** dengan bullet aktif (saudara setelahnya), bukan dipaksa
jadi anak. Kalau bullet aktif kosong dan `text`, blok itu **dikonversi di tempat**
menjadi blok ayat — supaya tidak meninggalkan bullet kosong yatim.

### 6.2 Data & seeding

- 114 file `/public/data/quran/001.json … 114.json` + `index.json` (metadata surah).
- Skema per file:
  ```json
  { "surah": 2, "name_arabic": "البقرة", "name_latin": "Al-Baqarah",
    "name_id": "Sapi", "ayah_count": 286,
    "ayat": [{ "number": 1, "arabic": "…", "translation_id": "…" }] }
  ```
- Impor **bertahap** (satu surah = satu transaksi `bulkPut`) dengan progress bar,
  **idempoten** (primary key `[surah+number]`, `bulkPut` bukan `bulkAdd`), dan
  `seed_state` menyimpan surah terakhir yang sukses supaya bisa dilanjutkan.
- Impor berjalan **setelah first paint**, non-blocking; app bisa dipakai menulis
  catatan teks sebelum impor selesai.
- Tabel `ayat` tidak pernah ikut sync, tidak pernah diedit.

---

## 7. Pencarian, drill, sync

### 7.1 Pencarian

Normalisasi (`src/lib/normalize.ts`):
- Latin: `toLowerCase()` + `normalize('NFD')` + buang `\p{Diacritic}`.
- Arab: buang harakat & tanda Quranik (`U+0610–U+061A`, `U+064B–U+065F`, `U+0670`,
  `U+06D6–U+06ED`, tatweel `U+0640`), normalisasi alif (`أإآٰ→ا`), `ى→ي`, `ة→ه`.

Kolom `search_norm` disimpan di `blocks` dan `ayat` (dihitung saat tulis/seed) supaya
pencarian tidak menormalisasi 6236 ayat tiap ketikan. Pencarian = substring scan pada
kolom ternormalisasi + filter tag/kategori lewat join table. Untuk skala personal
(ribuan blok, 6236 ayat) ini di bawah 50 ms — **tidak perlu FTS index**; kalau nanti
lambat, jalur upgrade adalah inverted index token → id di tabel terpisah.

### 7.2 Drill (ts-fsrs)

`review_states` dikunci `[mode + target_type + target_id]`. Tiga mode terjadwal
terpisah:

| Mode | target_type | target_id | Sumber kartu |
|---|---|---|---|
| A. Tema → Ayat | `block` | block id | blok **dipromosikan** yang punya ≥1 ayat terkait |
| B. Cloze Arab | `ayat` | `"2:153"` | ayat yang dipakai di ≥1 blok |
| C. Terjemah → Rujukan | `ayat` | `"2:153"` | idem |

**Aturan keterkaitan Mode A** (persis brief, tidak dilebarkan): ayat terkait blok bila
(a) parent–child **langsung**, arah mana pun; **atau** (b) ada `[[wiki-link]]` eksplisit
antara keduanya. Kekerabatan >1 tingkat tidak dihitung.

Cloze bertahap: porsi kata tersembunyi = `f(stability)` — 20% pada awal, naik bertahap
sampai 80%. Kata yang disembunyikan dipilih deterministik dari hash `(ayatId, level)`
supaya tidak berubah-ubah dalam satu sesi.

Antrian harian = union kartu `due <= now` dari tiga mode, opsional difilter kategori
(termasuk turunan).

### 7.3 Sync

- Outbox lokal (`++seq`), append-only, dedup per `(table,row_id)` saat flush.
- Push: batch `upsert` per tabel → hapus entri outbox yang sukses.
- Pull: `updated_at > last_synced_at` per tabel → LWW per baris berbasis `updated_at`.
- Soft delete di mana-mana; `deleted_at` ikut ter-upsert, jadi hapus menyebar.
- Auth magic link, `emailRedirectTo: window.location.origin`.
- RLS `user_id = auth.uid()` di semua tabel. `user_id` diisi saat push.
- Indikator status teks kecil: *tersinkron* / *tertunda (n)* / *offline*.
  Tidak ada spinner blocking.

---

## 8. Milestone & urutan kerja

| # | Isi | Titik henti |
|---|---|---|
| M0 | `PLAN.md`, skema, risiko | **review** |
| M1 | Outliner Dexie murni + toolbar mobile + deploy Vercel | dogfood di HP |
| M2 | Parser, pohon kategori, warisan, backlink, promosi, Kandidat | review |
| M3 | Ayat: seed, sisip, kartu RTL, font lokal | review |
| M4 | Pencarian + filter + normalisasi diakritik | review |
| M5 | Drill FSRS 3 mode | review |
| M6 | Supabase auth/RLS/outbox/sync 2 arah | uji 2 device |
| M7 | Inspirasi Dakwah + polish PWA + uji install Android/iOS | rilis |

Setiap batas milestone: app **tetap jalan dan dipakai**.

---

## 9. Argumentasi terhadap keputusan Bagian 2

Empat catatan. Tidak ada yang saya ubah sendiri — ini permintaan izin.

**9.1 `[kategori]` vs kurung siku biasa dalam prosa.**
Sintaks kategori memakan **semua** `[...]` di teks. Kalau nanti Anda menulis
`[sic]` atau `[lihat catatan]` dalam kutipan, itu jadi kategori tanpa disengaja.
Usul: kategori hanya dikenali bila isinya cocok pola `^[\p{L}\p{N} _/-]+$` dan
tanpa spasi ganda — jadi `[sic]` tetap jadi kategori (memang cocok pola), tapi
`[lihat catatan buku halaman 40]` tidak. **Implementasi M2 memakai pola ketat ini**;
kalau Anda mau semua `[...]` jadi kategori, tinggal longgarkan satu regex.

**9.2 Warisan kategori pada filter lintas dokumen itu mahal.**
Computed-on-read mudah untuk subtree tampil (§3.3), tapi untuk "cari semua blok
`[dakwah]` termasuk warisan" ia berarti traversal pohon tiap query. Untuk skala Anda
(ribuan blok) masih di bawah 100 ms, jadi saya **tetap** ikut brief. Kalau nanti terasa
lambat, jalur upgrade: tabel cache `block_effective_categories` yang di-*invalidate*
saat `parent_id`/`block_categories` berubah — masih computed secara semantik, cuma
di-memo secara persisten. Saya catat sebagai risiko, bukan sebagai perubahan.

**9.3 `#tag` dan bahasa Indonesia.**
Tag akan sering multi-kata (`#fiqih muamalah`). Batas kata pada `#` tidak bisa menebak
di mana tag berakhir. Keputusan: `#tag` berhenti di spasi (jadi satu kata), dan
multi-kata ditulis `#fiqih-muamalah` atau `#fiqih_muamalah`. Alternatifnya `#[…]`,
tapi itu menambah sintaks baru yang menabrak §2.6. Saya ambil yang pertama.

**9.4 Tidak ada backend — setuju, tanpa keberatan.**
Semua kebutuhan (auth, data, RLS) dilayani Supabase langsung dari browser. Tidak ada
satu pun alasan teknis untuk menambah serverless function di scope ini. Static SPA.

---

## 10. Daftar risiko

| # | Risiko | Dampak | Mitigasi |
|---|---|---|---|
| R1 | **iOS Safari mengosongkan IndexedDB** saat storage menipis | kehilangan sumber kebenaran | `navigator.storage.persist()` saat boot; tampilkan status persist di Settings; dorong "Add to Home Screen" (PWA terinstal jauh lebih jarang di-evict); sync Supabase sebagai backup nyata |
| R2 | **Precache Workbox 2 MiB** ditabrak data Quran (2.9 MB total) | build gagal / SW rusak | `/data/quran/**` dikecualikan dari `globPatterns`, ditangani runtime `CacheFirst` umur panjang; font Arab (62 KB) tetap precache |
| R3 | **Kursor melompat** karena `useLiveQuery` menulis ulang textarea | mengetik tidak bisa dipakai | textarea uncontrolled; blok yang sedang difokus dikecualikan dari re-render (guard `focusedIdRef`) |
| R4 | **Toolbar tertutup keyboard** di iOS | app tidak bisa dipakai di HP | VisualViewport API, bukan `position:sticky` saja; uji di Safari sungguhan (M7) |
| R5 | **Bidi rusak** saat Arab & Latin bercampur | ayat tampil kacau/terbalik | elemen terpisah `dir="rtl" lang="ar"`; lint manual: tidak ada template string yang menggabung Arab+Latin |
| R6 | **Virtualisasi + tinggi variabel** kartu ayat | scroll melompat-lompat | `measureElement` dinamis; `overscan` cukup besar; kartu ayat punya tinggi minimum stabil |
| R7 | **Konflik LWW menghapus edit** saat 2 device offline bersamaan | kehilangan tulisan | per-baris (bukan per-dokumen) jadi radius kerusakan kecil; `updated_at` selalu dari device penulis; catat tabrakan ke log lokal yang bisa dilihat di Settings |
| R8 | **Clock skew antar device** merusak LWW | urutan menang salah | pakai `Date.now()` device penulis + tolak `updated_at` masa depan >5 menit saat pull |
| R9 | **Env var Vite di-bake saat build** | ubah env di Vercel tidak berefek | ditulis di README sebagai checklist; app menampilkan peringatan jelas kalau env kosong |
| R10 | **Magic link gagal di preview deployment** | tidak bisa login di preview | `emailRedirectTo: window.location.origin`; wildcard redirect URL di Supabase (checklist README) |
| R11 | **Impor 6236 ayat membekukan main thread** | app terasa hang saat boot pertama | per-surah, `bulkPut` per transaksi, `yield` antar surah, progress bar, resume dari `seed_state` |
| R12 | **`order_key` kembar** setelah sync 2 device | urutan tidak deterministik | tie-break sekunder pada `id` saat sort; sisip selalu `generateKeyBetween` dari state terbaru |
| R13 | **Promosi jadi tidak terpakai** karena lupa meninjau | wiki-link/drill kosong | layar Kandidat + badge jumlah kandidat di navigasi |
| R14 | **Font Quran tidak memuat** offline | kartu ayat rusak total | woff2 di-*precache* (bukan runtime), `font-display: swap`, preload di `<head>` |

---

## 11. Yang eksplisit TIDAK dibangun

Sesuai §10 brief: tanpa import RemNote, tanpa ekspor/berbagi, tanpa audio, tanpa
evaluasi AI, tanpa tafsir, tanpa multi-user, tanpa rich-text, tanpa backend sendiri.
