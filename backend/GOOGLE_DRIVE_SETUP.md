# Google Drive Sync — Local Setup Guide

The LMS backend supports **three ways** to authenticate with Google Drive.
Use whichever fits your situation. You only need **one** of them.

```
Priority order (automatic):
  1. Service Account  ← best for production / shared company drives
  2. OAuth Token      ← best for personal Google account drives
  3. API Key          ← only works for public "anyone with the link" folders
```

---

## Method 1 — Service Account (Recommended)

Use this if your Drive folders are owned by a Google Workspace account
(company Google account) or if you want fully automated access with no
browser login required.

### Step 1 — Create a Google Cloud Project

1. Go to https://console.cloud.google.com
2. Click the project dropdown (top-left) → **New Project**
3. Give it a name like `MCN-LMS` → **Create**
4. Make sure the new project is selected in the dropdown

### Step 2 — Enable the Google Drive API

1. In the left sidebar: **APIs & Services → Library**
2. Search for **Google Drive API**
3. Click it → **Enable**

### Step 3 — Create a Service Account

1. In the left sidebar: **APIs & Services → Credentials**
2. Click **+ Create Credentials → Service Account**
3. Fill in:
   - Name: `lms-drive-reader`
   - Description: `LMS backend Drive access`
4. Click **Create and Continue**
5. For Role: select **Basic → Viewer** (read-only is enough)
6. Click **Done**

### Step 4 — Download the JSON key

1. In the **Credentials** page, click on the service account you just created
2. Go to the **Keys** tab
3. Click **Add Key → Create New Key**
4. Choose **JSON** → **Create**
5. A `.json` file downloads automatically — keep it safe, treat it like a password

The file looks like this:
```json
{
  "type": "service_account",
  "project_id": "mcn-lms-xxxxx",
  "private_key_id": "abc123...",
  "private_key": "-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n",
  "client_email": "lms-drive-reader@mcn-lms-xxxxx.iam.gserviceaccount.com",
  "client_id": "123456789",
  ...
}
```

### Step 5 — Share your Drive folder with the service account

1. Open Google Drive in your browser
2. Right-click the folder that contains your LMS content
3. Click **Share**
4. Paste the **client_email** from the JSON file
   (e.g. `lms-drive-reader@mcn-lms-xxxxx.iam.gserviceaccount.com`)
5. Set permission to **Viewer**
6. Click **Send** (no notification needed)

> Repeat this for every top-level folder you want the LMS to sync from.

### Step 6 — Add the JSON to your .env

Convert the JSON to a single line and paste it into `.env`:

**Option A — Manual (Windows):**
1. Open the downloaded JSON file in Notepad
2. Select all → Copy
3. In `.env`, paste it as the value of `GOOGLE_SERVICE_ACCOUNT_JSON`:

```env
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"mcn-lms-xxxxx","private_key_id":"abc123","private_key":"-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----\n","client_email":"lms-drive-reader@mcn-lms-xxxxx.iam.gserviceaccount.com","client_id":"123456789","auth_uri":"https://accounts.google.com/o/oauth2/auth","token_uri":"https://oauth2.googleapis.com/token","auth_provider_x509_cert_url":"https://www.googleapis.com/oauth2/v1/certs","client_x509_cert_url":"https://www.googleapis.com/robot/v1/metadata/x509/lms-drive-reader%40mcn-lms-xxxxx.iam.gserviceaccount.com"}
```

**Option B — Using Node.js (any OS):**
```bash
node -e "const j=require('./your-service-account-file.json'); console.log(JSON.stringify(j));"
```
Copy the output and paste as the value of `GOOGLE_SERVICE_ACCOUNT_JSON` in `.env`.

**Option C — Using PowerShell (Windows):**
```powershell
(Get-Content "your-service-account-file.json" -Raw) -replace "`r`n","\n" -replace "`n","\n"
```

> **Important:** The value must be all on one line in the `.env` file.
> If the JSON contains newlines in the `private_key` field, they must be
> kept as literal `\n` characters (not real line breaks).

### Step 7 — Verify it works

Start the backend (`npm run dev`) and in the Admin portal:
- Go to any Classroom → **Drive Sync** tab
- Paste a Google Drive folder URL or folder ID
- Click **Sync** — files should appear

---

## Method 2 — OAuth (Personal Google Account)

Use this if your Drive content is under your personal Google account
and you want to connect it through a browser login flow.

### Step 1 — Create OAuth 2.0 Credentials

1. Go to https://console.cloud.google.com
2. Create a project (or reuse the one from Method 1)
3. Enable the **Google Drive API** (same as Method 1 Step 2)
4. Go to **APIs & Services → Credentials**
5. Click **+ Create Credentials → OAuth client ID**
6. If prompted, configure the OAuth consent screen first:
   - User Type: **External**
   - App name: `MCN LMS`
   - Support email: your email
   - Scopes: add `https://www.googleapis.com/auth/drive.readonly`
   - Test users: add your own Google email address
   - Save and Continue through all steps
