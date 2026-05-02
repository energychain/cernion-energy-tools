'use strict';

function normalize(values) {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    throw new Error('Profile values must sum to > 0');
  }
  return values.map((value) => Number((value / total).toFixed(8)));
}

function createDailyProfile(weightsByHour) {
  const values = [];
  for (const weight of weightsByHour) {
    values.push(weight, weight, weight, weight);
  }
  return normalize(values);
}

function determineSeason(dateString) {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid date');
  }

  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();

  if (month === 11 || month === 12 || month === 1 || month === 2) return 'winter';
  if (month === 3 && day <= 20) return 'winter';

  if (month === 5 && day >= 15) return 'summer';
  if (month >= 6 && month <= 8) return 'summer';
  if (month === 9 && day <= 14) return 'summer';

  return 'transition';
}

function determineDayType(dateString) {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid date');
  }

  const weekday = date.getUTCDay();
  if (weekday === 0) return 'sunday';
  if (weekday === 6) return 'saturday';
  return 'weekday';
}

const H0 = {
  winter: {
    weekday: createDailyProfile([
      0.6, 0.5, 0.5, 0.5, 0.6, 0.9, 1.4, 1.6, 1.1, 0.9, 0.8, 0.8, 0.9, 1.0, 1.0, 1.0, 1.1, 1.5, 1.8,
      1.9, 1.8, 1.4, 1.0, 0.7,
    ]),
    saturday: createDailyProfile([
      0.7, 0.6, 0.6, 0.6, 0.7, 0.8, 1.0, 1.1, 1.2, 1.3, 1.3, 1.4, 1.4, 1.3, 1.3, 1.2, 1.2, 1.3, 1.5,
      1.6, 1.5, 1.2, 0.9, 0.7,
    ]),
    sunday: createDailyProfile([
      0.7, 0.6, 0.6, 0.6, 0.6, 0.7, 0.8, 0.9, 1.1, 1.3, 1.4, 1.5, 1.5, 1.4, 1.4, 1.3, 1.3, 1.4, 1.6,
      1.7, 1.6, 1.3, 1.0, 0.8,
    ]),
  },
  summer: {
    weekday: createDailyProfile([
      0.5, 0.4, 0.4, 0.4, 0.5, 0.7, 1.1, 1.2, 0.9, 0.8, 0.8, 0.8, 0.9, 1.0, 1.0, 1.0, 1.1, 1.3, 1.4,
      1.5, 1.4, 1.1, 0.8, 0.6,
    ]),
    saturday: createDailyProfile([
      0.6, 0.5, 0.5, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.3, 1.3, 1.2, 1.2, 1.2, 1.3, 1.4,
      1.4, 1.3, 1.0, 0.8, 0.6,
    ]),
    sunday: createDailyProfile([
      0.6, 0.5, 0.5, 0.5, 0.6, 0.6, 0.7, 0.8, 1.0, 1.2, 1.3, 1.4, 1.4, 1.4, 1.3, 1.3, 1.3, 1.4, 1.4,
      1.4, 1.3, 1.0, 0.8, 0.7,
    ]),
  },
  transition: {
    weekday: createDailyProfile([
      0.6, 0.5, 0.5, 0.5, 0.6, 0.8, 1.3, 1.4, 1.0, 0.9, 0.8, 0.8, 0.9, 1.0, 1.0, 1.0, 1.1, 1.4, 1.7,
      1.8, 1.7, 1.3, 0.9, 0.7,
    ]),
    saturday: createDailyProfile([
      0.7, 0.6, 0.6, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.4, 1.3, 1.3, 1.2, 1.2, 1.3, 1.5,
      1.5, 1.4, 1.1, 0.9, 0.7,
    ]),
    sunday: createDailyProfile([
      0.7, 0.6, 0.6, 0.6, 0.6, 0.7, 0.8, 0.9, 1.0, 1.2, 1.4, 1.5, 1.5, 1.4, 1.4, 1.3, 1.3, 1.4, 1.5,
      1.6, 1.5, 1.2, 1.0, 0.8,
    ]),
  },
};

const G0 = {
  winter: {
    weekday: createDailyProfile([
      0.3, 0.3, 0.3, 0.3, 0.3, 0.5, 1.0, 1.5, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.6, 1.3,
      0.9, 0.6, 0.4, 0.3, 0.3,
    ]),
    saturday: createDailyProfile([
      0.3, 0.3, 0.3, 0.3, 0.3, 0.4, 0.6, 0.8, 0.9, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.9, 0.8, 0.7,
      0.5, 0.4, 0.3, 0.3, 0.3,
    ]),
    sunday: createDailyProfile([
      0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.3, 0.4, 0.5, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.5, 0.4,
      0.3, 0.3, 0.2, 0.2, 0.2,
    ]),
  },
  summer: {
    weekday: createDailyProfile([
      0.3, 0.3, 0.3, 0.3, 0.3, 0.5, 0.9, 1.3, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.4, 1.2,
      0.8, 0.5, 0.4, 0.3, 0.3,
    ]),
    saturday: createDailyProfile([
      0.3, 0.3, 0.3, 0.3, 0.3, 0.4, 0.5, 0.7, 0.8, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.8, 0.7, 0.6,
      0.5, 0.4, 0.3, 0.3, 0.3,
    ]),
    sunday: createDailyProfile([
      0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.3, 0.4, 0.5, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.5, 0.4,
      0.3, 0.3, 0.2, 0.2, 0.2,
    ]),
  },
  transition: {
    weekday: createDailyProfile([
      0.3, 0.3, 0.3, 0.3, 0.3, 0.5, 1.0, 1.4, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.5, 1.2,
      0.9, 0.6, 0.4, 0.3, 0.3,
    ]),
    saturday: createDailyProfile([
      0.3, 0.3, 0.3, 0.3, 0.3, 0.4, 0.6, 0.8, 0.9, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.9, 0.8, 0.7,
      0.5, 0.4, 0.3, 0.3, 0.3,
    ]),
    sunday: createDailyProfile([
      0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.3, 0.4, 0.5, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.5, 0.4,
      0.3, 0.3, 0.2, 0.2, 0.2,
    ]),
  },
};

