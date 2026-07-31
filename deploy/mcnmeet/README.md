# MCNmeet Internal Meeting Server

MCNmeet is the LMS-owned live training meeting service. It uses a self-hosted Jitsi Meet server and the LMS `/MCNmeet` page as the branded entry point.

## Target URLs

- LMS join page: `https://<lms-host>/MCNmeet`
- Internal meeting server: `https://mcnmeet.local` or your real DNS name
- Default room: `MCNmeet`

## Host Requirements

The full server must run on a Linux host with:

- Docker Engine
- Docker Compose plugin
- TCP `80`, `443`, and `4443` open
- UDP `10000` open
- DNS name pointing to the host if using public TLS

This Windows workstation cannot run the stack currently because Docker and WSL are not installed.

## Deploy Steps

1. Download the official `docker-jitsi-meet` stable release on the Linux host.
2. Copy its upstream `compose.yaml` or `docker-compose.yml` into this folder as `docker-jitsi-meet.yml`.
3. Copy `.env.example` to `.env`.
4. Replace:
   - `PUBLIC_URL`
   - `LETSENCRYPT_DOMAIN`
   - `LETSENCRYPT_EMAIL`
   - `JWT_APP_SECRET`
5. Generate upstream Jitsi passwords as required by the release.
6. Start the stack:

```bash
docker compose -f docker-jitsi-meet.yml --env-file .env up -d
```

7. Build the LMS frontend with the internal server URL:

```bash
VITE_MCNMEET_URL=https://mcnmeet.local npm run build --prefix frontend
```

8. Set live-training session links to LMS-owned URLs:

```text
/MCNmeet?room=MCNmeet&role=learner
```

## LMS Integration

The LMS page `/MCNmeet` provides:

- MCN logo and MCN color branding
- Room metadata
- Embedded meeting frame
- Fallback open-room button
- URL parameters for room, role, and title

Examples:

```text
/MCNmeet
/MCNmeet?room=MCNmeet&role=learner
/MCNmeet?room=ILT-20260801-001&role=instructor&title=Live%20Training
```

## Security Model

For production:

- Use JWT authentication.
- Generate rooms from LMS session IDs.
- Allow instructors to start/moderate rooms.
- Allow enrolled learners to join only through LMS.
- Store the external Jitsi server URL in environment config, not in user-entered fields.

Recording, transcription, and advanced moderation can be added with Jibri after the base server is stable.
