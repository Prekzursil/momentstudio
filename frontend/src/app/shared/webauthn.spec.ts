import {
  base64urlToUint8Array,
  bufferToBase64url,
  isWebAuthnSupported,
  serializePublicKeyCredential,
  toPublicKeyCredentialCreationOptions,
  toPublicKeyCredentialRequestOptions,
} from './webauthn';

describe('webauthn helpers', () => {
  describe('isWebAuthnSupported', () => {
    it('returns false when the context is not secure', () => {
      spyOnProperty(window, 'isSecureContext', 'get').and.returnValue(false);
      expect(isWebAuthnSupported()).toBeFalse();
    });

    it('returns true in a secure context with PublicKeyCredential + credentials', () => {
      spyOnProperty(window, 'isSecureContext', 'get').and.returnValue(true);
      const win = window as unknown as { PublicKeyCredential?: unknown };
      const hadPkc = 'PublicKeyCredential' in win;
      const original = win.PublicKeyCredential;
      win.PublicKeyCredential = original ?? function () {};
      try {
        const result = isWebAuthnSupported();
        expect(result).toBe(Boolean(navigator.credentials));
      } finally {
        if (hadPkc) {
          win.PublicKeyCredential = original;
        } else {
          delete win.PublicKeyCredential;
        }
      }
    });

    it('returns false when PublicKeyCredential is unavailable', () => {
      spyOnProperty(window, 'isSecureContext', 'get').and.returnValue(true);
      const win = window as unknown as { PublicKeyCredential?: unknown };
      const hadPkc = 'PublicKeyCredential' in win;
      const original = win.PublicKeyCredential;
      delete win.PublicKeyCredential;
      try {
        expect(isWebAuthnSupported()).toBeFalse();
      } finally {
        if (hadPkc) {
          win.PublicKeyCredential = original;
        }
      }
    });
  });

  describe('base64urlToUint8Array', () => {
    it('returns an empty array for empty/null input', () => {
      expect(base64urlToUint8Array('').length).toBe(0);
      expect(base64urlToUint8Array(null as unknown as string).length).toBe(0);
    });

    it('decodes a base64url string and pads as needed', () => {
      // "hi" -> base64 "aGk=" -> base64url "aGk"
      const bytes = base64urlToUint8Array('aGk');
      expect(Array.from(bytes)).toEqual([104, 105]);
    });

    it('keeps already-padded base64 untouched (no padding branch)', () => {
      const bytes = base64urlToUint8Array('YWJjZA=='); // "abcd"
      expect(String.fromCharCode(...bytes)).toBe('abcd');
    });
  });

  describe('bufferToBase64url', () => {
    it('returns empty string for empty buffers', () => {
      expect(bufferToBase64url(new Uint8Array())).toBe('');
      expect(bufferToBase64url(new ArrayBuffer(0))).toBe('');
    });

    it('encodes an ArrayBuffer', () => {
      const encoded = bufferToBase64url(new Uint8Array([104, 105]).buffer);
      expect(encoded).toBe('aGk');
    });

    it('encodes an ArrayBufferView and large buffers across chunks', () => {
      const big = new Uint8Array(0x8000 + 5).fill(65);
      const encoded = bufferToBase64url(big);
      expect(encoded.length).toBeGreaterThan(0);
      expect(encoded).not.toContain('+');
      expect(encoded).not.toContain('/');
      expect(encoded.endsWith('=')).toBeFalse();
    });
  });

  describe('toPublicKeyCredentialCreationOptions', () => {
    it('maps challenge, user id, and excludeCredentials', () => {
      const result = toPublicKeyCredentialCreationOptions({
        challenge: 'aGk',
        user: { id: 'aGk', name: 'x' },
        excludeCredentials: [{ id: 'aGk', type: 'public-key' }],
        rp: { name: 'rp' },
      });
      expect(result.challenge.byteLength).toBe(2);
      expect((result.user.id as ArrayBuffer).byteLength).toBe(2);
      expect(result.excludeCredentials?.length).toBe(1);
    });

    it('defaults missing fields to empty', () => {
      const result = toPublicKeyCredentialCreationOptions({});
      expect(result.challenge.byteLength).toBe(0);
      expect(result.excludeCredentials).toEqual([]);
    });

    it('handles excludeCredentials entries with no id', () => {
      const result = toPublicKeyCredentialCreationOptions({
        excludeCredentials: [{ type: 'public-key' }],
      });
      expect((result.excludeCredentials?.[0].id as ArrayBuffer).byteLength).toBe(0);
    });
  });

  describe('toPublicKeyCredentialRequestOptions', () => {
    it('maps challenge and allowCredentials when present', () => {
      const result = toPublicKeyCredentialRequestOptions({
        challenge: 'aGk',
        allowCredentials: [{ id: 'aGk', type: 'public-key' }],
      });
      expect(result.challenge.byteLength).toBe(2);
      expect(result.allowCredentials?.length).toBe(1);
    });

    it('leaves allowCredentials undefined when not an array', () => {
      const result = toPublicKeyCredentialRequestOptions({ challenge: 'aGk' });
      expect(result.allowCredentials).toBeUndefined();
    });

    it('defaults a missing challenge and allowCredential ids to empty', () => {
      const result = toPublicKeyCredentialRequestOptions({
        allowCredentials: [{ type: 'public-key' }],
      });
      expect(result.challenge.byteLength).toBe(0);
      expect((result.allowCredentials?.[0].id as ArrayBuffer).byteLength).toBe(0);
    });
  });

  describe('serializePublicKeyCredential', () => {
    function buf(text: string): ArrayBuffer {
      return new TextEncoder().encode(text).buffer;
    }

    it('serializes an attestation (registration) credential', () => {
      const credential = {
        id: 'cred-1',
        type: 'public-key',
        rawId: buf('raw'),
        response: {
          clientDataJSON: buf('cdj'),
          attestationObject: buf('att'),
        },
        getClientExtensionResults: () => ({ ext: true }),
      } as unknown as PublicKeyCredential;

      const json = serializePublicKeyCredential(credential);
      expect(json.id).toBe('cred-1');
      expect(json.response.clientDataJSON.length).toBeGreaterThan(0);
      expect(json.response.attestationObject.length).toBeGreaterThan(0);
      expect(json.clientExtensionResults).toEqual({ ext: true });
    });

    it('serializes an assertion credential and a present-but-empty userHandle', () => {
      const credential = {
        id: 'cred-2',
        type: 'public-key',
        rawId: buf('raw'),
        response: {
          clientDataJSON: buf('cdj'),
          authenticatorData: buf('auth'),
          signature: buf('sig'),
          userHandle: null,
        },
      } as unknown as PublicKeyCredential;

      const json = serializePublicKeyCredential(credential);
      expect(json.response.authenticatorData.length).toBeGreaterThan(0);
      expect(json.response.signature.length).toBeGreaterThan(0);
      expect(json.response.userHandle).toBeNull();
      expect(json.clientExtensionResults).toEqual({});
    });

    it('serializes a non-null userHandle', () => {
      const credential = {
        id: 'cred-3',
        type: 'public-key',
        rawId: buf('raw'),
        response: {
          clientDataJSON: buf('cdj'),
          userHandle: buf('uh'),
        },
      } as unknown as PublicKeyCredential;

      const json = serializePublicKeyCredential(credential);
      expect(typeof json.response.userHandle).toBe('string');
      expect(json.response.userHandle.length).toBeGreaterThan(0);
    });
  });
});
