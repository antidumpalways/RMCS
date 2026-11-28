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

## I. Rekap bersama (lebih dari satu karyawan)
- [ ] Karyawan A memulai rekap. Karyawan B menulis `axis 5 hari 2` → masuk ke draf yang sama; draf menampilkan "👥 Ikut mengisi: B".
- [ ] Karyawan B menulis `admin 45rb` atau `saldo 26jt` → masuk ke draf yang sama.
- [ ] Karyawan B mengobrol biasa (`oke bentar ya`) saat rekap berjalan → bot **diam**.
- [ ] Karyawan B menekan ➕ barang cepat atau **Selesai** → berfungsi; pesan owner menulis "disimpan oleh B" dan "Ikut mengisi".
- [ ] Karyawan B menekan **Batal** → ditolak; hanya A (yang memulai) yang bisa membatalkan.

## J. Owner: update stok cepat
- [ ] Kirim pesan yang diawali **Update stok** lalu daftar banyak baris (`TELKOMSEL 3 HARI : 52`, `AXIS 5 HARI : 4`, `ROKOK :` lalu `SAMPOERNA : 7`, ...) → satu balasan "✅ Stok diperbarui (N barang)" dengan stok lama → baru, tanpa pertanyaan alasan.
- [ ] Daftar yang sama **tanpa** kata "update stok" → tidak diproses langsung (ditangani asisten biasa).
- [ ] `update stok xl 3 hari 10` (satu baris) → langsung diterapkan.
- [ ] Baris yang namanya kurang jelas atau tidak ada di katalog → dilaporkan "Belum diubah", barang lain tetap diubah.
- [ ] Baris tanpa angka (`XL 3 HARI :`) → dilewati.
- [ ] Menu → Koreksi stok → `axis 6gb 5 hari 4` → langsung diterapkan (menu sudah menjadi penandanya).
- [ ] Tombol **↩️ Batalkan** pada balasan → semua stok kembali.
- [ ] Koreksi stok lewat kalimat biasa (`xl 3 hari stok 10`) → diterapkan tanpa menanyakan alasan.

## K. Karyawan: template Rekap
- [ ] Kirim satu pesan:
  ```
  Rekap
  Telkomsel 3 hari : 2
  Axis 5 hari : 1
  XL 7 hari :
  Admin : 45rb
  Saldo total : 26jt
  ```
  → draf memuat 2 barang (baris XL kosong dilewati), admin, dan "💰 SALDO TOTAL" di bagian akhir.
- [ ] Template yang sama **tanpa** baris saldo → draf diakhiri "❓ Saldo total akhirnya berapa?".
- [ ] Balas `26jt` (angka saja) → terbaca sebagai saldo total; pertanyaan hilang.
- [ ] Draf kosong menampilkan contoh format template.

## L. Owner: update harga / modal / margin sekali banyak
- [ ] `Update harga:` lalu `TELKOMSEL 3 HARI : 15rb`, `AXIS 5 HARI : 16.000`, ... → satu balasan "✅ Diperbarui (N perubahan)" dengan harga jual lama → baru dan marginnya.
- [ ] `Update modal:` lalu daftar → modal lama → baru.
- [ ] `Update margin:` lalu `AXIS 3 HARI : 2rb` → harga jual menjadi modal + margin.
- [ ] Satu pesan berisi `Update stok:` ... `Update harga:` ... → keduanya diterapkan dalam satu balasan.
- [ ] Angka tanpa satuan yang terlalu kecil (`axis 3 hari : 15`) → dilaporkan "angkanya kurang jelas", tidak diubah.
- [ ] Harga jual di bawah modal → tetap diterapkan dengan peringatan ⚠️.
- [ ] Margin untuk barang yang modalnya belum tercatat → tidak diubah, diminta mengisi modal dulu.
- [ ] Tombol **↩️ Batalkan** → semua harga kembali.
- [ ] Daftar tanpa kop "Update ..." → tidak diproses langsung.

## M. Update stok/harga: AI untuk baris yang tidak pasti
- [ ] Baris yang namanya tidak cocok pasti (mis. `IM3 3 HARI`, `BY U 5 HARI`) → AI mencocokkan dari katalog; balasan memuat "🤖 Dicocokkan AI" berisi `tulisan → nama barang`.
- [ ] Dua barang sama-sama cocok (mis. Telkomsel 5 Hari 5GB dan 7GB) → tidak ditebak; dilaporkan dengan "pilihan: ...".
- [ ] Barang yang memang tidak ada di katalog → dilaporkan "tidak ada di katalog".
- [ ] Nama barang di balasan memuat masa aktif/kuota (mis. "Paket Data 10GB Three (3 hari)") agar tidak membingungkan.
- [ ] ↩️ Batalkan mengembalikan semua termasuk yang dicocokkan AI.

