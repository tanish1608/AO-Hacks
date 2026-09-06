'use client';
import { useEffect, useRef, useState } from 'react';
import { FileText, Paperclip, X, LoaderCircle } from 'lucide-react';
import { Button } from './ui/button';
import {
  DOCUMENT_ACCEPT,
  validateDocument,
  validateExtractedText,
  type InputDocument,
} from '@/lib/workbench/documents';

async function extract(file: File): Promise<string> {
  const kind = validateDocument(file.name, file.size);
  if (kind === 'pdf') {
    const pdfjs = await import('pdfjs-dist');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      '../node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).href;
    const task = pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      stopAtErrors: true,
    });
    try {
      const doc = await task.promise;
      if (doc.numPages > 100)
        throw new Error('Choose a PDF with 100 pages or fewer.');
      const pages: string[] = [];
      let length = 0;
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const text = content.items
          .map((item) =>
            'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '',
          )
          .join('');
        length += text.length;
        if (length > 1000000)
          throw new Error('Choose a shorter document excerpt.');
        pages.push(`[Page ${i}]\n${text}`);
      }
      if (!pages.some((p) => p.replace(/\[Page \d+\]/g, '').trim()))
        throw new Error(
          'No readable text found. Export scanned PDFs with OCR first.',
        );
      return pages.join('\n\n');
    } finally {
      await task.destroy();
    }
  }
  if (kind === 'docx') {
    const { unzipSync, strFromU8 } = await import('fflate');
    const zip = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: (entry) => {
        if (entry.name !== 'word/document.xml') return false;
        if (entry.originalSize > 2 * 1024 * 1024)
          throw new Error('Choose a smaller document excerpt.');
        return true;
      },
    });
    if (!zip['word/document.xml'])
      throw new Error('This file is not a readable DOCX document.');
    const xml = new DOMParser().parseFromString(
      strFromU8(zip['word/document.xml']),
      'application/xml',
    );
    if (xml.querySelector('parsererror'))
      throw new Error('This DOCX document is damaged.');
    return [...xml.getElementsByTagNameNS('*', 'p')]
      .map((p) =>
        [...p.getElementsByTagNameNS('*', 't')]
          .map((t) => t.textContent ?? '')
          .join(''),
      )
      .join('\n');
  }
  return file.text();
}
export default function DocumentInput({
  documents,
  onChange,
  disabled,
  onLoading,
}: {
  documents: InputDocument[];
  onChange: (documents: InputDocument[]) => void;
  disabled?: boolean;
  onLoading: (loading: boolean) => void;
}) {
  const picker = useRef<HTMLInputElement>(null),
    generation = useRef(0);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  useEffect(
    () => () => {
      generation.current++;
      onLoading(false);
    },
    [onLoading],
  );
  async function add(files: File[]) {
    const token = ++generation.current;
    setError('');
    setLoading(true);
    onLoading(true);
    try {
      if (files.length + documents.length > 3)
        throw new Error('Attach up to 3 documents per run.');
      const added: InputDocument[] = [];
      for (const file of files)
        added.push({
          name: file.name,
          size: file.size,
          text: validateExtractedText(await extract(file)),
        });
      if (token === generation.current) onChange([...documents, ...added]);
    } catch (e) {
      if (token === generation.current)
        setError(
          e instanceof Error ? e.message : 'Could not read this document.',
        );
    } finally {
      if (token === generation.current) {
        setLoading(false);
        onLoading(false);
      }
    }
  }
  return (
    <div className="document-input">
      <input
        ref={picker}
        type="file"
        accept={DOCUMENT_ACCEPT}
        multiple
        aria-label="Attach input documents"
        className="sr-only"
        disabled={disabled || loading}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (files.length) void add(files);
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || loading || documents.length >= 3}
        onClick={() => picker.current?.click()}
      >
        {loading ? (
          <LoaderCircle size={14} className="spin" />
        ) : (
          <Paperclip size={14} />
        )}{' '}
        {loading ? 'Reading document…' : 'Attach documents'}
      </Button>
      <p className="quiet-text">
        PDF, DOCX, TXT, MD, CSV, JSON · 10 MB each. Review extracted text before
        running; images and document formatting are not included.
      </p>
      {error && (
        <p role="alert" className="document-error">
          {error}
        </p>
      )}
      {documents.map((d, i) => (
        <details className="input-document" key={`${i}:${d.name}`}>
          <summary>
            <FileText size={14} />
            <span>{d.name}</span>
            <small>{d.text.length.toLocaleString()} characters</small>
          </summary>
          <label>
            Text sent to the first agent
            <textarea
              aria-label={`Extracted text from ${d.name}`}
              value={d.text}
              disabled={disabled || loading}
              onChange={(e) =>
                onChange(
                  documents.map((x, j) =>
                    j === i ? { ...x, text: e.target.value } : x,
                  ),
                )
              }
            />
          </label>
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled || loading}
            onClick={() => onChange(documents.filter((_, j) => i !== j))}
          >
            <X size={12} />
            Remove document
          </Button>
        </details>
      ))}
    </div>
  );
}
