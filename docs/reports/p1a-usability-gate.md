# P1a Moderated Usability-Gate Record

**Status: PENDING — awaiting a real moderated operator run.**
This document is the acceptance-gate **template + protocol**. The result fields are
intentionally empty; they must be filled by observing an actual operator session.
Do **not** mark this gate passed until a named operator has completed the run below
and the moderator has recorded the observations.

---

## 1. Purpose

P1a's headline acceptance criterion is that **a named operator can re-theme the
storefront and publish the change UNAIDED** — no engineer coaching, no direct
database or API access, working only through the admin theme editor UI. This gate
is a **human-run, moderated acceptance test**; it is not, and cannot be, satisfied
by the automated test suite. The automated tests prove the *plumbing* (validation,
contrast gate, atomic publish, rollback, reset, usage metrics); this gate proves
the *experience* — that the flow is discoverable and completable by a
non-implementer.

## 2. Roles

| Role | Who | Responsibility |
|------|-----|----------------|
| **Operator** | A named person who did NOT build P1a (e.g. a store admin, PM, or ops teammate) | Performs the tasks below unaided |
| **Moderator** | A second person (may be an engineer) | Reads the task script aloud, observes, times, and records — but must NOT coach, hint, or touch the keyboard |

The moderator gives the operator the task script (§4) and otherwise stays silent
except to note observations. Any coaching invalidates the run for that task.

## 3. Environment & preconditions

- Build under test: the P1a `feat/p1a-theme-foundation` branch, deployed to a
  non-production environment that mirrors the storefront + admin.
- The operator has a valid admin account with the `theme` section role and can
  reach the admin theme editor.
- The storefront is seeded with the compiled-default theme (a fresh, known-good
  baseline) so every run starts from the same state.
- A way to view the live storefront (home / listing / detail archetypes) is open
  alongside the editor.

## 4. Task script (read to the operator, one task at a time)

The operator must complete all tasks **unaided**, using only the admin theme
editor and the live preview.

1. **Open the theme editor.** Find and open the storefront theme editor from the
   admin.
2. **Change a color.** Change the brand/accent color to a visibly different value
   and confirm the live preview updates.
3. **Change a font.** Switch the heading font to a different curated option and
   confirm the preview updates.
4. **Change spacing.** Adjust a spacing/scale control and confirm the preview
   reflects it.
5. **Preview across archetypes.** Confirm the change looks correct on the home,
   listing, and detail previews before publishing.
6. **Publish.** Publish the change and confirm the live storefront now shows it.
7. **Roll back.** Restore the previous version (rollback or reset-to-default) and
   confirm the storefront returns to the prior look.

If at any point the operator triggers the **contrast block** (an intentionally
low-contrast pairing is refused), note whether the error message told them what
was wrong and how to fix it, and whether they recovered unaided.

## 5. Pass / fail criteria

The gate **PASSES** only if ALL of the following hold:

- [ ] The operator completed tasks 1–7 **unaided** (no coaching, no engineer
      intervention, no direct API/DB access).
- [ ] Each edit was reflected in the live preview before publishing (see-before-save).
- [ ] The publish took effect on the live storefront with no code change / rebuild.
- [ ] The rollback/reset returned the storefront to the prior state.
- [ ] Any contrast block encountered was **actionable** — the operator understood
      why it was refused and recovered without help.
- [ ] No data-loss, stuck state, or unrecoverable error occurred.

The gate **FAILS** if any task required engineer intervention to complete, if a
published change did not take effect, if a rollback did not restore state, or if
the operator was blocked with no actionable path forward.

## 6. Result (fill in from the actual run — leave blank until run)

| Field | Value |
|-------|-------|
| Operator name | _(pending)_ |
| Moderator name | _(pending)_ |
| Date / time | _(pending)_ |
| Build / commit under test | _(pending)_ |
| Environment | _(pending)_ |

### Per-task observations

| # | Task | Completed unaided? | Time | Notes / friction |
|---|------|--------------------|------|------------------|
| 1 | Open the theme editor | _(pending)_ | | |
| 2 | Change a color | _(pending)_ | | |
| 3 | Change a font | _(pending)_ | | |
| 4 | Change spacing | _(pending)_ | | |
| 5 | Preview across archetypes | _(pending)_ | | |
| 6 | Publish | _(pending)_ | | |
| 7 | Roll back | _(pending)_ | | |

### Contrast-block encounter (if any)

- Encountered: _(pending)_
- Message was actionable: _(pending)_
- Recovered unaided: _(pending)_

### Overall

- **Result: PENDING** (PASS / FAIL — set only after the run)
- Summary of friction observed: _(pending)_
- Follow-up items / re-scoped needs (e.g. stepwise undo, if surfaced): _(pending)_

---

*This record is honest by construction: the gate is a human acceptance test and
is not considered passed until the fields above are filled from a real, moderated
operator session. No completed result is fabricated here.*
