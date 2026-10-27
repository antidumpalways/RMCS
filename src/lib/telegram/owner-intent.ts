export type OwnerIntent =
  | { kind: 'product_info'; query: string }
  | { kind: 'low_stock' }
  | { kind: 'inventory_value' }
  | { kind: 'business_report_today'; date: string | null; shift: string | null }
  | { kind: 'stock_in'; query: string; quantity: number | null; unitCost: string | null; supplier: string | null }
  | { kind: 'stock_adjust'; query: string; newStock: number | null; reason: string | null }
  | { kind: 'price_update'; query: string; field: 'sellPrice' | 'costPrice' | null; amount: string | null }
  | { kind: 'location_move'; query: string; targetLocation: string | null }
  | { kind: 'unknown' };

export function telegramOwnerAuthorized(senderId: number, configured = process.env.TELEGRAM_OWNER_IDS): boolean {
  return Number.isSafeInteger(senderId) && senderId > 0 &&
    new Set((configured ?? '').split(',').map(id => id.trim()).filter(id => /^\d{1,20}$/.test(id))).has(String(senderId));
}

export function authorizedOwnerPrivateChat(senderId: number, chatId: number, configured = process.env.TELEGRAM_OWNER_IDS): boolean {
  return senderId === chatId && telegramOwnerAuthorized(senderId, configured);
}

type RawIntent = Record<string, unknown>;

function safeText(value: unknown, max = 160): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s+/g, ' ').slice(0, max);
  return text || null;
}

function safeQuantity(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 1_000_000) return null;
  return value;
}

export function validateOwnerIntent(raw: unknown): OwnerIntent {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { kind: 'unknown' };
  const item = raw as RawIntent;
  switch (item.kind) {
    case 'product_info':
      return safeText(item.query) ? { kind: 'product_info', query: safeText(item.query)! } : { kind: 'unknown' };
    case 'low_stock': return { kind: 'low_stock' };
    case 'inventory_value': return { kind: 'inventory_value' };
    case 'business_report_today': {
      const date = safeText(item.date, 10);
      const parsedDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(date + 'T00:00:00Z') : Number.NaN;
      const validDate = !Number.isNaN(parsedDate) && new Date(parsedDate).toISOString().slice(0, 10) === date ? date : null;
      return { kind: 'business_report_today', date: validDate, shift: safeText(item.shift, 30) };
    }
    case 'stock_in':
      return safeText(item.query) ? {
        kind: 'stock_in', query: safeText(item.query)!, quantity: safeQuantity(item.quantity),
        unitCost: safeText(item.unitCost, 40), supplier: safeText(item.supplier, 100),
      } : { kind: 'unknown' };
    case 'stock_adjust':
      return safeText(item.query) ? {
        kind: 'stock_adjust', query: safeText(item.query)!, newStock: safeQuantity(item.newStock), reason: safeText(item.reason, 300),
      } : { kind: 'unknown' };
    case 'price_update':
      return safeText(item.query) ? {
        kind: 'price_update', query: safeText(item.query)!,
        field: item.field === 'sellPrice' || item.field === 'costPrice' ? item.field : null,
        amount: safeText(item.amount, 40),
      } : { kind: 'unknown' };
    case 'location_move':
      return safeText(item.query) ? {
        kind: 'location_move', query: safeText(item.query)!, targetLocation: safeText(item.targetLocation, 100),
      } : { kind: 'unknown' };
    default: return { kind: 'unknown' };
  }
}

/** Parse explicit rupiah amounts without guessing what an unmarked decimal means. */
export function parseOwnerRupiah(value: string | null): bigint | null {
  if (!value) return null;
  const normalized = value.trim().toLocaleLowerCase('id-ID').replace(/^rp\s*/, '').replace(/\s+/g, '');
  const match = /^(\d+(?:[.,]\d+)?)((?:rb|ribu|k|jt|juta|m)?)$/.exec(normalized);
  if (match && !match[2] && /[.,]/.test(match[1])) {
    const grouped = /^(?:\d{1,3}(?:\.\d{3})+|\d{1,3}(?:,\d{3})+)$/.test(match[1]);
    if (!grouped) return null;
    const value = BigInt(match[1].replace(/[.,]/g, ''));
    return value <= 1_000_000_000_000n ? value : null;
  }
  if (!match) {
    const grouped = /^(\d{1,3}(?:\.\d{3})+|\d{1,3}(?:,\d{3})+)$/.exec(normalized);
    if (!grouped) return null;
    const number = BigInt(grouped[1].replace(/[.,]/g, ''));
    return number <= 1_000_000_000_000n ? number : null;
  }
  const number = match[1].replace(',', '.');
  const suffix = match[2];
  if (!suffix && number.includes('.')) return null;
  const multiplier = suffix === 'rb' || suffix === 'ribu' || suffix === 'k' ? 1_000n
    : suffix === 'jt' || suffix === 'juta' || suffix === 'm' ? 1_000_000n : 1n;
  const [whole, fraction = ''] = number.split('.');
  if (fraction.length > 3) return null;
  const scale = 10n ** BigInt(fraction.length);
  const numerator = BigInt(whole) * scale + BigInt(fraction || '0');
  if (numerator * multiplier % scale !== 0n) return null;
  const result = numerator * multiplier / scale;
  return result <= 1_000_000_000_000n ? result : null;
}

