const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  normalize,
  buildVocabulary,
  loadCatalogs,
  scanText,
  checkCore,
} = require('../scripts/check-domain-free-core');
const ROOT = path.resolve(__dirname, '..');
const { generateVocabulary } = require('../scripts/generate-domain-free-vocabulary');

// Frozen pre-optimization oracle: deliberately retain the independent RegExp search.
function legacyScanText(text, vocabulary, allowlist = []) {
  const allowed = new Set(allowlist.map((entry) => normalize(entry.term)));
  const terms = vocabulary
    .filter((term) => !allowed.has(term))
    .map((term) => ({
      term,
      pattern: new RegExp(
        `(?<![\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`,
        'u'
      ),
    }));
  return text.split(/\r?\n/).flatMap((line, index) => {
    const normalized = normalize(line);
    return terms
      .filter(({ pattern }) => pattern.test(normalized))
      .map(({ term }) => ({ line: index + 1, term }));
  });
}

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
    'cap-aaaa',
    'domain-bbbb',
    'keyword-cccc',
    'domain-dddd',
    'semantic-eeee',
    'keyword-gggg',
    'keyword-hhhh',
    'label iiii',
  ])
    expect(terms).toContain(word);
  expect(terms).not.toContain('xy');
  expect(() => buildVocabulary(catalogs, 0)).toThrow();
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

test('token n-grams preserve literal separators, punctuation boundaries, Unicode and vocabulary order', () => {
  const vocabulary = [
    'plain word',
    'word',
    'plain',
    'plain-word',
    'plain_word',
    'plain\tword',
    '§plain word',
    '(plain word)',
    'plain?',
    '-----',
    'café',
    '𐐨word',
    'plain',
  ];
  const source = [
    'plainWord plain_word plain-word plain word plain  word plain\tword',
    'plain word plain word',
    '§plain word x§plain word (plain word) x(plain word)y',
    'plain? plain?x ----- x----- -----x',
    'CAFÉ cafe\u0301 𐐀word x𐐀word',
    '',
  ].join('\r\n');
  const allowlist = [{ term: 'plain-word', reason: 'Neutral fixture exception' }];
  expect(scanText(source, vocabulary, allowlist)).toEqual(
    legacyScanText(source, vocabulary, allowlist)
  );
});

test('old and token scans return identical file/line/term hits on every current core file and contamination fixture', () => {
  const vocabulary = buildVocabulary(loadCatalogs());
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-equivalence-'));
  try {
    const fixture = path.join(root, 'contaminated.js');
    const keyword = loadCatalogs()
      .capabilities.flatMap((item) => item.keywords)
      .find((term) => term.length > 15 && !term.includes('\n'));
    fs.writeFileSync(fixture, `// ${keyword}\n`);
    const files = [...checkCore().files, fixture];
    const scanFiles = (scan) =>
      files.flatMap((file) =>
        scan(fs.readFileSync(path.resolve(ROOT, file), 'utf8'), vocabulary).map((hit) => ({
          file,
          ...hit,
        }))
      );
    // No exceptions: exercise actual positive hits rather than comparing two clean reports.
    const legacy = scanFiles(legacyScanText);
    expect(legacy.length).toBeGreaterThan(0);
    expect(legacy).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: fixture, line: 1, term: normalize(keyword) }),
      ])
    );
    expect(scanFiles(scanText)).toEqual(legacy);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 45000);

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

