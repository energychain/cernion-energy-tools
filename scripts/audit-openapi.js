'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const servicesDir = path.join(ROOT, 'services');
const files = fs.readdirSync(servicesDir).filter(f => f.endsWith('.service.js') && f !== 'api.service.js');

let totalIssues = 0;

files.forEach(fname => {
  const svc = require(path.join(servicesDir, fname));
  Object.entries(svc.actions || {}).forEach(([name, action]) => {
    if (!action.rest) return;
    const method = action.rest.split(' ')[0];
    const endpoint = action.rest.split(' ')[1];
    const ob = action.openapi;
    if (!ob) {
      console.log('NO_OPENAPI  ' + fname + '  ' + name);
      totalIssues++;
      return;
    }

    const issues = [];

    if (method === 'POST') {
      const rb = ob.requestBody;
      if (!rb) {
        issues.push('MISSING requestBody');
      } else {
        const schema = (rb.content && rb.content['application/json'] && rb.content['application/json'].schema) || null;
        if (!schema) {
          issues.push('MISSING schema in requestBody');
        } else {
          // Check required[] matches params that are not optional
          const requiredParams = Object.entries(action.params || {}).filter(function(e) { return !e[1].optional; }).map(function(e) { return e[0]; });
          const schemaRequired = schema.required || [];
          const missingFromRequired = requiredParams.filter(function(k) { return schemaRequired.indexOf(k) === -1; });
          if (missingFromRequired.length > 0) {
            issues.push('required[] missing fields: ' + missingFromRequired.join(', '));
          }
          const extraInRequired = schemaRequired.filter(function(k) { return requiredParams.indexOf(k) === -1; });
          if (extraInRequired.length > 0) {
            issues.push('required[] has optional fields: ' + extraInRequired.join(', '));
          }
          // Check properties have examples or defaults
          const props = schema.properties || {};
          const noExampleNoDefault = Object.entries(props).filter(function(e) {
            const v = e[1];
            return v.example === undefined && v.default === undefined;
          }).map(function(e) { return e[0]; });
          if (noExampleNoDefault.length > 0) {
            issues.push('no example/default on: ' + noExampleNoDefault.join(', '));
          }
        }
        // Check request body examples
        const examples = rb.content && rb.content['application/json'] && rb.content['application/json'].examples;
        if (!examples || Object.keys(examples).length === 0) {
          issues.push('MISSING request body examples');
        }
      }
    }

    if (method === 'GET') {
      // GET: check parameters array if params exist
      const paramKeys = Object.keys(action.params || {});
      if (paramKeys.length > 0) {
        const oaParams = ob.parameters || [];
        const documented = oaParams.map(function(p) { return p.name; });
        const missing = paramKeys.filter(function(k) { return documented.indexOf(k) === -1; });
        if (missing.length > 0) {
          issues.push('GET params not in openapi parameters[]: ' + missing.join(', '));
        }
        // Check examples on each param
        const noEx = oaParams.filter(function(p) {
          return p.schema && p.schema.example === undefined && p.schema.default === undefined;
        }).map(function(p) { return p.name; });
        if (noEx.length > 0) {
          issues.push('GET params missing example/default: ' + noEx.join(', '));
        }
      }
    }

    if (issues.length > 0) {
      totalIssues += issues.length;
      console.log('\n' + fname + '  [' + method + ' ' + endpoint + ']  ' + name);
      issues.forEach(function(i) { console.log('  ❌ ' + i); });
    }
  });
});

console.log('\n=== Total issues: ' + totalIssues + ' ===');
