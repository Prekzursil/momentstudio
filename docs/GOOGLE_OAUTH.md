# Google OAuth setup

This project uses a **frontend redirect** OAuth flow:

1) Frontend calls `POST /api/v1/auth/google/start` to get the Google authorization URL.
2) The browser is redirected to Google.
3) Google redirects back to the **frontend route** `.../auth/google/callback`.
4) The frontend exchanges the returned `code`+`state` with the backend (`POST /api/v1/auth/google/callback`) to mint API tokens.

## 1) Create an OAuth client (Google Cloud Console)

Google Cloud Console → **APIs & Services** → **Credentials** → **Create credentials** → **OAuth client ID**

Choose:

- **Application type**: Web application

### Authorized JavaScript origins

Add the origins you will serve the frontend from.

Development (pick what you use):

- `http://localhost:4200` (local `start.sh` default)
- `http://localhost:4201` (Docker stack frontend)

Production:

- `https://<your-domain>` (example: `https://momentstudio.ro`)

If you serve both apex + `www`, add both (or keep `www` redirected to apex and only add the canonical origin).

### Authorized redirect URIs

Add the **frontend callback route**. It must match `GOOGLE_REDIRECT_URI` exactly.

Development:

- `http://localhost:4200/auth/google/callback`
- `http://localhost:4201/auth/google/callback`

Production:

- `https://<your-domain>/auth/google/callback`

## 2) Backend environment variables

Set these in `backend/.env` (see `backend/.env.example`):

- `GOOGLE_CLIENT_ID=<from Google console>`
- `GOOGLE_CLIENT_SECRET=<from Google console>`
- `GOOGLE_REDIRECT_URI=<one of the redirect URIs above>`
- Optional: `GOOGLE_ALLOWED_DOMAINS=["example.com"]` to restrict sign-in emails to specific domains.

Notes:

- `GOOGLE_REDIRECT_URI` should point to the frontend callback route for the environment you’re running.
- If you run local dev on a bumped port (e.g. `4202`), update `GOOGLE_REDIRECT_URI` accordingly.

## 3) Frontend requirements

No frontend secret is required.

The login/register pages expose a “Continue with Google” button, which uses the backend endpoints above.

## 4) Common troubleshooting

- **`redirect_uri_mismatch`**: the redirect URI sent by the app is not listed in the Google console. Ensure:
  - The URI matches exactly (scheme/host/port/path).
  - You configured the correct `GOOGLE_REDIRECT_URI` in `backend/.env`.
- **Wrong callback port in local dev**: if the frontend runs on `4201` but `GOOGLE_REDIRECT_URI` is still `http://localhost:4200/...`, Google will redirect to the wrong origin.
- **Consent screen / verification**: for external users, you may need to configure the OAuth consent screen and publish it (or add test users).
