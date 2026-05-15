import React, { useEffect, useState } from 'react';
import { Activity, AlertCircle, CheckCircle2, Database, Link, RefreshCw, ServerCrash, ShieldCheck } from 'lucide-react';
import { getSupabase } from '../utils/supabaseClient';

export function RagHealthCheck() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const supabase = await getSupabase();
      
      const { count: totalChunks } = await supabase.from('rag_chunks').select('*', { count: 'exact', head: true });
      const { count: chunksWithContent } = await supabase.from('rag_chunks').select('*', { count: 'exact', head: true }).not('content', 'is', null).neq('content', '');
      const { count: chunksWithEmbeddings } = await supabase.from('rag_chunks').select('*', { count: 'exact', head: true }).not('embedding', 'is', null);
      
      const { count: statusDone } = await supabase.from('rag_chunks').select('*', { count: 'exact', head: true }).eq('embedding_status', 'done');
      const { count: statusPending } = await supabase.from('rag_chunks').select('*', { count: 'exact', head: true }).eq('embedding_status', 'pending');
      const { count: statusFailed } = await supabase.from('rag_chunks').select('*', { count: 'exact', head: true }).eq('embedding_status', 'failed');
      
      const { count: missingDocId } = await supabase.from('rag_chunks').select('*', { count: 'exact', head: true }).is('document_id', null);

      const { data: lastTest } = await supabase.from('rag_retrieval_tests').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle();

      setStats({
        totalChunks: totalChunks || 0,
        chunksWithContent: chunksWithContent || 0,
        chunksWithEmbeddings: chunksWithEmbeddings || 0,
        statusDone: statusDone || 0,
        statusPending: statusPending || 0,
        statusFailed: statusFailed || 0,
        missingDocId: missingDocId || 0,
        lastTest,
      });
    } catch (err: any) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  return (
    <div className="max-w-[1200px] mx-auto space-y-8 animate-in fade-in duration-500">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-light mb-2 flex items-center gap-3">
            <Activity className="w-8 h-8 text-[var(--color-accent)]" />
            RAG Integrity Health
          </h1>
          <p className="text-white/40 text-sm">Monitor embeddings, data relationships, and system search capabilities.</p>
        </div>
        <button
          onClick={fetchStats}
          disabled={loading}
          className="flex items-center gap-2 px-6 py-3 bg-white/5 border border-white/10 hover:border-white/30 rounded-xl text-xs font-bold uppercase tracking-widest transition-all disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh Stats
        </button>
      </header>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-4 rounded-xl flex items-center gap-3">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white/5 border border-white/10 rounded-3xl p-6 relative overflow-hidden group">
            <Database className="absolute -bottom-4 -right-4 w-24 h-24 text-white/5 group-hover:text-white/10 transition-colors" />
            <p className="text-[10px] text-white/40 uppercase tracking-widest font-bold mb-4">Total Chunks</p>
            <p className="text-5xl font-light text-white">{stats.totalChunks}</p>
            <div className="mt-4 flex gap-4 text-[10px] text-white/40 font-mono">
              <span>{stats.chunksWithContent} With Content</span>
            </div>
          </div>

          <div className="bg-white/5 border border-white/10 rounded-3xl p-6 relative overflow-hidden group">
            <ShieldCheck className="absolute -bottom-4 -right-4 w-24 h-24 text-emerald-500/5 group-hover:text-emerald-500/10 transition-colors" />
            <p className="text-[10px] text-emerald-400 uppercase tracking-widest font-bold mb-4">Vectors Embedded</p>
            <p className="text-5xl font-light text-emerald-400">{stats.chunksWithEmbeddings}</p>
            <div className="mt-4 flex gap-4 text-[10px] font-mono">
              <span className="text-emerald-500/80">{stats.statusDone} Done</span>
              <span className="text-amber-500/80">{stats.statusPending} Pending</span>
            </div>
          </div>

          <div className={`bg-white/5 border rounded-3xl p-6 relative overflow-hidden group ${stats.missingDocId > 0 ? 'border-amber-500/30' : 'border-white/10'}`}>
            <Link className={`absolute -bottom-4 -right-4 w-24 h-24 transition-colors ${stats.missingDocId > 0 ? 'text-amber-500/5 group-hover:text-amber-500/10' : 'text-white/5 group-hover:text-white/10'}`} />
            <p className={`text-[10px] uppercase tracking-widest font-bold mb-4 ${stats.missingDocId > 0 ? 'text-amber-400' : 'text-white/40'}`}>Missing Documents</p>
            <p className={`text-5xl font-light ${stats.missingDocId > 0 ? 'text-amber-400' : 'text-white'}`}>{stats.missingDocId}</p>
            <div className={`mt-4 flex gap-4 text-[10px] font-mono ${stats.missingDocId > 0 ? 'text-amber-500/80' : 'text-white/40'}`}>
              <span>Orphaned Chunks (Needs Repair)</span>
            </div>
          </div>

          <div className={`bg-white/5 border rounded-3xl p-6 relative overflow-hidden group ${stats.statusFailed > 0 ? 'border-red-500/30' : 'border-white/10'}`}>
            <ServerCrash className={`absolute -bottom-4 -right-4 w-24 h-24 transition-colors ${stats.statusFailed > 0 ? 'text-red-500/5 group-hover:text-red-500/10' : 'text-white/5 group-hover:text-white/10'}`} />
            <p className={`text-[10px] uppercase tracking-widest font-bold mb-4 ${stats.statusFailed > 0 ? 'text-red-400' : 'text-white/40'}`}>Failed Embeddings</p>
            <p className={`text-5xl font-light ${stats.statusFailed > 0 ? 'text-red-400' : 'text-white'}`}>{stats.statusFailed}</p>
            <div className={`mt-4 flex gap-4 text-[10px] font-mono ${stats.statusFailed > 0 ? 'text-red-500/80' : 'text-white/40'}`}>
              <span>Generation Failed</span>
            </div>
          </div>
        </div>
      )}

      {stats && (
        <div className="bg-white/5 border border-white/10 rounded-3xl p-8">
          <h3 className="text-xl font-light mb-6 flex items-center gap-3">
            <Search className="w-5 h-5 text-purple-400" />
            Last Retrieval Test
          </h3>
          
          {stats.lastTest ? (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4 p-4 bg-black/40 rounded-xl border border-white/5">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-1">Query Executed</p>
                  <p className="text-sm font-mono text-white/80">{stats.lastTest.query_text}</p>
                </div>
                <div className="shrink-0">
                  <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${stats.lastTest.passed ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'}`}>
                    {stats.lastTest.passed ? 'Passed' : 'Failed'}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-white/[0.02] rounded-xl border border-white/5">
                  <p className="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-2">Chunks Retrieved</p>
                  <p className="text-2xl font-light">{stats.lastTest.retrieved_chunk_ids?.length || 0}</p>
                </div>
                <div className="p-4 bg-white/[0.02] rounded-xl border border-white/5">
                  <p className="text-[10px] uppercase tracking-widest text-white/40 font-bold mb-2">Top Score</p>
                  <p className="text-2xl font-light text-purple-400">
                    {stats.lastTest.retrieved_scores?.length > 0 ? (stats.lastTest.retrieved_scores[0] * 100).toFixed(1) + '%' : 'N/A'}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="py-12 text-center border border-dashed border-white/10 rounded-2xl bg-white/[0.02]">
              <Search className="w-8 h-8 text-white/20 mx-auto mb-3" />
              <p className="text-white/40">No retrieval tests have been recorded yet.</p>
              <p className="text-xs text-white/30 mt-1">Run a test from the Chunk Review panel to check vector similarity logic.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
