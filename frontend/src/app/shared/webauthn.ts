function padBase64(base64: string): string {
  const missing = base64.length % 4;
  if (!missing) return base64;
  return base64 + '='.repeat(4 - missing);
}

export function isWebAuthnSupported(): boolean {
  if (typeof window === 'undefined') return false;
  if (!window.isSecureContext) return false;
  return typeof window.PublicKeyCredential !== 'undefined' && typeof navigator !== 'undefined' && Boolean(navigator.credentials);
}

export function base64urlToUint8Array(value: string): Uint8Array {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return new Uint8Array();
  const base64 = padBase64(trimmed.replace(/-/g, '+').replace(/_/g, '/'));
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function asBytes(data: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function bytesToBinary(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return binary;
}

function base64ToUrlSafe(base64: string): string {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function bufferToBase64url(data: ArrayBuffer | ArrayBufferView): string {
  const bytes = asBytes(data);
  if (!bytes.length) return '';
  return base64ToUrlSafe(btoa(bytesToBinary(bytes)));
}

export function toPublicKeyCredentialCreationOptions(raw: any): PublicKeyCredentialCreationOptions {
  const challenge = base64urlToUint8Array(raw?.challenge ?? '').buffer;
  const userRaw = raw?.user ?? {};
  const userId = base64urlToUint8Array(userRaw?.id ?? '').buffer;
  const excludeCredentialsRaw = Array.isArray(raw?.excludeCredentials) ? raw.excludeCredentials : [];
  const excludeCredentials = excludeCredentialsRaw.map((cred: any) => ({
    ...cred,
    id: base64urlToUint8Array(cred?.id ?? '').buffer
  }));

  return {
    ...raw,
    challenge,
    user: { ...userRaw, id: userId },
    excludeCredentials
  } as PublicKeyCredentialCreationOptions;
}

export function toPublicKeyCredentialRequestOptions(raw: any): PublicKeyCredentialRequestOptions {
  const challenge = base64urlToUint8Array(raw?.challenge ?? '').buffer;
  const allowCredentialsRaw = Array.isArray(raw?.allowCredentials) ? raw.allowCredentials : null;
  const allowCredentials = allowCredentialsRaw
    ? allowCredentialsRaw.map((cred: any) => ({
        ...cred,
        id: base64urlToUint8Array(cred?.id ?? '').buffer
      }))
    : undefined;

  return {
    ...raw,
    challenge,
    allowCredentials
  } as PublicKeyCredentialRequestOptions;
}

export function serializePublicKeyCredential(credential: PublicKeyCredential): any {
  const response: any = credential.response as any;
  const json: any = {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToBase64url(response.clientDataJSON)
    },
    clientExtensionResults: credential.getClientExtensionResults ? credential.getClientExtensionResults() : {}
  };

  if (response?.attestationObject) {
    json.response.attestationObject = bufferToBase64url(response.attestationObject);
  }
  if (response?.authenticatorData) {
    json.response.authenticatorData = bufferToBase64url(response.authenticatorData);
  }
  if (response?.signature) {
    json.response.signature = bufferToBase64url(response.signature);
  }
  if ('userHandle' in response) {
    json.response.userHandle = response.userHandle ? bufferToBase64url(response.userHandle) : null;
  }
  return json;
}
