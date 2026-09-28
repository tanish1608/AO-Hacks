'use client';
import { useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Globe,
  LoaderCircle,
} from 'lucide-react';
import type { Chat } from '@/lib/workbench/types';
import { Button } from './ui/button';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
} from './ui/popover';
type HostedLink = {
  id: string;
  revoked: number;
  uses: number;
  max_uses: number;
};
export default function WorkflowPublish({
  chat,
  disabled,
}: {
  chat: Omit<Chat, 'sessionId'>;
  disabled: boolean;
}) {
  const [links, setLinks] = useState<HostedLink[]>([]);
  const [loaded, setLoaded] = useState(false),
    [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState('');
  const active = links.find((link) => !link.revoked);
  const url = active ? `${origin}/w/${active.id}` : '';
  async function refresh() {
    const r = await fetch(`/api/workflows/publish?chatId=${chat.id}`);
    const data = (await r.json()) as { error?: string; links: HostedLink[] };
    if (!r.ok) throw Error(data.error ?? 'Could not load your link.');
    setOrigin(window.location.origin);
    setLinks(data.links);
  }
  useEffect(() => {
    let current = true;
    fetch(`/api/workflows/publish?chatId=${chat.id}`)
      .then(async (r) => {
        const data = (await r.json()) as {
          error?: string;
          links: HostedLink[];
        };
        if (!r.ok) throw Error(data.error ?? 'Could not load your link.');
        if (current) {
          setOrigin(window.location.origin);
          setLinks(data.links);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (current) {
          setError(e.message);
          setLoaded(true);
        }
      });
    return () => {
      current = false;
    };
  }, [chat.id]);
  async function host() {
    setBusy(true);
    setError('');
    setCopied(false);
    try {
      const workflow = chat.versions.at(-1)?.workflow;
      const r = await fetch('/api/workflows/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId: chat.id,
          revision: chat.revision,
          reviewed: true,
          description: (
            workflow?.explanation ||
            workflow?.title ||
            chat.title
          ).slice(0, 2000),
        }),
      });
      const data = (await r.json()) as { error?: string; links: HostedLink[] };
      if (!r.ok) throw Error(data.error ?? 'Could not host this workflow.');
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && loaded && !active && !busy && !error) void host();
      }}
    >
      <PopoverTrigger
        render={
          <Button size="sm" variant="outline" disabled={disabled || !loaded} />
        }
      >
        <Globe size={14} />
        {busy ? 'Hosting…' : 'Host'}
        <ChevronDown size={12} />
      </PopoverTrigger>
      <PopoverContent align="end" className="host-dropdown">
        <PopoverTitle>
          {active ? 'Your workflow link' : 'Host workflow'}
        </PopoverTitle>
        {busy && (
          <p className="host-progress">
            <LoaderCircle size={14} className="spin" /> Preparing your page…
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        {active && (
          <>
            <p>
              Anyone with this link can open the workflow and connect their own
              apps.
            </p>
            <div className="host-link">
              <input
                aria-label="Workflow link"
                value={url}
                readOnly
                onFocus={(e) => e.target.select()}
              />
              <Button
                size="icon"
                variant="ghost"
                aria-label={copied ? 'Link copied' : 'Copy link'}
                onClick={() =>
                  void navigator.clipboard
                    .writeText(url)
                    .then(() => setCopied(true))
                    .catch(() =>
                      setError('Select the link and copy it manually.'),
                    )
                }
              >
                {copied ? <Check size={15} /> : <Copy size={15} />}
              </Button>
            </div>
            <a
              className="host-open"
              href={url}
              target="_blank"
              rel="noreferrer"
            >
              Open workflow <ExternalLink size={13} />
            </a>
            {origin &&
              ['localhost', '127.0.0.1', '[::1]'].includes(
                new URL(origin).hostname,
              ) && (
                <small>
                  Local preview. Internet sharing is available once Foundry is
                  deployed.
                </small>
              )}
            <small>
              {Math.max(0, active.max_uses - active.uses)} runs remaining on
              this link.
            </small>
            <div className="host-secondary">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || disabled}
                onClick={() => void host()}
              >
                Create link for latest version
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    const r = await fetch(`/api/workflows/${active.id}`, {
                      method: 'DELETE',
                    });
                    if (!r.ok) throw Error('Could not disable this link.');
                    await refresh();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Disable link
              </Button>
            </div>
          </>
        )}
        {!active && !busy && (
          <Button disabled={disabled} onClick={() => void host()}>
            Create link
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
