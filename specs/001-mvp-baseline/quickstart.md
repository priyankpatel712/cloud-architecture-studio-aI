# Quickstart & Validation — Cloud Architecture Studio AI MVP

How to run the app and validate the feature end-to-end. Implementation details live in `tasks.md`.

## Prerequisites

- Node 20+, local MongoDB running at `mongodb://127.0.0.1:27017`.
- `app/.env.local` with `MONGODB_URI`, `AUTH_SECRET`, and (as added) `AWS_*`, `ATLAS_*`, email +
  LLM provider keys.

## Setup

```bash
cd app
npm install
npm run seed        # creates the super_admin (see .env.local SEED_SUPERADMIN_*)
npm run dev         # http://localhost:3000
```

## Validation scenarios (map to user stories)

- **US1 Account & access**: register a user → a verification email is sent (dev transport surfaces
  the link) and workspace access is **refused until verified**; confirm the link → land in
  workspace; sign out → any workspace URL redirects to `/login`; forgot → reset via link → old
  password fails, new works. *(auth built; verification gate is new work)*
- **US6 Admin & roles**: sign in as super_admin → create an admin + a user; sign in as the admin →
  can manage only standard users, cannot assign admin roles; standard user cannot reach `/admin`. *(built)*
- **US2 Generation (chat)**: on the project chat, attach the AWS (and MongoDB) tools and send a
  description → an architecture with services, connections, guidance, and an estimate appears
  within 30s; send a follow-up ("make it multi-region") → the same architecture updates in place;
  send a prompt with **no** tool attached → the assistant asks to attach one; make a direct canvas
  edit → the next chat message builds on it; reopen the project → the thread resumes.
- **US3 Build & cost**: drag services onto the canvas, connect them, change a service's config → its
  cost and the total update; save → reload the project → design persists.
- **US4 Connections**: run AWS SSO connect → session shows account/region/expiry with no stored keys;
  connect Atlas → projects/clusters list.
- **US5 Projects**: create → edit → duplicate → archive; confirm another user cannot open it.
- **US7 Export**: export the architecture as PNG, PDF, Mermaid, JSON → valid files reflecting the design.

## Gates (Constitution V — verify before done)

1. `npm run build` passes (compile + typecheck + prerender).
2. `npm run lint` clean.
3. The affected flow above is driven and observed (scripted HTTP for APIs; headless desktop+mobile
   screenshots for UI).
4. No provider credentials appear in any client response; role rules cannot be bypassed via the API.
