# Lupine Constellation

Lupine is a connected open-science system for making materials prediction
inspectable: public claims, public evidence, public instruments, and public
research machinery.

## This Repo

**Lupi** is the browser-native molecular viewer at `https://lupi.live`.

It owns molecule inspection, trajectories, visual controls, saved views,
exports, Firebase viewer support, and agent-driven viewer workflows.

The normative product boundary is the
[Lupi product ownership contract](docs/product-ownership-contract.md). It wins
when an older roadmap, campaign plan, branch, or overview conflicts with it.

## Sibling Repos

- **Lupine Science**: `https://github.com/alexwelcing/lupine-science`
  - Public front door.
  - Site: `https://lupine.science`
- **Lupine Ledger**: `https://github.com/alexwelcing/lupine-ledger`
  - Public evidence record and Library reader.
  - Site: `https://library.lupine.site`
- **Lupine Rhizo**: `https://github.com/alexwelcing/lupine-rhizo`
  - Deep science workbench and source of exported evidence/viewer contracts.

## Contract

Lupi should be beautiful to clone on its own. It may consume public molecule,
evidence, search, or MCP contracts from Rhizo, but it should not require the
science workbench to build or run. It presents versioned external research
results and provenance; it does not execute research or decide scientific
claims.

Historical development lives in `https://github.com/alexwelcing/lupine` during
the transition.