## N. Update stok: barang baru, pertanyaan harga, dan pilihan barang
- [ ] Baris yang mereknya belum ada di katalog (mis. `IM3 4 GB 3 HARI : 3`) → barang baru dibuat (nama `IM3 3 Hari`, kuota 4GB, kategori Voucher, stok sesuai), harga Rp 0.
- [ ] Baris rokok baru di bawah judul `ROKOK :` (mis. `BULL : 7`) → dibuat di kategori Rokok.
- [ ] Setelah itu bot bertanya modal dan harga jual barang baru. Balas `modal 13rb jual 15rb` (semua), atau per barang `IM3 3 hari : 13rb 15rb`.
- [ ] Baris yang kemungkinan barang lama dengan tulisan beda (mis. `BY U 10 GB 5 HARI` padahal katalog "Paket Data 11GB By.U") → tidak dibuat; muncul tombol pilihan barang dan usulan `Ganti <nama katalog> jadi <tulisanmu>`.
- [ ] Tekan tombol pilihan → stok diterapkan, dan tulisan yang sama langsung dikenali pada Update stok berikutnya.
- [ ] Mengisi harga lebih dulu tidak menghapus tombol pilihan yang masih menunggu.

## O. Karyawan: Update stok setelah shift (barang laku dihitung dari selisih stok)
- [ ] Owner menetapkan saldo awal gabungan (saldo + cash) lewat asisten pribadi (mis. "ubah saldo jadi 34jt"). Shift berikutnya dibuka otomatis dengan saldo itu.
- [ ] Setelah shift, karyawan mengirim di grup: `Update stok` + daftar sisa stok (`TELKOMSEL 3 HARI : 38`, judul `ROKOK :`, dst) + `Admin: 82` + `Total: 34463`.
- [ ] Draf menampilkan barang laku = stok sistem - hitungan, nilainya dari harga katalog, admin, dan "💰 SALDO TOTAL".
- [ ] Angka tanpa satuan (`Admin: 82`, `Total: 34463`) dibaca ribuan dan dituliskan di "CATATAN HITUNGAN" supaya bisa diperiksa; `82rb` / `34,4jt` dipakai apa adanya.
- [ ] Uang lebih dari perkiraan -> keterangan "kemungkinan dari penjualan pertalite/aksesori yang tidak ikut dihitung, atau pembayaran bon". Uang kurang -> "kemungkinan bon, pengeluaran belum ditulis, atau barang keluar belum tercatat".
- [ ] Selisih yang setara 1-3 pcs barang tertentu disebut ("setara 2 pcs Telkomsel 3 Hari").
- [ ] Hitungan lebih besar dari stok sistem -> dicatat "barang masuk?" dan tidak dihitung terjual.
- [ ] Barang yang namanya tidak dikenali -> dicatat sebagai "belum dikenali", tidak menghalangi Selesai.
- [ ] Setelah Selesai, stok sistem = hitungan karyawan, dan owner menerima laporan lengkap dengan keterangan selisih.
- [ ] Mengirim ulang `Update stok` menggantikan hitungan sebelumnya di draf yang sama.

## P. Pagi buka shift, sore tutup (Update stok dua kali sehari)
- [ ] **Pagi** (belum ada shift berjalan): kirim `Update stok` + daftar stok + `Modal: 34463` -> bot membalas "SHIFT PAGI DIBUKA".
- [ ] Stok sistem disesuaikan dengan hitungan pagi; balasan memuat daftar "26 -> 28 (+2)" dan owner menerima "UPDATE STOK PAGI".
- [ ] Uang awal (saldo + cash) mengikuti Modal pagi; bila beda dari catatan, balasan dan owner menyebut selisihnya.
- [ ] Nama yang tidak dikenali dilaporkan, tidak mengubah apa pun.
- [ ] **Sore** (shift sudah berjalan): `Update stok` + stok + `Admin: 82` + `Modal: 34600` -> draf rekap dengan barang laku dari selisih stok pagi vs sore, dan keterangan lebih/kurang.
- [ ] Penanda di kop memaksa mode: `Update stok pagi` / `buka` membuka shift; `Update stok sore` / `tutup` menutupnya.
- [ ] Shift kemarin belum direkap lalu karyawan kirim `Update stok pagi` -> shift lama ditutup otomatis (owner diberi tahu) dan shift baru dibuka.

## Q. Dua shift: perbaikan dari percakapan nyata
- [ ] `Uang keluar: 1190` terbaca Rp 1.190.000 (ikut gaya ribuan Total) dan muncul sebagai Pengeluaran di draf; daftar stok tidak hilang.
- [ ] Baris stok yang tidak terbaca disebut di catatan ("Baris ini tidak terbaca dan diabaikan"), tidak membuang seluruh daftar.
- [ ] `IM3 4 GB 3 HARI` dan `IM3 10 GB 3 HARI` (atau `Samsu Ketengan` dan `SAMSUE`) tidak saling menimpa; yang tidak dipakai dilaporkan sebagai barang yang belum ada di katalog.
- [ ] `BATANGAN FELOZ` tidak pernah dicocokkan ke `FELOZ` (juga di Update stok owner).
- [ ] Template dengan `Admin` atau `Uang keluar` terisi selalu dibaca SORE; template kosong mengikuti keadaan shift; kop `pagi`/`sore` memaksa.
- [ ] Draf sore selalu menyebut "Dibaca sebagai Update stok SORE" supaya karyawan tahu bagaimana bot membacanya.

