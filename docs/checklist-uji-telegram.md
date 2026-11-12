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
- [ ] **Voucher per provider per hari** (kuota bukan bagian produk): kirim
  ```
  axis
  3 hari 15rb
  5 hari 15rb
  7 hari 25rb
  ```
  → produk bernama **Axis 3 Hari / Axis 5 Hari / Axis 7 Hari**; yang lama otomatis dirapikan namanya (harga/stok terbawa).
- [ ] Kuota berubah (`axis 3 hari 8gb 15rb`) → **tidak ada yang berubah** selain harga bila beda; tidak perlu mengubah produk.
- [ ] `rapikan axis jadi per hari` → semua voucher Axis yang punya masa aktif diganti namanya jadi per hari; harga/stok tidak berubah.
- [ ] Sebut kuota di daftar (`axis 3 hari 10gb 15rb`) → kuota tersimpan sebagai keterangan; `harga axis 10gb` (karyawan, tanpa tag) menjawab **Axis 3 Hari · kuota 10GB · harga**.
- [ ] `axis 3 hari sekarang 8gb` (tanpa harga) → hanya kuota yang berubah; nama dan harga tetap.
- [ ] Hari baru (`30 hari 50rb stok 1`) → produk **Axis 30 Hari** dibuat; modal perkiraan dari margin biasa ditandai.
- [ ] Dua produk lama di hari yang sama → asisten **bertanya**, tidak menebak.
- [ ] Setelah ditanya, bilang `ganti semua` (atau tulis daftar dengan "yang lama buang") → **meminta satu ketukan konfirmasi**; satu produk lama dipakai per hari, sisanya dihapus (bila belum punya penjualan/rekap/opname) atau dinonaktifkan (stok 0, nama diberi "(nonaktif)").
- [ ] **Dua paket di hari yang sama** (`telkomsel, ganti semua` dengan `5 hari 5gb ...` dan `5 hari 7gb ...`) → diterima; namanya **Telkomsel 5 Hari (5GB)** dan **Telkomsel 5 Hari (7GB)**; hari lain tetap tanpa kuota di nama.
- [ ] Karyawan menulis `telkomsel 5 hari 7gb 2 pcs` → cocok ke varian 7GB; `telkomsel 5 hari 2 pcs` → bot **bertanya** varian mana.
- [ ] Modal yang jelas salah ketik (`modal 2300 harga jual 25000`) → asisten **bertanya** "maksudnya 23.000?" dan tidak menerapkan.
- [ ] Karyawan menulis `axis 3 hari 2 pcs` (atau `axis 10gb 3 hari 2 pcs`) → cocok ke Axis 3 Hari tanpa pertanyaan.
- [ ] Karyawan menulis **kuota saja** `axis 10gb 2 pcs` (kuota hari ini) → cocok ke Axis 3 Hari tanpa pertanyaan.
- [ ] Owner: `tambah stok axis 3 hari 10 pcs` dan `tambah stok axis 10gb 10 pcs` → keduanya langsung diterapkan ke Axis 3 Hari.
- [ ] Tombol **↩️ Batalkan** setelah daftar → nama/harga kembali, produk baru dihapus.

- [ ] **Daftar barang apa saja** (bukan voucher): kirim misalnya
  ```
  rokok
  Surya 12 harga 31000
  Sampoerna A Mild 12 harga 31000 stok 40
  Gudang Garam Filter 12 harga 28000 stok 10
  ```
  → yang sudah ada diperbarui (harga/stok), yang belum ada dibuat (modal perkiraan dari margin kategori, ditandai); satu ringkasan; bisa Batalkan.
- [ ] `rokok, ganti semua` + daftar → meminta konfirmasi; hanya barang kategori Rokok yang diganti/dinonaktifkan.
- [ ] Nama yang cocok dengan beberapa barang → asisten **mendaftar semua yang meragukan sekaligus**, bukan satu per satu.

- [ ] **Otonom penuh**: kirim daftar Telkomsel (dua paket 5 hari) dengan "ganti semua" → langsung dijalankan **tanpa pertanyaan dan tanpa tombol konfirmasi**; hasil + tombol ↩️ Batalkan.
- [ ] Nama barang yang mirip beberapa produk → asisten **memilih yang terbaik** dan menulis "Memakai …" di hasil; tidak bertanya.
- [ ] Modal janggal (`modal 2300 harga jual 25000`) → tetap diterapkan, dengan baris peringatan ⚠️.
- [ ] Kategori paket/barang baru yang belum ada → dibuat otomatis.

- [ ] `minyak yang kita jual cuma pertalite` → langsung: **Pertalite** dibuat (harga ditandai belum diisi) dan barang minyak lain dihapus/dinonaktifkan; tidak ada audit/pertanyaan. Lalu `pertalite harga 12rb` mengisi harganya.

## F. Pemeriksaan data setelah uji
- [ ] Stok dan saldo akhir = stok/saldo awal ± perubahan yang memang dilakukan.
- [ ] Tidak ada produk ganda yang tidak diinginkan.
- [ ] Log Vercel tidak berisi galat berulang (`Telegram update processing failed`, `owner_agent_failure`).
- [ ] Kembalikan stok/saldo uji ke angka awal (koreksi/ubah saldo lewat chat pribadi owner).

## G. Laporan harian otomatis
- [ ] Pesan **📊 LAPORAN HARIAN** tiba di chat pribadi owner sekitar pukul 21.00 WIB (berisi rekap hari itu, barang terjual, saldo, stok menipis).
- [ ] Hari tanpa rekap → tertulis "Belum ada rekap shift hari ini."

## H. Tulis singkat (tanpa "pcs", tanpa "rekap")
- [ ] Di luar sesi rekap, tulis `telkomsel 3 hari` → rekap terbuka otomatis dan barang tercatat 1 pcs.
- [ ] `axis 5 hari 2`, `2 surya`, `xl 7hr dua` → terbaca dengan jumlah yang benar tanpa kata pcs.
- [ ] `tsel 3 hari sama axis 5 hari 2` → dua barang.
- [ ] `axis 7` (tanpa kata hari) → bot **bertanya** 7 hari atau 7 pcs; tidak mencatat.
- [ ] `tri 3 hari`, `im3 5 hari` → cocok ke produk Three/Indosat.
- [ ] `saldo 26jt`, `sisa uang 26jt`, `beli plastik 10rb` → terbaca sebagai saldo / pengeluaran.
- [ ] `axis 5 hari harusnya 3` → jumlah dikoreksi; `hapus axis 5 hari` → barang hilang dari draf.
- [ ] Rekap panjang (15+ barang dalam satu pesan) → semua barang masuk draf.
- [ ] Obrolan biasa (`besok libur 2 hari`, `aku telat 5 menit`) → bot **diam**.
- [ ] `harga axis 3 hari berapa?` → jawaban singkat satu baris, cepat.
