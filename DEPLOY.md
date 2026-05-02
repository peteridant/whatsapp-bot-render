# Deploying the WhatsApp Bot

This bot uses `whatsapp-web.js`, so it needs:

- a persistent filesystem for `.wwebjs_auth`
- a Chromium browser
- a long-running worker/server process

## Render

This repo includes:

- `Dockerfile`
- `render.yaml`

Steps:

1. Push this project to GitHub.
2. In Render, create a new Blueprint or Worker from the repo.
3. Keep the persistent disk mounted at `/app/data`.
4. Add secrets:
   - `GROQ_API_KEY`
5. Deploy.
6. Open the service logs and scan the WhatsApp QR the first time it appears.

Environment values already prepared:

- `BOT_HEADLESS=true`
- `CHROME_PATH=/usr/bin/chromium`
- `WWEBJS_AUTH_PATH=/app/data/.wwebjs_auth`
- `GROQ_MODEL=llama-3.3-70b-versatile`

## Notes

- If the persistent disk is removed, WhatsApp login will be lost and you will scan again.
- This is still an unofficial WhatsApp Web automation setup, not the official WhatsApp Cloud API.
