import { randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto'
import { PLAYER_NAME_PREFIXES, PLAYER_NAME_TITLES } from './playerIdentity.js'

const HASH_PREFIX = 'scrypt-v1'
const HASH_PATTERN = /^scrypt-v1:([a-f0-9]{32}):([a-f0-9]{64})$/
export const UNKNOWN_PLAYER_HASH = `${HASH_PREFIX}:${'0'.repeat(32)}:${'0'.repeat(64)}`

function derivePassword(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize('NFC'),
      salt,
      32,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => {
        if (error) reject(error)
        else resolve(key)
      }
    )
  })
}

export async function hashPlayerPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await derivePassword(password, salt)
  return `${HASH_PREFIX}:${salt.toString('hex')}:${hash.toString('hex')}`
}

export async function verifyPlayerPassword(password: string, stored: string): Promise<boolean> {
  const match = HASH_PATTERN.exec(stored)
  if (!match) throw new Error('Stored password verifier is invalid.')
  const hash = await derivePassword(password, Buffer.from(match[1], 'hex'))
  return timingSafeEqual(hash, Buffer.from(match[2], 'hex'))
}

export function generatePlayerName(): string {
  return (
    `${PLAYER_NAME_PREFIXES[randomInt(PLAYER_NAME_PREFIXES.length)]} ` +
    `${PLAYER_NAME_TITLES[randomInt(PLAYER_NAME_TITLES.length)]}`
  )
}
