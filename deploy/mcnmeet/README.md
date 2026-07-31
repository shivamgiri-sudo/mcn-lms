# MCNmeet Internal Meeting Server

MCNmeet is the LMS-owned live training meeting service. It uses a self-hosted Jitsi Meet server and the LMS `/MCNmeet` page as the branded entry point.

## Target URLs

- LMS join page: `https://<lms-host>/MCNmeet`
- Internal meeting server: `https://mcnmeet.teammas.in`
- Default room: `MCNmeet`

## Host Requirements

The full server must run on a Linux host with:

- Docker Engine
- Docker Compose plugin
- TCP `80`, `443`, and `4443` open
- UDP `10000` open
- DNS name pointing to the host if using public TLS

This Windows workstation cannot run the stack currently because Docker and WSL are not installed. Deploy this package on the HRMS Linux server.

## DNS And Firewall

Create this DNS record before enabling Let's Encrypt:

```text
mcnmeet.teammas.in  A  115.241.59.220
```

The currently tested HRMS public IP is reachable on ports `22`, `80`, and `443`. Jitsi also needs:

```text
UDP 10000
TCP 4443
```

Open these on the HRMS server firewall and any router/security-group in front of it.

## Deploy Steps

Copy this folder to the HRMS Linux server and run:

```bash
sudo bash install-on-hrms.sh
```

The installer downloads the official `docker-jitsi-meet` release, builds `.env` from the upstream template plus MCNmeet overrides, generates Jitsi passwords when the upstream helper is present, and starts the Docker Compose stack.

Build the LMS frontend with the internal server URL:

```bash
VITE_MCNMEET_URL=https://mcnmeet.teammas.in npm run build --prefix frontend
```

Set live-training session links to LMS-owned URLs:

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
