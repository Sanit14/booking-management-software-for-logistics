import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEST_HOOKS_ARG, testHook } from './testHooks';

const env = { BM_PIN_LOCK_MS: '100', BM_BACKUP_DIR: 'C:\\elsewhere' };

test('a BM_* variable alone changes nothing: the hook is read only when the keeper was started with --test-hooks', () => {
  assert.equal(testHook(['server.js', 'D:\\BM', '47715'], env, 'BM_PIN_LOCK_MS'), undefined);
  assert.equal(testHook(['server.js', 'D:\\BM', '47715'], env, 'BM_BACKUP_DIR'), undefined);
  assert.equal(testHook(['server.js', 'D:\\BM', '47715', TEST_HOOKS_ARG], env, 'BM_PIN_LOCK_MS'), '100');
  assert.equal(testHook([TEST_HOOKS_ARG], env, 'BM_NOT_SET'), undefined);
});
