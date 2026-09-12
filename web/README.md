# Fencepost harness

Not the product interface. This is the thin client that proves the deployment
shape: a separate Vercel project talking to the Python API across origins, with
every endpoint exercised from a browser.

The real interface comes from the Claude Design prototype, which gets reviewed
against the specs before anyone re-implements it.

    npm install
    npm run dev

Two environment variables:

| Variable | Meaning |
|---|---|
| `NEXT_PUBLIC_FENCEPOST_API` | Base URL of the API project. Defaults to `http://127.0.0.1:8787`. |
| `NEXT_PUBLIC_FENCEPOST_MODE` | `live` talks to the API. `fixtures` answers from canned responses and never leaves the browser, which is what the defence runs on. |
