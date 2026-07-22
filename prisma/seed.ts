import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding RCMS...');

  // Settings
  await prisma.settings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      storeName: 'R CELL',
      cashInitial: 5_000_000n,
      balanceInitial: 15_000_000n,
      theme: 'system',
    },
  });

  // Default users: owner + 2 shift karyawan
  await prisma.user.deleteMany();
  await prisma.user.create({
    data: { username: 'admin', pin: '1234', role: 'owner' },
  });
  await prisma.user.create({
    data: { username: 'shift1', pin: '1111', role: 'karyawan', shift: 'siang' },
  });
  await prisma.user.create({
    data: { username: 'shift2', pin: '2222', role: 'karyawan', shift: 'malam' },
  });
  await prisma.user.create({
    data: { username: 'karyawan', pin: '0000', role: 'karyawan' },
  });

  // Bersihkan data master (untuk idempotent seed)
  await prisma.saleItem.deleteMany();
  await prisma.saleTransaction.deleteMany();
  await prisma.serviceTransaction.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.inventoryMovement.deleteMany();
  await prisma.product.deleteMany();
  await prisma.subcategory.deleteMany();
  await prisma.category.deleteMany();

  // Categories + Subcategories
  // Default Locations (admin bisa tambah/hapus nanti)
  const locRak1 = await prisma.location.create({ data: { name: 'Rak 1', sortOrder: 1 } });
  const locRak2 = await prisma.location.create({ data: { name: 'Rak 2', sortOrder: 2 } });
  const locRak3 = await prisma.location.create({ data: { name: 'Rak 3', sortOrder: 3 } });
  const locRak4 = await prisma.location.create({ data: { name: 'Rak 4', sortOrder: 4 } });
  const locEtalaseDepan = await prisma.location.create({ data: { name: 'Etalase Depan', sortOrder: 5 } });
  const locEtalaseSamping = await prisma.location.create({ data: { name: 'Etalase Samping', sortOrder: 6 } });
  const locToplesDepan = await prisma.location.create({ data: { name: 'Toples Depan', sortOrder: 7 } });
  const locToplesSamping = await prisma.location.create({ data: { name: 'Toples Samping', sortOrder: 8 } });

  const accessories = await prisma.category.create({
    data: { name: 'Accessories', sortOrder: 1 },
  });
  const accSubs = await Promise.all([
    prisma.subcategory.create({ data: { categoryId: accessories.id, name: 'Tempered Glass' } }),
    prisma.subcategory.create({ data: { categoryId: accessories.id, name: 'Hydrogel' } }),
    prisma.subcategory.create({ data: { categoryId: accessories.id, name: 'Case' } }),
    prisma.subcategory.create({ data: { categoryId: accessories.id, name: 'Charger' } }),
    prisma.subcategory.create({ data: { categoryId: accessories.id, name: 'Kabel Data' } }),
    prisma.subcategory.create({ data: { categoryId: accessories.id, name: 'Power Bank' } }),
    prisma.subcategory.create({ data: { categoryId: accessories.id, name: 'Earphone' } }),
  ]);

  const voucher = await prisma.category.create({
    data: { name: 'Voucher', sortOrder: 2 },
  });
  const voucherSubs = await Promise.all([
    prisma.subcategory.create({ data: { categoryId: voucher.id, name: 'Pulsa' } }),
    prisma.subcategory.create({ data: { categoryId: voucher.id, name: 'Paket Data' } }),
  ]);

  await prisma.category.create({ data: { name: 'Kartu Perdana', sortOrder: 3 } });
  const rokok = await prisma.category.create({ data: { name: 'Rokok', sortOrder: 4 } });
  // Subkategori rokok = jenis (putih/kretek/cerutu/rokok elektrik)
  await prisma.subcategory.create({ data: { categoryId: rokok.id, name: 'Putih' } });
  await prisma.subcategory.create({ data: { categoryId: rokok.id, name: 'Kretek' } });
  await prisma.subcategory.create({ data: { categoryId: rokok.id, name: 'Elektrik' } });
  const service = await prisma.category.create({
    data: { name: 'Service', sortOrder: 5 },
  });
  await prisma.subcategory.create({ data: { categoryId: service.id, name: 'Top Up' } });
  await prisma.subcategory.create({ data: { categoryId: service.id, name: 'Transfer' } });
  await prisma.subcategory.create({ data: { categoryId: service.id, name: 'Tarik Tunai' } });
  const lainnya = await prisma.category.create({ data: { name: 'Lainnya', sortOrder: 6 } });
  await prisma.subcategory.create({ data: { categoryId: lainnya.id, name: 'Minyak' } });

  // Sample products
  const tg = accSubs[0];
  const hydro = accSubs[1];

  // Voucher: provider dengan 3 masa aktif (Telkomsel, XL, Axis, Three)
  //          provider dengan 1 masa aktif (Smartfren, By.U, IM3)
  const multiProvider = ['Telkomsel', 'XL', 'Axis', 'Three'];
  const singleProvider = ['Smartfren', 'By.U', 'IM3'];
  const validities = ['3 hari', '5 hari', '7 hari'];

  // Paket data 10GB (default name) untuk semua provider
  await prisma.product.createMany({
    data: [
      {
        name: 'Samsung A16 TG',
        categoryId: accessories.id,
        subcategoryId: tg.id,
        locationId: locRak1.id,
        costPrice: 8000n,
        sellPrice: 18000n,
        stock: 3,
        minStock: 5,
      },
      {
        name: 'Xiaomi Redmi 13 TG',
        categoryId: accessories.id,
        subcategoryId: tg.id,
        locationId: locRak1.id,
        costPrice: 8000n,
        sellPrice: 15000n,
        stock: 12,
        minStock: 5,
      },
      {
        name: 'iPhone 15 TG',
        categoryId: accessories.id,
        subcategoryId: tg.id,
        locationId: locRak1.id,
        costPrice: 15000n,
        sellPrice: 35000n,
        stock: 8,
        minStock: 3,
      },
      {
        name: 'Samsung A16 Hydrogel',
        categoryId: accessories.id,
        subcategoryId: hydro.id,
        locationId: locRak2.id,
        costPrice: 12000n,
        sellPrice: 25000n,
        stock: 6,
        minStock: 3,
      },
      {
        name: 'Charger Fast 18W',
        categoryId: accessories.id,
        subcategoryId: accSubs[3].id,
        locationId: locRak3.id,
        costPrice: 35000n,
        sellPrice: 65000n,
        stock: 10,
        minStock: 4,
      },
      {
        name: 'Kabel Type-C 1m',
        categoryId: accessories.id,
        subcategoryId: accSubs[4].id,
        locationId: locRak3.id,
        costPrice: 8000n,
        sellPrice: 20000n,
        stock: 25,
        minStock: 10,
      },
    ],
  });

  // Voucher multi-provider (Telkomsel/XL/Axis/Three) × (3/5/7 hari)
  for (const prov of multiProvider) {
    for (const v of validities) {
      await prisma.product.create({
        data: {
          name: `Paket Data 10GB ${prov}`,
          categoryId: voucher.id,
          subcategoryId: voucherSubs[1].id,
          provider: prov,
          validity: v,
          locationId: locEtalaseDepan.id,
          costPrice: 25000n,
          sellPrice: 30000n,
          stock: 20,
          minStock: 5,
        },
      });
    }
  }

  // Voucher single-provider (Smartfren/By.U/IM3)
  for (const prov of singleProvider) {
    await prisma.product.create({
      data: {
        name: `Paket Data 10GB ${prov}`,
        categoryId: voucher.id,
        subcategoryId: voucherSubs[1].id,
        provider: prov,
        validity: 'Standard',
        locationId: locEtalaseDepan.id,
        costPrice: 25000n,
        sellPrice: 30000n,
        stock: 15,
        minStock: 5,
      },
    });
  }

  // Rokok - perputaran cepat, banyak varian
  // Putih: Surya, Dunhill, Marlboro, Lucky Strike, Camel
  // Kretek: Gudang Garam, Djarum, Sampoerna, LA Lights, Esse
  const rokokPutih = await prisma.subcategory.findFirst({ where: { categoryId: rokok.id, name: 'Putih' } });
  const rokokKretek = await prisma.subcategory.findFirst({ where: { categoryId: rokok.id, name: 'Kretek' } });
  const rokokElektrik = await prisma.subcategory.findFirst({ where: { categoryId: rokok.id, name: 'Elektrik' } });

  await prisma.product.createMany({
    data: [
      { name: 'Surya 12', categoryId: rokok.id, subcategoryId: rokokPutih?.id, locationId: locRak4.id, costPrice: 25000n, sellPrice: 27000n, stock: 30, minStock: 10 },
      { name: 'Surya 16', categoryId: rokok.id, subcategoryId: rokokPutih?.id, locationId: locRak4.id, costPrice: 28000n, sellPrice: 30000n, stock: 30, minStock: 10 },
      { name: 'Dunhill 12', categoryId: rokok.id, subcategoryId: rokokPutih?.id, locationId: locRak4.id, costPrice: 23000n, sellPrice: 25000n, stock: 25, minStock: 8 },
      { name: 'Marlboro Red 12', categoryId: rokok.id, subcategoryId: rokokPutih?.id, locationId: locRak4.id, costPrice: 30000n, sellPrice: 32000n, stock: 20, minStock: 8 },
      { name: 'Marlboro Ice Burst 12', categoryId: rokok.id, subcategoryId: rokokPutih?.id, locationId: locRak4.id, costPrice: 30000n, sellPrice: 32000n, stock: 15, minStock: 5 },
      { name: 'Lucky Strike 12', categoryId: rokok.id, subcategoryId: rokokPutih?.id, locationId: locRak4.id, costPrice: 22000n, sellPrice: 24000n, stock: 20, minStock: 5 },
      { name: 'Camel 12', categoryId: rokok.id, subcategoryId: rokokPutih?.id, locationId: locRak4.id, costPrice: 23000n, sellPrice: 25000n, stock: 15, minStock: 5 },
      { name: 'Gudang Garam Surya Pro 12', categoryId: rokok.id, subcategoryId: rokokKretek?.id, locationId: locRak4.id, costPrice: 23000n, sellPrice: 25000n, stock: 25, minStock: 8 },
      { name: 'Gudang Garam Signature 12', categoryId: rokok.id, subcategoryId: rokokKretek?.id, locationId: locRak4.id, costPrice: 30000n, sellPrice: 32000n, stock: 20, minStock: 8 },
      { name: 'Djarum Super 12', categoryId: rokok.id, subcategoryId: rokokKretek?.id, locationId: locRak4.id, costPrice: 22000n, sellPrice: 24000n, stock: 25, minStock: 8 },
      { name: 'Sampoerna A Mild 12', categoryId: rokok.id, subcategoryId: rokokKretek?.id, locationId: locRak4.id, costPrice: 23000n, sellPrice: 25000n, stock: 30, minStock: 10 },
      { name: 'Sampoerna A Menthol 12', categoryId: rokok.id, subcategoryId: rokokKretek?.id, locationId: locRak4.id, costPrice: 23000n, sellPrice: 25000n, stock: 20, minStock: 8 },
      { name: 'LA Lights 12', categoryId: rokok.id, subcategoryId: rokokKretek?.id, locationId: locRak4.id, costPrice: 22000n, sellPrice: 24000n, stock: 25, minStock: 8 },
      { name: 'Esse Change 16', categoryId: rokok.id, subcategoryId: rokokKretek?.id, locationId: locRak4.id, costPrice: 25000n, sellPrice: 27000n, stock: 15, minStock: 5 },
      // Elektrik (liquid/pod) - biasanya di etalase khusus
      { name: 'Liquid 3mg 30ml', categoryId: rokok.id, subcategoryId: rokokElektrik?.id, locationId: locEtalaseSamping.id, costPrice: 50000n, sellPrice: 70000n, stock: 10, minStock: 3 },
      { name: 'Liquid 6mg 30ml', categoryId: rokok.id, subcategoryId: rokokElektrik?.id, locationId: locEtalaseSamping.id, costPrice: 50000n, sellPrice: 70000n, stock: 10, minStock: 3 },
      { name: 'Pod Refill', categoryId: rokok.id, subcategoryId: rokokElektrik?.id, locationId: locEtalaseSamping.id, costPrice: 25000n, sellPrice: 35000n, stock: 15, minStock: 5 },
    ],
  });

  // Minyak - kategori Lainnya > Minyak (biasanya di toples/jerigen besar)
  const minyakSub = await prisma.subcategory.findFirst({ where: { categoryId: lainnya.id, name: 'Minyak' } });
  await prisma.product.createMany({
    data: [
      { name: 'Minyak Tanah 1L', categoryId: lainnya.id, subcategoryId: minyakSub?.id, locationId: locToplesSamping.id, costPrice: 12000n, sellPrice: 15000n, stock: 30, minStock: 10 },
      { name: 'Minyak Kayu Putih 100ml', categoryId: lainnya.id, subcategoryId: minyakSub?.id, locationId: locToplesDepan.id, costPrice: 18000n, sellPrice: 22000n, stock: 15, minStock: 5 },
      { name: 'Minyak Goreng 1L', categoryId: lainnya.id, subcategoryId: minyakSub?.id, locationId: locToplesSamping.id, costPrice: 16000n, sellPrice: 19000n, stock: 20, minStock: 8 },
      { name: 'Minyak Goreng 2L', categoryId: lainnya.id, subcategoryId: minyakSub?.id, locationId: locToplesSamping.id, costPrice: 30000n, sellPrice: 35000n, stock: 15, minStock: 5 },
      { name: 'Minyak Kemiri', categoryId: lainnya.id, subcategoryId: minyakSub?.id, locationId: locToplesDepan.id, costPrice: 20000n, sellPrice: 25000n, stock: 10, minStock: 3 },
    ],
  });

  console.log('✅ Seed selesai. Buka http://localhost:3000');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
