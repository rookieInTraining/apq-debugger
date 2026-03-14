/**
 * SHA-256 hash utility for APQ payload contamination.
 * @module sw/hash
 */

/**
 * Compute the SHA-256 hex digest of a string.
 * Uses the Web Crypto API (`crypto.subtle.digest`).
 * @param {string} message - The input string to hash.
 * @returns {Promise<string|null>} Lowercase hex-encoded hash, or `null` on failure.
 */
export async function digestMessage(message) {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  } catch (error) {
    console.error('Hash generation failed:', error);
    return null;
  }
}
