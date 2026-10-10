'use strict';

const { Errors } = require('moleculer');
const { cleanString } = require('./workbench-contract');

function normalizeMappingEmail(value) {
  const email = cleanString(value, 'externalUserEmail', { max: 254 });
  if (!email) return undefined;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Errors.MoleculerClientError(
      'A valid email address is required.',
      422,
      'WORKBENCH_CONTRACT_INVALID'
    );
  }
  return email.toLowerCase();
}

module.exports = { normalizeMappingEmail };
