import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'RCMS';
  wb.created = new Date();

  // Sheet 1: Products
  const products = await prisma.product.findMany({
    include: { category: true, subcategory: true },
    orderBy: [{ category: { sortOrder: 'asc' } }, { name: 'asc' }],
  });
  const ws1 = wb.addWorksheet('Produk');
  ws1.columns = [
    { header: 'Kategori', key: 'kategori', width: 18 },
    { header: 'Subkategori', key: 'sub', width: 18 },
    { header: 'Nama', key: 'nama', width: 32 },
    { header: 'Modal', key: 'modal', width: 14, style: { numFmt: '"Rp "#,##0' } },
    { header: 'Harga Jual', key: 'jual', width: 14, style: { numFmt: '"Rp "#,##0' } },
    { header: 'Profit/Unit', key: 'profit', width: 14, style: { numFmt: '"Rp "#,##0' } },
    { header: 'Stok', key: 'stok', width: 8 },
    { header: 'Min Stok', key: 'min', width: 8 },
    { header: 'Nilai Modal', key: 'nilai_modal', width: 16, style: { numFmt: '"Rp "#,##0' } },
    { header: 'Nilai Jual', key: 'nilai_jual', width: 16, style: { numFmt: '"Rp "#,##0' } },
  ];
  for (const p of products) {
    const profit = Number(p.sellPrice - p.costPrice);
    ws1.addRow({
      kategori: p.category.name,
      sub: p.subcategory?.name ?? '',
      nama: p.name,
      modal: Number(p.costPrice),
      jual: Number(p.sellPrice),
      profit,
      stok: p.stock,
      min: p.minStock,
      nilai_modal: Number(p.costPrice) * p.stock,
      nilai_jual: Number(p.sellPrice) * p.stock,
    });
  }
  ws1.getRow(1).font = { bold: true };
  ws1.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE5E7EB' },
  };

  // Sheet 2: Sales
  const sales = await prisma.saleTransaction.findMany({
    include: { items: { include: { product: true } } },
    orderBy: { createdAt: 'desc' },
  });
  const ws2 = wb.addWorksheet('Penjualan');
  ws2.columns = [
    { header: 'Tanggal', key: 'tgl', width: 18 },
    { header: 'Produk', key: 'produk', width: 30 },
    { header: 'Qty', key: 'qty', width: 6 },
    { header: 'Harga', key: 'harga', width: 14, style: { numFmt: '"Rp "#,##0' } },
    { header: 'Revenue', key: 'rev', width: 14, style: { numFmt: '"Rp "#,##0' } },
    { header: 'Profit', key: 'prof', width: 14, style: { numFmt: '"Rp "#,##0' } },
  ];
  for (const s of sales) {
    for (const it of s.items) {
      ws2.addRow({
        tgl: s.createdAt,
        produk: it.product.name,
        qty: it.qty,
        harga: Number(it.priceAtSale),
        rev: Number(it.revenue),
        prof: Number(it.profit),
      });
    }
  }
  ws2.getRow(1).font = { bold: true };
  ws2.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE5E7EB' },
  };

  // Sheet 3: Biaya Admin
  const services = await prisma.serviceTransaction.findMany({
    orderBy: { createdAt: 'desc' },
  });
  const ws3 = wb.addWorksheet('Biaya Admin');
  ws3.columns = [
    { header: 'Tanggal', key: 'tgl', width: 18 },
    { header: 'Jumlah Transaksi', key: 'jumlah', width: 18 },
    { header: 'Total Admin / Profit', key: 'profit', width: 20, style: { numFmt: '"Rp "#,##0' } },
  ];
  for (const s of services) {
    ws3.addRow({
      tgl: s.createdAt,
      jumlah: s.count,
      profit: Number(s.profit),
    });
  }
  ws3.getRow(1).font = { bold: true };
  ws3.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE5E7EB' },
  };

  // Sheet 4: Expenses
  const expenses = await prisma.expense.findMany({ orderBy: { createdAt: 'desc' } });
  const ws4 = wb.addWorksheet('Pengeluaran');
  ws4.columns = [
    { header: 'Tanggal', key: 'tgl', width: 18 },
    { header: 'Nama', key: 'nama', width: 30 },
    { header: 'Nominal', key: 'nom', width: 14, style: { numFmt: '"Rp "#,##0' } },
  ];
  for (const e of expenses) {
    ws4.addRow({ tgl: e.createdAt, nama: e.name, nom: Number(e.amount) });
  }
  ws4.getRow(1).font = { bold: true };
  ws4.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE5E7EB' },
  };

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf, {
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="rcms-export-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}
