#!/usr/bin/env bash
# migrate-issues.sh — Convert old ## Dependencies format to 3-stakeholder format
# Usage: GITHUB_TOKEN=<token> bash scripts/migrate-issues.sh [--dry-run]
#
# Reads each issue from logos-co/journeys.logos.co, parses the old ## Dependencies
# section, and rewrites the body in the new ## R&D / ## Doc Packet / ## Documentation
# / ## Red Team format.
#
# Multi-R&D team issues (26, 27, 18) are flagged for manual review.

set -euo pipefail

REPO="logos-co/journeys.logos.co"
DRY_RUN=false
FLAGGED=()

for arg in "$@"; do
  [[ "$arg" == "--dry-run" ]] && DRY_RUN=true
done

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "Error: GITHUB_TOKEN not set" >&2
  exit 1
fi

# Get all open issue numbers
NUMBERS=$(gh issue list --repo "$REPO" --limit 100 --state open --json number --jq '.[].number')

for NUM in $NUMBERS; do
  echo "--- Issue #$NUM ---"

  BODY=$(gh issue view "$NUM" --repo "$REPO" --json body --jq '.body // ""')

  # Skip if already migrated (has ## R&D section)
  if echo "$BODY" | grep -qE '^#{1,3}\s+R&D'; then
    echo "  Already migrated, skipping."
    continue
  fi

  # Extract ## Dependencies section
  DEPS_SECTION=$(echo "$BODY" | python3 -c "
import sys, re
body = sys.stdin.read()
m = re.search(r'^#{1,3}\s+Dependencies[ \t]*\r?\n', body, re.M)
if not m:
    sys.exit(0)
start = m.end()
rest = body[start:]
nxt = re.search(r'^#{1,3}\s', rest, re.M)
print(rest[:nxt.start()] if nxt else rest)
")

  # Extract ## Documentation section (bare URL fallback)
  DOC_URL=$(echo "$BODY" | python3 -c "
import sys, re
body = sys.stdin.read()
m = re.search(r'^#{1,3}\s+Documentation[ \t]*\r?\n', body, re.M)
if not m:
    sys.exit(0)
start = m.end()
rest = body[start:]
nxt = re.search(r'^#{1,3}\s', rest, re.M)
section = rest[:nxt.start()] if nxt else rest
# Try - link: first
lm = re.search(r'^-[ \t]+link:[ \t]*(\S+)', section, re.M)
if lm:
    print(lm.group(1))
    sys.exit(0)
# Bare URL fallback
um = re.search(r'https?://\S+', section)
if um:
    print(um.group(0).rstrip(')].;,>'))
")

  # Extract description: everything before ## Dependencies (or ## Documentation)
  DESCRIPTION=$(echo "$BODY" | python3 -c "
import sys, re
body = sys.stdin.read()
# Find the first of: ## Dependencies, ## Documentation
m = re.search(r'^#{1,3}\s+(Dependencies|Documentation)\b', body, re.M)
print(body[:m.start()].strip() if m else body.strip())
")

  # Parse dep lines: - team: [PENDING] [URL] [date]
  RND_TEAMS=()
  RND_MILESTONE=""
  RND_DATE=""
  DOCS_LINK="$DOC_URL"
  REDTEAM_LINK=""

  while IFS= read -r line; do
    # Match: - team: [stuff]
    if [[ "$line" =~ ^-[[:space:]]+([^:]+):[[:space:]]*(.*) ]]; then
      TEAM="${BASH_REMATCH[1]}"
      VALUE="${BASH_REMATCH[2]}"
      TEAM_LOWER=$(echo "$TEAM" | tr '[:upper:]' '[:lower:]' | sed 's/[[:space:]]/-/g')

      # Normalise team names
      case "$TEAM_LOWER" in
        "anon-comms"|"anon comms") TEAM_LOWER="anon-comms" ;;
        "message-delivery"|"message delivery") TEAM_LOWER="message-delivery" ;;
      esac

      # Extract URL from value
      URL=$(echo "$VALUE" | grep -oE 'https?://[^ ]+' | head -1 || true)
      # Extract date (DDMmmYY)
      DATE=$(echo "$VALUE" | grep -oE '[0-9]{2}[A-Za-z]{3}[0-9]{2}' | head -1 || true)

      case "$TEAM_LOWER" in
        docs)
          [[ -z "$DOCS_LINK" && -n "$URL" ]] && DOCS_LINK="$URL"
          ;;
        "red-team"|"red team")
          [[ -n "$URL" ]] && REDTEAM_LINK="$URL"
          ;;
        *)
          RND_TEAMS+=("$TEAM_LOWER")
          [[ -n "$URL" && "$TEAM_LOWER" != "docs" ]] && RND_MILESTONE="$URL"
          [[ -n "$DATE" ]] && RND_DATE="$DATE"
          ;;
      esac
    fi
  done <<< "$DEPS_SECTION"

  # Determine R&D team: prefer first non-anon-comms team when multiple
  RND_TEAM=""
  if [[ ${#RND_TEAMS[@]} -gt 0 ]]; then
    RND_TEAM="${RND_TEAMS[0]}"
    if [[ ${#RND_TEAMS[@]} -gt 1 ]]; then
      for t in "${RND_TEAMS[@]}"; do
        if [[ "$t" != "anon-comms" ]]; then
          RND_TEAM="$t"
          break
        fi
      done
      echo "  Multiple R&D teams: ${RND_TEAMS[*]} — using: $RND_TEAM"
    fi
  fi

  # Build new body
  NEW_BODY=$(python3 -c "
import sys

description = sys.argv[1]
rnd_team    = sys.argv[2]
milestone   = sys.argv[3]
date_val    = sys.argv[4]
docs_link   = sys.argv[5]
rt_link     = sys.argv[6]

parts = []
if description:
    parts.append(description)

rnd_lines = ['## R&D']
rnd_lines.append(f'- team: {rnd_team}' if rnd_team else '- team:')
rnd_lines.append(f'- milestone: {milestone}' if milestone else '- milestone:')
rnd_lines.append(f'- date: {date_val}' if date_val else '- date:')
parts.append('\n'.join(rnd_lines))

parts.append('## Doc Packet\n_Fill in using the [doc packet template](https://github.com/logos-co/logos-docs/blob/main/docs/_shared/templates/doc-packet-testnet-v01.md)._')

doc_lines = ['## Documentation']
doc_lines.append(f'- link: {docs_link}' if docs_link else '- link:')
parts.append('\n'.join(doc_lines))

rt_lines = ['## Red Team']
rt_lines.append(f'- tracking: {rt_link}' if rt_link else '- tracking:')
parts.append('\n'.join(rt_lines))

print('\n\n'.join(parts))
" "$DESCRIPTION" "$RND_TEAM" "$RND_MILESTONE" "$RND_DATE" "$DOCS_LINK" "$REDTEAM_LINK")

  echo "  R&D team:   ${RND_TEAM:-<none>}"
  echo "  Milestone:  ${RND_MILESTONE:-<none>}"
  echo "  Date:       ${RND_DATE:-<none>}"
  echo "  Docs link:  ${DOCS_LINK:-<none>}"
  echo "  Red team:   ${REDTEAM_LINK:-<none>}"

  if $DRY_RUN; then
    echo "  [DRY RUN] Would update body:"
    echo "---"
    echo "$NEW_BODY"
    echo "---"
  else
    echo "$NEW_BODY" | gh issue edit "$NUM" --repo "$REPO" --body-file -
    echo "  Updated #$NUM"
  fi

  sleep 0.5  # rate limit
done

if [[ ${#FLAGGED[@]} -gt 0 ]]; then
  echo ""
  echo "⚠ Issues needing manual review (multiple R&D teams):"
  for f in "${FLAGGED[@]}"; do
    echo "  $f"
  done
fi

echo ""
echo "Done."
