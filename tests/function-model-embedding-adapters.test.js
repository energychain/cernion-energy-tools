'use strict';

jest.mock('@google/generative-ai', () => {
  const embedContent = jest.fn(async () => ({ embedding: { values: [1, 0] } }));
  return {
    embedContent,
    GoogleGenerativeAI: jest.fn(() => ({ getGenerativeModel: jest.fn(() => ({ embedContent })) })),
  };
});
const { embedContent } = require('@google/generative-ai');
jest.mock('axios', () => ({
  post: jest.fn(async () => ({ data: { data: [{ embedding: [1, 0] }], embedding: [1, 0] } })),
}));

test('Gemini embedding dimension hint reaches provider request, default request is unchanged', async () => {
  const previous = process.env.LLM_API_KEY;
  process.env.LLM_API_KEY = 'fixture';
  try {
    const adapter = require('../src/adapters/gemini');
    await adapter.embeddings(['neutral'], { outputDimensionality: 768 });
    expect(embedContent).toHaveBeenLastCalledWith({
      content: { role: 'user', parts: [{ text: 'neutral' }] },
      outputDimensionality: 768,
    });
    await adapter.embeddings(['neutral']);
    expect(embedContent).toHaveBeenLastCalledWith('neutral');
  } finally {
    if (previous === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = previous;
  }
});

test('OpenAI-compatible adapters translate the optional dimension hint', async () => {
  const adapter = require('../src/adapters/openai-compat');
  await adapter.embeddings(['neutral'], { outputDimensionality: 768 });
  expect(require('axios').post).toHaveBeenLastCalledWith(
    expect.any(String),
    expect.objectContaining({ input: ['neutral'], dimensions: 768 }),
    expect.any(Object)
  );
  await adapter.embeddings(['neutral']);
  expect(require('axios').post.mock.calls.at(-1)[1]).not.toHaveProperty('dimensions');
});

test('local adapter retains native output rather than inventing a reduced vector', async () => {
  expect(
    await require('../src/adapters/ollama').embeddings(['neutral'], { outputDimensionality: 768 })
  ).toEqual([[1, 0]]);
  expect(require('axios').post.mock.calls.at(-1)[1]).not.toHaveProperty('dimensions');
});
