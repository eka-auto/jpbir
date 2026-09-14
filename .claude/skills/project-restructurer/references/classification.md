# Classification rules — sorting files into the five layers

The guesser in `scripts/classify.py` applies these rules in priority order.
Read this before hand-correcting a plan, so your overrides are consistent with
how the automatic pass thinks.

## Priority order (first decisive signal wins)

1. **Project-wide config/docs** → `_shared`. Files like `package.json`,
   `requirements.txt`, `README.md`, `.gitignore` describe the whole project,
   not one layer.
2. **Path-segment signals.** If any folder in a file's path is literally named
   for a layer (`migrations/`, `components/`, `controllers/`, `infra/`,
   `integrations/`), that wins. An explicit folder is the strongest human
   signal of intent.
3. **Filename signals.** Well-known names: `Dockerfile` → Server,
   `*.model.ts` → Database, `*Controller.java` → Backend, `*Component.tsx` →
   Frontend, anything mentioning a known provider (`stripe`, `twilio`,
   `firebase`, `razorpay`) → Integrations.
4. **Extension/framework signals.** `.tsx/.jsx/.vue/.svelte/.css` → Frontend,
   `.sql/.prisma` → Database. General-purpose languages (`.js/.ts/.py/.go`)
   default to Backend at *low* confidence — they need a path or name signal to
   be sure.
5. **No signal** → `_shared` at low confidence, flagged for human review.

## The golden rule: framework/language beats filename

A file called `server.tsx` is still **Frontend** — `.tsx` is a React view
extension; the name is misleading. Likewise `payment_service.py` inside a
`services/` folder is **Backend** business logic, *not* an Integration, unless
it's specifically the client that talks to an external payment API. Judge by
what the file *is*, not just what it's called.

## Layer definitions with examples

### Frontend — the dining area
What the user sees and interacts with.
- React/Vue/Svelte/Angular components, pages, views
- CSS/SCSS/Tailwind, fonts, images, icons, `public/` static assets
- Client-side routing, state stores (Redux/Pinia), hooks
- `index.html`, `App.tsx`, `main.jsx`

### Backend — the kitchen
Where requests are processed and business rules live.
- Controllers, services, route handlers, middleware
- API endpoint definitions (REST/GraphQL resolvers)
- Server-side validation, auth logic (the *rules*, not the 3rd-party client)
- Business/domain logic, utilities used by the server

### Database — the store room
Everything about persistent data.
- SQL files, schema definitions, `schema.prisma`
- Migrations and seeds
- ORM models / entities / repositories
- Database config (connection strings live in `_shared` env, but ORM setup
  belongs here)

### Server — the whole building
How and where the app runs.
- Application entrypoint / bootstrap (`index.js`, `main.py`, `manage.py`)
- Hosting & deploy: Dockerfile, docker-compose, Kubernetes/Helm, Terraform
- CI/CD pipelines (`.github/workflows`, `.gitlab-ci.yml`)
- Process managers, nginx/proxy config, start scripts

### Integrations — the waiter
Code whose job is to talk to a *third party*.
- Payment SDK clients: Stripe, Razorpay, PayPal
- Messaging: Twilio (SMS), SendGrid/Mailgun (email)
- Auth providers: OAuth, Firebase Auth, Auth0
- Cloud/storage clients: S3, GCS; Maps; analytics; webhook receivers/senders

The test for Integrations: *"Does this file exist mainly to communicate with a
service outside our own system?"* If yes → Integrations. If it's our own logic
that merely happens to be about payments → Backend.

### _shared — used everywhere
Root configs, lockfiles, docs, `.env` samples, monorepo tooling. Keep this
small; if a file really belongs to one layer, put it there.

## Common edge cases

- **`utils/` or `helpers/`** — split by what they help. Frontend formatters →
  Frontend; server helpers → Backend. If truly generic, `_shared`.
- **`types/` or `interfaces/` (TypeScript)** — put with the layer that owns the
  data. Shared DTOs can go `_shared` if used by both client and server.
- **Tests** — mirror the layer of the code they test
  (`Backend/services/x.test.ts`). Keep tests next to their subject for handoff
  clarity rather than a distant `tests/` tree.
- **Config that's layer-specific** — e.g. `vite.config.ts` is Frontend build
  config → Frontend; `nodemon.json` → Server.
- **A single ambiguous script at root** (e.g. `run.sh`) — usually Server
  (it boots or deploys something). Confirm with the user.

When you override the automatic guess, write the reason into the plan's
`reason` field so the decision is auditable in the STATE file.
