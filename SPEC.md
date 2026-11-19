# SPEC — journeys.logos.co

Behavior specification of the SPA, organised by user-facing feature, for QA test coverage.
Source of truth for *what the app does*; the *how* lives in `js/` and `CLAUDE.md`. Each
section describes observable behavior — inputs, outputs, side effects, edge cases — without
prescribing test cases.

Feature-specific specs live alongside this file (e.g. the release filter retrospective in
Part II below, and `specs/drag-handle-fix.md`).

---

## Part I — Behavior reference

### A. Configuration and authentication

The app reads three settings from `localStorage` under the `ppd_*` prefix: `ppd_owner`,
`ppd_project_number`, `ppd_pat`. Owner and project number default to `logos-co` / `12`
when unset.

- **Settings modal** opens from the gear icon. It populates inputs from current config,
  validates that owner is non-empty and project number is a parseable integer, then
  persists trimmed values and triggers a project reload.
- **Clear** wipes all three keys, hides the project view, and shows the empty state.
- **PAT visibility toggle** flips the input type between `password` and `text`.
- **Escape key** closes the modal.
- **Legacy migration** (one-shot per `getConfig` call): if `ppd_pat_write` or
  `ppd_pat_read` is present and `ppd_pat` is not, copy the first non-empty into
  `ppd_pat` and delete the old keys.
- **Admin mode** is in-memory only. It defaults to `false` on every page load and toggles
  via the Edit button. `hasWritePAT()` returns true only when both a PAT is stored and
  admin mode is active. All write paths (drag, label sync, inline edits, new-journey
  creation) gate on `hasWritePAT()`. Read paths use the stored PAT whenever present.

QA cares: PAT never leaves the browser; admin mode never persists across reloads;
clearing config returns the app to the empty state without a reload.

### B. Project load and error states

`loadProject()` fetches the configured project. On first call it sets a loading state
(spinner + "Loading project…"), clears the cross-session ref cache, then:

1. Calls `fetchProjectItems(owner, number, pat)`, which tries the GraphQL `user` query
   first; if that returns null it retries with `organization`. If both fail, throws
   `Could not find project #N for owner "X"`.
2. Walks the GraphQL pagination cursor (50 items/page).
3. Filters out non-Issue content (drafts, PRs).
4. Returns `{ projectId, projectTitle, items, isOrg }`.

**Empty state** renders when no owner or project number is configured: lambda mark,
"Configure your project" CTA opening the settings modal, three feature cards
(inline editing, drag, team tracking).

**Loading state** renders a spinning ring + "Fetching items from GitHub Projects v2".

**Error state** renders one of two flavors based on the message:
- *PAT flow* (when there is no PAT, or the error matches `rate.limit|unauthorized|forbidden|bad.credential|read:project|requires`):
  three-step card with a GitHub token generation link (scopes `project,public_repo`),
  inline PAT input, and a Save button that persists and reloads.
- *Generic*: error message, Retry button (re-runs `loadProject`), and a Check Settings
  link.

The refresh button spinner toggles for the duration of the load.

### C. Pipeline view

`renderPipeline()` builds the table inside `#app-content`. Top to bottom:

1. **Header row** with project title, "+ New Journey" button (admin mode only),
   "Expand all" / "Collapse all" toggle, optional instructions banner.
2. **Filter bar** (`#filter-bar`) — see Section D.
3. **Pipeline list** (`#pipeline-list`) — ordered open items, each rendered by
   `renderPipelineRow`.
4. **Closed section** — collapsed by default, items sorted chronologically by `closedAt`.

Each row shows: rank number, journey title, persona type chip, release chip, blocking team
indicator, status badge, blocked-by column, driver chip(s) (see Part III), chevron. Hovering
a row highlights it; clicking toggles its detail panel (Section H).

A green **Docs ↗** link renders next to the title iff the item's `## Documentation -
published:` field is set, linking directly to that URL. No status/label gating — presence of
the field is the sole condition.

**Mismatch detection.** During render, every item is evaluated against `computeStatus` and
`computeDesiredLabels`. Items whose actual labels diverge from desired are tracked in
`_mismatchedItems` and surface via the Fix Labels button in the header. A
`mismatch-count-changed` DOM event fires whenever the set changes.

**Item registry caching.** Per item the renderer caches `_parsed` (section extracts) and
`_parsedBody` so re-renders don't re-parse identical bodies. The cache is invalidated when
the body is mutated (label fix, inline edit).

### D. Filter bar

Four single-select rows and one multi-select row, rendered above the pipeline list.

| Row | Type | Source labels |
|---|---|---|
| Persona | single-select | `gui user`, `cli user`, `developer`, `node operator` |
| Driver | single-select | `driver:*` labels from the fixed allowlist (see Part III) |
| Team | single-select | derived from `## R&D - team:` body field + repo team mapping |
| Blocked by | single-select | `blocked-by:*` labels present on open items |
| Release | multi-select | labels matching `/^testnet\b/i` |

