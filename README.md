# Eco Dev Priorities

Website to track priorities of journeys for Logos Eco Dev, on Logos R&D.

Pre-configured for [logos-co / project 12](https://github.com/orgs/logos-co/projects/12/views/1?layout_template=board).

## Run locally

```sh
npx serve .
```

Or with Python:

```sh
python3 -m http.server 8080
```

Then open http://localhost:8080 (or http://localhost:3000 with `npx serve`).

> The app uses ES modules, so it must be served over HTTP — opening `index.html` directly as a `file://` URL will not work.

## Usage

- **View**: opens read-only against the default project (`logos-co` / `#12`) — no auth needed.
- **Settings** (gear icon): change owner, project number, or add a PAT.
- **PAT**: optional. Required only for drag-to-reorder and label mutations. Needs `public_repo` scope. Stored in `localStorage` only.

## Deploy

Pushes to `main`/`master` auto-deploy via GitHub Actions → GitHub Pages.

Enable Pages in the repo settings under **Settings → Pages → Source: GitHub Actions** before the first deploy.
