'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const servicesDir = path.join(ROOT, 'services');
const files = fs
  .readdirSync(servicesDir)
  .filter((f) => f.endsWith('.service.js') && f !== 'api.service.js');

let totalIssues = 0;
let totalWarnings = 0;

files.forEach((fname) => {
  const svc = require(path.join(servicesDir, fname));
  Object.entries(svc.actions || {}).forEach(([name, action]) => {
    if (!action.rest) return;
    let method = 'POST';
    let endpoint = '/';
    if (typeof action.rest === 'string') {
      const parts = action.rest.split(' ');
      method = parts[0] || method;
      endpoint = parts[1] || endpoint;
    } else if (typeof action.rest === 'object') {
      method = action.rest.method || method;
      endpoint = action.rest.path || endpoint;
    }
    const ob = action.openapi;
    if (!ob) {
      // Legacy services without OpenAPI are tracked as warning debt, not release blocker.
      console.log('NO_OPENAPI_WARN  ' + fname + '  ' + name);
      totalWarnings++;
      return;
    }

    const issues = [];

    if (method === 'POST') {
      const nonBodyParams = (ob.parameters || [])
        .filter(function (p) {
          return p && (p.in === 'path' || p.in === 'query');
        })
        .map(function (p) {
          return p.name;
        });
      const bodyParamEntries = Object.entries(action.params || {}).filter(function (e) {
        const key = e[0];
        if (key.startsWith('$$')) return false;
        return nonBodyParams.indexOf(key) === -1;
      });
      const needsRequestBody = bodyParamEntries.length > 0;

      const rb = ob.requestBody;
      if (!rb) {
        if (needsRequestBody) {
          totalWarnings++;
          console.log(
            'OPENAPI_WARN ' +
              fname +
              ' [' +
              method +
              ' ' +
              endpoint +
              '] ' +
              name +
              ' MISSING requestBody'
          );
        }
      } else {
        const schema =
          (rb.content && rb.content['application/json'] && rb.content['application/json'].schema) ||
          null;
        if (!schema) {
          if (needsRequestBody) {
            totalWarnings++;
            console.log(
              'OPENAPI_WARN ' +
                fname +
                ' [' +
                method +
                ' ' +
                endpoint +
                '] ' +
                name +
                ' MISSING schema in requestBody'
            );
          }
        } else {
          // Check required[] matches params that are not optional
          const requiredParams = bodyParamEntries
            .filter(function (e) {
              const def = e[1];
              if (Array.isArray(def)) {
                // multi-type union; treat as optional if any branch is optional
                const hasOptionalBranch = def.some(function (r) {
                  return r && typeof r === 'object' && r.optional === true;
                });
                return !hasOptionalBranch;
              }
              if (typeof def !== 'object' || def === null) return true;
              // params with defaults are effectively optional for request bodies
              if (def.default !== undefined) return false;
              return !def.optional;
            })
            .map(function (e) {
              return e[0];
            });
          const schemaRequired = schema.required || [];
          const missingFromRequired = requiredParams.filter(function (k) {
            return schemaRequired.indexOf(k) === -1;
          });
          if (missingFromRequired.length > 0) {
            issues.push('required[] missing fields: ' + missingFromRequired.join(', '));
          }
          const extraInRequired = schemaRequired.filter(function (k) {
            return requiredParams.indexOf(k) === -1;
          });
          if (extraInRequired.length > 0) {
            issues.push('required[] has optional fields: ' + extraInRequired.join(', '));
          }

          // Legacy compatibility: examples/defaults are currently advisory-only.
          const props = schema.properties || {};
          const noExampleNoDefault = Object.entries(props)
            .filter(function (e) {
              const v = e[1];
              return v.example === undefined && v.default === undefined;
            })
            .map(function (e) {
              return e[0];
            });
          if (noExampleNoDefault.length > 0) {
            totalWarnings++;
            console.log(
              'OPENAPI_WARN ' +
                fname +
                ' [' +
                method +
                ' ' +
                endpoint +
                '] ' +
                name +
                ' no example/default on: ' +
                noExampleNoDefault.join(', ')
            );
          }
        }

        // Legacy compatibility: requestBody examples are advisory-only.
        const examples =
          rb.content && rb.content['application/json'] && rb.content['application/json'].examples;
        if ((!examples || Object.keys(examples).length === 0) && needsRequestBody) {
          totalWarnings++;
          console.log(
            'OPENAPI_WARN ' +
              fname +
              ' [' +
              method +
              ' ' +
              endpoint +
              '] ' +
              name +
              ' MISSING request body examples'
          );
        }
      }
    }

    if (method === 'GET') {
      // GET: check parameters array if params exist
      const paramKeys = Object.keys(action.params || {}).filter(function (k) {
        return !k.startsWith('$$');
      });
      if (paramKeys.length > 0) {
        const oaParams = ob.parameters || [];
        const documented = oaParams.map(function (p) {
          return p.name;
        });
        const missing = paramKeys.filter(function (k) {
          return documented.indexOf(k) === -1;
        });
        if (missing.length > 0) {
          issues.push('GET params not in openapi parameters[]: ' + missing.join(', '));
        }
        // Legacy compatibility: GET examples/defaults are advisory-only.
        const noEx = oaParams
          .filter(function (p) {
            return p.schema && p.schema.example === undefined && p.schema.default === undefined;
          })
          .map(function (p) {
            return p.name;
          });
        if (noEx.length > 0) {
          totalWarnings++;
          console.log(
            'OPENAPI_WARN ' +
              fname +
              ' [' +
              method +
              ' ' +
              endpoint +
              '] ' +
              name +
              ' GET params missing example/default: ' +
              noEx.join(', ')
          );
        }
      }
    }

    if (issues.length > 0) {
      totalIssues += issues.length;
      console.log('\n' + fname + '  [' + method + ' ' + endpoint + ']  ' + name);
      issues.forEach(function (i) {
        console.log('  ❌ ' + i);
      });
    }
  });
});

console.log('\n=== Total issues: ' + totalIssues + ' ===');
console.log('=== Total warnings: ' + totalWarnings + ' ===');

if (totalIssues > 0) {
  process.exitCode = 1;
}
