# Email signup with Neon Auth

The `/signup` page uses Neon's managed Better Auth through `@neon/auth`.
Users can create an account, sign in, see their current user, and sign out.
When verification is required, users request a code and enter it on the page.
Accounts do not grant access to the dashboard's existing operator functions.

The linked Neon project is `bitter-glade-72523152`, branch
`main` (`br-hidden-leaf-b8l1j76r`). Application SQL uses `jpbir_live`;
the managed Auth service uses `neondb` on that same branch.
The `neon.ts` policy declares managed Auth; `neon deploy` reconciles it and
pulls environment variables into the ignored `.env.local`.
Never commit that file or print its contents.

The API handler `/api/auth-config` returns only `NEON_AUTH_BASE_URL`, a public
service URL. Database connection strings remain on the server. The browser
uses Neon's SDK and hosted session cookies. Application code does not persist
passwords. The SDK controls session persistence and cross-tab broadcasts;
its session data must be treated as sensitive browser state.

Run `npm run build` through `project/environment/run` after changing signup
code or updating its SDK. It regenerates `Frontend/assets/signup.bundle.js`,
which is shipped with this repository's static frontend. Commit the bundle
with its source so the existing Vercel static build includes it. Run
`npm run dev` and visit `http://localhost:3000/signup` to use the page locally.
Use `localhost`: the branch's localhost allowance does not cover the
`127.0.0.1` origin unless it is separately trusted.

Focused checks:

```sh
project/environment/run node --test _shared/tests/neon-email-signup.test.mjs
project/environment/run npx playwright test e2e/neon-auth.spec.mjs
```

To run the live check, set `NEON_AUTH_LIVE_TEST=1` and supply the branch's
public `NEON_AUTH_BASE_URL`. The check creates one uniquely named test account
in the real Auth service, compares signup and session user IDs, checks a
wrong password, signs in again, reloads, and signs out. Its random password
stays in browser memory and is never printed. Browser traces, videos, and
screenshots are disabled by the test. It does not need database credentials.
When verification is required, an ordinary live run reports registration
success and leaves the session check pending. For the complete assisted run,
set `NEON_AUTH_TEST_EMAIL` to an inbox you control and
`NEON_AUTH_MANUAL_VERIFICATION=1`. Enter the emailed code on `/signup` using
"Verify an existing account" in your own browser. Then create the non-secret
`/tmp/neon-email-verified` marker inside the test container to resume its
password sign-in, session read, reload, and sign-out checks. The marker cannot
bypass Neon's verification requirement. The assisted wait expires in ten minutes.

Before publishing the page, configure `NEON_AUTH_BASE_URL` in the hosting
environment, trust the hosting origin on the same Neon branch, and follow
Neon's production checklist for email delivery. If signup requires email
verification, use a test inbox you control and complete that flow; do not
disable verification to make a test pass.
