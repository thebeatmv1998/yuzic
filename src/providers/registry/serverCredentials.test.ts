import type { Server } from '@/providers/contracts/Server';
import { _clearCredentialCache, setCredential } from '@/state/credentialCache';
import {
  saveServerCredentials,
  saveServerCustomHeaders,
  withServerCredentials,
} from './serverCredentials';

const server = (over: Partial<Server> = {}): Server => ({
  id: 'srv-1',
  type: 'navidrome',
  serverUrl: 'https://media.example',
  username: 'ari',
  isAuthenticated: true,
  ...over,
});

describe('server custom header credentials', () => {
  afterEach(() => _clearCredentialCache());

  it('keeps the values in the keystore and the names on the server record', async () => {
    const sanitized = await saveServerCredentials('srv-1', undefined, undefined, [
      { name: 'X-Api-Key', value: 'proxy-secret' },
      { name: 'X-Authentik-Username', value: 'ari' },
    ]);

    expect(sanitized.customHeaders).toEqual([
      { name: 'X-Api-Key' },
      { name: 'X-Authentik-Username' },
    ]);
    expect(JSON.stringify(sanitized)).not.toContain('proxy-secret');
    expect(JSON.stringify(sanitized)).not.toContain('"ari"');

    expect(withServerCredentials(server({ customHeaders: sanitized.customHeaders })).customHeaders)
      .toEqual([
        { name: 'X-Api-Key', value: 'proxy-secret' },
        { name: 'X-Authentik-Username', value: 'ari' },
      ]);
  });

  it('sends nothing when a name was saved without a stored value', () => {
    // A half-written record — a name in Redux but nothing in the keystore —
    // must not become an empty header.
    expect(withServerCredentials(server({ customHeaders: [{ name: 'X-Api-Key' }] })).customHeaders)
      .toBeUndefined();
  });

  it('removes every stored value when the list is cleared', async () => {
    await saveServerCustomHeaders('srv-1', [
      { name: 'X-Api-Key', value: 'proxy-secret' },
      { name: 'X-Authentik-Username', value: 'ari' },
    ]);
    const sanitized = await saveServerCustomHeaders('srv-1', null);

    expect(sanitized).toBeUndefined();
    expect(withServerCredentials(server({ customHeaders: [{ name: 'X-Api-Key' }] })).customHeaders)
      .toBeUndefined();
  });

  it('replaces the stored values when new ones are saved', async () => {
    await saveServerCustomHeaders('srv-1', [{ name: 'X-Api-Key', value: 'old' }]);
    await saveServerCustomHeaders('srv-1', [
      { name: 'X-Api-Key', value: 'new' },
      { name: 'X-User', value: 'ari' },
    ]);

    expect(withServerCredentials(server({ customHeaders: [{ name: 'X-Api-Key' }, { name: 'X-User' }] })).customHeaders)
      .toEqual([
        { name: 'X-Api-Key', value: 'new' },
        { name: 'X-User', value: 'ari' },
      ]);
  });

  it('refuses an invalid list without wiping the working values', async () => {
    await saveServerCustomHeaders('srv-1', [{ name: 'X-Api-Key', value: 'good' }]);

    await expect(saveServerCustomHeaders('srv-1', [{ name: 'Bad Name', value: 'bad' }]))
      .rejects.toThrow('Invalid custom headers');

    expect(withServerCredentials(server({ customHeaders: [{ name: 'X-Api-Key' }] })).customHeaders)
      .toEqual([{ name: 'X-Api-Key', value: 'good' }]);
  });

  it('keeps an install from the single-header release working', async () => {
    await setCredential({ kind: 'server', serverId: 'srv-1' }, 'customHeaderValue', 'legacy-secret');

    expect(withServerCredentials(server({ customHeader: { name: 'X-Legacy' } })).customHeaders)
      .toEqual([{ name: 'X-Legacy', value: 'legacy-secret' }]);
  });
});
