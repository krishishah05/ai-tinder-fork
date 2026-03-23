'use strict';

/**
 * Edge-case tests for POST /api/swipes, GET /api/swipes, GET /api/swipes/stats
 *
 * Focus: invalid types, boundary values, case sensitivity, optional-field
 * handling, duplicate submissions, special characters, and response-shape
 * invariants.  Happy-path coverage lives in swipes.test.js.
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// Use an isolated in-memory database so these tests never touch the real file.
process.env.DB_PATH = ':memory:';

const app = require('../server');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let server;
let baseUrl;

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const url     = new URL(path, baseUrl);
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const opts = {
      method,
      hostname: url.hostname,
      port:     url.port,
      path:     url.pathname,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

before(() => new Promise(resolve => {
  server = app.listen(0, () => {
    baseUrl = `http://localhost:${server.address().port}`;
    resolve();
  });
}));

after(() => new Promise(resolve => {
  server.closeAllConnections();
  server.close(resolve);
}));

const db = require('../db');
beforeEach(() => db.exec('DELETE FROM swipes'));

// ===========================================================================
// POST /api/swipes — invalid profileId types
// ===========================================================================

describe('POST /api/swipes — profileId edge cases', () => {

  it('returns 400 when profileId is a number instead of a string', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: 42,
      profileName: 'Alex',
      action: 'like',
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.error, 'response must include an error message');
  });

  it('returns 400 when profileId is null', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: null,
      profileName: 'Alex',
      action: 'like',
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  it('returns 400 when profileId is an empty string ""', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: '',
      profileName: 'Alex',
      action: 'like',
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  it('returns 400 when profileId is an array', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: ['p_0_abc'],
      profileName: 'Alex',
      action: 'like',
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

});

// ===========================================================================
// POST /api/swipes — invalid profileName types
// ===========================================================================

describe('POST /api/swipes — profileName edge cases', () => {

  it('returns 400 when profileName is whitespace-only', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0_abc',
      profileName: '   ',
      action: 'like',
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  it('returns 400 when profileName is a number', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0_abc',
      profileName: 99,
      action: 'like',
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  it('returns 400 when profileName is null', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0_abc',
      profileName: null,
      action: 'like',
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

});

// ===========================================================================
// POST /api/swipes — invalid action values
// ===========================================================================

describe('POST /api/swipes — action edge cases', () => {

  it('returns 400 when action is an empty string ""', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0_abc',
      profileName: 'Alex',
      action: '',
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  it('returns 400 when action is uppercase "LIKE" (case-sensitive check)', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0_abc',
      profileName: 'Alex',
      action: 'LIKE',
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.error, 'action matching must be case-sensitive');
  });

  it('returns 400 when action is "dislike" (not in VALID_ACTIONS)', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0_abc',
      profileName: 'Alex',
      action: 'dislike',
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  it('returns 400 when action is null', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0_abc',
      profileName: 'Alex',
      action: null,
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  it('returns 400 when action is a number', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0_abc',
      profileName: 'Alex',
      action: 1,
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

});

// ===========================================================================
// POST /api/swipes — completely empty body
// ===========================================================================

describe('POST /api/swipes — empty / minimal body', () => {

  it('returns 400 when the entire body is empty {}', async () => {
    const res = await request('POST', '/api/swipes', {});
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

  it('returns 400 when only action is supplied (profileId and profileName missing)', async () => {
    const res = await request('POST', '/api/swipes', { action: 'like' });
    assert.equal(res.status, 400);
    assert.ok(res.body.error);
  });

});

// ===========================================================================
// POST /api/swipes — userId optional field handling
// ===========================================================================

describe('POST /api/swipes — userId edge cases', () => {

  it('returns 201 when userId is omitted entirely', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0_abc',
      profileName: 'Alex',
      action: 'like',
    });
    assert.equal(res.status, 201);
    // matched must be a boolean even without userId
    assert.equal(typeof res.body.matched, 'boolean');
  });

  it('returns 201 when userId is a number (treated as null — no crash)', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0_abc',
      profileName: 'Alex',
      action: 'like',
      userId: 12345,
    });
    assert.equal(res.status, 201);
  });

  it('returns 201 when userId is whitespace-only (cleanUserId collapses to falsy — no notification crash)', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0_abc',
      profileName: 'Alex',
      action: 'like',
      userId: '   ',
    });
    assert.equal(res.status, 201);
  });

  it('returns 201 when userId is null', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0_abc',
      profileName: 'Alex',
      action: 'like',
      userId: null,
    });
    assert.equal(res.status, 201);
  });

});

// ===========================================================================
// POST /api/swipes — matched field invariants
// ===========================================================================

describe('POST /api/swipes — matched field invariants', () => {

  it('"nope" action always returns matched: false (no MATCH_CHANCE for nope)', async () => {
    // Run enough times to be confident the result is deterministic for nope.
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        request('POST', '/api/swipes', {
          profileId: 'p_0_abc',
          profileName: 'Alex',
          action: 'nope',
        })
      )
    );
    for (const res of results) {
      assert.equal(res.status, 201);
      assert.equal(res.body.matched, false, '"nope" must never produce a match');
    }
  });

  it('"like" response always contains a boolean matched field', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0_abc',
      profileName: 'Alex',
      action: 'like',
    });
    assert.equal(res.status, 201);
    assert.equal(typeof res.body.matched, 'boolean');
  });

  it('"superlike" response always contains a boolean matched field', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_0_abc',
      profileName: 'Alex',
      action: 'superlike',
    });
    assert.equal(res.status, 201);
    assert.equal(typeof res.body.matched, 'boolean');
  });

});

// ===========================================================================
// POST /api/swipes — special-character and boundary string inputs
// ===========================================================================

describe('POST /api/swipes — special characters and long strings', () => {

  it('accepts and stores a profileName containing HTML/script characters (XSS safety)', async () => {
    const dangerousName = '<script>alert(1)</script>';
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_xss',
      profileName: dangerousName,
      action: 'like',
    });
    assert.equal(res.status, 201);
    // The server must store the raw string; sanitisation is the renderer's job.
    assert.equal(res.body.profileName, dangerousName);
  });

  it('accepts a profileId that is 1000 characters long (no length limit in schema)', async () => {
    const longId = 'x'.repeat(1000);
    const res = await request('POST', '/api/swipes', {
      profileId: longId,
      profileName: 'Alex',
      action: 'nope',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.profileId, longId);
  });

  it('accepts profileId with unicode characters', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_🌟_éàü',
      profileName: '名前',
      action: 'superlike',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.profileId, 'p_🌟_éàü');
  });

  it('ignores unknown extra fields in the request body', async () => {
    const res = await request('POST', '/api/swipes', {
      profileId: 'p_extra',
      profileName: 'Sam',
      action: 'like',
      unknownField: 'should be ignored',
      anotherField: 999,
    });
    assert.equal(res.status, 201);
  });

});

// ===========================================================================
// POST /api/swipes — duplicate submissions (no unique constraint on profile_id)
// ===========================================================================

describe('POST /api/swipes — duplicate swipes', () => {

  it('allows the same profileId to be swiped twice (no uniqueness constraint)', async () => {
    const payload = { profileId: 'p_dup', profileName: 'Jamie', action: 'like' };
    const first  = await request('POST', '/api/swipes', payload);
    const second = await request('POST', '/api/swipes', payload);

    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    // Each insertion gets its own id
    assert.notEqual(first.body.id, second.body.id);
  });

  it('allows swiping same profileId with different actions on each call', async () => {
    const id = 'p_multi';
    const r1 = await request('POST', '/api/swipes', { profileId: id, profileName: 'Robin', action: 'like' });
    const r2 = await request('POST', '/api/swipes', { profileId: id, profileName: 'Robin', action: 'nope' });
    assert.equal(r1.status, 201);
    assert.equal(r2.status, 201);
  });

});

// ===========================================================================
// GET /api/swipes — response-shape edge cases
// ===========================================================================

describe('GET /api/swipes — response shape invariants', () => {

  it('swipedAt in each record is a valid ISO 8601 date string', async () => {
    await request('POST', '/api/swipes', { profileId: 'p_ts', profileName: 'Dana', action: 'like' });
    const res = await request('GET', '/api/swipes');
    const { swipedAt } = res.body.swipes[0];
    assert.ok(!isNaN(Date.parse(swipedAt)), `swipedAt "${swipedAt}" must be a valid date`);
  });

  it('returned profileId matches the exact value submitted (no mutation)', async () => {
    await request('POST', '/api/swipes', { profileId: 'p_exact_42', profileName: 'Drew', action: 'nope' });
    const res = await request('GET', '/api/swipes');
    assert.equal(res.body.swipes[0].profileId, 'p_exact_42');
  });

  it('returned action is one of the three valid actions', async () => {
    await request('POST', '/api/swipes', { profileId: 'p_act', profileName: 'Quinn', action: 'superlike' });
    const res = await request('GET', '/api/swipes');
    const validActions = new Set(['like', 'nope', 'superlike']);
    assert.ok(validActions.has(res.body.swipes[0].action));
  });

});

// ===========================================================================
// GET /api/swipes/stats — single-action and boundary edge cases
// ===========================================================================

describe('GET /api/swipes/stats — single action type edge cases', () => {

  it('like count is 0 and total matches nope count when only nope swipes exist', async () => {
    await request('POST', '/api/swipes', { profileId: 'p_n1', profileName: 'A', action: 'nope' });
    await request('POST', '/api/swipes', { profileId: 'p_n2', profileName: 'B', action: 'nope' });

    const res = await request('GET', '/api/swipes/stats');
    assert.equal(res.status, 200);
    assert.equal(res.body.like, 0,      'like must be 0 when no likes recorded');
    assert.equal(res.body.superlike, 0, 'superlike must be 0 when no superlikes recorded');
    assert.equal(res.body.nope, 2);
    assert.equal(res.body.total, 2);
  });

  it('nope and like are 0 when only superlike swipes exist', async () => {
    await request('POST', '/api/swipes', { profileId: 'p_s1', profileName: 'C', action: 'superlike' });

    const res = await request('GET', '/api/swipes/stats');
    assert.equal(res.body.like, 0);
    assert.equal(res.body.nope, 0);
    assert.equal(res.body.superlike, 1);
    assert.equal(res.body.total, 1);
  });

  it('total equals the arithmetic sum of like + nope + superlike', async () => {
    await request('POST', '/api/swipes', { profileId: 'p_t1', profileName: 'E', action: 'like' });
    await request('POST', '/api/swipes', { profileId: 'p_t2', profileName: 'F', action: 'like' });
    await request('POST', '/api/swipes', { profileId: 'p_t3', profileName: 'G', action: 'nope' });
    await request('POST', '/api/swipes', { profileId: 'p_t4', profileName: 'H', action: 'superlike' });
    await request('POST', '/api/swipes', { profileId: 'p_t5', profileName: 'I', action: 'superlike' });

    const res = await request('GET', '/api/swipes/stats');
    const { like, nope, superlike, total } = res.body;
    assert.equal(total, like + nope + superlike, 'total must equal sum of individual counts');
  });

  it('stats always include all three action keys even when one type has no records', async () => {
    await request('POST', '/api/swipes', { profileId: 'p_k1', profileName: 'J', action: 'like' });
    const res = await request('GET', '/api/swipes/stats');
    assert.ok('like'      in res.body, 'stats must always include "like" key');
    assert.ok('nope'      in res.body, 'stats must always include "nope" key');
    assert.ok('superlike' in res.body, 'stats must always include "superlike" key');
    assert.ok('total'     in res.body, 'stats must always include "total" key');
  });

});
