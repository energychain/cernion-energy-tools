const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  buildVocabulary,
  loadCatalogs,
  scanText,
  checkCore,
} = require('../scripts/check-domain-free-core');
const ROOT = path.resolve(__dirname, '..');

const catalogs = {
  capabilities: [
    { capability: 'cap-aaaa', domain: 'domain-bbbb', keywords: ['keyword-cccc', 'xy'] },
  ],
  operations: [{ domains: ['domain-dddd'] }],
  domains: [
    {
      id: 'semantic-eeee',
      label: 'Label Ffff',
      indicators: { columnKeywords: ['keyword-gggg'], filenameTokens: ['keyword-hhhh'] },
    },
  ],
  functions: [{ label: 'Label Iiii' }],
};
test('vocabulary derives capability IDs, domains, keywords, semantic IDs and function labels', () => {
  const terms = buildVocabulary(catalogs);
  for (const word of [
    'cap aaaa',
    'domain bbbb',
    'keyword cccc',
    'domain dddd',
    'semantic eeee',
    'keyword gggg',
    'keyword hhhh',
    'label iiii',
  ])
    expect(terms).toContain(word);
  expect(terms).not.toContain('xy');
  expect(() => buildVocabulary(catalogs, 0)).toThrow();
});

test('hyphen, underscore, space and camelCase separators canonicalize to the same vocabulary term', () => {
  for (const spelling of ['grid_ops', 'grid-ops', 'grid ops', 'gridOps']) {
    const terms = buildVocabulary({
      capabilities: [{ capability: spelling }],
      operations: [],
      domains: [],
      functions: [],
    });
    expect(terms).toContain('grid ops');
  }
});

test('grid_ops/grid-ops style multi-word terms are found regardless of source separator style', () => {
  const vocabulary = buildVocabulary({
    capabilities: [{ capability: 'grid_ops' }],
    operations: [],
    domains: [],
    functions: [],
  });
  expect(vocabulary).toContain('grid ops');
  for (const source of [
    'const grid_ops = loadConfig();',
    'const gridOps = loadConfig();',
    "const mode = 'grid-ops';",
    '// grid ops runbook',
  ])
    expect(scanText(source, vocabulary)).toEqual([{ line: 1, term: 'grid ops' }]);
  expect(scanText('const gridOpsIncident = 1;', vocabulary)).toEqual([
    { line: 1, term: 'grid ops' },
  ]);
});

test('AC-01: intentionally contaminated fixture from REAL catalogs makes CLI fail', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'domain-core-'));
  try {
    const keyword = loadCatalogs()
      .capabilities.flatMap((item) => item.keywords)
      .find((term) => term.length > 15 && !term.includes('\n'));
    expect(keyword).toBeTruthy();
    const fixture = path.join(temp, 'contaminated.js');
    fs.writeFileSync(fixture, `// ${keyword}\n`);
    const allowlist = path.join(temp, 'allow.json');
    fs.writeFileSync(allowlist, JSON.stringify({ entries: [] }));
    const config = { corePaths: [fixture], allowlist, minimumLength: 5 };
    const configFile = path.join(temp, 'config.json');
    fs.writeFileSync(configFile, JSON.stringify(config));
    const result = spawnSync(
      process.execPath,
      ['scripts/check-domain-free-core.js', '--config', configFile],
      { cwd: ROOT, encoding: 'utf8' }
    );
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: fixture, line: 1, term: keyword.toLowerCase() }),
      ])
    );
    fs.writeFileSync(fixture, '// fn-a\n');
    expect(checkCore({ config }).findings).toEqual([]);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('case, comments, literals and camelCase/underscore identifiers are checked', () => {
  for (const source of [
    '// KEYWORD',
    'const x = "keyword";',
    'const keywordValue = 1;',
    'const keyword_value = 1;',
  ])
    expect(scanText(source, ['keyword'])).toHaveLength(1);
  expect(scanText('const parameters = 1;', ['meter'])).toEqual([]);
});

test('allowlist requires explicit reason and only exempts its exact term', () => {
  expect(() => scanText('keyword', ['keyword'], [{ term: 'keyword' }])).toThrow('reason');
  expect(
    scanText(
      'keyword otherword',
      ['keyword', 'otherword'],
      [{ term: 'keyword', reason: 'Contract field' }]
    )
  ).toEqual([{ line: 1, term: 'otherword' }]);
});

test('required missing paths, empty core and empty vocabulary fail closed; future paths are explicit', () => {
  const config = {
    corePaths: ['src/does-not-exist.js'],
    allowlist: 'scripts/domain-free-core.allowlist.json',
  };
  expect(() => checkCore({ config })).toThrow('Required core paths missing');
  expect(() => checkCore({ config: { ...config, optionalPaths: config.corePaths } })).toThrow(
    'No core files'
  );
  expect(() => checkCore({ config: { ...config, corePaths: [] } })).toThrow('empty');
  expect(() => checkCore({ config, catalogs: {} })).toThrow('vocabulary');
});

test('AC-01: configured core is clean with catalog-derived vocabulary and justified exceptions', () => {
  const report = checkCore();
  expect(report.files.length).toBeGreaterThan(0);
  expect(report.vocabularySize).toBeGreaterThan(100);
  expect(report.findings).toEqual([]);
});
