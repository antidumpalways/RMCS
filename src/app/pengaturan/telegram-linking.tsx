'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { createTelegramLinkCode } from '@/lib/telegram-link-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';

type TelegramUserOption = { id: number; username: string; role: string; shift: string | null };

export function TelegramLinking({ users }: { users: TelegramUserOption[] }) {
  const [userId, setUserId] = React.useState('');
  const [code, setCode] = React.useState('');
  const [ownerPin, setOwnerPin] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const toast = useToast();
  const router = useRouter();
  const issue = async () => {
    if (!userId || !ownerPin) return;
    setBusy(true);
    setCode('');
    try {
      const result = await createTelegramLinkCode(Number(userId), ownerPin);
      setCode(result.code);
      setOwnerPin('');
      toast({ title: `Kode dibuat untuk ${result.username}` });
      router.refresh();
    } catch (error) {
      toast({ title: error instanceof Error ? error.message : 'Kode tidak berhasil dibuat.' });
    } finally {
      setBusy(false);
    }
  };
  return <Card>
    <CardHeader className="pb-2"><CardTitle>Hubungkan Telegram</CardTitle></CardHeader>
    <CardContent className="space-y-3">
      <p className="text-xs text-muted-foreground">Masukkan PIN owner untuk mengonfirmasi, pilih akun RMCS, lalu berikan kode satu kali ini secara pribadi kepada pemilik akun. Kode berlaku 10 menit. Saat dipakai, tautan Telegram sebelumnya untuk akun tersebut diganti.</p>
      <Input type="password" inputMode="numeric" autoComplete="current-password" maxLength={6} placeholder="PIN owner" value={ownerPin} onChange={(event) => setOwnerPin(event.target.value.replace(/\D/g, '').slice(0, 6))} />
      <Select value={userId} onValueChange={(value) => { setUserId(value); setCode(''); }}>
        <SelectTrigger><SelectValue placeholder="Pilih pengguna RMCS" /></SelectTrigger>
        <SelectContent>{users.map((user) => <SelectItem key={user.id} value={String(user.id)}>{user.username} · {user.role}{user.shift ? ` · ${user.shift}` : ''}</SelectItem>)}</SelectContent>
      </Select>
      <Button onClick={issue} disabled={!userId || !ownerPin || busy} variant="outline" className="w-full">{busy ? 'Membuat kode…' : 'Buat kode linking'}</Button>
      {code && <div className="rounded-lg border bg-muted/40 p-3">
        <p className="text-xs font-medium">Kirim instruksi ini secara pribadi:</p>
        <code className="mt-2 block break-all rounded bg-background p-2 text-sm">/link {code}</code>
        <p className="mt-2 text-xs text-muted-foreground">Jangan kirim kode ke grup. Setelah dipakai, kode langsung tidak berlaku.</p>
      </div>}
    </CardContent>
  </Card>;
}
