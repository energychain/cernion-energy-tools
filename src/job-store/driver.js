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

  findJobByIdempotencyKey() {
    throw new Error('Not implemented: findJobByIdempotencyKey');
  }

  updateJob() {
    throw new Error('Not implemented: updateJob');
  }

  deleteJob() {
    throw new Error('Not implemented: deleteJob');
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

  listJobs() {
    throw new Error('Not implemented: listJobs');
  }

  gcExpired() {
    throw new Error('Not implemented: gcExpired');
  }

  getInfo() {
    return { name: 'unknown' };
  }
}

module.exports = JobStoreDriver;