test('package share threshold is inclusive; redundant exceptions are informational without node_modules', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'generic-core-'));
  try {
    fs.writeFileSync(path.join(root, 'core.js'), '// commonword rareword\n');
    fs.writeFileSync(
      path.join(root, 'generic.json'),
      JSON.stringify({
        terms: [
          { term: 'commonword', packageShare: 0.05 },
          { term: 'rareword', packageShare: 0.049 },
        ],
      })
    );
    fs.writeFileSync(
      path.join(root, 'allow.json'),
      JSON.stringify({ entries: [{ term: 'commonword', reason: 'Existing neutral exception' }] })
    );
    const config = {
      corePaths: ['core.js'],
      allowlist: 'allow.json',
      genericVocabulary: 'generic.json',
    };
    const report = checkCore({
      root,
      config,
      catalogs: {
        capabilities: [{ keywords: ['commonword', 'rareword'] }],
      },
    });
    expect(fs.existsSync(path.join(root, 'node_modules'))).toBe(false);
    expect(report.automaticallyExemptedCount).toBe(1);
    expect(report.findings).toEqual([{ file: 'core.js', line: 1, term: 'rareword' }]);
    expect(report.redundantAllowlistEntries).toHaveLength(1);
    fs.writeFileSync(path.join(root, 'core.js'), '// commonword\n');
    expect(
      checkCore({
        root,
        config,
        catalogs: {
          capabilities: [{ keywords: ['commonword'] }],
        },
      }).findings
    ).toEqual([]);
    // Exercise the real CLI in a stand-alone tree with neutral catalogs and no dependencies.
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.mkdirSync(path.join(root, 'src'));
    fs.copyFileSync(
      path.join(ROOT, 'scripts/check-domain-free-core.js'),
      path.join(root, 'scripts/check-domain-free-core.js')
    );
    fs.copyFileSync(
      path.join(ROOT, 'src/canonical-order.js'),
      path.join(root, 'src/canonical-order.js')
    );
    fs.writeFileSync(
      path.join(root, 'src/capability-catalog.js'),
      "module.exports = { CURATED_CAPABILITIES: [{ keywords: ['commonword', 'rareword'] }] };\n"
    );
    fs.writeFileSync(
      path.join(root, 'src/semantic-domains.js'),
      'module.exports = { semanticDomains: [] };\n'
    );
    fs.writeFileSync(path.join(root, 'operation-capability-index.json'), '{"operations":[]}');
    fs.writeFileSync(
      path.join(root, 'scripts/domain-free-core.config.json'),
      JSON.stringify(config)
    );
    const cli = spawnSync(process.execPath, ['scripts/check-domain-free-core.js'], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(cli.stderr).toBe('');
    expect(cli.status).toBe(0);
    expect(JSON.parse(cli.stdout).redundantAllowlistEntries).toHaveLength(1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('generator is byte deterministic with sorted scoped packages, bounded files and excluded code', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'generic-corpus-'));
  try {
    const write = (name, content) => {
      const location = path.join(root, 'node_modules', name);
      fs.mkdirSync(path.dirname(location), { recursive: true });
      fs.writeFileSync(location, content);
    };
    write('z-package/package.json', '{}');
    write('z-package/b.js', '// overflowword');
    write('z-package/a.js', '// commonword');
    write('z-package/a.min.js', '// minifiedword');
    write('z-package/node_modules/nested/a.js', '// nestedword');
    write('z-package/a.txt', '// textword');
    write('@scope/a-package/package.json', '{}');
    write('@scope/a-package/a.js', '// commonword rareword');
    const config = {
      genericVocabulary: 'generic.json',
      minimumLength: 5,
      genericPackageShare: 0.75,
      referenceCorpus: {
        maxFilesPerPackage: 1,
        extensions: ['.js'],
        generatedAt: '2026-10-03T00:00:00.000Z',
      },
    };
    const catalogs = {
      capabilities: [
        {
          keywords: [
            'commonword',
            'rareword',
            'overflowword',
            'minifiedword',
            'nestedword',
            'textword',
          ],
        },
      ],
    };
    const first = generateVocabulary({ root, config, catalogs });
    const bytes = fs.readFileSync(path.join(root, 'generic.json'));
    generateVocabulary({ root, config, catalogs });
    expect(fs.readFileSync(path.join(root, 'generic.json'))).toEqual(bytes);
    expect(first.artifact.packageCount).toBe(2);
    expect(first.artifact.fileCount).toBe(2);
    expect(first.artifact.terms).toEqual([
      { term: 'commonword', packageCount: 2, packageShare: 1 },
    ]);
    expect(first.measurements.find(({ term }) => term === 'rareword').packageShare).toBe(0.5);
    for (const term of ['overflowword', 'minifiedword', 'nestedword', 'textword'])
      expect(first.measurements.find((entry) => entry.term === term).packageShare).toBe(0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('committed neutral corpus never exempts the domain regression sample', () => {
  const generic = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'scripts/domain-free-core.generic-vocabulary.json'), 'utf8')
  );
  for (const term of [
    'redispatch',
    'mastr',
    'bilanzkreis',
    'forecast',
    'tariff',
    'metering',
    'energy',
  ])
    expect(generic.terms.map((entry) => entry.term)).not.toContain(term);
});