## R. Barang masuk dari grup karyawan
- [ ] Karyawan kirim `Barang masuk:` + `nama : jumlah` (angka = jumlah yang masuk, bukan stok akhir) di grup, kapan saja, juga saat rekap sedang diisi.
- [ ] Bot menampilkan pratinjau "stok 50 -> 60" dengan tombol Simpan / Batal; stok belum berubah sebelum Simpan.
- [ ] Simpan menambah stok sekali; menekan Simpan lagi tidak menambah dua kali. Owner menerima laporan "BARANG MASUK DARI GRUP".
- [ ] Barang yang belum ada di katalog (mis. pertalite) dilaporkan "minta owner menambahkannya dulu" dan tidak ikut disimpan.
- [ ] Update stok sore sesudahnya memakai stok yang sudah termasuk barang masuk (penjualan terhitung benar, bukan "barang masuk?").
- [ ] Riwayat stok mencatat barang masuk (tipe IN) dengan nama karyawan.
- [ ] Kop lain yang sama artinya: `Tambah stok`, `Tambahkan stok`, `Stok masuk`, `Restock`; juga satu baris `Tambahkan stok axis 3 hari 10`.

## S. Kejadian uang tak terduga saat shift (uang masuk, uang keluar, bon)
- [ ] Di Update stok sore karyawan boleh menulis baris berulang dengan keterangan: `Uang masuk: 500 bayar utang pak Budi`, `Uang masuk: 1500 hp oppo`, `Uang keluar: 1190 belanja pertalite`, `Bon: 30 bu Sari 2 voucher`.
- [ ] Perkiraan uang = uang awal + barang laku + admin + uang masuk - uang keluar - bon; bila Total sama, hasilnya "cocok".
- [ ] Draf dan laporan owner memuat daftar kejadian beserta keterangannya.
- [ ] Tanpa baris itu, selisih tetap dilaporkan dengan saran menulis baris yang sesuai.
- [ ] Angka tanpa satuan ikut gaya ribuan Total; `500rb`, `1,5jt` dipakai apa adanya.
- [ ] Jangan menulis uang masuk yang sudah dicatat di aplikasi (mis. bayar utang lewat Web App), agar tidak terhitung dua kali.

## T. Ganti shift: satu laporan menutup shift lama dan memulai yang baru
- [ ] Hitungan pertama (belum ada shift sama sekali): `Update stok pagi` + stok + `Modal:` -> "SERAH TERIMA · SHIFT PAGI", shift pagi berjalan.
- [ ] Saat ganti shift, cukup SATU laporan (boleh oleh yang pulang atau yang masuk, dengan atau tanpa Admin): draf "REKAP SHIFT PAGI" -> penjualan pagi dicocokkan -> Selesai -> "Shift sore otomatis dimulai dari hitungan ini". Laporan owner berlabel shift yang ditutup.
- [ ] Bila yang satunya ikut melapor (kurang dari 3 jam setelah ganti shift): "SERAH TERIMA (cek ulang) · SHIFT SORE (dari shift pagi)", selisih angka dilaporkan, shift tidak ditutup lagi.
- [ ] Rantai berlanjut: sore -> begadang -> pagi besok; tiap laporan menutup shift sebelumnya.
- [ ] Nama di kop boleh nama shift yang selesai atau yang masuk.
- [ ] `Update stok buka` hanya untuk menyamakan stok dan uang awal (tanpa menghitung penjualan); `Update stok tutup` memaksa laporan penutup (mis. ganti shift kurang dari 3 jam).
- [ ] Draf yang belum ditekan Selesai belum memulai shift berikutnya.

## U. Ketepatan hitungan shift
- [ ] `Uang keluar: 6 juta 500` dan `6jt 500rb` dibaca Rp 6.500.000; `6 juta 5` ditanyakan ulang.
- [ ] Barang yang hitungannya lebih besar dari catatan tampil satu baris "📈 Lebih besar dari catatan ... disamakan saat Selesai"; setelah Selesai stok sistem naik ke hitungan itu dan owner menerima "STOK DINAIKKAN SESUAI HITUNGAN".
- [ ] Shift berikutnya menghitung penjualan barang itu (mis. pertalite 13 -> 3 = laku 10).
- [ ] `Tambah stok` yang disimpan saat draf belum ditekan Selesai tidak terhapus: stok akhir = hitungan + barang masuk.
- [ ] Catatan hitungan ringkas: satu baris per jenis (dibaca ribuan, uang di luar stok, laku, stok naik, belum ada di katalog).
