'use strict';

// In-process capability; HTTP/JSON callers cannot manufacture this identity.
const writeCapability = Symbol('tenant-memory-write');
module.exports = { writeCapability };
