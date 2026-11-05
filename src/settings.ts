export interface BackupPreferences {
  backupEnabled: boolean;
  backupFolder: string;
}

export interface PluginSettings extends BackupPreferences {
  quality: number;
  backupConfigured: boolean;
}

export const DEFAULT_SETTINGS: PluginSettings = {
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

  return {
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
