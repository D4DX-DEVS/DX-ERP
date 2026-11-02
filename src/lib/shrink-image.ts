/** Photo types the browser can decode and re-encode. GIFs (often animated) and SVGs are left alone. */
const SHRINKABLE = /^image\/(jpeg|png|webp|heic|heif|bmp)$/;
const MAX_SIDE = 2048;
const MIN_SIDE = 480;
const QUALITIES = [0.85, 0.72, 0.6, 0.5];

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Browser-side: shrinks a photo that is over `maxBytes` (downscale + re-encode, which also drops EXIF/GPS data) so it
 * passes the upload limit. PNG/WebP stay WebP to keep transparency where the browser can encode it (Safari can't →
 * JPEG on white). Returns the original file when it already fits, isn't a photo, can't be decoded or can't be shrunk
 * enough — the caller's size check then rejects it.
 */
export async function shrinkImage(file: File, maxBytes: number): Promise<File> {
  if (file.size <= maxBytes || !SHRINKABLE.test(file.type)) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    canvas.width = canvas.height = 1;
    const webp = (file.type === "image/png" || file.type === "image/webp") && (await encode(canvas, "image/webp", 0.8))?.type === "image/webp";
    const type = webp ? "image/webp" : "image/jpeg";
    const name = `${file.name.replace(/\.[^.]*$/, "") || "photo"}.${webp ? "webp" : "jpg"}`;
    const longest = Math.max(bitmap.width, bitmap.height);
    for (let side = Math.min(MAX_SIDE, longest); ; side = Math.round(side * 0.75)) {
      const scale = side / longest;
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      if (!webp) {
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of QUALITIES) {
        const blob = await encode(canvas, type, quality);
        if (blob && blob.size <= maxBytes) return new File([blob], name, { type, lastModified: file.lastModified });
      }
      if (side <= MIN_SIDE) return file;
    }
  } finally {
    bitmap.close();
  }
}
