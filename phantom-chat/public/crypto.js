/**
 * PhantomChat E2EE Module
 * Uses Web Crypto API — X25519-like ECDH + AES-256-GCM
 * All keys stay in the browser. Server sees only ciphertext.
 */

const PhantomCrypto = (() => {
  const ALGO = { name: 'ECDH', namedCurve: 'P-256' };
  const AES_ALGO = 'AES-GCM';
  const AES_LENGTH = 256;

  // Generate a new identity keypair
  async function generateIdentity() {
    const keyPair = await crypto.subtle.generateKey(
      ALGO,
      true, // extractable for export
      ['deriveKey', 'deriveBits']
    );
    return keyPair;
  }

  // Export public key to base64 for sharing
  async function exportPublicKey(publicKey) {
    const raw = await crypto.subtle.exportKey('raw', publicKey);
    return btoa(String.fromCharCode(...new Uint8Array(raw)));
  }

  // Import a public key from base64
  async function importPublicKey(base64) {
    const raw = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    return crypto.subtle.importKey(
      'raw',
      raw,
      ALGO,
      true,
      []
    );
  }

  // Export private key for session storage
  async function exportPrivateKey(privateKey) {
    const jwk = await crypto.subtle.exportKey('jwk', privateKey);
    return JSON.stringify(jwk);
  }

  // Import private key from session storage
  async function importPrivateKey(jwkStr) {
    const jwk = JSON.parse(jwkStr);
    return crypto.subtle.importKey(
      'jwk',
      jwk,
      ALGO,
      true,
      ['deriveKey', 'deriveBits']
    );
  }

  // Derive a shared AES key from our private + their public
  async function deriveSharedKey(privateKey, publicKey) {
    return crypto.subtle.deriveKey(
      { name: 'ECDH', public: publicKey },
      privateKey,
      { name: AES_ALGO, length: AES_LENGTH },
      false,
      ['encrypt', 'decrypt']
    );
  }

  // Encrypt a message with AES-256-GCM
  async function encrypt(sharedKey, plaintext) {
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);

    const ciphertext = await crypto.subtle.encrypt(
      { name: AES_ALGO, iv: nonce },
      sharedKey,
      encoded
    );

    return {
      encrypted: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
      nonce: btoa(String.fromCharCode(...nonce))
    };
  }

  // Decrypt a message with AES-256-GCM
  async function decrypt(sharedKey, encryptedBase64, nonceBase64) {
    const ciphertext = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
    const nonce = Uint8Array.from(atob(nonceBase64), c => c.charCodeAt(0));

    const decrypted = await crypto.subtle.decrypt(
      { name: AES_ALGO, iv: nonce },
      sharedKey,
      ciphertext
    );

    return new TextDecoder().decode(decrypted);
  }

  // Generate anonymous ID from public key hash
  async function generateAnonId(publicKey) {
    const raw = await crypto.subtle.exportKey('raw', publicKey);
    const hash = await crypto.subtle.digest('SHA-256', raw);
    const bytes = new Uint8Array(hash);
    // Format: 8 chars of hex-like hash
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789#@&';
    let id = '';
    for (let i = 0; i < 10; i++) {
      id += chars[bytes[i] % chars.length];
    }
    return id;
  }

  return {
    generateIdentity,
    exportPublicKey,
    importPublicKey,
    exportPrivateKey,
    importPrivateKey,
    deriveSharedKey,
    encrypt,
    decrypt,
    generateAnonId
  };
})();
