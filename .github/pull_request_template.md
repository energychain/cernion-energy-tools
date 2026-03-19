## Summary

<!-- Briefly describe what this PR changes and why. -->

## Type of Change

- [ ] feat: new feature
- [ ] fix: bug fix
- [ ] docs: documentation only
- [ ] refactor: code change without behavior change
- [ ] test: test updates
- [ ] chore: maintenance/configuration
- [ ] ci: workflow/pipeline change

## Scope

- [ ] API (`services/api.service.js`, OpenAPI aliases)
- [ ] Service logic (`services/*.service.js`)
- [ ] MCP integration (`src/mcp-client.js`, async polling)
- [ ] UI (`src/app.html`)
- [ ] Tests (`tests/`, `custom-tests/`)
- [ ] Docs (`README.md`, `CHANGELOG.md`, `docs/*`)
- [ ] Security/auth (`token-manager`, bearer/`ck_` handling)

## Quality Checklist

- [ ] I ran `npm run lint` (or confirmed existing baseline warnings only)
- [ ] I ran relevant tests (`npm run test`, `npm run test:unit:ci`, or focused suite)
- [ ] I validated OpenAPI (`npm run audit:openapi`) when API behavior/routes changed
- [ ] I considered security implications (input validation, auth, token leakage)
- [ ] I updated docs where needed
- [ ] I updated `CHANGELOG.md` under `Unreleased` when user-facing behavior changed

## Breaking Changes

- [ ] No
- [ ] Yes (describe below)

## Validation Evidence

<!-- Paste key output snippets (tests, lint, curl, screenshots). -->

## Linked Issues

<!-- Example: Closes #123 -->

## Additional Notes

<!-- Optional context for reviewers. -->
