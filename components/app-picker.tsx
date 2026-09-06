'use client';
import Image from 'next/image';
import { useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import {
  APP_CATALOG,
  ALL_APPS,
  FINANCE_APPS,
  appDefinition,
} from '@/lib/workbench/apps';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from './ui/dropdown-menu';
import { Button } from './ui/button';
export function AppIcon({ slug, size = 20 }: { slug: string; size?: number }) {
  const app = appDefinition(slug);
  return app ? (
    <Image
      unoptimized
      src={app.icon}
      alt=""
      width={size}
      height={size}
      className="app-icon"
      loading="lazy"
    />
  ) : (
    <span className="unknown-app-icon">{slug.slice(0, 1).toUpperCase()}</span>
  );
}
export default function AppPicker({
  value,
  onChange,
  disabled,
  onConnections,
  connected = [],
}: {
  value: string[];
  onChange: (apps: string[]) => void;
  disabled?: boolean;
  onConnections: () => void;
  connected?: string[];
}) {
  const [open, setOpen] = useState(false),
    [category, setCategory] = useState('featured'),
    [query, setQuery] = useState(''),
    [limit, setLimit] = useState(50);
  const choices = (
    category === 'featured'
      ? APP_CATALOG
      : category === 'finance'
        ? APP_CATALOG.filter((a) => FINANCE_APPS.includes(a.slug))
        : ALL_APPS
  ).filter(
    (a) =>
      !query ||
      (a.name + ' ' + a.description)
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="app-picker-trigger"
            disabled={disabled}
          />
        }
      >
        {value.length ? (
          <span className="selected-app-icons">
            {value.slice(0, 3).map((s) => (
              <AppIcon key={s} slug={s} size={16} />
            ))}
          </span>
        ) : (
          <Plus size={15} />
        )}
        <span>
          {value.length
            ? `${value.length} app${value.length === 1 ? '' : 's'}`
            : 'Add apps'}
        </span>
        <ChevronDown size={12} />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="app-picker-menu" side="top" align="start">
        <div className="picker-heading">
          <strong>Apps for this task</strong>
          <span>Choose what your agents can use.</span>
        </div>
        <div className="picker-browse">
          <label>
            Browse apps
            <select
              aria-label="App category"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setLimit(50);
                setQuery('');
              }}
            >
              <option value="featured">Featured</option>
              <option value="finance">Finance & accounting</option>
              <option value="all">
                All {ALL_APPS.length.toLocaleString()} apps
              </option>
            </select>
          </label>
          {category === 'all' && (
            <input
              aria-label="Filter apps"
              placeholder="Filter by app name…"
              value={query}
              onKeyDown={(e) => e.stopPropagation()}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(50);
              }}
            />
          )}
        </div>
        {choices.slice(0, limit).map((app) => (
          <DropdownMenuCheckboxItem
            key={app.slug}
            checked={value.includes(app.slug)}
            disabled={!value.includes(app.slug) && value.length >= 8}
            onCheckedChange={(checked) =>
              onChange(
                checked
                  ? [...value, app.slug].slice(0, 8)
                  : value.filter((s) => s !== app.slug),
              )
            }
            closeOnClick={false}
            className="app-picker-item"
          >
            <AppIcon slug={app.slug} />
            <span>
              <strong>{app.name}</strong>
              <small>{app.description}</small>
            </span>
            {(connected.includes(app.slug) || app.noAuth) && (
              <span className="picker-connected" title="Connected">
                <small>{app.noAuth ? 'Ready' : 'Linked'}</small>
              </span>
            )}
          </DropdownMenuCheckboxItem>
        ))}
        {choices.length > limit && (
          <DropdownMenuItem
            closeOnClick={false}
            onClick={() => setLimit(limit + 50)}
          >
            Show more ({choices.length - limit} remaining)
          </DropdownMenuItem>
        )}
        {!choices.length && <p className="picker-heading">No matching apps.</p>}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => {
            setOpen(false);
            queueMicrotask(onConnections);
          }}
        >
          Manage connections
          <ChevronDown className="rotate-[-90deg]" size={12} />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
