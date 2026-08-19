# Qnote

Outliner personal untuk mengumpulkan ayat, mencatat tadabbur, dan melatih hafalan.
Offline-first, dirancang untuk dipakai **satu tangan di HP** sambil duduk di kajian.

- **Sumber kebenaran ada di perangkat** (IndexedDB via Dexie). Supabase hanya lapisan
  sync/backup lintas device — tidak ada satu pun jalur UI yang menunggu jaringan.
- **Static SPA.** Tanpa SSR, tanpa API route, tanpa serverless function, tanpa backend
  sendiri. Semua panggilan data langsung dari browser ke Supabase.

---

## Jalankan lokal

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # 112 unit test (parser, normalisasi, pohon, drill, pilihan ayat, repo)
npm run build        # tsc -b && vite build → dist/
```

Tanpa konfigurasi apa pun, app langsung berfungsi penuh secara lokal: menulis,
mengedit, mencari, menyisipkan ayat, dan drill. Sync menyala hanya kalau env
Supabase diisi.

---

## Checklist setup

### 1. Environment variable di Vercel

| Nama | Contoh |
|---|---|
| `VITE_SUPABASE_URL` | `https://xxxx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `eyJhbGciOi…` |

- [ ] Isi keduanya untuk scope **Production** *dan* **Preview**.
- [ ] **Hanya anon key.** Jangan pernah `service_role` — isinya ikut terbundel ke JS
      publik dan bisa dibaca siapa pun. Keamanan nyata satu-satunya adalah RLS.
- [ ] Jangan commit `.env`. Salin dari `.env.example`.

> **Jebakan yang paling sering makan korban:** nilai `VITE_*` di-**bake saat build**,
> bukan dibaca saat runtime. Mengubahnya di dashboard Vercel **tidak berefek sampai
> ada redeploy**. Kalau app bilang "Supabase belum dikonfigurasi" padahal env sudah
> diisi — redeploy.

### 2. Supabase

- [ ] Jalankan `supabase/schema.sql` di **SQL Editor** (Dashboard → SQL → New query).
      Script ini membuat tabel, indeks, dan **mengaktifkan RLS** di semua tabel.
- [ ] Verifikasi: Dashboard → Authentication → Policies, semua 8 tabel harus
      "RLS enabled" dengan policy `*_owner`.
- [ ] Authentication → Providers → **Email**: aktifkan magic link.

### 3. Redirect URL magic link

URL preview Vercel berubah tiap commit, jadi redirect yang di-hardcode akan gagal.
Kode sudah memakai `emailRedirectTo: window.location.origin`; sisanya di dashboard:

Authentication → URL Configuration:

- [ ] **Site URL** → domain produksi, mis. `https://qnote.vercel.app`
- [ ] **Redirect URLs** → tambahkan wildcard preview:
      `https://*-<nama-project>.vercel.app/**`
- [ ] Tambahkan juga `http://localhost:5173/**` untuk pengembangan lokal.

### 4. Deploy Vercel

- [ ] Framework preset: **Vite**
- [ ] Build command: `npm run build` · Output directory: `dist`
- [ ] Node version: **22**
- [ ] `vercel.json` sudah ada (rewrite SPA + header cache). Setelah deploy pertama,
      **verifikasi** bahwa `/data/quran/002.json` mengembalikan JSON, bukan
      `index.html` — static file di `dist` harus menang atas rewrite.

---

## Data Quran

114 file statis di `public/data/quran/` (`001.json` … `114.json`) plus `index.json`,
total ±2,9 MB. Diimpor ke Dexie **sekali saat boot pertama**, bertahap dengan indikator
progres, dan idempoten — gagal di tengah boleh diulang tanpa duplikasi.

Isinya **Kemenag: Arab + terjemah Indonesia saja**. Tanpa tafsir, tanpa terjemah
Inggris, tanpa audio. Tabel `ayat` read-only dan tidak pernah ikut sync.

### Skema file per surah

```json
{
  "surah": 2,
  "name_arabic": "البقرة",
  "name_latin": "Al-Baqarah",
  "name_id": "Sapi",
  "ayah_count": 286,
  "ayat": [
    { "number": 1, "arabic": "الۤمّۤ ۚ", "translation_id": "Alif Lam Mim." }
  ]
}
```

`index.json` adalah array dari objek metadata surah yang sama tanpa field `ayat`.

### Mengganti dengan salinan sendiri

Timpa isi `public/data/quran/` dengan file berskema di atas, lalu di app buka
**Setelan → Data Quran → Impor ulang**. Regenerasi dari sumber terbuka:

```bash
npm run fetch:quran
```

App **tidak pernah** memanggil API eksternal saat runtime; skrip ini hanya dijalankan
manual saat build.

## Font Arab

Di-bundle lokal di `public/fonts/` (bukan CDN — harus jalan offline):

| File | Ukuran | Peran |
|---|---|---|
| `AmiriQuran-Regular.woff2` | 62 KB | utama, gaya Uthmani, dipreload |
| `ScheherazadeNew-Regular.woff2` | 123 KB | cadangan |

Keduanya **di-precache** service worker (bukan runtime cache) — tanpa font, kartu ayat
rusak total saat offline. Untuk memakai LPMQ Isep Misbah: taruh woff2-nya di
`public/fonts/`, lalu tukar `@font-face` di `src/index.css` dan `preload` di
`index.html`.

---

## PWA & caching

