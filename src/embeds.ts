export interface ImageEmbed { start: number; end: number; original: string; link: string }

// Deliberately conservative: unsupported/nested Markdown is still editable through rendered images.
export function findImageEmbeds(text: string): ImageEmbed[] {
  const results: ImageEmbed[] = [];
  const pattern = /!\[\[([^\]\n]+)\]\]|!\[((?:\\.|[^\]\\\n])*)\]\(\s*(<[^>\n]+>|(?:\\.|[^\s()\\])+)(?:\s+"(?:\\.|[^"\\])*")?\s*\)/g;
  for (const match of text.matchAll(pattern)) {
    let link = match[1] ? match[1].split('|')[0].split('#')[0] : match[3].replace(/^<|>$/g, '').replace(/\\([() ])/g, '$1');
    try { link = decodeURIComponent(link); } catch { /* Preserve literal percent paths. */ }
    results.push({ start: match.index!, end: match.index! + match[0].length, original: match[0], link });
  }
  return results;
}

export function supportedExtension(path: string): boolean {
  return /\.(jpe?g|png|webp)$/i.test(path);
}

export function isRemote(link: string): boolean {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(link);
}

export function assertStaticImage(bytes: ArrayBuffer, extension: string): void {
  const data = new Uint8Array(bytes);
  const ascii = (start: number, count: number) => String.fromCharCode(...data.subarray(start, start + count));
  if (extension === 'png') {
    if (data.length < 8 || ![137,80,78,71,13,10,26,10].every((byte,i) => data[i] === byte)) throw new Error('Invalid PNG image or extension mismatch.');
    for (let p = 8; p + 12 <= data.length;) {
      const length = new DataView(bytes).getUint32(p);
      if (ascii(p + 4, 4) === 'acTL') throw new Error('Animated PNG images are not supported.');
      if (length > data.length - p - 12) throw new Error('Invalid PNG chunk.');
      p += length + 12;
    }
  } else if (extension === 'webp') {
    if (ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WEBP') throw new Error('Invalid WebP image.');
    for (let p = 12; p + 8 <= data.length;) {
      const tag = ascii(p, 4), length = new DataView(bytes).getUint32(p + 4, true);
      if (tag === 'ANIM' || tag === 'ANMF' || (tag === 'VP8X' && (data[p + 8] & 2))) throw new Error('Animated WebP images are not supported.');
      if (length > data.length - p - 8) throw new Error('Invalid WebP chunk.');
      p += 8 + length + (length % 2);
    }
  } else if (extension === 'jpg' || extension === 'jpeg') {
    if (data.length < 3 || data[0] !== 0xff || data[1] !== 0xd8 || data[2] !== 0xff) throw new Error('Invalid JPEG image or extension mismatch. Renamed animated formats are not supported.');
  } else throw new Error('Only static JPEG, PNG and WebP are supported.');
}