Behavior shared across all four rows:

- Pills are only emitted for values *present on the current open-item set*. New labels
  appear automatically; absent ones don't render.
- Clicking an inactive pill activates it. Clicking an active pill deactivates it.
- Activating any pill in any row hides non-matching rows from view (via the
  `applyFilter` function — DOM `display:none`, not removed).
- Activating any pill in any row disables drag (`applyDragGating`) on all rows; drag
  re-enables when no pill is active.
- Filter state syncs to the URL as query params (`?persona=`, `?driver=`, `?team=`,
  `?blockedby=`, `?release=slug1,slug2`). Reloading restores state from the URL.
- Unknown URL slugs are silently ignored on restore.
- Cross-row semantics: **AND across rows**. Within the multi-select Release row,
  **OR within row** (a journey matches if any of its testnet labels is selected).

QA cares: state survives reload via URL; non-existent labels never produce empty pills;
drag is always gated by the *any-filter-active* flag, never by individual rows.

### E. Journey rendering — visual encoding

- **Persona color**: `gui user` red, `cli user` teal, `developer` blue, `node operator` amber.
- **Release color**: assigned from a fixed palette keyed by slug. `testnet unscheduled`
  uses a muted grey.
- **Team color** (`teamColor` in `app.js`): deterministic hash of the team name into HSL,
  hue shifted by +30 to skip muddy yellow-green. Two overrides: `red team` → fixed red
  hue, `anon-comms` → fixed blue. Results memoised by `(name, alpha)`.
- **Status badge color**: per-status palette in `pipeline.js` (`STATUS_COLORS`,
  `STATUS_LABELS`). Colors mirror the repo label colors used by `ensureLifecycleLabels`.
- **Issue state badge**: `OPEN` is coral, anything else is grey/closed.

QA cares: a new team name produces a consistent color across page reloads; same color
for the same name in different rows; persona and release color tables match the legend
in any future docs.

### F. Lifecycle status — body parsing and status computation

Defined in `js/markdown.js`. Already covered by `tests/SPEC.md` (parsers + status +
sync-labels reconciliation). Re-stated here for completeness:

- `extractRnD(body)` → `{ team, milestones: string[], date }`. Multiple
  `- milestone:` lines are all captured.
- `extractDocPacket(body)` → URL string or `null`.
- `extractDocumentation(body)` → `{ tracking, pr, published }`. `published` is the live
  `docs.logos.co` page URL, set manually; it is informational only and never feeds
  `computeStatus` or label reconciliation.
- `extractRedTeam(body)` → `{ tracking }`.
- `extractDescription(body)` → text before the first `## R&D`/`## Doc Packet`/
  `## Documentation`/`## Red Team` heading.
- `extractBlockingTeam(labels)` reads the first `blocked-by:*` label, stripping
  the `rnd-` prefix.
- `extractExternalBlockedLabels(labels)` returns `blocked-by:*` labels that are
  NOT in the lifecycle set — these are manual external blockers (e.g.
  `blocked-by:legal`).

`computeStatus(input)` returns exactly one of the nine phases:

```
confirm-roadmap → confirm-date → rnd-in-progress → rnd-overdue
              → waiting-for-doc-packet → doc-packet-delivered
              → doc-ready-for-review → doc-merged → completed
```

Precedence rules (top wins):

1. `issueClosed === true` → `completed`.
2. `docsPr` set + `docsPrRef.state === 'merged'`:
   - red team tracking is an open issue → `doc-merged`
   - otherwise → `completed`
3. `docsPr` set (PR not merged or no ref) → `doc-ready-for-review`.
4. `docPacketLink` set → `doc-packet-delivered`.
5. Missing team or milestones → `confirm-roadmap`.
6. Missing date → `confirm-date`.
7. `allMilestonesDone === true` → `waiting-for-doc-packet`.
8. Date in the past (vs midnight today) → `rnd-overdue`.
9. Default → `rnd-in-progress`.

