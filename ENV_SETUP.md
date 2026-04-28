# Environment Variables Setup Guide

## Overview
The Scarag app requires specific environment variables for Supabase credentials and API keys. Set them once in environment variables, and they'll work consistently across localhost and all servers.

---

## Required Credentials

### 1. **Supabase Credentials**
Get these from your Supabase project dashboard:

**SUPABASE_URL**
- Go to: Settings → API → Project URL
- Example: `https://pimojkivimygenhygsto.supabase.co`

**SUPABASE_KEY** (Service Role Key)
- Go to: Settings → API → Project API Keys → Service role key
- ⚠️ **Keep this secret!** This key has full database access
- It's a JWT token that looks like: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`

### 2. **Gemini API Key** (for embeddings)
- Go to: [Google AI Studio](https://aistudio.google.com)
- Get your API key from the API keys section
- Set as: `GEMINI_API_KEY`

---

## Setup by Environment

### **Local Development (localhost)**

Create a `.env` file in the project root with your credentials:

```bash
# .env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
GEMINI_API_KEY=AIzaSyC...
OLLAMA_URL=http://localhost:11434/api/generate
OLLAMA_MODEL=qwen2.5:3b
```

**Never commit `.env` to git!** It's already in `.gitignore`.

**To restart after code changes:**

**Windows (PowerShell):**
```powershell
# Press Ctrl+C to stop the current server, then:
npm run dev
```

**Mac/Linux:**
```bash
# Press Ctrl+C to stop the current server, then:
npm run dev
```

If you need to clear cache, use:
```powershell
# Windows
Remove-Item -Recurse -Force dist, node_modules\.vite -ErrorAction SilentlyContinue
npm run dev
```

```bash
# Mac/Linux
rm -rf dist node_modules/.vite
npm run dev
```

### **Server Deployment**

Set environment variables directly on your server (Cloud Run, Docker, Heroku, etc.):

**Docker:**
```dockerfile
ENV SUPABASE_URL=https://your-project.supabase.co
ENV SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
ENV GEMINI_API_KEY=AIzaSyC...
```

**Linux/Unix (production server):**
```bash
# Set in systemd service file, .bashrc, or environment manager
export SUPABASE_URL=https://your-project.supabase.co
export SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
export GEMINI_API_KEY=AIzaSyC...
```

**Heroku:**
```bash
heroku config:set SUPABASE_URL="https://your-project.supabase.co"
heroku config:set SUPABASE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
heroku config:set GEMINI_API_KEY="AIzaSyC..."
```

**Google Cloud Run:**
```bash
gcloud run deploy scarag \
  --set-env-vars SUPABASE_URL=https://your-project.supabase.co \
  --set-env-vars SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9... \
  --set-env-vars GEMINI_API_KEY=AIzaSyC...
```

---

## How It Works

1. **Main server** (`server.ts`): Loads `.env` via `dotenv/config`
2. **Child embedder process** (`embed-chunks.ts`): Inherits environment from parent
3. **Both processes** have access to the same credentials seamlessly

The fix ensures that when the embedder spawns, it explicitly inherits the parent's environment:
```typescript
env: { ...process.env }  // ← This passes credentials to child process
```

---

## Troubleshooting

### "Failed to start background embedder. (Check network)"
- ✅ Check that `SUPABASE_URL` and `SUPABASE_KEY` are set
- ✅ Verify credentials are correct (copy exactly from Supabase)
- ✅ Check network connectivity to Supabase

### "Missing Supabase credentials. Check Config tab"
- ✅ Make sure `.env` file exists in project root
- ✅ Verify variable names match exactly (case-sensitive)
- ✅ For servers: ensure environment variables are set before starting the app

### Credentials work locally but not on server
- ✅ Check that environment variables are set on the server (not just `.env` file)
- ✅ `.env` files are **for local development only**
- ✅ Servers need actual environment variables (systemd, Docker ENV, etc.)

---

## Security Best Practices

🔒 **Never:**
- Commit `.env` file to git
- Share service role keys in Slack/email
- Log credentials anywhere

✅ **Do:**
- Use `.gitignore` (already included)
- Rotate keys regularly in Supabase
- Use a secrets manager for production (1Password, AWS Secrets Manager, etc.)
- Restrict who has access to production credentials
