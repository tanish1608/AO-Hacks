'use client';
import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';

export default function WorkflowRules({ rules, disabled, onSave }: { rules: string[]; disabled: boolean; onSave: (rules: string[]) => Promise<boolean> }) {
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  async function save(next: string[]) {
    setSaving(true);
    try { if (await onSave(next)) setDraft(''); } finally { setSaving(false); }
  }
  return <div className="workflow-rules"><div className="section-intro"><h2>How this workflow should work</h2><p>Save the details you would otherwise repeat. Rules apply only to future runs of this workflow.</p></div>
    <ul>{rules.map((rule,i) => <li key={rule}><span>{rule}</span><Button variant="ghost" size="icon-sm" disabled={disabled || saving} aria-label={`Remove rule ${i+1}`} onClick={() => void save(rules.filter((_,index)=>index!==i))}><X size={15}/></Button></li>)}</ul>
    {!rules.length && <p className="quiet-text">No rules yet. For example: “Hold any invoice without a purchase order number for review.”</p>}
    <form onSubmit={e => {e.preventDefault(); if (draft.trim()) void save([...rules,draft.trim()]);}}>
      <label htmlFor="workflow-rule">Add a rule</label><Textarea id="workflow-rule" value={draft} onChange={e=>setDraft(e.target.value)} maxLength={1000} rows={4} placeholder="When this happens, handle it this way…" disabled={disabled || saving}/>
      <Button type="submit" disabled={disabled || saving || !draft.trim() || rules.length >= 20}><Plus size={14}/>{saving ? 'Saving…' : 'Save rule'}</Button>
    </form><p className="quiet-text">Test after changing a rule. Rules guide the workflow; they do not grant permission to change connected apps.</p>
  </div>;
}
