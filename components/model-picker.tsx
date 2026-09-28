'use client';
import { ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from './ui/dropdown-menu';
import { Button } from './ui/button';
import { MODELS, modelChoice } from '@/lib/workbench/models';

/**
 * The model this workflow runs on, in the place the model was already being
 * shown. It used to be a plain label beside the composer, so the one spot a
 * person would click to change the model did nothing, and the actual control
 * sat behind an unlabelled icon called "Test limits".
 *
 * `fallback` is what the server would use when the workflow has expressed no
 * preference — the deployment default, which is not necessarily the code
 * default, since FOUNDRY_MODEL can override it.
 */
export default function ModelPicker({
  value,
  fallback,
  onChange,
  disabled,
}: {
  value?: string;
  fallback?: string;
  onChange: (model: string) => void;
  disabled?: boolean;
}) {
  const effective = value ?? fallback;
  const chosen = modelChoice(effective);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="model-picker-trigger"
            disabled={disabled}
            title="Model this workflow runs on"
          />
        }
      >
        <span>{chosen?.name ?? effective ?? 'Model not configured'}</span>
        <ChevronDown size={12} />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="model-picker-menu" side="top" align="end">
        <div className="picker-heading">
          <strong>Model</strong>
          <span>
            Applies to this workflow’s next run. Recorded cost always comes from
            what the provider actually billed.
          </span>
        </div>
        <DropdownMenuRadioGroup
          value={effective ?? ''}
          onValueChange={(next) => onChange(next as string)}
        >
          {MODELS.map((m) => (
            <DropdownMenuRadioItem
              key={m.id}
              value={m.id}
              closeOnClick
              className="model-picker-item"
            >
              <span>
                <strong>
                  {m.name} <em>{m.maker}</em>
                </strong>
                <small>{m.note}</small>
                <small className="model-price">
                  ${m.inputPrice}/M in · ${m.outputPrice}/M out ·{' '}
                  {Math.round(m.contextTokens / 1000).toLocaleString()}k context
                </small>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {effective && !chosen && (
          <p className="picker-heading">
            This deployment is pinned to <code>{effective}</code> by
            FOUNDRY_MODEL. Choosing here overrides it for this workflow.
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
