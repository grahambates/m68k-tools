# 68kcounter web

Vite and React web application for [68kcounter](../../packages/68kcounter/README.md).

## Development

From the monorepo root, using the Node version in `.nvmrc`:

```sh
pnpm install --frozen-lockfile
pnpm --filter m68k-parser build
pnpm --filter 68kcounter build
pnpm --filter 68kcounter-web dev
```

Choose **Counter: Web** in the root VS Code launch menu to build dependencies and debug in Chrome. Run `pnpm --filter 68kcounter-web test` for unit tests and `pnpm --filter 68kcounter-web build` for a production build in `apps/68kcounter-web/dist`.

## Deployment

`vercel.json` is prepared for a Vercel project with root directory `apps/68kcounter-web`, access to workspace files outside that directory, and production branch `main`. Deployment linkage still needs to be moved from the original web repository.

## License

[MIT](LICENSE); existing attribution notices are preserved.
