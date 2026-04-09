import * as crypto from 'crypto';

const ENCRYPTED_PREFIX = 'ENCRYPTED:';
const ALGORITHM = 'aes-256-gcm';
const KEY_LEN = 32;
const SALT_LEN = 16;
const IV_LEN = 12;

/**
 * Encrypt a plaintext value with a passphrase.
 * Returns a string in the format: ENCRYPTED:<iv_hex>:<salt_hex>:<authTag_hex>:<ciphertext_hex>
 */
export function encrypt(plaintext: string, passphrase: string): string {
  const salt = crypto.randomBytes(SALT_LEN);
  const iv = crypto.randomBytes(IV_LEN);
  const key = crypto.scryptSync(passphrase, salt, KEY_LEN);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return (
    ENCRYPTED_PREFIX +
    iv.toString('hex') + ':' +
    salt.toString('hex') + ':' +
    authTag.toString('hex') + ':' +
    encrypted.toString('hex')
  );
}

/**
 * Decrypt a value produced by encrypt().
 * Returns the original plaintext.
 * Throws if the passphrase is wrong or the value is malformed.
 */
export function decrypt(encryptedValue: string, passphrase: string): string {
  if (!encryptedValue.startsWith(ENCRYPTED_PREFIX)) {
    throw new Error('Value is not an encrypted carry-on secret');
  }

  const parts = encryptedValue.slice(ENCRYPTED_PREFIX.length).split(':');
  if (parts.length !== 4) {
    throw new Error('Malformed encrypted value');
  }

  const [ivHex, saltHex, authTagHex, ciphertextHex] = parts;
  const iv = Buffer.from(ivHex!, 'hex');
  const salt = Buffer.from(saltHex!, 'hex');
  const authTag = Buffer.from(authTagHex!, 'hex');
  const ciphertext = Buffer.from(ciphertextHex!, 'hex');

  const key = crypto.scryptSync(passphrase, salt, KEY_LEN);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  try {
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    throw new Error('Decryption failed — wrong passphrase or corrupted data');
  }
}

/**
 * Returns true if the value is an encrypted carry-on secret.
 */
export function isEncrypted(value: string): boolean {
  return typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX);
}

/**
 * Encrypt all string values in an env object.
 * Returns the encrypted env and a list of key names that were encrypted.
 */
export function encryptEnv(
  env: Record<string, string>,
  passphrase: string
): { encrypted: Record<string, string>; encryptedKeys: string[] } {
  const encrypted: Record<string, string> = {};
  const encryptedKeys: string[] = [];

  for (const [key, value] of Object.entries(env)) {
    if (value && !isEncrypted(value)) {
      encrypted[key] = encrypt(value, passphrase);
      encryptedKeys.push(key);
    } else {
      encrypted[key] = value;
    }
  }

  return { encrypted, encryptedKeys };
}

/**
 * Decrypt all encrypted values in an env object.
 */
export function decryptEnv(
  env: Record<string, string>,
  passphrase: string
): Record<string, string> {
  const decrypted: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    if (isEncrypted(value)) {
      decrypted[key] = decrypt(value, passphrase);
    } else {
      decrypted[key] = value;
    }
  }

  return decrypted;
}
