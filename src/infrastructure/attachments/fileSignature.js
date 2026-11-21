/**
 * Detects the real file type from its first bytes ("magic numbers"). Used to refuse files
 * whose content does not match the declared MIME type before any processing.
 */

/**
 * @param {Uint8Array} bytes
 * @param {number} offset
 * @param {string} ascii
 */
function startsWithAscii(bytes, offset, ascii) {
  if (bytes.length < offset + ascii.length) return false;
  for (let i = 0; i < ascii.length; i += 1) if (bytes[offset + i] !== ascii.charCodeAt(i)) return false;
  return true;
}

/**
 * @param {Uint8Array} bytes
 * @returns {'jpeg' | 'png' | 'gif' | 'webp' | 'heic' | 'avif' | 'pdf' | 'zip' | null}
 */
export function detectFileType(bytes) {
  if (!bytes || bytes.length < 4) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes[0] === 0x89 && startsWithAscii(bytes, 1, 'PNG\r\n\x1a\n')) return 'png';
  if (startsWithAscii(bytes, 0, 'GIF87a') || startsWithAscii(bytes, 0, 'GIF89a')) return 'gif';
  if (startsWithAscii(bytes, 0, 'RIFF') && startsWithAscii(bytes, 8, 'WEBP')) return 'webp';
  if (startsWithAscii(bytes, 4, 'ftyp')) {
    const brand = String.fromCharCode(...bytes.slice(8, 12));
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return 'heic';
    if (['avif', 'avis'].includes(brand)) return 'avif';
    return null;
  }
  if (startsWithAscii(bytes, 0, '%PDF-')) return 'pdf';
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return 'zip';
  return null;
}

/** Content types we are willing to serve for verified images. */
export const IMAGE_CONTENT_TYPES = Object.freeze({
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  avif: 'image/avif',
});
