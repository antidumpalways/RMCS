let workerPromise: Promise<import('tesseract.js').Worker> | null = null;

async function getOcrWorker() {
  if (!workerPromise) {
    workerPromise = import('tesseract.js')
      .then(({ createWorker }) => createWorker('eng'))
      .catch((error) => {
        workerPromise = null;
        throw error;
      });
  }
  return workerPromise;
}

export async function readPhotoText(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const { data } = await (await getOcrWorker()).recognize(url);
    const text = data.text.replace(/[^\p{L}\p{N}\s+./-]/gu, ' ').replace(/\s+/g, ' ').trim();
    return /[\p{L}\p{N}]{3,}/u.test(text) ? text.slice(0, 400) : '';
  } finally {
    URL.revokeObjectURL(url);
  }
}
