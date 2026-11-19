# USAGE — manage journey issues with `gh`

For creating and updating journeys from the command line. You do **not** need to run or build
the app.

**Prerequisite:** read the **Concepts** section of [README.md](README.md#concepts--journey-data-model-and-lifecycle)
first — the data model and lifecycle there are the rules these commands follow.

## Create a journey

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

Rules:
- Always include **one journey type label** (`gui user` / `cli user` / `developer` / `node operator`) and
  **one target `testnet` label**. Ask for clarification if either is missing.
- New journeys start at `status:confirm-roadmap` with `blocked-by:rnd` (or `blocked-by:rnd-<team>`
  if the team is known).
- R&D `team` options: `anon-comms`, `messaging`, `core`, `storage`, `blockchain`, `zones`,
  `smart-contract`, `devkit`.

After creating, **add the issue to the project board** so it appears in the app. This step is
mandatory — always run it:

```bash
gh project item-add 12 --owner logos-co --url <issue-url>
```

## Update a journey

Advance the lifecycle by editing the **issue body**, not by hand-setting status labels — the
app recomputes `status:*` / `blocked-by:*` from the body and the in-app **Fix Labels** button
reconciles drift. To move a journey forward, fill in the next body field per the lifecycle
table in [README.md](README.md#the-lifecycle) (e.g. paste a `## Doc Packet - link:` to hand off
to Docs).

```bash
gh issue edit <number> --repo logos-co/journeys.logos.co --body-file -   # paste edited body
```

Driver labels are a free choice and gate nothing:

```bash
gh issue edit <number> --repo logos-co/journeys.logos.co --add-label "driver:rfp"
```

## Label color reference

- Journey type: `gui user`=`D94F45`, `cli user`=`2A9D8F`, `developer`=`3B7CB8`, `node operator`=`C4912C`
- Driver: `rfp`=`8C6A2E`, `quest`=`7A4E73`, `sample-app`=`5E8C6A`
