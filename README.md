# R CELL Management System (RCMS)

> Simple UI, Smart Automation. Pembukuan digital untuk konter HP.

PWA berbasis Next.js 15 + Prisma + PostgreSQL. Dibangun dengan filosofi *buku pembukuan digital yang cerdas, bukan ERP/POS*.

---

## ✨ Fitur

- **Dashboard otomatis** — Modal, Cash, Saldo, Inventory, Omzet, Profit, Alert stok
- **Inventory generik** — 1 modul untuk semua kategori (Accessories, Voucher, Rokok, Minyak, dll)
- **Voucher** dengan provider (Telkomsel/XL/Axis/Three/Smartfren/By.U/IM3) & masa aktif (3/5/7 hari/Standard)
- **Lokasi custom** — Rak 1-4, Etalase/Toples, Gudang (admin kelola)
- **Transaksi** — Penjualan (3-step wizard), Biaya Admin (rekap), Pengeluaran
- **Tutup Shift** — snapshot end-of-shift otomatis per user
- **Piutang / Bon** — customer hutang, catat cicilan, progress bar (karyawan boleh akses)
- **Stok Opname** — input hasil hitung fisik, sistem hitung selisih
- **Update Harga Massal** — set margin % per kategori/subkategori
- **Laporan otomatis** — filter tanggal, omzet/profit harian & bulanan
- **PWA** — installable, mobile-first, 1-tangan
- **2 mode user** (admin vs karyawan, tanpa label role) — angka sensitif di-XXXX untuk karyawan
- **Shift tracking** otomatis via username (siang/malam)
- **Backup JSON** & **Export Excel** untuk arsip

---

## 🛠 Tech Stack

- **Next.js 15** (App Router) + TypeScript strict
- **Prisma 5** + **PostgreSQL** (Neon recommended)
- **Tailwind CSS** + shadcn-style UI
- **next-themes** (light/dark)
- **recharts** (grafik dashboard)
- **exceljs** (export)
- **PWA** (manifest + service worker)

---

## 🚀 Deployment ke Vercel + Neon (15 menit)

### 1. Setup Neon Database (5 menit)

1. Buka **https://neon.tech** → Sign up gratis
2. **Create Project**:
   - Region: pilih terdekat (mis. Singapore untuk Indonesia)
   - Postgres version: 16 (default)
   - Project name: `rcms`
3. Copy **Connection String** — format:
   ```
   postgresql://USER:PASSWORD@ep-xxxxx.region.aws.neon.tech/rcms?sslmode=require
   ```
4. Simpan di tempat aman (password manager)

### 2. Push ke GitHub (3 menit)

```bash
cd Rcell
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/USERNAME/rcms.git
git push -u origin main
```

### 3. Deploy ke Vercel (5 menit)

1. Buka **https://vercel.com** → Sign up (pakai GitHub)
2. **Add New Project** → Import repo `rcms` dari GitHub
3. **Configure Project**:
   - Framework Preset: **Next.js** (auto-detect)
   - Root Directory: `./`
   - Build Command: `npm run build` (default)
   - Output Directory: `.next` (default)
4. **Environment Variables** (penting!):
   - Klik "Add Environment Variable"
   - Name: `DATABASE_URL`
   - Value: paste connection string Neon dari step 1
   - Environment: pilih **Production** (dan **Preview** jika mau)
5. Klik **Deploy**
6. Tunggu ~2-5 menit (build + install)

### 4. Setup Database (1-2 menit)

Setelah deploy pertama selesai, **JANGAN buka URL dulu**. Lanjut setup DB:

**Cara A: Via Vercel CLI (recommended)**
```bash
npm i -g vercel
vercel login
vercel link
vercel env pull .env.production
npx tsx scripts/deploy.ts
```

**Cara B: Via Neon SQL Editor (jika tidak mau install CLI)**
1. Buka Neon Dashboard → SQL Editor
2. Copy-paste isi `prisma/schema.prisma` → jalankan CREATE TABLE manual (tidak praktis)
3. **Rekomendasi: pakai Cara A**

**Cara C: Push manual ke Neon**
```bash
# Set DATABASE_URL sementara ke Neon
$env:DATABASE_URL = "postgresql://USER:PASSWORD@ep-xxxxx..."
npx prisma db push
npx tsx prisma/seed.ts
```

### 5. Buka Aplikasi

- URL Vercel: `https://rcms-xxx.vercel.app`
- Login pertama dengan:
  - **`admin` / `1234`** (owner) — **SEGERA GANTI PIN**
  - `shift1` / `1111` (karyawan siang)
  - `shift2` / `2222` (karyawan malam)
  - `karyawan` / `0000` (tanpa shift)

### 6. ⚠ WAJIB setelah deploy pertama

