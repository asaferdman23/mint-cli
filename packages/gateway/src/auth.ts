import { hash, compare } from 'bcryptjs'
import { SignJWT, jwtVerify, type JWTPayload } from 'jose'
import { randomBytes, createHash } from 'node:crypto'

if (!process.env.JWT_SECRET) {
  console.error(JSON.stringify({ event: 'fatal', message: 'JWT_SECRET environment variable is required' }))
  process.exit(1)
}
const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET)
const SALT_ROUNDS = 10

// Password hashing
export async function hashPassword(password: string): Promise<string> {
  return hash(password, SALT_ROUNDS)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return compare(password, hash)
}

// API token generation (format: mint_xxxxxxxxxxxx)
export function generateApiToken(): { token: string; hash: string; prefix: string } {
  const raw = randomBytes(32).toString('hex')
  const token = `mint_${raw}`
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const prefix = token.slice(0, 12) // "mint_xxxxxxx"
  return { token, hash: tokenHash, prefix }
}

export function hashApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// JWT for web sessions
export interface JwtPayload extends JWTPayload {
  sub: string    // user_id
  email: string
}

export async function createJwt(userId: string, email: string): Promise<string> {
  return new SignJWT({ sub: userId, email })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(JWT_SECRET)
}

export async function verifyJwt(token: string): Promise<JwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    return payload as JwtPayload
  } catch {
    return null
  }
}

// Input validation
export function validateEmail(email: string): string | null {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!re.test(email)) return 'Invalid email format'
  return null
}

export function validatePassword(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters'
  return null
}
