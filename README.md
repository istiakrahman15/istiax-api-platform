# ISTIAX API Platform

FastAPI backend + minimal dashboard for user sign-in, API key generation/revocation, and an API-key protected yt-dlp download endpoint.

## Important
- Use only media you own or are authorized to download, and follow each platform's terms.
- Render free instances may sleep, have limited resources, and have ephemeral local files. This starter returns temporary download links; use object storage for reliable production downloads.
- The first version supports API-key creation only after Supabase email/password sign-in.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` in frontend code or public repositories.
- You must install/configure FFmpeg on the Render environment for MP3 extraction and video merging. If needed, use a Docker-based Render service with FFmpeg installed.
- Review platform terms and applicable law before making this a public service.

## 1. Supabase setup
1. Create a Supabase project.
2. Open SQL Editor and run `supabase.sql`.
3. In Project Settings → API, copy the Project URL, anon/public key, and service_role key.
4. Configure email/password authentication in Supabase Auth.

## 2. GitHub
Upload the files in this folder to a new repository, e.g. `istiax-api-platform`.

## 3. Render
Create a Web Service from the repository. Render can read `render.yaml`; add the three Supabase environment variables in the dashboard. Build command: `pip install -r requirements.txt`; start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`.

## 4. API usage
Generate a key in the dashboard. Copy it once.

```bash
curl -X POST "https://YOUR-RENDER-SERVICE.onrender.com/api/v1/download" \
  -H "Authorization: Bearer ix_live_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/your-authorized-media","format":"mp4"}'
```

The JSON response includes a temporary `download_url`, relative to the API host. Join it with your Render base URL to get the full URL.

## Routes
- `GET /health` — health check
- `GET /docs` — interactive API documentation
- `GET /api/me` — current signed-in user
- `GET /api/keys` — list key metadata
- `POST /api/keys` — create a key (full key returned only once)
- `DELETE /api/keys/{key_id}` — revoke key
- `POST /api/v1/download` — download media using API key
- `GET /files/{filename}` — temporary download URL

This is a starter, not a fully hardened production service. Add rate limits, request quotas, background jobs, durable object storage, cleanup scheduling, and monitoring before public launch.