1. Login sebagai `admin / 1234`
2. **Ganti PIN** semua user (saat ini belum ada fitur ganti PIN — bisa langsung update di Neon SQL Editor, atau kita tambahkan di v2)
3. Update **Nama Toko** di Pengaturan
4. Set **Cash Awal** & **Saldo Awal** sesuai kondisi aktual
5. Download **Backup Database** (JSON) sebagai baseline
6. Setup **Custom Domain** (opsional, mis. `rcms.r-cell.id`) — di Vercel Domains

---

## 💻 Development Lokal

```bash
# 1. Install dependencies
npm install

# 2. Setup DB lokal (pilih salah satu)

# Opsi A: Postgres lokal
createdb rcms
# Set DATABASE_URL di .env
echo 'DATABASE_URL="postgresql://postgres:password@localhost:5432/rcms?schema=public"' > .env

# Opsi B: Neon branch gratis
# Buat branch di Neon Dashboard, copy connection string

# 3. Push schema + seed
npx prisma db push
npx tsx prisma/seed.ts

# 4. Run dev server
npm run dev
# → http://localhost:3000
```

### Login default (development)
- `admin` / `1234` (owner)
- `shift1` / `1111` (karyawan siang)
- `shift2` / `2222` (karyawan malam)
- `karyawan` / `0000` (tanpa shift)

---

## 📂 Struktur

```
src/
  app/
    login/              # Halaman login
    page.tsx            # Dashboard (/)
    inventory/          # Modul inventory
      [id]/             # Detail produk
    transaksi/          # Transaksi + tutup shift
    laporan/            # Laporan (owner only)
    harga/              # Cek barang & harga
      update-massal/    # Update harga massal (owner)
    piutang/            # Piutang / Bon
    opname/             # Stok opname (owner)
    pengaturan/         # Pengaturan toko
      lokasi/           # Kelola lokasi (owner)
    api/
      products/search/  # Global search API
      backup/download/  # Backup JSON
      export/excel/     # Export Excel
  components/           # UI components
  lib/
    automation.ts       # Semua kalkulasi otomatis
    actions.ts          # Server actions
    prisma.ts           # DB client
    auth.ts             # Session helper
    utils.ts            # Formatter dll
prisma/
  schema.prisma         # Database schema (15 tabel)
  seed.ts               # Data default
scripts/
  deploy.ts             # Helper deploy production
```

---

## 🔐 Default Users (WAJIB DIGANTI SEGERA)

| Username | PIN | Role | Shift |
|---|---|---|---|
| `admin` | `1234` | Owner | - |
| `shift1` | `1111` | Karyawan | Siang |
| `shift2` | `2222` | Karyawan | Malam |
| `karyawan` | `0000` | Karyawan | - |

**Saat ini belum ada fitur ganti PIN via UI** (v2). Untuk ganti sementara, langsung di Neon SQL Editor:
```sql
UPDATE "User" SET pin = 'newpin' WHERE username = 'admin';
```

---

## 💰 Biaya

- **Neon free tier**: 0.5 GB storage, 191 jam compute/bulan — **cukup untuk 1-2 tahun operasional**
- **Vercel free tier**: 100 GB bandwidth, 100K function executions/bulan — **cukup untuk 6-12 bulan normal**
- **Total: $0/bulan** untuk konter kecil-menengah

Estimasi kasar: dengan 4 user login/hari × 50 transaksi/hari × 30 hari = ~6000 transaksi/bulan, total compute < 5 jam/bulan (di bawah 3% dari quota free).

---

## 🐛 Troubleshooting

### "PrismaClientInitializationError" saat deploy
→ Cek `DATABASE_URL` di Vercel env vars. Pastikan format `?sslmode=require` di akhir.

### "Cold start lambat" (5-10 detik di request pertama)
→ Normal di Neon free tier. Request pertama wake up server, berikutnya cepat. Bisa di-mitigasi dengan cron job ping tiap 5 menit (opsional).

### Migration drift (schema tidak sync)
```bash
# Local: set DATABASE_URL ke Neon, lalu:
npx prisma db push
```

### Lupa PIN owner
→ Login ke Neon SQL Editor, reset manual:
```sql
UPDATE "User" SET pin = '0000' WHERE username = 'admin';
```

### Build error "Module not found"
→ Pastikan `npm install` berjalan sukses di Vercel. Cek build log di Vercel Dashboard.

---

## 📋 Checklist Deployment

- [ ] Neon project dibuat, connection string dicatat
- [ ] Repo push ke GitHub
- [ ] Vercel project dibuat, `DATABASE_URL` di-set
- [ ] First deploy success
- [ ] `npx tsx scripts/deploy.ts` dijalankan (schema + seed)
- [ ] Buka URL Vercel, login sebagai admin
- [ ] **Ganti semua PIN default**
- [ ] Set Cash Awal & Saldo Awal di Pengaturan
- [ ] Set Nama Toko
- [ ] Download Backup Database (JSON) sebagai baseline
- [ ] (Opsional) Setup custom domain

---

## 📝 License

Private / internal use untuk R-CELL.
