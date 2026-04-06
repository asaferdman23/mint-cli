# OAuth Auth System Spec

## Overview

Replace API key signup with OAuth (Google/GitHub). One Supabase project handles auth, user storage, and usage tracking. $0 infrastructure cost (Supabase free tier).

---

## 1. CLI Flow (`mint login`)

```
User runs: mint
  ↓
CLI checks: is there a saved token in ~/.mintrc?
  ↓ No token found
CLI starts local HTTP server on localhost:9876
CLI opens browser to: https://usemint.dev/auth?callback=http://localhost:9876/callback
CLI shows: "Opening browser to sign in..."
  ↓
User signs in with Google or GitHub on usemint.dev/auth
Supabase handles OAuth → returns session token
Browser redirects to: http://localhost:9876/callback?token=<supabase_access_token>&email=<user_email>
  ↓
CLI receives token from callback
CLI saves to ~/.mintrc: { "token": "...", "email": "user@gmail.com" }
CLI stops local server
CLI shows: "Signed in as user@gmail.com — 20 free tasks/day"
  ↓
All subsequent requests include: Authorization: Bearer <token>
```

### Files to create/modify:
- `src/cli/commands/auth.ts` — rewrite `login` to use OAuth flow
- Token storage: `~/.mintrc` (JSON file, gitignored)

### Token refresh:
- Supabase tokens expire after 1 hour by default
- On 401 from gateway → CLI shows "Session expired. Run `mint login` to re-authenticate"
- Future: auto-refresh with refresh_token stored in ~/.mintrc

---

## 2. Landing Page — usemint.dev/auth

### Page: `/auth`

Simple page with two buttons:
- "Sign in with Google" → Supabase `signInWithOAuth({ provider: 'google' })`
- "Sign in with GitHub" → Supabase `signInWithOAuth({ provider: 'github' })`

### Flow:
1. User clicks button
2. Supabase redirects to Google/GitHub OAuth consent
3. User authorizes
4. Supabase redirects back to `usemint.dev/auth/callback`
5. Callback page extracts the session token
6. Redirects to `http://localhost:9876/callback?token=<token>&email=<email>`
7. Shows "Connected! You can close this tab."

### Files to create:
- `landing/src/pages/Auth.tsx` — sign in buttons
- `landing/src/pages/AuthCallback.tsx` — handles Supabase redirect, sends token to CLI

### Supabase setup:
- Create Supabase project (free tier)
- Enable Google OAuth provider (needs Google Cloud OAuth client ID)
- Enable GitHub OAuth provider (needs GitHub OAuth app)
- Set redirect URL to `https://usemint.dev/auth/callback`

---

## 3. Gateway — Token Validation

### Request flow:
```
CLI request → Authorization: Bearer <supabase_token>
  ↓
Gateway middleware:
  1. Extract token from header
  2. Validate with Supabase: supabase.auth.getUser(token)
  3. If invalid → 401 "Sign in with: mint login"
  4. If valid → get user_id, check daily usage
  5. If free plan && daily_usage >= 20 → 429 "Upgrade to Pro at usemint.dev/pricing"
  6. If ok → increment daily_usage, proceed to route handler
```

### Files to modify:
- `packages/gateway/src/index.ts` — replace current auth middleware with Supabase validation
- `packages/gateway/src/auth.ts` — rewrite to use Supabase client
- New: `packages/gateway/src/usage-limiter.ts` — daily usage tracking

### Usage tracking (in Supabase, no separate DB):
```sql
-- Add to Supabase users metadata or create a profiles table
create table profiles (
  id uuid references auth.users primary key,
  email text,
  plan text default 'free',
  daily_usage integer default 0,
  last_usage_date date default current_date,
  created_at timestamp default now()
);

-- Reset daily usage (cron or on-check)
-- When last_usage_date != today: set daily_usage = 0, last_usage_date = today
```

### Rate limit response:
```json
{
  "error": "Daily limit reached (20/20). Upgrade to Pro for unlimited tasks.",
  "upgrade_url": "https://usemint.dev/pricing"
}
```

---

## 4. Database — Supabase

### Tables:

**profiles** (extends Supabase auth.users):
| Column | Type | Default |
|--------|------|---------|
| id | uuid (FK to auth.users) | — |
| email | text | — |
| plan | text | 'free' |
| daily_usage | int | 0 |
| last_usage_date | date | today |
| total_tasks | int | 0 |
| created_at | timestamp | now() |

**No other tables needed.** Supabase Auth handles users, sessions, OAuth tokens. The profiles table just adds plan + usage tracking.

### Row-Level Security:
```sql
-- Users can only read their own profile
create policy "Users read own profile" on profiles
  for select using (auth.uid() = id);

-- Gateway service role can update any profile (for incrementing usage)
-- Use Supabase service_role key in gateway (never exposed to client)
```

---

## 5. Future: Payments

### When ready:
1. Add Stripe checkout to `usemint.dev/pricing`
2. Stripe webhook → update `profiles.plan = 'pro'` in Supabase
3. Gateway checks `plan` column:
   - `free` → 20 tasks/day limit
   - `pro` → unlimited
   - `enterprise` → unlimited + priority routing

### Not building now:
- Stripe integration
- Pricing page
- Pro features

---

## Environment Variables

### Supabase (needed in landing + gateway):
- `SUPABASE_URL` — project URL
- `SUPABASE_ANON_KEY` — public key (for landing page auth)
- `SUPABASE_SERVICE_ROLE_KEY` — private key (for gateway user validation)

### Add to Railway shared variables:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### Add to landing page .env:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

---

## Build Order

1. **Supabase setup** — create project, enable Google + GitHub OAuth, create profiles table
2. **Landing page auth** — `/auth` page with sign-in buttons, `/auth/callback` page
3. **CLI login** — local HTTP server, browser open, token save to ~/.mintrc
4. **Gateway middleware** — Supabase token validation, usage tracking
5. **Test end-to-end** — CLI → browser → sign in → token → gateway → task works

---

## Cost

| Component | Cost |
|-----------|------|
| Supabase free tier | $0 (50,000 MAU, 500MB DB) |
| Google OAuth | $0 |
| GitHub OAuth | $0 |
| Gateway changes | $0 (code only) |
| **Total** | **$0** |

Supabase free tier supports 50,000 monthly active users. We won't hit that for a long time.
