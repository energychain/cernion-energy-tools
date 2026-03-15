const { execSync } = require('child_process');

const KNOWN_HIGH_EXCEPTIONS = new Map([
  [
    'xlsx',
    {
      note: 'Known upstream high advisory with no fix currently available.',
    },
  ],
]);

function runAuditJson() {
  try {
    return execSync('npm audit --json', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    return error.stdout || error.stderr || '';
  }
}

function parseAudit(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    console.error('Failed to parse npm audit JSON output.');
    process.exit(1);
  }
}

function collectVulnerabilities(audit) {
  const vulnerabilities = audit?.vulnerabilities || {};

  return Object.entries(vulnerabilities).map(([name, details]) => ({
    name,
    severity: details.severity || 'unknown',
    fixAvailable: details.fixAvailable || false,
    via: Array.isArray(details.via) ? details.via : [],
  }));
}

function formatEntry(entry) {
  const fixLabel = entry.fixAvailable ? 'fix available' : 'no fix available';
  return `- ${entry.name}: ${entry.severity} (${fixLabel})`;
}

const audit = parseAudit(runAuditJson());
const vulnerabilities = collectVulnerabilities(audit);
const criticalFindings = vulnerabilities.filter((entry) => entry.severity === 'critical');
const nonCriticalFindings = vulnerabilities.filter((entry) => entry.severity !== 'critical');

if (criticalFindings.length > 0) {
  console.error('Critical security findings detected:');
  criticalFindings.forEach((entry) => console.error(formatEntry(entry)));
  process.exit(1);
}

console.log('No critical security findings detected.');

if (nonCriticalFindings.length > 0) {
  console.log('Non-critical advisories present:');
  nonCriticalFindings.forEach((entry) => {
    const exception = KNOWN_HIGH_EXCEPTIONS.get(entry.name);
    if (exception) {
      console.log(`${formatEntry(entry)} — allowed exception: ${exception.note}`);
      return;
    }

    console.log(formatEntry(entry));
  });
}
