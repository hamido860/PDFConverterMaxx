import React, { useState, useEffect } from 'react';
import { Search, CheckCircle, XCircle, Download, FileText, Filter, AlertCircle, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { createClient } from '@supabase/supabase-js';

interface ScrapedPdf {
  id: string;
  source_url: string;
  pdf_url: string;
  filename: string;
  detected_title: string | null;
  grade_name: string | null;
  subject_name: string | null;
  topic_title: string | null;
  language: string | null;
  status: 'discovered' | 'approved' | 'rejected' | 'downloaded' | 'queued';
  created_at: string;
}

export function PdfScraperAdmin({ supabaseUrl, supabaseKey }: { supabaseUrl: string; supabaseKey: string }) {
  const [sourceUrl, setSourceUrl] = useState('');
  const [isScraping, setIsScraping] = useState(false);
  const [pdfs, setPdfs] = useState<ScrapedPdf[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [gradeFilter, setGradeFilter] = useState<string>('all');

  const supabase = createClient(supabaseUrl, supabaseKey);

  const fetchPdfs = async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('scraped_pdf_candidates')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setPdfs(data as ScrapedPdf[]);
    } catch (err: any) {
      console.error('Failed to fetch scraped PDFs:', err);
      // Fallback to empty array if table doesn't exist yet
      setPdfs([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (supabaseUrl && supabaseKey) {
      fetchPdfs();
    }
  }, [supabaseUrl, supabaseKey]);

  const handleScrape = async () => {
    if (!sourceUrl) return;
    setIsScraping(true);
    setError(null);
    try {
      const res = await fetch('/api/scrape-pdfs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: sourceUrl })
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt);
      }
      await fetchPdfs();
      setSourceUrl('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsScraping(false);
    }
  };

  const updateStatus = async (id: string, status: ScrapedPdf['status']) => {
    try {
      const { error } = await supabase
        .from('scraped_pdf_candidates')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
      
      setPdfs(prev => prev.map(p => p.id === id ? { ...p, status } : p));
      
      // If approved, trigger download via backend
      if (status === 'approved') {
        const pdf = pdfs.find(p => p.id === id);
        if (pdf) {
          await fetch('/api/download-scraped-pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, url: pdf.pdf_url, filename: pdf.filename })
          });
          // Refresh after download
          fetchPdfs();
        }
      }
    } catch (err: any) {
      console.error('Failed to update status:', err);
    }
  };

  const filteredPdfs = pdfs.filter(p => {
    if (statusFilter !== 'all' && p.status !== statusFilter) return false;
    if (gradeFilter !== 'all' && p.grade_name !== gradeFilter) return false;
    return true;
  });

  const uniqueGrades = Array.from(new Set(pdfs.map(p => p.grade_name).filter(Boolean))) as string[];

  return (
    <div className="max-w-[1200px] mx-auto space-y-8 pb-12">
      <header>
        <h1 className="text-3xl font-light mb-2">Upload & Scraper</h1>
        <p className="text-white/40 text-sm">Discover PDFs from external URLs or review uploaded files.</p>
      </header>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-2xl flex items-start gap-3 text-sm">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* Scraper Input */}
      <div className="bg-white/5 border border-[var(--glass-border)] rounded-2xl p-6">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <Search className="w-4 h-4 text-[var(--color-accent)]" />
          Web Scraper
        </h3>
        <div className="flex gap-4">
          <input
            type="url"
            value={sourceUrl}
            onChange={e => setSourceUrl(e.target.value)}
            placeholder="https://example.com/curriculum/physics"
            className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:border-[var(--color-accent)]/50 focus:outline-none transition-all"
            onKeyDown={e => e.key === 'Enter' && handleScrape()}
          />
          <button
            onClick={handleScrape}
            disabled={isScraping || !sourceUrl}
            className="px-6 py-3 bg-[var(--color-accent)] text-black rounded-xl font-bold text-xs uppercase tracking-wider disabled:opacity-50 hover:shadow-[0_0_15px_var(--color-accent-dim)] transition-all flex items-center gap-2"
          >
            {isScraping ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Scan URL
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-4 items-center p-4 bg-white/[0.02] border border-white/5 rounded-2xl">
        <Filter className="w-4 h-4 text-white/40" />
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs focus:border-[var(--color-accent)]/50 focus:outline-none text-white/70"
        >
          <option value="all">All Statuses</option>
          <option value="discovered">Discovered</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="downloaded">Downloaded</option>
          <option value="queued">Queued for Extraction</option>
        </select>
        <select
          value={gradeFilter}
          onChange={e => setGradeFilter(e.target.value)}
          className="bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs focus:border-[var(--color-accent)]/50 focus:outline-none text-white/70"
        >
          <option value="all">All Grades</option>
          {uniqueGrades.map(g => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
      </div>

      {/* Results Table */}
      <div className="bg-white/5 border border-[var(--glass-border)] rounded-2xl overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-white/40">Loading PDF candidates...</div>
        ) : filteredPdfs.length === 0 ? (
          <div className="p-12 text-center text-white/40">No PDFs found matching your criteria.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-white/5 bg-white/[0.02] text-[10px] uppercase tracking-wider text-white/40">
                  <th className="p-4 font-medium">Filename</th>
                  <th className="p-4 font-medium">Subject / Grade</th>
                  <th className="p-4 font-medium">Source</th>
                  <th className="p-4 font-medium">Status</th>
                  <th className="p-4 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="text-sm divide-y divide-white/5">
                <AnimatePresence>
                  {filteredPdfs.map((pdf) => (
                    <motion.tr 
                      key={pdf.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <FileText className="w-4 h-4 text-white/40 shrink-0" />
                          <div>
                            <p className="font-medium truncate max-w-[200px]" title={pdf.filename}>{pdf.filename}</p>
                            <p className="text-xs text-white/30 truncate max-w-[200px]">{pdf.detected_title || 'Unknown Title'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        <p className="truncate max-w-[150px]">{pdf.subject_name || '-'}</p>
                        <p className="text-xs text-white/30 truncate max-w-[150px]">{pdf.grade_name || '-'}</p>
                      </td>
                      <td className="p-4 text-xs text-white/40">
                        <a href={pdf.source_url} target="_blank" rel="noreferrer" className="hover:text-white underline truncate inline-block max-w-[120px]" title={pdf.source_url}>
                          Source
                        </a>
                      </td>
                      <td className="p-4">
                        <span className={`px-2.5 py-1 rounded-full text-[10px] uppercase font-bold tracking-wider border ${
                          pdf.status === 'discovered' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' :
                          pdf.status === 'approved' ? 'bg-green-500/10 text-green-400 border-green-500/20' :
                          pdf.status === 'downloaded' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
                          pdf.status === 'queued' ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' :
                          'bg-red-500/10 text-red-400 border-red-500/20'
                        }`}>
                          {pdf.status}
                        </span>
                      </td>
                      <td className="p-4">
                        {pdf.status === 'discovered' && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => updateStatus(pdf.id, 'approved')}
                              className="p-1.5 bg-green-500/10 text-green-400 hover:bg-green-500/20 rounded-md transition-colors"
                              title="Approve & Download"
                            >
                              <CheckCircle className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => updateStatus(pdf.id, 'rejected')}
                              className="p-1.5 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-md transition-colors"
                              title="Reject"
                            >
                              <XCircle className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