export function fallbackOwnerIntent(text: string): OwnerIntent {
  const input = text.trim();
  if (/\b(hampir habis|stok menipis|stok rendah|stok tipis)\b/i.test(input)) return { kind: 'low_stock' };
  if (/\b(nilai|valuasi|modal)\s+(?:total\s+)?(?:stok|persediaan)\b/i.test(input)) return { kind: 'inventory_value' };
  if (/\b(omzet|omset|laba|profit|pengeluaran|pendapatan)\b/i.test(input)) {
    const isoDate = /\b(\d{4}-\d{2}-\d{2})\b/.exec(input)?.[1] ?? null;
    let date = isoDate;
    if (/\bkemarin\b/i.test(input)) {
      const today = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) + 'T00:00:00Z');
      today.setUTCDate(today.getUTCDate() - 1);
      date = today.toISOString().slice(0, 10);
    }
    const shift = /\bshift\s+(pagi|siang|sore|malam)\b/i.exec(input)?.[1] ?? null;
    return { kind: 'business_report_today', date, shift };
  }
  const stockIn = /^(?:tambah|barang masuk|stok masuk|terima)\s+(.+?)\s+(\d+)\s*(?:pcs?|unit|buah|box|pak|lembar|batang)\b(?:.*?\bmodal\s+([\d.,]+\s*(?:rb|ribu|k|jt|juta|m)?))?(?:.*?\b(?:dari|supplier)\s+([\p{L}\d .'-]+))?\s*[.!?]*\s*$/iu.exec(input);
  if (stockIn) return { kind: 'stock_in', query: stockIn[1].trim(), quantity: Number(stockIn[2]), unitCost: stockIn[3]?.replace(/\s+/g, '') ?? null, supplier: stockIn[4]?.trim() ?? null };
  const adjust = /^(?:ubah|koreksi|setel|set)\s+(?:stok\s+)?(.+?)\s+(?:jadi|menjadi|ke)\s+(\d+)\s*(?:pcs?|unit|buah|box|pak)?\s*(?:karena|sebab|alasan)\s+(.+)$/iu.exec(input);
  if (adjust) return { kind: 'stock_adjust', query: adjust[1].trim(), newStock: Number(adjust[2]), reason: adjust[3].trim() };
  const price = /^(?:ubah|ganti|setel|set)\s+harga\s+(jual|modal|beli)\s+(.+?)\s+(?:jadi|menjadi|ke)\s+([\d.,]+\s*(?:rb|ribu|k|jt|juta|m)?)\s*[.!?]*\s*$/iu.exec(input);
  if (price) return { kind: 'price_update', field: /modal|beli/i.test(price[1]) ? 'costPrice' : 'sellPrice', query: price[2].trim(), amount: price[3].replace(/\s+/g, '') };
  const location = /^(?:pindah(?:kan)?|geser)\s+(?:lokasi\s+)?(?:barang\s+)?(.+?)\s+(?:ke|menuju)\s+(.+)$/iu.exec(input);
  if (location) return { kind: 'location_move', query: location[1].trim(), targetLocation: location[2].trim().replace(/[.!?]+$/, '') };
  if (/\b(stok|harga|modal|berapa|cari|info)\b/i.test(input)) {
    const query = input.replace(/^(?:stok|harga|modal|berapa|cari|info)\s*/i, '')
      .replace(/\b(berapa|sekarang|ya|dong|tolong|stok|harga|jual|modal|beli)\b/gi, ' ').replace(/[?!.]/g, ' ').replace(/\s+/g, ' ').trim();
    if (query) return { kind: 'product_info', query };
  }
  return { kind: 'unknown' };
}

export async function extractOwnerIntent(text: string): Promise<OwnerIntent> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return fallbackOwnerIntent(text);
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST', headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_MODEL || 'deepseek-flash', response_format: { type: 'json_object' }, temperature: 0, max_tokens: 350, stream: false,
      messages: [
        { role: 'system', content: 'Klasifikasikan pesan owner toko Indonesia menjadi JSON saja. Pilih kind dari product_info, low_stock, inventory_value, business_report_today, stock_in, stock_adjust, price_update, location_move, unknown. Format: {"kind":"...","query":string,"quantity":integer|null,"unitCost":string|null,"supplier":string|null,"newStock":integer|null,"reason":string|null,"field":"sellPrice"|"costPrice"|null,"amount":string|null,"targetLocation":string|null,"date":"YYYY-MM-DD"|null,"shift":string|null}. Hanya ekstrak fakta yang tertulis. Jangan pilih atau mengarang product ID, harga, stok, atau kategori barang. Harga kembalikan sebagai teks apa adanya, misalnya 19rb. stock_adjust wajib punya alasan eksplisit; bila alasan tidak disebutkan, reason null. Harga jual = sellPrice; modal/harga beli = costPrice. product_info untuk pertanyaan stok/harga/modal barang. business_report_today untuk omzet/laba/pengeluaran; date hanya jika tanggal jelas atau sebutan hari relatif dipahami dalam WIB, shift hanya jika disebut jelas. Jika tidak yakin, gunakan unknown.' },
        { role: 'user', content: text.slice(0, 1500) },
      ],
    }), signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('Asisten owner sedang tidak tersedia. Pesan belum diproses; coba lagi.');
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Asisten belum dapat memahami pesan. Coba jelaskan barang dan angkanya.');
  try { return validateOwnerIntent(JSON.parse(content)); }
  catch { throw new Error('Asisten memberi format yang tidak valid. Tidak ada perubahan data; coba kirim ulang.'); }
}
