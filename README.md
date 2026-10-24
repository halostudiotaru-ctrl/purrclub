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

## Isi
- `index.html`  halaman aplikasi
- `api/state.js`  baca skor dan terima aksi poin/undo/reset (dengan kunci supaya ketukan bersamaan tidak hilang)
- `api/photo.js`  baca/tulis foto selfie
- `lib/score.js`  jadwal tetap dan aturan skor di server
- `lib/redis.js`  klien Redis REST tanpa dependency
