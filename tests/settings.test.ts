import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS, loadSettings } from '../src/settings';

test('settings defaults disable backups until the choice is configured', () => {
  assert.deepEqual(DEFAULT_SETTINGS, {
    quality: 85,
    backupEnabled: false,
    backupConfigured: false,
    backupFolder: 'Image Toolkit Backups',
  });
  assert.deepEqual(loadSettings(undefined), DEFAULT_SETTINGS);
});

test('null and corrupt settings are sanitized', () => {
  assert.deepEqual(loadSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(loadSettings({
    quality: Number.NaN,
    backupEnabled: 'yes',
    backupConfigured: 'yes',
    backupFolder: 42,
  }), DEFAULT_SETTINGS);
  assert.equal(loadSettings({ quality: Infinity }).quality, DEFAULT_SETTINGS.quality);
  assert.equal(loadSettings({ quality: -5 }).quality, 10);
  assert.equal(loadSettings({ quality: 120 }).quality, 100);
  assert.equal(loadSettings({ backupConfigured: false, backupEnabled: true, backupFolder: '' }).backupFolder, '');
});

test('legacy records without a boolean configuration marker require a new choice', () => {
  const settings = loadSettings({
    quality: 73,
    backupEnabled: true,
    backupFolder: 'Old Backups',
  });

  assert.deepEqual(settings, {
    quality: 73,
    backupEnabled: false,
    backupConfigured: false,
    backupFolder: 'Old Backups',
  });
  assert.equal(loadSettings({ backupEnabled: true, backupConfigured: 'old' }).backupEnabled, false);
});

test('a modern configured-false record preserves the user enabled preference', () => {
  assert.deepEqual(loadSettings({
    quality: 85,
    backupEnabled: true,
    backupConfigured: false,
    backupFolder: 'My Backups',
  }), {
    quality: 85,
    backupEnabled: true,
    backupConfigured: false,
    backupFolder: 'My Backups',
  });
});

test('configured backup choices preserve both accepted true and false values', () => {
  for (const backupEnabled of [true, false]) {
    assert.equal(loadSettings({ backupConfigured: true, backupEnabled }).backupConfigured, true);
    assert.equal(loadSettings({ backupConfigured: true, backupEnabled }).backupEnabled, backupEnabled);
  }
});
