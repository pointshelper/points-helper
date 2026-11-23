// Reads the Points Helper team's issues from Linear and writes site/roadmap.json for the What's next page.
// Only titles, a column and a GitHub issue link (when there is one) are published: no descriptions,
// no people, no Linear links.
//
// Env: LINEAR_API_KEY (a personal API key), LINEAR_TEAM_KEY (e.g. PH), GITHUB_REPOSITORY (owner/name, set by Actions).

import { writeFile, mkdir } from 'node:fs/promises';

const KEY = process.env.LINEAR_API_KEY;
const TEAM = process.env.LINEAR_TEAM_KEY;
const REPO = process.env.GITHUB_REPOSITORY || '';
if (!KEY || !TEAM) {
  console.error('Set LINEAR_API_KEY and LINEAR_TEAM_KEY.');
  process.exit(1);
}

const HIDE_LABEL = 'hide from what\'s next';
const DAY = 86400000;
const SHIPPED_DAYS = 30;
const NOT_PLANNED_DAYS = 90;

// Linear workflow state types → page columns.
const COLUMN = { triage: 'submitted', backlog: 'planned', unstarted: 'planned', started: 'progress' };
const KIND = { bug: 'Bug', 'store request': 'Store', idea: 'Idea', improvement: 'Improvement' };

const QUERY = `query($team: String!, $after: String) {
  issues(first: 100, after: $after, filter: { team: { key: { eq: $team } } }) {
    pageInfo { hasNextPage endCursor }
    nodes {
      title description createdAt completedAt canceledAt
      state { type name }
      labels { nodes { name } }
      attachments { nodes { url } }
    }
  }
}`;

async function fetchAll() {
  const all = [];
  let after = null;
  do {
    const res = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: KEY },
      body: JSON.stringify({ query: QUERY, variables: { team: TEAM, after } })
    });
    const json = await res.json();
    if (json.errors) throw new Error(JSON.stringify(json.errors));
    const page = json.data.issues;
    all.push(...page.nodes);
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return all;
}

function githubUrl(issue) {
  if (!REPO) return null;
  const prefix = 'https://github.com/' + REPO + '/issues/';
  const a = issue.attachments.nodes.find(n => n.url && n.url.startsWith(prefix));
  return a ? a.url : null;
}

// The description is only read here to work out the type; it's never published.
// GitHub only applies template labels that exist in the repo, so fall back to the template's headings.
function kindOf(labels, body) {
  for (const name of labels) if (KIND[name]) return KIND[name];
  if (/^#+\s*Store\s*$/m.test(body)) return 'Store';
  if (/^#+\s*What happened\?\s*$/m.test(body)) return 'Bug';
  if (/^#+\s*Your idea\s*$/m.test(body)) return 'Idea';
  return null;
}

// The Store field from the store request form, for when the title doesn't name the store.
function storeField(body) {
  const m = body.match(/^#+\s*Store\s*\n+([^\n#]+)/m);
  return m ? m[1].trim() : '';
}

const issues = await fetchAll();
const now = Date.now();
const out = { updatedAt: new Date().toISOString(), submitted: [], planned: [], progress: [], next: [], shipped: [], notPlanned: [] };

for (const issue of issues) {
  const labels = issue.labels.nodes.map(l => l.name.toLowerCase());
  if (labels.includes(HIDE_LABEL)) continue;
  const body = issue.description || '';
  const kind = kindOf(labels, body);
  // The tag already says "Store", so "Store: LEGO" reads as just "LEGO".
  let title = kind === 'Store' ? issue.title.replace(/^store:?\s*/i, '') : issue.title;
  if (!title.trim()) title = storeField(body) || issue.title;
  const item = { title, url: githubUrl(issue), kind };
  const type = issue.state.type;
  if (type === 'completed') {
    if (issue.completedAt && now - Date.parse(issue.completedAt) < SHIPPED_DAYS * DAY) out.shipped.push({ ...item, at: issue.completedAt });
  } else if (type === 'canceled') {
    // Duplicates are canceled in Linear too; they read as noise here, so only show recent ones without a "duplicate" label.
    if (!labels.includes('duplicate') && issue.canceledAt && now - Date.parse(issue.canceledAt) < NOT_PLANNED_DAYS * DAY) out.notPlanned.push(item);
  } else if (type === 'started' && /release|approved for production/i.test(issue.state.name)) {
    // "Approved for Production" (or a status named like "Coming in next release"): built, waiting on Chrome Web Store review.
    out.next.push({ ...item, at: issue.createdAt });
  } else if (COLUMN[type]) {
    out[COLUMN[type]].push({ ...item, at: issue.createdAt });
  }
}

// 👍 reactions on the GitHub issue count as "me too" votes.
async function votesFor(url) {
  const m = url && url.match(/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)/);
  if (!m) return 0;
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'points-helper-whats-next' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = 'Bearer ' + process.env.GITHUB_TOKEN;
  try {
    const res = await fetch(`https://api.github.com/repos/${m[1]}/issues/${m[2]}`, { headers });
    if (!res.ok) return 0;
    const issue = await res.json();
    return (issue.reactions && issue.reactions['+1']) || 0;
  } catch (e) {
    return 0;
  }
}
for (const k of ['submitted', 'planned', 'progress', 'next']) {
  for (const item of out[k]) item.votes = await votesFor(item.url);
}

const newest = (a, b) => (b.at || '').localeCompare(a.at || '');
for (const k of ['submitted', 'planned', 'progress', 'next', 'shipped']) {
  out[k].sort(newest);
  // Shipped keeps its date: the page groups items closed on the same day into one release.
  if (k !== 'shipped') for (const item of out[k]) delete item.at;
}

await mkdir('site', { recursive: true });
await writeFile('site/roadmap.json', JSON.stringify(out, null, 2) + '\n');
console.log(`Wrote ${issues.length} issues → submitted ${out.submitted.length}, planned ${out.planned.length}, ` +
  `in progress ${out.progress.length}, next release ${out.next.length}, shipped ${out.shipped.length}, not planned ${out.notPlanned.length}`);
