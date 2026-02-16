#!/usr/bin/env node

import assert from "node:assert/strict";
import { resolveMaxRoutes } from "./collect_browser_evidence.mjs";

const warnings = [];
const logger = {
  warn(message) {
    warnings.push(String(message));
  },
};

assert.equal(resolveMaxRoutes("foo", logger), 30);
assert.equal(resolveMaxRoutes("0", logger), 30);
assert.equal(resolveMaxRoutes("-3", logger), 30);
assert.equal(resolveMaxRoutes("25", logger), 25);

assert.deepEqual(warnings, [
  'Invalid --max-routes value "foo"; defaulting to 30.',
  'Invalid --max-routes value "0"; defaulting to 30.',
  'Invalid --max-routes value "-3"; defaulting to 30.',
]);

process.stdout.write("collect_browser_evidence max-routes tests passed\n");
