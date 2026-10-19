// Draf aksi asisten yang bersifat umum (selain penjualan, cek stok, dan
// tambah/ubah katalog yang punya alur sendiri). Server hanya menyiapkan draf;
// tidak ada yang tersimpan sampai owner/karyawan menekan konfirmasi.

export type AssistantAction =
  | 'catalog.delete'
  | 'catalog.cleanup'
  | 'category.create'
  | 'category.rename'
  | 'category.delete'
  | 'subcategory.create'
  | 'subcategory.rename'
  | 'subcategory.delete'
  | 'price.bulk'
  | 'stock.in'
  | 'stock.adjust'
  | 'opname.record'
  | 'opname.apply'
  | 'opname.review'
  | 'opname.delete'
  | 'debt.create'
  | 'debt.pay'
  | 'debt.delete'
  | 'expense.create'
  | 'service.create'
  | 'shift.close'
  | 'memory.save'
  | 'memory.forget';

export type DraftLine = { label: string; value: string; emphasis?: boolean };

export type AssistantDraft = {
  action: AssistantAction;
  title: string;
  lines: DraftLine[];
  payload: Record<string, unknown>;
};

const ASSISTANT_ACTIONS: readonly AssistantAction[] = [
  'catalog.delete', 'catalog.cleanup',
  'category.create', 'category.rename', 'category.delete',
  'subcategory.create', 'subcategory.rename', 'subcategory.delete',
  'price.bulk', 'stock.in', 'stock.adjust',
  'opname.record', 'opname.apply', 'opname.review', 'opname.delete',
  'debt.create', 'debt.pay', 'debt.delete',
  'expense.create', 'service.create', 'shift.close',
  'memory.save', 'memory.forget',
];

export const MEMORY_KINDS = ['SYNONYM', 'STYLE', 'PREFERENCE'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export function isMemoryKind(value: unknown): value is MemoryKind {
  return typeof value === 'string' && (MEMORY_KINDS as readonly string[]).includes(value);
}

export const MEMORY_KIND_LABELS: Record<MemoryKind, string> = {
  SYNONYM: 'Istilah/sinonim',
  STYLE: 'Cara bicara & sapaan',
  PREFERENCE: 'Preferensi & aturan toko',
};

export function isAssistantAction(value: unknown): value is AssistantAction {
  return typeof value === 'string' && (ASSISTANT_ACTIONS as readonly string[]).includes(value);
}

// Karyawan hanya boleh menyiapkan/menjalankan aksi bon; sisanya khusus owner.
export const EMPLOYEE_ALLOWED_ACTIONS: readonly AssistantAction[] = ['debt.create', 'debt.pay'];

export function actionRequiresOwner(action: AssistantAction) {
  return !EMPLOYEE_ALLOWED_ACTIONS.includes(action);
}

const idr = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });

export function formatIDR(value: bigint | number | string) {
  return idr.format(Number(value));
}
