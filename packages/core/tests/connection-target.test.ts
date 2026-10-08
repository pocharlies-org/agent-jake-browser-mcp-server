import { describe, it, expect } from 'vitest';
import { parseLabels, resolveTarget, findConnection } from '../src/connection-target.js';

const WORK = { connectionId: 'a1b2c3d4-0001', label: '' };
const HOME = { connectionId: 'a1b2c3d4-0002', label: '' };
const labels = parseLabels('{"a1b2c3d4-0001":"work","a1b2c3d4-0002":"home"}');

describe('resolveTarget', () => {
  it('uses the configured default when the session has not chosen', () => {
    expect(resolveTarget({ open: [WORK, HOME], labels, configuredDefault: 'work' }))
      .toEqual({ ok: true, connectionId: WORK.connectionId, sticky: false });
  });

  it('an explicit name wins and sticks for the session', () => {
    expect(resolveTarget({ requested: 'HOME', open: [WORK, HOME], labels, configuredDefault: 'work' }))
      .toEqual({ ok: true, connectionId: HOME.connectionId, sticky: true });
  });

  it('the session choice beats the configured default while that browser is connected', () => {
    expect(resolveTarget({ open: [WORK, HOME], labels, sessionDefault: HOME.connectionId, configuredDefault: 'work' }))
      .toMatchObject({ ok: true, connectionId: HOME.connectionId });
    expect(resolveTarget({ open: [WORK], labels, sessionDefault: HOME.connectionId, configuredDefault: 'work' }))
      .toMatchObject({ ok: true, connectionId: WORK.connectionId });
  });

  it('never guesses between several browsers', () => {
    const r = resolveTarget({ open: [WORK, HOME], labels });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('work (a1b2c3d4-0001)');
  });

  it('with one browser and no default, uses it; unknown names fail', () => {
    expect(resolveTarget({ open: [HOME], labels })).toMatchObject({ ok: true, connectionId: HOME.connectionId });
    expect(resolveTarget({ requested: 'ipad', open: [WORK], labels }).ok).toBe(false);
  });

  it('matches ids, names and handshake labels', () => {
    expect(findConnection('a1b2c3d4-0001', [WORK], labels)).toBe(WORK);
    expect(findConnection('work', [{ connectionId: 'z', label: 'work' }], {})?.connectionId).toBe('z');
    expect(parseLabels('not json')).toEqual({});
  });
});