const L0 = {
  winter: {
    weekday: createDailyProfile([
      0.5, 0.5, 0.5, 0.5, 0.8, 1.4, 1.8, 1.2, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 1.0, 1.1, 1.6, 1.8, 1.3,
      1.0, 0.8, 0.7, 0.6, 0.5,
    ]),
    saturday: createDailyProfile([
      0.5, 0.5, 0.5, 0.5, 0.7, 1.2, 1.5, 1.1, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 1.0, 1.1, 1.4, 1.6, 1.2,
      0.9, 0.8, 0.7, 0.6, 0.5,
    ]),
    sunday: createDailyProfile([
      0.5, 0.5, 0.5, 0.5, 0.7, 1.0, 1.3, 1.0, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 1.0, 1.1, 1.3, 1.4, 1.1,
      0.9, 0.8, 0.7, 0.6, 0.5,
    ]),
  },
  summer: {
    weekday: createDailyProfile([
      0.5, 0.5, 0.5, 0.5, 0.7, 1.2, 1.6, 1.1, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 1.0, 1.1, 1.5, 1.6, 1.2,
      0.9, 0.8, 0.7, 0.6, 0.5,
    ]),
    saturday: createDailyProfile([
      0.5, 0.5, 0.5, 0.5, 0.7, 1.1, 1.4, 1.0, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 1.0, 1.1, 1.3, 1.4, 1.1,
      0.9, 0.8, 0.7, 0.6, 0.5,
    ]),
    sunday: createDailyProfile([
      0.5, 0.5, 0.5, 0.5, 0.6, 0.9, 1.2, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 1.0, 1.0, 1.2, 1.3, 1.0,
      0.9, 0.8, 0.7, 0.6, 0.5,
    ]),
  },
  transition: {
    weekday: createDailyProfile([
      0.5, 0.5, 0.5, 0.5, 0.8, 1.3, 1.7, 1.2, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 1.0, 1.1, 1.6, 1.7, 1.2,
      0.9, 0.8, 0.7, 0.6, 0.5,
    ]),
    saturday: createDailyProfile([
      0.5, 0.5, 0.5, 0.5, 0.7, 1.2, 1.5, 1.1, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 1.0, 1.1, 1.4, 1.5, 1.1,
      0.9, 0.8, 0.7, 0.6, 0.5,
    ]),
    sunday: createDailyProfile([
      0.5, 0.5, 0.5, 0.5, 0.7, 1.0, 1.3, 1.0, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 1.0, 1.1, 1.3, 1.4, 1.1,
      0.9, 0.8, 0.7, 0.6, 0.5,
    ]),
  },
};

const STANDARD_PROFILES = {
  H0: {
    id: 'H0',
    name: 'Haushalt',
    description: 'BDEW Haushaltsprofil (vereinfachte Kennlinie)',
    seasons: H0,
  },
  G0: {
    id: 'G0',
    name: 'Gewerbe allgemein',
    description: 'BDEW Gewerbeprofil (vereinfachte Kennlinie)',
    seasons: G0,
  },
  L0: {
    id: 'L0',
    name: 'Landwirtschaft',
    description: 'BDEW Landwirtschaftsprofil (vereinfachte Kennlinie)',
    seasons: L0,
  },
  L1: {
    id: 'L1',
    name: 'Landwirtschaft mit Milchwirtschaft',
    description: 'Vereinfachtes L1-Profil (auf L0 basierend)',
    seasons: L0,
  },
  L2: {
    id: 'L2',
    name: 'Landwirtschaft ohne Milchwirtschaft',
    description: 'Vereinfachtes L2-Profil (auf L0 basierend)',
    seasons: L0,
  },
};

function getStandardProfile(profileId) {
  return STANDARD_PROFILES[profileId] || null;
}

function getStandardProfileValues(profileId, dateString) {
  const profile = getStandardProfile(profileId);
  if (!profile) return null;
  const season = determineSeason(dateString);
  const dayType = determineDayType(dateString);

  return {
    profileId,
    name: profile.name,
    season,
    dayType,
    values: profile.seasons[season][dayType],
  };
}

module.exports = {
  STANDARD_PROFILES,
  determineSeason,
  determineDayType,
  getStandardProfile,
  getStandardProfileValues,
};
