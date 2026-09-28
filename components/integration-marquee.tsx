import Image from 'next/image';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { ALL_APPS, appDefinition } from '@/lib/workbench/apps';
import { Button } from './ui/button';

/**
 * Two rows of connectable apps drifting in opposite directions.
 *
 * The count is read from the catalog rather than written into the copy, so the
 * headline cannot drift away from what the product can actually connect to.
 * Each row repeats its own list once so the CSS translation can loop at exactly
 * -50% with no visible seam.
 */
const TOP = [
  'gmail', 'googlesheets', 'slack', 'notion', 'stripe', 'quickbooks',
  'github', 'hubspot', 'salesforce', 'googledrive', 'xero', 'asana',
  'airtable', 'zoom', 'shopify', 'linear',
];
const BOTTOM = [
  'googledocs', 'googleslides', 'jira', 'dropbox', 'intercom', 'netsuite',
  'zendesk', 'trello', 'discord', 'figma', 'calendly', 'mailchimp',
  'clickup', 'monday', 'docusign', 'gitlab',
];

function Row({ slugs, reverse }: { slugs: string[]; reverse?: boolean }) {
  const apps = slugs
    .map((slug) => appDefinition(slug))
    .filter((a): a is NonNullable<typeof a> => Boolean(a));
  return (
    <div className={`marquee-row${reverse ? ' reverse' : ''}`}>
      <div className="marquee-track">
        {[...apps, ...apps].map((app, i) => (
          <span className="marquee-tile" key={`${app.slug}-${i}`} title={app.name}>
            {/* Unoptimized, as brand-logo is: these are already small remote
                icons and the optimizer would only proxy them. */}
            <Image src={app.icon} alt="" width={30} height={30} unoptimized />
          </span>
        ))}
      </div>
    </div>
  );
}

export default function IntegrationMarquee() {
  const total = Math.floor(ALL_APPS.length / 100) * 100;
  return (
    <section className="marquee-section">
      <h2>
        Connect your agents to your own data
        <br />
        <strong>and over {total.toLocaleString()} apps</strong>
      </h2>
      <p>
        Agents discover each app’s real tools at run time — never a guessed API
        call — and every write waits for your approval.
      </p>
      <div className="marquee" aria-hidden>
        <Row slugs={TOP} />
        <Row slugs={BOTTOM} reverse />
      </div>
      <Link href="/signup">
        <Button size="lg">
          Browse all integrations <ArrowRight size={15} />
        </Button>
      </Link>
    </section>
  );
}
