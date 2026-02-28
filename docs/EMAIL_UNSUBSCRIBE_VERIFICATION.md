# One-click unsubscribe verification (Gmail / Outlook)

This project adds RFC 2369 + RFC 8058 headers to marketing emails:

- `List-Unsubscribe: <https://…/api/v1/newsletter/unsubscribe?token=…>`
- `List-Unsubscribe-Post: List-Unsubscribe=One-Click`

The backend accepts both:

- `GET /api/v1/newsletter/unsubscribe?token=…`
- `POST /api/v1/newsletter/unsubscribe?token=…` (supports form bodies like `List-Unsubscribe=One-Click`)

## What to verify

### 1) Headers are present

Send any marketing email to yourself (examples: coupon assigned, cart abandonment).

In the email client, open the raw message / headers:

- Gmail: **⋮** → **Show original**
- Outlook (web): **…** → **View** → **View message source**

Confirm the headers include:

- `List-Unsubscribe`
- `List-Unsubscribe-Post`

### 2) Client UX shows “Unsubscribe”

Some clients surface an “Unsubscribe” link/button near the sender.

Confirm the UI appears for the message.

### 3) One-click flow actually unsubscribes

Click the client’s “Unsubscribe” action.

Expected result:

- The client performs a POST to the URL in `List-Unsubscribe`.
- The backend marks the newsletter subscriber as unsubscribed.
- If a matching `User` exists, `notify_marketing` becomes `False`.

## Debug tips

- If the client opens a browser tab instead of silently one-clicking, it may:
  - open the API URL (GET), which returns a simple HTML “Unsubscribed” page when the browser sends `Accept: text/html`, or
  - fall back to the frontend `/newsletter/unsubscribe` page (which auto-unsubscribes on load when a token is present).
- If POST unsubscribes fail, check the backend logs for a `400 Invalid unsubscribe token.` response.
- Ensure `FRONTEND_ORIGIN` matches your public site origin (the List-Unsubscribe URL uses this).

## Optional compatibility improvement

If Outlook (or another client) refuses the HTTP URL method, consider adding an additional mailto value to `List-Unsubscribe` (RFC 2369 allows a comma-separated list), e.g.:

`List-Unsubscribe: <https://…>, <mailto:unsubscribe@your-domain>`

This project supports this via `LIST_UNSUBSCRIBE_MAILTO` (optional). When set, marketing emails will emit:

`List-Unsubscribe: <https://…>, <mailto:...>`
