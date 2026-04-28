import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Database, Eye, FileUp, RefreshCw, RotateCcw, Save, Search, Sparkles, Trash2, X } from 'lucide-react';

type AdminView = 'chunk-review' | 'extraction-jobs';

interface RagRepairAdminProps {
  view: AdminView;
  onNavigate: (view: AdminView) => void;
}

interface MetadataOptions {
  documents: Array<{ id: string; filename: string }>;
  grades: Array<{ id: string; name: string }>;
  subjects: Array<{ id: string; name: string }>;
  topics: Array<{ id: string; title: string }>;
}

const STATUS_STYLES: Record<string, string> = {
  clean: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  needs_review: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  auto_repaired: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
  rejected: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
  embedded: 'bg-violet-500/10 text-violet-300 border-violet-500/30',
  embedding_failed: 'bg-red-500/10 text-red-300 border-red-500/30',
  duplicate: 'bg-zinc-500/10 text-zinc-300 border-zinc-500/30',
};

function badgeFor(status: string) {
  return STATUS_STYLES[status] || 'bg-white/5 text-white/60 border-white/10';
}

export function RagRepairAdmin({ view, onNavigate }: RagRepairAdminProps) {
  const [options, setOptions] = useState<MetadataOptions>({ documents: [], grades: [], subjects: [], topics: [] });
  const [jobs, setJobs] = useState<any[]>([]);
  const [chunks, setChunks] = useState<any[]>([]);
  const [selectedChunk, setSelectedChunk] = useState<any | null>(null);
  const [draft, setDraft] = useState<any | null>(null);
  const [manualEdit, setManualEdit] = useState(false);
  const [retrievalResult, setRetrievalResult] = useState<any | null>(null);
  const [filters, setFilters] = useState({
    document: '',
    grade: '',
    subject: '',
    status: '',
    quality_score: '',
    ocr_detected: '',
    duplicate: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const jobsRefreshInFlight = useRef(false);
  const chunksRefreshInFlight = useRef(false);
  const chunkDetailRefreshInFlight = useRef(false);

  const documentNameById = useMemo(() => new Map(options.documents.map(item => [item.id, item.filename])), [options.documents]);
  const gradeNameById = useMemo(() => new Map(options.grades.map(item => [item.id, item.name])), [options.grades]);
  const subjectNameById = useMemo(() => new Map(options.subjects.map(item => [item.id, item.name])), [options.subjects]);
  const topicTitleById = useMemo(() => new Map(options.topics.map(item => [item.id, item.title])), [options.topics]);

  async function fetchOptions() {
    const res = await fetch('/api/rag/metadata-options');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load metadata options');
    setOptions(data);
  }

  async function fetchJobs(options?: { silent?: boolean }) {
    const silent = options?.silent ?? false;
    if (jobsRefreshInFlight.current) return;
    jobsRefreshInFlight.current = true;
    if (!silent) setIsLoading(true);
    try {
      const res = await fetch('/api/rag/jobs');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load jobs');
      setJobs(data.jobs || []);
      setLastUpdatedAt(new Date().toISOString());
    } finally {
      jobsRefreshInFlight.current = false;
      if (!silent) setIsLoading(false);
    }
  }

  async function fetchChunks(options?: { silent?: boolean }) {
    const silent = options?.silent ?? false;
    if (chunksRefreshInFlight.current) return;
    chunksRefreshInFlight.current = true;
    if (!silent) setIsLoading(true);
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== '') params.set(key, String(value));
      });
      const res = await fetch(`/api/rag/chunks?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load chunks');
      setChunks(data.chunks || []);
      setLastUpdatedAt(new Date().toISOString());
    } finally {
      chunksRefreshInFlight.current = false;
      if (!silent) setIsLoading(false);
    }
  }

  async function openChunk(chunkId: string, options?: { preserveDraft?: boolean; silent?: boolean }) {
    const preserveDraft = options?.preserveDraft ?? false;
    const silent = options?.silent ?? false;
    if (chunkDetailRefreshInFlight.current) return;
    chunkDetailRefreshInFlight.current = true;
    if (!silent) setIsLoading(true);
    const res = await fetch(`/api/rag/chunks/${chunkId}`);
    const data = await res.json();
    try {
      if (!res.ok) throw new Error(data.error || 'Failed to load chunk');
      setSelectedChunk(data);
      setLastUpdatedAt(new Date().toISOString());
      if (!preserveDraft) {
        setDraft({
          id: data.chunk.id,
          content: data.chunk.content,
          title: data.chunk.title || '',
          grade_id: data.chunk.grade_id || '',
          subject_id: data.chunk.subject_id || '',
          topic_id: data.chunk.topic_id || '',
          page_start: data.chunk.page_start ?? '',
          page_end: data.chunk.page_end ?? '',
          language: data.chunk.language || '',
          metadata: data.chunk.metadata || {},
        });
        setManualEdit(false);
        setRetrievalResult(null);
      }
    } finally {
      chunkDetailRefreshInFlight.current = false;
      if (!silent) setIsLoading(false);
    }
  }

  useEffect(() => {
    void fetchOptions();
  }, []);

  useEffect(() => {
    if (view === 'extraction-jobs') {
      void fetchJobs();
    } else {
      void fetchChunks();
    }
  }, [view, filters.document, filters.grade, filters.subject, filters.status, filters.quality_score, filters.ocr_detected, filters.duplicate]);

  useEffect(() => {
    const intervalMs = view === 'extraction-jobs' ? 4000 : 7000;
    const interval = window.setInterval(() => {
      if (actionBusy || uploading) return;
      if (view === 'extraction-jobs') {
        void fetchJobs({ silent: true });
        return;
      }

      void fetchChunks({ silent: true });
      if (selectedChunk?.chunk?.id && !manualEdit) {
        void openChunk(selectedChunk.chunk.id, { preserveDraft: false, silent: true });
      }
    }, intervalMs);

    return () => window.clearInterval(interval);
  }, [view, actionBusy, uploading, selectedChunk?.chunk?.id, manualEdit, filters.document, filters.grade, filters.subject, filters.status, filters.quality_score, filters.ocr_detected, filters.duplicate]);

  async function uploadPdf(file: File) {
    setUploading(true);
    try {
      const buffer = await file.arrayBuffer();
      const res = await fetch('/api/rag/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/pdf',
          'x-filename': file.name,
        },
        body: buffer,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      await fetchJobs();
      onNavigate('extraction-jobs');
    } finally {
      setUploading(false);
    }
  }

  async function runChunkAction(action: string, endpoint: string, payload?: Record<string, any>) {
    if (!selectedChunk || !draft) return;
    setActionBusy(action);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload ?? draft),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed to ${action}`);

      if (action === 'reject') {
        setSelectedChunk(null);
        setDraft(null);
      } else if (data.chunk) {
        await openChunk(data.chunk.id);
      } else {
        await openChunk(selectedChunk.chunk.id);
      }
      await fetchChunks();
    } finally {
      setActionBusy(null);
    }
  }

  async function runRetrievalTest() {
    if (!selectedChunk || !draft) return;
    setActionBusy('retrieval');
    try {
      const res = await fetch(`/api/rag/chunks/${selectedChunk.chunk.id}/test-retrieval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query_text: `${draft.title || 'Chunk'} ${String(draft.content).slice(0, 180)}`,
          document_id: selectedChunk.chunk.document_id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Retrieval test failed');
      setRetrievalResult(data);
    } finally {
      setActionBusy(null);
    }
  }

  async function retryJob(jobId: string, stage: string) {
    setActionBusy(`retry-${jobId}`);
    try {
      const res = await fetch(`/api/rag/jobs/${jobId}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Retry failed');
      await fetchJobs();
    } finally {
      setActionBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-light">{view === 'chunk-review' ? 'Chunk Review' : 'Extraction Jobs'}</h1>
          <p className="text-white/40 text-sm">
            {view === 'chunk-review'
              ? 'Review repaired chunks, edit metadata, embed selectively, and validate retrieval before final activation.'
              : 'Monitor PDF processing stages, inspect logs, and retry extraction/repair/embedding safely.'}
          </p>
          <p className="text-white/30 text-xs mt-2">
            Auto-refresh {view === 'extraction-jobs' ? 'every 4s' : 'every 7s'}
            {lastUpdatedAt ? ` • last sync ${new Date(lastUpdatedAt).toLocaleTimeString()}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              if (view === 'extraction-jobs') {
                void fetchJobs();
              } else {
                void fetchChunks();
                if (selectedChunk?.chunk?.id && !manualEdit) {
                  void openChunk(selectedChunk.chunk.id, { preserveDraft: false });
                }
              }
            }}
            disabled={isLoading || !!actionBusy}
            className="px-4 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-xs uppercase tracking-widest font-black inline-flex items-center gap-2 disabled:opacity-60"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          <button
            onClick={() => onNavigate('chunk-review')}
            className={`px-4 py-2 rounded-xl border text-xs uppercase tracking-widest font-black ${view === 'chunk-review' ? 'bg-white/10 border-white/20 text-white' : 'bg-white/5 border-white/10 text-white/60'}`}
          >
            /admin/chunk-review
          </button>
          <button
            onClick={() => onNavigate('extraction-jobs')}
            className={`px-4 py-2 rounded-xl border text-xs uppercase tracking-widest font-black ${view === 'extraction-jobs' ? 'bg-white/10 border-white/20 text-white' : 'bg-white/5 border-white/10 text-white/60'}`}
          >
            Jobs
          </button>
          <label className="px-4 py-2 rounded-xl border border-[#3ECF8E]/30 bg-[#3ECF8E]/10 text-[#3ECF8E] text-xs uppercase tracking-widest font-black cursor-pointer inline-flex items-center gap-2">
            <FileUp className="w-4 h-4" />
            {uploading ? 'Uploading...' : 'Upload PDF'}
            <input
              type="file"
              accept=".pdf,application/pdf"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void uploadPdf(file);
                }
              }}
            />
          </label>
        </div>
      </div>

      {view === 'chunk-review' && (
        <div className="bg-white/5 border border-white/10 rounded-3xl p-5">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-7 gap-3">
            <select value={filters.document} onChange={e => setFilters(prev => ({ ...prev, document: e.target.value }))} className="bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm">
              <option value="">All documents</option>
              {options.documents.map(doc => <option key={doc.id} value={doc.id}>{doc.filename}</option>)}
            </select>
            <select value={filters.grade} onChange={e => setFilters(prev => ({ ...prev, grade: e.target.value }))} className="bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm">
              <option value="">All grades</option>
              {options.grades.map(grade => <option key={grade.id} value={grade.id}>{grade.name}</option>)}
            </select>
            <select value={filters.subject} onChange={e => setFilters(prev => ({ ...prev, subject: e.target.value }))} className="bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm">
              <option value="">All subjects</option>
              {options.subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
            </select>
            <select value={filters.status} onChange={e => setFilters(prev => ({ ...prev, status: e.target.value }))} className="bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm">
              <option value="">All statuses</option>
              {['clean', 'needs_review', 'auto_repaired', 'rejected', 'embedded', 'embedding_failed', 'duplicate'].map(status => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
            <input value={filters.quality_score} onChange={e => setFilters(prev => ({ ...prev, quality_score: e.target.value }))} placeholder="Min quality" className="bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm" />
            <select value={filters.ocr_detected} onChange={e => setFilters(prev => ({ ...prev, ocr_detected: e.target.value }))} className="bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm">
              <option value="">OCR all</option>
              <option value="true">OCR detected</option>
              <option value="false">Non-OCR</option>
            </select>
            <select value={filters.duplicate} onChange={e => setFilters(prev => ({ ...prev, duplicate: e.target.value }))} className="bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm">
              <option value="">Duplicate all</option>
              <option value="true">Duplicates only</option>
              <option value="false">Unique only</option>
            </select>
          </div>
        </div>
      )}

      <div className="bg-white/5 border border-white/10 rounded-3xl overflow-hidden">
        {isLoading ? (
          <div className="p-20 text-center text-white/40">Loading...</div>
        ) : view === 'extraction-jobs' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-black/30">
                <tr>
                  {['Document', 'Status', 'Created', 'Completed', 'Errors', 'Retry'].map(label => (
                    <th key={label} className="px-5 py-4 text-[11px] uppercase tracking-widest text-white/40">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {jobs.map(job => (
                  <tr key={job.id} className="border-t border-white/5 align-top">
                    <td className="px-5 py-4">
                      <div className="font-medium">{job.rag_documents?.filename || 'Unknown document'}</div>
                      <div className="text-xs text-white/40">{job.id}</div>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex px-3 py-1 rounded-full border text-xs font-black uppercase tracking-widest ${badgeFor(job.status)}`}>
                        {job.status}
                      </span>
                      {Array.isArray(job.logs) && job.logs.length > 0 && (
                        <div className="mt-3 space-y-2 max-w-xl">
                          {job.logs.slice(-4).map((log: any, index: number) => (
                            <div key={index} className={`text-xs ${log.level === 'error' ? 'text-rose-300' : log.level === 'warn' ? 'text-amber-300' : 'text-white/50'}`}>
                              {log.at}: {log.message}
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4 text-sm text-white/60">{job.created_at ? new Date(job.created_at).toLocaleString() : '-'}</td>
                    <td className="px-5 py-4 text-sm text-white/60">{job.completed_at ? new Date(job.completed_at).toLocaleString() : '-'}</td>
                    <td className="px-5 py-4 text-sm text-rose-300">{job.error_message || '—'}</td>
                    <td className="px-5 py-4">
                      <button
                        onClick={() => void retryJob(job.id, job.status)}
                        disabled={actionBusy === `retry-${job.id}`}
                        className="px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-xs uppercase tracking-widest font-black inline-flex items-center gap-2"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Retry
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-black/30">
                <tr>
                  {['Chunk', 'Document', 'Grade', 'Subject', 'Status', 'Quality', 'OCR', 'Duplicate', 'Actions'].map(label => (
                    <th key={label} className="px-5 py-4 text-[11px] uppercase tracking-widest text-white/40">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {chunks.map(chunk => (
                  <tr key={chunk.id} className="border-t border-white/5">
                    <td className="px-5 py-4 max-w-sm">
                      <div className="font-medium">{chunk.title || 'Untitled chunk'}</div>
                      <div className="text-xs text-white/40 line-clamp-2">{String(chunk.content).slice(0, 180)}</div>
                    </td>
                    <td className="px-5 py-4 text-sm text-white/60">{documentNameById.get(chunk.document_id) || chunk.rag_documents?.filename || '—'}</td>
                    <td className="px-5 py-4 text-sm text-white/60">{gradeNameById.get(chunk.grade_id) || chunk.grades?.name || '—'}</td>
                    <td className="px-5 py-4 text-sm text-white/60">{subjectNameById.get(chunk.subject_id) || chunk.subjects?.name || '—'}</td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex px-3 py-1 rounded-full border text-xs font-black uppercase tracking-widest ${badgeFor(chunk.repair_status)}`}>
                        {chunk.repair_status}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-sm text-white/60">{Number(chunk.quality_score ?? 0).toFixed(2)}</td>
                    <td className="px-5 py-4 text-sm text-white/60">{chunk.ocr_detected ? 'Yes' : 'No'}</td>
                    <td className="px-5 py-4 text-sm text-white/60">{chunk.is_duplicate ? 'Yes' : 'No'}</td>
                    <td className="px-5 py-4">
                      <button
                        onClick={() => void openChunk(chunk.id)}
                        className="px-3 py-2 rounded-xl border border-[#3ECF8E]/30 bg-[#3ECF8E]/10 text-[#3ECF8E] text-xs uppercase tracking-widest font-black inline-flex items-center gap-2"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Review
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedChunk && draft && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm p-4 lg:p-8 overflow-y-auto">
          <div className="max-w-7xl mx-auto bg-[#090909] border border-white/10 rounded-3xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-5 border-b border-white/10">
              <div>
                <h2 className="text-2xl font-light">Chunk Review Drawer</h2>
                <p className="text-white/40 text-sm">{selectedChunk.chunk.id}</p>
              </div>
              <button onClick={() => setSelectedChunk(null)} className="p-2 rounded-xl hover:bg-white/10">
                <X className="w-5 h-5" />
              </button>
            </div>
            {manualEdit && (
              <div className="px-6 py-3 border-b border-amber-500/20 bg-amber-500/10 text-amber-200 text-xs uppercase tracking-widest font-black">
                Manual edit mode is on. Auto-refresh for this chunk is paused until you save, accept, or close the drawer.
              </div>
            )}

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-0">
              <div className="border-r border-white/10 p-6 space-y-4">
                <div className="flex items-center gap-2 text-white/40 text-xs uppercase tracking-widest font-black">
                  <Database className="w-4 h-4" />
                  Original Chunk
                </div>
                <textarea value={selectedChunk.chunk.original_content || selectedChunk.chunk.content} readOnly className="w-full min-h-[340px] bg-black/30 border border-white/10 rounded-2xl p-4 text-sm text-white/70" />
              </div>

              <div className="p-6 space-y-4">
                <div className="flex items-center gap-2 text-white/40 text-xs uppercase tracking-widest font-black">
                  <Sparkles className="w-4 h-4" />
                  Repaired / Editable Chunk
                </div>
                <textarea
                  value={draft.content}
                  onChange={e => setDraft((prev: any) => ({ ...prev, content: e.target.value }))}
                  disabled={!manualEdit}
                  className="w-full min-h-[340px] bg-black/30 border border-white/10 rounded-2xl p-4 text-sm text-white/90 disabled:opacity-90"
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input value={draft.title} onChange={e => setDraft((prev: any) => ({ ...prev, title: e.target.value }))} placeholder="Title" className="bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm" />
                  <input value={draft.language} onChange={e => setDraft((prev: any) => ({ ...prev, language: e.target.value }))} placeholder="Language" className="bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm" />
                  <select value={draft.grade_id} onChange={e => setDraft((prev: any) => ({ ...prev, grade_id: e.target.value }))} className="bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm">
                    <option value="">Grade</option>
                    {options.grades.map(grade => <option key={grade.id} value={grade.id}>{grade.name}</option>)}
                  </select>
                  <select value={draft.subject_id} onChange={e => setDraft((prev: any) => ({ ...prev, subject_id: e.target.value }))} className="bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm">
                    <option value="">Subject</option>
                    {options.subjects.map(subject => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
                  </select>
                  <select value={draft.topic_id} onChange={e => setDraft((prev: any) => ({ ...prev, topic_id: e.target.value }))} className="bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm">
                    <option value="">Topic</option>
                    {options.topics.map(topic => <option key={topic.id} value={topic.id}>{topic.title}</option>)}
                  </select>
                  <div className="grid grid-cols-2 gap-3">
                    <input value={draft.page_start} onChange={e => setDraft((prev: any) => ({ ...prev, page_start: e.target.value }))} placeholder="Page start" className="bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm" />
                    <input value={draft.page_end} onChange={e => setDraft((prev: any) => ({ ...prev, page_end: e.target.value }))} placeholder="Page end" className="bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm" />
                  </div>
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <button onClick={() => void runChunkAction('accept', `/api/rag/chunks/${selectedChunk.chunk.id}/accept`)} disabled={!!actionBusy} className="px-4 py-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs uppercase tracking-widest font-black inline-flex items-center justify-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    Accept Repair
                  </button>
                  <button onClick={() => setManualEdit(true)} className="px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white text-xs uppercase tracking-widest font-black inline-flex items-center justify-center gap-2">
                    <Save className="w-4 h-4" />
                    Edit Manually
                  </button>
                  <button onClick={() => void runChunkAction('reject', `/api/rag/chunks/${selectedChunk.chunk.id}/reject`, {})} disabled={!!actionBusy} className="px-4 py-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs uppercase tracking-widest font-black inline-flex items-center justify-center gap-2">
                    <Trash2 className="w-4 h-4" />
                    Reject Chunk
                  </button>
                  <button onClick={() => void runChunkAction('repair', `/api/rag/chunks/${selectedChunk.chunk.id}/repair`, { grade_name: gradeNameById.get(draft.grade_id) || null, subject_name: subjectNameById.get(draft.subject_id) || null })} disabled={!!actionBusy} className="px-4 py-3 rounded-xl bg-sky-500/15 border border-sky-500/30 text-sky-300 text-xs uppercase tracking-widest font-black inline-flex items-center justify-center gap-2">
                    <Sparkles className="w-4 h-4" />
                    Re-run AI Repair
                  </button>
                  <button onClick={() => void runChunkAction('reembed', `/api/rag/chunks/${selectedChunk.chunk.id}/reembed`, {})} disabled={!!actionBusy} className="px-4 py-3 rounded-xl bg-violet-500/15 border border-violet-500/30 text-violet-300 text-xs uppercase tracking-widest font-black inline-flex items-center justify-center gap-2">
                    <RefreshCw className="w-4 h-4" />
                    Re-embed
                  </button>
                  <button onClick={() => void runChunkAction('save', `/api/rag/chunks/${selectedChunk.chunk.id}/save`)} disabled={!!actionBusy} className="px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white text-xs uppercase tracking-widest font-black inline-flex items-center justify-center gap-2">
                    <Save className="w-4 h-4" />
                    Save to Supabase
                  </button>
                  <button onClick={() => void runRetrievalTest()} disabled={!!actionBusy} className="px-4 py-3 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs uppercase tracking-widest font-black inline-flex items-center justify-center gap-2">
                    <Search className="w-4 h-4" />
                    Test Retrieval
                  </button>
                </div>

                <div className="bg-black/20 border border-white/10 rounded-2xl p-4 text-sm text-white/60 space-y-2">
                  <div>Current status: <span className="text-white">{selectedChunk.chunk.repair_status}</span></div>
                  <div>Quality score: <span className="text-white">{Number(selectedChunk.chunk.quality_score ?? 0).toFixed(2)}</span></div>
                  <div>Flags: <span className="text-white">{(selectedChunk.chunk.metadata?.quality_flags ?? []).join(', ') || 'none'}</span></div>
                  <div>Versions saved: <span className="text-white">{selectedChunk.versions?.length ?? 0}</span></div>
                  <div>Embeddings: <span className="text-white">{selectedChunk.embeddings?.length ?? 0}</span></div>
                </div>

                {retrievalResult && (
                  <div className="bg-black/20 border border-white/10 rounded-2xl p-4 space-y-3">
                    <div className="flex items-center gap-2 text-xs uppercase tracking-widest font-black text-white/40">
                      <Search className="w-4 h-4" />
                      Retrieval Test
                    </div>
                    <div className="text-sm text-white/70">{retrievalResult.queryText}</div>
                    <div className="space-y-2">
                      {(retrievalResult.ranked || []).map((hit: any) => (
                        <div key={hit.chunkId} className="p-3 rounded-xl border border-white/10 bg-white/[0.03]">
                          <div className="flex items-center justify-between gap-3">
                            <div className="font-medium text-white/90">{hit.title || hit.chunkId}</div>
                            <div className="text-xs text-[#3ECF8E] font-black">{Number(hit.score).toFixed(4)}</div>
                          </div>
                          <div className="text-xs text-white/50 mt-1">{String(hit.content).slice(0, 140)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
