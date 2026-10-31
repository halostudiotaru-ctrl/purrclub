# Halloween Tennis (versi Vercel, sinkron antar HP)

## Cara deploy (±5 menit)
1. Taruh folder ini di GitHub, atau jalankan `npx vercel` di dalam folder ini.
2. Di dashboard Vercel: project > Storage (atau Marketplace) > tambah **Upstash Redis** (paket gratis) > hubungkan ke project ini. Variabel `KV_REST_API_URL` dan `KV_REST_API_TOKEN` terisi otomatis.
3. Redeploy (Deployments > titik tiga > Redeploy).
4. Bagikan link Vercel ke teman-teman. Tidak perlu PIN.

Data Halloween yang sudah ada otomatis menjadi sesi pertama ("Halloween Tennis"); tidak ada langkah migrasi.

Setelah deploy, minta semua yang sedang membuka aplikasi memuat ulang halaman; tab versi lama tetap bisa mencatat skor tapi belum menampilkan header, jam, dan game manual sesi baru.

## Cara pakai
- Semua orang: pilih nama, ambil selfie. Foto otomatis tampil di HP semua orang.
- Pencatat skor: siapa saja boleh. Tombol +Poin muncul di kartu match yang sedang main, di HP semua orang. Skor tampil live (diperbarui tiap 3 detik).
- Koreksi: Undo poin dan Reset match tersedia untuk match yang sedang main atau yang baru selesai.
- Hapus semua skor: tersedia di bawah halaman, harus mengetik RESET.
- Recap: tombol Recap di tab Klasemen.
- Ganti pemain: tombol "Ganti pemain" di kartu match yang belum selesai. Pilih siapa yang diganti, lalu penggantinya. Skor tetap, dan klasemen/recap mengikuti pemain yang benar-benar main.
- Game manual: tombol "+ Game manual" di tab Jadwal. Pilih 4 pemain (2 vs 2). Game ditambahkan di akhir jadwal; pakai "Jadikan sedang main" untuk memainkannya sekarang. Hasilnya masuk klasemen.
- Pemain baru: tombol "+ Pemain baru" (atau lewat dialog game manual). Pemain baru muncul di klasemen dan punya recap sendiri.
- Hapus semua skor mengembalikan sesi aktif ke pemain dan jadwal awalnya (pemain tambahan, game manual, dan penggantian pemain hilang).
- Sesi baru: tombol "+ Sesi baru" di bagian atas. Isi nama, durasi, menit per match, dan jam mulai; tambah pemain (atau "Ambil dari sesi sebelumnya" untuk menyalin nama dan fotonya); lihat ringkasannya, lalu "Mulai sesi". Jadwal dibuat otomatis: jumlah main tiap pemain sama atau selisih paling banyak satu. Kalau belum pas sama rata, ringkasan memberi saran jumlah match terdekat yang membuat semua orang main sama banyak.
- Semua HP otomatis pindah ke sesi yang baru dimulai. Ketuk "Riwayat" untuk melihat sesi lama (hanya-lihat) atau menjadikannya aktif lagi.
- Game manual: di dialog "+ Game manual", pemain dengan jumlah main paling sedikit diberi label "Disarankan"; "Pakai saran" mengisi keempat pemain itu (masih bisa diubah).
- Jumlah main tiap pemain tampil di bawah namanya di Klasemen (HP) dan di kartu ringkasan di tab Jadwal.

## Tampilan
UI memakai Shopify Polaris web components (`s-button`, `s-table`, `s-modal`, dll.) dari CDN `cdn.shopify.com/shopifycloud/polaris.js`, dengan warna Purrclub dan font Plus Jakarta Sans. Perlu koneksi internet untuk memuat komponen; jika gagal, muncul tombol "Muat ulang".

## Isi
- `tests/ui/`  tes UI (Playwright + Chrome). Jalankan: `cd tests/ui && npm install && npm test`. Perlu Node 20 atau lebih baru (playwright-core 1.64) dan koneksi internet (komponen Polaris dan font dimuat dari CDN). `node shoot.mjs` membuat 24 screenshot di `tests/ui/out/` untuk review visual.
- `tests/api/*.test.mjs`  tes server (jalankan: `node --test tests/api/*.test.mjs`)
- `index.html`  halaman aplikasi
- `api/state.js`  baca skor dan terima aksi poin/undo/reset (dengan kunci supaya ketukan bersamaan tidak hilang); parameter opsional `?sid=` memilih sesi (tanpa `sid` memakai sesi aktif)
- `api/photo.js`  baca/tulis foto selfie; parameter opsional `?sid=` memilih sesi (tanpa `sid` memakai sesi aktif)
- `api/sessions.js`  daftar sesi, pratinjau jadwal, buat sesi, aktifkan sesi
- `lib/score.js`  jadwal awal Halloween dan aturan skor di server
- `lib/schedule.js`  pembuat jadwal yang adil dan rekomendasi pemain untuk game manual
- `lib/sessions.js`  penyimpanan sesi (indeks, kunci Redis, migrasi data Halloween jadi sesi pertama)
- `lib/redis.js`  klien Redis REST tanpa dependency
