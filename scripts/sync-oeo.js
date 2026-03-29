'use strict';

/**
 * sync-oeo.js — Download OEO glossary and regenerate src/oeo-mappings.js
 *
 * Downloads the existing-terms-and-definitions.zip from the latest (or pinned)
 * OEO release on GitHub, parses glossary.csv, and overwrites the static mapping
 * tables in src/oeo-mappings.js with up-to-date IDs and labels.
 *
 * Usage:
 *   npm run sync:oeo                     # sync from latest release
 *   npm run sync:oeo -- --version=2.11.0 # sync from specific version
 *   npm run sync:oeo -- --dry-run        # preview without writing
 *
 * Ontology repository: @OpenEnergyPlatform/ontology
 *   https://github.com/OpenEnergyPlatform/ontology
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MAPPINGS_PATH = path.join(ROOT, 'src', 'oeo-mappings.js');
const REPO = 'OpenEnergyPlatform/ontology';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const versionArg = args.find((a) => a.startsWith('--version='));
const pinnedVersion = versionArg ? versionArg.split('=')[1] : null;

// ---------------------------------------------------------------------------
// HTTP helpers (pure Node.js — no external deps)
// ---------------------------------------------------------------------------
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'cernion-sync-oeo/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGet(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    request.on('error', reject);
  });
}

function httpsGetJson(url) {
  return httpsGet(url).then((buf) => JSON.parse(buf.toString('utf8')));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('🔄 OEO Sync — fetching release info from GitHub…');

  // 1. Resolve version
  const releaseUrl = pinnedVersion
    ? `https://api.github.com/repos/${REPO}/releases/tags/v${pinnedVersion}`
    : `https://api.github.com/repos/${REPO}/releases/latest`;

  const release = await httpsGetJson(releaseUrl);
  const version = release.tag_name.replace(/^v/, '');
  console.log(`  📦 OEO version: ${version} (${release.published_at?.slice(0, 10) || 'n/a'})`);

  // 2. Find ETD zip asset
  const etdAsset = (release.assets || []).find(
    (a) => a.name === 'existing-terms-and-definitions.zip'
  );
  if (!etdAsset) {
    console.error('  ❌ ETD zip asset not found in release. Available assets:');
    (release.assets || []).forEach((a) => console.error(`     - ${a.name}`));
    process.exitCode = 1;
    return;
  }

  // 3. Download & extract glossary.csv
  console.log('  ⬇️  Downloading ETD zip…');
  const zipBuffer = await httpsGet(etdAsset.browser_download_url);
  const tmpDir = path.join(ROOT, '.tmp-oeo-sync');
  const zipPath = path.join(tmpDir, 'etd.zip');
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(zipPath, zipBuffer);

  execSync(`unzip -o "${zipPath}" glossary.csv -d "${tmpDir}"`, { stdio: 'pipe' });
  const csvPath = path.join(tmpDir, 'glossary.csv');
  const csvContent = fs.readFileSync(csvPath, 'utf8');

  // 4. Parse glossary.csv
  // Format: ID,LABEL,definition (with possible commas/quotes in definition)
  const entries = new Map();
  const lines = csvContent.split('\n');
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    // Split on first two commas only (definition may contain commas)
    const firstComma = line.indexOf(',');
    if (firstComma < 0) continue;
    const secondComma = line.indexOf(',', firstComma + 1);
    const id = line.slice(0, firstComma).trim();
    const label = secondComma > 0
      ? line.slice(firstComma + 1, secondComma).trim()
      : line.slice(firstComma + 1).trim();
    if (id && label && /^OEO_\d+$/.test(id)) {
      entries.set(id, label);
    }
  }
  console.log(`  📖 Parsed ${entries.size} glossary entries`);

  // 5. Read current mappings file
  const currentContent = fs.readFileSync(MAPPINGS_PATH, 'utf8');

  // 6. Validate: check every OEO_XXXXX reference in mappings still exists
  const oeoRefRegex = /OEO_\d+/g;
  const refs = [...currentContent.matchAll(oeoRefRegex)].map((m) => m[0]);
  const uniqueRefs = [...new Set(refs)];
  const missing = uniqueRefs.filter((ref) => !entries.has(ref));
  const renamed = [];

  if (missing.length > 0) {
    console.warn(`\n  ⚠️  ${missing.length} OEO IDs referenced in oeo-mappings.js not found in glossary:`);
    missing.forEach((id) => console.warn(`     - ${id}`));
    console.warn('  These may have been renamed or removed. Manual review required.\n');
  }

  // 7. Check for label changes
  const labelPattern = /iri\('(OEO_\d+)'\),\s*label:\s*'([^']+)'/g;
  let labelMatch;
  while ((labelMatch = labelPattern.exec(currentContent)) !== null) {
    const [, oeoId, currentLabel] = labelMatch;
    const glossaryLabel = entries.get(oeoId);
    if (glossaryLabel && glossaryLabel !== currentLabel) {
      renamed.push({ oeoId, currentLabel, glossaryLabel });
    }
  }

  // 8. Update version string
  let updatedContent = currentContent.replace(
    /const OEO_VERSION = '[^']+';/,
    `const OEO_VERSION = '${version}';`
  );

  // 9. Update labels that changed
  for (const { oeoId, currentLabel, glossaryLabel } of renamed) {
    console.log(`  🔁 ${oeoId}: "${currentLabel}" → "${glossaryLabel}"`);
    // Only update the label field adjacent to the iri() call, not labelDe or other fields
    updatedContent = updatedContent.replace(
      new RegExp(`(iri\\('${oeoId}'\\),\\s*label:\\s*')${escapeRegex(currentLabel)}'`),
      `$1${glossaryLabel}'`
    );
  }

  // 10. Report
  console.log(`\n  📊 Summary:`);
  console.log(`     OEO version: ${version}`);
  console.log(`     Glossary entries: ${entries.size}`);
  console.log(`     Mapped OEO IDs: ${uniqueRefs.length}`);
  console.log(`     Missing in glossary: ${missing.length}`);
  console.log(`     Label changes: ${renamed.length}`);

  if (dryRun) {
    console.log('\n  🔍 Dry run — no files written.');
  } else if (updatedContent !== currentContent) {
    fs.writeFileSync(MAPPINGS_PATH, updatedContent, 'utf8');
    console.log(`\n  ✅ Updated ${MAPPINGS_PATH}`);
  } else {
    console.log('\n  ✅ No changes needed — mappings are up to date.');
  }

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

main().catch((err) => {
  console.error('❌ OEO sync failed:', err.message);
  process.exitCode = 1;
});
