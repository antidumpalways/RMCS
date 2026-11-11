import { requireUser } from '@/lib/guard';
import { getPosCatalog } from '@/lib/pos-data';
import { PosProvider } from '@/components/pos/pos-provider';
import { PosShell } from '@/components/pos/pos-shell';

export const dynamic = 'force-dynamic';

// Layout ini tetap terpasang saat pindah tab (Kasir, Riwayat, ...), jadi katalog dan
// keranjang tidak dimuat ulang setiap pindah menu.
export default async function PosLayout({ children }: { children: React.ReactNode }) {
  const me = await requireUser();
  const { products, popularIds, storeName } = await getPosCatalog();
  return (
    <PosProvider products={products} popularIds={popularIds}>
      <PosShell storeName={storeName} username={me.username} shift={me.shift}>{children}</PosShell>
    </PosProvider>
  );
}
