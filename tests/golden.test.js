// Golden designs (SPEC 16): every stored metric must match. A deliberate change is accepted by
// running `node tools/golden.js --update` and reviewing the diff of tests/golden/metrics.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { all_metrics, kGoldenFile } from '../tools/golden.js';

const stored = JSON.parse(fs.readFileSync(kGoldenFile, 'utf8'));
const current = all_metrics();

test('the golden set has not changed shape', () => {
    assert.deepEqual(Object.keys(current).sort(), Object.keys(stored).sort());
});

for (const id of Object.keys(stored)) {
    test(`golden design "${id}" matches its stored metrics`, () => {
        assert.deepEqual(current[id], stored[id]);
    });
}
