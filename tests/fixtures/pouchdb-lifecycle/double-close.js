'use strict';

const { createPouchDbLifecycleMixin } = require('../../../src/pouchdb-lifecycle-mixin');

module.exports = {
  name: 'contaminated',
  mixins: [createPouchDbLifecycleMixin({ defaultDbPath: './unused', dbProperty: 'store' })],
  async stopped() {
    await this.store.close();
  },
};
