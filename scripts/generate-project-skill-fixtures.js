'use strict';

function generateProjectSkillScenarios(scenario, turn) {
  return [
    {
      id: 'a',
      subject: 'Standort Nord',
      title: 'Projekt A',
      column: 'Leistung',
      unit: 'kW',
      value: 23,
      key: 'Bezug-A',
    },
    {
      id: 'b',
      subject: 'Depot West',
      title: 'Projekt B',
      column: 'Bestand',
      unit: 'kg',
      value: 29,
      key: 'Bezug-B',
    },
  ].map((spec) => {
    const question = `Wie hoch war das Maximum der ${spec.column} am ${spec.subject} 2025?`;
    const original = {
      projectEvidence: { selected: true, title: spec.title, file: `${spec.subject}.csv` },
      numeric: [{ value: spec.value, tolerance: 0 }],
    };
    return scenario(
      `project-skill-${spec.id}`,
      'B.4',
      'Wiederkehrende Aktenfrage wird zum gelernten Check',
      [
        turn('first', question, 'Originalantwort belegt', original, { dataQuestion: true }),
        turn(
          'second',
          `Welchen Höchstwert erreichte die ${spec.column} am ${spec.subject} 2025?`,
          'Bedeutungsähnliche Frage belegt',
          original,
          { dataQuestion: true, waitForProjectSkills: true }
        ),
        turn(
          'third',
          question,
          'Automatisch geprüften Check sichtbar nutzen',
          {
            require: ['nach meinem gelernten Check'],
            numeric: original.numeric,
            projectSkill: { used: true },
          },
          { dataQuestion: true }
        ),
        turn(
          'status',
          `Welche Skills hast du für ${spec.title} gelernt?`,
          'Anlass und Aktivierung aus Register und Journal',
          { require: ['aktiv', 'bedeutungsähnliche belegte Fragen', 'angelegt', 'geprüft'] }
        ),
        turn('incorrect', 'passt nicht', 'Korrektur degradiert und entwirft neu', {
          require: ['herabgestuft', 'Journal'],
        }),
        turn('retire', 'Check stilllegen', 'Check wird stillgelegt', {
          require: ['stillgelegt', 'Journal'],
        }),
        turn(
          'after',
          question,
          'Stillgelegter Check wird nicht mehr genutzt',
          { ...original, projectSkill: { used: false }, forbid: ['nach meinem gelernten Check'] },
          { dataQuestion: true }
        ),
        turn(
          'unrelated',
          'Wie ist die Temperatur am Standort C?',
          'Unpassende Frage nutzt keinen Check',
          { projectSkill: { used: false }, forbid: ['nach meinem gelernten Check'] }
        ),
      ],
      {
        projectFixtures: [{ ...spec, timestamps: ['2025-01-01T00:00:00', '2025-03-01T00:00:00'] }],
        learnedSkills: true,
      }
    );
  });
}
function projectSkillChecks(rule, reply) {
  return [
    {
      id: 'project-skill-used',
      passed: Boolean(reply.learnedSkill?.skillId) === rule.used,
      reason: 'Nur ein tatsächlich ausgeführter aktiver Check wird genannt',
    },
  ];
}
module.exports = { generateProjectSkillScenarios, projectSkillChecks };
