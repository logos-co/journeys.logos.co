# Logos Journeys

Website to track priorities of journeys for Logos Eco Dev, on Logos R&D.

Pre-configured for [logos-co / project 12](https://github.com/orgs/logos-co/projects/12/views/1?layout_template=board).

## Usage

For Logos R&D Leads.

1. Go to https://journeys.logos.co or [run locally](#run-locally).
2. Follow instructions to enter GitHub PAT Token.
3. **Filter by team**: Click on your team in the "Team:" line.
4. **Filter by who's blocking**: use the "Blocked by" filter bar at the top to show only journeys your team is currently blocking (e.g. `R&D` for all rnd teams, or a specific team like `zones`).
5. **Expand a journey**: click any row to open the detail panel. It shows the R&D inputs, doc packet link, documentation tracking issue + PR, and red team tracking issue.
6. **Enable editing**: click the **Edit** button in the header. Once active, the button shows **Editing** in coral.
7. **Fill in missing information**: with editing enabled, each section shows an input field. Paste the relevant URL or value and press Enter (or click ✓) to save directly to the GitHub issue.
8. **Sync labels**: if the ⚠ "Fix Labels" button appears, click it to reconcile the `status:*` / `blocked-by:*` labels with the issue body.

> **Settings** (gear icon): change the owner, project number, or token at any time.

### Missing information for R&D Logos Lead

See [How a journey progresses](#how-a-journey-progresses) to understand the full flow.
As a first step, Logos R&D Leads need to:

1. Verify their journeys are correct, with the right target release.
2. Ensure there are no missing journeys. Click "+ New Journey" to add one in **Editing** mode.
3. Expand a journey (start from the top).
   1. If the software is already delivered, jump to "Doc Packet" and fill in the GitHub issue template.
   2. For software yet to be done, start with the "R&D" section — enter a link to the milestone, then fill in the estimated date once known.

## How a journey progresses

Each journey has a single `status:<phase>` label and one or more `blocked-by:<team>` labels — both auto-managed by the app based on what's in the issue body. The whole lifecycle is one linear sequence:

| `status:*`                      | Next step (who does it)                                                                     | Blocked by                  |
|---------------------------------|---------------------------------------------------------------------------------------------|-----------------------------|
| `status:confirm-roadmap`        | **R&D lead**: set `- team:` and a `- milestone:` URL in the issue body                      | `blocked-by:rnd` (or team)  |
| `status:confirm-date`           | **R&D lead**: add the estimated delivery `- date:` (DDMmmYY)                                | `blocked-by:rnd-<team>`     |
| `status:rnd-in-progress`        | **R&D**: deliver the roadmap milestones (auto-advances when all are ticked in [roadmap.logos.co](https://roadmap.logos.co)) | `blocked-by:rnd-<team>`     |
| `status:rnd-overdue`            | **R&D**: deliver the milestones — target date has passed, update the date or close them    | `blocked-by:rnd-<team>`     |
| `status:waiting-for-doc-packet` | **R&D**: open a [doc packet issue](https://github.com/logos-co/logos-docs/issues/new?template=doc-packet.yml), fill it in, paste its URL into `## Doc Packet - link:` | `blocked-by:rnd-<team>` |
| `status:doc-packet-delivered`   | **Docs**: open a tracking issue (paste into `## Documentation - tracking:`), write the doc, and once the doc PR is ready for review paste its URL into `## Documentation - pr:` | `blocked-by:docs`           |
| `status:doc-ready-for-review`   | **R&D and Red Team**: review the doc PR. **Docs**: merge the PR once both have approved     | `blocked-by:red-team` + `blocked-by:rnd-<team>` |
| `status:doc-merged`             | **Red Team**: finish dogfooding, close `## Red Team - tracking:` when done                  | `blocked-by:red-team`       |
| `status:completed`              | Nothing — journey is done                                                                   | —                           |

The doc PR URL (`## Documentation - pr:`) is added **manually by the docs team** as an explicit "ready for review" signal — there is no auto-discovery.

R&D team granularity: `<team>` is one of `anon-comms`, `messaging`, `core`, `storage`, `blockchain`, `zones`, `smart-contract`, `devkit`.

### The hand-offs

1. **R&D** fills in their team, a roadmap milestone link, and an estimated date. When all milestones are closed (checked against the `logos-co/roadmap` repo), the phase auto-advances to `waiting-for-doc-packet`. R&D then [opens an issue using the doc packet template](https://github.com/logos-co/logos-docs/issues/new?template=doc-packet.yml), fills it in (including appointing a Subject-Matter Expert from their team), and pastes the issue URL into the `- link:` field of the `## Doc Packet` section. That flip (`status:doc-packet-delivered`) hands off to Docs.
2. **Docs** opens a tracking issue in `logos-co/logos-docs` (pasted into `## Documentation - tracking:`) and begins writing. When the doc PR is ready for review, Docs **manually** pastes the PR URL into `## Documentation - pr:` — this is an explicit "ready for review" signal (no auto-discovery), which advances the journey to `doc-ready-for-review`. Red Team and the R&D SME review on that PR; once approved, Docs merges it → `doc-merged`.
3. **Red Team** dogfoods the journey and reviews the doc PR simultaneously. Their tracking issue lives in `## Red Team - tracking:`. Closing that issue completes the journey → `status:completed`. If no red team tracking is provided, the journey is considered complete once the doc PR is merged.

External blockers (`blocked-by:legal`, `blocked-by:security`, etc.) can be added manually in the detail panel; they coexist with the lifecycle `blocked-by:*` labels and don't affect the auto-managed flow.

The app keeps these labels in sync automatically. A ⚠ "Fix Labels" button in the header appears when any issue's labels drift from the computed state; clicking it reconciles everything in one pass (also migrates legacy `action:*` and `blocked:<team>` labels).

## Run locally

```sh
npx serve .
```

Then open http://localhost:3000.

> The app uses ES modules and must be served over HTTP; opening `index.html` directly as a `file://` URL will not work.

## Run tests

```sh
npm test
```

Uses the built-in `node:test` runner — no dependencies. Covers issue-body parsing, lifecycle status computation, and label reconciliation. CI runs the same command on every push and PR.

## Licence

Licensed under either of [MIT](LICENSE-MIT) or [Apache 2.0](LICENSE-APACHE) at your option.

## Deploy

Pushes to `main`/`master` auto-deploy via GitHub Actions → GitHub Pages.

Enable Pages in the repo settings under **Settings → Pages → Source: GitHub Actions** before the first deploy.
