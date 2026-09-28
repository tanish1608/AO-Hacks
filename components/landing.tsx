import Link from 'next/link';
import {
  ArrowRight,
  ClipboardCheck,
  FlaskConical,
  GitBranch,
  Brain,
  ShieldCheck,
  Share2,
} from 'lucide-react';
import BrandLogo from './brand-logo';
import { Button } from './ui/button';

const STEPS = [
  {
    icon: GitBranch,
    title: 'Describe the work',
    body: 'Say what goes in, what should come out, and which exceptions matter. Foundry designs a multi-agent workflow and shows you the graph it built.',
  },
  {
    icon: FlaskConical,
    title: 'Test it on a sample',
    body: 'Every run is scored against criteria frozen before it started. A check with no supporting trace scores zero, so a confident answer cannot pass on its own.',
  },
  {
    icon: ClipboardCheck,
    title: 'Review before anything leaves',
    body: 'Reads run on their own. Anything that writes to a connected app waits for your approval, and each dispatch is recorded so a retry can never send it twice.',
  },
  {
    icon: Brain,
    title: 'Keep what it learns',
    body: 'Lessons about the task stay in that workflow. What it learns about an app’s tools is kept separately and offered to your other workflows.',
  },
];

const DETAIL = [
  {
    icon: ShieldCheck,
    title: 'Evidence, not assertion',
    body: 'Scores cite the trace IDs they came from. A step that needed a tool and has no successful tool call fails the whole evaluation, however good the prose reads.',
  },
  {
    icon: FlaskConical,
    title: 'Corrections you can test',
    body: 'Save real inputs with deterministic expectations. A proposed rule change has to pass every saved case on one version before you can apply it, and you can roll it back.',
  },
  {
    icon: Share2,
    title: 'Shareable workflows',
    body: 'Publish a fixed version as a link. Whoever opens it signs in, uses their own connected accounts, and runs it in their own private session.',
  },
];

export default function Landing({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="landing">
      <header className="landing-nav">
        <Link href="/" className="landing-brand">
          <BrandLogo size={30} />
          <span>Foundry</span>
        </Link>
        <nav>
          {signedIn ? (
            <Link href="/app">
              <Button size="sm">
                Open workspace <ArrowRight size={14} />
              </Button>
            </Link>
          ) : (
            <>
              <Link href="/login" className="landing-link">
                Sign in
              </Link>
              <Link href="/signup">
                <Button size="sm">Get started</Button>
              </Link>
            </>
          )}
        </nav>
      </header>

      <main>
        <section className="landing-hero">
          <p className="landing-eyebrow">Reusable workflows with review built in</p>
          <h1>
            Describe the work once.
            <br />
            Run it with evidence every time.
          </h1>
          <p className="landing-lede">
            Foundry turns a description of repeatable work into an editable multi-agent
            workflow, tests it against criteria it cannot rewrite, and asks before it
            changes anything in your connected apps.
          </p>
          <div className="landing-actions">
            <Link href={signedIn ? '/app' : '/signup'}>
              <Button size="lg">
                {signedIn ? 'Open workspace' : 'Create your workspace'}{' '}
                <ArrowRight size={15} />
              </Button>
            </Link>
            {!signedIn && (
              <Link href="/login" className="landing-link">
                I already have an account
              </Link>
            )}
          </div>
        </section>

        <section className="landing-section">
          <h2>How it works</h2>
          <div className="landing-grid">
            {STEPS.map(({ icon: Icon, title, body }, index) => (
              <article key={title} className="landing-card">
                <span className="landing-step">{index + 1}</span>
                <Icon size={18} />
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-section">
          <h2>Built to be checked</h2>
          <div className="landing-grid three">
            {DETAIL.map(({ icon: Icon, title, body }) => (
              <article key={title} className="landing-card">
                <Icon size={18} />
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* The product's own documentation is careful about this distinction;
            the marketing page should not be the place it quietly goes away. */}
        <section className="landing-note">
          <h2>What a passing run does and does not mean</h2>
          <p>
            A score is a judgment against the criteria you agreed to, checked against
            recorded traces. It is not a measurement of accuracy on work you have not
            tested. Saved test cases are regression evidence for those inputs, not a
            guarantee on new ones. Foundry is built to make that difference visible
            rather than hide it.
          </p>
        </section>

        <section className="landing-cta">
          <h2>Start with one workflow</h2>
          <p>Bring a task you repeat. See the graph, the runs, and the evidence.</p>
          <Link href={signedIn ? '/app' : '/signup'}>
            <Button size="lg">
              {signedIn ? 'Open workspace' : 'Create your workspace'}{' '}
              <ArrowRight size={15} />
            </Button>
          </Link>
        </section>
      </main>

      <footer className="landing-footer">
        <span>
          <BrandLogo size={20} /> Foundry
        </span>
        <span>Workflows you can inspect, test, and correct.</span>
      </footer>
    </div>
  );
}
