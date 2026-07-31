import { useMemo } from 'react';
import { useSearchParams } from '../../utils/browserRouter.jsx';
import './mcnmeet.css';

const DEFAULT_ROOM = 'MCNmeet';
const DEFAULT_SERVER = 'https://meet.jit.si';

function cleanRoom(value) {
  return String(value || DEFAULT_ROOM)
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 80) || DEFAULT_ROOM;
}

function meetingServer() {
  return String(import.meta.env.VITE_MCNMEET_URL || DEFAULT_SERVER).replace(/\/+$/, '');
}

export default function MCNmeetPage() {
  const [params] = useSearchParams();
  const room = cleanRoom(params.get('room'));
  const role = params.get('role') || 'learner';
  const title = params.get('title') || 'MCNmeet live training room';
  const server = meetingServer();
  const joinUrl = useMemo(() => `${server}/${room}`, [server, room]);
  const embedUrl = useMemo(() => {
    const config = [
      'prejoinPageEnabled=true',
      'disableDeepLinking=true',
      'startWithAudioMuted=true',
      'startWithVideoMuted=false',
    ].join('&config.');
    return `${joinUrl}#config.${config}&interfaceConfig.SHOW_JITSI_WATERMARK=false`;
  }, [joinUrl]);

  return (
    <main className="mcnmeet-shell">
      <header className="mcnmeet-topbar">
        <a className="mcnmeet-brand" href="/training-calendar?role=trainee">
          <img src="/mcn-logo.png" alt="MCN logo" />
          <span />
          <section>
            <b>MCNmeet</b>
            <small>Internal live training room</small>
          </section>
        </a>
        <nav>
          <a href="/training-calendar?role=trainee">Calendar</a>
          <a className="mcnmeet-open" href={joinUrl} target="_blank" rel="noreferrer">Open room</a>
        </nav>
      </header>

      <section className="mcnmeet-stage">
        <aside className="mcnmeet-panel">
          <div className="mcnmeet-room-mark">MCN</div>
          <span className="mcnmeet-eyebrow">Secure classroom</span>
          <h1>{title}</h1>
          <p>
            Join as {role}. This room is connected to the LMS live-training calendar and is ready
            for instructor-led learning, check-in, attendance evidence and learner participation.
          </p>
          <dl>
            <div><dt>Room</dt><dd>{room}</dd></div>
            <div><dt>Server</dt><dd>{server.replace(/^https?:\/\//, '')}</dd></div>
            <div><dt>Status</dt><dd>Ready to join</dd></div>
          </dl>
          <a className="mcnmeet-primary" href={joinUrl} target="_blank" rel="noreferrer">Join MCNmeet</a>
        </aside>

        <section className="mcnmeet-frame-card" aria-label="MCNmeet embedded meeting">
          <iframe
            title="MCNmeet meeting room"
            src={embedUrl}
            allow="camera; microphone; fullscreen; display-capture; autoplay"
            referrerPolicy="no-referrer"
          />
        </section>
      </section>
    </main>
  );
}
