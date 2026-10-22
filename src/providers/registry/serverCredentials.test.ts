import type { Server } from '@/providers/contracts/Server';
import { _clearCredentialCache } from '@/state/credentialCache';
import {
  saveServerCredentials,
  saveServerCustomHeader,
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

  it('keeps the value in the keystore and the name on the server record', async () => {
    const sanitized = await saveServerCredentials('srv-1', undefined, undefined, {
      name: 'X-Api-Key',
      value: 'proxy-secret',
    });

    expect(sanitized.customHeader).toEqual({ name: 'X-Api-Key' });
    expect(JSON.stringify(sanitized)).not.toContain('proxy-secret');

    expect(withServerCredentials(server({ customHeader: sanitized.customHeader })).customHeader).toEqual({
      name: 'X-Api-Key',
      value: 'proxy-secret',
    });
  });

  it('sends nothing when a name was saved without a stored value', () => {
    // A half-written record — a name in Redux but nothing in the keystore —
    // must not become an empty header.
    expect(withServerCredentials(server({ customHeader: { name: 'X-Api-Key' } })).customHeader)
      .toBeUndefined();
  });

  it('removes the stored value when the header is cleared', async () => {
    await saveServerCustomHeader('srv-1', { name: 'X-Api-Key', value: 'proxy-secret' });
    const sanitized = await saveServerCustomHeader('srv-1', null);

    expect(sanitized).toBeUndefined();
    expect(withServerCredentials(server({ customHeader: { name: 'X-Api-Key' } })).customHeader)
      .toBeUndefined();
  });

  it('replaces the stored value when a new one is saved', async () => {
    await saveServerCustomHeader('srv-1', { name: 'X-Api-Key', value: 'old' });
    await saveServerCustomHeader('srv-1', { name: 'X-Api-Key', value: 'new' });

    expect(withServerCredentials(server({ customHeader: { name: 'X-Api-Key' } })).customHeader)
      .toEqual({ name: 'X-Api-Key', value: 'new' });
  });
});
