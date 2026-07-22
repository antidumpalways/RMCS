'use client';

import * as React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Wallet, Plus, CheckCircle2, AlertCircle, Wallet2 } from 'lucide-react';
import { createDebt, addDebtPayment, deleteDebt } from '@/lib/actions';
import { useToast } from '@/components/ui/toast';
import { formatRupiah, formatDateTimeID } from '@/lib/utils';
import { ShiftBadge } from '@/components/shift-badge';

type Payment = { id: number; amount: number; note: string | null; createdAt: string };
type Debt = {
  id: number;
  customer: string;
  amount: number;
  paid: number;
  description: string | null;
  status: string;
  userShift: string | null;
  userName: string | null;
  createdAt: string;
  updatedAt: string;
  payments: Payment[];
};

type Props = {
  isKaryawan: boolean;
  debts: Debt[];
};

export function PiutangClient({ isKaryawan, debts }: Props) {
  const toast = useToast();
  const [filter, setFilter] = React.useState<'all' | 'BELUM' | 'LUNAS'>('BELUM');

  const filtered = debts.filter((d) => filter === 'all' || d.status === filter);
  const totalBelum = debts.filter((d) => d.status === 'BELUM').reduce((a, d) => a + (d.amount - d.paid), 0);
  const totalLunas = debts.filter((d) => d.status === 'LUNAS').reduce((a, d) => a + d.amount, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">Piutang / Bon</h1>
          <p className="text-xs text-muted-foreground">
            Daftar customer yang belum bayar
          </p>
        </div>
        <AddDebtDialog onAdded={() => toast({ title: 'Piutang ditambah' })} />
      </div>

      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 dark:border-rose-900 dark:bg-rose-950/30">
          <div className="text-[10px] uppercase text-rose-700 dark:text-rose-400">Belum Lunas</div>
          <div className="text-base font-bold text-rose-700 dark:text-rose-400">
            {formatRupiah(totalBelum)}
          </div>
        </div>
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
          <div className="text-[10px] uppercase text-emerald-700 dark:text-emerald-400">Sudah Lunas</div>
          <div className="text-base font-bold text-emerald-700 dark:text-emerald-400">
            {formatRupiah(totalLunas)}
          </div>
        </div>
      </div>

      <div className="flex gap-1.5">
        <Button size="sm" variant={filter === 'BELUM' ? 'default' : 'outline'} onClick={() => setFilter('BELUM')}>
          Belum Lunas
        </Button>
        <Button size="sm" variant={filter === 'LUNAS' ? 'default' : 'outline'} onClick={() => setFilter('LUNAS')}>
          Lunas
        </Button>
        <Button size="sm" variant={filter === 'all' ? 'default' : 'outline'} onClick={() => setFilter('all')}>
          Semua
        </Button>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Wallet className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
            <div className="text-sm text-muted-foreground">
              {filter === 'BELUM' ? 'Tidak ada piutang aktif' : 'Belum ada piutang'}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((d) => (
            <DebtCard
              key={d.id}
              debt={d}
              isKaryawan={isKaryawan}
              onPaid={() => toast({ title: 'Pembayaran dicatat' })}
              onDeleted={() => toast({ title: 'Piutang dihapus' })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DebtCard({
  debt,
  isKaryawan,
  onPaid,
  onDeleted,
}: {
  debt: Debt;
  isKaryawan: boolean;
  onPaid: () => void;
  onDeleted: () => void;
}) {
  const remaining = debt.amount - debt.paid;
  const progress = (debt.paid / debt.amount) * 100;
  const isLunas = debt.status === 'LUNAS';

  return (
    <Card className={isLunas ? 'border-emerald-200 dark:border-emerald-900' : 'border-rose-200 dark:border-rose-900'}>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="font-semibold">{debt.customer}</div>
              {isLunas ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <AlertCircle className="h-3.5 w-3.5 text-rose-500" />
              )}
              <ShiftBadge userShift={debt.userShift} userName={debt.userName} />
            </div>
            {debt.description && (
              <div className="mt-0.5 text-xs text-muted-foreground">{debt.description}</div>
            )}
            <div className="mt-0.5 text-[10px] text-muted-foreground">
              {formatDateTimeID(debt.createdAt)}
            </div>
          </div>
          <div className="text-right shrink-0">
            {!isKaryawan ? (
              <div className="text-sm font-bold">{formatRupiah(debt.amount)}</div>
            ) : (
              <div className="text-sm font-bold text-muted-foreground">Rp •••••</div>
            )}
            <div className="text-[10px] text-muted-foreground">
              Sisa {!isKaryawan ? formatRupiah(remaining) : 'Rp •••••'}
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={isLunas ? 'h-full bg-emerald-500' : 'h-full bg-rose-500'}
            style={{ width: `${Math.min(100, progress)}%` }}
          />
        </div>

        {!isLunas && (
          <div className="flex items-center gap-2">
            <PayDebtDialog debtId={debt.id} remaining={remaining} onDone={onPaid} />
            {!isKaryawan && (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                onClick={async () => {
                  if (confirm(`Hapus piutang ${debt.customer}?`)) {
                    await deleteDebt(debt.id);
                    onDeleted();
                  }
                }}
              >
                Hapus
              </Button>
            )}
          </div>
        )}

        {debt.payments.length > 0 && !isKaryawan && (
          <div className="border-t pt-2">
            <div className="mb-1 text-[10px] uppercase text-muted-foreground">Riwayat Bayar</div>
            <div className="space-y-1">
              {debt.payments.map((p) => (
                <div key={p.id} className="flex justify-between text-xs">
                  <span className="text-muted-foreground">
                    {formatDateTimeID(p.createdAt)}
                    {p.note && ` · ${p.note}`}
                  </span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                    +{formatRupiah(p.amount)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AddDebtDialog({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [customer, setCustomer] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [description, setDescription] = React.useState('');

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 h-4 w-4" /> Bon
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tambah Bon</DialogTitle>
        </DialogHeader>
        <form
          action={async (fd) => {
            try {
              await createDebt({
                customer,
                amount,
                description,
              });
              setOpen(false);
              setCustomer('');
              setAmount('');
              setDescription('');
              onAdded();
            } catch (e) {
              alert((e as Error).message);
            }
          }}
          className="space-y-3"
        >
          <div className="space-y-1">
            <Label>Nama Customer</Label>
            <Input
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              placeholder="mis. Pak Budi"
              required
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <Label>Nominal</Label>
            <Input
              type="number"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              required
              min={1}
            />
          </div>
          <div className="space-y-1">
            <Label>Keterangan (opsional)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="mis. 2 case iPhone + 1 charger"
              rows={2}
            />
          </div>
          <Button type="submit" className="w-full">
            Simpan
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PayDebtDialog({
  debtId,
  remaining,
  onDone,
}: {
  debtId: number;
  remaining: number;
  onDone: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [amount, setAmount] = React.useState('');
  const [note, setNote] = React.useState('');

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="flex-1">
          <Wallet2 className="mr-1 h-4 w-4" /> Catat Bayar
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Catat Pembayaran</DialogTitle>
        </DialogHeader>
        <form
          action={async (fd) => {
            try {
              await addDebtPayment({ debtId, amount, note });
              setOpen(false);
              setAmount('');
              setNote('');
              onDone();
            } catch (e) {
              alert((e as Error).message);
            }
          }}
          className="space-y-3"
        >
          <div className="rounded-lg bg-muted p-2 text-xs">
            Sisa hutang: <strong>{formatRupiah(remaining)}</strong>
          </div>
          <div className="space-y-1">
            <Label>Nominal Bayar</Label>
            <Input
              type="number"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              required
              min={1}
              max={remaining}
              autoFocus
            />
          </div>
          <div className="space-y-1">
            <Label>Catatan (opsional)</Label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="mis. Cicilan ke-1"
            />
          </div>
          <Button type="submit" className="w-full">
            Catat
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
