<!--
正本: AGENTS.md の ADR・テンプレート・テスト適用性
-->

# ADR

```yaml
id: ADR-0008
status: proposed
title: npm package asset allowlist
tags: [npm, packaging, distribution]
supersedes: []
superseded-by: null
deprecated-reason: null
```

## Context

The npm package must contain the assets that init and upgrade copy into consumer projects, but it must not expose this repository's runtime history, self-extension policy, or installed-version state. A broad directory-level entry cannot express that boundary safely because both deployable and repository-local data share the `.agent-skill-chain/` namespace.

## Decision

Define the npm package contents with an explicit allowlist. Include the deployable `standards`, `templates`, `schemas`, `config`, `adapters`, `scripts`, `ci`, and `hooks` namespaces plus the existing root-level package assets. Exclude `runtime`, `project`, and `.installed_version` by omitting them from the allowlist. Maintain an integration test that asserts both the exclusions and representative files from every deployable namespace.

## Consequences

- The published package no longer distributes repository-local operational data.
- Adding a new deployable namespace requires an intentional update to both the allowlist and the package-files test.
- Existing consumer-facing asset paths remain unchanged.

## Validation

- `npm pack --dry-run --json` contains no runtime, project, or installed-version paths.
- The package-files integration test confirms every deployable namespace and existing non-distribution boundaries.

## Unresolved questions

None.

## Out of scope

Changing npm publishing credentials, package versioning, or consumer installation behavior.
