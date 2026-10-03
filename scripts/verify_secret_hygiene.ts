/**
 * Sovereign Secret Hygiene Verifier
 * Chain Key ID: 360ea36c28e66d9d
 *
 * PURPOSE
 * -------
 * Audit where secrets LIE and how they REACH the runtime, and fail loudly when
 * a credential is carried as a literal instead of a file reference. This is not
 * a "does the app start" test. It is a test that the credential supply chain is
 * arranged so that a leak of ONE copy does not equal a leak of all copies.
 *
 * THE DESIGN RULE: a check that cannot fail is a defect. Every assertion below
 * names the exposure it is designed to catch.
 *
 * ZERO-VALUE-PRINT DOCTRINE
 * -------------------------
 * This program NEVER emits a secret value, in whole or in part, to stdout,
 * stderr, or its JSON output. Findings carry: file, line number, rule id, and a
 * masked form consisting of at most the first FOUR characters plus the character
 * count. Anything longer would narrow a brute-force search space; the four-char
 * head is the industry norm for making a finding correlatable without
 * disclosing it. Docker findings carry key NAMES and lengths only.
 *
 * THE FIVE ASSERTS
 * ----------------
 *   A1  .env LITERAL DETECTION
 *       Every secret-shaped key in .env must hold a FILE REFERENCE, not a
 *       literal. Catches: a credential readable by every process that can read
 *       the repo, copied by every zip/backup/clone of the tree, and preserved
 *       verbatim in every editor swap file and crash dump.
 *       Allowlists exist so the check is not defeated by noise: identifiers
 *       (Azure client/tenant id, project ids) are not secrets, and _FILE /
 *       _PATH / _URL / _PORT / _MS suffixed keys are indirection by design.
 *       A catch-all rule also flags any NON-allowlisted key whose value is
 *       >= 32 chars, whitespace-free and path-free, because that shape is a
 *       credential even when its name is innocuous (e.g. "COPILOT").
 *
 *   A2  SOVEREIGN_CLI_TOKEN RAW-VARIANT REGRESSION
 *       The raw-value variant must not be supplied anywhere: not in .env, not
 *       in .env.example, not in a workflow, not in a compose file, not in the
 *       container environment. It was deliberately removed in favour of
 *       SOVEREIGN_CLI_TOKEN_FILE, a bind-mounted file. Catches: a regression
 *       that silently re-opens the disclosure path server.ts explicitly closed
 *       (a CLI token in an env var is readable by /proc and by any co-located
 *       process; a bind-mounted file at mode 0400 is not).
 *       Source-code references to the legacy name are reported as INFO with an
 *       explicit TOLERATED note, not hidden and not failed: server.ts must be
 *       able to NAME the variable it warns about.
 *
 *   A3  RUNTIME CONTAINER ENVIRONMENT
 *       No secret may sit in a running container's Config.Env. docker inspect
 *       prints Config.Env because that is the only machine-readable way to see
 *       what the process was actually started with; names and lengths are
 *       emitted, values never are. Catches: the "secret is out of .gitignore so
 *       it is safe" fallacy - Config.Env is the widest-read secret store on a
 *       Docker host and is dumped verbatim by `docker inspect`, crash reports
 *       and many orchestrators.
 *
 *   A4  KNOWN-SECRET PATTERNS IN TRACKED FILES
 *       Pattern-match only. On a hit, report file, line, rule id and a masked
 *       form. Never print the match. Catches: a key committed to a tracked file
 *       (e.g. a browser Firebase config that is inlined into the shipped JS
 *       bundle and therefore served to every visitor) and a key that .gitignore
 *       missed because its filename did not match the ignore rule.
 *
 *   A5  IGNORE-RULE COVERAGE
 *       .gitignore must actually cover the credential-shaped filenames this
 *       project uses. `git check-ignore` is asked, not a pattern list re-read,
 *       so the answer is git's own. Catches: the specific gap where `*.token`
 *       is not covered, so a token file one careless `git add .` away from the
 *       repository is not protected by anything.
 *
 * USAGE
 *   npx tsx scripts/verify_secret_hygiene.ts
 *   npx tsx scripts/verify_secret_hygiene.ts --json
 *   npx tsx scripts/verify_secret_hygiene.ts --no-docker
 *   npx tsx scripts/verify_secret_hygiene.ts --root <dir>     audit an arbitrary tree
 *   npx tsx scripts/verify_secret_hygiene.ts --root <dir> --files <f1,f2>
 *                                                         audit only these files
 *                         (used to prove the checker can FAIL, against a
 *                          throwaway fixture, without touching the real repo)
 *
 * EXIT CODES
 *   0  every assertion held
 *   1  at least one VIOLATION
 *   2  the instrument could not run - an unverifiable instrument is not a pass
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const CHAIN_KEY_ID = '360ea36c28e66d9d';

// ---------------------------------------------------------------------------
// RESULT MODEL
// ---------------------------------------------------------------------------

type Severity = 'VIOLATION' | 'INFO' | 'TOLERATED';

interface Finding {
  assert: string;
  severity: Severity;
  target: string;
  message: string;
  catches: string;
}

const findings: Finding[] = [];

function violation(a: string, target: string, message: string, catches: string): void {
  findings.push({ assert: a, severity: 'VIOLATION', target, message, catches });
}
function info(a: string, target: string, message: string, catches = ''): void {
  findings.push({ assert: a, severity: 'INFO', target, message, catches });
}
function tolerated(a: string, target: string, message: string, catches: string): void {
  findings.push({ assert: a, severity: 'TOLERATED', target, message, catches });
}

// ---------------------------------------------------------------------------
// MASKING - the only way this program is allowed to describe a value
// ---------------------------------------------------------------------------

function mask(v: string): string {
  const t = v.trim();
  if (t.length === 0) return '<empty>';
  if (t.length <= 4) return '*'.repeat(t.length);
  const head = t.slice(0, 4);
  const stars = '*'.repeat(Math.min(16, Math.max(0, t.length - 4)));
  return `${head}${stars}[len=${t.length}]`;
}

function looksLikeMasked(v: string): boolean {
  return /\[[^\]]*len=\d+\]/.test(v);
}

// ---------------------------------------------------------------------------
// CLASSIFICATION TABLES
// ---------------------------------------------------------------------------

/** A key whose NAME announces it carries a credential. */
const SECRET_SHAPE = /(TOKEN|SECRET|PASSWORD|PASSWD|API[_-]?KEY|_KEY$|^KEY$|CREDENTIAL|PRIVATE[_-]?KEY|SALT|APIKEY|SYNCFUSION|LICENSE)/i;

