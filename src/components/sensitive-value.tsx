'use client';

import * as React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { formatRupiah } from '@/lib/utils';

type Props = {
  value: number | bigint;
  isSensitive: boolean;
  className?: string;
  showLabel?: string;
};

/**
 * Jika user adalah karyawan, sembunyikan nilai asli dan tampilkan placeholder.
 * Owner melihat nilai asli.
 */
export function SensitiveValue({ value, isSensitive, className, showLabel }: Props) {
  const [revealed, setRevealed] = React.useState(false);
  if (!isSensitive) {
    return <span className={className}>{formatRupiah(value)}</span>;
  }
  if (revealed) {
    return (
      <button
        type="button"
        onClick={() => setRevealed(false)}
        className={cn('inline-flex items-center gap-1', className)}
      >
        {formatRupiah(value)}
        <EyeOff className="h-3 w-3 opacity-50" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setRevealed(true)}
      className={cn(
        'inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground',
        className
      )}
    >
      <span className="tracking-wider">Rp •••••••</span>
      {showLabel && <span className="text-[10px]">({showLabel})</span>}
      <Eye className="h-3 w-3 opacity-50" />
    </button>
  );
}

function cn(...classes: (string | undefined | false)[]) {
  return classes.filter(Boolean).join(' ');
}