7. Back on Create OAuth client ID:
   - Application type: **Web application**
   - Name: `LMS Local`
   - Authorized redirect URIs: add `http://localhost:4000/api/drive/oauth2callback`
   - Click **Create**
8. Copy the **Client ID** and **Client Secret** shown

### Step 2 — Add to .env

```env
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:4000/api/drive/oauth2callback
```

### Step 3 — Connect via the Admin portal

1. Start the backend (`npm run dev`)
2. Log into the Admin portal
3. Go to any Classroom → **Drive Sync** tab
4. Click **Connect Google Account**
5. A browser window opens — log in with your Google account
6. Grant the requested permissions
7. You will be redirected back and see "Connected" status

The token is saved in `backend/drive-token.json` and reused automatically.
You only need to connect once (tokens auto-refresh).

> **Localhost deployment note:** For local testing, the redirect URI
> `http://localhost:4000/api/drive/oauth2callback` must exactly match
> what you configured in Google Cloud Console (including the port).

---

## Method 3 — API Key (Public Folders Only)

Use this **only** if all your Drive folders are set to
"Anyone with the link can view". This is the simplest setup but
only works for publicly shared content.

### Step 1 — Create an API key

1. Go to https://console.cloud.google.com
2. Enable the **Google Drive API**
3. Go to **APIs & Services → Credentials**
4. Click **+ Create Credentials → API Key**
5. Copy the key shown
6. (Recommended) Click **Restrict Key**:
   - API restrictions → Restrict to → Google Drive API

### Step 2 — Add to .env

```env
GOOGLE_API_KEY=AIzaSy-your-api-key-here
```

### Step 3 — Make folders public

For each Drive folder containing LMS content:
1. Right-click the folder → **Share**
2. Under "General access" → change to **Anyone with the link**
3. Permission: **Viewer**
4. Copy the link

This method requires no browser login and works on any hosting platform.

---

## For Render (Production Deployment)

**Never put credentials directly in code or commit them to git.**

In the Render dashboard for your backend service:
1. Go to **Environment → Environment Variables**
2. Add the variables you need:

| Key | Value |
|-----|-------|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Paste the full JSON as a single line |
| `GOOGLE_CLIENT_ID` | Your OAuth client ID (if using OAuth) |
| `GOOGLE_CLIENT_SECRET` | Your OAuth client secret (if using OAuth) |
| `GOOGLE_REDIRECT_URI` | Your deployed backend URL + `/api/drive/oauth2callback` |
| `GOOGLE_API_KEY` | Your API key (if using API key method) |

For `GOOGLE_SERVICE_ACCOUNT_JSON` on Render, paste the raw JSON value
(single line, no wrapping quotes around the whole thing).

---

## Checking which method is active

Make a GET request (with your admin session token) to:
```
GET /api/drive/token-status
```

Response will show which auth method is currently active and whether
Drive access is configured.

---

## Summary — which method to use

| Situation | Method |
|-----------|--------|
| Company Google Workspace folders | **Service Account** |
| Personal Google Drive folders | **OAuth** |
| Publicly shared folders (no login) | **API Key** |
| Production on Render | **Service Account** (most reliable, no browser needed) |
| Quick local test with public folder | **API Key** |

---

## Troubleshooting

### "No Google Drive credentials" error
You have none of the three env vars set. Add at least one:
`GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_CLIENT_ID`+`GOOGLE_CLIENT_SECRET`, or `GOOGLE_API_KEY`.

### "The caller does not have permission" (403)
For Service Account: the folder has not been shared with the service account email.
Go to Drive → right-click the folder → Share → add the `client_email` from the JSON.

### "File not found" (404)
The folder ID is wrong, or the folder was not shared with the service account / is not public.

### OAuth redirect mismatch error
The redirect URI in your `.env` does not exactly match what is in Google Cloud Console.
They must be identical including `http://` vs `https://` and port number.

### "invalid_grant" OAuth error
The saved `drive-token.json` has expired. Delete it and reconnect:
```bash
rm backend/drive-token.json
```
Then click "Connect Google Account" in the Admin portal again.

### JSON parse error for service account
The `GOOGLE_SERVICE_ACCOUNT_JSON` value has unescaped newlines.
The `private_key` field must have `\n` as escaped characters, not real line breaks.
Use the Node.js one-liner in Method 1 Step 6 to generate the correct single-line JSON.
