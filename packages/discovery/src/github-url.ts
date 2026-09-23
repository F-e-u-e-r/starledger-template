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

const OWNER_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const REPO_RE = /^[a-z0-9._-]+$/;

function fromPath(rawPath: string): string | null {
  const clean = (rawPath.split(/[?#]/)[0] ?? '').replace(/[.,;:!?]+$/, '');
  const segs = clean.split('/').filter(Boolean);
  if (segs.length < 2) return null;
  const owner = (segs[0] ?? '').toLowerCase();
  const repo = (segs[1] ?? '').replace(/\.git$/i, '').toLowerCase();
  if (!owner || !repo || repo === '.' || repo === '..') return null;
  if (RESERVED_OWNERS.has(owner)) return null;
  if (!OWNER_RE.test(owner) || !REPO_RE.test(repo)) return null;
  return `${owner}/${repo}`;
}

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
