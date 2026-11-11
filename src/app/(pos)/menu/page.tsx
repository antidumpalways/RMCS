import Link from 'next/link';
import { LayoutDashboard, NotebookPen, PackagePlus, MessageCircle, Tag, FileText, Settings } from 'lucide-react';
import { requireUser } from '@/lib/guard';
import { WorkEntry } from '@/components/work-actions';

export const dynamic = 'force-dynamic';

function Tile({ href, icon: Icon, title, hint }: { href: string; icon: React.ComponentType<{ className?: string }>; title: string; hint: string }) {
  return (
    <Link href={href} className="flex min-h-24 items-center gap-3 rounded-2xl border bg-card p-4 transition-colors active:scale-[0.98] hover:border-primary/40">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="h-5 w-5" /></span>
      <span className="min-w-0"><span className="block text-sm font-semibold">{title}</span><span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span></span>
    </Link>
  );
}

export default async function MenuPage() {
  const me = await requireUser();
  const owner = me.role === 'owner';
  return (
    <div className="space-y-5 p-4">
      {owner && (
        <Link href="/" className="flex min-h-16 items-center gap-3 rounded-2xl bg-primary p-4 text-primary-foreground shadow-lg shadow-primary/20">
          <LayoutDashboard className="h-6 w-6" /><span><span className="block font-bold">Dashboard Owner</span><span className="text-xs opacity-85">Analitik, laporan, dan pengaturan</span></span>
        </Link>
      )}
      <section>
        <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Catat uang</h2>
        <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
          <WorkEntry kind="admin" />
          <WorkEntry kind="expense" />
          <Tile href="/piutang" icon={NotebookPen} title="Bon Pelanggan" hint="Catat bon atau pembayaran" />
        </div>
      </section>
      <section>
        <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Barang</h2>
        <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
          <Tile href="/inventory" icon={PackagePlus} title="Barang Masuk" hint="Pilih barang & tambah stok" />
          <Tile href="/asisten" icon={MessageCircle} title="Asisten" hint="Tanya harga & stok" />
          {owner && <Tile href="/harga" icon={Tag} title="Harga" hint="Atur harga jual" />}
        </div>
      </section>
      {owner && (
        <section>
          <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">Owner</h2>
          <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
            <Tile href="/laporan" icon={FileText} title="Laporan" hint="Omzet dan profit" />
            <Tile href="/pengaturan" icon={Settings} title="Pengaturan" hint="Toko, lokasi, pengguna" />
          </div>
        </section>
      )}
    </div>
  );
}
