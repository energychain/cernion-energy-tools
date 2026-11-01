# Role proposals (#1019 A1–A3)

CET learns who does what per function, in the four process roles of VDMI: **V** accountable, **D** performing, **M** contributing, **I** informed. Coverage (#695) stays the signal, VDMI the record. A learned role is never a permission: `domainsAllowed`, `sensitivityClearance` and RBAC stay authoritative.

## A1: role signals → proposal

- **Coverage:** per function, the strongest coverage of at least 0.5 becomes **D**, further coverage of at least 0.3 becomes **M** (one D per task, as VDMI requires). Confidence is the coverage score.
- **Stated responsibility:** an answer to a responsibility knowledge need (`contact`, #997) names who is accountable as **V** (`actorType: label`, confidence 0.7, verdict `stated`).
- Each signal is emitted as `vdmi.role.signal.v1`. Per function, `services/role-proposals.service.js` keeps one proposal with rows (actor, role, confidence, origins, evidence, confirmation). States: `observed`, `nominated` (a row with confidence ≥ 0.5), `confirmed`. Changes are emitted as `vdmi.role.proposal.changed.v1`.

## A2: confirmation in the chat

- In a normal turn, CET may ask **one** context question (shared with the cold-start question, `src/knowledge-elicitation.js`). An own pending role row comes first: „Kurze Rückfrage zur Zuständigkeit: Ich habe dich bei „Steuerbarkeit · Anlagen · Übergabe“ als durchführend eingeordnet …“. At most once per person and row per day; the name is the readable need label, never an identifier.
- The reply right after that question (within 6 h) is read by a graded model call (`role_question_answer`): `confirm`, `other_role` (with the role), `reject` or `unrelated`; confidence ≥ 0.7 and a literal basis from the message are required. A person's confirmed or corrected role is not overwritten by later observation.
- When every person's row is answered and at least one V or D is confirmed, corrected or stated, the proposal becomes `confirmed` and is recorded as an ad-hoc VDMI matrix (`vdmi.create`, `processId: function:<id>`); the proposal links `vdmiMatrixId`. Promoting it to a standard template stays the existing human path (`nominate` / `confirmNomination`).

## A3: routing by role

- The knowledge register asks open facts only of the **D** person of the need's function, once one is known.
- Confirmations of answers with wide reach go to the **V** person (not the answerer); **I** people receive the change as a tenant-memory notice without being asked.
- Without a known role, coverage decides as before.

## Access

- `GET /api/role-proposals` (admin): all proposals; `GET /api/role-proposals/mine`: the calling person's own rows only.
- `refresh`, `selectAsk` and `answer` are protected.

## Live check (synthetic)

Three people, observed coverage seeded as tool work would leave it (the harness performs no live tool reads for these questions). Person A was asked about the D row and answered „Ja, das mache ich.“ (confirmed); person C was asked about the M row and answered „Ich verantworte das.“ (corrected to V). The proposal became `confirmed` and was recorded as a VDMI matrix.

Open: a free statement such as „Für X ist Team Y zuständig“ is not yet linked to the responsibility need, so the V row from stated responsibilities only arises through the cold-start question (#997 follow-up: more readable need labels).
