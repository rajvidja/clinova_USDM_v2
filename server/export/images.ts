import { getAttachment } from '../repo.ts';
import type { DocModel } from '../../shared/docModel.ts';

export interface LoadedImage {
  data: Buffer;
  mimeType: string;
  width: number;
  height: number;
}

function dimensions(buf: Buffer, mime: string): { width: number; height: number } | null {
  if (mime === 'image/png' && buf.length > 24 && buf.readUInt32BE(12) === 0x49484452) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (/jpe?g/.test(mime)) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}

export function loadImages(model: DocModel): Map<string, LoadedImage> {
  const out = new Map<string, LoadedImage>();
  for (const b of model.body) {
    if (b.t !== 'image' || out.has(b.attachmentId)) continue;
    const att = getAttachment(b.attachmentId);
    if (!att) continue;
    const data = Buffer.from(att.data);
    const dim = dimensions(data, att.mimeType);
    if (dim) out.set(b.attachmentId, { data, mimeType: att.mimeType, ...dim });
  }
  return out;
}
