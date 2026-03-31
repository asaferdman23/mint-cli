# Axon CLI

AI coding CLI with smart model routing and cost optimization.

```
   █████╗ ██╗  ██╗ ██████╗ ███╗   ██╗
  ██╔══██╗╚██╗██╔╝██╔═══██╗████╗  ██║
  ███████║ ╚███╔╝ ██║   ██║██╔██╗ ██║
  ██╔══██║ ██╔██╗ ██║   ██║██║╚██╗██║
  ██║  ██║██╔╝ ██╗╚██████╔╝██║ ╚████║
  ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝
```

## Features

- 🚀 **Smart Model Routing** - Automatically picks the best model for your task
- 💰 **Cost Optimization** - Uses cheaper models (DeepSeek, Qwen) when quality allows
- 📊 **Cost Visibility** - See exactly what you're spending per request
- 🔄 **Compare Mode** - Run same prompt on multiple models and compare
- 📁 **Context Aware** - Automatically gathers relevant code context
- 🔐 **Enterprise Ready** - SSO, usage tracking, team management

## Installation

```bash
npm install -g axon-cli
```

## Quick Start

```bash
# Login (for teams with SSO)
axon login

# Or use BYOK (Bring Your Own Keys)
axon config:set providers.deepseek sk-xxx
axon config:set providers.anthropic sk-xxx

# Run a prompt
axon "refactor the auth module to use JWT"

# Explicitly choose a model
axon -m deepseek "write tests for utils.ts"
axon -m sonnet "explain this codebase architecture"

# Compare models
axon compare "implement a rate limiter" --models=deepseek,sonnet

# See usage stats
axon usage
```

## Commands

### Main Command

```bash
axon [prompt] [options]
```

| Option | Description |
|--------|-------------|
| `-m, --model <model>` | Model to use: auto (default), deepseek, sonnet, opus |
| `-c, --compare` | Compare results across models |
| `--no-context` | Disable automatic context gathering |
| `-v, --verbose` | Show detailed output with costs |

### Auth

```bash
axon login    # Opens browser for SSO
axon logout   # Clear credentials
axon whoami   # Show current user
```

### Config

```bash
axon config                           # Show all config
axon config:set defaultModel sonnet   # Set default model
axon config:set providers.deepseek sk-xxx  # Set provider key
```

### Compare

```bash
axon compare "your prompt" --models=deepseek,sonnet,opus
```

### Usage

```bash
axon usage          # Last 7 days
axon usage -d 30    # Last 30 days
```

## Model Routing

Axon automatically selects the optimal model based on:

| Task Type | Detected By | Default Model |
|-----------|------------|---------------|
| Code writing | "write", "create", "implement" | DeepSeek V3 |
| Debugging | "fix", "bug", "error" | DeepSeek V3 |
| Refactoring | "refactor", "improve" | DeepSeek V3 |
| Explanation | "explain", "why" | Sonnet 4 |
| Complex tasks | Long context, multi-file | Opus 4 (fallback) |

## Cost Comparison

| Model | Input ($/1M) | Output ($/1M) | Quality |
|-------|-------------|---------------|---------|
| DeepSeek V3 | $0.27 | $1.10 | ★★★★☆ |
| Qwen 2.5 Coder | $0.40 | $1.20 | ★★★★☆ |
| Claude Sonnet 4 | $3.00 | $15.00 | ★★★★★ |
| Claude Opus 4 | $15.00 | $75.00 | ★★★★★ |

Using DeepSeek instead of Opus can save **50-98%** on most coding tasks.

## Configuration

Config is stored in `~/.config/axon-cli/config.json`

```json
{
  "defaultModel": "auto",
  "autoContext": true,
  "maxContextTokens": 100000,
  "providers": {
    "deepseek": "sk-xxx",
    "anthropic": "sk-xxx"
  }
}
```

## Development

```bash
# Clone and install
git clone https://github.com/yourname/axon-cli
cd axon-cli
npm install

# Build
npm run build

# Run locally
node dist/cli/index.js "test prompt"

# Watch mode
npm run dev
```

## Roadmap

- [ ] Agents and sub-agents orchestration
- [ ] Prompt caching
- [ ] Context compression
- [ ] Team dashboard
- [ ] VS Code extension
- [ ] Local model support (Ollama)

## License

MIT
