import {
  base64urlToUint8Array,
  bufferToBase64url,
  isWebAuthnSupported,
  serializePublicKeyCredential,
  toPublicKeyCredentialCreationOptions,
  toPublicKeyCredentialRequestOptions,
} from './webauthn';

function bytes(value: number[]): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(value);
}

function buffer(value: number[]): ArrayBuffer {
  return bytes(value).buffer;
}

describe('webauthn helpers', () => {
  it('decodes empty and non-empty base64url strings', () => {
    expect(base64urlToUint8Array('')).toEqual(new Uint8Array());
    expect(Array.from(base64urlToUint8Array('AQI'))).toEqual([1, 2]);
  });

  it('round-trips bytes via base64url conversion', () => {
    const original = bytes([1, 2, 3, 255, 0]);
    const encoded = bufferToBase64url(buffer([1, 2, 3, 255, 0]));
    const decoded = base64urlToUint8Array(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });

  it('returns false when secure context or credential API is missing', () => {
    const secureSpy = spyOnProperty(globalThis, 'isSecureContext', 'get').and.returnValue(false);
    expect(isWebAuthnSupported()).toBeFalse();

    secureSpy.and.returnValue(true);
    const original = (globalThis as any).PublicKeyCredential;
    Object.defineProperty(globalThis, 'PublicKeyCredential', { configurable: true, value: undefined });
    expect(isWebAuthnSupported()).toBeFalse();
    Object.defineProperty(globalThis, 'PublicKeyCredential', { configurable: true, value: original });
  });

  it('maps credential creation options into binary fields', () => {
    const options = toPublicKeyCredentialCreationOptions({
      challenge: 'AQI',
      user: { id: 'AwQ', name: 'user' },
      excludeCredentials: [{ id: 'BQY', type: 'public-key' }],
    } as any);

    expect(Array.from(new Uint8Array(options.challenge as ArrayBuffer))).toEqual([1, 2]);
    expect(Array.from(new Uint8Array(options.user.id as ArrayBuffer))).toEqual([3, 4]);
    expect(options.excludeCredentials?.length).toBe(1);
    expect(Array.from(new Uint8Array(options.excludeCredentials?.[0].id as ArrayBuffer))).toEqual([5, 6]);
  });

  it('maps request options and handles missing allowCredentials', () => {
    const withAllowed = toPublicKeyCredentialRequestOptions({
      challenge: 'AQI',
      allowCredentials: [{ id: 'AwQ', type: 'public-key' }],
    } as any);
    expect(Array.from(new Uint8Array(withAllowed.challenge as ArrayBuffer))).toEqual([1, 2]);
    expect(Array.from(new Uint8Array(withAllowed.allowCredentials?.[0].id as ArrayBuffer))).toEqual([3, 4]);

    const withoutAllowed = toPublicKeyCredentialRequestOptions({ challenge: 'AQI' } as any);
    expect(withoutAllowed.allowCredentials).toBeUndefined();
  });

  it('serializes public key credential response binary payloads', () => {
    const credential = {
      id: 'cred-1',
      rawId: buffer([1, 2, 3]),
      type: 'public-key',
      response: {
        clientDataJSON: buffer([4, 5]),
        attestationObject: buffer([6]),
        authenticatorData: buffer([7]),
        signature: buffer([8]),
        userHandle: null,
      },
      getClientExtensionResults: () => ({ appid: true }),
    } as unknown as PublicKeyCredential;

    const serialized = serializePublicKeyCredential(credential);
    expect(serialized.id).toBe('cred-1');
    expect(serialized.rawId).toBe(bufferToBase64url(buffer([1, 2, 3])));
    expect(serialized.response.clientDataJSON).toBe(bufferToBase64url(buffer([4, 5])));
    expect(serialized.response.attestationObject).toBe(bufferToBase64url(buffer([6])));
    expect(serialized.response.authenticatorData).toBe(bufferToBase64url(buffer([7])));
    expect(serialized.response.signature).toBe(bufferToBase64url(buffer([8])));
    expect(serialized.response.userHandle).toBeNull();
    expect(serialized.clientExtensionResults).toEqual({ appid: true });
  });
});
