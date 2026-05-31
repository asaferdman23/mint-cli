> **🚧 DRAFT — planned (Wave 2). Not ready to execute.**
> Full spec + tasks land when prioritized. Order in ROADMAP.

## Why

MCP (Model Context Protocol) is becoming table stakes in 2026 — Claude Code,
Cursor, and Cline all support it. Without MCP, Mint is not in the conversation
for any user who needs to wire in GitHub, Linear, Slack, internal tools, or
any of the hundreds of community MCP servers. This is the single biggest
"floor gap" blocking serious adoption.

This change adds both sides:
- **MCP client**: Mint consumes external MCP servers as additional tool sources.
- **MCP server**: Mint exposes its own surface (`audit`, `trace`, `tune`,
  `bench`, file ops with our safety gates) as an MCP server so other agents
  can use Mint as a tool.

## What Changes

- Wire `@modelcontextprotocol/sdk` (or equivalent) into the provider/tools host
  layer.
- New config block `mcp.servers: Array<{name, command, args, env}>` for
  external MCP servers to spawn at session start.
- New CLI `mint mcp serve` to run Mint-as-MCP-server.
- Tools surfaced from MCP servers SHALL go through the same approval gates as
  built-in tools.
- Cost of MCP tool calls SHALL be tracked in audit if the server reports usage.

## Capabilities

### New Capabilities
- `mcp-integration`: MCP client + server surface; tool registration; approval
  gating for external tools.

## Impact

- Affected: `src/brain/tools-host.ts`, `src/cli/index.ts`, new `src/mcp/`
  module, `src/utils/config.ts`.
- Risk: external MCP servers can execute arbitrary code — approval gates must
  apply to every external tool call by default; per-server allow-lists.

## Dependencies / order

- Should land after `multi-axis-token-efficiency` and `agent-memory-efficiency`
  (Wave 1) so the audit + memory observability covers MCP tool calls too.
