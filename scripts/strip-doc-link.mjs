#!/usr/bin/env node
// Strip `- link:` lines from the `## Documentation` section of every journey issue.
// Idempotent: skips issues whose Documentation block has no `- link:` line.
// Usage: node scripts/strip-doc-link.mjs [--apply]
//   without --apply, prints what would change without modifying any issue.

import { execFileSync } from 'node:child_process';

const REPO = 'logos-co/journeys.logos.co';
const APPLY = process.argv.includes('--apply');

function gh(args, input) {
  return execFileSync('gh', args, { input, encoding: 'utf8' });
}

/** Remove `- link:` lines that sit inside the `## Documentation` section. */
function stripDocLink(body) {
  const lines = body.split('\n');
  const out = [];
  let inDocs = false;
  let removed = 0;
  for (const line of lines) {
    const heading = line.match(/^#{1,3}\s+(.+?)\s*$/);
    if (heading) {
      inDocs = /^Documentation\s*$/i.test(heading[1]);
      out.push(line);
      continue;
    }
    if (inDocs && /^-[ \t]+link:/i.test(line)) {
      removed++;
      continue;
    }
    out.push(line);
  }
  return { body: out.join('\n'), removed };
}

const list = JSON.parse(gh(['issue', 'list', '--repo', REPO, '--state', 'all', '--limit', '200', '--json', 'number,title,body']));
console.log(`Scanning ${list.length} issues…`);

let changed = 0, skipped = 0;
for (const { number, title, body } of list) {
  const { body: newBody, removed } = stripDocLink(body || '');
  if (removed === 0) { skipped++; continue; }
  changed++;
  console.log(`#${number} (${removed} line${removed > 1 ? 's' : ''} stripped) — ${title}`);
  if (APPLY) {
    gh(['issue', 'edit', String(number), '--repo', REPO, '--body-file', '-'], newBody);
  }
}

console.log(`\n${APPLY ? 'Applied' : 'Would change'}: ${changed}; unchanged: ${skipped}`);
if (!APPLY) console.log('Re-run with --apply to update the issues.');
