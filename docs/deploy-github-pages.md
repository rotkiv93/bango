# Deploying the playground to GitHub Pages

The playground is a static site: no server, no backend. Langium, Monaco and everything else run in the visitor's browser, and their work is saved in the browser (IndexedDB), so the site can be hosted anywhere that serves files.

The repository is ready for it: [`.github/workflows/pages.yml`](../.github/workflows/pages.yml) tests the code and publishes the playground on every push to `main`.

## One-time setup

1. **Create a repository** on GitHub (any name, public or private with Pages enabled), without a README.
2. **Push the code** from this folder:

   ```bash
   git init
   git add .
   git commit -m "Bango"
   git branch -M main
   git remote add origin https://github.com/<your-user>/<your-repo>.git
   git push -u origin main
   ```

3. **Turn Pages on**: repository **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. **Wait for the workflow**: the *Actions* tab shows *Deploy playground*. When it is green, the site is at

   ```
   https://<your-user>.github.io/<your-repo>/
   ```

   (the `deploy` job prints the exact URL).

From then on, every push to `main` runs the tests and redeploys. Pull requests run the tests and the build but do not deploy.

## What the workflow does

| Job | Steps |
|---|---|
| `test` | `npm ci`, `npm run typecheck`, `npm test` |
| `build` | `npm ci`, `npm run pages` (builds `apps/playground` into `apps/playground/dist`), uploads it as the Pages artifact |
| `deploy` | publishes the artifact (skipped on pull requests) |

## Why it works from any path

A project site lives under `/<repository>/`, which breaks sites whose asset URLs start with `/`. The playground is built with a **relative base** (`base: './'` in `apps/playground/vite.config.ts`), so every URL is relative to the page: it works under `/<your-repo>/`, in a user site (`<your-user>.github.io`), on a custom domain, or from a plain folder. The two web workers (Langium and Monaco) are loaded relative to the page too.

If you need absolute URLs, set `BASE_PATH` when building:

```bash
BASE_PATH=/<your-repo>/ npm run pages
```

## Trying the build locally

```bash
npm run pages            # build into apps/playground/dist
npm run pages:preview    # serve it at http://localhost:4173
```

`npm run dev` is the development server (hot reload); the preview is the production build, the same files Pages will serve.

## Good to know

- **Size.** The first load is about 1.1 MB gzipped for the app (Monaco is most of it), plus the Langium worker (about 0.2 MB gzipped), and the diagram layout engine, which loads only when a diagram is first shown. GitHub Pages serves it compressed, and browsers cache it.
- **Saved work is per browser and per site.** Projects and edited metamodels are stored in the visitor's browser under the site's own origin. Another browser, another device or another URL starts from the examples; **Reset examples** returns to them.
- **Examples ship inside the build.** The metamodels and projects from `examples/seed` are bundled into the page; there is nothing to fetch.
- **Custom domain.** Add it under *Settings → Pages*; the relative base needs no change.
- **A project site on a private repository** needs a plan that includes private Pages.
- **No SPA fallback needed.** There is a single page and no router, so GitHub Pages' lack of rewrites is not an issue.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| The workflow fails at *Deploy* with a permissions error | Pages source is not *GitHub Actions* (step 3) |
| A blank page, with 404s for `/assets/...` in the console | the site was built with an absolute base for another path; rebuild without `BASE_PATH`, or with the right one |
| `npm ci` fails | `package-lock.json` is out of date with the `package.json` files; run `npm install` and commit the lockfile |
| The tests fail on CI but not locally | CI uses Node 22; check `node --version` |
