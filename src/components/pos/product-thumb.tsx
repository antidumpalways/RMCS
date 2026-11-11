import { cn } from '@/lib/utils';

const palette = [
  'from-emerald-500 to-teal-600',
  'from-sky-500 to-blue-600',
  'from-amber-500 to-orange-600',
  'from-violet-500 to-purple-600',
  'from-rose-500 to-pink-600',
  'from-cyan-500 to-sky-600',
];

function initials(name: string) {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase();
}

// Tempat foto produk. Sekarang memakai inisial berwarna; saat produk punya foto, cukup isi imageUrl.
export function ProductThumb({ name, seed, imageUrl, className }: {
  name: string;
  seed: number;
  imageUrl?: string | null;
  className?: string;
}) {
  if (imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={imageUrl} alt="" loading="lazy" decoding="async" className={cn('h-full w-full object-cover', className)} />;
  }
  return (
    <div aria-hidden="true" className={cn('flex h-full w-full items-center justify-center bg-gradient-to-br text-2xl font-extrabold tracking-tight text-white/95', palette[seed % palette.length], className)}>
      {initials(name)}
    </div>
  );
}
