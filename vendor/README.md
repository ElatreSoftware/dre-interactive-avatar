# Vendored packages

## liveavatar-web-sdk

The avatar SDK, committed here rather than installed.

It has **no entry in `package.json`**, on purpose. It used to have one, and
each form was broken in its own way:

- `workspace:*` — nothing in the workspace had that name, so every
  `pnpm install` failed to resolve it.
- `link:./node_modules/@elatre` — pnpm-only. `npm i` dies with
  `EUNSUPPORTEDPROTOCOL`, which is what it does on a deployment server.
- `file:./vendor/liveavatar-web-sdk` — works, but asks a package manager to
  install something that is already in the repository, and copies it into
  `node_modules` where a `pnpm prune` can disagree with you about it.

So the code is just here, and three config files point at it:

| File | Why |
|---|---|
| `next.config.ts` | Turbopack and webpack resolution for the app |
| `tsconfig.json`  | `paths`, so TypeScript sees the types |
| `vitest.config.ts` | the same alias for tests |

What `package.json` *does* declare is what this code imports —
`livekit-client`, `events`, `typed-emitter`, `webrtc-issue-detector` — pinned
to the versions the SDK asks for. Those install from the registry like
anything else, so `npm i` and `pnpm i` both work on a clean checkout with
nothing copied by hand.

Only `lib/` is here: `main`, `module` and `types` all point into it. The
upstream package also ships a 6 MB `dist/` that nothing in this project
references.

**Updating it:** replace `lib/` and `package.json` from the new build, check
whether its `dependencies` changed, and mirror any change into the root
`package.json`. Nothing warns you if those drift apart.

`vendor/` is excluded from ESLint and Prettier — it is compiled third-party
output, and linting it produces 89 errors about code nobody here wrote.
