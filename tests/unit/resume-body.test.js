import { buildContinueParams, encodeBase64Json } from '../../js/sw/resume-body.js';
import { digestMessage } from '../../js/sw/hash.js';

const held = (body, extra = {}) => ({
  id: 'r1',
  tabId: 1,
  body,
  rawHeaders: { 'content-type': 'application/json', authorization: 'Bearer t' },
  operations: [],
  ...extra,
});

const decode = (p) => JSON.parse(atob(p.postData));

describe('buildContinueParams', () => {
  test('no edits → empty params', async () => {
    expect(await buildContinueParams(held({ query: 'query A { a }', variables: {} }))).toEqual({});
  });

  test('edits identical to the held request → empty params', async () => {
    const h = held(
      { query: 'query A { a }', variables: { x: 1 } },
      { operations: [{ index: 0, query: 'query A { a }', variables: { x: 1 } }] }
    );
    const p = await buildContinueParams(h, {
      operations: [{ index: 0, query: 'query A { a }', variables: { x: 1 } }],
      headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    });
    expect(p).toEqual({});
  });

  test('variables edit replaces variables only', async () => {
    const p = await buildContinueParams(
      held({ operationName: 'A', query: 'query A { a }', variables: { x: 1 } }),
      { operations: [{ index: 0, variables: { x: 2 } }] }
    );
    expect(decode(p)).toEqual({ operationName: 'A', query: 'query A { a }', variables: { x: 2 } });
    expect(p.headers).toBeUndefined();
  });

  test('edited query on an APQ retry recomputes the hash', async () => {
    const body = {
      query: 'query A { a }',
      extensions: { persistedQuery: { version: 1, sha256Hash: 'old' } },
    };
    const p = await buildContinueParams(held(body), {
      operations: [{ index: 0, query: 'query A { a b }' }],
    });
    const sent = decode(p);
    expect(sent.query).toBe('query A { a b }');
    expect(sent.extensions.persistedQuery.sha256Hash).not.toBe('old');
    expect(sent.extensions.persistedQuery.sha256Hash).toBe(await digestMessage('query A { a b }'));
  });

  test('keeps the original hash when digestMessage fails', async () => {
    crypto.subtle.digest.mockRejectedValueOnce(new Error('boom'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const body = {
      query: 'query A { a }',
      extensions: { persistedQuery: { version: 1, sha256Hash: 'old' } },
    };
    const p = await buildContinueParams(held(body), {
      operations: [{ index: 0, query: 'query A { a b }' }],
    });
    const sent = decode(p);
    expect(sent.query).toBe('query A { a b }');
    expect(sent.extensions.persistedQuery.sha256Hash).toBe('old');
    errSpy.mockRestore();
  });

  const hashOnly = {
    operationName: 'A',
    variables: { x: 1 },
    extensions: { persistedQuery: { version: 1, sha256Hash: 'h' } },
  };
  const fromRegistry = {
    operations: [
      {
        index: 0,
        operationName: 'A',
        query: 'query A { a }',
        querySource: 'registry',
        variables: { x: 1 },
        hash: 'h',
        isHashOnly: true,
      },
    ],
  };

  test('passive hash-only: unedited registry query stays hash-only with variable edits', async () => {
    const p = await buildContinueParams(held(hashOnly, fromRegistry), {
      operations: [{ index: 0, query: 'query A { a }', variables: { x: 2 } }],
    });
    const sent = decode(p);
    expect(sent.query).toBeUndefined();
    expect(sent.extensions.persistedQuery.sha256Hash).toBe('h');
    expect(sent.variables).toEqual({ x: 2 });
  });

  test('passive hash-only: edited query becomes a full query with recomputed hash', async () => {
    const p = await buildContinueParams(held(hashOnly, fromRegistry), {
      operations: [{ index: 0, query: 'query A { a b }' }],
    });
    const sent = decode(p);
    expect(sent.query).toBe('query A { a b }');
    expect(sent.extensions.persistedQuery.sha256Hash).not.toBe('h');
    expect(sent.extensions.persistedQuery.sha256Hash).toBe(await digestMessage('query A { a b }'));
  });

  test('batched body: only the edited index changes', async () => {
    const body = [
      { query: 'query A { a }', variables: {} },
      { query: 'query B { b }', variables: { y: 1 } },
    ];
    const p = await buildContinueParams(held(body), {
      operations: [{ index: 1, variables: { y: 2 } }],
    });
    const sent = decode(p);
    expect(sent[0]).toEqual(body[0]);
    expect(sent[1].variables).toEqual({ y: 2 });
  });

  test('does not mutate the held body', async () => {
    const body = { query: 'q', variables: { x: 1 } };
    await buildContinueParams(held(body), { operations: [{ index: 0, variables: { x: 2 } }] });
    expect(body.variables).toEqual({ x: 1 });
  });

  test('header edits produce the full header list for continueRequest', async () => {
    const p = await buildContinueParams(held({ query: 'q' }), {
      headers: { 'content-type': 'application/json', authorization: 'Bearer NEW' },
    });
    expect(p.headers).toEqual([
      { name: 'authorization', value: 'Bearer NEW' },
      { name: 'content-type', value: 'application/json' },
    ]);
    expect(p.postData).toBeUndefined();
  });
});

describe('encodeBase64Json', () => {
  test('round-trips UTF-8 content', () => {
    const value = { q: 'héllo ✓' };
    const bytes = Uint8Array.from(atob(encodeBase64Json(value)), (c) => c.charCodeAt(0));
    expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual(value);
  });
});
