import { randomInt } from "node:crypto";

export const ORGANIZATION_PUBLIC_ID_LENGTH = 20;
export const ORGANIZATION_PUBLIC_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
export const ORGANIZATION_PUBLIC_ID_PATTERN = /^[a-z0-9]{20}$/;

export function generateOrganizationPublicId() {
  let id = "";

  for (let index = 0; index < ORGANIZATION_PUBLIC_ID_LENGTH; index += 1) {
    id += ORGANIZATION_PUBLIC_ID_ALPHABET[
      randomInt(ORGANIZATION_PUBLIC_ID_ALPHABET.length)
    ];
  }

  return id;
}

export function isOrganizationPublicId(value: string) {
  return ORGANIZATION_PUBLIC_ID_PATTERN.test(value);
}
