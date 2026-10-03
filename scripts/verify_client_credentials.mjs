#!/usr/bin/env node
/**
 * Client Credential Literal Guard — Chain Key ID 360ea36c28e66d9d
 *
 * FAILS when a client-shipped file contains a credential-shaped literal.
 * Exits non-zero with the file, line, prefix and LENGTH — never the value.
 *
 * WHY THIS EXISTS
 * A real credential (prefix `sov_`, 39 chars) shipped inside the React bundle
 * and survived 69 commits while the existing `verify_secret_hygiene.ts`
 * reported success. That scanner searched a CLOSED list of known prefixes and
 * this one was custom. A tool that does not know what it is not looking for
 * must answer UNKNOWN, not PASS.
 *
 * WHY THIS IS NOT A LENGTH CHECK
 * The first version of this guard flagged anything matching `sov_` + 20
 * characters. Measured on the real repository, that flagged 19 innocent
 * strings: localStorage keys (`sov_active_chat_session_id`), IPC and agent
 * identifiers, kernel symbol names. A false-positive guard gets disabled by
 * the next person who trips over it, and a disabled guard protects nothing.
 *
 * So the discriminator is STRUCTURE, measured not assumed:
 *
 *                    length  digits  lowercase word-runs
 *   real credential    39      19          1
 *   localStorage key   26       0          3
 *   agent identifier   23       0          2
 *   kernel identifier  19       0          3
 *
 * A secret is a long opaque run dominated by digits or mixed-case entropy with
 * no readable word structure. An identifier is a sequence of readable words
 * separated by delimiters. This script tests exactly that, and it treats a
 * literal as a secret when EITHER a high digit density holds OR the string is
 * long and opaque — deliberately biased toward reporting, because a missed
 * credential is unrecoverable once shipped.
 *
 * It scans source, static assets, HTML entry points, the built bundle AND
 * source maps. A value removed from source but surviving in `dist/` is still
 * shipped, and that is the failure this guards against.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const CHAIN_KEY_ID = '360ea36c28e66d9d';
const PREFIX = 'sov_';
const SCAN_EXT = /\.(?:ts|tsx|js|jsx|mjs|cjs|html|json|map|css)$/i;
const SCAN_ENTRIES = ['src', 'public', 'dist'];

/** Candidate literals: the sovereign prefix plus at least 16 more characters. */
const CANDIDATE = new RegExp(`${PREFIX}[A-Za-z0-9_.:-]{16,}`, 'g');

function listFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (entry.isFile() && SCAN_EXT.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Does this literal read as a CREDENTIAL rather than as an identifier?
 *
 * Measured thresholds, chosen from the table above rather than tuned to make
 * any particular file pass:
 *   digits >= 6 in the tail  -> high-entropy material (the real secret has 19)
 *   word-runs <= 1           -> not a readable identifier
 *   length >= 32 and no word-runs -> long opaque run
 */
function looksLikeCredential(literal) {
  const tail = literal.slice(PREFIX.length);
  if (tail.length < 16) return false;

  const digits = (tail.match(/[0-9]/g) || []).length;
  const upper = (tail.match(/[A-Z]/g) || []).length;
  const lower = (tail.match(/[a-z]/g) || []).length;

  // A readable identifier is built from words separated by delimiters.
  const wordRuns = (tail.match(/[a-z]{3,}/g) || []).length;
  const delimiterRuns = (tail.match(/[_.:-]+/g) || []).length;
  const looksLikeWords = wordRuns >= 2 && delimiterRuns >= 1;

  // High digit density is the strongest single signal: identifiers essentially
  // never carry long digit runs, opaque credentials almost always do.
  if (digits >= 6) return true;

  // Mixed case with digits and no word structure is also opaque material.
  if (upper >= 4 && lower >= 4 && digits >= 2 && wordRuns <= 1) return true;

  // Long, opaque, and not composed of readable words.
  if (tail.length >= 32 && wordRuns <= 1) return true;

  // A long word-separated name is an identifier, not a secret.
  if (looksLikeWords) return false;

  return false;
}

function main() {
  const root = path.resolve(process.cwd());
  const files = [
    ...SCAN_ENTRIES.map((entry) => path.join(root, entry)).filter(existsSync).flatMap(listFiles),
    ...readdirSync(root).filter((n) => /\.html$/i.test(n)).map((n) => path.join(root, n)),
  ];

  const findings = [];
  let scanned = 0;

  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    scanned += 1;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      CANDIDATE.lastIndex = 0;
      let match;
      while ((match = CANDIDATE.exec(lines[i])) !== null) {
        const literal = match[0];
        if (looksLikeCredential(literal)) {
          findings.push({
            file: path.relative(root, file).replace(/\\/g, '/'),
            line: i + 1,
            prefix: literal.slice(0, 4),
            length: literal.length,
          });
        }
      }
    }
  }

  console.log(`[CLIENT_CREDENTIAL_GUARD] Chain Key ID: ${CHAIN_KEY_ID}`);
  console.log(`[CLIENT_CREDENTIAL_GUARD] Scanned ${scanned} client-shipped file(s).`);

  if (findings.length > 0) {
    console.log(`\n[FAIL] ${findings.length} credential-shaped literal(s) in client-shipped files:`);
    for (const f of findings) {
      console.log(`  ${f.file}:${f.line}  prefix=${f.prefix} length=${f.length}; value withheld`);
    }
    console.log('\nThe browser receives whatever is in these files. Remove the literal;');
    console.log('if the value is needed, read it from a server-side file, never the bundle.');
    process.exit(1);
  }

  console.log('[PASS] No credential-shaped literals in client-shipped files.');
}

main();