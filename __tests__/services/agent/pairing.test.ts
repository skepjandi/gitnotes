import { buildPairingLink, normalizeBridgeUrl, parsePairingLink } from '../../../src/services/agent/pairing';

describe('normalizeBridgeUrl', () => {
  it('keeps ws:// and wss:// addresses and strips trailing slashes', () => {
    expect(normalizeBridgeUrl('ws://192.168.1.20:7878/')).toBe('ws://192.168.1.20:7878');
    expect(normalizeBridgeUrl('wss://bridge.example.com///')).toBe('wss://bridge.example.com');
    expect(normalizeBridgeUrl('  WSS://Bridge.Example.com:443/agents/ ')).toBe('wss://Bridge.Example.com:443/agents');
  });

  it('adds ws:// and the default port when the scheme and port are missing', () => {
    expect(normalizeBridgeUrl('192.168.1.20')).toBe('ws://192.168.1.20:7878');
    expect(normalizeBridgeUrl('my-mac.local:9000')).toBe('ws://my-mac.local:9000');
    expect(normalizeBridgeUrl('[::1]')).toBe('ws://[::1]:7878');
  });

  it('maps http(s) to ws(s) and drops query and fragment', () => {
    expect(normalizeBridgeUrl('https://bridge.example.com/?token=abc#frag')).toBe('wss://bridge.example.com');
    expect(normalizeBridgeUrl('http://localhost:7878')).toBe('ws://localhost:7878');
  });

  it.each(['', '   ', 'ftp://host', 'ws://', 'ws://bad host', 'ws://host:99999', 'ws://user@host', '://nothing'])(
    'throws on junk input %p',
    (junk) => {
      expect(() => normalizeBridgeUrl(junk)).toThrow();
    },
  );
});

describe('parsePairingLink', () => {
  it('parses the gitnotes:// pairing link with encoded characters', () => {
    const link = 'gitnotes://agents/pair?url=wss%3A%2F%2Fbridge.example.com%2Fa&token=ab%2Bc%2Fd%3D&name=My%20Mac%20%26%20Co';
    expect(parsePairingLink(link)).toEqual({ url: 'wss://bridge.example.com/a', token: 'ab+c/d=', name: 'My Mac & Co' });
  });

  it('accepts a bare ws URL with the token in the fragment or the query', () => {
    expect(parsePairingLink('ws://10.0.0.5:7878#secret')).toEqual({ url: 'ws://10.0.0.5:7878', token: 'secret' });
    expect(parsePairingLink('ws://10.0.0.5:7878#token=secret')).toEqual({ url: 'ws://10.0.0.5:7878', token: 'secret' });
    expect(parsePairingLink('wss://b.example.com/?token=secret&name=Work')).toEqual({
      url: 'wss://b.example.com',
      token: 'secret',
      name: 'Work',
    });
  });

  it('tolerates surrounding whitespace and an uppercase scheme', () => {
    expect(parsePairingLink('  GITNOTES://agents/pair?url=ws%3A%2F%2Fh%3A1&token=t\n')).toEqual({ url: 'ws://h:1', token: 't' });
  });

  it('omits an empty name', () => {
    expect(parsePairingLink('gitnotes://agents/pair?url=ws%3A%2F%2Fh%3A1&token=t&name=%20')).toEqual({ url: 'ws://h:1', token: 't' });
  });

  it.each([
    ['empty', ''],
    ['not a link', 'hello world'],
    ['missing token', 'gitnotes://agents/pair?url=ws%3A%2F%2Fh%3A1'],
    ['blank token', 'gitnotes://agents/pair?url=ws%3A%2F%2Fh%3A1&token=%20'],
    ['missing url', 'gitnotes://agents/pair?token=t'],
    ['junk url', 'gitnotes://agents/pair?url=ftp%3A%2F%2Fh&token=t'],
    ['no query', 'gitnotes://agents/pair'],
    ['wrong path', 'gitnotes://agents/pairing?url=ws%3A%2F%2Fh&token=t'],
    ['bad percent encoding', 'gitnotes://agents/pair?url=ws%3A%2F%2Fh&token=%E0%A4%A'],
    ['bare url without token', 'ws://10.0.0.5:7878'],
    ['other scheme', 'https://example.com/?token=t'],
  ])('rejects %s', (_label, input) => {
    expect(parsePairingLink(input)).toBeNull();
  });
});

describe('buildPairingLink', () => {
  it('round-trips through parsePairingLink, including characters that need encoding', () => {
    const original = { url: 'wss://bridge.example.com/a', token: 'a+b/c=&d', name: 'Dev box #1' };
    expect(parsePairingLink(buildPairingLink(original))).toEqual(original);
  });

  it('omits name when absent', () => {
    expect(buildPairingLink({ url: 'ws://h:1', token: 't' })).toBe('gitnotes://agents/pair?url=ws%3A%2F%2Fh%3A1&token=t');
  });
});
