# Eco Dev Priorities

Website to track priorities of journeys for Logos Eco Dev, on Logos R&D.

Pre-configured for [logos-co / project 12](https://github.com/orgs/logos-co/projects/12/views/1?layout_template=board).

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
- **Read+write token**: `public_repo` + `read:project` scopes. Enables drag-to-reorder, label edits, and adding dependencies.

### Dependency format

Add a `## Dependencies` section to an epic issue body:

```markdown
## Dependencies
- dogfooding: https://github.com/logos-co/ecosystem/issues/42
- docs: TODO
- lez: https://github.com/logos-blockchain/logos-execution-zone/issues/45
```

- `TODO` = team is a dependency but no tracking issue linked yet
- A URL = issue state is fetched; open → pending, closed → done

## Licence

Licensed under either of [MIT](LICENSE-MIT) or [Apache 2.0](LICENSE-APACHE) at your option.

## Deploy

Pushes to `main`/`master` auto-deploy via GitHub Actions → GitHub Pages.

Enable Pages in the repo settings under **Settings → Pages → Source: GitHub Actions** before the first deploy.
