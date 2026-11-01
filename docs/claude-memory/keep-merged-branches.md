---
name: keep-merged-branches
description: "User prefers keeping feature branches after merging, for retrospective review"
metadata: 
  node_type: memory
  pinned: false
  originSessionId: 1ee30ca3-c7ee-47b0-ab83-76c565e70e0d
  modified: 2026-09-03T00:07:25.538Z
---

After a feature/fix branch is merged into `main` and pushed, do not delete the branch (locally or on the remote) unless the user explicitly asks for it to be deleted. The user has said they like keeping merged branches around because it makes it easy to go back and review past work later. When wrapping up a merge, mention that the branch is being left in place rather than proactively offering to delete it as a "cleanup" step.
