# Logos Journeys

Website to track priorities of journeys for Logos Eco Dev, on Logos R&D.

Pre-configured for [logos-co / project 12](https://github.com/orgs/logos-co/projects/12/views/1?layout_template=board).

## How a journey progresses

Each journey moves through three sequential stakeholder stages:

```
R&D  ──────────────────────────────────────────►  Docs  ──────────────►  Red Team
to-be-confirmed → confirmed → in-progress           waiting               waiting
                                    │               in-progress           in-progress
                                    ▼               ready-for-review ──►  done
                             doc-packet-delivered   merged
```

1. **R&D** fills in their team, a roadmap milestone link, and an estimated date. Once the software is delivered they paste the [doc packet template](https://github.com/logos-co/logos-docs/blob/main/docs/_shared/templates/doc-packet-testnet-v01.md) into the `## Doc Packet` section of the issue — this signals hand-off to Docs.
2. **Docs** opens a tracking issue in logos-docs, writes the content, raises a PR, and merges it.
3. **Red Team** dogfoods the journey and closes their tracking issue when done.

The app tracks these states automatically by reading the issue body and checking GitHub issue/PR states. The `action:rnd`, `action:docs`, and `action:red-team` labels are kept in sync automatically — they tell each team at a glance when it's their turn. A ⚠ badge on a row means the labels are stale and will be corrected the next time the issue is opened in write mode.

## Run locally

```sh
npx serve .
```

Then open http://localhost:3000.

> The app uses ES modules and must be served over HTTP — opening `index.html` directly as a `file://` URL will not work.

## Usage

- **View**: opens read-only against the default project (`logos-co` / `#12`) — no auth needed.
- **Settings** (gear icon): change owner, project number, or add tokens.
- **Read-only token**: `read:project` scope. Authenticated reads, higher rate limit.
- **Read+write token**: `public_repo` + `read:project` scopes. Enables drag-to-reorder, inline editing, and label auto-sync.

## Licence

Licensed under either of [MIT](LICENSE-MIT) or [Apache 2.0](LICENSE-APACHE) at your option.

## Deploy

Pushes to `main`/`master` auto-deploy via GitHub Actions → GitHub Pages.

Enable Pages in the repo settings under **Settings → Pages → Source: GitHub Actions** before the first deploy.
