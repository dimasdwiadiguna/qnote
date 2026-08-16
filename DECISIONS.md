# DECISIONS

Keputusan arsitektur yang saya ambil sendiri — yang tidak ditentukan eksplisit di
brief. Setiap entri berisi alasannya dan apa yang harus diubah kalau keputusannya
ternyata salah.

Keputusan di Bagian 2 brief **tidak** diubah. Keberatan terhadapnya ditulis
sebagai argumentasi di `PLAN.md` §9, bukan diterapkan diam-diam.

---

## D1 — `parent_id` memakai sentinel `''`, bukan `NULL`

**Masalah.** IndexedDB tidak bisa mengindeks `null`. Blok akar dengan
`parent_id: null` akan lenyap dari indeks `[parent_id+order_key]` — indeks
terpenting di app ini, karena seluruh render outline adalah range-scan anak per
parent yang sudah terurut.

**Keputusan.** Akar dokumen memakai `parent_id = ''` (`ROOT`). Kolom Postgres
juga `text not null default ''`, jadi bentuknya tetap identik di kedua sisi dan
tidak ada mapping tipe saat sync.

**Kalau salah.** Ganti ke `null` di kedua sisi, lalu buat kolom bayangan
`parent_key` khusus untuk indeks Dexie.

## D2 — Boolean disimpan `0 | 1`

Alasan sama: IndexedDB tidak menerima boolean sebagai key, sedangkan
`is_promoted` perlu diindeks (layar Kandidat, resolusi wiki-link, antrian drill
semuanya memfilter atasnya). Postgres memakai `smallint` + `check (in (0,1))`
agar identik.

## D3 — Tidak ada FOREIGN KEY di tabel sync Postgres

Sync mengirim upsert per tabel dalam batch. Dengan FK, batch harus diurutkan
secara topologis dan satu baris induk yang tertinggal menggagalkan seluruh
batch — padahal semua data ini sudah divalidasi di klien dan `id`-nya UUID yang
dibuat lokal. Integritas dijaga di sisi aplikasi (soft delete + reindex), bukan
di sisi database.

## D4 — `categories.path` dimaterialisasi

Brief hanya meminta `id`, `name`, `parent_id`. Saya menambah `path`
(`dakwah/manhaj`) karena dua operasi paling sering membutuhkannya: menyelesaikan
`[dakwah/manhaj]` saat parse (satu lookup, bukan menaiki pohon) dan memfilter
turunan (`path === filter || path.startsWith(filter + '/')`). `path` sepenuhnya
turunan dari `parent_id` + `name`; kalau rusak, bisa dibangun ulang.

## D5 — Kolom `search_norm` pada `blocks` dan `ayat`

Pencarian menormalisasi query, bukan korpus. Tanpa kolom ini, setiap ketikan
akan menormalisasi ulang 6236 ayat. Dihitung saat tulis, tidak pernah dibaca
user, dan aman dibangun ulang kapan saja.

## D6 — Kunci pencarian Arab membuang SEMUA alif

Mushaf Kemenag memakai alif khanjariyah (`U+0670`) di tempat ejaan modern
memakai alif penuh: `الصّٰبِرِيْنَ` diketik orang sebagai `الصابرين`, dan `اللّٰه`
diketik sebagai `الله`. Menghapus alif superscript membuat query pertama meleset;
mengubahnya jadi alif penuh membuat query kedua meleset. Tidak ada arah tunggal
yang benar, jadi kedua sisi diratakan — semua alif dibuang dari teks **dan** dari
query (`arabicSearchKey`). Presisi turun sedikit; pencarian jadi bekerja untuk
ejaan mana pun. Teks yang **ditampilkan** selalu asli, tidak pernah tersentuh.

## D7 — Pola kategori dibatasi

`[kategori]` hanya dikenali bila tiap segmen cocok
`^[\p{L}\p{N}][\p{L}\p{N} _-]*$`. Tanpa batasan, setiap `[lihat catatan buku
halaman 40]` dalam kutipan akan jadi kategori. Ini diangkat sebagai usul di
`PLAN.md` §9.1 dan diterapkan; melonggarkannya cukup satu regex.

## D8 — `#tag` berhenti di spasi

Tag multi-kata ditulis `#fiqih-muamalah` atau `#fiqih_muamalah`. Alternatifnya
menambah sintaks `#[...]`, yang menambah kasus tabrakan kurung siku baru
(brief §2.6). Lihat `PLAN.md` §9.3.

## D9 — Wiki-link diselesaikan lewat judul blok dipromosikan

`block_links` hanya menyimpan link yang **terselesaikan**, sesuai skema di brief.
Target dicocokkan dengan teks blok promoted yang sudah dibuang penandanya dan
dinormalisasi. Konsekuensinya: link yang belum punya target tidak menyisakan
baris apa pun, dan harus di-*resolve ulang* saat blok dipromosikan / judulnya
berubah. Itu dilakukan dengan memindai blok yang mengandung `[[` — subset kecil —
bukan seluruh tabel.

## D10 — Bullet dirender apa adanya, penanda hanya diberi warna

