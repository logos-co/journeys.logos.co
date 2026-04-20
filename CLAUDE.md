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
- **Labels** for blocked status: `blocked:teamname` (regex: `/^blocked:/i`)
- **Labels** for action required: `action:rnd`, `action:docs`, `action:red-team` — auto-managed by the app
- **Issue body** with structured sections (3-stakeholder workflow):
  - `## R&D` — fields: `- team: <name>`, `- milestone: <url>` (multiple lines allowed, one per milestone), `- date: <DDMmmYY>`
  - `## Doc Packet` — field: `- link: <url>` pointing to a logos-docs issue created from the [doc packet template](https://github.com/logos-co/logos-docs/issues/new?template=doc-packet.yml); presence of the link = delivered.
  - `## Documentation` — fields (rendered in this order):
    - `- tracking: <url>` — a `logos-co/logos-docs` issue used to track documentation progress; the app uses it to auto-suggest a doc PR via GitHub's `closedByPullRequestsReferences`
    - `- pr: <url>` — the doc PR; takes precedence over `link` for state. Open PR → `in-progress`; merged PR → `merged`. Auto-suggested from tracking and confirmable in the panel.
    - `- link: <url>` — the final doc URL (live doc page); used as a fallback driver for state when `pr` is empty
  - `## Red Team` — field: `- tracking: <url>` pointing to red team tracking issue

### 3-Stakeholder State Machine

```
R&D: to-be-confirmed → confirmed → in-progress → pending-doc-packet → doc-packet-delivered
Docs: waiting → in-progress → merged
Red Team: waiting → in-progress → done
```

`pending-doc-packet` is reached when all roadmap milestones are marked done (checked in `logos-co/roadmap` repo) but no doc packet link has been provided yet. Milestone completion is fetched at runtime from the roadmap repo via GitHub Contents API.

Action label rules (auto-computed):
- `action:rnd` when R&D ≠ doc-packet-delivered
- `action:docs` when R&D = doc-packet-delivered AND docs ≠ merged
- `action:red-team` when docs = in-progress AND red team ≠ done

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
  --label "action:rnd" \
  --body '## R&D
- team: zones
- milestone:
- date:

## Doc Packet
- link:

## Documentation
- tracking:
- pr:
- link:

## Red Team
- tracking:'
```

R&D team options: `anon-comms`, `messaging`, `core`, `storage`, `blockchain`, `zones`, `smart-contract`, `devkit`.
Always include a target testnet label and a journey type label. Request clarification if missing.
After creating, add the issue to the GitHub Project board for it to appear in the app.

Journey type label colors: gui user=`D94F45`, developer=`3B7CB8`, node operator=`C4912C`.

## Migration

All issues have been migrated from the old `## Dependencies` format to the 3-stakeholder format. The migration script is at `scripts/migrate-issues.sh` and is idempotent (skips already-migrated issues). The old `deps-*` labels have been deleted from the repo.

## Branding

Sandy/parchment light theme. Forest `#0E2618` text, warmgray `#DDDED8` body bg, coral `#E46962` accent, teal `#0C2B2D` header. Lambda (λ) brand mark.
