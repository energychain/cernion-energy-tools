'use strict';

const fs = require('fs');
const path = require('path');

const appRoot = path.join(__dirname, '..', 'apps', 'cet-ui');

function read(relativePath) {
  return fs.readFileSync(path.join(appRoot, relativePath), 'utf8');
}

describe('CET UI RC2 browser smoke', () => {
  test('Vite React TypeScript shell wires the reference RC2 flow through the REST UI gateway', () => {
    const appSource = read('src/App.tsx');
    const index = read('index.html');

    expect(index).toContain('<div id="root"></div>');
    expect(index).toContain('/src/main.tsx');
    expect(appSource).toContain('/ui/v0/session-context');
    expect(appSource).toContain('/ui/v0/daily-surface');
    expect(appSource).toContain('/ui/v0/cases/');
    expect(appSource).toContain('/ui/v0/operations');
    expect(appSource).toContain('/ui/v0/audit-events');
    expect(appSource).toContain('claimCase');
    expect(appSource).toContain('freezeCase');
    expect(appSource).toContain('requestApproval');
    expect(appSource).toContain('runOperation');
    expect(appSource).toContain('Nicht projiziert');
    expect(appSource).toContain(
      'Rollenwechsel bleibt auf tatsächlich gehaltene Mandantenrollen begrenzt.'
    );
  });
});
