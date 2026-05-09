# Server-Side Requirements for Product Hunt Launch

This document outlines the backend/gateway work needed to support the free tier quota system.

## Overview

The CLI is ready for the free tier launch. You need to implement server-side quota tracking and enforcement in your `mint-gateway` service.

## Required Endpoints

### 1. `/auth/quota` (GET)

**Purpose:** Return current user's quota and usage

**Request:**
```http
GET /auth/quota
Authorization: Bearer <user_api_token>
```

**Response:**
```json
{
  "requests_used": 23,
  "requests_limit": 50,
  "tokens_used": 1250000,
  "cost_total": 0.0456,
  "plan_type": "free",
  "reset_date": "2026-06-01",
  "upgrade_url": "https://usemint.dev/upgrade"
}
```

**Fields:**
- `requests_used` (int): Number of requests used in current period
- `requests_limit` (int): Total requests allowed (50 for free tier)
- `tokens_used` (int): Total tokens consumed
- `cost_total` (float): Total cost in USD
- `plan_type` (string): "free", "pro", or "enterprise"
- `reset_date` (string, optional): When quota resets (ISO date or human readable)
- `upgrade_url` (string, optional): URL to upgrade page

**Error Responses:**
- `401`: Unauthorized (token invalid/expired)
- `500`: Server error

---

### 2. `/v1/chat` and `/v1/agent` (POST) - Quota Enforcement

**Purpose:** Enforce quota limits on existing endpoints

**Changes Needed:**

1. **Track requests**: Increment user's request counter on each successful call
2. **Check quota**: Before processing, verify user hasn't exceeded limit
3. **Return 429**: If over quota, return rate limit error

**Error Response (429):**
```json
{
  "error": "You've used all 50 of your free requests. Upgrade to Pro or add your own API keys to continue.",
  "quota_used": 50,
  "quota_limit": 50,
  "upgrade_url": "https://usemint.dev/upgrade"
}
```

The CLI expects a 429 status code and will parse the error message to show helpful upgrade/BYOK instructions.

---

## Database Schema

### `users` table additions
```sql
-- Add these columns to your users table
ALTER TABLE users ADD COLUMN plan_type VARCHAR(20) DEFAULT 'free';
ALTER TABLE users ADD COLUMN requests_used INT DEFAULT 0;
ALTER TABLE users ADD COLUMN requests_limit INT DEFAULT 50;
ALTER TABLE users ADD COLUMN quota_reset_date TIMESTAMP;
ALTER TABLE users ADD COLUMN tokens_used BIGINT DEFAULT 0;
ALTER TABLE users ADD COLUMN cost_total DECIMAL(10,6) DEFAULT 0;
```

### Optional: `usage_history` table
Track detailed usage for analytics:
```sql
CREATE TABLE usage_history (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id),
  endpoint VARCHAR(50),  -- '/v1/chat' or '/v1/agent'
  model VARCHAR(50),
  input_tokens INT,
  output_tokens INT,
  cost DECIMAL(10,6),
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## Quota Reset Strategy

You have two options:

### Option 1: Monthly Reset (Recommended)
- Reset `requests_used` to 0 on the 1st of each month
- Set `quota_reset_date` to first day of next month
- Run a cron job: `0 0 1 * * ?` (midnight on 1st of month)

```sql
UPDATE users 
SET requests_used = 0, 
    quota_reset_date = DATE_TRUNC('month', NOW() + INTERVAL '1 month')
WHERE plan_type = 'free';
```

### Option 2: Rolling 30-day Window
- Track `first_request_date`
- Reset after 30 days from first request
- More complex but fairer for mid-month signups

---

## Implementation Checklist

- [ ] Add quota fields to users table
- [ ] Implement `GET /auth/quota` endpoint
- [ ] Add quota check middleware to `/v1/chat` and `/v1/agent`
- [ ] Return 429 errors with helpful messages when over quota
- [ ] Increment counters on successful requests
- [ ] Set up monthly/rolling reset cron job
- [ ] Add usage tracking for analytics (optional)
- [ ] Test quota enforcement flow end-to-end
- [ ] Set up monitoring/alerts for quota system
- [ ] Create upgrade page at `/upgrade` (or update URL in responses)

---

## Rate Limiting vs Quota

These are different:

**Quota** (50 requests/month)
- Long-term limit
- Tied to user account
- Resets monthly
- Implemented in this spec

**Rate Limiting** (requests/minute)
- Short-term protection against abuse
- Should also be implemented
- Example: 10 requests/minute per user
- Use existing rate-limiting middleware (express-rate-limit, etc.)

---

## Testing

### Test Free Tier User
1. Create test user: `test@example.com`
2. Set `requests_used = 45`, `requests_limit = 50`
3. CLI should show: "45/50 free requests"
4. Make 5 requests → should work
5. 6th request → should get 429 with quota error

### Test Quota Warning (80%)
1. Set `requests_used = 41`, `requests_limit = 50`
2. CLI should show warning: "You've used 41 of 50..."
3. Status bar should show yellow color

### Test Quota Exceeded
1. Set `requests_used = 50`, `requests_limit = 50`
2. Any request should return 429
3. CLI should show upgrade/BYOK message

### Test Pro User
1. Set `plan_type = 'pro'`, `requests_limit = -1` (unlimited)
2. All requests should work
3. No quota shown in CLI status bar

---

## Client-Side (Already Implemented)

The CLI now includes:

✅ `mint quota` command - fetches and displays quota  
✅ `mint account` command - comprehensive dashboard  
✅ TUI status bar - shows "X/50 free" in real-time  
✅ 80% warning - alerts when approaching limit  
✅ 429 error handling - shows upgrade/BYOK options  
✅ Auto-refresh quota - after each completed task  

---

## Next Steps

1. **You implement**: Server-side quota tracking (this document)
2. **Test together**: End-to-end flow with real gateway
3. **Set up monitoring**: Track quota usage, 429 rates, upgrade conversions
4. **Create upgrade page**: Landing page for Pro plan
5. **Launch on Product Hunt!** 🚀

---

## Questions?

- What's the pricing for Pro tier?
- Should we support team/organization accounts?
- Do we need usage analytics dashboard for users?
- Should quota reset be calendar month or rolling 30-day?

Let me know if you need any clarifications on the implementation!
