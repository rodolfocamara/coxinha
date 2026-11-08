/**
 * Compresses an image to WebP before upload.
 *
 * - Resizes when width > 1600px
 * - Converts to WebP at quality 0.85
 * - Falls back to the original file on failure
 */
export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const MAX_WIDTH = 1600;

    const scale = bitmap.width > MAX_WIDTH ? MAX_WIDTH / bitmap.width : 1;
    const outW = Math.round(bitmap.width * scale);
    const outH = Math.round(bitmap.height * scale);

    const canvas = new OffscreenCanvas(outW, outH);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0, outW, outH);

    const blob = await canvas.convertToBlob({
      type: 'image/webp',
      quality: 0.85,
    });

    const newName = file.name.replace(/\.[^.]+$/, '.webp');
    return new File([blob], newName, { type: 'image/webp' });
  } catch (e) {
    console.warn('Image compression failed, using original', e);
    return file;
  }
}
