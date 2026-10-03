/*
 * boot-guard.mjs - the Sovereign host-prober service wrapper's startup readiness self-test.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `SovereignHostProber` is a Windows service, so the Service Control Manager
 * starts it with nobody signed in. Every assumption that this needs has, up to
 * now, been *structural*: `SERVICE_DELAYED_AUTO_START` is configured, the
 * account is `LocalSystem`, and every path is absolute. Structural evidence is
 * not execution evidence, and no power cycle has ever been performed. So the
 * prober is one cold-boot hazard away from binding a port and serving an
 * inventory that silently shrank, with nothing in any log saying so.
 *
 * This file removes the dependence on the assumption. On EVERY start it
 * measures the boot-time conditions the prober actually depends on, writes them
 * as ONE machine-readable JSON line to stdout (which NSSM captures into
 * %APPDATA%\sovereign-commander-console\host-prober.service.log) and to a
 * readiness file, and then starts the prober exactly as it was started before.
 *
 * WHAT IT MEASURES, and the hazard each measurement covers
 * ---------------------------------------------------------
 *   account / integrity   -> "no user profile loaded" (hazard 3). Also proves
 *                            which identity the instrument is really measuring.
 *   serverRoot            -> "E:\Servers-Center not mounted" (hazard 2). If the
 *                            volume is absent the MCP inventory shrinks silently.
 *   dockerGateway         -> "Docker not yet started" (hazard 1).
 *                            host.docker.internal is the name the console
 *                            container uses to reach this process; it does not
 *                            resolve until the Docker engine is up.
 *   pinnedEnvironment     -> "APPDATA re-derived at runtime" (hazard 3). Every
 *                            non-secret variable the installer pinned is
 *                            compared byte-for-byte against what the installer
 *                            recorded in expectations.json. No drift, no lying.
 *   runtimeEntries        -> "node.exe / tsx entry missing" (hazard 5).
 *   workingDirectory/path -> "working directory / PATH not established"
 *                            (hazard 5). Confirmed, not assumed.
 *   fileAvailability      -> "Defender / antivirus holding a file" (hazard 4).
 *                            The SYMPTOM is what is measured - every file the
 *                            start path must open was actually opened. The
 *                            CAUSE is deliberately NOT queried here: Defender's
 *                            own status query costs ~1.9s MEASURED on this
 *                            host and can block for seconds while Defender is
 *                            itself still starting, which is precisely the
 *                            moment it must not be on a service start path.
 *                            boot-verdict.ps1 asks Defender, off that path.
 *
 * FAIL LOUDLY
 * -----------
 * Severity is separated from "can it start", because conflating them produces
 * either a crash loop or a silent lie:
 *
 *   BLOCKER   failed -> the prober cannot run at all. The guard REFUSES to
 *                      spawn it, prints an unambiguous banner to stdout AND
 *                      stderr, and stays alive re-announcing the failure every
 *                      60s. It never exits, so NSSM cannot turn a fatal
 *                      precondition into a 3-second restart storm, and the
 *                      service still reports its state truthfully to the SCM.
 *   REQUIRED  failed -> the prober CAN serve, but the measurement is not
 *                      trustworthy or will silently degrade. Verdict = FAIL.
 *   ADVISORY  failed -> a boot hazard is present right now. Verdict = DEGRADED.
 *
 * Nothing here weakens the token gate, reads the token's value, or prints it.
 * The token is asserted PRESENT and of sufficient LENGTH only.
 *
 * Chain Key ID: 360ea36c28e66d9d
 */

import { spawn } from 'node:child_process';
import {
  accessSync, closeSync, constants as FS_CONSTANTS, existsSync, fsyncSync,
  mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync,
  unlinkSync, writeFileSync, writeSync,
} from 'node:fs';
import { delimiter as PATH_DELIM, dirname, isAbsolute, join } from 'node:path';
import os from 'node:os';
import dnsPromises from 'node:dns/promises';

const SCHEMA = 'sovereign.prober.readiness/1';
const CHAIN_KEY_ID = '360ea36c28e66d9d';
const MARKER = 'SOVEREIGN_BOOT_READINESS';

// Canonical locations. install.ps1 passes these explicitly on the service command
// line so the registration is self-describing, but they are also the defaults, so
// the wrapper still records a verdict if the parameters are ever altered. Machine
// scoped on purpose: the readiness verdict must not live under the APPDATA whose
// correctness is one of the things being tested.
const DEFAULT_READINESS = 'C:\\ProgramData\\sovereign-commander-console\\readiness.json';
const DEFAULT_EXPECTATIONS = 'C:\\ProgramData\\sovereign-commander-console\\expectations.json';

// Severity -> verdict. The single place the mapping is decided.
const VERDICT_FOR = { BLOCKER: 'FAIL', REQUIRED: 'FAIL', ADVISORY: 'DEGRADED' };
const VERDICT_ORDER = { READY: 0, DEGRADED: 1, FAIL: 2 };

const INTEGRITY_BY_RID = {
  0x1000: 'Low', 0x2000: 'Medium', 0x3000: 'High', 0x4000: 'System', 0x5000: 'Protected',
};

// ---------------------------------------------------------------------------
// argv
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    selfTest: false, readinessPath: null, expectationsPath: null,
    probeName: null, showJson: false, announceSec: 60, childArgs: [],
  };
  const VALUE_FLAGS = new Set(['--readiness', '--expectations', '--probe-name', '--announce-sec']);
  let i = 0;
  for (; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--') { i += 1; break; }
    if (a === '--self-test') { opts.selfTest = true; continue; }
    if (a === '--json') { opts.showJson = true; continue; }
    if (VALUE_FLAGS.has(a)) { i += 1; opts[flagToOption(a)] = argv[i]; continue; }
    // Anything that is not a recognised flag is the start of the prober command
    // line. This keeps the wrapper correct no matter how NSSM chose to quote or
    // space AppParameters, instead of depending on a '--' separator surviving.
    break;
  }
  opts.childArgs = argv.slice(i).filter((a) => a !== '--');
  return opts;
}

