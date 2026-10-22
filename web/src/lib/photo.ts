/**
 * Turns a camera/file pick into a small JPEG data URL.
 *
 * Uses a plain file input with `capture` rather than getUserMedia: the
 * platform already owns the camera UI, the permission prompt and the
 * front/rear choice, and it works the same on iOS, Android and desktop.
 */
const MAX_EDGE = 320;
const QUALITY = 0.72;

export async function toSmallJpeg(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('That file is not an image');

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not process the photo on this device');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  return canvas.toDataURL('image/jpeg', QUALITY);
}
