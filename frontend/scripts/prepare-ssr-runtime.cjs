#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const serverDir = path.join(root, 'dist', 'app', 'server');
const markerPath = path.join(serverDir, 'package.json');

if (!fs.existsSync(serverDir)) {
  process.exit(0);
}

const payload = {
  type: 'commonjs'
};

fs.writeFileSync(markerPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
