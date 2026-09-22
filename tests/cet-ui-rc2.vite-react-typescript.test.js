'use strict';

const fs = require('fs');
const path = require('path');

const appRoot = path.join(__dirname, '..', 'apps', 'cet-ui');

function read(relativePath) {
  return fs.readFileSync(path.join(appRoot, relativePath), 'utf8');
}

describe('CET UI RC2 Vite React TypeScript structure', () => {
  test('uses the planned Vite React TypeScript app shell instead of the legacy static script shell', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.type).toBe('commonjs');
    expect(pkg.scripts.check).toContain('tsc --noEmit');
    expect(pkg.scripts.build).toContain('vite build');
    expect(pkg.dependencies).toHaveProperty('react');
    expect(pkg.dependencies).toHaveProperty('react-dom');
    expect(pkg.devDependencies).toHaveProperty('vite');
    expect(pkg.devDependencies).toHaveProperty('typescript');
    expect(pkg.devDependencies).toHaveProperty('@vitejs/plugin-react');

    expect(fs.existsSync(path.join(appRoot, 'vite.config.ts'))).toBe(true);
    expect(fs.existsSync(path.join(appRoot, 'tsconfig.json'))).toBe(true);
    expect(fs.existsSync(path.join(appRoot, 'src', 'main.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(appRoot, 'src', 'App.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(appRoot, 'src', 'main.js'))).toBe(false);

    const index = read('index.html');
    expect(index).toContain('<div id="root"></div>');
    expect(index).toContain('type="module"');
    expect(index).toContain('/src/main.tsx');
    expect(index).not.toContain('./src/main.js');
  });

  test('React shell keeps the RC2 Feinkonzept boundaries visible in source', () => {
    const appSource = read('src/App.tsx');
    expect(appSource).toContain('Vorgang');
    expect(appSource).toContain('Tagesfläche');
    expect(appSource).toContain('Nachweisansicht');
    expect(appSource).toContain('Operationskonsole');
    expect(appSource).toContain('Nicht projiziert');
    expect(appSource).toContain('recordViewOpened');
    expect(appSource).toContain('getBrowserAuthConfig');
    expect(appSource).toContain('__CET_UI_AUTH__');
    expect(appSource).toContain('headers.Authorization =');
    expect(appSource).not.toMatch(/Zur Kenntnis|Next Best Action|CET entscheidet/);
    expect(appSource).not.toMatch(/moleculer|RC1|rc1/i);
  });

  test('React write actions refresh canonical view models after gateway mutation envelopes', () => {
    const appSource = read('src/App.tsx');
    expect(appSource).toContain('async function refreshCaseViews(caseId: string)');
    expect(appSource).toContain('await client.claimCase(caseId);');
    expect(appSource).toContain('await refreshCaseViews(caseId);');
    expect(appSource).toContain('await client.freezeCase(caseId, {});');
    expect(appSource).toContain('await client.requestApproval(caseId, {});');
    expect(appSource).not.toContain('const vorgang = await client.claimCase(caseId);');
    expect(appSource).not.toContain('const evidence = await client.freezeCase(caseId, {});');
    expect(appSource).not.toContain('const evidence = await client.requestApproval(caseId, {});');
  });
});
