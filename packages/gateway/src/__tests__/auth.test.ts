import assert from 'node:assert'
import { createHash } from 'node:crypto'

// ---- Auth utility tests ----

async function testHashAndVerifyPassword() {
  const { hashPassword, verifyPassword } = await import('../auth.js')
  const hash = await hashPassword('testpass123')
  assert.ok(hash.startsWith('$2'), 'Hash should be bcrypt format')
  assert.ok(hash !== 'testpass123', 'Hash should not equal plaintext')
  const valid = await verifyPassword('testpass123', hash)
  assert.strictEqual(valid, true, 'Correct password should verify')
  const invalid = await verifyPassword('wrongpass', hash)
  assert.strictEqual(invalid, false, 'Wrong password should not verify')
  console.log('PASS: hashPassword + verifyPassword')
}

async function testGenerateApiToken() {
  const { generateApiToken } = await import('../auth.js')
  const { token, hash, prefix } = generateApiToken()
  assert.ok(token.startsWith('mint_'), 'Token should start with mint_')
  assert.strictEqual(token.length, 5 + 64, 'Token should be mint_ + 64 hex chars')
  assert.strictEqual(prefix, token.slice(0, 12), 'Prefix should be first 12 chars')
  // Verify hash is SHA-256 of the token
  const expectedHash = createHash('sha256').update(token).digest('hex')
  assert.strictEqual(hash, expectedHash, 'Hash should be SHA-256 of token')
  console.log('PASS: generateApiToken')
}

async function testHashApiToken() {
  const { hashApiToken } = await import('../auth.js')
  const token = 'mint_abc123'
  const hash = hashApiToken(token)
  const expected = createHash('sha256').update(token).digest('hex')
  assert.strictEqual(hash, expected, 'hashApiToken should return SHA-256 hex')
  console.log('PASS: hashApiToken')
}

async function testCreateAndVerifyJwt() {
  const { createJwt, verifyJwt } = await import('../auth.js')
  const jwt = await createJwt('user-123', 'test@example.com')
  assert.ok(typeof jwt === 'string', 'JWT should be a string')
  assert.ok(jwt.split('.').length === 3, 'JWT should have 3 parts')

  const payload = await verifyJwt(jwt)
  assert.ok(payload !== null, 'Valid JWT should verify')
  assert.strictEqual(payload!.sub, 'user-123', 'JWT sub should match userId')
  assert.strictEqual(payload!.email, 'test@example.com', 'JWT email should match')
  console.log('PASS: createJwt + verifyJwt')
}

async function testVerifyJwtInvalid() {
  const { verifyJwt } = await import('../auth.js')
  const result = await verifyJwt('invalid.jwt.token')
  assert.strictEqual(result, null, 'Invalid JWT should return null')
  console.log('PASS: verifyJwt rejects invalid token')
}

async function testValidateEmail() {
  const { validateEmail } = await import('../auth.js')
  assert.strictEqual(validateEmail('test@example.com'), null, 'Valid email should return null')
  assert.ok(validateEmail('invalid') !== null, 'Invalid email should return error')
  assert.ok(validateEmail('') !== null, 'Empty email should return error')
  assert.ok(validateEmail('no@domain') !== null, 'Email without TLD should return error')
  console.log('PASS: validateEmail')
}

async function testValidatePassword() {
  const { validatePassword } = await import('../auth.js')
  assert.strictEqual(validatePassword('longpassword'), null, '8+ char password should be valid')
  assert.ok(validatePassword('short') !== null, 'Short password should return error')
  assert.ok(validatePassword('') !== null, 'Empty password should return error')
  console.log('PASS: validatePassword')
}

// ---- Run all tests ----
let passed = 0
let failed = 0

const tests = [
  testHashAndVerifyPassword,
  testGenerateApiToken,
  testHashApiToken,
  testCreateAndVerifyJwt,
  testVerifyJwtInvalid,
  testValidateEmail,
  testValidatePassword,
]

for (const test of tests) {
  try {
    await test()
    passed++
  } catch (err) {
    failed++
    console.error(`FAIL: ${test.name} — ${err instanceof Error ? err.message : String(err)}`)
  }
}

console.log(`\n${passed}/${tests.length} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
