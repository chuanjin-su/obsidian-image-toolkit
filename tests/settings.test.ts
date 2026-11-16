import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS, loadSettings } from '../src/settings';
import { DEFAULT_INSERTION_PREFERENCES } from '../src/insertion-paths';

test('settings defaults disable backups until the choice is configured', () => {
  assert.deepEqual(DEFAULT_SETTINGS, {
    ...DEFAULT_INSERTION_PREFERENCES,
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
    ...DEFAULT_INSERTION_PREFERENCES,
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
    ...DEFAULT_INSERTION_PREFERENCES,
    quality: 85,
    backupEnabled: true,
    backupConfigured: false,
    backupFolder: 'My Backups',
  });
});

test('image insertion preferences migrate safely and validate saved paths and templates', () => {
  assert.equal(loadSettings({}).manageInsertedImages, false);
  assert.equal(loadSettings({ manageInsertedImages: 'yes' }).manageInsertedImages, false);
  assert.equal(loadSettings({ renameInsertedImages: 1 }).renameInsertedImages, false);
  const settings = loadSettings({ manageInsertedImages: true, imageFolder: './assets', renameInsertedImages: true, imageNameTemplate: '<note-name>-YYYY-MM-DD.<suffix>' });
  assert.equal(settings.manageInsertedImages, true);
  assert.equal(settings.imageFolder, './assets/');
  assert.equal(settings.renameInsertedImages, true);
  assert.equal(settings.imageNameTemplate, '<note-name>-YYYY-MM-DD.<suffix>');
  assert.equal(loadSettings({ imageFolder: '../outside' }).imageFolder, DEFAULT_SETTINGS.imageFolder);
  assert.equal(loadSettings({ imageNameTemplate: '../bad.png' }).imageNameTemplate, DEFAULT_SETTINGS.imageNameTemplate);
});

test('configured backup choices preserve both accepted true and false values', () => {
  for (const backupEnabled of [true, false]) {
    assert.equal(loadSettings({ backupConfigured: true, backupEnabled }).backupConfigured, true);
    assert.equal(loadSettings({ backupConfigured: true, backupEnabled }).backupEnabled, backupEnabled);
  }
});
