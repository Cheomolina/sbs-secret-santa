// The name shown to people: nickname if set, otherwise the login username.
export const displayName = (p) => p?.nickname || p?.username || '';
export const byName = (a, b) => displayName(a).localeCompare(displayName(b), undefined, { sensitivity: 'base' });
