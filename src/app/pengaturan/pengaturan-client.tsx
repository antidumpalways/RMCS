'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Store, Wallet, CreditCard, MapPin, Palette, Database, FileSpreadsheet, Save, TrendingUp, ClipboardCheck } from 'lucide-react';
import { formatRupiah } from '@/lib/utils';
import { updateSettings } from '@/lib/actions';
import { useToast } from '@/components/ui/toast';
import { useTheme } from 'next-themes';

type Props = {
  isKaryawan: boolean;
  settings: {
    storeName: string;
    cashInitial: number;
    balanceInitial: number;
    theme: string;
  };
};

export function PengaturanClient({ isKaryawan, settings }: Props) {
  const router = useRouter();
  const toast = useToast();
  const { setTheme } = useTheme();
  const [storeName, setStoreName] = React.useState(settings.storeName);
  const [cash, setCash] = React.useState(String(settings.cashInitial));
  const [saldo, setSaldo] = React.useState(String(settings.balanceInitial));
  const [theme, setThemeLocal] = React.useState(settings.theme);
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await updateSettings({
        storeName,
        cashInitial: Number(cash) || 0,
        balanceInitial: Number(saldo) || 0,
        theme,
      });
      setTheme(theme === 'system' ? 'system' : theme);
      toast({ title: 'Pengaturan disimpan' });
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Pengaturan</h1>
        <p className="text-xs text-muted-foreground">Data dasar toko</p>
      </div>

      {!isKaryawan && (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2">
                <Store className="h-4 w-4" /> Identitas Toko
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label>Nama Toko</Label>
                <Input
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  placeholder="R CELL"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2">
                <Wallet className="h-4 w-4" /> Saldo Awal
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label className="flex items-center gap-1.5">
                  <Wallet className="h-3.5 w-3.5" /> Cash
                </Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={cash}
                  onChange={(e) => setCash(e.target.value)}
                  placeholder="0"
                />
                <p className="text-xs text-muted-foreground">Uang tunai di laci</p>
              </div>
              <div className="space-y-1">
                <Label className="flex items-center gap-1.5">
                  <CreditCard className="h-3.5 w-3.5" /> Saldo
                </Label>
                <Input
                  type="number"
                  inputMode="numeric"
                  value={saldo}
                  onChange={(e) => setSaldo(e.target.value)}
                  placeholder="0"
                />
                <p className="text-xs text-muted-foreground">Total e-wallet/rekening</p>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-4 w-4" /> Tema
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={theme} onValueChange={setThemeLocal}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
              <SelectItem value="system">System</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Button onClick={save} disabled={saving} className="w-full" size="lg">
        <Save className="mr-2 h-4 w-4" />
        {saving ? 'Menyimpan...' : 'Simpan Pengaturan'}
      </Button>

      {!isKaryawan && (
        <Link href="/pengaturan/lokasi">
          <Card className="transition-colors hover:bg-muted/40">
            <CardContent className="flex items-center gap-3 p-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400">
                <MapPin className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <div className="font-medium">Kelola Lokasi</div>
                <div className="text-xs text-muted-foreground">
                  Tambah/edit lokasi penyimpanan barang
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>
      )}

      {!isKaryawan && (
        <Link href="/harga/update-massal">
          <Card className="transition-colors hover:bg-muted/40">
            <CardContent className="flex items-center gap-3 p-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400">
                <TrendingUp className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <div className="font-medium">Update Harga Massal</div>
                <div className="text-xs text-muted-foreground">
                  Set margin % → update harga jual otomatis
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>
      )}

      {!isKaryawan && (
        <Link href="/opname">
          <Card className="transition-colors hover:bg-muted/40">
            <CardContent className="flex items-center gap-3 p-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400">
                <ClipboardCheck className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <div className="font-medium">Stok Opname</div>
                <div className="text-xs text-muted-foreground">
                  Audit stok: input hasil hitung fisik
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>
      )}

      {!isKaryawan && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <Database className="h-4 w-4" /> Data
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <a href="/api/backup/download" download>
              <Button variant="outline" className="w-full">
                <Database className="mr-2 h-4 w-4" /> Backup Database (JSON)
              </Button>
            </a>
            <a href="/api/export/excel" download>
              <Button variant="outline" className="w-full">
                <FileSpreadsheet className="mr-2 h-4 w-4" /> Export ke Excel
              </Button>
            </a>
            <p className="text-[10px] text-muted-foreground">
              Backup & Export mengikuti format tanggal saat ini.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="text-center text-[10px] text-muted-foreground">
        RCMS • R CELL Management System v1
      </div>
    </div>
  );
}
