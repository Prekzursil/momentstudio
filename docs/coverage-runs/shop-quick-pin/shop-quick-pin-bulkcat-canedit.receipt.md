# Coverage receipt — shop bulk category + canEdit helpers

- tip_impl: `39154f37`
- branch: `cursor/golden-wu-shop-quickview-pin-bulkcat-coverage-4739`
- N: 3 (`bulkCategoryOptions`, `bulkCategoryLabel`, `canEditCategories`/`canEditProducts`)
- skipped: `openQuickView` (#718 / `golden-wu-shop-quickview-coverage-4739`), `pinProductToTop` (#720 / `golden-wu-shop-pinproduct-coverage-4739`) — claimed by open golden-wu PRs

## Helpers

| Helper | Test title |
|--------|------------|
| `bulkCategoryOptions` | bulkCategoryOptions flattens roots and descendants with id and name |
| `bulkCategoryLabel` | bulkCategoryLabel joins ancestor names and stops on cyclic parent ids |
| `canEditCategories` / `canEditProducts` | canEditCategories and canEditProducts mirror storefront admin mode |

## Gates

| Gate | Status | Evidence |
|------|--------|----------|
| INNER | pass EXIT:0 TOTAL 8 | focused `shop.component.spec.ts` (8 specs) |
| BIOME | pass | `@biomejs/biome@2.5.0 format --write` |
| SKIPPED-CLAIMS | ok | quickview + pin reserved on sibling branches |

## Notes

- Category tree seeded via `seedCategoryTree` → `rebuildCategoryTree()` (same pattern as cov/ms shop spec).
- `bulkCategoryOptions` filters categories missing `id` or `name`.
- `bulkCategoryLabel` cyclic-parent guard uses visited set (a↔b cycle).
- `canEdit*` tests spy `storefrontAdminMode.enabled()` false/true arms.
