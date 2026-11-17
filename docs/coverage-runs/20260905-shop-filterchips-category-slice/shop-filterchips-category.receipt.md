# Coverage receipt — shop filterChips category

- tip_impl: `6aa3bb925fd34c9df745b72d9b49f1587759ab1e`
- branch: `cursor/golden-wu-shop-filterchips-category-coverage-4739`
- draft_pr: **blocked** (createPullRequest 403)
- N: 3
- council: **CONDITIONAL** (DraftPR lock only)

## Gates
| Gate | Status | Evidence |
|------|--------|----------|
| INNER | pass EXIT:0 TOTAL 2138 | `/tmp/shop39-inner.log` |
| OUTER | outer:blocked Case B | unit-helper |
| REPO-VERIFY | pass EXIT:0 backend 3993 frontend 2138 | `/tmp/shop39-verify.log` |
| REVIEW/ADV | pass | bc-89a708d2-9b91-5205-bcf6-7b10926bd9f0; bc-21ffac74-1f5e-5d39-91f8-8819a0eacdd2 |
| DRAFT-PR | blocked 403 | gh integration |
| COUNCIL | **CONDITIONAL** | adversaries PASS; DraftPR token lock |
