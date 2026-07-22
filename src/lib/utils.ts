import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const IDR = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});

const IDR_SHORT = new Intl.NumberFormat('id-ID', {
  maximumFractionDigits: 0,
});

export function formatRupiah(n: number | bigint | null | undefined): string {
  if (n === null || n === undefined) return 'Rp 0';
  return IDR.format(typeof n === 'bigint' ? Number(n) : n);
}

export function formatRupiahShort(n: number | bigint | null | undefined): string {
  if (n === null || n === undefined) return '0';
  const v = typeof n === 'bigint' ? Number(n) : n;
  return IDR_SHORT.format(v);
}

export function formatNumber(n: number | bigint | null | undefined): string {
  if (n === null || n === undefined) return '0';
  return IDR_SHORT.format(typeof n === 'bigint' ? Number(n) : n);
}

export function toBigIntSafe(v: unknown): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') return BigInt(Math.trunc(v));
  if (typeof v === 'string') {
    const cleaned = v.replace(/[^\d-]/g, '');
    if (cleaned === '' || cleaned === '-') return 0n;
    return BigInt(cleaned);
  }
  return 0n;
}

export function startOfDay(d: Date = new Date()): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfDay(d: Date = new Date()): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function startOfMonth(d: Date = new Date()): Date {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function endOfMonth(d: Date = new Date()): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + 1, 0);
  x.setHours(23, 59, 59, 999);
  return x;
}

export function formatDateID(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTimeID(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function toDateInputLocal(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