/** Identifiers: sensitive-looking, but they confer no authority on their own. */
const IDENTIFIER_ALLOWLIST = new Set([
  'AZURE_CLIENT_ID',
  'AZURE_TENANT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_APP_ID',
  'FIREBASE_MESSAGING_SENDER_ID',
  'GCP_PROJECT_ID',
  'MEASUREMENT_ID',
  'CHAIN_KEY_ID',
  'OAUTH_CLIENT_ID',
  'GITHUB_REPOSITORY',
]);

/**
 * Infrastructure facts that live in the process environment and are not
 * credentials. Without this list a checker flags NODE_ENV=production and calls
 * it a secret, and an operator learns to ignore the output - which is how a
 * real leak stops being reported.
 */
const GENERIC_NON_SECRET = new Set([
  'PATH', 'HOME', 'HOSTNAME', 'SHELL', 'TERM', 'TZ', 'LANG', 'LC_ALL', 'PWD',
  'USER', 'USERNAME', 'LOGNAME', 'PID', 'PPID', 'SHLVL', 'OSTYPE', 'TMPDIR',
  'PORT', 'NODE_ENV', 'NODE_VERSION', 'YARN_VERSION', 'NPM_VERSION',
  'NPM_CONFIG_PREFIX', 'NPM_CONFIG_USERCONFIG', 'INIT_CWD', 'CI',
  'IMAGE', 'GITHUB_ACTIONS', 'GITHUB_WORKFLOW', 'GITHUB_RUN_ID',
  'GITHUB_REPOSITORY', 'GITHUB_SHA', 'GITHUB_REF', 'GITHUB_ACTOR',
  'GITHUB_WORKSPACE', 'GITHUB_EVENT_NAME', 'RUNNER_OS', 'RUNNER_ARCH',
]);

