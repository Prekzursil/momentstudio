# Acct54 Select — account/profile page arms

Existing `account.component.spec.ts` covers overview summaries, notification
save, and reorder only. Profile page helpers were uncovered. N=3 NEW arms:

1. Form dirty/save guards — `profileHasUnsavedChanges` / `discardProfileChanges` /
   `saveProfile` early-return when signed out
2. Avatar crop zoom normalize — `AccountProfileComponent.avatarCropTransform`
   clamps finite zoom to [1, 3] and falls back to 1 for NaN
3. Section toggles — `navigateToSection` skips blank/password; `navigationSection`
   remaps password → security

Spec: `frontend/src/app/pages/account/account-profile.arms.spec.ts`

Branch: cursor/golden-wu-account-profile-coverage-4739
