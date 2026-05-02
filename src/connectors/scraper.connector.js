/**
 * Web Scraper Connector Plugin
 */

const axios = require('axios');

function ensureCheerio() {
  try {
    return require('cheerio');
  } catch {
    const e = new Error(
      'Scraper connector with cheerio engine requires optional dependency "cheerio".'
    );
    e.code = 'SCRAPER_DEPENDENCY_MISSING';
    throw e;
  }
}

async function runCheerioEngine(connectorConfig) {
  const cheerio = ensureCheerio();
  const response = await axios.get(connectorConfig.url, {
    timeout: Number(process.env.DATASOURCE_SCRAPER_TIMEOUT_MS || 30000),
    headers: connectorConfig.headers || {},
  });

  const $ = cheerio.load(String(response.data || ''));
  const tableSelector = connectorConfig.tableSelector || 'table';
  const rows = [];

  $(`${tableSelector} tr`).each((_, tr) => {
    const cells = [];
    $(tr)
      .find('th,td')
      .each((__, cell) => {
        cells.push($(cell).text().trim());
      });

    if (cells.length) {
      const row = {};
      cells.forEach((value, idx) => {
        row[`column_${idx + 1}`] = value;
      });
      rows.push(row);
    }
  });

  return rows;
}

async function runPuppeteerEngine(connectorConfig) {
  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch {
    const e = new Error(
      'Scraper connector with puppeteer engine requires optional dependency "puppeteer".'
    );
    e.code = 'SCRAPER_DEPENDENCY_MISSING';
    throw e;
  }

  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const timeout = Number(process.env.DATASOURCE_SCRAPER_TIMEOUT_MS || 30000);
    await page.goto(connectorConfig.url, { waitUntil: 'networkidle2', timeout });

    if (connectorConfig.waitForSelector) {
      await page.waitForSelector(connectorConfig.waitForSelector, { timeout });
    }

    const tableSelector = connectorConfig.tableSelector || 'table';
    return await page.$$eval(`${tableSelector} tr`, (trs) =>
      trs
        .map((tr) =>
          Array.from(tr.querySelectorAll('th,td')).map((el) => el.textContent?.trim() || '')
        )
        .filter((cells) => cells.length > 0)
        .map((cells) => {
          const out = {};
          cells.forEach((value, idx) => {
            out[`column_${idx + 1}`] = value;
          });
          return out;
        })
    );
  } finally {
    await browser.close();
  }
}

module.exports = {
  type: 'scraper',
  description: 'Extract table data from web pages via cheerio or puppeteer engines.',
  configSchema: {
    type: 'object',
    required: ['url'],
    properties: {
      url: { type: 'string' },
      engine: { type: 'string', enum: ['puppeteer', 'cheerio'] },
      waitForSelector: { type: 'string' },
      tableSelector: { type: 'string' },
      rowMapping: { type: 'object' },
      loginSteps: { type: 'array' },
      headers: { type: 'object' },
    },
  },

  async read(connectorConfig) {
    const engine = connectorConfig.engine || 'cheerio';

    const rows =
      engine === 'puppeteer'
        ? await runPuppeteerEngine(connectorConfig)
        : await runCheerioEngine(connectorConfig);

    return {
      rows,
      inferredSchema: {
        fields: rows.length
          ? Object.keys(rows[0]).map((name) => ({
              name,
              type: 'string',
              example: rows[0][name],
            }))
          : [],
      },
    };
  },
};