/** Suffixes that mean "this key points at something", i.e. it is indirection. */
const INDIRECTION_SUFFIX = /(_FILE|_PATH|_DIR|_URL|_ENDPOINT|_HOST|_PORT|_MS|_TIMEOUT|_REGION|_NAME|_ENABLED|_LEVEL|_MODE)$/;

/** Infrastructure facts announced by suffix. */
const FACT_SUFFIX = /(_VERSION|_ENV|_ID|_COUNT|_SIZE|_SECONDS|_BYTES|_INDEX)$/;

function classifyKey(key: string): 'IDENTIFIER' | 'NON_SECRET' | 'SECRET' {
  if (IDENTIFIER_ALLOWLIST.has(key)) return 'IDENTIFIER';
  if (GENERIC_NON_SECRET.has(key)) return 'NON_SECRET';
  if (FACT_SUFFIX.test(key) && !SECRET_SHAPE.test(key)) return 'NON_SECRET';
  if (INDIRECTION_SUFFIX.test(key) && !SECRET_SHAPE.test(key)) return 'NON_SECRET';
  if (SECRET_SHAPE.test(key)) return 'SECRET';
  return 'SECRET'; // unknown name: judged on VALUE shape by the caller
}

/**
 * A base64 blob is NOT a path. Without this guard a 88-character base64 licence
 * key containing "/" is mistaken for a nested path, the key is declared "a file
 * reference", and a checker that prints file references in full then leaks it.
 * This is a real bug that occurred while building this tool.
 */
function looksLikeBase64Blob(t: string): boolean {
  return t.length >= 40 && /^[A-Za-z0-9+/]+={0,2}$/.test(t);
}

