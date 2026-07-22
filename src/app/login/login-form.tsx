'use client';

import * as React from 'react';
import { Lock, Store, User } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { loginAction } from '@/lib/auth-actions';

export function LoginForm({ storeName }: { storeName: string }) {
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <Store className="h-7 w-7" />
          </div>
          <CardTitle className="text-xl">{storeName}</CardTitle>
          <p className="text-xs text-muted-foreground">Management System</p>
        </CardHeader>
        <CardContent>
          <form
            action={async (fd) => {
              setError(null);
              setPending(true);
              try {
                await loginAction(fd);
              } catch (e) {
                const msg = (e as Error).message || '';
                if (msg.includes('NEXT_REDIRECT')) {
                  // success - browser will follow
                  return;
                }
                if (msg.includes('Username dan PIN wajib')) {
                  setError('Username dan PIN wajib diisi');
                } else if (msg.includes('Terlalu banyak')) {
                  setError(msg);
                } else {
                  // Generic — tidak bedain "user tidak ada" vs "PIN salah"
                  setError('Username atau PIN salah');
                }
                setPending(false);
              }
            }}
            className="space-y-3"
          >
            <div className="space-y-1">
              <Label>Username</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  name="username"
                  placeholder="username"
                  autoComplete="username"
                  required
                  autoFocus
                  className="pl-9"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>PIN</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  name="pin"
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="••••"
                  required
                  className="pl-9 tracking-widest"
                />
              </div>
            </div>
            {error && (
              <div className="rounded-md bg-rose-50 p-2 text-center text-xs text-rose-700 dark:bg-rose-950/30 dark:text-rose-400">
                {error}
              </div>
            )}
            <Button type="submit" className="w-full" size="lg" disabled={pending}>
              {pending ? 'Memeriksa...' : 'Masuk'}
            </Button>
            {process.env.NODE_ENV !== 'production' && (
              <p className="text-center text-[10px] text-muted-foreground">
                <strong>DEV ONLY:</strong> admin/1234 • shift1/1111 • shift2/2222
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
