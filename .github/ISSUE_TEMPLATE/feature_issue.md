---
name: Feature / Task
about: Propose and scope a new feature, task, or piece of work
title: "[Feature] "
labels: []
assignees: []
---

## Summary
<!-- What the feature adds and what problem exists today without it. -->

## Motivation
<!-- Why users need this and what they currently have to do instead. -->

## Technical requirements
1. Backend/data layer change needed
2. UI change needed
3. How results or new behavior are shown to the user
4. Existing behavior that must keep working
5. (Stretch) Optional extension

## Estimate
- Effort: Xh for core work, plus Yh stretch

## Dependencies
<!-- Issues or features this depends on, or "None" -->
-

## Acceptance criteria
- [ ] Main behavior works as described
- [ ] Old behavior is unchanged when the feature is not used
- [ ] New UI state is clearly visible to the user
- [ ] User can complete the main actions from the new UI
- [ ] Unit tests cover the new logic, including edge cases
- [ ] Integration test covers the full user flow
- [ ] All existing tests still pass in CI

---

### Submission checklist
<!-- Complete before submitting the issue. This section is part of the template on purpose -- it's a reminder, not a draft to delete. -->
- [ ] Title follows the `[Feature] Add <capability> for <area>` format
- [ ] Assignee set
- [ ] Complexity label added
- [ ] Milestone added
- [ ] Added to the project board
- [ ] Priority set
- [ ] Type set (feature / bug / task)
