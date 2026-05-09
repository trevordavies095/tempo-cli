# ADR 0001: Use TypeScript on Node for the CLI

**Status:** Accepted  
**Date:** 2026-05-09

## Context

The product brief allows Rust, Go, or TypeScript/Node for the CLI. Each option trades off distribution shape (single static binary vs runtime install), contributor familiarity, and fit with JSON-heavy, agent-oriented output.

## Decision

Implement the Tempo CLI in **TypeScript** on **Node.js**, compiled to ESM under `dist/`, exposed as the `tempo` executable via the `bin` field in `package.json`.

## Consequences

- **Positive:** Fast iteration, strong typing, straightforward use of the vendored OpenAPI JSON and test tooling common in Node CI, and alignment with machine-readable JSON output as a first-class concern.
- **Negative:** End users need a Node runtime for development and for installs that rely on the published package; a single-file native binary is not the default artifact (packaging and distribution can be revisited later).
- **Neutral:** The choice is recorded here so future contributors do not re-litigate language without a new ADR.
