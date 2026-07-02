import {
  randomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual,
  createHash,
} from "node:crypto";

const PIN_HASH_PREFIX = "scrypt";
const PIN_HASH_VERSION = "v1";
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_MAX_MEMORY = 32 * 1024 * 1024;

export async function hashPin(pin: string) {
  const salt = randomBytes(16);
  const derivedKey = await deriveKey(pin, salt);

  return [
    PIN_HASH_PREFIX,
    PIN_HASH_VERSION,
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}

export async function verifyPin(pin: string, encodedHash: string) {
  const parts = encodedHash.split("$");

  if (
    parts.length !== 4 ||
    parts[0] !== PIN_HASH_PREFIX ||
    parts[1] !== PIN_HASH_VERSION
  ) {
    return false;
  }

  try {
    const salt = Buffer.from(parts[2], "base64url");
    const expectedKey = Buffer.from(parts[3], "base64url");

    if (salt.length !== 16 || expectedKey.length !== SCRYPT_KEY_LENGTH) {
      return false;
    }

    const actualKey = await deriveKey(pin, salt);
    return timingSafeEqual(actualKey, expectedKey);
  } catch {
    return false;
  }
}

export function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("base64url");
}

function deriveKey(pin: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    nodeScrypt(
      pin,
      salt,
      SCRYPT_KEY_LENGTH,
      {
        N: SCRYPT_COST,
        r: SCRYPT_BLOCK_SIZE,
        p: SCRYPT_PARALLELIZATION,
        maxmem: SCRYPT_MAX_MEMORY,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(derivedKey);
      },
    );
  });
}
