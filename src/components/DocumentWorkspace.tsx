import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Upload, FileText, CheckCircle2, AlertCircle, Clock, Play, MoreVertical, Search, FileUp, Settings, ChevronRight, X, RefreshCw } from 'lucide-react';
import { getSupabase } from '../utils/supabaseClient';
import { extractMetadataFromFilename, slugifyMetadataLabel, type DocumentType, type ExtractedDocumentMetadata } from '../lib/documentMetadataExtractor';

type MetadataOptions = {
  grades: Array<{ id: string; name: string }>;
  subjects: Array<{ id: string; name: string }>;
  topics: Array<{ id: string; title: string; grade_id?: string | null; subject_id?: string | null; subjects?: { name?: string } | null }>;
};

type MetadataForm = {
  grade: string;
  subject: string;
  topic: string;
  language: ExtractedDocumentMetadata['detectedLanguage'];
  documentType: DocumentType;
  variant: string;
  academicYear: string;
};

const emptyMetadataForm: MetadataForm = {
  grade: '',
  subject: '',
  topic: '',
  language: 'unknown',
  documentType: 'unknown',
  variant: '',
  academicYear: '',
};

export function DocumentWorkspace() {
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showMetadataDrawer, setShowMetadataDrawer] = useState(false);
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [metadataOptions, setMetadataOptions] = useState<MetadataOptions>({ grades: [], subjects: [], topics: [] });
  const [metadataForm, setMetadataForm] = useState<MetadataForm>(emptyMetadataForm);
  const [detectedMetadata, setDetectedMetadata] = useState<ExtractedDocumentMetadata | null>(null);
  const [autoFilledFields, setAutoFilledFields] = useState<Set<keyof MetadataForm>>(new Set());
  const [metadataUploadBusy, setMetadataUploadBusy] = useState(false);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const gradeNames = useMemo(() => {
    const names = metadataOptions.grades.map(grade => grade.name);
    if (detectedMetadata?.gradeLabel && !names.includes(detectedMetadata.gradeLabel)) names.unshift(detectedMetadata.gradeLabel);
    return names;
  }, [metadataOptions.grades, detectedMetadata?.gradeLabel]);

  const subjectNames = useMemo(() => {
    const names = metadataOptions.subjects.map(subject => subject.name);
    if (metadataForm.subject && !names.includes(metadataForm.subject)) names.unshift(metadataForm.subject);
    return names;
  }, [metadataOptions.subjects, metadataForm.subject]);

  const fetchDocuments = async () => {
    setLoading(true);
    try {
      const supabase = await getSupabase();
      // Use maybeSingle or generic select
      const { data, error } = await supabase
        .from('rag_documents')
        .select(`
          *,
          rag_extraction_jobs (
            status, logs, updated_at
          )
        `)
        .order('created_at', { ascending: false });
        
      if (error) throw error;
      setDocuments(data || []);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchMetadataOptions = async () => {
    try {
      const res = await fetch('/api/rag/metadata-options');
      if (!res.ok) return;
      const data = await res.json();
      setMetadataOptions({
        grades: data.grades ?? [],
        subjects: data.subjects ?? [],
        topics: data.topics ?? [],
      });
    } catch (err) {
      console.warn('Failed to load metadata options', err);
    }
  };

  const resolveGradeLabel = (extracted: ExtractedDocumentMetadata) => {
    if (!extracted.gradeLabel) return '';
    const gradeSlug = extracted.gradeSlug ? slugifyMetadataLabel(extracted.gradeSlug) : '';
    const gradeLabelSlug = slugifyMetadataLabel(extracted.gradeLabel);
    return metadataOptions.grades.find(grade => {
      const nameSlug = slugifyMetadataLabel(grade.name);
      return nameSlug === gradeLabelSlug || Boolean(gradeSlug && nameSlug.includes(gradeSlug));
    })?.name ?? extracted.gradeLabel;
  };

  const resolveSubjectLabel = (extracted: ExtractedDocumentMetadata, gradeLabel: string) => {
    if (!extracted.topicTitle) return undefined;
    const topicSlug = slugifyMetadataLabel(extracted.topicTitle);
    const grade = metadataOptions.grades.find(item => item.name === gradeLabel);
    const topicMatch = metadataOptions.topics.find(topic => {
      const titleSlug = slugifyMetadataLabel(topic.title);
      const gradeMatches = !grade?.id || !topic.grade_id || topic.grade_id === grade.id;
      return gradeMatches && (titleSlug === topicSlug || titleSlug.includes(topicSlug) || topicSlug.includes(titleSlug));
    });

    const subjectName = topicMatch?.subjects?.name;
    if (!subjectName && !topicMatch?.subject_id) return undefined;
    return subjectName ?? metadataOptions.subjects.find(subject => subject.id === topicMatch?.subject_id)?.name;
  };

  const applyFilenameMetadata = (file: File) => {
    const extracted = extractMetadataFromFilename(file.name);
    const grade = resolveGradeLabel(extracted);
    const subject = resolveSubjectLabel(extracted, grade);
    const warnings = subject
      ? extracted.warnings.filter(warning => !warning.startsWith('Subject could not'))
      : extracted.warnings;
    const resolved: ExtractedDocumentMetadata = {
      ...extracted,
      gradeLabel: grade || extracted.gradeLabel,
      subjectLabel: subject,
      subjectSlug: subject ? slugifyMetadataLabel(subject) : undefined,
      confidence: subject && extracted.confidence === 'medium' ? 'high' : extracted.confidence,
      warnings,
    };
    const nextAutoFilled = new Set<keyof MetadataForm>();
    if (resolved.gradeLabel) nextAutoFilled.add('grade');
    if (resolved.subjectLabel) nextAutoFilled.add('subject');
    if (resolved.topicTitle) nextAutoFilled.add('topic');
    if (resolved.detectedLanguage !== 'unknown') nextAutoFilled.add('language');
    if (resolved.documentType && resolved.documentType !== 'unknown') nextAutoFilled.add('documentType');
    if (resolved.variant) nextAutoFilled.add('variant');

    setDetectedMetadata(resolved);
    setAutoFilledFields(nextAutoFilled);
    setMetadataForm({
      ...emptyMetadataForm,
      grade: resolved.gradeLabel ?? '',
      subject: resolved.subjectLabel ?? '',
      topic: resolved.topicTitle ?? '',
      language: resolved.detectedLanguage,
      documentType: resolved.documentType ?? 'unknown',
      variant: resolved.variant ?? '',
    });
  };

  const updateMetadataField = <K extends keyof MetadataForm>(field: K, value: MetadataForm[K]) => {
    setMetadataForm(current => ({ ...current, [field]: value }));
    setAutoFilledFields(current => {
      const next = new Set(current);
      next.delete(field);
      return next;
    });
  };

  const uploadWithMetadata = async () => {
    if (!metadataForm.grade || !metadataForm.topic || metadataUploadBusy) return;
    setMetadataUploadBusy(true);
    setMetadataError(null);
    try {
      for (const file of stagedFiles) {
        const payload = {
          grade: metadataForm.grade,
          subject: metadataForm.subject || undefined,
          topic: metadataForm.topic,
          language: metadataForm.language,
          documentType: metadataForm.documentType,
          variant: metadataForm.variant || undefined,
          academicYear: metadataForm.academicYear || undefined,
          filenameDetection: detectedMetadata,
        };
        const res = await fetch('/api/rag/upload', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/pdf',
            'x-filename': encodeURIComponent(file.name),
            'x-document-metadata': encodeURIComponent(JSON.stringify(payload)),
          },
          body: file,
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Failed to upload ${file.name}`);
        }
      }
      setShowMetadataDrawer(false);
      setStagedFiles([]);
      setMetadataForm(emptyMetadataForm);
      setDetectedMetadata(null);
      await fetchDocuments();
    } catch (err: any) {
      setMetadataError(err.message || 'Upload failed.');
    } finally {
      setMetadataUploadBusy(false);
    }
  };

  useEffect(() => {
    fetchDocuments();
    fetchMetadataOptions();
  }, []);

  useEffect(() => {
    if (showMetadataDrawer && stagedFiles[0]) {
      applyFilenameMetadata(stagedFiles[0]);
    }
  }, [showMetadataDrawer, stagedFiles, metadataOptions]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setStagedFiles(Array.from(e.target.files));
      setShowMetadataDrawer(true);
      setMetadataError(null);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-light mb-2">Documents Workspace</h1>
          <p className="text-white/40 text-sm">Upload, tag, and process your PDFs through the RAG pipeline.</p>
        </div>
        <div className="flex items-center gap-3">
          <input 
            type="file" 
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".pdf,application/pdf"
            multiple
            className="hidden" 
          />
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-6 py-2.5 bg-[var(--color-accent)] text-black rounded-xl font-bold text-xs uppercase tracking-widest hover:shadow-[0_0_15px_var(--color-accent-dim)] transition-all"
          >
            <Upload className="w-4 h-4" />
            Upload PDF
          </button>
        </div>
      </header>

      {/* Main Table */}
      <div className="bg-[#0a0a0a] border border-white/10 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-white/30" />
            <input 
              type="text" 
              placeholder="Search documents..."
              className="bg-black/50 border border-white/10 rounded-lg pl-10 pr-4 py-2 text-sm text-white focus:outline-none focus:border-[var(--color-accent)]/50 transition-colors w-64"
            />
          </div>
          <button onClick={fetchDocuments} className="text-white/40 hover:text-white p-2 rounded-lg hover:bg-white/5">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {loading && documents.length === 0 ? (
          <div className="p-20 text-center flex flex-col items-center justify-center text-white/40">
            <div className="w-8 h-8 border-2 border-[var(--color-accent)] border-t-transparent rounded-full animate-spin mb-4" />
            Loading documents...
          </div>
        ) : documents.length === 0 ? (
          <div className="p-20 text-center flex flex-col items-center justify-center text-white/40">
            <FileUp className="w-12 h-12 mb-4 text-white/20" />
            <p className="text-lg">No documents uploaded yet.</p>
            <p className="text-sm mt-1">Upload a PDF to begin the ingestion process.</p>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-black/40 border-b border-white/5">
                <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-white/40">Document</th>
                <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-white/40">Metadata</th>
                <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-white/40">Status</th>
                <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-white/40">Next Action</th>
                <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-bold text-white/40 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {documents.map((doc) => {
                const job = doc.rag_extraction_jobs?.[0];
                const status = job ? job.status : 'metadata_required';
                
                return (
                  <tr key={doc.id} className="hover:bg-white/[0.02] transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-start gap-3">
                        <FileText className="w-5 h-5 text-red-400 mt-0.5 shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-white/90 truncate max-w-[200px]" title={doc.original_filename}>
                            {doc.original_filename}
                          </p>
                          <p className="text-[10px] text-white/40 mt-1">{(doc.file_size / 1024 / 1024).toFixed(2)} MB</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1 text-[10px]">
                        {doc.metadata?.grade ? (
                          <>
                            <span className="text-white/60">G: {doc.metadata.grade}</span>
                            <span className="text-white/60">S: {doc.metadata.subject}</span>
                          </>
                        ) : (
                          <span className="text-amber-500/80">Missing Metadata</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        status === 'completed' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                        status === 'processing' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                        status === 'failed' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                        'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                      }`}>
                        {status === 'processing' && <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />}
                        {status.replace('_', ' ')}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {status === 'metadata_required' || !doc.metadata?.grade ? (
                        <button className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-accent)] hover:text-white flex items-center gap-1">
                          Add Metadata <ChevronRight className="w-3 h-3" />
                        </button>
                      ) : status === 'failed' ? (
                        <button className="text-[10px] font-bold uppercase tracking-widest text-red-400 hover:text-white flex items-center gap-1">
                          Retry Step <ChevronRight className="w-3 h-3" />
                        </button>
                      ) : status === 'completed' ? (
                        <button className="text-[10px] font-bold uppercase tracking-widest text-emerald-400 hover:text-white flex items-center gap-1">
                          Review Chunks <ChevronRight className="w-3 h-3" />
                        </button>
                      ) : (
                        <button className="text-[10px] font-bold uppercase tracking-widest text-blue-400 hover:text-white flex items-center gap-1">
                          Run Pipeline <Play className="w-3 h-3" />
                        </button>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button className="p-2 hover:bg-white/10 rounded-lg text-white/40 hover:text-white transition-colors">
                        <MoreVertical className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Upload & Metadata Drawer */}
      {showMetadataDrawer && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm">
          <div className="w-[400px] h-full bg-[#0a0a0a] border-l border-white/10 p-6 flex flex-col shadow-2xl animate-in slide-in-from-right duration-300">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-xl font-light flex items-center gap-2">
                <FileText className="w-5 h-5 text-[var(--color-accent)]" />
                Document Metadata
              </h2>
              <button onClick={() => setShowMetadataDrawer(false)} className="text-white/40 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-6 custom-scrollbar pr-2">
              <div className="p-4 bg-white/[0.02] border border-white/5 rounded-xl">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <p className="text-[10px] uppercase tracking-widest font-bold text-white/40">Files to upload</p>
                  {detectedMetadata && (
                    <span className={`px-2 py-0.5 rounded-full border text-[9px] font-bold uppercase tracking-widest ${
                      detectedMetadata.confidence === 'high' ? 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10' :
                      detectedMetadata.confidence === 'medium' ? 'border-amber-500/30 text-amber-300 bg-amber-500/10' :
                      'border-white/15 text-white/50 bg-white/5'
                    }`}>
                      {detectedMetadata.confidence}
                    </span>
                  )}
                </div>
                {stagedFiles.map((f, i) => (
                  <p key={i} className="text-sm font-medium text-white/80 truncate mb-1">{f.name}</p>
                ))}
                <button
                  type="button"
                  onClick={() => stagedFiles[0] && applyFilenameMetadata(stagedFiles[0])}
                  className="mt-3 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-[var(--color-accent)] hover:text-white"
                >
                  <RefreshCw className="w-3 h-3" />
                  Re-detect from filename
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <div className="flex items-center gap-2 ml-1">
                    <label className="text-[10px] uppercase font-bold text-white/40">Grade Level</label>
                    {autoFilledFields.has('grade') && <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--color-accent)]/10 text-[var(--color-accent)]">Detected from filename</span>}
                  </div>
                  <select
                    value={metadataForm.grade}
                    onChange={(e) => updateMetadataField('grade', e.target.value)}
                    className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-[var(--color-accent)]/50 mt-1"
                  >
                    <option value="">-- Select Grade --</option>
                    {gradeNames.map(name => <option key={name} value={name}>{name}</option>)}
                  </select>
                </div>
                <div>
                  <div className="flex items-center gap-2 ml-1">
                    <label className="text-[10px] uppercase font-bold text-white/40">Subject</label>
                    {autoFilledFields.has('subject') && <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--color-accent)]/10 text-[var(--color-accent)]">Detected from filename</span>}
                  </div>
                  <select
                    value={metadataForm.subject}
                    onChange={(e) => updateMetadataField('subject', e.target.value)}
                    className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-[var(--color-accent)]/50 mt-1"
                  >
                    <option value="">Needs confirmation</option>
                    {subjectNames.map(name => <option key={name} value={name}>{name}</option>)}
                  </select>
                </div>
                <div>
                  <div className="flex items-center gap-2 ml-1">
                    <label className="text-[10px] uppercase font-bold text-white/40">Topic</label>
                    {autoFilledFields.has('topic') && <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--color-accent)]/10 text-[var(--color-accent)]">Detected from filename</span>}
                  </div>
                  <input
                    type="text"
                    value={metadataForm.topic}
                    onChange={(e) => updateMetadataField('topic', e.target.value)}
                    placeholder="Topic name..."
                    className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-[var(--color-accent)]/50 mt-1"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="flex items-center gap-2 ml-1">
                      <label className="text-[10px] uppercase font-bold text-white/40">Language</label>
                      {autoFilledFields.has('language') && <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--color-accent)]/10 text-[var(--color-accent)]">Detected</span>}
                    </div>
                    <select
                      value={metadataForm.language}
                      onChange={(e) => updateMetadataField('language', e.target.value as MetadataForm['language'])}
                      className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-[var(--color-accent)]/50 mt-1"
                    >
                      <option value="unknown">Unknown</option>
                      <option value="ar">Arabic</option>
                      <option value="fr">French</option>
                      <option value="en">English</option>
                    </select>
                  </div>
                  <div>
                    <div className="flex items-center gap-2 ml-1">
                      <label className="text-[10px] uppercase font-bold text-white/40">Type</label>
                      {autoFilledFields.has('documentType') && <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--color-accent)]/10 text-[var(--color-accent)]">Detected</span>}
                    </div>
                    <select
                      value={metadataForm.documentType}
                      onChange={(e) => updateMetadataField('documentType', e.target.value as DocumentType)}
                      className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-[var(--color-accent)]/50 mt-1"
                    >
                      <option value="unknown">Unknown</option>
                      <option value="lesson">Lesson</option>
                      <option value="exercise">Exercise</option>
                      <option value="exam">Exam</option>
                      <option value="correction">Correction</option>
                      <option value="summary">Summary</option>
                    </select>
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-2 ml-1">
                    <label className="text-[10px] uppercase font-bold text-white/40">Model / Variant</label>
                    {autoFilledFields.has('variant') && <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--color-accent)]/10 text-[var(--color-accent)]">Detected from filename</span>}
                  </div>
                  <input
                    type="text"
                    value={metadataForm.variant}
                    onChange={(e) => updateMetadataField('variant', e.target.value)}
                    placeholder="e.g. نموذج1"
                    className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-[var(--color-accent)]/50 mt-1"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase font-bold text-white/40 ml-1">Academic Year</label>
                  <input
                    type="text"
                    value={metadataForm.academicYear}
                    onChange={(e) => updateMetadataField('academicYear', e.target.value)}
                    placeholder="e.g. 2024"
                    className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-[var(--color-accent)]/50 mt-1"
                  />
                </div>
              </div>

              {detectedMetadata?.warnings.length ? (
                <div className="p-3 rounded-xl border border-amber-500/20 bg-amber-500/10 text-amber-100/80 text-xs space-y-1">
                  {detectedMetadata.warnings.map(warning => <p key={warning}>{warning}</p>)}
                </div>
              ) : null}
              {metadataError && (
                <div className="p-3 rounded-xl border border-red-500/20 bg-red-500/10 text-red-100/80 text-xs">
                  {metadataError}
                </div>
              )}
            </div>

            <div className="pt-6 border-t border-white/10">
              <button 
                onClick={uploadWithMetadata}
                disabled={!metadataForm.grade || !metadataForm.topic || metadataUploadBusy}
                className="w-full py-3 bg-[var(--color-accent)] disabled:bg-white/10 disabled:text-white/30 text-black font-bold uppercase text-[10px] tracking-widest rounded-xl hover:shadow-[0_0_15px_var(--color-accent-dim)] disabled:hover:shadow-none transition-all"
              >
                {metadataUploadBusy ? 'Uploading...' : metadataForm.grade && metadataForm.topic ? 'Confirm & Start Processing' : 'Complete Metadata'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