- `registerType: 'autoUpdate'`, installable, offline shell penuh.
- **Data Quran sengaja TIDAK di-precache** — menabrak batas 2 MiB per file Workbox dan
  tidak perlu ada sebelum dibuka. Ditangani runtime `CacheFirst` berumur panjang
  (isinya tidak pernah berubah). Setelah impor pertama data hidup di Dexie; cache
  service worker hanya jaring pengaman untuk instalasi ulang.
- `sw.js` dan `manifest.webmanifest` **tidak boleh** di-cache lama, atau app macet di
  versi lama dan update tidak pernah sampai. Sudah diatur di `vercel.json`.

### Pasang di HP

**Android/Chrome:** menu ⋮ → *Add to Home screen*.
**iOS/Safari:** tombol Share → *Add to Home Screen*.

Memasang app bukan kosmetik: PWA terinstal jauh lebih jarang di-*evict* oleh iOS
Safari. App juga memanggil `navigator.storage.persist()` saat boot; statusnya bisa
dicek di **Setelan → Penyimpanan**. Kalau tertulis "belum aktif", aktifkan sync
sebagai cadangan yang nyata.

---

## Peta kode

```
src/
  db/        Dexie: skema, repositori pohon, indexing, outbox, seed, FSRS
  lib/       Logika murni tanpa I/O — parser, normalisasi, pohon, pewarisan,
             pencarian, antrian drill  ← semua unit test ada di sini
  sync/      Klien Supabase, push outbox, pull delta, LWW per baris
  features/  Satu folder per layar (quran/, outliner/, search/, drill/, …)
  ui/        Router, hook, komponen bersama
supabase/schema.sql   Skema Postgres + RLS
scripts/fetch-quran.mjs   Regenerasi data ayat (manual, saat build)
```

Dokumen pendamping: **`PLAN.md`** (arsitektur, milestone, risiko, argumentasi terhadap
brief) dan **`DECISIONS.md`** (setiap keputusan arsitektur yang diambil sendiri, dengan
alasan dan jalan mundurnya).

---

## Cara pakai singkat

**Qur'an** — tab pertama. Cari surah (atau ketik `2:153`, atau potongan
terjemah), baca, lalu **ketuk ayat untuk memilih** dan **tahan untuk memilih
rentang**. Tekan `Catat` untuk menulis anotasi dan menyimpannya ke salah satu
catatan. Ayat yang sudah punya catatan diberi lencana, dan lencananya bisa
disentuh untuk melompat ke catatan itu — jadi pembaca sekaligus indeks dua arah.

Satu ayat → anotasi menempel pada kartu ayat itu. Beberapa ayat → anotasi jadi
bullet induk dengan ayat-ayatnya sebagai anak, yang berarti drill Mode A
langsung mengenalinya begitu induknya di-★.

> Tidak ada halaman mushaf (604 halaman) maupun navigasi juz: data ayat yang
> dipakai tidak memuat nomor halaman. Penggantinya gulir menerus per surah plus
> "Lanjutkan bacaan".

**Catatan (docs)** — sentuh judul di atas untuk berpindah catatan, membuat
catatan baru (langsung siap diketik), mengubah judul, atau menghapusnya. Tiap
catatan punya pohon bullet-nya sendiri.

**Penanda** — ditulis langsung di teks bullet:

| Tulis | Artinya |
|---|---|
| `#sistem` | tag, datar, tidak berjenjang |
| `[dakwah/manhaj]` | kategori berjenjang; diwariskan ke seluruh keturunan |
| `[[Blok A]]` | wiki-link ke blok yang sudah dipromosikan |

Mengetik `#`, `[`, atau `[[` memunculkan saran. Mengetik `@` membuka palet ayat.

**Toolbar** (muncul di atas keyboard): `⇤` `⇥` naik/turun tingkat — **anak
selalu ikut** · `#` `[ ]` `[[ ]]` penanda · `+ ayat` sisip ayat · `★` jadikan blok.

> Catatan istilah: pada outliner, *promote/demote* biasanya berarti
> outdent/indent. Di Qnote naik/turun tingkat adalah `⇤`/`⇥`; `★` ("jadikan
> blok") adalah hal yang berbeda dan tidak memindahkan bullet ke mana pun.

**Jadikan blok** (★) adalah flag, bukan pemindahan data — bisa dibatalkan kapan saja. Yang
dibuka hanya tiga hal: blok bisa jadi target `[[wiki-link]]`, punya panel backlink, dan
masuk antrian drill. Tag dan kategori tetap terindeks di **semua** bullet tanpa promosi.
Chip **kandidat** di layar Cari menampilkan bullet bertanda yang belum
dijadikan blok — daftar tinjau berkala. Lencana angka di tab Cari menghitungnya.

**Drill** memakai FSRS dengan self-rating (Again/Hard/Good/Easy). Tiga mode dijadwalkan
terpisah: **A** tema → ayat, **B** cloze Arab bertahap, **C** terjemah → rujukan.
Sebuah ayat dianggap terkait dengan blok bila keduanya parent–anak **langsung** atau
terhubung `[[wiki-link]]` — kekerabatan lebih jauh sengaja tidak dihitung.

---

## Status

M0–M7 terimplementasi: outliner, penanda & pewarisan, ayat, pencarian, drill, sync
Supabase, Inspirasi Dakwah, dan PWA. Yang belum diverifikasi di perangkat sungguhan:
instalasi PWA di Android & iOS Safari, dan uji konflik sync dua device — keduanya butuh
hardware nyata.
