# Persona onboarding demo

A conversational onboarding trial for Persona. The app offers a browser voice call, complete text fallback, verified Google account linking, durable same-browser progress, and an assistant chat that opens once the user shares a useful goal.

## Run locally

Requires Node.js 20. Copy `.env.example` to `.env.local` and configure:

| Variable | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Google AI Studio key with access to Gemini 3.8 Live and 3.5 Flash-Lite. |
| `GOOGLE_CLIENT_ID` | Google Cloud OAuth **Web application** client ID. |
| `SESSION_SECRET` | Random secret of at least 32 characters for signed account and demo-quota cookies. |

Generate a session secret with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

```sh
npm install
npm run dev
```

Open `http://localhost:3000`. The text and voice assistant show clear errors until the Gemini key and session secret are configured. Google linking stays unavailable until the client ID is configured.

## Google sign-in setup

In Google Cloud Console, create an OAuth client of type **Web application**. Add `http://localhost:3000` and the final Vercel site's HTTPS origin under Authorized JavaScript origins. The app uses Google Identity Services to obtain an ID token and verifies it on the server. It requests identity information only, with no Gmail inbox scopes. Reviewers need a Gmail or Google Workspace account. A Google account backed by a third-party address is rejected by this demo.

## Deploy

Deploy the project directory itself to Vercel, not the unrelated parent repository. Set the three variables above for Preview and Production, deploy a preview, add its origin to the Google client, and verify text, microphone, refresh recovery, and Google sign-in. Promote the checked build to the stable production `*.vercel.app` URL and add that origin as well. Google Identity sign-in uses an origin, not a redirect URI, for this popup flow.

Set a modest daily quota on the Gemini API key in Google AI Studio. The app has a signed-cookie cap of 80 chat and speech requests per browser per UTC day; voice sessions have no separate daily cap. These reduce accidental overuse, not malicious abuse.

## Reviewer path

1. Name the agent.
2. Start the web call and give a name and a goal in any order, or choose Type instead.
3. Hang up, reload, and continue by text; prior turns and confirmed facts should remain.
4. Open the details control to correct facts and link a Google account.
5. Enter Persona after sharing a goal, then ask the assistant for a concrete next step.
6. Reset the demo from details before another run.

Use test details. Raw audio is streamed to Gemini but not stored by this app; recent text turns and profile facts remain in this browser until reset. Google's free API tier may use submitted content to improve its products. Google linking verifies the account address but **does not grant inbox access**. There is no cross-device sync or email reading in this trial.

## Verification

`npm run typecheck`, `npm test`, `npm run test:e2e` (with localhost running), `npm run build`, and `npm audit`.

The browser call uses Gemini Live with a single-use, short-lived token issued by `/api/live-token`. Text replies and voice-transcript observations use `/api/conversation`. Only a verified Google ID token sent to `/api/google` can create a linked-account session. The onboarding reducer is the canonical profile state; voice and text both feed it.