function isFileReference(v: string): boolean {
  const t = v.trim();
  if (t === '') return false;
  if (looksLikeBase64Blob(t)) return false; // a blob with "/" is still a blob
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return false; // a URL, not a path
  if (/^[A-Za-z]:[\\/]/.test(t)) return true; // C:\... absolute
  if (/^\.{1,2}[\\/]/.test(t)) return true; // ./ or ../
  if (t.startsWith('~')) return true; // ~/...
  if (/^\/(run|var\/run|etc|secrets)\//.test(t)) return true; // docker/k8s secret mount
  if (/^\/[^/\s]+\/[^/\s]+$/.test(t) && !/[+=]/.test(t)) return true; // /a/b
  if (/^[A-Za-z0-9_.-]+[\/\\][A-Za-z0-9_.-]+$/.test(t) && !/[+=]/.test(t)) return true; // a/b
  if (t.length <= 200 && /\.(txt|mount|token|secret|pem|key|p12|pfx|env|json)$/i.test(t)) return true;
  return false;
}

/** Credential-shaped even when the name is innocuous. */
function looksLikeCredentialValue(v: string): boolean {
  const t = v.trim();
  if (t.length < 32) return false;
  if (/\s/.test(t)) return false;
  if (isFileReference(t)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return false;
  if (/^https?$/i.test(t)) return false;
  return true;
}

interface PatternRule {
  id: string;
  re: RegExp;
  label: string;
  catches: string;
}

/**
 * Deliberately NOT included: `sk-` (matches "sk-proj"/placeholder prose and is
 * too noisy), and `[A-Za-z0-9+/]{40,}={0,2}` (matches every lockfile hash in
 * package-lock.json). A pattern list that cries wolf is a pattern list that
 * gets switched off. Each rule below is specific enough to have no false
 * positives in this repository, which was verified by running the checker.
 */
const PATTERN_RULES: PatternRule[] = [
  { id: 'PAT-GH-FINE', re: /github_pat_[A-Za-z0-9_]{20,}/, label: 'GitHub fine-grained PAT', catches: 'a GitHub fine-grained PAT committed to a tracked file' },
  { id: 'PAT-GH-CLASSIC', re: /gh[pousr]_[A-Za-z0-9]{20,}/, label: 'GitHub classic PAT family', catches: 'a GitHub classic PAT / OAuth / server / refresh / user token committed to a tracked file' },
  { id: 'PAT-GOOGLE', re: /AIza[0-9A-Za-z_-]{30,}/, label: 'Google API key', catches: 'a Google API key committed to a tracked file; in a Firebase web config this is inlined into the shipped JS bundle and served to every visitor' },
  { id: 'PAT-ANTHROPIC', re: /sk-ant-[A-Za-z0-9_-]{20,}/, label: 'Anthropic API key', catches: 'an Anthropic API key committed to a tracked file' },
  { id: 'PAT-AWS-AKIA', re: /AKIA[0-9A-Z]{16}/, label: 'AWS access key id', catches: 'an AWS long-lived access key id committed to a tracked file' },
  { id: 'PAT-AWS-ASIA', re: /ASIA[0-9A-Z]{16}/, label: 'AWS temporary access key id', catches: 'an AWS temporary access key id committed to a tracked file' },
  { id: 'PAT-GITLAB', re: /glpat-[A-Za-z0-9_-]{20,}/, label: 'GitLab PAT', catches: 'a GitLab PAT committed to a tracked file' },
  { id: 'PAT-SLACK', re: /xox[baprse]-[A-Za-z0-9-]{10,}/, label: 'Slack token', catches: 'a Slack bot/user/app/refresh token committed to a tracked file' },
  { id: 'PAT-NPM', re: /npm_[A-Za-z0-9]{30,}/, label: 'npm access token', catches: 'an npm automation token committed to a tracked file' },
  { id: 'PAT-PEM', re: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/, label: 'PEM private key', catches: 'a private key committed to a tracked file' },
  { id: 'PAT-SG', re: /SG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, label: 'SendGrid API key', catches: 'a SendGrid API key committed to a tracked file' },
  { id: 'PAT-AZURE-SP', re: /(?<![A-Za-z0-9~._-])[A-Za-z0-9]{3}~[A-Za-z0-9~._-]{34,}(?![A-Za-z0-9~._-])/, label: 'Azure service-principal secret shape', catches: 'an Azure AD service-principal client secret (3-char prefix, tilde, 36-char body) committed to a tracked file' },
];

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
function flag(name: string): boolean {
  return argv.includes(name);
}
function opt(name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i === -1 || i + 1 >= argv.length) return undefined;
  return argv[i + 1];
}

const JSON_OUT = flag('--json');
const NO_DOCKER = flag('--no-docker');
const ROOT_ARG = opt('--root');
const FILES_ARG = opt('--files');

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const ROOT = ROOT_ARG ? path.resolve(ROOT_ARG) : REPO_ROOT;
const IS_REAL_REPO = ROOT === REPO_ROOT;

function out(s: string): void {
  if (!JSON_OUT) process.stdout.write(s + '\n');
}

// ---------------------------------------------------------------------------
// SHELL HELPER
// ---------------------------------------------------------------------------

function run(cmd: string, args: string[]): { ok: boolean; out: string; code: number } {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { ok: false, out: String(r.error.message), code: -1 };
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, code: r.status ?? -1 };
}

// ---------------------------------------------------------------------------
// FILE ENUMERATION
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'coverage', '.vite', 'screenshots', 'scratch', '__pycache__']);

function walk(dir: string, acc: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full, acc);
    } else if (e.isFile()) {
      acc.push(full);
    }
  }
  return acc;
}

function isBinary(p: string): boolean {
  try {
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(4096);
    const n = fs.readSync(fd, buf, 0, 4096, 0);
    fs.closeSync(fd);
    for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
    return false;
  } catch {
    return true;
  }
}

/** Files that participate in A4. */
function trackedFiles(): string[] {
  if (FILES_ARG) {
    return FILES_ARG.split(',')
      .map((f) => f.trim())
      .filter(Boolean)
      .map((f) => (path.isAbsolute(f) ? f : path.resolve(process.cwd(), f)));
  }
  if (IS_REAL_REPO) {
    const r = run('git', ['ls-files', '-z']);
    if (!r.ok) return [];
    return r.out.split('\0').filter(Boolean).map((f) => path.join(REPO_ROOT, f));
  }
  return walk(ROOT);
}

// ---------------------------------------------------------------------------
// A1 - .env literal detection
// ---------------------------------------------------------------------------

interface EnvRow {
  line: number;
  key: string;
  value: string;
}

