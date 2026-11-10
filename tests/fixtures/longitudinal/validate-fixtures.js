"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = __dirname;

function walk(dir, name) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(full, name));
    if (entry.isFile() && entry.name === name) found.push(full);
  }
  return found;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(file) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
}

const scenarioFiles = walk(root, "scenario.json");
assert(scenarioFiles.length > 0, "No longitudinal scenario.json files found");

for (const scenarioFile of scenarioFiles) {
  const dir = path.dirname(scenarioFile);
  const scenario = JSON.parse(fs.readFileSync(scenarioFile, "utf8"));
  const challengeFile = path.join(dir, "challenge.json");
  assert(
    fs.existsSync(challengeFile),
    `${scenario.id}: challenge.json missing`,
  );
  const challenge = JSON.parse(fs.readFileSync(challengeFile, "utf8"));

  assert(scenario.synthetic === true, `${scenario.id}: synthetic must be true`);
  assert(
    Array.isArray(scenario.turns),
    `${scenario.id}: turns must be an array`,
  );
  assert(
    scenario.turns.length >= 12 && scenario.turns.length <= 20,
    `${scenario.id}: expected 12–20 turns, got ${scenario.turns.length}`,
  );
  assert(
    challenge.turns.length === scenario.turns.length,
    `${scenario.id}: challenge turn mismatch`,
  );

  const expectedIds = scenario.turns.map(
    (_, i) => `T${String(i + 1).padStart(2, "0")}`,
  );
  assert(
    JSON.stringify(scenario.turns.map((t) => t.id)) ===
      JSON.stringify(expectedIds),
    `${scenario.id}: turn IDs must be sequential`,
  );

  for (let i = 0; i < scenario.turns.length; i += 1) {
    const turn = scenario.turns[i];
    const cleanTurn = challenge.turns[i];
    assert(
      turn.text && typeof turn.text === "string",
      `${scenario.id}/${turn.id}: text missing`,
    );
    assert(
      turn.expected &&
        Array.isArray(turn.expected.must_include) &&
        turn.expected.must_include.length > 0,
      `${scenario.id}/${turn.id}: expected.must_include missing`,
    );
    assert(
      Array.isArray(turn.hard_fail) && turn.hard_fail.length > 0,
      `${scenario.id}/${turn.id}: hard_fail missing`,
    );
    assert(
      !("expected" in cleanTurn),
      `${scenario.id}/${turn.id}: evaluator data leaked to challenge`,
    );
    assert(
      !("hard_fail" in cleanTurn),
      `${scenario.id}/${turn.id}: hard-fail data leaked to challenge`,
    );
    assert(
      cleanTurn.text === turn.text,
      `${scenario.id}/${turn.id}: challenge text differs`,
    );

    for (const attachment of turn.attachments || []) {
      assert(
        fs.existsSync(path.join(dir, attachment)),
        `${scenario.id}/${turn.id}: missing ${attachment}`,
      );
    }
  }

  for (const source of scenario.knowledge_sources || []) {
    assert(
      fs.existsSync(path.join(dir, source)),
      `${scenario.id}: missing knowledge source ${source}`,
    );
  }

  console.log(
    JSON.stringify({
      scenario: scenario.id,
      turns: scenario.turns.length,
      challenge_sha256: sha256(challengeFile),
      scenario_sha256: sha256(scenarioFile),
      status: "valid",
    }),
  );
}