Regression #31 lock: rules 2–4 must short-circuit before any R&D-field check. A doc PR
URL alone forces the journey downstream regardless of R&D body state.

`parseJourneyDate("DDMmmYY")` accepts case-insensitive month codes; returns `null` on
malformed input. `isOverdue` compares against midnight of the supplied `today`.

`computeDesiredLabels(status, rndTeam)` returns `{ status: 'status:X', blockedBy: [...] }`
where `blockedBy` follows the table in `CLAUDE.md`:

- pre-doc-packet phases → `blocked-by:rnd-<team>` (or bare `blocked-by:rnd` if team is
  missing or not in `RND_TEAMS`)
- `doc-packet-delivered` → `blocked-by:docs`
- `doc-ready-for-review` → `blocked-by:red-team` + `blocked-by:rnd-<team>`
- `doc-merged` → `blocked-by:red-team`
- `completed` → empty

QA cares: precedence holds even with malformed R&D fields; overdue does not trip on a
date that is exactly today; unknown R&D teams fall back to `blocked-by:rnd`.

### G. Label reconciliation (Fix Labels)

Detection happens during render (Section C). The button only appears when (a) there is a
PAT and (b) the mismatch count is > 0. When admin mode is off the button shows the count
but is disabled.

Clicking the button calls `syncStatusLabels(owner, repo, num, currentLabels,
desiredStatus, desiredBlockedBy, pat)` for each mismatched item, sequentially. Each call:

1. **Ensures** every lifecycle label exists in the repo (idempotent, deduped per session).
2. Computes a change plan via `planLabelChanges` (pure):
   - Remove every `status:*` that isn't `desiredStatus`; add `desiredStatus` if missing.
   - Remove lifecycle `blocked-by:*` labels not in `desiredBlockedBy`; add any missing.
   - When `desiredStatus === 'status:completed'`, strip ALL `blocked-by:*` labels —
     including external blockers (`blocked-by:legal`, etc.). For other statuses,
     non-lifecycle `blocked-by:*` labels are preserved.
   - Remove every `action:*` label (legacy cleanup).
   - Migrate `blocked:<team>` → `blocked-by:<team>` (legacy cleanup): add the new label
     (creating it in the repo with neutral grey if missing) and remove the old.
3. Applies the plan via `addLabels` + `removeLabel` REST calls (errors on individual
   removes are swallowed).
4. After all items are processed, re-fetches each affected issue to pull canonical state
   (label colors, concurrent body edits), invalidates `_parsed`/`_parsedBody`/`_refCache`,
   and re-renders the pipeline.
5. Shows a success toast (`Fixed labels on N issue(s)`) or warning toast if any failed.

`computeLifecycleMismatch(actualLabels, desired)` is the pure mirror of the detector:
returns `true` when reconciliation is needed for any of the same reasons.

QA cares: external `blocked-by:legal` survives a normal fix but is stripped on completion;
fixing N items only triggers `ensureLifecycleLabels` once per repo per session; failures
on one item never block others.

### H. Detail panel (per-row drill-down)

Click any pipeline row to toggle. Open state is tracked in a module-level `Set` so the
panel can be re-opened across re-renders (e.g. after admin toggle or label fix).

Shell renders synchronously: title, assignees, GitHub link, blocked-by banner, four
stakeholder section cards (R&D, Doc Packet, Documentation, Red Team). Status badges
inside each section start as "Loading…" and resolve asynchronously via `fetchRefsBatch`.

**Per-section content**

- **R&D**: team dropdown (admin-mode editable to one of `RND_TEAMS`), milestone URL
  list with per-row remove and "+ add milestone" affordances, date input
  (`DDMmmYY` validation matches `parseJourneyDate`). Save buttons commit via
  `setRnDField` / `setRnDMilestones` + `updateIssueBody`.
- **Doc Packet**: single URL input (`setDocPacketLink`). A warning badge surfaces if the
  doc packet is delivered (`status >= doc-packet-delivered`) but no link is set yet,
  i.e. the precedence-bypass case.
- **Documentation**: three URL inputs (`tracking`, `pr`, `published`). The `pr:` field is
  the explicit hand-off signal — adding it advances status to `doc-ready-for-review`. The
  `published:` field holds the live `docs.logos.co` page URL; it drives the row-level Docs
  link (Section C) but has no effect on status or labels.
