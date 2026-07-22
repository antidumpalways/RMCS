'use client';

import { User } from 'lucide-react';

export function ShiftBadge({
  userShift,
  userName,
}: {
  userShift: string | null;
  userName: string | null;
}) {
  if (!userName && !userShift) return null;
  const color =
    userShift === 'siang'
      ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
      : userShift === 'malam'
        ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300'
        : 'bg-muted text-muted-foreground';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${color}`}
    >
      <User className="h-2.5 w-2.5" />
      {userName || userShift}
    </span>
  );
}
