"""P1a theme deploy-gate checks.

Standalone, dependency-light gate modules invoked by ``p1a_theme_gate.sh`` and
the ``theme-deploy-gate`` CI workflow. They live OUTSIDE ``backend/app`` on
purpose: they are deploy tooling, not shipped application code, so the lean
``quality / quality`` gate does not measure them under its ``backend/app``
coverage scope. Their own 100% line+branch coverage is enforced by the gate's
dedicated coverage run (``scripts/deploy/.coveragerc``).

Sub-gates:

* ``theme_migration_consistency`` — 0159 single head, applies clean, models match.
* ``theme_migration_reversibility`` — 0159 ``upgrade()``/``downgrade()`` round-trip.
* ``theme_render_smoke`` — default theme renders a complete, injection-safe
  ``<style>`` injected into ``<head>`` + a matching report-only CSP header.
* ``theme_post_deploy_smoke`` — real HTTP ``GET /theme`` + ``home.sections`` 200s.
* ``theme_cache_posture`` — no themeable route served from a full-page cache
  carrying a baked theme blob (R3-B1).
"""
