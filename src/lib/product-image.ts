const mimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export function validateProductImage(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2_800_000) return null;
  const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || !mimeTypes.has(match[1])) return null;
  const image = Buffer.from(match[2], 'base64');
  if (image.length < 100 || image.length > 2_000_000) return null;
  const valid = match[1] === 'image/jpeg' ? image[0] === 0xff && image[1] === 0xd8
    : match[1] === 'image/png' ? image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : match[1] === 'image/gif' ? image.toString('ascii', 0, 3) === 'GIF'
        : image.toString('ascii', 0, 4) === 'RIFF' && image.toString('ascii', 8, 12) === 'WEBP';
  return valid ? value : null;
}

export async function describeProductImage(dataUrl: string, apiKey: string) {
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.DEEPSEEK_VISION_MODEL || 'deepseek-flash',
      messages: [
        { role: 'system', content: 'Deskripsikan hanya ciri barang yang terlihat dalam foto untuk pencarian katalog: jenis, tulisan/merek/model yang terbaca, bentuk dan konektor. Jawab singkat dalam bahasa Indonesia. Jika buram atau tidak jelas, katakan tidak jelas. Jangan menyimpulkan harga, stok, keaslian atau kompatibilitas perangkat.' },
        { role: 'user', content: [
          { type: 'text', text: 'Apa ciri barang yang terlihat? Ini hanya petunjuk pencarian, bukan sumber fakta toko.' },
          { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } },
        ] },
      ],
      max_tokens: 180,
      stream: false,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error('Foto belum bisa dibaca oleh DeepSeek. Coba lagi atau jelaskan barangnya lewat teks.');
  const data = await response.json() as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content?.trim().slice(0, 600) || 'Foto tidak cukup jelas untuk dikenali.';
}
