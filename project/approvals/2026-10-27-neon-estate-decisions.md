# Owner decisions: the Neon estate, 2026-10-27

Recorded before anything was carried out, as contract rule 10 requires. The
questions were put with a recommendation each, and the owner answered in one
line: "1. yes 2. no 3. decide after 1 4. Yes".

| # | Question | Recommendation | Answer | What the answer does |
|---|---|---|---|---|
| 1 | Repoint the repository's four connection secrets (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`) to `bitter-glade-72523152/br-hidden-leaf-b8l1j76r/jpbir_live`, the database production actually reads | YES | **YES** | The four GitHub Actions secrets are set to the mirror's pooled and unpooled connection strings for `jpbir_live`, role `neondb_owner`, so the workflows and the deployed console name one database. |
| 2 | Delete the five source projects in `org-cold-lake-91548510` | NO | **NO** | Nothing is deleted. The five projects stay intact, so the migration remains reversible and the `pg_dump` archives remain the backup of record. |
| 3 | The two empty databases in the consolidated project `jolly-cake-01200063` (`neondb` with no tables, `txt_file_db` with a `documents` table holding zero rows): drop them, or fill `txt_file_db` with the 1,219 documents | decide after question 1 | **decide after question 1** | Carried out after question 1, and recorded in `project/decisions.md` D-37. |
| 4 | Add a dry run on every schema change to `migrate-production.yml`, so "this migration is pending" shows up in CI instead of depending on someone remembering, while the human confirmation stays where it is, in front of the write | YES | **YES** | A read-only CI job plans the pending migrations against the production warehouse on every schema change to `main`, and reports them. |

## Why question 1 exists

The estate audit recorded in `project/decisions.md` D-36 found two copies of
`jpbir_live` in the meadow organization, byte-identical at the time of
checking, and two different answers to "which database is this?":

- the deployed console wrote its 40 section records and 15 sync states into
  `bitter-glade-72523152/br-hidden-leaf-b8l1j76r/jpbir_live`, and
- the repository's four connection secrets named the consolidated copy,
  `jolly-cake-01200063/jpbir_live`.

Identical data, different destinations. The next workflow write, and the next
migration dispatched by `migrate-production.yml`, would have landed in the copy
the console does not read - and a schema change applied to the wrong database
surfaces as a console failure at runtime, not as a failing job.

Question 1 makes both name the same database: the mirror, which is where
production already writes, whose branch is protected by Vercel as a production
branch, and which holds the three application-facing branch databases the
consolidated copy never had.

## How each YES is carried out

- **Question 1 - the secrets.** The change is **person-run**, by the owner,
  because `project/ACCESS.md` keeps the personal identity out of secret
  mutations and the only identity with permission to write repository secrets
  is the repository owner. The repository ships the command:

  ```
  node .github/scripts/repoint-warehouse-secrets.mjs --yes
  ```

  It mints the pooled and unpooled connection strings for the project, branch
  and database `project/targets.json` records - straight from Neon, so nothing
  is typed by hand - and hands each one to `gh secret set` on standard input.
  No value is printed, logged, or written to this repository. The script
  refuses to run without `--yes`, and refuses an identity that may not write
  secrets on the repository.

  **CI enforces the answer from then on.** The new
  `.github/workflows/migration-dry-run.yml` runs on every schema change to
  `main` and starts by proving that the credential resolves to the project,
  branch and database the manifest records - the same check the apply
  workflow performs, now from one shared script
  (`.github/scripts/verify-production-warehouse.mjs`). A credential that drifts
  away from the manifest fails the job and says so, rather than being
  discovered at the next apply.
- **Question 4 - the dry run.** `migrate.mjs` already supported `--dry-run`,
  which plans the pending migrations inside a read-only transaction and writes
  nothing. The new workflow runs that plan on every schema change, reports the
  pending migrations in the job summary, and fails while any are pending, with
  the dispatch command in the failure message. The human confirmation stays
  where it is, in front of the write.
- **Question 2 - nothing to carry out.** The answer is NO, so no resource is
  deleted and no permission is widened.

## Question 3, decided after question 1

The two empty databases in the consolidated project `jolly-cake-01200063` -
`neondb` with no tables, and `txt_file_db` holding a `documents` table with
zero rows - are **kept**, and the consolidated project becomes an inert
duplicate rather than a second source of truth.

The reasoning: dropping them is a cloud-resource deletion, and the owner's
answer to question 2 was to keep the five source projects for exactly the
reason that reversibility is worth more here than tidiness. Nothing will name
those two databases once the four secrets point at the mirror, they hold no
data to lose, and the `txt_file_db` data itself is already present and
verified in the mirror's `super-dawn-27320917`. Filling `txt_file_db` with the
1,219 documents instead would duplicate 270 MB that is already in the meadow
organization and would recreate the pattern that caused this exercise - two
copies of one dataset. The whole project can still be dropped later on
request, and that would be a separate approval.

Reviewer: the owner, in session, 2026-10-27. Recorded by the `opencode-session`
identity; see `project/ACCESS.md` for that identity's scope and
`project/decisions.md` D-36 for the evidence behind the questions.
