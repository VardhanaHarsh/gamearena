import { createHash, randomBytes, randomInt } from 'node:crypto'

/** Cryptographically secure helpers — dice and room codes are never generated client-side. */
export const secureInt = (minInclusive: number, maxExclusive: number) => randomInt(minInclusive, maxExclusive)
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url')
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function roomCode(length = 6) {
  let out = ''
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)]
  return out
}
