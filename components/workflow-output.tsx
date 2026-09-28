import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
/** Structured reports remain downloadable intact, with their readable brief shown first. */
export default function WorkflowOutput({ output }: { output: string }) {
  let brief: string | null = null;
  try {
    const parsed = JSON.parse(output.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''));
    if (parsed && typeof parsed === 'object' && typeof parsed.executive_brief === 'string') brief = parsed.executive_brief;
  } catch { /* Ordinary prose and incomplete streams remain Markdown. */ }
  if (!brief) return <ReactMarkdown remarkPlugins={[remarkGfm]}>{output}</ReactMarkdown>;
  return <><ReactMarkdown remarkPlugins={[remarkGfm]}>{brief}</ReactMarkdown><details className="structured-output"><summary>View full report and structured data</summary><pre>{JSON.stringify(JSON.parse(output.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')),null,2)}</pre></details></>;
}
