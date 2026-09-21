'use strict';

const fs = require('fs');
const path = require('path');

const {
  buildReferenceUiGateway,
  buildReferenceUiGatewayContext,
} = require('../src/cet-ui-rc2/ui-gateway-adapter');
const { RC2_ROLE_IDS } = require('../src/cet-ui-rc2/fixtures/reference-tenant');

function listSourceFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(fullPath);
    return /\.(js|jsx|ts|tsx)$/.test(entry.name) ? [fullPath] : [];
  });
}

describe('CET UI RC2 direct RC1 object leakage guard', () => {
  test('UI gateway adapter output does not expose direct RC1 governanceArchitecture fields', () => {
    const gateway = buildReferenceUiGateway();
    const context = buildReferenceUiGatewayContext({
      activeRoleId: RC2_ROLE_IDS.MARKTKOMMUNIKATION,
    });

    const outputs = [
      gateway.getSessionContext(context),
      gateway.getDailySurface(context),
      gateway.getCase(context, { caseId: 'vorgang-cr-lka-rv-001-article-id-change' }),
      gateway.listOperations(context),
    ];
    const serialized = JSON.stringify(outputs);

    expect(serialized).not.toContain('governanceArchitecture');
    expect(serialized).not.toContain('resolutionValue');
    expect(serialized).not.toContain('directRc1Object');
  });

  test('UI app source imports only UI-local helpers, not RC1 projection modules', () => {
    const srcDir = path.join(__dirname, '..', 'apps', 'cet-ui', 'src');
    const offenders = listSourceFiles(srcDir)
      .map((file) => ({ file, content: fs.readFileSync(file, 'utf8') }))
      .filter(({ content }) =>
        /from ['"]\.\.\/\.\.\/\.\.\/\.\.\/src\/cet-rc2-ui|require\(['"]\.\.\/\.\.\/\.\.\/\.\.\/src\/cet-rc2-ui/.test(
          content
        )
      )
      .map(({ file }) => path.relative(path.join(__dirname, '..'), file));

    expect(offenders).toEqual([]);
  });
});
