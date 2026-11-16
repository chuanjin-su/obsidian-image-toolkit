export interface InsertionPreferences {
  manageInsertedImages: boolean;
  imageFolder: string;
  renameInsertedImages: boolean;
  imageNameTemplate: string;
}

export const DEFAULT_INSERTION_PREFERENCES: InsertionPreferences = {
  manageInsertedImages: false,
  imageFolder: '_Asset/',
  renameInsertedImages: false,
  imageNameTemplate: '<original-name>-YYYY-MM-DD.<suffix>',
};

const unsafe = /[\u0000-\u001f\u007f-\u009f:*?"<>|]/;
const imageExtensions = /^(avif|bmp|gif|heic|heif|ico|jfif|jpe?g|png|svg|tiff?|webp)$/i;
const mimeExtensions: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/bmp': 'bmp',
  'image/avif': 'avif', 'image/tiff': 'tiff', 'image/heic': 'heic',
  'image/heif': 'heif', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico',
};

export function isInsertedImage(file: Pick<File, 'name' | 'type'>): boolean {
  const dot = file.name.lastIndexOf('.');
  return file.type.startsWith('image/') || (dot >= 0 && imageExtensions.test(file.name.slice(dot + 1)));
}

/** ./ paths are relative to the note; bare paths are vault-relative; / is the vault root. */
export function normalizeImageFolder(folder: string): string {
  if (/[\u0000-\u001f\u007f-\u009f]/.test(folder)) throw new Error('Image folder cannot contain control characters.');
  const value = folder.trim().replace(/\\/g, '/');
  if (value === '/') return '/';
  if (!value || unsafe.test(value) || value.startsWith('/')) {
    throw new Error('Image folder must be ./, /, or a relative folder such as _Asset/.');
  }
  const relativeToNote = value === '.' || value.startsWith('./');
  const parts = value.split('/').map(part => part.trim()).filter(part => part && part !== '.');
  if (parts.some(part => part === '..' || /[. ]$/.test(part))) {
    throw new Error("Image folder cannot contain '..' or names ending with a dot or space.");
  }
  if (!parts.length) return './';
  return `${relativeToNote ? './' : ''}${parts.join('/')}/`;
}

export function imageDestinationFolder(folder: string, notePath: string): string {
  const normalized = normalizeImageFolder(folder);
  if (normalized === '/') return '';
  if (!normalized.startsWith('./')) return normalized.slice(0, -1);
  const parent = notePath.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/')) : '';
  return [parent, normalized.slice(2, -1)].filter(Boolean).join('/');
}

export function normalizeImageNameTemplate(template: string): string {
  if (/[\u0000-\u001f\u007f-\u009f]/.test(template)) throw new Error('Filename template cannot contain control characters.');
  const value = template.trim();
  if (!value.endsWith('.<suffix>')) throw new Error('Filename template must end with .<suffix> to preserve the image format.');
  const literal = value.replace(/<original-name>|<note-name>|<suffix>/g, 'image');
  if (unsafe.test(literal) || /[/\\]/.test(literal) || !value.slice(0, -9).replace(/[. ]/g, '')) {
    throw new Error('Filename template contains unsupported characters or placeholders.');
  }
  // The suffix is only allowed once, at the end.
  if (value.indexOf('<suffix>') !== value.length - 8) throw new Error('Use <suffix> only at the end of the template.');
  return value;
}

function safeBasename(name: string): string {
  return name.replace(/[\u0000-\u001f\u007f-\u009f/\\:*?"<>|#\[\]]/g, '-')
    .replace(/^[. ]+|[. ]+$/g, '') || 'image';
}

export function insertedImageName(
  file: Pick<File, 'name' | 'type'>,
  notePath: string,
  preferences: Pick<InsertionPreferences, 'renameInsertedImages' | 'imageNameTemplate'>,
  date = new Date(),
): string {
  const filename = file.name.split(/[/\\]/).pop() || 'image';
  const dot = filename.lastIndexOf('.');
  const hasExtension = dot > 0 && /^[a-z0-9]+$/i.test(filename.slice(dot + 1));
  const suffix = hasExtension ? filename.slice(dot + 1) : mimeExtensions[file.type.toLowerCase()];
  if (!suffix) throw new Error(`Cannot determine the image extension for '${filename}'.`);
  const original = safeBasename(hasExtension ? filename.slice(0, dot) : filename);
  if (!preferences.renameInsertedImages) return `${original}.${suffix}`;
  const template = normalizeImageNameTemplate(preferences.imageNameTemplate);
  const pad = (value: number) => String(value).padStart(2, '0');
  const values: Record<string, string> = {
    YYYY: String(date.getFullYear()), MM: pad(date.getMonth() + 1), DD: pad(date.getDate()),
    HH: pad(date.getHours()), mm: pad(date.getMinutes()), ss: pad(date.getSeconds()),
  };
  const noteName = notePath.split('/').pop()!.replace(/\.md$/i, '');
  // Expand date tokens first so date-looking text in the original name stays literal.
  const dated = template.slice(0, -9).replace(/YYYY|MM|DD|HH|mm|ss/g, token => values[token]);
  const basename = dated.replace(/<original-name>|<note-name>/g, token =>
    token === '<original-name>' ? original : safeBasename(noteName));
  return `${safeBasename(basename)}.${suffix}`;
}
