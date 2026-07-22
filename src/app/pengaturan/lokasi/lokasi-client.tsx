'use client';

import * as React from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, MapPin, Plus, Trash2 } from 'lucide-react';
import { createLocation, deleteLocation } from '@/lib/actions';
import { useToast } from '@/components/ui/toast';

type Location = {
  id: number;
  name: string;
  sortOrder: number;
  productCount: number;
};

export function LokasiClient({ locations }: { locations: Location[] }) {
  const toast = useToast();
  const [adding, setAdding] = React.useState(false);
  const [name, setName] = React.useState('');

  return (
    <div className="space-y-4">
      <Link
        href="/pengaturan"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Pengaturan
      </Link>
      <div>
        <h1 className="text-xl font-bold">Kelola Lokasi</h1>
        <p className="text-xs text-muted-foreground">
          Tambah/edit lokasi penyimpanan barang di toko
        </p>
      </div>

      <Card>
        <CardContent className="p-3">
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label>Nama Lokasi Baru</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder='mis. "Rak 5", "Gudang Belakang", "Lemari Kaca"'
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && name.trim()) {
                    e.preventDefault();
                    createLocation(name).then(() => {
                      setName('');
                      setAdding(false);
                      toast({ title: 'Lokasi ditambah' });
                    });
                  }
                }}
              />
            </div>
            <Button
              disabled={!name.trim() || adding}
              onClick={async () => {
                setAdding(true);
                try {
                  await createLocation(name);
                  setName('');
                  toast({ title: 'Lokasi ditambah' });
                } finally {
                  setAdding(false);
                }
              }}
            >
              <Plus className="mr-1 h-4 w-4" /> Tambah
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {locations.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              Belum ada lokasi. Tambahkan lokasi pertama di atas.
            </CardContent>
          </Card>
        ) : (
          locations.map((l) => (
            <Card key={l.id}>
              <CardContent className="flex items-center justify-between p-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400">
                    <MapPin className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-medium">{l.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {l.productCount} barang
                      {l.productCount > 0 ? ' tersimpan' : ''}
                    </div>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive"
                  disabled={l.productCount > 0}
                  title={
                    l.productCount > 0
                      ? 'Pindahkan barang ke lokasi lain dulu'
                      : 'Hapus lokasi'
                  }
                  onClick={async () => {
                    if (confirm(`Hapus lokasi "${l.name}"?`)) {
                      await deleteLocation(l.id);
                      toast({ title: 'Lokasi dihapus' });
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {locations.some((l) => l.productCount > 0) && (
        <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
          <strong>Catatan:</strong> Lokasi yang sudah dipakai barang tidak bisa dihapus. Pindahkan barang ke lokasi lain dulu, atau hapus barangnya.
        </div>
      )}
    </div>
  );
}
