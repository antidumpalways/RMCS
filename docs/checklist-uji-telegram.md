# Daftar uji lapangan bot Telegram R-CELL

Jalankan satu putaran ini setelah setiap deploy besar, **di grup uji dengan data uji** (atau catat stok/saldo awal lebih dulu supaya bisa dikembalikan).
Centang tiap baris. Bila ada yang tidak sesuai, catat pesan bot persisnya.

Siapkan dulu: 1 akun karyawan, 1 akun owner, catat **stok** dan **saldo** sebelum mulai.

## A. Karyawan: shift dan rekap
- [ ] Tekan **Rekap** tanpa membuka shift → draf rekap langsung muncul (shift terbuka otomatis).
- [ ] Tulis `Axis 13gb 7 hari: 1 pcs` → baris barang muncul dengan **nama produk katalog** dan `stok jadi N`.
- [ ] Tulis nama yang kurang lengkap (`axis 8gb`) → bot menanyakan pilihan lewat **satu pesan** bertombol.
- [ ] Kirim pesan rekap yang **sama persis** dua kali dalam 1 menit → muncul "Catat lagi?" dengan tombol Ya/Tidak.
- [ ] Tulis `rekap voucher telkomsel 7gb 5 hari laku 1 pcs` dalam **satu baris** → langsung terbaca sebagai satu barang.
- [ ] Tulis `saldo akhir total 26jt` → terbaca sebagai saldo; baris "Tinggal" hilang.
- [ ] Saldo lebih dari seharusnya → draf **tidak** menulis "lebih"; saldo kurang → tertulis "kurang Rp …".
- [ ] Tombol **Selesai** selalu terlihat; ditekan saat belum lengkap → bot menjelaskan kekurangannya.
- [ ] Tekan **Ada selisih stok** → petunjuk singkat (bukan daftar penuh); tulis `Axis 13GB 3` → selisih tampil di draf.
- [ ] Tekan **Selesai** → pesan hasil 3 baris (saldo, stok akhir) tanpa daftar panjang. Stok produk **berkurang sesuai** rekap.

## B. Karyawan: setelah rekap
- [ ] `susulan voucher telkomsel 7gb 5 hari 1 pcs` → stok turun 1, saldo naik sebesar harga jual, owner menerima info.
- [ ] `susulan admin 5rb` → saldo naik Rp 5.000.
- [ ] Susulan di atas Rp 1.000.000 → **tidak** diterapkan otomatis; diteruskan ke owner.
- [ ] `axis 13gb tadi harusnya 2` → koreksi langsung diterapkan, stok menyesuaikan, owner menerima info.
- [ ] Obrolan biasa (`lupa rekap tadi maaf ya`) → bot **diam**.

## C. Karyawan: tanya harga
- [ ] `harga axis 13gb berapa?` **tanpa tag bot** → dijawab dari katalog.
- [ ] `berapa lama lagi ya?` → bot **diam**.
- [ ] `Admin harga 45rb` (catatan rekap) → **tidak** dijawab sebagai pertanyaan.

## D. Owner: laporan yang diterima
- [ ] Satu pesan **📋 REKAP SHIFT DISIMPAN** per rekap (saldo PAS/KURANG/LEBIH, stok akhir).
- [ ] Saldo di sistem **sama** dengan saldo akhir yang ditulis karyawan.
- [ ] Shift lama yang terlupa (uji dengan shift >14 jam) → ditutup otomatis, owner menerima info.

## E. Owner: asisten pribadi
- [ ] `tambahkan stok Paket Data 13GB Axis 10 pcs` (tanpa modal) → langsung diterapkan, modal tetap seperti sebelumnya.
- [ ] `Paket Data AXIS 10GB/3 Hari harga 15000 stok 1` (produk sudah ada) → harga dan stok **ditimpa**, tidak membuat duplikat.
- [ ] `ganti axis 6gb jadi 8gb` → nama produk yang sama berubah.
- [ ] `buat lokasi Rak 5` → lokasi dibuat.
- [ ] `hapus <barang>` → **tetap** meminta konfirmasi.
- [ ] Tombol **↩️ Batalkan** pada pesan hasil (tambah stok, ubah harga/nama/lokasi, tambah produk) → nilai lama kembali; produk baru dihapus.
- [ ] Tulis `batalkan yang tadi` → hasilnya sama dengan menekan tombol. Batas waktu 60 menit.
- [ ] Setelah dibatalkan, tekan Batalkan lagi → bot bilang sudah dibatalkan sebelumnya.
- [ ] Ubah harga lewat asisten, lalu karyawan menjual barang itu, lalu Batalkan → bagian yang sudah berubah lagi dilewati dengan keterangan.
- [ ] Ubah saldo lewat asisten → **meminta konfirmasi** (tidak langsung jalan).
- [ ] **Daftar paket per provider**: kirim
  ```
  axis
  3 hari 10gb 15rb
  5 hari 6gb 15rb
  7 hari 13gb 25rb
  ```
  → paket yang sudah ada diperbarui harganya; tidak ada produk ganda.
- [ ] Besoknya kirim daftar yang kuotanya berubah (`3 hari 8gb 15rb`) → **produk slot 3 hari yang sama diganti jadi 8GB** (bukan dibuat baru); modal lama tetap.
- [ ] Tambahkan masa aktif baru (`30 hari 20gb 50rb stok 1`) → produk baru dibuat dengan gaya nama katalog; modal diperkirakan dari margin biasa dan ditandai.
- [ ] Daftar yang membuat dua produk berebut satu slot → asisten **bertanya**, tidak menebak.
- [ ] Tombol **↩️ Batalkan** setelah daftar paket → nama/harga kembali, produk baru dihapus.

## F. Pemeriksaan data setelah uji
- [ ] Stok dan saldo akhir = stok/saldo awal ± perubahan yang memang dilakukan.
- [ ] Tidak ada produk ganda yang tidak diinginkan.
- [ ] Log Vercel tidak berisi galat berulang (`Telegram update processing failed`, `owner_agent_failure`).
- [ ] Kembalikan stok/saldo uji ke angka awal (koreksi/ubah saldo lewat chat pribadi owner).

## G. Laporan harian otomatis
- [ ] Pesan **📊 LAPORAN HARIAN** tiba di chat pribadi owner sekitar pukul 21.00 WIB (berisi rekap hari itu, barang terjual, saldo, stok menipis).
- [ ] Hari tanpa rekap → tertulis "Belum ada rekap shift hari ini."