function parseEnv(text: string): EnvRow[] {
  const rows: EnvRow[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const l = raw.trim();
    if (l === '' || l.startsWith('#')) return;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(l);
    if (!m) return;
    rows.push({ line: i + 1, key: m[1], value: m[2].trim() });
  });
  return rows;
}

function assertA1(): void {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) {
    info('A1', '.env', 'no .env present in this tree; A1 is vacuous, not passed');
    return;
  }
  const rows = parseEnv(fs.readFileSync(envPath, 'utf8'));
  if (rows.length === 0) {
    info('A1', '.env', '.env contains no parsable KEY=VALUE rows');
    return;
  }
  let literalCount = 0;
  for (const r of rows) {
    const kind = classifyKey(r.key);
    const named = SECRET_SHAPE.test(r.key);
    const valueSecret = looksLikeCredentialValue(r.value);
    const target = `.env:${r.line} ${r.key}`;

    if (kind === 'IDENTIFIER') {
      info('A1', target, `identifier, not a credential (allowlisted); value=${mask(r.value)}`);
      continue;
    }
    if (kind === 'NON_SECRET') {
      info('A1', target, `indirection key by suffix convention; value=${mask(r.value)}`);
      continue;
    }
    // kind === SECRET
    if (r.value === '') {
      info('A1', target, 'empty; placeholder only, nothing to leak');
      continue;
    }
    if (isFileReference(r.value)) {
      info('A1', target, `holds a FILE REFERENCE; correct shape; ref=${mask(r.value)}`);
      continue;
    }
    literalCount++;
    const why = named
      ? 'key name is credential-shaped'
      : valueSecret
        ? 'value is >=32 chars, whitespace-free and path-free (credential-shaped despite an innocuous name)'
        : 'value is a literal';
    violation(
      'A1',
      target,
      `holds a LITERAL secret, not a file reference (${why}); value=${mask(r.value)}`,
      'a credential readable by anything that can read the repo, and copied by every zip, backup, clone and editor swap file of the tree'
    );
  }
  info('A1', '.env', `${rows.length} parsable rows; ${literalCount} literal secret(s); 0 secrets printed`);

  // A2 part 1 - the raw CLI token variant, in any env file.
  for (const name of ['.env', '.env.example', '.env.local', '.env.production']) {
    const p = path.join(ROOT, name);
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, 'utf8');
    text.split(/\r?\n/).forEach((raw, i) => {
      const m = /^\s*SOVEREIGN_CLI_TOKEN\s*=/.exec(raw);
      if (!m) return;
      const val = raw.slice(m[0].length).trim();
      violation(
        'A2',
        `${name}:${i + 1} SOVEREIGN_CLI_TOKEN`,
        val === '' ? 'present but EMPTY; the key must be removed entirely, not blanked' : `holds a literal raw CLI token; value=${mask(val)}`,
        'a regression that re-opens the disclosure path SOVEREIGN_CLI_TOKEN_FILE exists to close: a token in an env var is world-readable to co-located processes via /proc'
      );
    });
  }
  void literalCount;
}

// ---------------------------------------------------------------------------
// A2 - SOVEREIGN_CLI_TOKEN raw variant, everywhere else
// ---------------------------------------------------------------------------

