# Google Drive Sync — Secure Setup Guide

The LMS backend supports three Google Drive authentication methods. Configure only one method unless you are deliberately testing fallback behaviour.

Priority order:

1. Service account — recommended for production and shared company folders
2. OAuth — suitable for an individually managed Google account
3. Restricted API key — suitable only for public read-only folders

Never commit credentials, downloaded Google key files, OAuth tokens, or copied environment values to Git.

---

## Method 1 — Service Account

Use a service account when Drive folders belong to a Google Workspace organisation or the LMS requires unattended read-only access.

### 1. Create a Google Cloud project

1. Open Google Cloud Console.
2. Create or select the project that will own the LMS integration.
3. Record the project ID in your protected deployment documentation.

### 2. Enable Google Drive API

1. Open **APIs & Services → Library**.
2. Search for **Google Drive API**.
3. Enable it for the selected project.

### 3. Create the service account

1. Open **APIs & Services → Credentials**.
2. Choose **Create Credentials → Service Account**.
3. Use a descriptive name such as `lms-drive-reader`.
4. Grant only the minimum read-only role required for the folders the LMS will consume.
5. Finish account creation.

### 4. Download the Google-generated JSON file

1. Open the new service account.
2. Select **Keys → Add Key → Create New Key**.
3. Choose **JSON**.
4. Store the downloaded file in an approved secret-management location.

A service-account document contains fields such as:

```json
{
  "type": "service_account",
  "project_id": "YOUR_PROJECT_ID",
  "private_key_id": "YOUR_GOOGLE_KEY_ID",
  "private_key": "VALUE_SUPPLIED_ONLY_BY_GOOGLE_CLOUD",
  "client_email": "YOUR_SERVICE_ACCOUNT_EMAIL",
  "client_id": "YOUR_GOOGLE_CLIENT_ID"
}
```

The placeholder above is deliberately not a usable key. Never paste real key material into documentation, issue comments, pull requests, chat messages, source files, or CI logs.

### 5. Share Drive folders

For every top-level folder the LMS may read:

1. Open the folder in Google Drive.
2. Choose **Share**.
3. Add the service account email from the downloaded JSON file.
4. Grant **Viewer** access only.
5. Remove access when the integration is retired.

### 6. Configure the protected environment

Store the complete downloaded JSON document in your deployment secret manager and expose it to the backend as:

```env
GOOGLE_SERVICE_ACCOUNT_JSON=<complete-json-from-your-protected-secret-store>
```

Do not commit the JSON file or a rendered one-line copy. On a local developer machine, use an untracked `.env` file only when an approved secret manager is unavailable.

To produce a single-line value locally without printing it into shell history, use a secure interactive secret-loading method. Avoid commands that echo the credential into CI or shared terminal logs.

### 7. Verify access

1. Start the backend with the protected environment loaded.
2. Sign in as an authorised administrator.
3. Open the classroom Drive Sync area.
4. Sync a folder that has been shared with the service account.
5. Confirm only approved files are returned.

---

## Method 2 — OAuth

Use OAuth when an authorised Google account must connect through the browser.

### 1. Create OAuth credentials

1. Enable Google Drive API in the selected project.
2. Configure the OAuth consent screen.
3. Request only the read-only Drive scope required by the LMS.
4. Create a **Web application** OAuth client.
5. Register the exact callback URL.

Local callback:

```text
http://localhost:4000/api/drive/oauth2callback
```

Production callback example:

```text
https://lms.example.com/api/drive/oauth2callback
```

### 2. Configure protected environment values

```env
GOOGLE_CLIENT_ID=YOUR_GOOGLE_OAUTH_CLIENT_ID
GOOGLE_CLIENT_SECRET=VALUE_FROM_YOUR_SECRET_MANAGER
GOOGLE_REDIRECT_URI=http://localhost:4000/api/drive/oauth2callback
GOOGLE_TOKEN_ENCRYPTION_KEY=REPLACE_WITH_AT_LEAST_32_RANDOM_CHARACTERS
DRIVE_TOKEN_FILE=drive-token.enc
```

The callback URI must match the value registered in Google Cloud exactly, including scheme, host, port, and path.

### 3. Connect the account

1. Start the backend.
2. Sign in as an authorised administrator.
3. Open the classroom Drive Sync area.
4. Select **Connect Google Account**.
5. Complete the Google consent flow.

Refresh tokens are stored only in the encrypted file configured by `DRIVE_TOKEN_FILE`. The encryption key must be supplied separately through the protected environment and must never be stored beside the encrypted token file.

To revoke access, revoke the OAuth grant in Google Account security settings and remove the encrypted token file from the protected runtime volume during an authorised maintenance change.

---

## Method 3 — Restricted API Key

Use this method only for folders intentionally configured as public, read-only content. It provides no access to private files.

### 1. Create and restrict the key

1. Enable Google Drive API.
2. Create an API key.
3. Restrict the key to Google Drive API.
4. Apply appropriate application restrictions where supported.
5. Store the value in an approved secret manager.

### 2. Configure the environment

```env
GOOGLE_API_KEY=VALUE_FROM_YOUR_SECRET_MANAGER
```

### 3. Confirm public-folder governance

Before using this method, confirm that publishing the folder is permitted by company policy and does not expose employee, client, training, or operationally sensitive information.

---

## Production configuration

Use the hosting platform's protected environment or secret-manager integration. Configure only the variables required by the selected method:

| Variable | Purpose |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Complete service-account JSON from protected storage |
| `GOOGLE_CLIENT_ID` | OAuth client identifier |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret |
| `GOOGLE_REDIRECT_URI` | Exact authorised callback URI |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | Encryption key for persisted OAuth tokens |
| `DRIVE_TOKEN_FILE` | Encrypted token-file location |
| `GOOGLE_API_KEY` | Restricted API key for public folders only |
| `DRIVE_MAX_FILES` | Maximum files returned during one sync |
| `DRIVE_MAX_RECURSION_DEPTH` | Maximum folder traversal depth |

Recommended production method: service account with Viewer access to explicitly shared folders.

---

## Verify the active method

With an authorised administrator session, request:

```text
GET /api/drive/token-status
```

The response identifies the configured authentication method without returning credential values.

---

## Troubleshooting

### No Google Drive credentials

Configure one supported method:

- service account JSON; or
- OAuth client ID, client secret, redirect URI, encryption key, and encrypted token-file location; or
- restricted API key for public folders.

### Permission denied

For a service account, confirm the folder was shared with the exact service-account email and that inherited folder restrictions allow read access.

For OAuth, confirm the connected account has access and the requested scope is still authorised.

### File not found

Confirm the folder or file ID, sharing permissions, and Drive ownership. A private item cannot be read through the public API-key method.

### OAuth redirect mismatch

The configured redirect URI and Google Cloud OAuth redirect URI must be identical.

### OAuth grant expired or revoked

Reconnect through the administrator portal after revoking the old Google grant. Remove the encrypted token file only through an authorised maintenance process; never replace it with a plaintext token file.

### Service-account JSON parse error

Load the complete Google-downloaded JSON document from protected storage. Do not manually reconstruct key material or copy a key-shaped example from documentation.

### Security incident

If any Google credential was committed, pasted into a public location, or exposed through logs:

1. revoke or delete it immediately in Google Cloud;
2. rotate dependent credentials;
3. remove it from active environments;
4. follow the private vulnerability-reporting process in `SECURITY.md`;
5. do not rely on deleting the latest source file as a substitute for credential rotation.
