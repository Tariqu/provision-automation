(function(root) {
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function mergeAccounts(base, local, remote, choices = {}) {
    const result = [], conflicts = [];
    const maps = [base, local, remote].map(rows => new Map(rows.map(row => [row.id, row])));
    const ids = new Set([...maps[1].keys(), ...maps[2].keys()]);
    const clean = row => row && Object.fromEntries(Object.entries(row).filter(([key]) => !['missingFields', 'domain', 'integrationReason', 'integrationConfidence'].includes(key)));
    for (const id of ids) {
      const [b, l, r] = maps.map(map => clean(map.get(id)));
      if (equal(l, r)) { if (l) result.push(l); continue; }
      if (equal(l, b)) { if (r) result.push(r); continue; }
      if (equal(r, b)) { if (l) result.push(l); continue; }
      if (!l || !r) {
        const key = `${id}:row`;
        conflicts.push({ key, name: (l || r).accountName, field: 'Account row', local: l ? 'Keep account' : 'Delete account', remote: r ? 'Keep account' : 'Delete account' });
        const chosen = choices[key] === 'remote' ? r : l;
        if (chosen) result.push(chosen);
        continue;
      }
      const merged = {};
      for (const field of new Set([...Object.keys(l), ...Object.keys(r)])) {
        if (equal(l[field], r[field]) || equal(r[field], b?.[field])) merged[field] = l[field];
        else if (equal(l[field], b?.[field])) merged[field] = r[field];
        else {
          const key = `${id}:${field}`;
          conflicts.push({ key, name: l.accountName, field, local: l[field] ?? '', remote: r[field] ?? '' });
          merged[field] = choices[key] === 'remote' ? r[field] : l[field];
        }
      }
      result.push(merged);
    }
    return { accounts: result, conflicts };
  }
  if (typeof module !== 'undefined') module.exports = { mergeAccounts };
  else root.mergeAccounts = mergeAccounts;
})(typeof window === 'undefined' ? globalThis : window);
