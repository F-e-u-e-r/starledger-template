/**
 * Pure GitHub-URL logic: extract repository candidates from free text and
 * normalize a single URL to a canonical `owner/repo`. No network — live
 * resolution (node id, rename/transfer, private) is P2.2 (`resolve-repo.ts`).
 *
 * This lands in P2.1 because the awesome-stars source diffs the *set* of
 * repository URLs between two commits, which needs a deterministic candidate
 * identity (a markdown line diff would be wrong).
 */

/**
 * First-path segments that are GitHub product routes, NOT repository owners.
 * GitHub forbids users/orgs from taking these names, so an `owner` equal to one
 * of them is never a repository. (The P2 spec names topics, marketplace,
 * settings, sponsors, orgs, users, features, collections; the rest are the
 * other well-known reserved routes.)
 */
const RESERVED_OWNERS = new Set([
  'topics',
  'marketplace',
  'settings',
  'sponsors',
  'orgs',
  'users',
  'features',
  'collections',
  'about',
  'pricing',
  'login',
  'logout',
  'join',
  'signup',
  'new',
  'notifications',
  'explore',
  'trending',
  'search',
  'apps',
  'contact',
  'security',
  'readme',
  'account',
  'dashboard',
  'codespaces',
  'organizations',
  'enterprise',
  'sessions',
  'watching',
  'stars',
  'issues',
  'pulls',
  'site',
  'blog',
  'events',
  'home',
  'sponsors-explore',
]);

const OWNER_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/; // GitHub login rules (no dots/underscores)
const REPO_RE = /^[a-z0-9._-]+$/;

export interface GithubCandidate {
  /** Canonical lowercased `owner/repo` — the stable identity for set diffing. */
  owner_repo: string;
  /** Canonical `https://github.com/owner/repo` URL for display. */
  url: string;
}

function fromPath(rawPath: string): string | null {
  const clean = (rawPath.split(/[?#]/)[0] ?? '').replace(/[.,;:!?]+$/, '');
  const segs = clean.split('/').filter(Boolean);
  if (segs.length < 2) return null; // a single segment is a user/org page, not a repo
  const owner = (segs[0] ?? '').toLowerCase();
  const repo = (segs[1] ?? '').replace(/\.git$/i, '').toLowerCase();
  if (!owner || !repo || repo === '.' || repo === '..') return null;
  if (RESERVED_OWNERS.has(owner)) return null;
  if (!OWNER_RE.test(owner) || !REPO_RE.test(repo)) return null;
  return `${owner}/${repo}`;
}

/**
 * Normalize one URL/string to a canonical lowercased `owner/repo`, or null if it
 * is not a GitHub repository reference. Handles https, scheme-relative, bare
 * `github.com/...`, `www.`, trailing `.git`, repository subpaths
 * (`/tree`, `/blob`, `/issues`, ...), and SSH (`git@github.com:o/r`,
 * `ssh://git@github.com/o/r`).
 */
export function normalizeGithubUrl(raw: string): string | null {
  const s = raw.trim();

  const scp = /^[^@\s]+@github\.com:(.+)$/i.exec(s);
  if (scp?.[1]) return fromPath(scp[1]);

  const ssh = /^ssh:\/\/(?:[^@/]+@)?github\.com\/(.+)$/i.exec(s);
  if (ssh?.[1]) return fromPath(ssh[1]);

  const http = /^(?:https?:\/\/)?(?:www\.)?github\.com\/(.+)$/i.exec(s);
  if (http?.[1]) return fromPath(http[1]);

  return null;
}

const GITHUB_URL_RE = /(?:https?:\/\/)?(?:www\.)?github\.com\/[^\s)>\]"'`]+/gi;
const GITHUB_SCP_RE = /[^@\s):>\]"'`]+@github\.com:[^\s)>\]"'`]+/gi;

/**
 * Extract the de-duplicated set of GitHub repository candidates from free text
 * (a video description, a markdown file). Order follows first appearance; each
 * `owner_repo` appears once.
 */
export function extractGithubCandidates(text: string): GithubCandidate[] {
  const out = new Map<string, GithubCandidate>();
  const add = (raw: string): void => {
    const owner_repo = normalizeGithubUrl(raw);
    if (owner_repo && !out.has(owner_repo)) {
      out.set(owner_repo, { owner_repo, url: `https://github.com/${owner_repo}` });
    }
  };
  for (const m of text.matchAll(GITHUB_URL_RE)) add(m[0]);
  for (const m of text.matchAll(GITHUB_SCP_RE)) add(m[0]);
  return [...out.values()];
}
