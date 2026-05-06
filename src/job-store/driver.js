/**
 * Job store driver interface.
 *
 * Drivers must implement synchronous methods to preserve existing service
 * contracts used across the codebase.
 */

'use strict';

class JobStoreDriver {
  createJob() {
    throw new Error('Not implemented: createJob');
  }

  updateJob() {
    throw new Error('Not implemented: updateJob');
  }

  appendLog() {
    throw new Error('Not implemented: appendLog');
  }

  saveResult() {
    throw new Error('Not implemented: saveResult');
  }

  getJob() {
    throw new Error('Not implemented: getJob');
  }

  getResult() {
    throw new Error('Not implemented: getResult');
  }

  gcExpired() {
    throw new Error('Not implemented: gcExpired');
  }

  getInfo() {
    return { name: 'unknown' };
  }
}

module.exports = JobStoreDriver;
