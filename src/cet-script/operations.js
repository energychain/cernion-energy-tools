'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { fail } = require('./errors');
function operationIndex(index) {
  return (
    index ||
    JSON.parse(
      fs.readFileSync(path.join(__dirname, '../../operation-capability-index.json'), 'utf8')
    )
  );
}
function selectOperation(index, id, node) {
  const operation = index.operations?.find((entry) => entry.operationId === id);
  if (
    !operation ||
    !operation.action ||
    !Array.isArray(operation.sideEffects) ||
    operation.sideEffects.length ||
    !Array.isArray(operation.writesTo) ||
    operation.writesTo.length ||
    operation.consequenceLevel !== 'none' ||
    operation.agentable === false
  )
    fail('OPERATION_REJECTED', 'Operation is unavailable', node);
  return operation;
}
module.exports = { operationIndex, selectOperation };
