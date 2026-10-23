import { describe, expect, it } from 'vitest';
import { meetsDifficulty, sha256Hex } from './sha256';

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

describe('sha256Hex', () => {
  it('matches the FIPS 180-4 vectors', () => {
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
    expect(sha256Hex('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    );
  });

  it('handles padding boundaries and long input', async () => {
    for (const text of ['a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(1000)]) {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      expect(sha256Hex(text)).toBe(toHex(digest));
    }
  });

  it('agrees with WebCrypto on random strings', async () => {
    const samples = ['', 'salt0', 'deadbeef-123', 'x'.repeat(200), 'é–漢字'];
    for (const sample of samples) {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sample));
      expect(sha256Hex(sample)).toBe(toHex(digest));
    }
  });

  it('meetsDifficulty checks leading zero nibbles', () => {
    const salt = 'abc';
    let nonce = 0;
    while (sha256Hex(`${salt}${nonce}`)[0] !== '0') nonce += 1;
    expect(meetsDifficulty(salt, nonce, 1)).toBe(true);
    expect(meetsDifficulty(salt, nonce, 8)).toBe(false);
  });
});
