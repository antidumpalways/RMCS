// Deploy helper - push schema ke production DB lalu seed.
// Dipanggil dari Vercel post-deploy atau manual:
//   npx tsx scripts/deploy.ts
import { execSync } from 'child_process';

console.log('=== RCMS Deploy Helper ===\n');

console.log('[1/2] Pushing Prisma schema...');
try {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    stdio: 'inherit',
  });
  console.log('  ✓ Schema synced\n');
} catch (e) {
  console.error('  ✗ Schema push failed:', (e as Error).message);
  process.exit(1);
}

console.log('[2/2] Seeding default data (idempotent)...');
try {
  execSync('npx tsx prisma/seed.ts', {
    stdio: 'inherit',
  });
  console.log('\n=== Deploy selesai! ===');
  console.log('Login default:');
  console.log('  admin / 1234   (owner)');
  console.log('  shift1 / 1111  (karyawan siang)');
  console.log('  shift2 / 2222  (karyawan malam)');
  console.log('  karyawan / 0000 (karyawan tanpa shift)');
  console.log('\n⚠ Segera ganti PIN default setelah login pertama!');
} catch (e) {
  console.error('  ✗ Seed failed:', (e as Error).message);
  process.exit(1);
}
