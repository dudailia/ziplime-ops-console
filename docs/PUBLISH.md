# Publishing

Sections 0, 1 and 2 were run on 14 Oct 2026: the repo is https://github.com/dudailia/ziplime-ops-console and the demo is https://ziplime-ops-console.vercel.app. Linking the Vercel project connected it to the repo, so every push to `main` deploys to production. Section 3 has not been run. Run everything from `ops-console/`.

## 0. Before anything goes public

```sh
git status                      # must be clean
npm run lint && npm run typecheck && npm test && npm run test:forwarder && npm run build && npm run test:e2e
# No secret or env file anywhere in history (expect no output from either):
git log --all --name-only --format= | sort -u | grep -iE '(^|/)\.env|\.pem$|\.key$|\.data/'
git log --all -p | grep -E '^\+' | grep -oE 'sk-ant-[A-Za-z0-9_-]{10,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|BEGIN [A-Z ]*PRIVATE KEY'
```

The commits carry the author email `i.i.duda@icloud.com`. A public repo shows it on every commit. If you'd rather it didn't, rewrite it to your GitHub noreply address before the first push (`git filter-repo --mailmap`), because it can't be taken back afterwards.

## 1. A public GitHub repo, dudailia/ziplime-ops-console

```sh
gh auth status                  # logged in as dudailia
gh repo create dudailia/ziplime-ops-console --public --source=. --remote=origin \
  --description "Unofficial ops console on ziplime's Lime dry-run mode (PR #39). Sample data."
git push -u origin main
```

The repo doesn't contain ziplime. `scripts/generate_seed.py` and the ingest test expect a checkout next to it at `../ziplime` on branch `feat/dry-run-orders`; the README says so.

## 2. The public demo on Vercel: no database, no API key

The demo is the static build: every page prerendered from the bundled seed. It must be built with `DATABASE_URL`, `OPS_PASSWORD` and `ANTHROPIC_API_KEY` all unset, because the data mode is fixed at build time.

The code enforces the key rule as well: on a static build running on Vercel, the AI routes stay off even if `ANTHROPIC_API_KEY` is set, because the demo has no sign-in and anyone could spend the key (`src/lib/ai/access.ts`). Setting `ZIPLIME_ALLOW_PUBLIC_AI=true` overrides that; don't, unless the key has a spend limit you accept losing.

```sh
npm i -g vercel@latest          # the installed CLI is 63.1.2; 64 is current
vercel login
vercel link --yes --project ziplime-ops-console
vercel env ls                   # must list nothing for DATABASE_URL, OPS_PASSWORD, ANTHROPIC_API_KEY
vercel deploy --prod
```

Check the live URL:

```sh
URL=https://ziplime-ops-console.vercel.app   # or whatever vercel deploy printed
curl -s -o /dev/null -w '%{http_code}\n' $URL/                         # 200
curl -s -X POST $URL/api/ingest/priya-growth -d '{}'                    # {"error":"ingest_unavailable"}
curl -s $URL/api/ai-status                                              # {"enabled":false,"model":null}
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' $URL/opengraph-image   # 200 image/png
```

The share image's absolute URL comes from `VERCEL_PROJECT_PRODUCTION_URL`, which Vercel sets on its own.

## 3. Optional: a real Supabase project

This is for a private deployment with the integration switched on. A free Supabase project is enough. Creating it is a remote action, and the database holds the ingest secrets, so keep this deployment private: the whole console sits behind `OPS_PASSWORD`.

Create the project in the Supabase dashboard, then:

```sh
brew install supabase/tap/supabase      # or: npm i -g supabase
supabase login
supabase link --project-ref <project-ref>
supabase db push                         # runs supabase/migrations/*.sql
```

Two checks only a real project can answer. Run them in the SQL editor:

```sql
-- 1. The app reads as role authenticated with SET LOCAL ROLE. Must be true for the role in DATABASE_URL:
select pg_has_role(current_user, 'authenticated', 'member');
-- If false, as an admin: grant authenticated to postgres;

-- 2. anon must have nothing. Must return no rows:
select table_schema, table_name, privilege_type from information_schema.role_table_grants
where grantee = 'anon' and table_schema in ('public', 'private');
```

Any later migration that adds a table must revoke from `anon` and `authenticated` the same way `20261014000000_init.sql` does, because Supabase's default privileges grant new tables to both.

Load the sample data, then build and run with the database. Use the session pooler or the direct connection (port 5432):

```sh
export DATABASE_URL='postgresql://postgres.<ref>:<db-password>@aws-0-<region>.pooler.supabase.com:5432/postgres'
npm run db:seed                          # only fills an empty database
export OPS_PASSWORD="$(openssl rand -hex 16)"; echo "$OPS_PASSWORD"   # keep it somewhere safe
npm run build && npm start               # the build must see DATABASE_URL
```

On Vercel instead, set `DATABASE_URL` and `OPS_PASSWORD` for Production with `vercel env add`, then `vercel deploy --prod`. Use a separate Vercel project from the public demo, because one build can't be both.

Then, from the machine that runs ziplime: approve a signup in `/ops/intake`, save the key it shows, and run the forwarder command it prints (`python forwarder/ziplime_forwarder.py --help` lists every option).

Known limits before this holds real client data: ingest keys are stored as plain bytes in `private.ingest_keys` (Supabase Vault is the next step), there's no rate limit beyond counting refused calls, and Basic auth is the only login. See `PLAN.md` 15.9.
