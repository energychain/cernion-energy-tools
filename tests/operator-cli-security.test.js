'use strict';

const { uatBaseUrl, jobPath, logRecord } = require('../src/operator-cli-security');

describe('operator UAT transport and logs', () => {
  test('requires explicit TLS for remote origins and permits local HTTP only', () => {
    expect(uatBaseUrl('https://uat.example.test:8443')).toBe('https://uat.example.test:8443');
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      expect(uatBaseUrl(`http://${host}:3900/`)).toBe(`http://${host}:3900`);
    }
    for (const input of [
      undefined,
      'not-a-url',
      'http://10.0.0.8:3900',
      'http://localhost.attacker.test',
      'https://user:password@uat.example.test',
      'https://uat.example.test/?token=secret',
      'https://uat.example.test/#secret',
      'file:///tmp/socket',
      'https://uat.example.test/api',
    ]) {
      expect(() => uatBaseUrl(input)).toThrow();
    }
  });

  test('keeps server-supplied job IDs within the intended route', () => {
    expect(jobPath('job-a_b-001', 'status')).toBe('/api/jobs/job-a_b-001/status');
    expect(jobPath('job-a_b-001', 'result')).toBe('/api/jobs/job-a_b-001/result');
    for (const id of [
      '..',
      '../admin',
      '//attacker.test',
      'https://attacker.test',
      'id?token=secret',
      'id%2fadmin',
      'id\\admin',
      '',
      'x'.repeat(161),
      null,
    ]) {
      expect(() => jobPath(id, 'status')).toThrow();
    }
    expect(() => jobPath('job-id', '../admin')).toThrow();
  });

  test('encodes forged newlines and terminal controls and redacts nested secrets', () => {
    const text = 'trusted\n[INFO] forged\r\u001b[31m';
    const record = logRecord('reply', {
      text,
      credentials: { password: 'secret', accessToken: 'token' },
    });
    expect(record).not.toMatch(/[\r\n\u001b]/);
    expect(record).not.toContain('"secret"');
    expect(record).not.toContain('"token"');
    expect(JSON.parse(record)).toEqual({
      event: 'reply',
      data: { text, credentials: { password: '[REDACTED]', accessToken: '[REDACTED]' } },
    });
    const cyclic = {};
    cyclic.self = cyclic;
    expect(JSON.parse(logRecord('reply', [cyclic])).data[0].self).toBe('[Unserializable]');
  });
});
