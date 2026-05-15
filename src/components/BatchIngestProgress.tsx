import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Activity, CheckCircle2 } from 'lucide-react';

interface BatchStatus {
  total: number;
  done: number;
  error: number;
  pending: number;
}

export function BatchIngestProgress() {
  const [status, setStatus] = useState<BatchStatus | null>(null);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/batch-status');
        if (res.ok) {
          const data = await res.json();
          setStatus(data);
        }
      } catch (err) {
        console.error('Failed to fetch batch status', err);
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  if (!status || status.total === 0) return null;

  const percent = status.total > 0 ? Math.round((status.done / status.total) * 100) : 0;
  const isComplete = status.pending === 0;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="fixed bottom-6 right-6 w-80 bg-slate-900 border border-slate-700/50 rounded-2xl shadow-2xl overflow-hidden z-[9999] backdrop-blur-xl"
    >
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            {isComplete ? (
              <><CheckCircle2 className="w-4 h-4 text-emerald-400" /> Ingestion Complete</>
            ) : (
              <><Activity className="w-4 h-4 text-blue-400 animate-pulse" /> Batch Processing</>
            )}
          </h3>
          <span className="text-xs font-mono text-slate-400">{percent}%</span>
        </div>
        
        <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden mb-4">
          <motion.div 
            className="h-full bg-gradient-to-r from-blue-500 to-indigo-500"
            initial={{ width: 0 }}
            animate={{ width: `${percent}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>

        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="bg-slate-800/50 rounded-lg p-2 border border-slate-700/30">
            <div className="text-emerald-400 font-bold flex items-center justify-center gap-1">
              {status.done}
            </div>
            <div className="text-slate-500 mt-0.5">Done</div>
          </div>
          <div className="bg-slate-800/50 rounded-lg p-2 border border-slate-700/30">
            <div className="text-blue-400 font-bold flex items-center justify-center gap-1">
              {status.pending}
            </div>
            <div className="text-slate-500 mt-0.5">Pending</div>
          </div>
          <div className="bg-slate-800/50 rounded-lg p-2 border border-slate-700/30">
            <div className="text-red-400 font-bold flex items-center justify-center gap-1">
              {status.error}
            </div>
            <div className="text-slate-500 mt-0.5">Errors</div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
