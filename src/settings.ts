import { DEFAULT_INSERTION_PREFERENCES, normalizeImageFolder, normalizeImageNameTemplate, type InsertionPreferences } from './insertion-paths';

export interface BackupPreferences {
  backupEnabled: boolean;
  backupFolder: string;
}

export interface PluginSettings extends BackupPreferences, InsertionPreferences {
  quality: number;
  backupConfigured: boolean;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  ...DEFAULT_INSERTION_PREFERENCES,
  quality: 85,
  backupEnabled: false,
  backupConfigured: false,
  backupFolder: 'Image Toolkit Backups',
};

/** Sanitize saved plugin data and migrate records that predate backup preferences. */
export function loadSettings(saved: unknown): PluginSettings {
  const record = typeof saved === 'object' && saved !== null && !Array.isArray(saved)
    ? saved as Record<string, unknown>
    : {};
  const hasConfigurationMarker = typeof record.backupConfigured === 'boolean';
  const validated = (key: string, validate: (value: string) => string, fallback: string): string => {
    try { return typeof record[key] === 'string' ? validate(record[key] as string) : fallback; }
    catch { return fallback; }
  };

  return {
    manageInsertedImages: record.manageInsertedImages === true,
    imageFolder: validated('imageFolder', normalizeImageFolder, DEFAULT_SETTINGS.imageFolder),
    renameInsertedImages: record.renameInsertedImages === true,
    imageNameTemplate: validated('imageNameTemplate', normalizeImageNameTemplate, DEFAULT_SETTINGS.imageNameTemplate),
    quality: typeof record.quality === 'number' && Number.isFinite(record.quality)
      ? Math.max(10, Math.min(100, record.quality))
      : DEFAULT_SETTINGS.quality,
    backupEnabled: hasConfigurationMarker && typeof record.backupEnabled === 'boolean'
      ? record.backupEnabled
      : false,
    backupConfigured: hasConfigurationMarker ? record.backupConfigured as boolean : false,
    backupFolder: typeof record.backupFolder === 'string'
      ? record.backupFolder
      : DEFAULT_SETTINGS.backupFolder,
  };
}
