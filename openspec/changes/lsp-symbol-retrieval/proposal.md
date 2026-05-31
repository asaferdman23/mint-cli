> **🚧 DRAFT — planned (Wave 3). Not ready to execute.**
> Full spec + tasks land when prioritized. Order in ROADMAP.

## Why

Cursor uses LSP for symbol-aware retrieval. We use BM25 + embeddings, which
beats nothing on typed languages (TS, Rust, Go) where the type graph carries
huge signal: "find every caller of foo", "follow the import graph from
src/auth/", "show me the implementation behind this interface."

Adding LSP integration changes retrieval precision dramatically on typed
projects. It's not a wedge over Cursor here — it's catching up to floor on
typed-language UX.

## What Changes

- Spawn the project's LSP server (TS: tsserver via typescript-language-server,
  Rust: rust-analyzer, Go: gopls) at session init.
- Add LSP-backed retrieval functions: `findReferences`, `findDefinition`,
  `getCallHierarchy`, `getDocumentSymbols`.
- Hybrid retriever gains a `symbol` source alongside `bm25`, `embedding`,
  `graph`, `pinned`.
- `mint trace` shows which retrieval source each file came from for debugging.
- Falls back gracefully on languages without LSP support.

## Capabilities

### New Capabilities
- `symbol-retrieval`: LSP server management, symbol-graph queries, hybrid
  retrieval scoring with symbol signal.

## Impact

- Affected: `src/brain/memory/retriever.ts`, new `src/brain/lsp/` module.
- Risk: LSP servers are heavy (tsserver ~200MB RAM, slow cold start) —
  lazy-spawn on first symbol query, not at session init; user opt-out.

## Dependencies / order

- Should land after `multi-axis-token-efficiency` (the audit needs to report
  retrieval-source breakdown to prove the LSP win).
