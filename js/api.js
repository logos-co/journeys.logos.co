/**
 * api.js — GitHub GraphQL + REST API calls
 */

const GRAPHQL_URL = 'https://api.github.com/graphql';
const REST_BASE = 'https://api.github.com';

/**
 * Execute a GraphQL query/mutation against the GitHub API.
 * @param {string} query - GraphQL query string
 * @param {Object} variables - GraphQL variables
 * @param {string} [pat] - Personal access token (optional)
 * @returns {Promise<Object>} - data field from the response
 */
export async function graphql(query, variables = {}, pat = '') {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  if (pat) {
    headers['Authorization'] = `bearer ${pat}`;
  }

  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`GitHub API HTTP ${response.status}: ${text || response.statusText}`);
  }

  const json = await response.json();

  if (json.errors && json.errors.length > 0) {
    const msgs = json.errors.map(e => e.message).join('; ');
    throw new Error(`GraphQL error: ${msgs}`);
  }

  return json.data;
}

/**
 * Make a GitHub REST API request.
 * @param {string} path - e.g. '/repos/owner/repo/issues/1'
 * @param {Object} options - fetch options
 * @param {string} [pat] - Personal access token (optional)
 */
export async function restRequest(path, options = {}, pat = '') {
  const headers = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(options.headers || {}),
  };
  if (pat) {
    headers['Authorization'] = `bearer ${pat}`;
  }

  const response = await fetch(`${REST_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const json = await response.json().catch(() => ({}));
    throw new Error(json.message || `HTTP ${response.status}: ${response.statusText}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

// ---------------------------------------------------------------------------
// Project V2 queries
// ---------------------------------------------------------------------------

const GET_PROJECT_ITEMS_QUERY = `
query GetProjectItems($owner: String!, $number: Int!, $cursor: String) {
  user(login: $owner) {
    projectV2(number: $number) {
      id
      title
      items(first: 50, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          content {
            ... on Issue {
              number
              title
              body
              state
              closedAt
              url
              repository { nameWithOwner }
              labels(first: 20) {
                nodes { name color }
              }
              assignees(first: 5) {
                nodes { login avatarUrl }
              }
            }
          }
        }
      }
    }
  }
}
`;

const GET_PROJECT_ITEMS_ORG_QUERY = `
query GetProjectItemsOrg($owner: String!, $number: Int!, $cursor: String) {
  organization(login: $owner) {
    projectV2(number: $number) {
      id
      title
      items(first: 50, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          content {
            ... on Issue {
              number
              title
              body
              state
              closedAt
              url
              repository { nameWithOwner }
              labels(first: 20) {
                nodes { name color }
              }
              assignees(first: 5) {
                nodes { login avatarUrl }
              }
            }
          }
        }
      }
    }
  }
}
`;

/**
 * Fetch ALL items from a GitHub Projects v2, handling pagination.
 * Tries `user` query first, then `organization`.
 * @param {string} owner
 * @param {number} number - project number
 * @param {string} [pat]
 * @returns {Promise<{projectId: string, projectTitle: string, items: Array}>}
 */
export async function fetchProjectItems(owner, number, pat = '') {
  const allItems = [];
  let cursor = null;
  let projectId = null;
  let projectTitle = '';
  let useOrg = false;

  // Attempt first page to determine if user or org
  const firstAttempt = await fetchProjectPage(owner, number, pat, null, false);
  if (firstAttempt === null) {
    // Try org
    const orgAttempt = await fetchProjectPage(owner, number, pat, null, true);
    if (orgAttempt === null) {
      throw new Error(`Could not find project #${number} for owner "${owner}". Check the owner name and project number.`);
    }
    useOrg = true;
    projectId = orgAttempt.projectId;
    projectTitle = orgAttempt.projectTitle;
    allItems.push(...orgAttempt.nodes);
    cursor = orgAttempt.hasNextPage ? orgAttempt.endCursor : null;
  } else {
    projectId = firstAttempt.projectId;
    projectTitle = firstAttempt.projectTitle;
    allItems.push(...firstAttempt.nodes);
    cursor = firstAttempt.hasNextPage ? firstAttempt.endCursor : null;
  }

  // Paginate remaining pages
  while (cursor) {
    const page = await fetchProjectPage(owner, number, pat, cursor, useOrg);
    if (!page) break;
    allItems.push(...page.nodes);
    cursor = page.hasNextPage ? page.endCursor : null;
  }

  // Filter to only Issue content nodes (skip drafts / PRs)
  const items = allItems.filter(node => node.content && node.content.title);

  return { projectId, projectTitle, items, isOrg: useOrg };
}

async function fetchProjectPage(owner, number, pat, cursor, useOrg) {
  try {
    const query = useOrg ? GET_PROJECT_ITEMS_ORG_QUERY : GET_PROJECT_ITEMS_QUERY;
    const data = await graphql(query, { owner, number, cursor: cursor || null }, pat);

    const root = useOrg ? data.organization : data.user;
    if (!root || !root.projectV2) return null;

    const project = root.projectV2;
    return {
      projectId: project.id,
      projectTitle: project.title,
      nodes: project.items.nodes,
      hasNextPage: project.items.pageInfo.hasNextPage,
      endCursor: project.items.pageInfo.endCursor,
    };
  } catch (err) {
    // If the error is "Could not resolve to a User" type, return null to try org
    if (!useOrg && err.message.includes('GraphQL error')) {
      return null;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Move project item (drag to reorder)
// ---------------------------------------------------------------------------

const UPDATE_POSITION_MUTATION = `
mutation UpdateProjectItemPosition($projectId: ID!, $itemId: ID!, $afterId: ID) {
  updateProjectV2ItemPosition(input: {
    projectId: $projectId
    itemId: $itemId
    afterId: $afterId
  }) {
    clientMutationId
  }
}
`;

/**
 * Move a project item to a new position.
 * @param {string} projectId
 * @param {string} itemId
 * @param {string|null} afterItemId - null = move to top
 * @param {string} pat
 */
export async function moveProjectItem(projectId, itemId, afterItemId, pat) {
  return graphql(UPDATE_POSITION_MUTATION, {
    projectId,
    itemId,
    afterId: afterItemId || null,
  }, pat);
}

// ---------------------------------------------------------------------------
// Issue REST calls
// ---------------------------------------------------------------------------

/**
 * Fetch a single issue by owner/repo/number.
 * @param {string} owner
 * @param {string} repo
 * @param {number} issueNumber
 * @param {string} [pat]
 */
export async function fetchIssue(owner, repo, issueNumber, pat = '') {
  return restRequest(`/repos/${owner}/${repo}/issues/${issueNumber}`, {}, pat);
}

/**
 * Fetch multiple issues in parallel (with concurrency limit).
 * @param {Array<{owner: string, repo: string, number: number}>} refs
 * @param {string} [pat]
 * @returns {Promise<Array>}
 */
export async function fetchIssuesBatch(refs, pat = '') {
  const CONCURRENCY = 6;
  const results = [];
  for (let i = 0; i < refs.length; i += CONCURRENCY) {
    const batch = refs.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map(({ owner, repo, number }) => fetchIssue(owner, repo, number, pat))
    );
    for (let j = 0; j < settled.length; j++) {
      const s = settled[j];
      if (s.status === 'fulfilled') {
        results.push({ ref: batch[j], issue: s.value, error: null });
      } else {
        results.push({ ref: batch[j], issue: null, error: s.reason });
      }
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Label mutations
// ---------------------------------------------------------------------------

/**
 * Add labels to an issue.
 * @param {string} owner
 * @param {string} repo
 * @param {number} issueNumber
 * @param {string[]} labels
 * @param {string} pat
 */
export async function addLabels(owner, repo, issueNumber, labels, pat) {
  return restRequest(`/repos/${owner}/${repo}/issues/${issueNumber}/labels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ labels }),
  }, pat);
}

/**
 * Remove a label from an issue.
 * @param {string} owner
 * @param {string} repo
 * @param {number} issueNumber
 * @param {string} label
 * @param {string} pat
 */
export async function removeLabel(owner, repo, issueNumber, label, pat) {
  const encoded = encodeURIComponent(label);
  return restRequest(`/repos/${owner}/${repo}/issues/${issueNumber}/labels/${encoded}`, {
    method: 'DELETE',
  }, pat);
}

/**
 * List all labels for a repo.
 * @param {string} owner
 * @param {string} repo
 * @param {string} [pat]
 */
export async function listRepoLabels(owner, repo, pat = '') {
  return restRequest(`/repos/${owner}/${repo}/labels?per_page=100`, {}, pat);
}

/**
 * Create a label in a repo. No-ops silently if the label already exists (HTTP 422).
 * @param {string} owner
 * @param {string} repo
 * @param {string} name
 * @param {string} color - 6-char hex without '#'
 * @param {string} pat
 */
export async function createLabel(owner, repo, name, color, pat) {
  const headers = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
  if (pat) headers['Authorization'] = `bearer ${pat}`;
  const response = await fetch(`${REST_BASE}/repos/${owner}/${repo}/labels`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name, color }),
  });
  if (response.status === 422) return; // already exists
  if (!response.ok) {
    const json = await response.json().catch(() => ({}));
    throw new Error(json.message || `HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Update an issue's body.
 * @param {string} owner
 * @param {string} repo
 * @param {number} issueNumber
 * @param {string} body - full new body text
 * @param {string} pat
 */
export async function updateIssueBody(owner, repo, issueNumber, body, pat) {
  return restRequest(`/repos/${owner}/${repo}/issues/${issueNumber}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  }, pat);
}

/**
 * Update an issue's title.
 */
export async function updateIssueTitle(owner, repo, issueNumber, title, pat) {
  return restRequest(`/repos/${owner}/${repo}/issues/${issueNumber}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  }, pat);
}

/**
 * Replace the full label set on an issue.
 */
export async function setIssueLabels(owner, repo, issueNumber, labels, pat) {
  return restRequest(`/repos/${owner}/${repo}/issues/${issueNumber}/labels`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ labels }),
  }, pat);
}

/**
 * Create a new GitHub issue.
 */
export async function createIssue(owner, repo, title, body, labels, pat) {
  return restRequest(`/repos/${owner}/${repo}/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body, labels }),
  }, pat);
}

/**
 * Add an issue to a GitHub Projects V2 board.
 */
export async function addItemToProject(projectId, contentId, pat) {
  return graphql(`
    mutation AddItemToProject($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
        item { id }
      }
    }
  `, { projectId, contentId }, pat);
}

/**
 * Fetch a GitHub URL — issue, PR, or non-GitHub URL — and return its type + state.
 * Non-GitHub URLs are treated as live docs (state: 'merged').
 */
export async function fetchRef(url, pat = '') {
  const prM   = url.match(/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/);
  const issueM = url.match(/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)/);
  if (!prM && !issueM) return { type: 'url', state: 'merged', title: null, html_url: url };

  try {
    if (prM) {
      const [, owner, repo, number] = prM;
      const pr = await restRequest(`/repos/${owner}/${repo}/pulls/${number}`, {}, pat);
      const state = pr.merged_at ? 'merged' : pr.state;
      return { type: 'pr', state, title: pr.title, html_url: pr.html_url };
    }
    const [, owner, repo, number] = issueM;
    const issue = await restRequest(`/repos/${owner}/${repo}/issues/${number}`, {}, pat);
    return { type: 'issue', state: issue.state, title: issue.title, html_url: issue.html_url };
  } catch (err) {
    return { type: prM ? 'pr' : 'issue', state: 'error', title: null, html_url: url, error: err.message };
  }
}

/**
 * Batch-fetch multiple refs (issues/PRs/URLs) with concurrency limit.
 */
export async function fetchRefsBatch(urls, pat = '') {
  const CONCURRENCY = 6;
  const results = [];
  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const batch = urls.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(batch.map(url => fetchRef(url, pat)));
    for (const s of settled) {
      results.push(s.status === 'fulfilled' ? s.value : { type: 'error', state: 'error', title: null });
    }
  }
  return results;
}

/**
 * Sync action:* labels on an issue to match the desired set.
 * Returns { added, removed } arrays.
 */
export async function syncActionLabels(owner, repo, issueNum, currentLabels, desiredActionLabels, pat) {
  const ACTION_SET = ['action:rnd', 'action:docs', 'action:red-team'];
  const currentAction = currentLabels.filter(l => ACTION_SET.includes(l));
  const toAdd    = desiredActionLabels.filter(l => !currentAction.includes(l));
  const toRemove = currentAction.filter(l => !desiredActionLabels.includes(l));
  await Promise.all([
    ...(toAdd.length ? [addLabels(owner, repo, issueNum, toAdd, pat)] : []),
    ...toRemove.map(l => removeLabel(owner, repo, issueNum, l, pat)),
  ]);
  return { added: toAdd, removed: toRemove };
}
