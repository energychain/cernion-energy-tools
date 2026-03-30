'use strict';

/**
 * sync-oemetadata.js — Download OEMetadata schema assets from GitHub
 *
 * Downloads schema.json, template.json, and context.json from the official
 * OEMetadata repository at the pinned version tag and stores them in
 * src/oemetadata/ for local use.
 *
 * Usage:
 *   npm run sync:oemetadata              # download pinned version (default)
 *   npm run sync:oemetadata -- --latest  # download production branch head (dev only)
 *   npm run sync:oemetadata -- --dry-run # preview URLs without downloading
 *
 * OEMetadata repository: https://github.com/OpenEnergyPlatform/oemetadata
 *
 * IMPORTANT: The pinned version tag (OEM_VERSION) is the source of truth.
 * When upgrading to a new schema version:
 *   1. Change OEM_VERSION below
 *   2. Run npm run sync:oemetadata
 *   3. Fix any new mandatory fields in src/oemetadata-builder.js
 *   4. Document the schema version bump in CHANGELOG.md
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'src', 'oemetadata');

// ---------------------------------------------------------------------------
// Pinned OEMetadata version — change deliberately when upgrading schema
// ---------------------------------------------------------------------------
const OEM_VERSION = 'v2.0.0';

// Branch used by --latest flag (development / upstream-tracking only)
const OEM_LATEST_REF = 'production';

// Files to download from the OEMetadata repository
const ASSETS = [
  {
    name: 'schema.json',
    // OEMetadata v2.0 schema lives under metadata/v200/
    path: 'metadata/v200/schema.json',
  },
  {
    name: 'template.json',
    path: 'metadata/v200/template.json',
  },
  {
    name: 'context.json',
    path: 'metadata/v200/context.json',
  },
];

const OEM_REPO = 'OpenEnergyPlatform/oemetadata';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const useLatest = args.includes('--latest');

// ---------------------------------------------------------------------------
// HTTP helpers (pure Node.js — no external deps)
// ---------------------------------------------------------------------------
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      { headers: { 'User-Agent': 'cernion-sync-oemetadata/1.0' } },
      (res) => {
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
      }
    );
    request.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Build raw-content URL for a file at the given ref
// ---------------------------------------------------------------------------
function rawUrl(ref, filePath) {
  return `https://raw.githubusercontent.com/${OEM_REPO}/${ref}/${filePath}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const ref = useLatest ? OEM_LATEST_REF : OEM_VERSION;

  if (useLatest) {
    console.log(
      `⚠️  --latest flag active: fetching from branch '${OEM_LATEST_REF}' (not the pinned tag).`
    );
    console.log(
      '   Use this for development / upstream-tracking only. Never in production.\n'
    );
  } else {
    console.log(`🔄 OEMetadata Sync — pinned version: ${OEM_VERSION}`);
  }

  if (dryRun) {
    console.log('\n📋 Dry-run mode — showing download URLs without writing files:\n');
    for (const asset of ASSETS) {
      console.log(`   ${asset.name}`);
      console.log(`   → ${rawUrl(ref, asset.path)}\n`);
    }
    return;
  }

  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const results = [];

  for (const asset of ASSETS) {
    const url = rawUrl(ref, asset.path);
    const destPath = path.join(OUTPUT_DIR, asset.name);

    process.stdout.write(`  ⬇️  Downloading ${asset.name}…`);

    try {
      const content = await httpsGet(url);

      // Validate JSON before writing
      JSON.parse(content.toString('utf8'));

      fs.writeFileSync(destPath, content);
      const sizeKB = (content.length / 1024).toFixed(1);
      process.stdout.write(` ✅ (${sizeKB} KB)\n`);
      results.push({ name: asset.name, status: 'ok', sizeKB });
    } catch (err) {
      process.stdout.write(` ❌\n`);
      console.error(`     Error: ${err.message}`);
      results.push({ name: asset.name, status: 'error', error: err.message });
    }
  }

  // Summary
  const ok = results.filter((r) => r.status === 'ok');
  const failed = results.filter((r) => r.status === 'error');

  console.log(`\n✅ ${ok.length}/${ASSETS.length} assets downloaded to ${OUTPUT_DIR}/`);

  if (failed.length > 0) {
    console.error(`\n❌ ${failed.length} asset(s) failed:`);
    for (const f of failed) {
      console.error(`   - ${f.name}: ${f.error}`);
    }
    process.exitCode = 1;
    return;
  }

  // Write a version manifest so tools can verify which version was synced
  const manifest = {
    oemetadataVersion: ref,
    pinnedVersion: OEM_VERSION,
    latestMode: useLatest,
    syncedAt: new Date().toISOString(),
    assets: ok.map((r) => r.name),
  };
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n'
  );
  console.log(`  📄 Manifest written: src/oemetadata/manifest.json`);

  if (!useLatest) {
    console.log(`\n📌 Pinned to OEMetadata ${OEM_VERSION}.`);
    console.log(
      '   To upgrade: change OEM_VERSION in scripts/sync-oemetadata.js and re-run.\n'
    );
  }
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exitCode = 1;
});
