/**
 * Dev proxy for `ng serve`.
 * Array form + explicit `target` works with webpack-dev-server 5 and both
 * http-proxy-middleware 2 and 3 (HPM3 throws "Missing target" on empty/object
 * configs that WDS used to fabricate).
 *
 * Override the backend with DEV_API_TARGET (start.sh sets this).
 */
const target = process.env.DEV_API_TARGET || 'http://127.0.0.1:8000';

module.exports = [
  {
    context: ['/api', '/media'],
    target,
    secure: false,
    changeOrigin: true,
    logLevel: 'warn',
  },
];
