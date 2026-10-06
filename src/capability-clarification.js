'use strict';

const { getFunctionModel } = require('./function-model');

// Choices are derived only from the visible case's persisted candidates, never
// from a client-supplied capability ID. A choice selects work, not execution rights.
function choiceCandidates(classification, model = getFunctionModel()) {
  const seen = new Set();
  return (classification.candidateCapabilities || [])
    .map((candidate) => {
      const fn = model.functions.find((row) => row.capabilities.includes(candidate.capability));
      const label = fn?.displayLabel || fn?.label || 'Weitere Klärung';
      if (seen.has(label)) return null;
      seen.add(label);
      return { candidate, label };
    })
    .filter(Boolean)
    .slice(0, 5);
}

function confirmedCapability(message, previous, model) {
  const classification = previous?.lastClassification;
  if (!classification?.uncertain) return null;
  const choices = choiceCandidates(classification, model);
  const value = String(message).trim();
  let end = value.length;
  while (end && (value[end - 1] === '.' || value[end - 1] === '!')) end--;
  const text = value.slice(0, end);
  const number = /^(?:nummer\s+|number\s+)?([1-5])$/i.exec(text);
  return number
    ? choices[Number(number[1]) - 1]?.candidate || null
    : choices.find((choice) => choice.label.toLocaleLowerCase() === text.toLocaleLowerCase())
        ?.candidate || null;
}

function choiceText(classification, model) {
  const choices = choiceCandidates(classification, model);
  return choices.length
    ? `Welche Funktion passt zu deinem Anliegen? Antworte mit der Nummer oder dem Namen:\n${choices
        .map((choice, index) => `${index + 1}. ${choice.label}`)
        .join('\n')}`
    : 'Bitte beschreibe genauer, welche Tätigkeit du in diesem Fall bearbeiten möchtest.';
}

module.exports = { choiceCandidates, confirmedCapability, choiceText };