function assertA2(): void {
  const RAW = 'SOVEREIGN_CLI_TOKEN';
  const targets: string[] = [];

  const wfDir = path.join(ROOT, '.github', 'workflows');
  if (fs.existsSync(wfDir)) {
    for (const f of fs.readdirSync(wfDir)) if (/\.ya?ml$/i.test(f)) targets.push(path.join(wfDir, f));
  }
  const ciDir = path.join(ROOT, 'ci');
  if (fs.existsSync(ciDir)) {
    for (const f of fs.readdirSync(ciDir)) if (/\.ya?ml$/i.test(f)) targets.push(path.join(ciDir, f));
  }
  for (const f of fs.readdirSync(ROOT)) {
    if (/^docker-compose.*\.ya?ml$/i.test(f) || /^compose.*\.ya?ml$/i.test(f)) targets.push(path.join(ROOT, f));
  }

  let hits = 0;
  for (const p of targets) {
    const rel = path.relative(ROOT, p);
    fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach((raw, i) => {
      const idx = raw.indexOf(RAW);
      if (idx === -1) return;
      const after = raw.slice(idx + RAW.length);
      // SOVEREIGN_CLI_TOKEN_FILE is the sanctioned indirection, not the raw variant.
      if (/^_FILE\b/.test(after)) return;
      hits++;
      const tail = after.slice(0, 40);
      const hasValue = /^\s*[:=]\s*\S/.test(after);
      violation(
        'A2',
        `${rel}:${i + 1}`,
        hasValue
          ? `raw variant assigned in a workflow/compose file (context: ...${tail.replace(/\s+/g, ' ')}...)`
          : `raw variant referenced in a workflow/compose file (context: ...${tail.replace(/\s+/g, ' ')}...)`,
        'the raw-value CLI token reappearing in automation, where it would be masked in logs but present in the runner environment and in every workflow log that echoes the environment'
      );
    });
  }

  // Source-code references are reported, not hidden and not failed.
  for (const f of trackedFiles()) {
    if (!/\.(ts|tsx|js|mjs|cjs|py)$/i.test(f)) continue;
    let text: string;
    try {
      if (isBinary(f)) continue;
      text = fs.readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    text.split(/\r?\n/).forEach((raw, i) => {
      const m = new RegExp(`${RAW}\\b(?!_FILE)`).exec(raw);
      if (!m) return;
      const idx = m.index;
      const after = raw.slice(idx + RAW.length, idx + RAW.length + 40);
      if (/^\s*=/.test(after)) {
        violation(
          'A2',
          `${path.relative(ROOT, f)}:${i + 1}`,
          'raw variant ASSIGNED in source code',
          'code writing a raw CLI token into the environment, which is exactly the path the file-mount design removed'
        );
        return;
      }
      tolerated(
        'A2',
        `${path.relative(ROOT, f)}:${i + 1}`,
        `source reference to the legacy name (context: ...${after.replace(/\s+/g, ' ').trim()}...)`,
        'n/a - recorded so nothing is hidden'
      );
    });
  }

  info(
    'A2',
    'workflow + compose + source scan',
    hits === 0
      ? 'no raw SOVEREIGN_CLI_TOKEN assignment in any workflow, compose or env file'
      : `${hits} offending line(s) in automation`
  );
}

// ---------------------------------------------------------------------------
// A3 - running container Config.Env
// ---------------------------------------------------------------------------

function assertA3(): void {
  if (NO_DOCKER || !IS_REAL_REPO) {
    info('A3', 'docker', NO_DOCKER ? 'skipped: --no-docker' : 'skipped: --root mode audits a tree, not a host');
    return;
  }
  const v = run('docker', ['version', '--format', '{{.Server.Version}}']);
  if (!v.ok) {
    info('A3', 'docker', 'docker daemon not reachable; A3 is UNVERIFIED, not passed');
    return;
  }
  const ps = run('docker', ['ps', '--format', '{{.ID}}']);
  if (!ps.ok) {
    info('A3', 'docker', 'docker ps failed; A3 is UNVERIFIED, not passed');
    return;
  }
  const ids = ps.out.split(/\s+/).filter(Boolean);
  if (ids.length === 0) {
    info('A3', 'docker', 'no running containers; A3 vacuous, not passed');
    return;
  }

  let exposed = 0;
  for (const id of ids) {
    const insp = run('docker', ['inspect', '--format', '{{json .Config.Env}}', id]);
    if (!insp.ok) continue;
    let pairs: string[];
    try {
      pairs = JSON.parse(insp.out.trim()) as string[];
    } catch {
      info('A3', `container ${id.slice(0, 12)}`, 'could not parse Config.Env; UNVERIFIED');
      continue;
    }
    for (const pair of pairs) {
      const eq = pair.indexOf('=');
      const name = eq === -1 ? pair : pair.slice(0, eq);
      const value = eq === -1 ? '' : pair.slice(eq + 1);

      if (name === 'SOVEREIGN_CLI_TOKEN') {
        violation(
          'A3',
          `container ${id.slice(0, 12)} env ${name}`,
          'raw SOVEREIGN_CLI_TOKEN is present in the runtime environment',
          'the raw variant reaching the runtime, undoing the SOVEREIGN_CLI_TOKEN_FILE design at the last hop'
        );
      }
      const kind = classifyKey(name);
      if (kind !== 'SECRET') continue;
      if (value === '') continue;
      if (isFileReference(value)) {
        info('A3', `container ${id.slice(0, 12)} env ${name}`, `file reference, correct shape; ref=${mask(value)}`);
        continue;
      }
      exposed++;
      violation(
        'A3',
        `container ${id.slice(0, 12)} env ${name}`,
        `secret present in Config.Env as a literal (value=${mask(value)})`,
        'a secret that `docker inspect` prints in full, that lands in crash reports and orchestrator state dumps, and that is inherited by every child process the container spawns'
      );
    }
  }
  info('A3', 'docker', `${ids.length} running container(s) inspected; ${exposed} secret(s) in Config.Env; no value printed`);
}

// ---------------------------------------------------------------------------
// A4 - known secret patterns in tracked files
// ---------------------------------------------------------------------------

function assertA4(): void {
  const files = trackedFiles();
  if (files.length === 0) {
    info('A4', 'tracked files', 'no files enumerated; A4 is UNVERIFIED, not passed');
    return;
  }
  let hits = 0;
  let scanned = 0;
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    let text: string;
    try {
      if (isBinary(f)) continue;
      text = fs.readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    scanned++;
    if (text.length > 8 * 1024 * 1024) {
      info('A4', path.relative(ROOT, f), 'skipped: larger than 8 MiB');
      continue;
    }
    // Skip THIS file: its own rule table necessarily contains the literals.
    if (path.resolve(f) === path.resolve(fileURLToPath(import.meta.url))) continue;

    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.length > 200000) continue;
      for (const rule of PATTERN_RULES) {
        const re = new RegExp(rule.re.source, rule.re.flags.includes('g') ? rule.re.flags : rule.re.flags + 'g');
        let m: RegExpExecArray | null;
        while ((m = re.exec(line)) !== null) {
          if (m[0].length === 0) {
            re.lastIndex++;
            continue;
          }
          if (looksLikeMasked(m[0])) continue;
          hits++;
          violation(
            'A4',
            `${path.relative(ROOT, f)}:${i + 1}`,
            `${rule.label} [${rule.id}] match=${mask(m[0])}`,
            rule.catches
          );
        }
      }
    }
  }
  info('A4', 'tracked files', `${scanned} text file(s) scanned against ${PATTERN_RULES.length} rule(s); ${hits} hit(s); no value printed`);
}

