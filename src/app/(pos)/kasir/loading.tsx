import { Skeleton } from '@/components/ui/skeleton';

export default function KasirLoading() {
  return (
    <div className="space-y-4 p-4" aria-busy="true" aria-label="Memuat kasir">
      <Skeleton className="h-12 w-full rounded-2xl" />
      <div className="flex gap-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-10 w-20 rounded-full" />)}</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-44 rounded-2xl" />)}</div>
    </div>
  );
}
