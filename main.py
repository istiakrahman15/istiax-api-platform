import os, secrets, hashlib, tempfile, asyncio, time
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, Header, HTTPException, Depends, Request
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, HttpUrl
from supabase import create_client, Client
import yt_dlp

APP_NAME = "ISTIAX API"
BASE_DIR = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"
DOWNLOAD_DIR = Path(tempfile.gettempdir()) / "istiax-downloads"
DOWNLOAD_DIR.mkdir(exist_ok=True)
MAX_DOWNLOAD_MB = int(os.getenv("MAX_DOWNLOAD_MB", "100"))
FILE_TTL_SECONDS = int(os.getenv("FILE_TTL_SECONDS", "1800"))

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

app = FastAPI(title=APP_NAME, version="1.0.0", description="API-key protected media downloader")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

def db_client() -> Client:
    if not all([SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY]):
        raise HTTPException(503, "Server database is not configured.")
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

def user_from_bearer(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Sign in first.")
    token = authorization.split(" ", 1)[1].strip()
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise HTTPException(503, "Supabase Auth is not configured.")
    try:
        auth_client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
        result = auth_client.auth.get_user(token)
        if not result.user:
            raise ValueError("No user")
        return result.user
    except Exception:
        raise HTTPException(401, "Invalid or expired login session.")

def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()

class DownloadRequest(BaseModel):
    url: HttpUrl
    format: str = "mp4"

@app.get("/", response_class=HTMLResponse)
def home():
    return (STATIC_DIR / "index.html").read_text(encoding="utf-8")

@app.get("/health")
def health():
    return {"ok": True, "service": APP_NAME}

@app.get("/api/me")
def me(user=Depends(user_from_bearer)):
    return {"id": user.id, "email": user.email}

@app.post("/api/keys")
def create_key(user=Depends(user_from_bearer)):
    db = db_client()
    raw_key = "ix_live_" + secrets.token_urlsafe(32)
    row = {
        "user_id": user.id,
        "name": "Default key",
        "key_hash": hash_key(raw_key),
        "key_prefix": raw_key[:16],
        "is_active": True
    }
    try:
        db.table("api_keys").insert(row).execute()
    except Exception:
        raise HTTPException(500, "Could not create API key. Check the Supabase SQL setup.")
    # Full key is shown only once. Only its hash is stored.
    return {"api_key": raw_key, "warning": "Copy this key now. It cannot be shown again."}

@app.get("/api/keys")
def list_keys(user=Depends(user_from_bearer)):
    db = db_client()
    try:
        res = db.table("api_keys").select("id,name,key_prefix,is_active,created_at,last_used_at").eq("user_id", user.id).order("created_at", desc=True).execute()
        return {"keys": res.data or []}
    except Exception:
        raise HTTPException(500, "Could not load keys.")

@app.delete("/api/keys/{key_id}")
def revoke_key(key_id: str, user=Depends(user_from_bearer)):
    db = db_client()
    try:
        res = db.table("api_keys").update({"is_active": False}).eq("id", key_id).eq("user_id", user.id).execute()
        return {"success": True}
    except Exception:
        raise HTTPException(500, "Could not revoke key.")

def api_key_row(api_key: Optional[str]):
    if not api_key or not api_key.startswith("ix_live_"):
        raise HTTPException(401, "Missing or invalid API key. Send Authorization: Bearer YOUR_API_KEY")
    db = db_client()
    try:
        result = db.table("api_keys").select("id,user_id,is_active").eq("key_hash", hash_key(api_key)).limit(1).execute()
        if not result.data:
            raise HTTPException(401, "Invalid API key.")
        row = result.data[0]
        if not row["is_active"]:
            raise HTTPException(403, "This API key has been revoked.")
        db.table("api_keys").update({"last_used_at": "now()"}).eq("id", row["id"]).execute()
        return row
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(503, "Could not validate API key.")

@app.post("/api/v1/download")
async def download_media(body: DownloadRequest, authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Send Authorization: Bearer YOUR_API_KEY")
    row = api_key_row(authorization.split(" ", 1)[1].strip())

    url = str(body.url)
    if not url.startswith(("https://", "http://")):
        raise HTTPException(400, "Only HTTP(S) URLs are supported.")
    fmt = body.format.lower()
    if fmt not in ("mp4", "mp3"):
        raise HTTPException(400, "format must be mp4 or mp3.")
    token = secrets.token_urlsafe(24)
    template = str(DOWNLOAD_DIR / f"{token}.%(ext)s")
    opts = {
        "outtmpl": template,
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "max_filesize": MAX_DOWNLOAD_MB * 1024 * 1024,
        "format": "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" if fmt == "mp4" else "bestaudio/best",
        "merge_output_format": "mp4" if fmt == "mp4" else None,
        "socket_timeout": 20,
    }
    if fmt == "mp3":
        opts["postprocessors"] = [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}]
    opts = {k:v for k,v in opts.items() if v is not None}

    try:
        await asyncio.to_thread(_download, url, opts)
    except Exception as exc:
        raise HTTPException(422, "Download failed. The URL may be unsupported, private, restricted, or require login.")
    matches = list(DOWNLOAD_DIR.glob(f"{token}.*"))
    matches = [p for p in matches if not p.name.endswith((".part", ".ytdl"))]
    if not matches:
        raise HTTPException(422, "No downloadable file was produced. Check FFmpeg and the source URL.")
    file_path = max(matches, key=lambda p: p.stat().st_mtime)
    if file_path.stat().st_size > MAX_DOWNLOAD_MB * 1024 * 1024:
        file_path.unlink(missing_ok=True)
        raise HTTPException(413, f"File exceeds the {MAX_DOWNLOAD_MB} MB server limit.")
    return {
        "success": True,
        "filename": file_path.name,
        "format": file_path.suffix.lstrip("."),
        "size_bytes": file_path.stat().st_size,
        "download_url": f"/files/{file_path.name}",
        "expires_in_seconds": FILE_TTL_SECONDS,
        "note": "Temporary download URL. Files are removed after the configured retention period or server restart."
    }

@app.get("/files/{filename}")
def serve_file(filename: str):
    # Only serve files created by this service, with a safe basename.
    if Path(filename).name != filename or not filename.startswith(tuple([])) and ".." in filename:
        raise HTTPException(400, "Invalid filename.")
    path = DOWNLOAD_DIR / filename
    if not path.exists() or not path.is_file():
        raise HTTPException(404, "File not found or expired.")
    if time.time() - path.stat().st_mtime > FILE_TTL_SECONDS:
        path.unlink(missing_ok=True)
        raise HTTPException(410, "Download link expired.")
    return FileResponse(path, filename=path.name, background=None)

def _download(url: str, opts: dict):
    with yt_dlp.YoutubeDL(opts) as ydl:
        ydl.download([url])