Kurung dan `#` tidak disembunyikan. Ini bukan pilihan estetika: pemetaan
titik-sentuh → posisi kursor (`offsetFromPoint`) mengandalkan teks tampil
identik dengan teks mentah. Menyembunyikan kurung akan menggeser kursor setiap
kali ada penanda sebelum titik sentuh — dan menaruh kursor di tempat yang
diketuk adalah salah satu hal yang paling menentukan rasa mengetik.

## D11 — Virtualisasi menyala di atas 80 baris

Di bawah itu, virtualisasi hanya menambah lapisan pengukuran tinggi yang bisa
membuat scroll melompat, tanpa manfaat. Di atasnya, TanStack Virtual dipakai
dengan `measureElement` dinamis karena kartu ayat jauh lebih tinggi daripada
bullet teks.

## D12 — Textarea uncontrolled + hanya baris terfokus yang jadi field

Baris lain dirender sebagai `<div>` berchip. Alasan: `value` terkontrol +
`useLiveQuery` berarti setiap tulisan Dexie (termasuk dari sync) menulis ulang
isi textarea dan melompatkan kursor. Sumber kebenaran selagi mengetik adalah
DOM; Dexie menyusul lewat autosave 400 ms.

## D13 — `commitNow()` sebelum setiap operasi struktur

Autosave debounce 400 ms berarti isi terbaru bisa belum sampai ke Dexie saat
`Enter`/`Tab` ditekan. Setiap operasi struktur memaksa simpan dari nilai DOM
lebih dulu — kalau tidak, teks tersimpan ke blok yang salah setelah pohon berubah.

## D14 — `ensureDefaultDocument()` dijaga promise tunggal

Bukan kehati-hatian teoretis: React StrictMode menjalankan efek boot dua kali,
dan dua `createDocument` yang berlomba menghasilkan dua dokumen kosong. Yang
kedua bisa menang saat urutan dibaca ulang setelah reload, dan catatan terlihat
"hilang". Ditemukan lewat uji browser, bukan lewat pembacaan kode. Dokumen
terakhir yang dibuka juga disimpan di `meta`, karena membuka app dari Home Screen
selalu mulai dari URL bersih.

## D15 — Fokus editor dilepas setelah jeda 220 ms

Toolbar mobile memakai `onPointerDown` + `preventDefault` supaya fokus tidak
hilang, tapi sebagian browser tetap memicu blur sesaat. Melepas fokus seketika
akan menurunkan toolbar tepat saat jari menyentuhnya. Jeda pendek menutup celah
itu. Navigasi bawah disembunyikan selagi mengetik: dua bilah bertumpuk memakan
setengah layar HP, dan di perangkat tanpa keyboard layar keduanya saling menimpa.

## D16 — Bilah penilaian drill ikut aliran flex, bukan `position: fixed`

Di layar drill tidak ada keyboard yang perlu dihindari, dan bilah melayang
menutupi navigasi bawah. Hanya toolbar editor yang benar-benar butuh
`keyboard-dock` + VisualViewport.

## D17 — Kartu drill baru tidak menulis `review_states` sampai dinilai

Membuka layar drill dengan 300 target akan menulis 300 baris ke Dexie dan ke
outbox tanpa satu pun kartu benar-benar dikerjakan. Kartu baru hidup sebagai
`state: null` di antrian; barisnya dibuat pada rating pertama.

## D18 — Antrian drill diselang-seling per mode

Empat puluh kartu cloze berturut-turut membuat sesi terasa seperti pekerjaan
rumah. Kartu jatuh tempo tetap diprioritaskan di atas kartu baru; penyelangan
hanya mengatur urutan di dalam kelompok itu.

## D19 — `updated_at` dipegang klien, tanpa trigger di Postgres

Last-write-wins per baris hanya benar kalau `updated_at` berasal dari device
yang menulis. Trigger `now()` di server akan membuat setiap push terlihat sebagai
tulisan terbaru dan merusak resolusi konflik. Sebagai gantinya, pull menolak
baris dengan `updated_at` lebih dari 5 menit di masa depan (clock skew) dan
mencatatnya ke log konflik yang bisa dilihat di Setelan.

## D20 — Data Quran diturunkan dari sumber terbuka, bukan dikarang

Brief melarang mengarang isi ayat dan melarang memanggil API eksternal **saat
runtime**. Data diambil sekali saat build lewat `scripts/fetch-quran.mjs` dari
dataset Kemenag terbuka (Arab + terjemah Indonesia, tanpa tafsir/audio/Inggris),
lalu di-commit sebagai 114 file statis. App tidak pernah memanggil jaringan luar
saat berjalan. Skema file didokumentasikan di README bila ingin diganti dengan
salinan sendiri.

## D21 — Font Arab: Amiri Quran, bukan LPMQ Isep Misbah

Brief menyebut "LPMQ Isep Misbah atau Uthmani". LPMQ tidak tersedia dengan lisensi
yang jelas untuk didistribusikan ulang, jadi dipakai **Amiri Quran** (OFL, gaya
Uthmani, dirancang khusus untuk teks mushaf) dengan Scheherazade New sebagai
cadangan. Keduanya woff2 lokal, 62 KB dan 123 KB, ikut precache. Mengganti ke
LPMQ cukup menaruh file di `public/fonts/` dan menukar `@font-face` di
`src/index.css`.
