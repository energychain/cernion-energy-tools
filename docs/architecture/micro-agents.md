# Micro-agent tier: domain packs for the conversation

Status: Phase 0 (foundation). Switch: `WORKBENCH_MICRO_AGENTS` (`all` or a comma-separated tenant
list); off by default.

## Purpose

A colleague in a municipal utility does not first decide which department a question belongs to.
The micro-agent tier recognizes what the person and the attachments mention, finds the areas
that know something about it, lets them expand it in parallel, and hands the answer typed
findings with provenance instead of loose text. It also points out consequences for neighbouring
areas.

## Flow of a turn

1. **Recognition** (`src/micro-agents/recognizer.js`). Each pack's format detectors (`detect`)
   find the formats it knows. One fast model call then maps descriptive mentions to the declared
   object kinds. A mention counts only with a verbatim quote from the text. The concern itself is
   always an object.
2. **Responsibility** (`responsibility.js`). Packs are scored against the function model
   (`resolveFunctionsHybrid`, graded) and against the recognized objects. At most three packs are
   selected, and every recognized object is expanded by the packs that declare its kind. A
   standing pack (`standing: true`, the company's own knowledge) expands every concern in
   addition and takes none of the three places.
3. **Expansion** (`orchestrator.js`).
   - Stage 1: objects and concern, run in parallel through `broker.call` with timeouts.
   - Stage 2: follow-up objects from the packs' playbooks (`plan`).
4. **Consequences.** The packs whose functions neighbour the matched ones in the function graph
   are asked once whether the findings touch their area. At most two affected packs then expand
   the concern.
5. **Evidence.** Findings become answer-only evidence (`retrievalSource: 'micro-agent'`). It
   passes the same final scope, cross-case and data gate as the knowledge loop
   (`admitLoopEvidence`). A finding whose facts carry a `passage` is marked `keepWhole`: the
   answer receives it whole (up to 11,000 characters, outside the passage window), and the answer
   review and the authority gate read it as turn evidence, since the case update runs in parallel
   without it.

## Contract (`contract.js`)

An expander returns a finding:

```js
{
  facts: [{ statement, value?, unit?, role, basis, provenance: { source, ref?, quote? }, passage? }],
  relations: [{ from, rel, to }],             // answers | refers_to | belongs_to | expects | supersedes | affects
  expectations: [{ what, dueFactId?, basis }], // a due date only as a reference to an accepted fact
  negatives: [{ searched, scope, result }],    // a negative result always with its scope
  openQuestions: [{ question, resolves }],
  confidence,
}
```

The contract refuses:

- a fact without `provenance.source` (except `basis: 'model'`);
- a `deadline` fact whose basis is not `rule`, `source`, `person` or `case`, so the model can
  never set a deadline;
- a negative result without `searched` and `scope`.

`passage` is the literal wording a fact rests on when the answer must read it as a whole, such as
a section of a company method with its stations, role families and artefacts (up to 6,000
characters, at most 10,000 per finding). The evidence line shows it after `Wortlaut:`.

## Writing a pack

A pack is a module in `src/micro-agents/packs/<area>.js` plus a service
`services/micro-agent-<id>.service.js`:

```js
module.exports = {
  name: 'micro-agent.<id>',
  mixins: [createDomainPackMixin(require('../src/micro-agents/packs/<area>'))],
};
```

The module declares the following:

- `pack`, `label` and `description`. The description is read by the recognizer and by the
  consequence check, so it should name the area's subjects plainly.
- `functionDomains` and `functionServices`, which link the pack to functions of
  `function-model.json`.
- `objectKinds`: `{ kind, label, description, detect? }`. A `detect` function is a format check
  only (`packs/detectors.js`), never a word list.
- `expanders`: `{ [kind]: async (ctx, object, context) => finding }`. `concern` expands the
  question itself, and `context.consequenceOf` is set during the consequence check.
  `context.documents` carries the turn's attachments (`{ name, text }`, up to four, 60,000
  characters each), so an expander can parse the whole document an object was quoted from.
- `playbooks`: `[{ from: kind, next: (finding, object) => [object] }]`, the fixed dependencies
  of the area.

Rules for expanders:

- **Read-only.** Expanders call read actions of existing services and never write.
- **Bounded.** The mixin enforces the time budget. A slow or failing expander yields an empty
  finding with `failed`, never an error that stops the turn.
- **Facts with provenance.** Rules, deadlines and thresholds come from a rule table or a source,
  with that table or source as provenance.
- **Domain terms stay in packs.** `src/micro-agents/*.js` is checked by `check:domain-free-core`
  and `check:language-patterns`; `src/micro-agents/packs/` is not.

## Case agent: task register (`src/case-state.js`)

Tasks (`nextActions`) carry a stable `actionId`.

- **Scope.** A task continued under its id keeps its search space and period unless the update
  gives a `scopeChangeReason`.
- **Ending a task.** A task ends only through `taskUpdates` (`done`, `withdrawn`, `superseded`,
  each with a reason) or through a closed recommendation of the same wording. A task the update
  leaves out stays active.
- **Closed tasks.** A closed task returns only with `reopenReason`. Closed tasks appear in the case
  view as `closedTasks` and never as open points.

## Phases

| Phase | Content |
| --- | --- |
| 0 | contract, mixin, registry, recognition, responsibility, orchestrator, provenance check, task register, eleven pack skeletons |
| 1 | expanders on existing services, for every pack |
| 2 | playbooks and rule tables with source, for every pack |
| 3 | calibration of the consequence check over the function graph |
| 4 | tenant switch in production; answer-side provenance check (`provenance.js`) replaces the heuristic filters in the micro-agent path |