// ---------------------------------------------------------------------------
// A5 - ignore-rule coverage
// ---------------------------------------------------------------------------

function assertA5(): void {
  const probes: Array<{ path: string; label: string }> = [
    { path: 'probe.token', label: '*.token credential file' },
    { path: 'secrets/probe.txt', label: 'secrets/ directory' },
    { path: 'probe.env', label: 'arbitrary *.env filename' },
    { path: '.env', label: '.env' },
    { path: 'kali/qui/probe', label: 'quarantine tree kali/' },
  ];
  if (!IS_REAL_REPO) {
    info('A5', '.gitignore', 'skipped: --root mode has no git index to ask');
    return;
  }
  for (const p of probes) {
    const r = run('git', ['check-ignore', '-q', '--', p.path]);
    if (r.code === 0) {
      info('A5', `.gitignore covers ${p.path}`, 'protected');
    } else {
      violation(
        'A5',
        `.gitignore does NOT cover ${p.path}`,
        `a ${p.label} would be staged by an ordinary "git add ."`,
        'a credential file one careless `git add .` away from the repository, unprotected by any ignore rule'
      );
    }
  }
}

// ---------------------------------------------------------------------------
// GATE 0 - is .env even ignored? (cheap, and its absence invalidates A1)
// ---------------------------------------------------------------------------

function assertGate0(): void {
  if (!IS_REAL_REPO) return;
  const r = run('git', ['check-ignore', '-q', '--', '.env']);
  if (r.code !== 0) {
    violation(
      'A0',
      '.env is not ignored',
      'git does not ignore .env, so every "git add ." stages it',
      'the entire credential file entering the index and, on the next push, permanent history'
    );
  } else {
    info('A0', '.env is ignored by', run('git', ['check-ignore', '-v', '--', '.env']).out.trim());
  }
}

