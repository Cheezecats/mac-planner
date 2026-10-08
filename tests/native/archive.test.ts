import { describe, expect, it } from 'vitest';
import { createEmptyWorkspace } from '../../src/core/domain';
import { sealArchive, openArchive, validateArchiveAssets, portableSnapshot } from '../../src/electron/archive';

describe('authenticated portable archive validation', () => {
  it('strips account credentials, provider caches and machine-local backup state', () => {
    const snapshot = createEmptyWorkspace();
    snapshot.connections.push({ id: 'account', provider: 'openai', accountName: 'Private', status: 'connected', settings: { token: 'secret' } });
    snapshot.settings.backupPath = '/private/destination';
    snapshot.settings.backupLastAt = '2026-10-07T00:00:00Z';
    const portable = openArchive(sealArchive({ snapshot, assets: {} }, 'long secret passphrase'), 'long secret passphrase').snapshot;
    expect(portable.connections).toEqual([]);
    expect(portable.settings.backupPath).toBeUndefined();
    expect(portable.settings.backupLastAt).toBeUndefined();
    expect(portable.settings.backupEnabled).toBe(false);
    expect(snapshot.connections).toHaveLength(1);
    expect(snapshot.settings.backupPath).toBe('/private/destination');
  });
  it('authenticates header, salt, nonce, tag and ciphertext; salts are independent', () => {
    const first = sealArchive({ snapshot: createEmptyWorkspace(), assets: {} }, 'long secret passphrase');
    const second = sealArchive({ snapshot: createEmptyWorkspace(), assets: {} }, 'long secret passphrase');
    expect(first.equals(second)).toBe(false);
    for (const index of [0, 14, 15, 48, 61, first.length - 1]) {
      const damaged = Buffer.from(first); damaged[index] ^= 1;
      expect(() => openArchive(damaged, 'long secret passphrase')).toThrow();
    }
    expect(() => openArchive(first.subarray(0, 60), 'long secret passphrase')).toThrow();
  });
  it('refuses invalid references and schema before producing any archive', () => {
    const invalid = createEmptyWorkspace();
    (invalid as any).schemaVersion = 2;
    expect(() => sealArchive({ snapshot: invalid, assets: {} }, 'long secret passphrase')).toThrow();
    expect(() => portableSnapshot(invalid)).toThrow();
  });
  it('requires canonical base64, declared byte counts, and safe storage names', () => {
    const asset = { id: 'a', pageId: 'p', name: 'file', kind: 'copy' as const, mime: 'text/plain', size: 1, storageName: 'safe.enc' };
    expect(() => validateArchiveAssets({ a: 'YQ==' }, [asset])).not.toThrow();
    for (const content of ['YQ', 'YQ==\n', 'YR==', '====', 'YQ===']) expect(() => validateArchiveAssets({ a: content }, [asset])).toThrow();
    expect(() => validateArchiveAssets({ a: 'YQ==' }, [{ ...asset, size: 2 }])).toThrow();
    expect(() => validateArchiveAssets({ a: 'YQ==' }, [{ ...asset, storageName: '../credentials.enc' }])).toThrow();
    expect(() => validateArchiveAssets({ '/tmp/outside': '' }, [])).toThrow();
  });
});
