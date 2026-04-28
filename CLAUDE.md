# journeys

Static SPA that displays a prioritized pipeline of Logos ecosystem journeys, sourced from GitHub Projects v2.

## Tech Stack

- Plain HTML + ES modules (no bundler, no framework)
- Tailwind CSS via CDN
- marked.js for markdown rendering
- GitHub Projects v2 GraphQL API + REST API

## Project Structure

```
index.html          — Single-page app entry point
js/
  api.js            — GitHub GraphQL/REST API calls (project items, issues, labels)
  app.js            — App initialization, config UI, state management
  config.js         — localStorage-based config (owner, project number, PAT)
  detail.js         — Detail panel for individual journeys
  drag.js           — Drag-and-drop reordering
  markdown.js       — Markdown rendering + dependency/doc parsing
  pipeline.js       — Main pipeline table rendering
  teams.js          — Repo-to-team display name mapping
css/                — Stylesheets
```

## Data Model

Journeys are GitHub issues in the connected project board. Each issue has:

- **Labels** for journey type: `gui user`, `developer`, `node operator`
- **Labels** for target release: `testnet v0.1`, `testnet v0.2`, etc. (regex: `/^testnet\b/i`)
- **Labels** for lifecycle status: exactly one `status:<phase>` per journey — auto-managed by the app
- **Labels** for who is blocking progress: one or more `blocked-by:<team>` labels — auto-managed when derived from the lifecycle, manually added for external blockers
- **Issue body** with structured sections:
  - `## R&D` — fields: `- team: <name>`, `- milestone: <url>` (multiple lines allowed, one per milestone), `- date: <DDMmmYY>`
  - `## Doc Packet` — field: `- link: <url>` pointing to a logos-docs issue created from the [doc packet template](https://github.com/logos-co/logos-docs/issues/new?template=doc-packet.yml); presence of the link = delivered.
  - `## Documentation` — fields:
    - `- tracking: <url>` — a `logos-co/logos-docs` issue used to track documentation progress
    - `- pr: <url>` — the doc PR, **manually added by the docs team** as an explicit "ready for review" signal. No auto-discovery.
  - `## Red Team` — field: `- tracking: <url>` pointing to red team tracking issue

### Flat Lifecycle State Machine

One `status:<phase>` label per journey, one or more `blocked-by:<team>` labels. Both auto-managed by the app.

| `status:*` label               | Next step (who does it) — and the body change that advances the phase                      | Auto-derived `blocked-by:*`     |
|-------------------------------|---------------------------------------------------------------------------------------------|---------------------------------|
| `status:confirm-roadmap`       | **R&D lead**: set `- team:` and a `- milestone:` URL in the issue body                      | `blocked-by:rnd` (or rnd-<team>)|
| `status:confirm-date`          | **R&D lead**: add `- date:` (DDMmmYY)                                                       | `blocked-by:rnd-<team>`         |
| `status:rnd-in-progress`       | **R&D**: deliver the roadmap milestones (auto-advances when all are ticked in [roadmap.logos.co](https://roadmap.logos.co) — source is `logos-co/roadmap`) | `blocked-by:rnd-<team>` |
| `status:rnd-overdue`           | **R&D**: deliver the milestones — target date passed; update the date or close them         | `blocked-by:rnd-<team>`         |
| `status:waiting-for-doc-packet`| **R&D**: file a doc packet issue, paste URL into `## Doc Packet - link:`                    | `blocked-by:rnd-<team>`         |
| `status:doc-packet-delivered`  | **Docs**: open tracking issue (`## Documentation - tracking:`), write the doc, and when the doc PR is ready for review paste its URL into `## Documentation - pr:` | `blocked-by:docs`               |
| `status:doc-ready-for-review`  | **R&D and Red Team**: review the doc PR. **Docs**: merge the PR once both have approved     | `blocked-by:red-team` + `blocked-by:rnd-<team>` |
| `status:doc-merged`            | **Red Team**: finish dogfooding, close `## Red Team - tracking:` when done                  | `blocked-by:red-team`           |
| `status:completed`             | Nothing — journey is done                                                                   | —                               |

**Precedence rule:** when the `## Documentation - pr:` field is set, the status advances to `doc-ready-for-review` / `doc-merged` / `completed` *regardless* of the R&D body fields. Upstream R&D checks only gate the pre-doc-packet phases. (Regression #31.)

R&D granularity: `<team>` ∈ `anon-comms`, `messaging`, `core`, `storage`, `blockchain`, `zones`, `smart-contract`, `devkit`. If a team is not yet assigned, the label is `blocked-by:rnd`.

Milestone completion is fetched at runtime from the `logos-co/roadmap` repo via the GitHub Contents API; overdue detection uses the `- date:` field parsed as `DDMmmYY`.

Label drift (e.g. after body edits) is detected in-app; click **Fix Labels** in the header to reconcile. Legacy `action:*` and `blocked:<team>` labels are automatically removed/migrated during reconciliation.

## GitHub Repos

- `logos-co/journeys.logos.co` — Journey issues live here
- `logos-co/logos-docs` — Documentation, linked from `## Documentation` section
- `logos-blockchain/logos-execution-zone` — LEZ team issues
- `logos-co/ecosystem` — Red team tracking issues (historical; may move)

## Creating Journey Issues

To create a new journey via `gh`:

```bash
gh issue create --repo logos-co/journeys.logos.co \
  --title "Journey title" \
  --label "developer" \
  --label "testnet v0.1" \
  --label "status:confirm-roadmap" \
  --label "blocked-by:rnd-zones" \
  --body '## R&D
- team: zones
- milestone:
- date:

## Doc Packet
- link:

## Documentation
- tracking:
- pr:

## Red Team
- tracking:'
```

R&D team options: `anon-comms`, `messaging`, `core`, `storage`, `blockchain`, `zones`, `smart-contract`, `devkit`.
Always include a target testnet label and a journey type label. Request clarification if missing.
After creating, add the issue to the "Logos Journeys" project board (project #12, owner `logos-co`) so it appears in the app. This step is mandatory, always run it:

```bash
gh project item-add 12 --owner logos-co --url <issue-url>
```

Journey type label colors: gui user=`D94F45`, developer=`3B7CB8`, node operator=`C4912C`.

## Knowledge Graph

A graphify knowledge graph of this project lives in `graphify-out/` (gitignored). Use it to navigate the codebase before making non-trivial changes:

- `graph.html` — interactive view (open in any browser, no server needed)
- `graph.json` — raw data for `/graphify query "..."`, `/graphify path "A" "B"`, `/graphify explain "X"`
- `GRAPH_REPORT.md` — god nodes, surprising connections, suggested questions

Rebuild after architectural changes with `/graphify .` (or `/graphify . --update` for an incremental refresh).

## Branding

Sandy/parchment light theme. Forest `#0E2618` text, warmgray `#DDDED8` body bg, coral `#E46962` accent, teal `#0C2B2D` header. Lambda (λ) brand mark.