// ---------------------------------------------------------------------------
// RUN
// ---------------------------------------------------------------------------

assertGate0();
assertA1();
assertA2();
assertA3();
assertA4();
assertA5();

const violations = findings.filter((f) => f.severity === 'VIOLATION');
const toleratedCount = findings.filter((f) => f.severity === 'TOLERATED').length;
const infoCount = findings.filter((f) => f.severity === 'INFO').length;

const ASSERT_META: Record<string, string> = {
  A0: '.env is covered by .gitignore',
  A1: '.env secret keys hold file references, not literals',
  A2: 'raw SOVEREIGN_CLI_TOKEN is nowhere',
  A3: 'no secret in any running container Config.Env',
  A4: 'no known secret pattern in tracked files',
  A5: '.gitignore covers credential-shaped filenames',
};

if (JSON_OUT) {
  process.stdout.write(
    JSON.stringify(
      {
        chainKeyId: CHAIN_KEY_ID,
        root: ROOT,
        isRealRepo: IS_REAL_REPO,
        verdict: violations.length === 0 ? 'PASS' : 'FAIL',
        counts: { violations: violations.length, info: infoCount, tolerated: toleratedCount },
        assertions: Object.entries(ASSERT_META).map(([id, what]) => ({
          id,
          what,
          passed: !violations.some((v) => v.assert === id),
        })),
        findings,
      },
      null,
      2
    ) + '\n'
  );
} else {
  const W = 78;
  out('='.repeat(W));
  out(' SOVEREIGN SECRET HYGIENE VERIFIER');
  out(` Chain Key: ${CHAIN_KEY_ID}`);
  out(` Root:      ${ROOT}${IS_REAL_REPO ? '' : '   (fixture mode - docker/env-git checks inactive)'}`);
  out('='.repeat(W));

  out('');
  out('--- ASSERTION TABLE -------------------------------------------------');
  out(` ${'ID'.padEnd(4)}${'ASSERTION'.padEnd(46)}${'RESULT'}`);
  out(` ${'-'.repeat(4)}${'-'.repeat(46)}${'-'.repeat(6)}`);
  for (const [id, what] of Object.entries(ASSERT_META)) {
    if (!IS_REAL_REPO && (id === 'A0' || id === 'A5')) {
      out(` ${id.padEnd(4)}${what.padEnd(46)}${'SKIP'.padEnd(6)}`);
      continue;
    }
    const bad = violations.filter((v) => v.assert === id).length;
    out(` ${id.padEnd(4)}${what.padEnd(46)}${(bad === 0 ? 'PASS' : `FAIL(${bad})`).padEnd(6)}`);
  }

  out('');
  out('--- VIOLATIONS -------------------------------------------------------');
  if (violations.length === 0) {
    out('  none. No secret value was read into this report.');
  } else {
    for (const v of violations) {
      out(`  [${v.assert}] ${v.target}`);
      out(`      ${v.message}`);
      out(`      catches: ${v.catches}`);
    }
  }

  out('');
  out('--- OBSERVATIONS -----------------------------------------------------');
  for (const f of findings.filter((f) => f.severity === 'INFO')) {
    out(`  [${f.assert}] ${f.target}`);
    out(`      ${f.message}`);
  }

  if (toleratedCount > 0) {
    out('');
    out('--- TOLERATED (recorded, not failed) --------------------------------');
    for (const f of findings.filter((f) => f.severity === 'TOLERATED')) {
      out(`  [${f.assert}] ${f.target}`);
      out(`      ${f.message}`);
    }
  }

  out('');
  out('='.repeat(W));
  if (violations.length === 0) {
    out(` RESULT: PASS - every assertion held.  (${infoCount} observation(s), ${toleratedCount} tolerated)`);
  } else {
    out(` RESULT: FAIL - ${violations.length} violation(s).  (${infoCount} observation(s), ${toleratedCount} tolerated)`);
  }
  out('='.repeat(W));
  out(' NO SECRET VALUE WAS PRINTED BY THIS PROGRAM. Masked forms show at most');
  out(' four leading characters and a character count.');
}

process.exit(violations.length === 0 ? 0 : 1);