- **Red Team**: single URL input (`setRedTeamTracking`).

All inputs:
- Hidden when `hasWritePAT()` is false.
- Save via Enter or the ✓ button. Cancel via Escape or click-away to existing value.
- Persist with `updateIssueBody`; on success the local `item.content.body` is updated
  and `_parsed`/`_parsedBody`/`_refCache` are invalidated to force re-parse on next render.

**Ref resolution.** Every URL in a detail panel (milestones, doc packet, doc tracking,
doc PR, red team) is resolved via `fetchRef` to produce a `{type, state, title}` badge.
Module-level cache (`_refCache`) means each URL hits GitHub once per session. Non-GitHub
URLs are treated as `{type: 'url', state: 'merged'}` placeholders.

**Milestone progress.** Roadmap milestone URLs (`https://roadmap.logos.co/<area>/<dir>/<slug>`)
resolve via `fetchMilestoneProgress`, which fetches the parent `index.md` from
`logos-co/roadmap` via the Contents API and matches a checkbox line like
`- [x] [Title](./<slug>.md)`. Cached per URL.

**Blocked labels editor.** In admin mode the detail panel exposes a list of current
`blocked-by:*` labels (lifecycle + external) with × buttons, and an "+ add blocker"
affordance. Adding fires `addLabels`, removing fires `removeLabel`. Both refresh the
panel and re-evaluate mismatch state.

**Drivers section.** A "Drivers" section sits between the workflow card and "External
blockers" (see Part III). In admin mode it shows three always-visible toggle buttons over
the `DRIVER_DEFS` allowlist; in read-only mode it shows just the chips (or "None"). Toggling
fires `addLabels` / `removeLabel`, then re-renders both the picker and the pipeline row's
Driver cell + `data-drivers` attribute so the filter stays accurate without a full reload.

**Expand-all / Collapse-all** opens or closes every visible row's panel in one pass.
Closed-section panels are not included by default.