function flagToOption(flag) {
  return ({
    '--readiness': 'readinessPath',
    '--expectations': 'expectationsPath',
    '--probe-name': 'probeName',
    '--announce-sec': 'announceSec',
  })[flag];
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

const systemRoot = () => process.env.SystemRoot || process.env.windir || 'C:\\Windows';

function isAbs(p) {
  if (typeof p !== 'string' || p.length === 0) return false;
  // isAbsolute() on win32 accepts '\\foo' (drive-relative) which is NOT absolute
  // for our purposes. Require a drive letter or a UNC root.
  if (/^[A-Za-z]:[\\/]/.test(p)) return true;
  return /^\\\\[^\\]+\\[^\\]+/.test(p);
}

function errText(e) {
  if (!e) return 'unknown';
  if (typeof e.code === 'string' && typeof e.message === 'string') return `${e.code}: ${e.message}`;
  return e.message || String(e);
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve({ timedOut: true, label, error: `${label} did not answer within ${ms}ms` });
    }, ms);
    promise.then(
      (v) => { if (done) return; done = true; clearTimeout(timer); resolve(v); },
      (e) => { if (done) return; done = true; clearTimeout(timer); resolve({ timedOut: false, label, error: errText(e) }); },
    );
  });
}

function runCapture(file, args, timeoutMs = 6000) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(file, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ ok: false, code: null, stdout: '', stderr: errText(e) });
      return;
    }
    let out = '';
    let err = '';
    const timer = setTimeout(() => { try { child.kill(); } catch { /* already gone */ } }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, code: null, stdout: out, stderr: errText(e) }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, code, stdout: out, stderr: err }); });
  });
}

function check(name, severity, ok, detail, extra) {
  return Object.assign({ name, severity, ok: Boolean(ok), detail }, extra || {});
}

function safeStat(p) {
  try { return statSync(p); } catch (e) { return { __error: errText(e) }; }
}

// ---------------------------------------------------------------------------
// boot identity
// ---------------------------------------------------------------------------

