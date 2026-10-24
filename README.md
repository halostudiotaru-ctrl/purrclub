# Halloween Tennis (versi Vercel, sinkron antar HP)

## Cara deploy (±5 menit)
1. Taruh folder ini di GitHub, atau jalankan `npx vercel` di dalam folder ini.
2. Di dashboard Vercel: project > Storage (atau Marketplace) > tambah **Upstash Redis** (paket gratis) > hubungkan ke project ini. Variabel `KV_REST_API_URL` dan `KV_REST_API_TOKEN` terisi otomatis.
3. Redeploy (Deployments > titik tiga > Redeploy).
4. Bagikan link Vercel ke teman-teman. Tidak perlu PIN.

## Cara pakai
- Semua orang: pilih nama, ambil selfie. Foto otomatis tampil di HP semua orang.
- Pencatat skor: siapa saja boleh. Tombol +Poin muncul di kartu match yang sedang main, di HP semua orang. Skor tampil live (diperbarui tiap 3 detik).
- Koreksi: Undo poin dan Reset match tersedia untuk match yang sedang main atau yang baru selesai.
- Hapus semua skor: tersedia di bawah halaman, harus mengetik RESET.
- Recap: tombol Recap di tab Klasemen.
- Ganti pemain: tombol "Ganti pemain" di kartu match yang belum selesai. Pilih siapa yang diganti, lalu penggantinya. Skor tetap, dan klasemen/recap mengikuti pemain yang benar-benar main.
- Game manual: tombol "+ Game manual" di tab Jadwal. Pilih 4 pemain (2 vs 2). Game ditambahkan di akhir jadwal; pakai "Jadikan sedang main" untuk memainkannya sekarang. Hasilnya masuk klasemen.
- Pemain baru: tombol "+ Pemain baru" (atau lewat dialog game manual). Pemain baru muncul di klasemen dan punya recap sendiri.
- Hapus semua skor juga mengembalikan 10 pemain dan jadwal awal (pemain, game manual, dan penggantian hilang).

## Tampilan
UI memakai Shopify Polaris web components (`s-button`, `s-table`, `s-modal`, dll.) dari CDN `cdn.shopify.com/shopifycloud/polaris.js`, dengan warna Purrclub dan font Plus Jakarta Sans. Perlu koneksi internet untuk memuat komponen; jika gagal, muncul tombol "Muat ulang".

## Isi
- `tests/ui/`  tes UI (Playwright + Chrome). Jalankan: `cd tests/ui && npm install && npm test`. Perlu Node 20 atau lebih baru (playwright-core 1.64) dan koneksi internet (komponen Polaris dan font dimuat dari CDN). `node shoot.mjs` membuat 24 screenshot di `tests/ui/out/` untuk review visual.
- `tests/api/state.test.mjs`  tes server (jalankan: `node --test tests/api/state.test.mjs`)
- `index.html`  halaman aplikasi
- `api/state.js`  baca skor dan terima aksi poin/undo/reset (dengan kunci supaya ketukan bersamaan tidak hilang)
- `api/photo.js`  baca/tulis foto selfie
- `lib/score.js`  jadwal tetap dan aturan skor di server
- `lib/redis.js`  klien Redis REST tanpa dependency