QA cares: a save persists across reload (the body update is what's authoritative); the
detail-panel input never appears outside admin mode; expand-all on a 50-item project
does not exhaust API rate limits (each ref hits the cache after the first resolve).

### I. Drag-and-drop reordering

Active only when `hasWritePAT()` and no filter pill is active. The HTML5 drag-and-drop
API drives it; the user grabs a row and the app:

1. On `dragstart`: remembers source index, marks the source row with `drag-source` class.
2. On container `dragover`: computes the insertion slot from `clientY`, hides the drop
   indicator if the slot is the source row's current position, otherwise shows the
   indicator before/after the appropriate wrapper.
3. On `dragleave` (only when leaving the container, not a child): hides the indicator.
4. On `drop`:
   - Splices the source item out of the open-items array and inserts at the computed
     index. The closed items list is untouched.
   - Moves the DOM node in place (no full re-render — avoids flash).
   - Re-numbers `data-index` and the rank label on every row.
   - Calls `moveProjectItem(projectId, itemId, afterItemId, pat)` to persist (GraphQL
     `updateProjectV2ItemPosition`). `afterItemId` is `null` for the top slot.
   - On failure: reverts the in-memory order, triggers a full re-render, and shows an
     error toast.

`applyDragGating(rowEl, { canWrite, anyFilter })` is the single point of truth for the
`draggable` attribute. Drag handlers attach once per row (`_dragInitialised` guard) so
toggling the attribute at runtime stays cheap.

QA cares: drop on the source's own slot is a no-op (no API call, no DOM move); a failed
mutation reverts to the pre-drop order; closed items never participate; toggling Edit
mode on/off mid-session re-binds drag handlers correctly.

### J. New journey creation

Admin-only. "+ New Journey" opens a modal with: title, body (pre-filled from
`newIssueBody()`), repo dropdown (`logos-co/journeys.logos.co` selected by default),
persona type, target testnet, R&D team. On submit:

1. `createIssue(owner, repo, title, body, labels, pat)` — labels include persona, testnet,
   `status:confirm-roadmap`, and `blocked-by:rnd-<team>` (or `blocked-by:rnd`).
2. `addItemToProject(projectId, contentId, pat)` — adds the new issue to the project.
3. Re-loads the project to surface the new row.

On failure at any step, a toast surfaces the error and the modal stays open with the
form values preserved.

QA cares: the issue body matches the template in `newIssueBody`; the new row appears at
the bottom of the open list (GitHub Projects default position) and is immediately
draggable; the dropdown options for R&D team match `RND_TEAMS` in `markdown.js`.

### K. Toast notifications

Singleton banner in the bottom-right corner. `showToast(type, message)` with type in
`success | error | info | warning`. Each call resets a 4-second auto-dismiss timer.
Icons: `✓ ✕ ℹ ⚠`. Toasts never queue — the latest replaces any current toast.

### L. Markdown rendering

`renderMarkdown(text)` uses `window.marked` (CDN) with `{ breaks: true, gfm: true }`. If
`marked` is unavailable, falls back to an HTML-escaped `<pre>` block. Empty / null input
renders `<em>No description provided.</em>`.

XSS safety: all user-supplied text rendered outside of marked goes through the
module-local `escapeHtml` helper. Marked itself is configured to sanitize via GFM rules.

### M. Auto-fix labels on issue close

A GitHub Actions workflow (outside the SPA but part of the system contract) listens for
issue-close events on `logos-co/journeys.logos.co`, recomputes the desired labels, and
syncs them. Closing an issue is the explicit "done" signal — `computeStatus` returns
`completed` when `issueClosed === true`. The workflow ensures the labels reflect that
without requiring a manual Fix Labels click.

---

## Part II — Multi-select Release Filter (retrospective)

> Retrospective specification for the testnet release filter added to the journeys pipeline.

### 1. Objective

Let R&D leads narrow the pipeline view to one or more target testnet releases simultaneously.

**Problem.** Journeys carry a `testnet vX.Y` label (or `testnet unscheduled`) but the pipeline showed all releases together. With dozens of journeys spanning three or more releases, a lead checking "what is in flight for v0.1 and v0.2 right now?" had no way to focus the view.

**Target users.** Logos R&D leads, docs team, red team — anyone using the pipeline to triage work for a specific upcoming testnet cut. Read-only viewers benefit equally; the filter requires no write PAT.

**Success.** A user can pick any subset of the releases present on the board and immediately see only matching journeys. The selection survives page reload via the URL.

### 2. Commands

The app is a static SPA with no build step.

| Command | Purpose |
|---|---|
| `npm run serve` | Serve the app locally on `http://localhost:3000` (wraps `npx serve .`) |
| `npm test` | Run the `node:test` suite in `tests/*.test.mjs` |
| `npm run lint` | Run ESLint over `js/` and `tests/` |
| `node --check js/pipeline.js` | Quick syntax-check after edits, no test run |
| `gh pr create` | Open a PR (standard repo workflow) |

Automated tests (`node:test`, no JSDOM) cover render output and pure logic. UI behavior that depends on real DOM/event flow is still verified manually in a browser per the smoke checklist below.

### 3. Project Structure

All filter logic lives in a single file:

```
js/pipeline.js
  ├─ Module state         activeReleaseFilter (Set<string>)
  ├─ Palette + helpers    RELEASE_PALETTE, releaseSlug(), releaseColor()
  ├─ renderPipeline()     URL → state restore, pill activation
  ├─ renderFilterBar()    Renders "Release:" pill row
  ├─ renderPipelineRow()  Emits data-releases="<slug …>" on wrapper
  ├─ applyFilter()        Matches wrapper.dataset.releases against the set
  ├─ syncFiltersToUrl()   Set → ?release=slug1,slug2
  ├─ attachFilterHandlers() Click handler toggles set membership
  └─ releasePill{Reset,Activate}()  Visual states
```

No other files were touched. The filter row composes into the existing `#filter-bar` container between the persona/team rows and the blocked-by row.

### 4. Code Style

Follow the conventions already present in `js/pipeline.js`:

- Plain ES modules, no framework, no bundler.
- Inline styles via template literals; Tailwind utility classes for layout.
- Slugs are kebab-case (`testnet v0.1` → `testnet-v0-1`) and used for both URL params and `data-*` attributes.
- Color tokens declared once at module scope (`RELEASE_PALETTE`), reused in pill render and reset/activate helpers.
- Pill activation pattern mirrors the existing `typePillActivate` / `typePillReset` pair — same opacity stops (`18`, `33`, `66`, `cc`) so all pill rows feel consistent.
- No comments unless the *why* is non-obvious.

### 5. Testing Strategy

Two layers: `node:test` covers render output and pure helpers (see `tests/render.test.mjs`, `tests/drag-gating.test.mjs`); manual browser smoke covers DOM/event flow. New test files must be added to the `test` script in `package.json` — it lists files explicitly because `node --test` does not glob across `tests/*` from a bash invocation.

**Smoke checklist** (run `npm run serve` and open `http://localhost:3000`):

1. "Release:" row appears with one pill per release label present on the board, including `testnet unscheduled` when journeys carry it.
2. Click a release pill → only matching journeys remain; URL gains `?release=<slug>`.
3. Click a second pill → both releases visible (OR within the row); URL becomes `?release=<slug1>,<slug2>`.
4. Deselect one pill → URL shrinks; the other release remains active.
5. Combine with a Persona or Team pill → intersection (AND across rows).
6. Reload the page → release pills restore from the URL.
7. With any release pill active, row drag is disabled (matches other filter rows).
8. Deselect all release pills → `release=` param drops from URL; full list returns.
9. URL with an unknown release slug (e.g. typo) is silently ignored on restore.

**Pre-commit gate.** Run `npm test` and `npm run lint`. Both must pass.

### 6. Boundaries

**Always do**

- Keep all filter state in `pipeline.js` module scope. Filters are an SPA concern, never persisted server-side.
- Encode multi-select state as comma-separated slugs in the URL so links are shareable.
- Validate restored URL slugs against labels actually present on the board — drop unknowns silently.
- Disable drag whenever any filter (including release) is active, matching the existing pattern.

**Ask first**

- Adding more multi-select filter rows. The current design has one multi-select (release) and three single-select (persona, team, blocked-by); flipping more rows to multi-select changes the mental model.
- Persisting filter state anywhere other than the URL (e.g. localStorage). Today only PAT and config live in localStorage; filters are intentionally URL-only.
- Changing the OR-within / AND-across semantics.

**Never do**

- Do not introduce a build step, framework, or bundler for this feature.
- Do not couple the filter to GitHub Projects field state — the source of truth is the issue labels (`/^testnet\b/i`).
- Do not hard-code a fixed list of releases. The pill row is derived from labels present on open items, so new testnets appear automatically.
- Do not reintroduce a second release-color table. `RELEASE_PALETTE` at module scope is the sole source for both filter pills and row chips.

---

## Part III — Journey Drivers (retrospective)

> Retrospective specification for the Journey Drivers feature added to the journeys pipeline. The ideation one-pager lives at `docs/ideas/journey-drivers.md`.

### 1. Objective

Make the *why* behind each journey's priority legible on the pipeline board, so prioritization decisions are defensible to ourselves and to R&D leads reading the board.

**Problem.** Before this feature, the pipeline showed *what* a journey was (persona, release) and *where it stood* (status, blocked-by), but not *why it earned its slot in the priority order*. When a lead asked "why is this above that?" the answer lived only in the head of the person who set the order. With multiple drivers (inbound RFPs, internal Quests, Sample App goals) and a growing board, the rationale needed a visible home.

**Target users.** Logos leadership defending the priority order; R&D leads reading the board to understand why their work is being asked for. Internal use only — no external audience.

**Success.** Each journey can be tagged with zero, one, or more drivers from a fixed allowlist. Drivers appear as chips in a dedicated "Driver" column. A single-select filter pill scopes the board to one driver. Tagging is editable in-app from the detail panel (admin mode), with the GitHub label UI as an always-available fallback.

### 2. Commands

Same as the rest of the SPA — see Part II §2. No new commands.

### 3. Project Structure

The feature touches one new repo asset (labels), three existing JS files, one new test file, and the `test` script in `package.json`.

```
GitHub repo (logos-co/journeys.logos.co)
  └─ Labels: driver:rfp (8C6A2E), driver:quest (7A4E73), driver:sample-app (5E8C6A)
            — lazily created by ensureDriverLabels on first toggle per session

js/pipeline.js
  ├─ Constants            DRIVER_DEFS, DRIVER_SLUG_TO_LABEL, DRIVER_SLUGS, DRIVER_COLOR
  ├─ Module state         activeDriverFilter (string | null)
  ├─ Pure helpers         matchesDriverFilter(rowAttr, activeSlug)  — exported, testable
  │                       renderDriverCell(labels)                   — exported, testable
  │                       driverSlugsFromLabels(labels)              — internal
  ├─ renderPipeline()     URL → state restore via DRIVER_SLUGS guard; orphan-filter drop
  ├─ renderFilterBar()    Renders "Driver:" single-select pill row when any open journey
  │                       carries a driver
  ├─ renderPipelineRow()  Adds <div id="driver-cell-${id}"> in the Driver column slot;
  │                       emits data-drivers="<slug …>" on the filter wrapper
  ├─ applyFilter()        Calls matchesDriverFilter on each row
  ├─ syncFiltersToUrl()   Set ?driver=<slug> when active
  ├─ attachFilterHandlers() Single-select toggle mirroring the persona-row pattern
  └─ driverPill{Reset,Activate}() Visual states matching the Type pill pair

js/detail.js
  ├─ renderDriverPicker(item, labels, canWrite) — three always-visible toggle buttons
  │                       in admin mode; chips (or "None") in read-only mode
  ├─ "Drivers" section in renderDetailShell, between the workflow card and
  │                       "External blockers"
  ├─ window._toggleDriver — ensureDriverLabels → add/remove → toast → refreshDriverPicker
  └─ refreshDriverPicker  — re-renders the detail picker AND the row's
                            data-drivers attr + chip cell (via id selector) so the
                            filter stays accurate without a full re-render

js/api.js
  └─ ensureDriverLabels(owner, repo, pat) — idempotent, lazy, own _ensuredDriverRepos
                         session guard. Independent from ensureLifecycleLabels;
                         drivers are orthogonal to the lifecycle.

tests/drivers.test.mjs (NEW, added to package.json `test` script)
  └─ 12 tests: DRIVER_DEFS shape, DRIVER_COLOR lookups, renderDriverCell across
              rfp / multi / empty / unknown / mixed, and matchesDriverFilter
              across all branches (active / inactive / undefined dataset).
```

The Driver column landed as the **last** column (after Blocked By, before the drag handle), not between Type and Release as the original ideation suggested. This kept the long Journey title column from being squeezed by an interior insertion.

Final grid template: `1fr 6.5rem 9rem 11rem 8rem 5rem 2rem` (Journey, Type, Release, Status, Blocked-By, Driver, drag-handle) with `gap-1` and a `pl-3` on the Type cell to preserve a wider visual gutter between Journey and Type. Trimming neighbouring column widths and tightening the gap was a coupled change made during T1's eyeball checkpoint to reclaim title space.

### 4. Code Style

Mirrors the persona-type pattern in `js/pipeline.js` (lines 22–31):

- `DRIVER_DEFS = [{ slug, label, color }, …]` at module scope. One entry per driver. Adding a driver is a one-line append plus a label creation in the repo. Both must happen.
- Slugs are the part after `driver:` (e.g. `rfp`, `quest`, `sample-app`). Labels on GitHub are the full `driver:<slug>` form.
- Helpers: `DRIVER_SLUG_TO_LABEL`, `DRIVER_SLUGS` (Set), `DRIVER_COLOR(slug)`. Lookup tables built once at module scope.
- Pure helpers (`renderDriverCell`, `matchesDriverFilter`, `driverSlugsFromLabels`) are top-level functions so tests can import them without a DOM. The filter integration in `applyFilter` is a one-line call to `matchesDriverFilter`.
- Column header text: **"Driver"** (matches the label namespace).
- Empty cell: render blank. No "— add driver" hint.
- Filter pill activation pattern copies `typePillActivate` / `typePillReset` verbatim — same opacity stops (`18`, `33`, `66`, `cc`).
- Detail-panel picker is **three always-visible toggle buttons**, not a free-form input. Each button's checked state is baked into the inline `onclick` handler (`window._toggleDriver(id, slug, isOn)`); after a successful write, `refreshDriverPicker` re-renders the picker so the next click reads the up-to-date `isOn`.
- Driver cell carries an `id="driver-cell-${item.id}"` so `refreshDriverPicker` can locate it without depending on the row's child ordering.
- `ensureDriverLabels` has its own session guard separate from `ensureLifecycleLabels` — driver labels and lifecycle labels are managed independently.
- No comments unless the *why* is non-obvious.

### 5. Testing Strategy

Two layers: `node:test` covers pure helpers; manual browser smoke covers DOM/event flow. `tests/drivers.test.mjs` is added to `package.json` `test` script (explicit list, no glob).

**Automated coverage** (12 tests in `tests/drivers.test.mjs`):

1. `DRIVER_DEFS` shape and slug list.
2. `DRIVER_SLUGS` set parity with `DRIVER_DEFS`.
3. `DRIVER_COLOR` returns the defined hex for each known slug.
4. `renderDriverCell([{ name: 'driver:rfp' }])` renders a chip with the rfp color and `>rfp<` text.
5. Two drivers render two chips.
6. No driver labels renders empty string.
7. Unknown `driver:foo` is ignored.
8. Mixed known + unknown renders only the known.
9. `matchesDriverFilter` returns true when no filter active.
10. Returns true when the row's `data-drivers` includes the active slug.
11. Returns false when it does not.
12. Returns false when the attribute is undefined.

The detail-panel picker is not covered by automated tests; precedent (the existing blocked-by editor) also has no automated tests, and the picker's behavior is exercised in the smoke checklist below.

**Smoke checklist** (`npm run serve`, then `http://localhost:3000`):

1. "Driver:" single-select pill row appears between the Persona and Team rows when any open journey carries a `driver:*` label. One pill per driver present.
2. "Driver" column header appears as the last column (between "Blocked By" and the drag handle) in both the open and closed pipeline sections.
3. Click a driver pill → only matching journeys remain; URL gains `?driver=<slug>`.
4. Click the same pill again → deactivates; URL drops the param; full list returns.
5. Click a different driver pill → switches selection (single-select).
6. Combine with a Release or Persona pill → intersection (AND across rows).
7. With any driver pill active, row drag is disabled.
8. Reload the page → driver pill restores from the URL.
9. URL with an unknown driver slug is silently ignored on restore.
10. In admin mode, open a journey's detail panel → "Drivers" section shows three toggle buttons reflecting current state. Clicking a button fires the label write, toasts on success/failure, updates the button's checked state, and updates the row's column chip immediately (no full reload).
11. In read-only mode, the "Drivers" section shows just chips (or muted "None"), no buttons. The column chip remains visible.
12. Closing a journey does not strip `driver:*` labels — proven by code analysis of `planLabelChanges` (`js/api.js:660`), which only touches `status:*`, `blocked-by:*`, `action:*`, and legacy `blocked:*` prefixes.
13. Fix Labels does not touch `driver:*` labels — same proof as smoke #12.

**Pre-commit gate.** Run `npm test` and `npm run lint`. Both must pass.

### 6. Boundaries

**Always do**

- Keep `DRIVER_DEFS` as the single source of truth for the driver vocabulary, colors, and display labels. Adding a driver requires both: a one-line append to `DRIVER_DEFS` in `pipeline.js` *and* a corresponding label in `DRIVER_LABEL_COLORS` in `js/api.js` (so `ensureDriverLabels` creates it). Out-of-sync state is a bug.
- Render the driver chip in the dedicated column. No badges in the title row, no per-row tinting, no other surface.
- Render an empty cell when a journey has no `driver:*` label. Absence is allowed.
- Treat drivers as orthogonal to the lifecycle state machine: no `status:*` transition reads a `driver:*` label; no `blocked-by:*` derivation depends on drivers.
- After any in-app driver write, refresh both the detail-panel picker AND the pipeline row's `data-drivers` attr + chip cell, so the filter never lies between writes.

**Ask first**

- Adding a new driver type. The allowlist is intentionally fixed — every addition is a deliberate vocabulary choice.
- Flipping the filter to multi-select (revisit only if usage proves single-select is too limiting after a month of real use).
- Adding a body field that links to the driver artifact (RFP brief, Quest doc, Sample App spec). Sensible v2, out of scope for v1.
- Moving the vocabulary from labels to a GitHub Projects v2 custom field. Revisit only if the allowlist proves too rigid.
- Promoting drivers to a sort or priority signal (changes the model from informational to gating).

**Never do**

- Do not auto-derive `driver:*` from any other source (body field, status, milestones). Drivers are human editorial judgment.
- Do not include `driver:*` in the Fix Labels reconciler. There is nothing to reconcile.
- Do not introduce a third data source. Vocabulary stays in code (`DRIVER_DEFS` + `DRIVER_LABEL_COLORS`) and on labels (the GitHub repo). Not in the issue body, not in Projects v2 fields.
- Do not show a "— add driver" placeholder in empty cells. Cell silence is intentional.
- Do not couple the closed-section rendering to drivers — closed journeys render drivers the same way as open ones.
- Do not introduce a generic in-app label editor as a side effect. The detail-panel driver picker is allowlist-scoped to `DRIVER_DEFS`; it does not accept arbitrary label text. The existing blocked-by editor remains the only free-form label affordance (and is flagged for removal in a separate follow-up).
