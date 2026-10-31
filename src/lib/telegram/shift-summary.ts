// Ringkasan rekap shift Telegram untuk laporan owner.
// Web App sudah tidak dipakai, jadi rekap Telegram yang terkonfirmasi adalah sumber angka utama.
// Modul ini murni (tanpa database) agar mudah dites.

export type RecapReportRow = { confirmedAt: Date; shiftLabel: string | null; payload: unknown };
export type RecapSummary = { sale: bigint; serviceFee: bigint; expense: bigint; count: number };
export type DailyRecapSummary = RecapSummary & { date: string };

export type RecapCategoryKey = 'sale' | 'service_fee' | 'expense';

export function reportedRecapTotal(payload: unknown, category: RecapCategoryKey): bigint {
  if (!payload || typeof payload !== 'object' || !('totals' in payload)) return 0n;
  const totals = (payload as { totals?: unknown }).totals;
  if (!totals || typeof totals !== 'object' || !(category in totals)) return 0n;
  const value = (totals as Record<string, unknown>)[category];
  return typeof value === 'string' && /^\d{1,16}$/.test(value) ? BigInt(value) : 0n;
}

export function emptyRecapSummary(): RecapSummary {
  return { sale: 0n, serviceFee: 0n, expense: 0n, count: 0 };
}

export function sumRecapReports(rows: RecapReportRow[]): RecapSummary {
  return rows.reduce<RecapSummary>((total, row) => ({
    sale: total.sale + reportedRecapTotal(row.payload, 'sale'),
    serviceFee: total.serviceFee + reportedRecapTotal(row.payload, 'service_fee'),
    expense: total.expense + reportedRecapTotal(row.payload, 'expense'),
    count: total.count + 1,
  }), emptyRecapSummary());
}

// Tanggal kalender WIB (UTC+7) dalam format YYYY-MM-DD.
export function jakartaDateKey(date: Date): string {
  return new Date(date.getTime() + 7 * 60 * 60_000).toISOString().slice(0, 10);
}

export function dailyRecapSummaries(rows: RecapReportRow[]): DailyRecapSummary[] {
  const byDate = new Map<string, RecapReportRow[]>();
  for (const row of rows) {
    const key = jakartaDateKey(row.confirmedAt);
    byDate.set(key, [...(byDate.get(key) ?? []), row]);
  }
  return [...byDate.entries()]
    .map(([date, group]) => ({ date, ...sumRecapReports(group) }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

// Pemasukan kotor dikurangi pengeluaran. Ini BUKAN laba: modal barang tidak ada di rekap.
export function recapNetAfterExpense(summary: RecapSummary): bigint {
  return summary.sale + summary.serviceFee - summary.expense;
}

export function formatRecapReport(input: {
  dateLabel: string;
  shift: string | null;
  today: RecapSummary;
  recent: DailyRecapSummary[];
  topItems: string[];
  formatMoney: (value: bigint) => string;
}): string {
  const { today, formatMoney: money } = input;
  const lines: string[] = [];
  lines.push('Ringkasan rekap shift — ' + input.dateLabel + ' (WIB)' + (input.shift ? ' · shift ' + input.shift : ''));
  if (!today.count) {
    lines.push('Belum ada rekap shift terkonfirmasi untuk tanggal ini.');
  } else {
    lines.push(
      'Jumlah rekap: ' + today.count,
      'Omzet barang: ' + money(today.sale),
      'Admin jasa (TF + tarik tunai): ' + money(today.serviceFee),
      'Pengeluaran: ' + money(today.expense),
      'Sisa setelah pengeluaran: ' + money(recapNetAfterExpense(today)),
    );
  }
  if (input.topItems.length) lines.push('', 'Barang terpotong stok dari rekap:', ...input.topItems);
  if (input.recent.length) {
    lines.push('', 'Tren harian (omzet barang + admin jasa − pengeluaran):');
    for (const day of input.recent) lines.push('• ' + day.date + ': ' + money(recapNetAfterExpense(day)) + ' (' + day.count + ' rekap)');
  }
  lines.push('', 'Angka berasal dari rekap yang dikonfirmasi karyawan. Laba tidak dihitung karena modal barang tidak ada di rekap.');
  return lines.join('\n');
}

// Membaca angka pembanding dari tugas tinjauan selisih saldo shift.
export function parseBalanceTaskTarget(payload: unknown): { actual: bigint; expected: bigint; opening: bigint } | null {
  if (!payload || typeof payload !== 'object') return null;
  const check = (payload as { check?: unknown }).check;
  if (!check || typeof check !== 'object') return null;
  const read = (key: string): bigint | null => {
    const value = (check as Record<string, unknown>)[key];
    return typeof value === 'string' && /^-?\d{1,16}$/.test(value) ? BigInt(value) : null;
  };
  const actual = read('actualBalance'), expected = read('expectedBalance'), opening = read('openingBalance');
  return actual === null || expected === null || opening === null ? null : { actual, expected, opening };
}
