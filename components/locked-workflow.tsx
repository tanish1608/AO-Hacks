import Link from 'next/link';
import { Lock } from 'lucide-react';
import BrandLogo from './brand-logo';
import { Button } from './ui/button';

/**
 * What a signed-out visitor sees behind a shared workflow link.
 *
 * The blurred layer is a placeholder, not the real workflow. A CSS blur only
 * changes how something looks: the markup underneath still reaches the browser,
 * so blurring the actual steps and description would hand them to anyone who
 * opened the element inspector — or simply read the response body. The shape is
 * there to show a workflow is waiting; the content stays on the server until
 * there is an account to serve it to.
 */
const ROWS = [
  { w: '72%', h: 15 },
  { w: '54%', h: 11 },
  { w: '88%', h: 11 },
  { w: '41%', h: 11 },
];
const STEPS = ['Intake', 'Analysis', 'Review', 'Deliver'];

export default function LockedWorkflow({ id }: { id: string }) {
  const next = encodeURIComponent(`/w/${id}`);
  return (
    <div className="locked-page">
      <div className="locked-behind" aria-hidden>
        <div className="locked-column">
          <div className="locked-card">
            {ROWS.map((r, i) => (
              <span key={i} style={{ width: r.w, height: r.h }} />
            ))}
          </div>
          <div className="locked-card">
            {ROWS.slice(0, 3).map((r, i) => (
              <span key={i} style={{ width: r.w, height: r.h }} />
            ))}
          </div>
        </div>
        <div className="locked-canvas">
          {STEPS.map((name) => (
            <div key={name} className="locked-node">
              <span style={{ width: '58%', height: 11 }} />
              <span style={{ width: '84%', height: 8 }} />
            </div>
          ))}
        </div>
      </div>

      <div className="locked-front">
        <div className="locked-prompt">
          <Link href="/" className="locked-brand">
            <BrandLogo size={30} />
            <span>Foundry</span>
          </Link>
          <span className="locked-badge">
            <Lock size={18} />
          </span>
          <h1>This workflow was shared with you</h1>
          <p>
            Sign in to see what it does and run it. It runs in your own private
            session, using your own connected accounts — the person who shared it
            never sees your input or your results.
          </p>
          <div className="locked-actions">
            <Link href={`/signup?next=${next}`}>
              <Button size="lg">Create an account</Button>
            </Link>
            <Link href={`/login?next=${next}`} className="locked-signin">
              I already have one
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
