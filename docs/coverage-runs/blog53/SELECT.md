# Blog53 Select — blog list thin arms

List page already has broad SEO/interaction coverage; N=3 targets remaining thin arms
(filters / pagination helpers / hero suppress). Blog-post share/copy skipped
(open PRs #712 / #713).

1. `changePage` clamps at `total_pages` and clears `page` query when returning to first
2. Hero suppressed on `page > 1` and when `sort !== 'newest'`
3. `applyFilters` preserves trimmed `q` + non-newest `sort` on series routes (clears tag)

Branch: cursor/golden-wu-blog-list-coverage-4739
