import { ANALYTICS_EVENTS, sanitizeEvent } from '../../js/shared/analytics-events.js';

test('passes an allowlisted event with allowed values', () => {
  expect(sanitizeEvent('copy', { what: 'curl_bash' })).toEqual({
    name: 'copy',
    params: { what: 'curl_bash' },
  });
});
test('rejects unknown events', () => {
  expect(sanitizeEvent('page_view', {})).toBeNull();
});
test('drops params with values outside the enum', () => {
  expect(sanitizeEvent('copy', { what: 'https://api.example.com/graphql' })).toEqual({
    name: 'copy',
    params: {},
  });
  expect(sanitizeEvent('copy', { what: 'GetCart' })).toEqual({ name: 'copy', params: {} });
});
test('drops unknown param keys', () => {
  expect(sanitizeEvent('panel_open', { url: 'x', operationName: 'GetCart' })).toEqual({
    name: 'panel_open',
    params: {},
  });
});
test('non-string values are dropped', () => {
  expect(sanitizeEvent('debug_mode_set', { on: true })).toEqual({
    name: 'debug_mode_set',
    params: {},
  });
});
test('rejects inherited object keys as event names', () => {
  expect(sanitizeEvent('toString', {})).toBeNull();
  expect(sanitizeEvent('__proto__', {})).toBeNull();
});
test('allowlist and its nested enums are frozen', () => {
  expect(Object.isFrozen(ANALYTICS_EVENTS)).toBe(true);
  expect(Object.isFrozen(ANALYTICS_EVENTS.copy)).toBe(true);
  expect(Object.isFrozen(ANALYTICS_EVENTS.copy.what)).toBe(true);
});
