# Changelog

All notable changes to Mint CLI will be documented in this file.

## [0.3.0-beta.1] - 2026-05-09

### 🚀 Major Architecture Rewrite

**"One Brain, Four Engines Deleted"**

This release represents a complete architectural simplification. We deleted 8,000+ lines of complex orchestration code and replaced it with a single unified "brain" that intelligently routes between cheap and smart models.

### ✨ New Features

#### Free Tier & Quota System
- **50 free requests** for all new users - no credit card required
- `mint quota` - Check your remaining free requests and usage
- `mint account` - Comprehensive dashboard showing plan, usage, API keys, and quick actions
- Real-time quota display in TUI status bar (e.g., "42/50 free")
- Smart warnings at 80% usage with upgrade options
- Graceful handling when quota is exceeded

#### Improved UX
- Better error messages for quota/rate limits with clear next steps
- Status bar now shows quota alongside cost and savings
- Auto-refresh quota after each task
- Clear upgrade paths: Pro plan or bring-your-own API keys

#### New Commands
- `mint quota` - View detailed quota and usage
- `mint account` - Account dashboard with all info in one place
- Enhanced `mint signup` and `mint login` flows

### 🔧 Core Changes

#### Smart Context Engine (DeepSeek V3.2)
- Replaced multi-agent pipeline with single intelligent brain
- Automatic task classification (question, edit, refactor, debug)
- Smart model routing: cheap for simple tasks, powerful for complex
- Hybrid retrieval with BM25 + embeddings (when gateway supports)
- Context-aware file selection

#### Cost Optimization
- Real Opus comparison tracking (no more hardcoded multipliers)
- Typical savings: 95-98% vs Claude Opus
- Most tasks under $0.01
- Transparent cost tracking in every command

### 🐛 Fixes
- Fixed OAuth auth flow for Windows users
- Better browser launch fallback (shows URL if browser fails)
- Improved error handling throughout
- More reliable gateway authentication

### 📝 Developer Experience
- Cleaner codebase (deleted: agents/, context/classifier.ts, orchestrator.ts)
- Single entry point: `brain/index.ts`
- Simpler tool system
- Better TypeScript types throughout

### 🔄 Breaking Changes
- Old multi-agent system removed (orchestrator, architect, builder, etc.)
- Environment variable `MINT_BRAIN=1` no longer needed (brain is now default)
- Legacy `mint run` and comparison commands removed

### 📦 Dependencies
- Updated `@anthropic-ai/sdk` to 0.82.0
- Updated `@google/generative-ai` to 0.24.1
- Updated `openai` to 4.67.0

---

## [0.2.0-beta.8] - 2026-05-04

Previous beta with multi-agent architecture (now deprecated).

---

## How to Upgrade

```bash
npm install -g usemint-cli@latest
mint login  # Get your 50 free requests
mint init   # Re-index your project with new smart context
```

## Migration Guide

### From 0.2.x

The brain is now the default and only execution mode. No configuration changes needed.

**Old:**
```bash
MINT_BRAIN=1 mint "add a login form"
```

**New:**
```bash
mint "add a login form"  # Just works!
```

### Quota Management

New users automatically get 50 free requests. After that:

1. **Upgrade to Pro** for unlimited requests
2. **Add your own API keys** (free forever):
   ```bash
   mint config:set providers.deepseek <your-deepseek-key>
   ```

Check your status anytime:
```bash
mint quota    # Quick quota check
mint account  # Full account dashboard
mint usage    # Cost breakdown and savings
```

---

**Full Changelog**: https://github.com/asaferdman23/mint-cli/compare/v0.2.0-beta.8...v0.3.0-beta.1