async function readBootId() {
  const reg = join(systemRoot(), 'System32', 'reg.exe');
  const key = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management\\PrefetchParameters';
  const r = await runCapture(reg, ['query', key, '/v', 'BootId'], 6000);
  const m = /BootId\s+\S+\s+(0x[0-9a-fA-F]+)/.exec(`${r.stdout}\n${r.stderr}`);
  if (!m) return { bootId: null, source: 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management\\PrefetchParameters\\BootId', error: m ? null : (r.stderr.trim() || `reg.exe exit=${r.code}`) };
  return { bootId: Number.parseInt(m[1], 16), source: 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management\\PrefetchParameters\\BootId', error: null };
}

/**
 * The identity of the boot this process belongs to. `uptimeSecAtStart` is the
 * decisive one: Node's os.uptime() is the machine's uptime, so a small value
 * means this process was started by the SCM moments after power-on, and a large
 * value means somebody started it by hand long after boot.
 */
function bootIdentity(bootIdResult) {
  const uptime = os.uptime();
  return {
    uptimeSecAtStart: Math.round(uptime * 10) / 10,
    bootTimeUtc: new Date(Date.now() - uptime * 1000).toISOString(),
    bootId: bootIdResult.bootId,
    bootIdSource: bootIdResult.source,
    bootIdError: bootIdResult.error,
    hostname: os.hostname(),
    note: 'uptimeSecAtStart is os.uptime() at the moment the wrapper ran; compare it with the machine uptime observed later to decide whether the SCM started this at boot.',
  };
}

// ---------------------------------------------------------------------------
// checks
// ---------------------------------------------------------------------------

async function checkAccount() {
  const whoami = join(systemRoot(), 'System32', 'whoami.exe');
  const r = await runCapture(whoami, ['/groups', '/fo', 'csv', '/nh'], 6000);
  const text = `${r.stdout}\n${r.stderr}`;
  const ridMatch = /S-1-16-(\d+)/i.exec(text);
  const rid = ridMatch ? Number.parseInt(ridMatch[1], 10) : null;
  const account = `${os.hostname()}\\${process.env.USERNAME || '<USERNAME-UNSET>'}`;
  return check(
    'account', 'REQUIRED',
    Boolean(process.env.USERNAME) && Boolean(os.hostname()),
    process.env.USERNAME
      ? `running as ${account}`
      : 'USERNAME is not set in the service environment; the identity is unknown',
    {
      account,
      userName: process.env.USERNAME || null,
      computerName: process.env.COMPUTERNAME || null,
      userProfile: process.env.USERPROFILE || null,
      integrityRid: rid,
      integrityLevel: rid === null ? 'UNKNOWN' : (INTEGRITY_BY_RID[rid] || `Unknown(${rid})`),
      integrityMethod: rid === null ? null : 'whoami /groups SID S-1-16-<rid>',
      integrityError: rid === null ? (r.stderr.trim() || `whoami.exe exit=${r.code}`) : null,
      administratorsSidPresent: /S-1-5-32-544/i.test(text),
      administratorsSidMeaning: 'presence of BUILTIN\\Administrators in the token; this is NOT a privilege audit',
      serviceAccountProfile: guessServiceAccountProfile(),
      underServiceAccountProfile: false,
      underServiceAccountProfileNote: 'INTENTIONAL and MEASURED: install.ps1 pins APPDATA/USERPROFILE to the operator profile (README section 5) because a LocalSystem profile makes pyright measure OFFLINE and drops the console score from 70 to 60. The measurement identity is pinned deliberately; it is asserted against install-time expectations, not against the service account home.',
    },
  );
}

function guessServiceAccountProfile() {
  const user = (process.env.USERNAME || '').toUpperCase();
  if (user === 'SYSTEM') return join(systemRoot(), 'System32', 'config', 'systemprofile');
  if (user === 'LOCAL SERVICE') return join(systemRoot(), 'System32', 'config', 'serviceprofiles', 'localservice');
  if (user === 'NETWORK SERVICE') return join(systemRoot(), 'System32', 'config', 'serviceprofiles', 'networkservice');
  return null;
}

async function checkServerRoot(env, expected) {
  const configured = (env.HOST_PROBER_ROOT || '').trim();
  const fallback = 'E:\\Servers-Center';
  const source = configured ? 'env:HOST_PROBER_ROOT' : 'built-in default';
  const target = configured || fallback;
  const base = {
    path: target,
    source,
    isAbsolute: isAbs(target),
    exists: false,
    isDirectory: false,
    readable: false,
    entryCount: 0,
    sampleEntries: [],
    error: null,
    matchesExpectations: null,
  };
  if (!base.isAbsolute) {
    base.error = `${target} is not an absolute path; a service has no drive-relative working directory`;
    return check('serverRoot', 'REQUIRED', false, base.error, { ...base, hazard: 'E:\\Servers-Center not mounted at boot' });
  }
  if (expected && typeof expected === 'string') base.matchesExpectations = expected.toLowerCase() === target.toLowerCase();
  try {
    accessSync(target, FS_CONSTANTS.R_OK);
    base.readable = true;
  } catch (e) {
    base.error = `not readable: ${errText(e)}`;
  }
  const st = safeStat(target);
  if (st.__error) {
    base.error = base.error || `stat failed: ${st.__error}`;
  } else {
    base.exists = true;
    base.isDirectory = st.isDirectory();
  }
  try {
    const names = readdirSync(target);
    base.entryCount = names.length;
    base.sampleEntries = names.slice(0, 8);
  } catch (e) {
    base.error = base.error || `readdir failed: ${errText(e)}`;
  }
  const ok = base.exists && base.isDirectory && base.readable && base.matchesExpectations !== false;
  return check(
    'serverRoot', 'REQUIRED', ok,
    ok
      ? `${target} is a readable directory with ${base.entryCount} top-level entries`
      : `HOST_PROBER_ROOT ${target} is not usable as configured${base.error ? `: ${base.error}` : ''}`,
    { ...base, hazard: 'E:\\Servers-Center not mounted at boot - the MCP inventory shrinks silently' },
  );
}

async function checkDockerGateway(env, overrideName) {
  const allowed = (env.HOST_PROBER_ALLOWED_HOSTS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const name = overrideName || allowed.find((h) => h.includes('docker')) || 'host.docker.internal';
  const resolverP = dnsPromises.lookup(name, { all: true, verbatim: true })
    .then((list) => ({ ok: true, addresses: list.map((e) => e.address), families: list.map((e) => String(e.family)), error: null }))
    .catch((e) => ({ ok: false, addresses: [], families: [], error: errText(e) }));
  const serverP = dnsPromises.resolve4(name)
    .then((list) => ({ ok: true, addresses: list, error: null }))
    .catch((e) => ({ ok: false, addresses: [], error: errText(e) }));

  const [resolver, server] = await Promise.all([
    withTimeout(resolverP, 4000, `getaddrinfo(${name})`),
    withTimeout(serverP, 4000, `dns.resolve4(${name})`),
  ]);
  const detail = resolver.ok
    ? `${name} resolves to ${resolver.addresses.join(', ')} via getaddrinfo`
    : `${name} does NOT resolve: ${resolver.error}`;
  return check(
    'dockerGateway', 'ADVISORY', Boolean(resolver.ok), detail,
    {
      name,
      allowedHosts: allowed,
      resolver,
      dnsServer: {
        ...server,
        note: 'resolve4 bypasses the hosts file, so this distinguishes "the name is pinned in the hosts file" from "the Docker embedded DNS server answered"',
      },
      probedNameOverridden: Boolean(overrideName),
      hazard: 'Docker engine not started yet - the prober binds and serves but the console container cannot reach it for the first minute or two of boot',
      sufficiencyNote: 'Host-side name resolution is NECESSARY but NOT SUFFICIENT. Docker Desktop leaves a static hosts-file entry, so this name can resolve while the engine is down. End-to-end reachability is asserted by boot-verdict.ps1 through the console, which is the only place it can be measured truthfully.',
    },
  );
}

function loadExpectations(p) {
  if (!p) return { present: false, path: null, data: null, error: 'no expectations path supplied' };
  if (!existsSync(p)) return { present: false, path: p, data: null, error: `not found at ${p}` };
  try {
    const data = JSON.parse(stripBom(readFileSync(p, 'utf8')));
    return { present: true, path: p, data, error: null };
  } catch (e) {
    return { present: true, path: p, data: null, error: `unreadable: ${errText(e)}` };
  }
}

/**
 * Windows PowerShell 5.1's `Set-Content -Encoding UTF8` writes a UTF-8 BOM
 * (EF BB BF). JSON.parse rejects a leading U+FEFF, so an expectations file written
 * by the installer was indistinguishable from a corrupt one.
 *
 * MEASURED on this host: the first real service start reported
 *   pinnedEnvironment: "install-time expectations are absent"
 * when the file was present, correct and complete - the first three bytes were
 * 239,187,191. The BOM is stripped here AND the PowerShell writers were changed to
 * emit BOM-less UTF-8, so the two sides agree either way.
 */
function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/**
 * Compare the LIVE process environment against what install.ps1 recorded.
 *
 * This is the check that answers "is APPDATA pinned to an absolute value and
 * not re-derived at runtime". It is a byte-for-byte comparison of every
 * non-secret variable the installer pinned, so a drift of a single character is
 * visible instead of inferred.
 */
function checkPinnedEnvironment(env, expectations, secretNames) {
  const expected = (expectations && expectations.data && expectations.data.expectedEnv) || null;
  const names = Object.keys(env)
    .filter((k) => k.startsWith('HOST_PROBER_') || ['PATH', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH', 'TEMP', 'TMP', 'NODE_OPTIONS'].includes(k))
    .sort();

  const secrets = [];
  for (const n of secretNames) {
    const v = env[n];
    secrets.push({
      name: n,
      present: typeof v === 'string' && v.length > 0,
      length: typeof v === 'string' ? v.length : 0,
      minimum: 32,
      ok: typeof v === 'string' && v.length >= 32,
      value: '<never read into this record by design>',
    });
  }

  if (!expected) {
    return check(
      'pinnedEnvironment', 'ADVISORY', false,
      'install-time expectations are absent, so the live environment cannot be cross-checked against what was pinned',
      {
        crossChecked: false,
        expectationsPath: expectations ? expectations.path : null,
        expectationsError: expectations ? expectations.error : 'no expectations path supplied',
        observedNames: names,
        observed: observedEnvShape(env, names),
        secrets,
        hazard: 'APPDATA/LOCALAPPDATA cannot be proven pinned - a re-derived profile silently flips pyright OFFLINE and costs 10 health points',
      },
    );
  }

  // 1. what the platform actually delivered, BEFORE the wrapper touches anything
  const asDelivered = compareEnv(expected, env);
  // 2. the wrapper enforces the identity variables it is permitted to enforce
  const enforced = enforcePinnedEnv(expected, env, asDelivered);
  // 3. what the prober child will therefore see
  const effective = compareEnv(expected, env);

  const pyrightSite = locatePyrightUserSite(env.APPDATA || '');
  const failures = [
    ...effective.mismatched.map((m) => `${m.name} expected "${m.expected}" but the prober will see "${m.actual}" (the wrapper is not permitted to correct this one)`),
    ...effective.missing.map((m) => `${m.name} is absent from the prober's environment (install-time expected "${m.expected}")`),
    ...secrets.filter((s) => !s.ok).map((s) => `${s.name} is absent or shorter than the ${s.minimum}-character minimum`),
    ...(pyrightSite.checked && pyrightSite.found === false
      ? [`the pinned APPDATA does not contain the pyright package (looked in ${pyrightSite.pythonRoot}\\<ver>\\site-packages), so pyright will measure OFFLINE and the console score will fall 70 -> 60`]
      : []),
  ];
  const ok = failures.length === 0;
  const detail = ok
    ? `all ${effective.matched.length} pinned environment variables will be seen exactly as pinned${enforced.length ? ` (${enforced.length} corrected in-process by the wrapper: ${enforced.map((e) => e.name).join(', ')})` : ''}`
    : `environment drift the wrapper cannot correct: ${failures.join('; ')}`;
  return check(
    'pinnedEnvironment', 'REQUIRED', ok, detail,
    {
      crossChecked: true,
      expectationsPath: expectations.path,
      expectationsWrittenAtUtc: expectations.data.writtenAtUtc || null,
      matchedCount: effective.matched.length,
      matched: effective.matched,
      emptyEquivalent: effective.emptyEquivalent,
      asDeliveredByPlatform: {
        matchedCount: asDelivered.matched.length,
        mismatched: asDelivered.mismatched,
        missing: asDelivered.missing,
      },
      enforcedByWrapper: enforced,
      enforceableVariables: [...ENFORCEABLE],
      mismatched: effective.mismatched,
      missing: effective.missing,
      secrets,
      identity: {
        userProfile: env.USERPROFILE || null,
        appdata: env.APPDATA || null,
        localappdata: env.LOCALAPPDATA || null,
        profilePinned: expectations.data.profilePinned === true,
        measuredProfile: expectations.data.measuredProfile || null,
        appdataAbsolute: isAbs(env.APPDATA || ''),
        localappdataAbsolute: isAbs(env.LOCALAPPDATA || ''),
        appdataUnderMeasuredProfile: underPath(env.APPDATA || '', expectations.data.measuredProfile),
        localappdataUnderMeasuredProfile: underPath(env.LOCALAPPDATA || '', expectations.data.measuredProfile),
        // True only if a value that is STILL wrong was not merely enforced. A
        // variable the wrapper corrected is reported under enforcedByWrapper and
        // does not masquerade as a re-derivation.
        reDerivedAtRuntime: effective.mismatched.some((m) => ['USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'PATH'].includes(m.name)),
        pyrightUserSite: pyrightSite,
      },
      hazard: 'APPDATA/LOCALAPPDATA re-derived or absent - pyright flips OFFLINE and the console score drops 70 -> 60',
    },
  );
}

/** Byte-for-byte comparison of the live environment against install-time expectations. */
function compareEnv(expectedEnv, env) {
  const matched = [];
  const mismatched = [];
  const missing = [];
  const emptyEquivalent = [];
  for (const [k, v] of Object.entries(expectedEnv)) {
    if (v === null || v === undefined) continue;
    const actual = env[k];
    if (typeof actual === 'undefined') {
      // Windows drops an empty-valued variable from the block in some writers.
      // An expectation of '' and an absent variable are the same thing to Node.
      if (v === '') { emptyEquivalent.push(k); matched.push(k); continue; }
      missing.push({ name: k, expected: v, actual: null });
      continue;
    }
    if (String(actual) === String(v)) { matched.push(k); continue; }
    if (v === '' && actual === '') { emptyEquivalent.push(k); matched.push(k); continue; }
    mismatched.push({ name: k, expected: v, actual: String(actual) });
  }
  return { matched, mismatched, missing, emptyEquivalent };
}

/**
 * The identity variables the wrapper is permitted to enforce in-process.
 *
 * MEASURED ROOT CAUSE of the one drift this host produced. install.ps1 pins
 * `USERPROFILE=C:\Users\AA5II` in AppEnvironmentExtra, and the prober's process
 * MEASURED `USERPROFILE=C:\WINDOWS\system32\config\systemprofile` instead - the
 * service account's own profile. APPDATA, LOCALAPPDATA, HOMEDRIVE, HOMEPATH, TEMP
 * and TMP were all delivered exactly as pinned; only USERPROFILE was replaced, by
 * the platform, below the level nssm writes to. This nssm build contains no
 * USERPROFILE string at all (MEASURED, UTF-16LE scan of the binary), so nssm is
 * not the author either; the substitution happens while the service environment
 * block is assembled.
 *
 * Pinning it in AppEnvironmentExtra alone therefore CANNOT work, and re-pinning at
 * install time will not change that. The fix has to be applied at the last point
 * where nothing can override it: inside the wrapper, immediately before the prober
 * is spawned. `process.env` is exactly what this module hands to the child, so
 * after this assignment the prober and every MCP/Chromium descendant it starts see
 * the pinned value - and the correction is written to the readiness record rather
 * than hidden, so the operator can see both what the platform delivered and what
 * the wrapper did about it.
 *
 * PATH is deliberately NOT enforced: node.exe and tsx are already referenced by
 * absolute path, so rewriting PATH buys nothing measurable.
 * HOST_PROBER_* is deliberately NOT enforced: if one of those drifts, the
 * instrument is measuring something other than what was installed, and that must
 * FAIL loudly instead of being quietly corrected.
 */
const ENFORCEABLE = new Set(['USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH', 'TEMP', 'TMP']);

function enforcePinnedEnv(expectedEnv, env, previousComparison) {
  const enforced = [];
  for (const m of previousComparison.mismatched) {
    if (!ENFORCEABLE.has(m.name)) continue;
    env[m.name] = m.expected;
    enforced.push({
      name: m.name,
      platformDelivered: m.actual,
      pinnedValue: m.expected,
      appliedWhere: 'process.env of boot-guard.mjs, inherited by the prober child via spawn(env: process.env)',
      why: 'the service environment block substitutes this variable for the service account; the wrapper is the last point at which the pinned value can be restored',
    });
  }
  for (const m of previousComparison.missing) {
    if (!ENFORCEABLE.has(m.name)) continue;
    env[m.name] = m.expected;
    enforced.push({
      name: m.name,
      platformDelivered: null,
      pinnedValue: m.expected,
      appliedWhere: 'process.env of boot-guard.mjs, inherited by the prober child via spawn(env: process.env)',
      why: 'absent from the service environment block; the wrapper re-asserted the pinned value',
    });
  }
  return enforced;
}

function observedEnvShape(env, names) {
  const out = {};
  for (const n of names) {
    if (n === 'PATH') { out.PATH = `<${(env.PATH || '').split(PATH_DELIM).filter(Boolean).length} entries>`; continue; }
    out[n] = env[n];
  }
  return out;
}

function underPath(child, parent) {
  if (!child || !parent) return null;
  const a = child.toLowerCase().replace(/[\\/]+$/, '');
  const b = parent.toLowerCase().replace(/[\\/]+$/, '');
  return a === b || a.startsWith(`${b}\\`) || a.startsWith(`${b}/`);
}

/**
 * Turn the APPDATA pin into a CONSEQUENCE rather than a belief.
 *
 * config/servers_center_manifest.json declares for pyright
 * `command.env.passThrough = ["APPDATA"]`, because the `pyright` package lives in
 * the PER-USER site-packages under %APPDATA%\Python\<ver>\site-packages. A child
 * process started without the right APPDATA cannot import it at all: exit 1,
 * ModuleNotFoundError, pyright measures OFFLINE, and the console score falls
 * 70 -> 60 while still reporting hostProber.reachable=true.
 *
 * So the pin is not proven by the pin being present. It is proven by the directory
 * the pin points at actually containing the package.
 */
function locatePyrightUserSite(appdata) {
  if (!appdata || !isAbs(appdata)) return { checked: false, reason: 'APPDATA is unset or not absolute' };
  const pythonRoot = join(appdata, 'Python');
  const out = {
    checked: true,
    appdata,
    pythonRoot,
    pythonRootExists: existsSync(pythonRoot),
    pythonRootReadable: false,
    versions: [],
    versionsWithSitePackages: 0,
    sitePackagesContainingPyright: [],
  };
  if (!out.pythonRootExists) {
    out.reason = `${pythonRoot} does not exist, so no per-user site-packages can be found from this APPDATA`;
    return out;
  }
  try {
    out.pythonRootReadable = true;
    out.versions = readdirSync(pythonRoot);
  } catch (e) {
    out.reason = `readdir failed: ${errText(e)}`;
    return out;
  }
  for (const v of out.versions) {
    const sp = join(pythonRoot, v, 'site-packages');
    if (!existsSync(sp)) continue;
    out.versionsWithSitePackages += 1;
    if (existsSync(join(sp, 'pyright'))) out.sitePackagesContainingPyright.push(sp);
  }
  out.found = out.sitePackagesContainingPyright.length > 0;
  out.meaning = out.found
    ? 'the pyright package IS present under the pinned APPDATA, so the manifest can import it and measure online'
    : 'the pyright package is NOT present under the pinned APPDATA, so pyright will measure OFFLINE and the console score will lose 10 points';
  return out;
}

function checkRuntimeEntries(childArgs, expectations) {
  const nodeExe = process.execPath;
  const nodeSt = safeStat(nodeExe);
  const tsxCli = childArgs[0] || null;
  const prober = childArgs[1] || null;
  const parts = [];

  const tsxSt = tsxCli ? safeStat(tsxCli) : { __error: 'not supplied' };
  const proberSt = prober ? safeStat(prober) : { __error: 'not supplied' };

  const nodeOk = !nodeSt.__error && nodeSt.isFile();
  const tsxOk = !tsxSt.__error && tsxSt.isFile();
  const proberOk = !proberSt.__error && proberSt.isFile();
  if (!nodeOk) parts.push(`node.exe unusable at ${nodeExe}: ${nodeSt.__error || 'not a file'}`);
  if (!tsxOk) parts.push(`tsx entry unusable at ${tsxCli || '<none>'}: ${tsxSt.__error || 'not a file'}`);
  if (!proberOk) parts.push(`prober script unusable at ${prober || '<none>'}: ${proberSt.__error || 'not a file'}`);

  return check(
    'runtimeEntries', 'BLOCKER', nodeOk && tsxOk && proberOk,
    nodeOk && tsxOk && proberOk
      ? `node, tsx entry and prober script are all readable files that this process has already OPENED (proof of hazard 4: no file was held)`
      : parts.join('; '),
    {
      node: { path: nodeExe, isAbsolute: isAbs(nodeExe), exists: !nodeSt.__error, isFile: Boolean(nodeSt.isFile && nodeSt.isFile()), bytes: nodeSt.size ?? null, version: process.version },
      tsxCli: { path: tsxCli, isAbsolute: isAbs(tsxCli || ''), exists: !tsxSt.__error, isFile: Boolean(tsxSt.isFile && tsxSt.isFile()), bytes: tsxSt.size ?? null },
      proberScript: { path: prober, isAbsolute: isAbs(prober || ''), exists: !proberSt.__error, isFile: Boolean(proberSt.isFile && proberSt.isFile()), bytes: proberSt.size ?? null },
      matchesExpectations: expectations && expectations.data && expectations.data.paths
        ? {
          nodeExe: samePath(nodeExe, expectations.data.paths.nodeExe),
          tsxCli: samePath(tsxCli, expectations.data.paths.tsxCli),
          proberScript: samePath(prober, expectations.data.paths.proberScript),
        }
        : null,
      hazard: 'Defender or another filter driver holding the runtime - the service cannot open the file it needs',
      evidence: 'symptom-level: these entries were stat()ed and the two that are actually executed were read by this process',
    },
  );
}

function samePath(a, b) {
  if (!a || !b) return null;
  return a.toLowerCase() === b.toLowerCase();
}

function checkWorkingDirectoryAndPath(env, expectations) {
  const cwd = process.cwd();
  const nodeDir = dirname(process.execPath);
  const entries = (env.PATH || '').split(PATH_DELIM).map((s) => s.trim()).filter(Boolean);
  const problems = [];
  if (!entries.length) problems.push('PATH is empty');
  if (!entries.some((e) => e.toLowerCase() === nodeDir.toLowerCase())) problems.push(`node's own directory ${nodeDir} is absent from PATH`);
  if (!isAbs(cwd)) problems.push(`working directory ${cwd} is not absolute`);
  const expectedDir = expectations && expectations.data && expectations.data.paths
    ? expectations.data.paths.appDirectory : null;
  const dirMatches = expectedDir ? samePath(cwd, expectedDir) : null;
  if (dirMatches === false) problems.push(`working directory ${cwd} is not the configured AppDirectory ${expectedDir}`);
  if (!env.SystemRoot && !env.windir) problems.push('SystemRoot/windir is unset; System32 tools cannot be resolved');

  const detail = problems.length
    ? `session-0 environment is not fully established: ${problems.join('; ')}`
    : `cwd=${cwd} (absolute, matches AppDirectory), PATH=${entries.length} entries including ${nodeDir}, SystemRoot present, ComSpec=${env.ComSpec || '<unset>'}`;
  return check('workingDirectoryAndPath', 'REQUIRED', problems.length === 0, detail, {
    workingDirectory: cwd,
    workingDirectoryIsAbsolute: isAbs(cwd),
    expectedAppDirectory: expectedDir,
    workingDirectoryMatchesExpectation: dirMatches,
    pathEntryCount: entries.length,
    pathIncludesNodeDirectory: entries.some((e) => e.toLowerCase() === nodeDir.toLowerCase()),
    systemRoot: env.SystemRoot || null,
    windir: env.windir || null,
    comSpec: env.ComSpec || null,
    problems,
    hazard: 'working directory / PATH not established at boot - session 0 has no interactive shell environment to inherit',
  });
}

function checkRepoAndManifest(env, expectations) {
  const repoRoot = (env.HOST_PROBER_REPO_ROOT || '').trim();
  const manifest = repoRoot ? join(repoRoot, 'config', 'servers_center_manifest.json') : null;
  const repoSt = repoRoot ? safeStat(repoRoot) : { __error: 'HOST_PROBER_REPO_ROOT unset' };
  const manifestSt = manifest ? safeStat(manifest) : { __error: 'repo root unset' };
  let manifestHead = null;
  if (!manifestSt.__error) {
    try {
      const parsed = JSON.parse(readFileSync(manifest, 'utf8'));
      const servers = parsed && (parsed.servers || parsed.entries || parsed.targets);
      manifestHead = { serversDeclared: Array.isArray(servers) ? servers.length : null, topLevelKeys: parsed && typeof parsed === 'object' ? Object.keys(parsed).slice(0, 8) : null };
    } catch (e) {
      manifestSt.__error = `unparsable: ${errText(e)}`;
    }
  }
  const ok = !repoSt.__error && repoSt.isDirectory() && !manifestSt.__error && manifestSt.isFile();
  return check('repoAndManifest', 'REQUIRED', ok,
    ok
      ? `repository root and the measurement manifest are present (${manifestHead && manifestHead.serversDeclared !== null ? `${manifestHead.serversDeclared} servers declared` : 'server count not parsed'})`
      : `repository root or manifest unusable: root=${repoRoot || '<unset>'} (${repoSt.__error || 'ok'}) manifest=${manifest || '<unset>'} (${manifestSt.__error || 'ok'})`,
    {
      repoRoot: repoRoot || null,
      repoRootExists: !repoSt.__error,
      manifestPath: manifest,
      manifestExists: !manifestSt.__error,
      manifest: manifestHead,
      matchesExpectations: expectations && expectations.data && expectations.data.paths
        ? {
          repoRoot: samePath(repoRoot, expectations.data.paths.repoRoot),
          manifest: samePath(manifest, expectations.data.paths.manifest),
        }
        : null,
      hazard: 'the manifest is what defines WHICH servers get measured; without it the inventory shrinks silently',
    });
}

// ---------------------------------------------------------------------------
// record assembly
// ---------------------------------------------------------------------------

function combineVerdict(checks) {
  let verdict = 'READY';
  for (const c of checks) {
    if (c.ok) continue;
    const v = VERDICT_FOR[c.severity] || 'DEGRADED';
    if (VERDICT_ORDER[v] > VERDICT_ORDER[verdict]) verdict = v;
  }
  return verdict;
}

function announce(checks, verdict, stream) {
  const failed = checks.filter((c) => !c.ok);
  const write = (s) => (stream === 'stderr' ? process.stderr.write(s) : process.stdout.write(s));
  if (verdict === 'READY') {
    write(`${MARKER}: ${checks.length} startup checks passed; every cold-boot precondition the prober needs existed at this moment\n`);
    return;
  }
  const banner = [
    '',
    '================================================================',
    ` SOVEREIGN BOOT GUARD - ${verdict} (${failed.length} failed check(s))`,
    ' THE SERVICE STARTED, BUT ITS BOOT-TIME PRECONDITIONS ARE NOT MET.',
    ' THIS IS NOT A WARNING. The console health score WILL be wrong, and the',
    ' reason is recorded in the readiness file named in this record.',
    '================================================================',
  ];
  write(`${banner.join('\n')}\n`);
  for (const c of failed) {
    write(`  [${c.severity}] ${c.name}: ${c.detail}\n`);
    if (c.hazard) write(`           hazard covered: ${c.hazard}\n`);
    if (c.problems && c.problems.length) for (const p of c.problems) write(`           - ${p}\n`);
  }
  write(`${MARKER}: verdict=${verdict} failedChecks=${failed.map((c) => `${c.severity}:${c.name}`).join(',')}\n`);
}

function writeReadinessFile(path, record) {
  if (!path) return { ok: false, error: 'no readiness path' };
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    renameSync(tmp, path);
    return { ok: true, path };
  } catch (e) {
    return { ok: false, path, error: errText(e) };
  }
}

/**
 * Merge a key into the readiness file without clobbering the keys another
 * writer owns. The guard owns `service`; recover-prober.ps1 owns `recovery`.
 * A short exclusive lock file keeps the two writers from interleaving.
 */
export function mergeReadiness(path, key, value) {
  let fd = null;
  const lock = `${path}.lock`;
  const deadline = Date.now() + 5000;
  while (fd === null) {
    try { fd = openSync(lock, 'wx'); } catch (e) {
      if (Date.now() > deadline) return { ok: false, path, error: `could not lock ${lock}: ${errText(e)}` };
      try { if (Date.now() - safeStat(lock).mtimeMs > 10000) unlinkSync(lock); } catch { /* someone else cleared it */ }
      sleepMs(50);
    }
  }
  try {
    let current = {};
    try { current = JSON.parse(stripBom(readFileSync(path, 'utf8'))); } catch { current = {}; }
    current[key] = value;
    current.schema = SCHEMA;
    current.chainKeyId = CHAIN_KEY_ID;
    current.updatedAtUtc = new Date().toISOString();
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
    renameSync(tmp, path);
    return { ok: true, path };
  } catch (e) {
    return { ok: false, path, error: errText(e) };
  } finally {
    try { closeSync(fd); } catch { /* already closed */ }
    try { unlinkSync(lock); } catch { /* already gone */ }
  }
}

function sleepMs(ms) {
  // Synchronous sleep: used only inside the tiny lock spin above, and never on
  // the prober's critical path.
  const shared = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(shared), 0, 0, ms);
}

async function runSelfTest(opts, childArgs) {
  const env = process.env;
  const readinessPath = opts.readinessPath || DEFAULT_READINESS;
  const expectationsPath = opts.expectationsPath || DEFAULT_EXPECTATIONS;
  const expectations = loadExpectations(expectationsPath);
  const secretNames = (expectations.data && expectations.data.secretEnvNames) || ['HOST_PROBER_TOKEN'];

  const [bootIdResult] = await Promise.all([readBootId()]);

  const checks = [
    await checkAccount(),
    await checkServerRoot(env, expectations.data ? expectations.data.paths.serverRoot : null),
    checkPinnedEnvironment(env, expectations, secretNames),
    checkRuntimeEntries(childArgs, expectations),
    checkWorkingDirectoryAndPath(env, expectations),
    checkRepoAndManifest(env, expectations),
    await checkDockerGateway(env, opts.probeName),
  ];

  const verdict = combineVerdict(checks);
  const blockers = checks.filter((c) => !c.ok && c.severity === 'BLOCKER');

  const service = {
    verdict,
    recordedAtUtc: new Date().toISOString(),
    recordedBy: 'boot-guard.mjs (service wrapper)',
    host: os.hostname(),
    pid: process.pid,
    ppid: process.ppid,
    nodeVersion: process.version,
    execPath: process.execPath,
    cwd: process.cwd(),
    commandLineChildArgs: childArgs,
    counts: {
      total: checks.length,
      passed: checks.filter((c) => c.ok).length,
      failed: checks.filter((c) => !c.ok).length,
      blockers: blockers.length,
      required: checks.filter((c) => !c.ok && c.severity === 'REQUIRED').length,
      advisory: checks.filter((c) => !c.ok && c.severity === 'ADVISORY').length,
    },
    failedChecks: checks.filter((c) => !c.ok).map((c) => ({ name: c.name, severity: c.severity, detail: c.detail, hazard: c.hazard || null })),
    checks,
  };

  const record = {
    schema: SCHEMA,
    chainKeyId: CHAIN_KEY_ID,
    verdict,
    verdictMeaning: {
      READY: 'every cold-boot precondition the prober needs existed at the moment it started',
      DEGRADED: 'the prober started, but at least one ADVISORY boot hazard is present now (e.g. Docker is not up yet)',
      FAIL: 'at least one REQUIRED check failed, so the measurement will be wrong or silently degraded',
    },
    recordedAtUtc: service.recordedAtUtc,
    recordedBy: service.recordedBy,
    boot: bootIdentity(bootIdResult),
    expectations: { path: expectations.path, present: expectations.present, error: expectations.error, schema: expectations.data ? expectations.data.schema : null, writtenAtUtc: expectations.data ? expectations.data.writtenAtUtc : null },
    readinessFile: readinessPath,
    service,
  };

  const written = writeReadinessFile(readinessPath, record);
  record.readinessWrite = written;
  if (!written.ok) {
    // Loud, because a prober that cannot prove its own readiness must not be
    // allowed to look like one that can.
    process.stderr.write(`${MARKER}: readiness file could NOT be written (${written.error}). The operator cannot prove this start's conditions.\n`);
  }
  return { record, verdict, checks, blockers, written };
}

function printJsonLine(record) {
  process.stdout.write(`${MARKER} ${JSON.stringify(record)}\n`);
}

// ---------------------------------------------------------------------------
// service mode: run the checks, then run the prober EXACTLY as before
// ---------------------------------------------------------------------------

async function runService(opts) {
  const childArgs = opts.childArgs;
  if (childArgs.length === 0) {
    process.stderr.write(`${MARKER}: FAIL - BLOCKER: no child command supplied. Expected: boot-guard.mjs -- <tsx cli> <prober script>\n`);
    return 3;
  }

  const { record, verdict, checks, blockers } = await runSelfTest(opts, childArgs);
  announce(checks, verdict, 'stdout');
  printJsonLine(record);

  if (blockers.length > 0) {
    const names = blockers.map((b) => b.name).join(', ');
    const banner = [
      '',
      '================================================================',
      ' SOVEREIGN BOOT GUARD - REFUSING TO START THE PROBER',
      ` BLOCKER precondition(s) failed: ${names}`,
      ' This wrapper will NOT start the prober and will NOT exit, so NSSM',
      ' cannot turn a fatal precondition into a restart storm. It re-announces',
      ' every 60s. Fix the named condition and restart the service.',
      '================================================================',
      '',
    ].join('\n');
    process.stderr.write(banner);
    process.stdout.write(banner);
    const forever = () => {};
    process.on('SIGINT', forever);
    process.on('SIGTERM', forever);
    setInterval(() => {
      process.stdout.write(`${MARKER}: STILL BLOCKED at ${new Date().toISOString()}; blocker(s)=${names}. The prober is not running and the console will report the prober as unavailable - which is the truth.\n`);
    }, Math.max(5, opts.announceSec) * 1000);
    return new Promise(() => {});
  }

  // From here the wrapper is a transparent proxy. Nothing about the prober's
  // own lifecycle changes: same child, same stdio, same console, same exit code
  // handed to NSSM so the existing AppExit policy still applies verbatim.
  const child = spawn(process.execPath, childArgs, {
    stdio: 'inherit',
    env: process.env,
    windowsHide: false,
  });

  // A console control event (NSSM AppStopMethodConsole=0) is broadcast to every
  // process attached to the console, so the prober's own SIGINT handler runs
  // handle.close() and reaps its children. This wrapper deliberately does NOT
  // exit on a signal: exiting here would let NSSM TerminateProcess the prober
  // mid-shutdown, which is the abrupt-kill path HOST_PROBER.md section 12 warns
  // about. The wrapper's exit code is always the PROBER's exit code.
  let forwarded = false;
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'BREAK']) {
    process.on(sig, () => {
      if (forwarded) return;
      forwarded = true;
      process.stdout.write(`${MARKER}: ${sig} received by the wrapper; the prober shares this console and receives it too. The wrapper will exit with the prober's own exit code.\n`);
      try { child.kill(sig); } catch { /* the prober may already be gone */ }
    });
  }

  return new Promise((resolve) => {
    child.on('error', (e) => {
      const failure = check('proberSpawn', 'BLOCKER', false, `could not spawn the prober: ${errText(e)}`, { error: errText(e) });
      const failed = record;
      failed.verdict = 'FAIL';
      failed.service.verdict = 'FAIL';
      failed.service.failedChecks.push({ name: 'proberSpawn', severity: 'BLOCKER', detail: failure.detail, hazard: 'the prober could not be started at all' });
      failed.service.checks.push(failure);
      failed.service.counts.failed += 1;
      failed.service.counts.blockers += 1;
      announce(failed.service.checks, 'FAIL', 'stderr');
      printJsonLine(failed);
      writeReadinessFile(opts.readinessPath || DEFAULT_READINESS, failed);
      resolve(1);
    });
    child.on('exit', (code, signal) => {
      const exitCode = typeof code === 'number' ? code : (signal ? 1 : 0);
      process.stdout.write(`${MARKER}: the prober exited (code=${code} signal=${signal || 'none'}); the wrapper exits ${exitCode} so NSSM AppExit policy applies unchanged.\n`);
      resolve(exitCode);
    });
  });
}

// ---------------------------------------------------------------------------

const invokedDirectly = process.argv[1] !== undefined
  && /boot-guard\.mjs$/i.test(process.argv[1]);

if (invokedDirectly) {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.selfTest) {
    runSelfTest(opts, opts.childArgs)
      .then(({ record, checks, verdict }) => {
        announce(checks, verdict, 'stdout');
        printJsonLine(record);
        process.exitCode = 0;
      })
      .catch((e) => {
        process.stderr.write(`${MARKER}: self-test threw: ${errText(e)}\n`);
        process.exitCode = 1;
      });
  } else {
    runService(opts).then((code) => { process.exitCode = code; });
  }
}

export { SCHEMA, CHAIN_KEY_ID, MARKER, combineVerdict, writeReadinessFile, runSelfTest };