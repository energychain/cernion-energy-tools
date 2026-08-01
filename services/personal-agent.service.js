'use strict';

const { DEFAULT_SYSTEM_PROMPT } = require('./personal-agent/shared');

module.exports = {
  name: 'personal-agent',

  settings: {
    maxContextTokens: Number(process.env.PERSONAL_AGENT_MAX_CONTEXT_TOKENS || 128_000),
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
  },

  actions: {
    ...require('./personal-agent/actions-part-01-of-1.js'),
  },

  methods: {
    ...require('./personal-agent/methods-part-01-of-11.js'),
    ...require('./personal-agent/methods-part-02-of-11.js'),
    ...require('./personal-agent/methods-part-03-of-11.js'),
    ...require('./personal-agent/methods-part-04-of-11.js'),
    ...require('./personal-agent/methods-part-05-of-11.js'),
    ...require('./personal-agent/methods-part-06-of-11.js'),
    ...require('./personal-agent/methods-part-07-of-11.js'),
    ...require('./personal-agent/methods-part-08-of-11.js'),
    ...require('./personal-agent/methods-part-09-of-11.js'),
    ...require('./personal-agent/methods-part-10-of-11.js'),
    ...require('./personal-agent/methods-part-11-of-11.js'),
  },
};
