# Spec: Test suite for journeys.logos.co

## Objective

Give the codebase a fast, zero-dependency regression safety net for the parts that broke during the flat-lifecycle refactor: issue-body parsing, status computation, and label reconciliation. Prevent regressions like the #31 bug (downstream phases ignored when upstream R&D fields are empty) from shipping silently.

Out of scope: rendering/DOM, GitHub API *network* behavior. Tests consume the *shape* of GitHub API responses (issue bodies, PR refs), never the network itself.

## Tech Stack

- Node.js ≥ 20 — built-in `node:test` + `node:assert/strict`
- Zero test dependencies (no Jest, Vitest, Mocha)
- GitHub Actions for CI
- A minimal `package.json` at the repo root to host the `test` script and declare `"type": "module"`

## Commands

```
Install deps:  (none — repo is dep-free)
Run tests:     npm test
Raw runner:    node --test tests/**/*.test.mjs
Single file:   node --test tests/markdown.test.mjs
```

## Project Structure

```
package.json                  — { "type": "module", "scripts": { "test": "..." } }
.github/workflows/test.yml    — runs `npm test` on push + PR
tests/
  SPEC.md                     — this file
  markdown.test.mjs           — extractRnD / extractDocPacket / extractDocumentation /
                                extractRedTeam / extractBlockingTeam / extractExternalBlockedLabels
  status.test.mjs             — computeStatus phase transitions + computeDesiredLabels
  sync-labels.test.mjs        — reconciliation logic (add/remove/migrate), no network
  fixtures/
    issue-31.md               — real body of #31 (captured)
    issue-7.md                — doc packet only, no PR (captured)
    issue-47.md               — doc packet only (captured)
```

## Code Style

```js
// tests/status.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStatus } from '../js/markdown.js';

test('doc PR open → doc-ready-for-review', () => {
  const result = computeStatus({
    rnd: { team: 'core', milestones: ['https://roadmap.logos.co/x/y'], date: '15Jan26' },
    docPacketLink: 'https://github.com/logos-co/logos-docs/issues/1',
    docsPr: 'https://github.com/logos-co/logos-docs/pull/3',
    docsPrRef: { state: 'open' },
  });
  assert.equal(result, 'doc-ready-for-review');
});
```

- Flat `test(name, fn)` — no `describe`, no nesting.
- Test names describe the *transition* or *rule*, not the function.
- Fixture bodies over ~10 lines live in `tests/fixtures/*.md`; inline otherwise.
- No helper abstraction until it's duplicated 3+ times.
- Regression tests start with `regression #<num>:` and cite the GitHub issue.

## Testing Strategy

- **Unit tests** for every exported function in `markdown.js`.
- **Unit tests** for the pure-logic parts of `syncStatusLabels` — the add/remove/migrate decision. Network side-effects (`addLabels`/`removeLabel`) are dependency-injected so tests can record calls without hitting GitHub.
- **Regression tests** keyed to specific bugs. Each cites the issue number in the test name.
- **Fixture-based tests** pull real-world bodies from `tests/fixtures/*.md`, captured from GitHub via `gh issue view <n> --json body`.
- Full suite runs in < 5 s locally.
- No coverage threshold — we track it informally and add cases when regressions hit.

## Boundaries

- **Always:** every bug fix ships with a regression test in the same PR.
- **Always:** `npm test` passes before committing.
- **Always:** capture real bodies as fixtures rather than hand-writing approximations.
- **Ask first:** adding any test dependency (even dev-only).
- **Ask first:** mocking DOM or network — prefer extracting the logic into a pure helper.
- **Never:** call the GitHub API from tests.
- **Never:** skip failing tests to unblock a merge. Fix the code or delete the test.
- **Never:** test rendered HTML strings — test the state that produces them.

## Success Criteria

- [ ] `npm test` exits 0 on main.
- [ ] Every export of `js/markdown.js` has ≥ 1 test.
- [ ] `syncStatusLabels`' pure-logic core (add/remove/migrate decision) is covered.
- [ ] A regression test for #31 exists and fails against the pre-fix `computeStatus` (i.e. it locks the reorder).
- [ ] `tests/fixtures/` holds at least three real captured bodies.
- [ ] Full run completes in < 5 s locally.
- [ ] `.github/workflows/test.yml` runs on every push + PR; a red test blocks merge.
- [ ] README has a "Run tests" line pointing at `npm test`.

## Open (resolved)

1. `package.json`: **yes**, minimal — `type: module` + `test` script.
2. Scope: **parsers + status + sync-labels reconciliation**.
3. CI: **yes** — GitHub Actions now.
4. Fixtures: **real captures** from `gh issue view --json body`.
5. Network: **never call** from tests — consume the *shape* of API responses (bodies, `{state: 'open'}` PR refs).
