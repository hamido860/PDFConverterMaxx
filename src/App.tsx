import React, { useState, useRef, useEffect } from 'react';
import { PDFDocument } from 'pdf-lib';
import { 
  Upload, File, Trash2, Download, AlertCircle, FilePlus, 
  ArrowUp, ArrowDown, Sparkles, FileJson, Database, 
  FileCode, BrainCircuit, LayoutDashboard, Settings, 
  Menu, Info, Layers, AppWindow, Eye, X, Activity, ListTodo, Search,
  Map as MapIcon, Lightbulb, CheckCircle2, Circle, Copy, PieChart, CheckSquare,
  ListChecks, GraduationCap, ChevronRight, Lock
} from 'lucide-react';
import { GoogleGenAI, Type } from '@google/genai';
import * as pdfjsLib from 'pdfjs-dist';
import { motion, AnimatePresence } from 'motion/react';
import { ChromaClient } from 'chromadb';
import { createClient } from '@supabase/supabase-js';

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

const MAX_FILE_SIZE_MB = 60;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

const SCHEMA_TABLES = [
  'bac_exams', 'bac_sections', 'bac_tracks', 'curricula', 'cycles', 'grades', 
  'subjects', 'topics', 'lessons', 'exercises', 'skills', 'rag_chunks', 
  'rag_documents', 'rag_chunk_versions', 'rag_embeddings', 'rag_extraction_jobs', 'rag_retrieval_tests',
  'profiles', 'quizzes', 'user_lessons', 'modules', 'tasks'
];

const RAG_OPTIONAL_TABLES = new Set([
  'rag_documents',
  'rag_chunk_versions',
  'rag_embeddings',
  'rag_extraction_jobs',
  'rag_retrieval_tests',
]);

function isMissingSupabaseTableError(error: any) {
  return Boolean(
    error &&
    (error.status === 404 ||
      error.code === 'PGRST205' ||
      String(error.message || '').toLowerCase().includes('could not find the table') ||
      String(error.message || '').toLowerCase().includes('schema cache'))
  );
}

interface PdfFile {
  id: string;
  file: File;
  name: string;
  size: number;
}

import { TaskCenter } from './components/TaskCenter';
import { RagRepairAdmin } from './components/RagRepairAdmin';

type MainTab = 'dashboard' | 'processing' | 'settings' | 'database' | 'taskcenter' | 'chunkreview' | 'extractionjobs';

const routeToMainTab = (pathname: string): MainTab | null => {
  if (pathname === '/admin/chunk-review') return 'chunkreview';
  if (pathname === '/admin/extraction-jobs') return 'extractionjobs';
  return null;
};

const mainTabToPath = (tab: MainTab): string => {
  if (tab === 'chunkreview') return '/admin/chunk-review';
  if (tab === 'extractionjobs') return '/admin/extraction-jobs';
  return '/';
};

export default function App() {
  const [files, setFiles] = useState<PdfFile[]>([]);
  const [isCombining, setIsCombining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiStatus, setApiStatus] = useState<{type: 'success'|'error', msg: string} | null>(null);
  const [activeMainTab, setActiveMainTab] = useState<MainTab>(() => {
    if (typeof window !== 'undefined') {
      return routeToMainTab(window.location.pathname) ?? 'dashboard';
    }
    return 'dashboard';
  });
  const [isSupabaseEnabled, setIsSupabaseEnabled] = useState(() => {
    const stored = localStorage.getItem('supabaseEnabled');
    if (stored !== null) return stored === 'true';
    return !!(process.env.SUPABASE_URL && process.env.SUPABASE_KEY);
  });
  const [supabaseUrl, setSupabaseUrl] = useState(() => localStorage.getItem('supabaseUrl') || process.env.SUPABASE_URL || '');
  const [supabaseKey, setSupabaseKey] = useState(() => localStorage.getItem('supabaseKey') || process.env.SUPABASE_KEY || '');
  const [isTestingSupabase, setIsTestingSupabase] = useState(false);
  const [dataHealth, setDataHealth] = useState<any>(null);
  const [activeTask, setActiveTask] = useState<any>(null);
  const [dbParams, setDbParams] = useState<{
    subjects: string[],
    sections: string[],
    tracks: string[],
    grades: string[]
  } | null>(null);
  const [isFetchingParams, setIsFetchingParams] = useState(false);
  const [isScanning, setIsScanning] = useState(false);

  // Monitor Dashboard State
  const [activeMonitorTab, setActiveMonitorTab] = useState<'overview' | 'queue' | 'explorer' | 'planner'>('overview');
  const [supabaseExplorerData, setSupabaseExplorerData] = useState<any[]>([]);
  const [explorerTable, setExplorerTable] = useState('rag_chunks');
  const [isFetchingExplorerData, setIsFetchingExplorerData] = useState(false);
  const [missingSchemaTables, setMissingSchemaTables] = useState<string[]>([]);

  // Curriculum Planner State
  const [plannerHierarchies, setPlannerHierarchies] = useState<any[]>([]);
  const [selectedPlannerGrade, setSelectedPlannerGrade] = useState<string>('');
  const [plannerTasks, setPlannerTasks] = useState<any[] | null>(null);
  const [isFetchingPlannerTasks, setIsFetchingPlannerTasks] = useState(false);

  // AutoPilot / Dogwasher State
  const [isAutoPiloting, setIsAutoPiloting] = useState(false);
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [gapAnalysis, setGapAnalysis] = useState<{score: number, missing: {title: string, prompt: string, type: 'high'|'medium'|'low'}[]} | null>(null);
  const [pipelineLogs, setPipelineLogs] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Auto-Pipeline Automation State
  const [autoPipelineEnabled, setAutoPipelineEnabled] = useState(false);
  const [autoPipelineInterval, setAutoPipelineInterval] = useState(30); // seconds
  const [autoPipelineCountdown, setAutoPipelineCountdown] = useState(0);
  const [ingestStatus, setIngestStatus] = useState<{[filename: string]: 'queued' | 'processing' | 'done' | 'duplicate'}>({});
  const ingestStatusRef = useRef<{[filename: string]: string}>({});
  const autoPipelineRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isAutoPilotingRef = useRef(false);
  const newFilesQueueRef = useRef<{id: string; file: File; name: string; size: number}[]>([]);

  // Local & Generic AI State
  const [aiProvider, setAiProvider] = useState<'gemini' | 'local' | 'openrouter'>('openrouter');
  const [localEndpoint, setLocalEndpoint] = useState(
    () => localStorage.getItem('localEndpoint') || (process.env.OLLAMA_URL ? `${process.env.OLLAMA_URL}/api/generate` : 'http://localhost:11434/api/generate')
  );
  const [localModel, setLocalModel] = useState(
    () => localStorage.getItem('localModel') || process.env.OLLAMA_MODEL || 'qwen2.5:3b'
  );
  // OpenRouter credentials: prefer localStorage (user-edited), else fall back to .env
  // (wired in vite.config.ts via `define: { 'process.env.OPENROUTER_KEY': ... }`).
  const [openRouterKey, setOpenRouterKey] = useState(
    () => localStorage.getItem('openRouterKey') || process.env.OPENROUTER_KEY || ''
  );
  const [openRouterModel, setOpenRouterModel] = useState(
    () => localStorage.getItem('openRouterModel') || process.env.OPENROUTER_MODEL || 'qwen/qwen3-next-80b-a3b-instruct:free'
  );
  const [showAiConfig, setShowAiConfig] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const pipelineRef = useRef<() => void>(null as any);

  const navigateMainTab = (tab: MainTab) => {
    setActiveMainTab(tab);
    setIsSidebarOpen(false);
    if (typeof window !== 'undefined') {
      const nextPath = mainTabToPath(tab);
      if (window.location.pathname !== nextPath) {
        window.history.pushState({}, '', nextPath);
      }
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPopState = () => {
      const nextTab = routeToMainTab(window.location.pathname) ?? 'dashboard';
      setActiveMainTab(nextTab);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  useEffect(() => {
    localStorage.setItem('supabaseUrl', supabaseUrl);
    localStorage.setItem('supabaseKey', supabaseKey);
    localStorage.setItem('supabaseEnabled', String(isSupabaseEnabled));
    // Invalidate cached client whenever credentials change
    supabaseClientRef.current = null;
  }, [supabaseUrl, supabaseKey, isSupabaseEnabled]);

  // Persist OpenRouter creds so the user doesn't have to re-enter them every reload
  useEffect(() => {
    localStorage.setItem('openRouterKey', openRouterKey);
    localStorage.setItem('openRouterModel', openRouterModel);
  }, [openRouterKey, openRouterModel]);

  // â”€â”€ Shared Supabase client (lazy, cached per credential pair) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const supabaseClientRef = useRef<any>(null);
  const getSupabase = () => {
    if (!supabaseUrl || !supabaseKey) throw new Error('Supabase credentials are not configured. Please set them in the Config tab.');
    if (!supabaseClientRef.current) {
      supabaseClientRef.current = createClient(supabaseUrl, supabaseKey);
    }
    return supabaseClientRef.current;
  };

  // Auto-fetch explorer data when tab becomes active
  useEffect(() => {
    if (activeMainTab === 'database' && activeMonitorTab === 'explorer' && supabaseExplorerData.length === 0 && !isFetchingExplorerData) {
      if (isSupabaseEnabled && supabaseUrl && supabaseKey) {
        fetchExplorerData();
      }
    }
  }, [activeMonitorTab, activeMainTab, isSupabaseEnabled]);

  // Keep isAutoPilotingRef in sync with state for use inside intervals
  useEffect(() => {
    isAutoPilotingRef.current = isAutoPiloting;
  }, [isAutoPiloting]);

  // Keep ingestStatusRef in sync with state (so interval can read it without being a dep)
  useEffect(() => {
    ingestStatusRef.current = ingestStatus;
  }, [ingestStatus]);



  // Auto-Pipeline Timer
  useEffect(() => {
    if (autoPipelineRef.current) clearInterval(autoPipelineRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);

    if (!autoPipelineEnabled) {
      setAutoPipelineCountdown(0);
      return;
    }

    setAutoPipelineCountdown(autoPipelineInterval);

    countdownRef.current = setInterval(() => {
      setAutoPipelineCountdown(prev => (prev <= 1 ? autoPipelineInterval : prev - 1));
    }, 1000);

    autoPipelineRef.current = setInterval(async () => {
      if (isAutoPilotingRef.current) return;
      if (pipelineRef.current) pipelineRef.current();
    }, autoPipelineInterval * 1000);

    return () => {
      if (autoPipelineRef.current) clearInterval(autoPipelineRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [autoPipelineEnabled, autoPipelineInterval]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    if (e.target.files) {
      const validFiles: PdfFile[] = [];
      let hasOversizedFiles = false;

      (Array.from(e.target.files) as File[]).forEach((file) => {
        if (file.type !== 'application/pdf') {
          setError('Only PDF files are allowed.');
          return;
        }
        if (file.size > MAX_FILE_SIZE_BYTES) {
          hasOversizedFiles = true;
        } else {
          validFiles.push({
            id: Math.random().toString(36).substring(7),
            file,
            name: file.name,
            size: file.size,
          });
        }
      });

      if (hasOversizedFiles) {
        setError(`Some files were skipped because they exceed the ${MAX_FILE_SIZE_MB}MB limit.`);
      }

      setFiles((prev) => [...prev, ...validFiles]);
    }
    
    // Reset file input so the same file can be selected again if needed
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const runVectorMaintenance = async () => {
    if (!supabaseUrl || !supabaseKey) return;
    setIsAutoPiloting(true);
    setPipelineLogs(["âš¡ Starting Knowledge Sync: Fragment & Embed Existing Knowledge..."]);
    
    try {
      const supabase = getSupabase();
      
      let ai: any = null;
      if (aiProvider === 'gemini' && process.env.GEMINI_API_KEY) {
        ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      } else {
        throw new Error("Vector generation requires Cloud AI (Gemini) with a valid API key.");
      }

      // 1. Fetch orphaned nodes (nodes with null embeddings)
      const { data: nodes, error: fetchErr } = await supabase
        .from('rag_chunks')
        .select('*')
        .is('embedding', null)
        .limit(100);

      if (fetchErr) throw fetchErr;
      if (!nodes || nodes.length === 0) {
        setPipelineLogs(prev => [...prev, "âœ… No orphaned knowledge nodes found. Monitoring stable."]);
        return;
      }

      setPipelineLogs(prev => [...prev, `ðŸ” Found ${nodes.length} nodes requiring vector synthesis. Starting batch...`]);

      for (const node of nodes) {
        try {
          setPipelineLogs(prev => [...prev, `â³ Synthesizing vector for node ${node.id.substring(0,8)}...`]);

          const result = await ai.models.embedContent({
            model: 'gemini-embedding-exp-03-07',
            contents: [{ parts: [{ text: node.content }] }],
            config: { taskType: 'RETRIEVAL_DOCUMENT', outputDimensionality: 1000 } as any
          });
          const vector = result.embeddings?.[0]?.values;

          const { error: updateErr } = await supabase
            .from('rag_chunks')
            .update({ embedding: vector })
            .eq('id', node.id);

          if (updateErr) throw updateErr;
          setPipelineLogs(prev => [...prev, `âœ… Node ${node.id.substring(0,8)} now indexed semantically.`]);
        } catch (nodeErr: any) {
          setPipelineLogs(prev => [...prev, `âš ï¸ Failed node ${node.id.substring(0,8)}: ${nodeErr.message}`]);
        }
      }

      setPipelineLogs(prev => [...prev, "ðŸŽ‰ Knowledge Sync complete. Running final integrity scan..."]);
      runDatabaseMonitor();
      setActiveTask(null);
    } catch (err: any) {
      setPipelineLogs(prev => [...prev, `ðŸ“› MAINTENANCE FAILED: ${err.message}`]);
    } finally {
      setIsAutoPiloting(false);
    }
  };

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const moveFile = (index: number, direction: 'up' | 'down') => {
    if (
      (direction === 'up' && index === 0) ||
      (direction === 'down' && index === files.length - 1)
    ) {
      return;
    }

    const newFiles = [...files];
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    const temp = newFiles[index];
    newFiles[index] = newFiles[newIndex];
    newFiles[newIndex] = temp;
    setFiles(newFiles);
  };

  const MD5_MIN_CHUNK = 100; // discard micro-chunks (page numbers, whitespace)

  // â”€â”€ FIX #4: Real MD5 for browser â€” matches server-side rag-ingest.ts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Replaces the old FNV-1a 8-char hash so dedup works cross-pipeline.
  const md5Browser = (str: string): string => {
    // MD5 implementation (RFC 1321) â€” same output as Node crypto.createHash('md5')
    function safeAdd(x: number, y: number) { const lsw = (x & 0xffff) + (y & 0xffff); return (((x >> 16) + (y >> 16) + (lsw >> 16)) << 16) | (lsw & 0xffff); }
    function bitRotateLeft(num: number, cnt: number) { return (num << cnt) | (num >>> (32 - cnt)); }
    function md5cmn(q: number, a: number, b: number, x: number, s: number, t: number) { return safeAdd(bitRotateLeft(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b); }
    function md5ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return md5cmn((b & c) | (~b & d), a, b, x, s, t); }
    function md5gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return md5cmn((b & d) | (c & ~d), a, b, x, s, t); }
    function md5hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return md5cmn(b ^ c ^ d, a, b, x, s, t); }
    function md5ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return md5cmn(c ^ (b | ~d), a, b, x, s, t); }
    function md5blks(s: string) {
      const nblk = ((s.length + 8) >> 6) + 1; const blks = new Array(nblk * 16).fill(0);
      for (let i = 0; i < s.length; i++) blks[i >> 2] |= s.charCodeAt(i) << ((i % 4) * 8);
      blks[s.length >> 2] |= 0x80 << ((s.length % 4) * 8);
      blks[nblk * 16 - 2] = s.length * 8; return blks;
    }
    const x = md5blks(str);
    let [a, b, c, d] = [1732584193, -271733879, -1732584194, 271733878];
    for (let i = 0; i < x.length; i += 16) {
      const [oa, ob, oc, od] = [a, b, c, d];
      a=md5ff(a,b,c,d,x[i+0],7,-680876936);d=md5ff(d,a,b,c,x[i+1],12,-389564586);c=md5ff(c,d,a,b,x[i+2],17,606105819);b=md5ff(b,c,d,a,x[i+3],22,-1044525330);
      a=md5ff(a,b,c,d,x[i+4],7,-176418897);d=md5ff(d,a,b,c,x[i+5],12,1200080426);c=md5ff(c,d,a,b,x[i+6],17,-1473231341);b=md5ff(b,c,d,a,x[i+7],22,-45705983);
      a=md5ff(a,b,c,d,x[i+8],7,1770035416);d=md5ff(d,a,b,c,x[i+9],12,-1958414417);c=md5ff(c,d,a,b,x[i+10],17,-42063);b=md5ff(b,c,d,a,x[i+11],22,-1990404162);
      a=md5ff(a,b,c,d,x[i+12],7,1804603682);d=md5ff(d,a,b,c,x[i+13],12,-40341101);c=md5ff(c,d,a,b,x[i+14],17,-1502002290);b=md5ff(b,c,d,a,x[i+15],22,1236535329);
      a=md5gg(a,b,c,d,x[i+1],5,-165796510);d=md5gg(d,a,b,c,x[i+6],9,-1069501632);c=md5gg(c,d,a,b,x[i+11],14,643717713);b=md5gg(b,c,d,a,x[i+0],20,-373897302);
      a=md5gg(a,b,c,d,x[i+5],5,-701558691);d=md5gg(d,a,b,c,x[i+10],9,38016083);c=md5gg(c,d,a,b,x[i+15],14,-660478335);b=md5gg(b,c,d,a,x[i+4],20,-405537848);
      a=md5gg(a,b,c,d,x[i+9],5,568446438);d=md5gg(d,a,b,c,x[i+14],9,-1019803690);c=md5gg(c,d,a,b,x[i+3],14,-187363961);b=md5gg(b,c,d,a,x[i+8],20,1163531501);
      a=md5gg(a,b,c,d,x[i+13],5,-1444681467);d=md5gg(d,a,b,c,x[i+2],9,-51403784);c=md5gg(c,d,a,b,x[i+7],14,1735328473);b=md5gg(b,c,d,a,x[i+12],20,-1926607734);
      a=md5hh(a,b,c,d,x[i+5],4,-378558);d=md5hh(d,a,b,c,x[i+8],11,-2022574463);c=md5hh(c,d,a,b,x[i+11],16,1839030562);b=md5hh(b,c,d,a,x[i+14],23,-35309556);
      a=md5hh(a,b,c,d,x[i+1],4,-1530992060);d=md5hh(d,a,b,c,x[i+4],11,1272893353);c=md5hh(c,d,a,b,x[i+7],16,-155497632);b=md5hh(b,c,d,a,x[i+10],23,-1094730640);
      a=md5hh(a,b,c,d,x[i+13],4,681279174);d=md5hh(d,a,b,c,x[i+0],11,-358537222);c=md5hh(c,d,a,b,x[i+3],16,-722521979);b=md5hh(b,c,d,a,x[i+6],23,76029189);
      a=md5hh(a,b,c,d,x[i+9],4,-640364487);d=md5hh(d,a,b,c,x[i+12],11,-421815835);c=md5hh(c,d,a,b,x[i+15],16,530742520);b=md5hh(b,c,d,a,x[i+2],23,-995338651);
      a=md5ii(a,b,c,d,x[i+0],6,-198630844);d=md5ii(d,a,b,c,x[i+7],10,1126891415);c=md5ii(c,d,a,b,x[i+14],15,-1416354905);b=md5ii(b,c,d,a,x[i+5],21,-57434055);
      a=md5ii(a,b,c,d,x[i+12],6,1700485571);d=md5ii(d,a,b,c,x[i+3],10,-1894986606);c=md5ii(c,d,a,b,x[i+10],15,-1051523);b=md5ii(b,c,d,a,x[i+1],21,-2054922799);
      a=md5ii(a,b,c,d,x[i+8],6,1873313359);d=md5ii(d,a,b,c,x[i+15],10,-30611744);c=md5ii(c,d,a,b,x[i+6],15,-1560198380);b=md5ii(b,c,d,a,x[i+13],21,1309151649);
      a=md5ii(a,b,c,d,x[i+4],6,-145523070);d=md5ii(d,a,b,c,x[i+11],10,-1120210379);c=md5ii(c,d,a,b,x[i+2],15,718787259);b=md5ii(b,c,d,a,x[i+9],21,-343485551);
      a=safeAdd(a,oa);b=safeAdd(b,ob);c=safeAdd(c,oc);d=safeAdd(d,od);
    }
    return [a,b,c,d].map(n => (n < 0 ? n + 0x100000000 : n).toString(16).padStart(8,'0')).join('');
  };

  // â”€â”€ FIX #3: Normalize AI-returned grade/subject to exact DB names â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const GRADE_NORMALIZE: Record<string, string> = {
    '1 bac': '1Ã¨re annÃ©e Bac', '1bac': '1Ã¨re annÃ©e Bac', '1ere bac': '1Ã¨re annÃ©e Bac',
    '1Ã¨re bac': '1Ã¨re annÃ©e Bac', 'premiere bac': '1Ã¨re annÃ©e Bac', '1st bac': '1Ã¨re annÃ©e Bac',
    '2 bac': '2Ã¨me annÃ©e Bac', '2bac': '2Ã¨me annÃ©e Bac', '2eme bac': '2Ã¨me annÃ©e Bac',
    '2Ã¨me bac': '2Ã¨me annÃ©e Bac', 'deuxieme bac': '2Ã¨me annÃ©e Bac', '2nd bac': '2Ã¨me annÃ©e Bac',
    'tcs': 'Tronc Commun', 'tc': 'Tronc Commun', 'tronc commun': 'Tronc Commun',
  };
  const SUBJECT_NORMALIZE: Record<string, string> = {
    'math': 'MathÃ©matiques', 'maths': 'MathÃ©matiques', 'mathÃ©matiques': 'MathÃ©matiques', 'mathematiques': 'MathÃ©matiques',
    'svt': 'Sciences de la Vie et de la Terre (SVT)', 'sciences de la vie': 'Sciences de la Vie et de la Terre (SVT)', 'biologie': 'Sciences de la Vie et de la Terre (SVT)',
    'physique': 'Physique-Chimie', 'physique-chimie': 'Physique-Chimie', 'pc': 'Physique-Chimie', 'physics': 'Physique-Chimie',
    'franÃ§ais': 'Langue FranÃ§aise', 'francais': 'Langue FranÃ§aise', 'french': 'Langue FranÃ§aise', 'langue franÃ§aise': 'Langue FranÃ§aise', 'fr': 'Langue FranÃ§aise',
    'arabe': 'Ø§Ù„Ù„ØºØ© Ø§Ù„Ø¹Ø±Ø¨ÙŠØ©', 'arabic': 'Ø§Ù„Ù„ØºØ© Ø§Ù„Ø¹Ø±Ø¨ÙŠØ©', 'arab': 'Ø§Ù„Ù„ØºØ© Ø§Ù„Ø¹Ø±Ø¨ÙŠØ©',
    'anglais': 'English', 'english': 'English', 'ang': 'English',
    'islam': 'Ø§Ù„ØªØ±Ø¨ÙŠØ© Ø§Ù„Ø¥Ø³Ù„Ø§Ù…ÙŠØ©', 'islamique': 'Ø§Ù„ØªØ±Ø¨ÙŠØ© Ø§Ù„Ø¥Ø³Ù„Ø§Ù…ÙŠØ©', 'education islamique': 'Ø§Ù„ØªØ±Ø¨ÙŠØ© Ø§Ù„Ø¥Ø³Ù„Ø§Ù…ÙŠØ©',
    'histoire': 'Ø§Ù„Ø§Ø¬ØªÙ…Ø§Ø¹ÙŠØ§Øª', 'gÃ©ographie': 'Ø§Ù„Ø§Ø¬ØªÙ…Ø§Ø¹ÙŠØ§Øª', 'hist-geo': 'Ø§Ù„Ø§Ø¬ØªÙ…Ø§Ø¹ÙŠØ§Øª', 'histoire-gÃ©ographie': 'Ø§Ù„Ø§Ø¬ØªÙ…Ø§Ø¹ÙŠØ§Øª',
    'philosophie': 'Ø§Ù„ÙÙ„Ø³ÙØ©', 'philo': 'Ø§Ù„ÙÙ„Ø³ÙØ©',
    'informatique': "Sciences de l'IngÃ©nieur", 'si': "Sciences de l'IngÃ©nieur", 'sciences de l\'ingÃ©nieur': "Sciences de l'IngÃ©nieur",
    'Ã©conomie': 'Ã‰conomie GÃ©nÃ©rale et Statistique', 'eco': 'Ã‰conomie GÃ©nÃ©rale et Statistique',
    'comptabilitÃ©': 'ComptabilitÃ© et MathÃ©matiques FinanciÃ¨res', 'compta': 'ComptabilitÃ© et MathÃ©matiques FinanciÃ¨res',
    'eoae': 'Ã‰conomie et Organisation Administrative des Entreprises (EOAE)',
  };
  const normalizeClassification = (grade: string | null, subject: string | null) => {
    const g = grade?.toLowerCase().trim();
    const s = subject?.toLowerCase().trim();
    return {
      grade:   (g && GRADE_NORMALIZE[g])   || grade,
      subject: (s && SUBJECT_NORMALIZE[s]) || subject,
    };
  };

  const parseJsonObject = <T,>(rawResponse: string): T => {
    const cleaned = rawResponse.replace(/```json/g, '').replace(/```/g, '').trim();
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    const candidate = firstBrace >= 0 && lastBrace > firstBrace
      ? cleaned.slice(firstBrace, lastBrace + 1)
      : cleaned;
    return JSON.parse(candidate) as T;
  };

  const isAllowedChoice = (value: string | null, choices: string[]) => {
    if (!value) return false;
    if (choices.length === 0) return true;
    const normalized = value.toLowerCase().trim();
    return choices.some(choice => choice.toLowerCase().trim() === normalized);
  };

  const buildClassificationPrompt = (fileName: string, snippet: string, grades: string[], subjects: string[]) => `Analyze this Moroccan curriculum file.
Filename: "${fileName}"
Text snippet: "${snippet}"

Choose exactly one grade and one subject from the allowed lists below.
Allowed grades: [${grades.join(', ')}]
Allowed subjects: [${subjects.join(', ')}]

Rules:
- Prefer the filename when it clearly states the level or stream.
- Use the text snippet to break ties.
- Return null only if the value is truly absent from the allowed list.
- Output only valid JSON with this exact schema: {"grade":"allowed value or null","subject":"allowed value or null"}.`;

  const splitOversizedSegment = (segment: string, size: number, overlap: number) => {
    const pieces: string[] = [];
    let remaining = segment.trim();

    while (remaining.length > size) {
      const window = remaining.slice(0, size);
      const boundaryCandidates = [
        window.lastIndexOf('\n'),
        window.lastIndexOf('. '),
        window.lastIndexOf('! '),
        window.lastIndexOf('? '),
        window.lastIndexOf('; '),
        window.lastIndexOf(': '),
        window.lastIndexOf('ØŒ '),
        window.lastIndexOf(' ')
      ];
      const cutIndex = Math.max(...boundaryCandidates.filter(idx => idx >= Math.floor(size * 0.55)));
      const safeCut = cutIndex > 0 ? cutIndex + 1 : size;
      const piece = remaining.slice(0, safeCut).trim();

      if (piece.length >= MD5_MIN_CHUNK) {
        pieces.push(piece);
      }

      const resumeFrom = Math.max(0, safeCut - overlap);
      remaining = remaining.slice(resumeFrom).trim();
    }

    if (remaining.length >= MD5_MIN_CHUNK) {
      pieces.push(remaining);
    }

    return pieces;
  };

  // â”€â”€ FIX #1: Resolve source_id from grade+subject (matches a topic in the DB) â”€
  const resolveSourceId = async (grade: string | null, subject: string | null): Promise<string | null> => {
    if (!grade || !subject || !supabaseUrl || !supabaseKey) return null;
    try {
      const supabase = getSupabase();
      const [{ data: gradeRow }, { data: subjectRow }] = await Promise.all([
        supabase.from('grades').select('id').ilike('name', grade).maybeSingle(),
        supabase.from('subjects').select('id').ilike('name', subject).maybeSingle(),
      ]);
      if (!gradeRow || !subjectRow) return null;
      const { data: topic } = await supabase.from('topics').select('id')
        .eq('grade_id', gradeRow.id).eq('subject_id', subjectRow.id).limit(1).maybeSingle();
      return topic?.id ?? null;
    } catch { return null; }
  };

  const splitIntoChunks = (text: string, size: number = 1200, overlap: number = 200) => {
    const normalized = text
      .replace(/\r/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (!normalized) return [];

    const chunks: string[] = [];
    const paragraphs = normalized
      .split(/\n\s*\n+/)
      .map(part => part.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    const flushChunk = (value: string) => {
      const cleaned = value.trim();
      if (cleaned.length >= MD5_MIN_CHUNK) {
        chunks.push(cleaned);
      }
    };

    let current = '';

    const appendUnit = (unit: string) => {
      if (!unit) return;

      if (unit.length > size) {
        if (current) {
          flushChunk(current);
          current = '';
        }
        splitOversizedSegment(unit, size, overlap).forEach(piece => flushChunk(piece));
        return;
      }

      const candidate = current ? `${current}\n\n${unit}` : unit;
      if (candidate.length <= size) {
        current = candidate;
        return;
      }

      flushChunk(current);
      const tail = current.slice(Math.max(0, current.length - overlap)).trim();
      current = tail ? `${tail}\n\n${unit}` : unit;

      if (current.length > size) {
        splitOversizedSegment(current, size, overlap).forEach(piece => flushChunk(piece));
        current = '';
      }
    };

    for (const paragraph of paragraphs) {
      const sentences = paragraph
        .split(/(?<=[.!?;:])\s+|(?<=\u061f)\s+/)
        .map(sentence => sentence.trim())
        .filter(Boolean);

      if (sentences.length <= 1) {
        appendUnit(paragraph);
        continue;
      }

      let paragraphGroup = '';
      for (const sentence of sentences) {
        const candidate = paragraphGroup ? `${paragraphGroup} ${sentence}` : sentence;
        if (candidate.length <= size) {
          paragraphGroup = candidate;
        } else {
          appendUnit(paragraphGroup);
          paragraphGroup = sentence;
        }
      }
      appendUnit(paragraphGroup);
    }

    if (current) {
      flushChunk(current);
    }

    return chunks;
  };

  const runDogwasherPipeline = async () => {
    if (!supabaseUrl || !supabaseKey) {
      setApiStatus({ type: 'error', msg: 'Missing Supabase credentials in Transfer tab.' });
      setPipelineLogs(prev => [...prev, "❌ Aborted: Missing Supabase credentials. Check Config tab."]);
      return;
    }
    if (aiProvider === 'gemini' && !process.env.GEMINI_API_KEY) {
      setApiStatus({ type: 'error', msg: 'Missing Gemini API Key. Switch to Local AI or xAI.' });
      setPipelineLogs(prev => [...prev, "❌ Aborted: Missing Gemini API Key."]);
      return;
    }
    if (aiProvider === 'local' && !localEndpoint) {
      setApiStatus({ type: 'error', msg: 'Missing Local API Endpoint URL.' });
      setPipelineLogs(prev => [...prev, "❌ Aborted: Missing Local API Endpoint URL."]);
      return;
    }
    if (aiProvider === 'openrouter' && !openRouterKey) {
      setApiStatus({ type: 'error', msg: 'Missing OpenRouter API Key.' });
      setPipelineLogs(prev => [...prev, "❌ Aborted: Missing OpenRouter API Key."]);
      return;
    }

    const targetFiles = files.filter(f => ingestStatus[f.name] !== 'done');
    if (targetFiles.length === 0) {
      if (!autoPipelineEnabled) {
        setApiStatus({ type: 'error', msg: 'No pending files in queue.' });
        setPipelineLogs(prev => [...prev, "⚠️ No pending files to process (all queued files are marked 'done')."]);
      }
      return;
    }

    setIsAutoPiloting(true);
    setPipelineLogs(["🐕 Dogwasher is active... Starting pipeline."]);

    try {
      const supabase = getSupabase();
      let ai: any = null;
      if (aiProvider === 'gemini' && process.env.GEMINI_API_KEY) {
        ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      }

      const availableGrades = dbParams?.grades?.length ? dbParams.grades : ['1 BAC', '2 BAC', 'TCS'];
      const availableSubjects = dbParams?.subjects?.length ? dbParams.subjects : ['Math', 'Physics', 'Islamic Ed'];

      for (const pdfFile of targetFiles) {
        setPipelineLogs(prev => [...prev, `📁 Processing file: ${pdfFile.name}`]);

        let arrayBuffer: ArrayBuffer;
        try {
          arrayBuffer = await pdfFile.file.arrayBuffer();
        } catch (fileErr: any) {
          setPipelineLogs(prev => [...prev, `⚠️ Skipping "${pdfFile.name}": file no longer accessible on disk (${fileErr.message})`]);
          setIngestStatus(prev => ({ ...prev, [pdfFile.name]: 'done' }));
          continue;
        }

        let pdf: any;
        try {
          pdf = await pdfjsLib.getDocument({
            data: arrayBuffer,
            standardFontDataUrl: `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/standard_fonts/`
          }).promise;
        } catch (pdfErr: any) {
          setPipelineLogs(prev => [...prev, `⚠️ Skipping "${pdfFile.name}": ${pdfErr.message}`]);
          setIngestStatus(prev => ({ ...prev, [pdfFile.name]: 'done' }));
          continue;
        }

        let fileClassification: { grade: string | null; subject: string | null } = { grade: null, subject: null };
        let hasClassifiedFile = false;
        const deferredPages: Array<{ pageNumber: number; text: string }> = [];
        let cachedSourceId: string | null | undefined = undefined;
        let docChunkIndex = 0;

        const ingestPage = async (pageNumber: number, pageText: string, grade: string, subject: string) => {
          const chunks = splitIntoChunks(pageText);
          setPipelineLogs(prev => [...prev, `🧠 Page ${pageNumber} shattered into ${chunks.length} RAG nodes...`]);

          if (cachedSourceId === undefined) {
            cachedSourceId = await resolveSourceId(grade, subject);
          }

          for (let j = 0; j < chunks.length; j++) {
            const chunk = chunks[j];
            const chunkHash = md5Browser(chunk);

            const { data: existingChunk } = await supabase
              .from('rag_chunks')
              .select('id')
              .eq('content_hash', chunkHash)
              .maybeSingle();

            if (existingChunk) {
              setPipelineLogs(prev => [...prev, `↻ Page ${pageNumber} chunk ${j + 1} already indexed — skipping duplicate.`]);
              continue;
            }

            let vector = null;
            if (aiProvider === 'gemini' && ai) {
              try {
                await new Promise(resolve => setTimeout(resolve, 4000));
                const result = await ai.models.embedContent({
                  model: 'gemini-embedding-exp-03-07',
                  contents: [{ parts: [{ text: chunk }] }],
                  config: { taskType: 'RETRIEVAL_DOCUMENT', outputDimensionality: 768 } as any
                });
                vector = result.embeddings?.[0]?.values || null;
              } catch (e) {
                console.error('Embedding generation failed:', e);
              }
            }

            const thisChunkIndex = docChunkIndex++;
            const { error: ragError } = await supabase.from('rag_chunks').insert({
              content:          chunk,
              content_hash:     chunkHash,
              embedding:        vector,
              embedding_status: vector ? 'done' : 'pending',
              embedding_model:  vector ? 'gemini-embedding-exp-03-07' : null,
              is_processed:     !!vector,
              source_type:      'lesson_block',
              source_id:        cachedSourceId ?? null,
              chunk_index:      thisChunkIndex,
              chunk_size:       chunk.length,
              metadata: {
                filename:        pdfFile.name,
                pageNumber:      pageNumber,
                chunkIndex:      thisChunkIndex,
                pageChunkIndex:  j,
                grade:           grade,
                subject:         subject,
                autoClassified:  true,
                timestamp:       new Date().toISOString(),
                contentHash:     chunkHash,
                embeddingStatus: vector ? 'done' : 'pending',
                chunkSize:       chunk.length
              }
            });

            if (ragError && (ragError as any).code !== '23505') {
              const errMsg = ragError.message || JSON.stringify(ragError);
              console.error('RAG sync failed:', errMsg);
              setPipelineLogs(prev => [...prev, `❌ Supabase Insert Error: ${errMsg}`]);
            }
          }

          setPipelineLogs(prev => [...prev, `✅ Page ${pageNumber} knowledge nodes synchronized.`]);
          setTimeout(() => logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
        };

        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const rawText = textContent.items.map((item: any) => item.str).join(' ');
          const washedText = rawText.replace(/[\u0000\x00]/g, '').trim();

          if (washedText.length < 50) {
            setPipelineLogs(prev => [...prev, `⏩ Skipping page ${i} (too little content).`]);
            continue;
          }

          if (!hasClassifiedFile) {
            setPipelineLogs(prev => [...prev, `⏳ AI Classification starting based on page ${i}...`]);
            setTimeout(() => logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);

            const snippet = washedText.substring(0, 1000);
            const prompt = buildClassificationPrompt(pdfFile.name, snippet, availableGrades, availableSubjects);
            let aiSuccess = false;
            let retries = 0;
            const MAX_RETRIES = 3;

            while (!aiSuccess && retries < MAX_RETRIES) {
              try {
                if (aiProvider === 'gemini' && (i > 1 || retries > 0)) {
                  setPipelineLogs(prev => [...prev, `⏳ Respecting API rate limits, waiting a few seconds...`]);
                  await new Promise(resolve => setTimeout(resolve, 4500));
                }

                let rawResponse = '{}';

                if (aiProvider === 'local') {
                  const res = await fetch(localEndpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      model: localModel,
                      prompt,
                      stream: false,
                      format: 'json'
                    })
                  });

                  if (!res.ok) {
                    const errText = await res.text().catch(() => '');
                    throw new Error(`Local API error (${res.status}): ${res.statusText} - ${errText}`);
                  }
                  const data = await res.json();
                  rawResponse = data.response;
                } else if (aiProvider === 'openrouter') {
                  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${openRouterKey}`,
                      'HTTP-Referer': window.location.href,
                      'X-Title': 'PDF Combiner MAXX'
                    },
                    body: JSON.stringify({
                      model: openRouterModel,
                      messages: [
                        { role: 'system', content: 'You are a strict data extraction assistant. Output only valid JSON and only use values from the allowed grade and subject lists.' },
                        { role: 'user', content: prompt }
                      ],
                      stream: false,
                      temperature: 0.1
                    })
                  });

                  if (!res.ok) {
                    const errText = await res.text().catch(() => '');
                    throw new Error(`OpenRouter Error ${res.status}: ${res.statusText} ${errText}`);
                  }
                  const data = await res.json();
                  rawResponse = data.choices?.[0]?.message?.content || '{}';
                } else {
                  const response = await ai.models.generateContent({
                    model: 'gemini-2.0-flash',
                    contents: prompt,
                    config: { responseMimeType: 'application/json' }
                  });
                  rawResponse = response.text || '{}';
                }

                const parsed = parseJsonObject<{ grade: string | null; subject: string | null }>(rawResponse);
                const normalized = normalizeClassification(parsed?.grade ?? null, parsed?.subject ?? null);

                if (!isAllowedChoice(normalized.grade, availableGrades) || !isAllowedChoice(normalized.subject, availableSubjects)) {
                  throw new Error(`Classifier returned values outside the allowed lists: grade="${normalized.grade}" subject="${normalized.subject}"`);
                }

                fileClassification = normalized;
                hasClassifiedFile = true;
                aiSuccess = true;
              } catch (e: any) {
                const errMsg = e.message || String(e);
                if (aiProvider === 'gemini' && (errMsg.toLowerCase().includes('quota') || errMsg.toLowerCase().includes('429'))) {
                  retries++;
                  setPipelineLogs(prev => [...prev, `⚠️ Quota hit (attempt ${retries}/${MAX_RETRIES}). Backing off...`]);
                  await new Promise(resolve => setTimeout(resolve, 10000 * retries));
                } else if (aiProvider === 'local' && (errMsg.toLowerCase().includes('fetch') || errMsg.toLowerCase().includes('network'))) {
                  setPipelineLogs(prev => [...prev, `⚠️ Local API Disconnected: ${errMsg}. Ensure CORS is enabled.`]);
                  break;
                } else {
                  setPipelineLogs(prev => [...prev, `⚠️ AI Classification failed: ${errMsg}`]);
                  break;
                }
              }
            }

            if (!hasClassifiedFile) {
              deferredPages.push({ pageNumber: i, text: washedText });
              setPipelineLogs(prev => [...prev, `⚠️ Page ${i} deferred until a reliable file classification is found.`]);
              continue;
            }
          }

          const { grade, subject } = fileClassification;
          setPipelineLogs(prev => [...prev, `🎯 Page ${i} matched: [${grade}] / [${subject}]`]);

          if (deferredPages.length > 0) {
            const pendingPages = deferredPages.splice(0, deferredPages.length);
            for (const deferred of pendingPages) {
              setPipelineLogs(prev => [...prev, `🔁 Reprocessing deferred page ${deferred.pageNumber} with the confirmed file classification...`]);
              await ingestPage(deferred.pageNumber, deferred.text, grade!, subject!);
            }
          }

          await ingestPage(i, washedText, grade!, subject!);
        }

        if (!hasClassifiedFile && deferredPages.length > 0) {
          setPipelineLogs(prev => [...prev, `⚠️ Skipped ${deferredPages.length} page(s) from "${pdfFile.name}" because no reliable grade/subject match was found.`]);
        }

        setIngestStatus(prev => ({ ...prev, [pdfFile.name]: 'done' }));
      }

      setPipelineLogs(prev => [...prev, `🎉 Pipeline complete for all files!`]);
    } catch (err: any) {
      setPipelineLogs(prev => [...prev, `❌ Pipeline aborted: ${err.message}`]);
    } finally {
      setIsAutoPiloting(false);
      setTimeout(() => logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
  };

  pipelineRef.current = runDogwasherPipeline;

  const fetchDbParams = async () => {
    if (!supabaseUrl || !supabaseKey) return;
    
    setIsFetchingParams(true);
    try {
      const supabase = getSupabase();
      
      const [
        { data: subjects },
        { data: sections },
        { data: tracks },
        { data: grades }
      ] = await Promise.all([
        supabase.from('subjects').select('name'),
        supabase.from('bac_sections').select('name'),
        supabase.from('bac_tracks').select('name'),
        supabase.from('grades').select('name')
      ]);

      setDbParams({
        subjects: subjects?.map(s => s.name) || [],
        sections: sections?.map(s => s.name) || [],
        tracks: tracks?.map(s => s.name) || [],
        grades: grades?.map(g => g.name) || []
      });
    } catch (err) {
      console.error('Failed to fetch DB params:', err);
    } finally {
      setIsFetchingParams(false);
    }
  };

  const runGapAnalysis = async (table: string) => {
    if (!supabaseUrl || !supabaseKey) return;
    
    setShowTaskModal(table); 
    setGapAnalysis(null);
    setIsAnalyzing(true);
    
    try {
      const supabase = getSupabase();

      let score = 0;
      let missing: any[] = [];

      if (table === 'topics') {
        const [{data: grades}, {data: subjects}, {data: topics}] = await Promise.all([
          supabase.from('grades').select('id, name').limit(100),
          supabase.from('subjects').select('id, name').limit(100),
          supabase.from('topics').select('grade_id, subject_id').limit(10000)
        ]);
        
        if (!grades || grades.length === 0 || !subjects || subjects.length === 0) {
          score = 0;
          missing.push({
            title: 'Parent records missing (Grades or Subjects)', 
            prompt: 'Generate two JSON arrays only: grades as [{name, grade_order}] and subjects as [{name}]. Do not invent IDs; grades will later be linked to cycles and subjects will be inserted into public.subjects.', 
            type: 'high'
          });
        } else {
          // Assume not EVERY grade takes EVERY subject, but for gap analysis we pick random combos that are missing.
          let existingCombos = new Set(topics?.map(t => `${t.grade_id}-${t.subject_id}`));
          let totalPossible = Math.min((grades.length * subjects.length) * 0.4, topics ? topics.length + 15 : 20); // rough heuristic
          
          score = topics ? Math.min(Math.round((topics.length / totalPossible) * 100), 100) : 0;
          
          let emptyCount = 0;
          for (let g of grades.slice(0, 5)) {
            for (let s of subjects.slice(0, 5)) {
              if (emptyCount >= 4) break;
              if (!existingCombos.has(`${g.id}-${s.id}`)) {
                missing.push({
                  title: `Missing Course Syllabus: ${s.name} for ${g.name}`, 
                  prompt: `Generate a JSON array of curriculum topics for ${s.name} in ${g.name}. Return only [{title, topic_order}]. Do not invent IDs; grade_id=${g.id} and subject_id=${s.id} will be attached separately.`,
                  type: 'high'
                });
                emptyCount++;
              }
            }
          }
        }
      } 
      else if (table === 'exercises') {
        const [{data: topics}, {data: exercises}] = await Promise.all([
          supabase.from('topics').select('id, title').limit(50),
          supabase.from('exercises').select('topic_id').limit(10000)
        ]);
        
        if (!topics || topics.length === 0) {
          score = 0;
          missing.push({
            title: 'No Topics found to attach exercises to.', 
            prompt: 'Create curriculum topics first so exercises have relational destinations.', 
            type: 'high'
          });
        } else {
          let covered = new Set(exercises?.map(e => e.topic_id));
          score = Math.round((covered.size / topics.length) * 100);
          
          topics.filter(t => !covered.has(t.id)).slice(0, 4).forEach((t: any) => {
            missing.push({
              title: `Missing Exercises for Topic: ${t.title}`,
              prompt: `Generate 3 practice exercises for the topic "${t.title}". Return only a JSON array of [{title, prompt, solution, hints, difficulty, type}]. Use difficulty from [easy, medium, hard] and type="problem". Do not invent topic_id; topic_id=${t.id} will be attached separately.`,
              type: 'high'
            });
          });
        }
      }
      else if (table === 'bac_exams') {
        const [{data: tracks}, {data: exams}] = await Promise.all([
            supabase.from('bac_tracks').select('id, name').limit(50),
            supabase.from('bac_exams').select('track_id').limit(10000)
        ]);

        if (!tracks || tracks.length === 0) {
            score = 0;
            missing.push({title: 'No Baccalaureate Tracks exist.', prompt: 'Generate a JSON array of Bac tracks grouped by section. Return only [{section_name, track_code, name, description, track_order}]. Do not invent IDs; section IDs will be resolved separately.', type: 'high'});
        } else {
            let covered = new Set(exams?.map(e => e.track_id));
            score = Math.round((covered.size / (tracks.length || 1)) * 100);
            
            tracks.filter(t => !covered.has(t.id)).slice(0, 4).forEach((t: any) => {
                missing.push({
                    title: `Missing Past Exams for Track: ${t.name}`,
                    prompt: `Generate a JSON array of Bac exam records for the track "${t.name}". Return only [{exam_code, exam_level, academic_year_order, name, description}]. Use exam_level only from ["regional","national"]. Do not invent track_id; the track context is already "${t.name}".`,
                    type: 'medium'
                });
            });
        }
      }
      else {
        // Generic Fallback based on row counts
        const query = await supabase.from(table).select('id', { count: 'exact' }).limit(10);
        let actual = 0;
        if (query.count !== null && query.count !== undefined) {
             actual = query.count;
        } else if (query.data) {
             actual = query.data.length;
        }

        const expected = actual === 0 ? 10 : (actual * 2 + 5);
        score = Math.round((actual / expected) * 100);
        
        missing.push({
          title: `Expand generic dataset for "${table}"`,
          prompt: `Generate exactly 5 realistic, high-quality entries for a SQL table named "${table}" in an educational application. Output as a JSON array.`,
          type: 'medium'
        });
        
        if (actual === 0) {
           missing.unshift({
              title: `Table "${table}" is completely empty.`,
              prompt: `Provide the core seed data required to populate a table named "${table}" in a modern learning management system. Formatted as JSON array.`,
              type: 'high'
           });
        }
      }

      setGapAnalysis({
        score: Math.min(score, 100),
        missing: missing.slice(0, 5)
      });

    } catch (err) {
      console.error(err);
      setGapAnalysis({
        score: 0,
        missing: [{title: `Analysis Failed for ${table}`, prompt: `Debug database connection for table ${table}.`, type: 'low'}]
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const fetchPlannerHierarchies = async () => {
    if (!supabaseUrl || !supabaseKey) return;
    try {
      const supabase = getSupabase();

      // Join grades -> cycles -> curricula
      let query;
      try {
        query = await supabase.from('grades').select(`
          id, name,
          cycles ( name,
            curricula ( name )
          )
        `);
      } catch (e) {
        // manual join if foreign keys aren't recognized properly locally
        const [grades, cycles, currs] = await Promise.all([
          supabase.from('grades').select('*'),
          supabase.from('cycles').select('*'),
          supabase.from('curricula').select('*')
        ]);
        if (grades.data && cycles.data && currs.data) {
          const cycMap = new Map(cycles.data.map(c => [c.id, c]));
          const currMap = new Map(currs.data.map(c => [c.id, c]));
          const mapped = grades.data.map(g => {
            const cyc = cycMap.get(g.cycle_id) as any;
            const cur = cyc ? currMap.get(cyc.curriculum_id) as any : null;
            return {
              id: g.id,
              name: g.name,
              cycles: { name: cyc?.name || 'Unknown Cycle', curricula: { name: cur?.name || 'Unknown Curriculum'} }
            }
          });
          setPlannerHierarchies(mapped);
          return;
        }
      }

      if (query && query.data) {
        setPlannerHierarchies(query.data);
      }
    } catch(err) {
      console.error(err);
    }
  };

  useEffect(() => {
    if (activeMonitorTab === 'planner' && plannerHierarchies.length === 0) {
      if (isSupabaseEnabled && supabaseUrl && supabaseKey) {
        fetchPlannerHierarchies();
      }
    }
  }, [activeMonitorTab, isSupabaseEnabled]);

  const generatePlannerTasks = async (gradeId: string) => {
    if (!gradeId || !supabaseUrl || !supabaseKey) return;
    setIsFetchingPlannerTasks(true);
    setPlannerTasks(null);

    try {
      const supabase = getSupabase();

      const tasks = [];
      const grade = plannerHierarchies.find(h => h.id === gradeId);
      const gradeName = grade?.name || 'Selected Grade';

      // 1. Fetch expected Subjects structure
      const { data: gradeSubjs } = await supabase.from('grade_subjects')
        .select(`subjects(id, name)`)
        .eq('grade_id', gradeId);

      // 2. Fetch Topics structure
      const { data: topics } = await supabase.from('topics')
        .select(`id, title, subjects!inner(name)`)
        .eq('grade_id', gradeId)
        .limit(1000);

      const topicIds = topics?.map(t => t.id) || [];

      // 3. Fetch Outlines and Exercises
      let outlines: any[] = [];
      let exercises: any[] = [];
      
      if (topicIds.length > 0) {
        const [{ data: outs }, { data: exs }] = await Promise.all([
          supabase.from('topic_outlines').select('id, topic_id').in('topic_id', topicIds).limit(5000),
          supabase.from('exercises').select('id, topic_id').in('topic_id', topicIds).limit(5000)
        ]);
        outlines = outs || [];
        exercises = exs || [];
      }

      const hasSubjects = gradeSubjs && gradeSubjs.length > 0;
      const hasTopics = topics && topics.length > 0;

      // STEP 1: Map Core Subjects
      tasks.push({
        step: 1,
        title: `Map Subjects to ${gradeName}`,
        status: hasSubjects ? 'completed' : 'actionable',
        metrics: hasSubjects ? `${gradeSubjs.length} Subjects Linked` : `0 Subjects Linked`,
        description: hasSubjects 
          ? `âœ“ The core subjects for this grade have been established in the database.` 
          : `You must define the official list of subjects taught in this grade. Topics and lessons rely on this parent structure.`,
        prompt: hasSubjects ? null : `Generate a JSON array of official subjects for ${gradeName}. Return only [{name}]. Do not invent descriptions or IDs; this output maps directly to public.subjects before grade_subjects links are created.`
      });

      // STEP 2: Generate Topics
      let missingTopicsSubjs = [];
      if (hasSubjects && hasTopics) {
        const topicSubjNames = new Set(topics.filter(t=>t.subjects).map(t=>(t.subjects as any).name));
        missingTopicsSubjs = gradeSubjs.map(gs => (gs.subjects as any)?.name).filter(sName => sName && !topicSubjNames.has(sName));
      }

      const topicsStatus = !hasSubjects ? 'locked' : (!hasTopics || missingTopicsSubjs.length > 0) ? 'actionable' : 'completed';
      
      let topicPrompt = null;
      if (topicsStatus === 'actionable') {
        const allSubjectNames = (gradeSubjs || [])
          .map(gs => (gs.subjects as any)?.name)
          .filter(Boolean);
        const targetSubjects = (!hasTopics ? allSubjectNames : missingTopicsSubjs).slice(0, 3);
        topicPrompt = `Generate a JSON array of syllabus topics for ${gradeName} limited to these subjects: ${targetSubjects.join(', ')}. Return only [{subject_name, title, topic_order}]. Do not invent IDs; subject_name must match an existing subject exactly.`;
      }

      tasks.push({
        step: 2,
        title: `Build Syllabus Topics`,
        status: topicsStatus,
        metrics: hasTopics ? `${topics.length} Topics across ${new Set(topics.map(t=>(t.subjects as any)?.name)).size} Subjects` : `0 Topics`,
        description: topicsStatus === 'locked' 
          ? `Link subjects first before generating syllabus topics.`
          : topicsStatus === 'actionable' 
            ? (!hasTopics ? `Define the high-level syllabus topics. Start with ${(gradeSubjs?.[0]?.subjects as any)?.name || 'a core subject'}.` : `Missing topics for specific subjects: ${missingTopicsSubjs.join(', ')}`)
            : `âœ“ All mapped subjects currently contain at least one syllabus topic.`,
        prompt: topicPrompt
      });

      // STEP 3: Lesson Outlines
      let topicsWithoutOutlines = [];
      if (hasTopics) {
        const outlinedTopicIds = new Set(outlines.map(o => o.topic_id));
        topicsWithoutOutlines = topics.filter(t => !outlinedTopicIds.has(t.id));
      }
      const outlinesStatus = !hasTopics ? 'locked' : (topicsWithoutOutlines.length > 0) ? 'actionable' : 'completed';
      
      let outlinesPrompt = null;
      let outlinesDescription = '';

      if (outlinesStatus === 'actionable') {
        const targetTopics = topicsWithoutOutlines
          .slice(0, 5)
          .map((t: any) => ({ subject: (t.subjects as any)?.name || 'Unknown Subject', title: t.title }));
        const targetLabel = targetTopics.map(t => `${t.subject}: ${t.title}`).join(' | ');

        outlinesPrompt = `Generate lesson outlines for these topics in ${gradeName}: ${targetLabel}. Return only [{topic_title, outline_title, description, order_index}]. topic_title must exactly match one of the supplied topics.`;
        outlinesDescription = `Exact Action: ${topicsWithoutOutlines.length} topics are missing lesson outlines. Start with: ${targetLabel}.`;
      } else if (outlinesStatus === 'locked') {
        outlinesDescription = `Generate syllabus topics first before splitting them into lesson outlines.`;
      } else {
        outlinesDescription = `âœ“ All defined topics have structural lesson outlines attached.`;
      }

      tasks.push({
        step: 3,
        title: `Generate Lesson Outlines`,
        status: outlinesStatus,
        metrics: hasTopics ? `${outlines.length} Outlines across ${topicIds.length - topicsWithoutOutlines.length}/${topicIds.length} Topics` : `0 Lesson Outlines`,
        description: outlinesDescription,
        prompt: outlinesPrompt
      });

      // STEP 4: Exercises
      let topicsWithoutExercises = [];
      if (hasTopics) {
        const exercisedTopicIds = new Set(exercises.map(e => e.topic_id));
        topicsWithoutExercises = topics.filter(t => !exercisedTopicIds.has(t.id));
      }
      const exercisesStatus = !hasTopics ? 'locked' : (topicsWithoutExercises.length > 0) ? 'actionable' : 'completed';

      let exercisesPrompt = null;
      let exercisesDescription = '';

      if (exercisesStatus === 'actionable') {
        const targetTopics = topicsWithoutExercises
          .slice(0, 5)
          .map((t: any) => ({ subject: (t.subjects as any)?.name || 'Unknown Subject', title: t.title }));
        const targetLabel = targetTopics.map(t => `${t.subject}: ${t.title}`).join(' | ');

        exercisesPrompt = `Generate 4 practice exercises for these topics in ${gradeName}: ${targetLabel}. Return only [{topic_title, title, prompt, solution, hints, difficulty, type}]. Use difficulty from [easy, medium, hard], type="problem", and keep topic_title identical to the supplied topic title.`;
        exercisesDescription = `Exact Action: ${topicsWithoutExercises.length} topics are entirely missing practice exercises. Start with: ${targetLabel}.`;
      } else if (exercisesStatus === 'locked') {
        exercisesDescription = `Define topics first to provide context for the practice problems.`;
      } else {
        exercisesDescription = `âœ“ All defined topics contain at least one practice exercise.`;
      }

      tasks.push({
        step: 4,
        title: `Populate Exercises`,
        status: exercisesStatus,
        metrics: hasTopics ? `${exercises.length} Exercises across ${topicIds.length - topicsWithoutExercises.length}/${topicIds.length} Topics` : `0 Exercises`,
        description: exercisesDescription,
        prompt: exercisesPrompt
      });

      // STEP 5: Bac Tracks check
      if (gradeName.toLowerCase().includes('bac') || gradeName.includes('Ø§Ù„ØªØ£Ù‡ÙŠÙ„ÙŠ') || gradeName.includes('ThÃ©ologie')) {
         const { data: bacTracks } = await supabase.from('bac_tracks').select('id, name').limit(10);
         const hasTracks = bacTracks && bacTracks.length > 0;
         tasks.push({
            step: 5,
            title: `Configure Baccalaureate Tracks`,
            status: hasTracks ? 'completed' : 'actionable',
            metrics: hasTracks ? `${bacTracks.length} Official Tracks Configured` : `0 Bac Tracks`,
            description: hasTracks 
             ? `âœ“ Bac tracks properly defined in the system. Ensure national exams are correctly linked to these.`
             : `This appears to be a Baccalaureate/High School grade. Define the core specialization tracks (e.g., Sciences Maths, Sciences Physiques).`,
            prompt: hasTracks ? null : `Generate a JSON array of official National Baccalaureate specialization tracks for ${gradeName}. Return only [{section_name, track_code, name, description, track_order}]. section_name must match an existing Bac section exactly; do not invent IDs.`
         });
      }

      setPlannerTasks(tasks);

    } catch (e) {
      console.error(e);
      setPlannerTasks([]);
    } finally {
      setIsFetchingPlannerTasks(false);
    }
  };

  const runDatabaseMonitor = async () => {
    if (!supabaseUrl || !supabaseKey) {
      setApiStatus({ type: 'error', msg: 'Supabase credentials required.' });
      return;
    }

    setIsScanning(true);
    setApiStatus({ type: 'success', msg: 'Deep scanning schema tables...' });
    
    try {
      const supabase = getSupabase();
      
      // Fetch counts for ALL schema tables
      // Some proxies or free-tier networks strip the Content-Range header, causing count to be null.
      // We fetch just the 'id' column with a generous limit to fallback to array length if the header is lost.
      const countResults = await Promise.all(
        SCHEMA_TABLES.map(table =>
          supabase.from(table).select('id', { count: 'exact' }).limit(10000)
            .then(res => {
              let cnt = res.count;
              if (cnt === null || cnt === undefined) {
                cnt = res.data ? res.data.length : 0;
              }
              return {
                table,
                count: cnt,
                error: res.error,
                missing: isMissingSupabaseTableError(res.error),
              };
            })
        )
      );

      const countsMap: Record<string, number> = {};
      const errorsMap: Record<string, any> = {};
      const missingTables: string[] = [];
      countResults.forEach(r => {
        countsMap[r.table] = r.count;
        if (r.error) {
          errorsMap[r.table] = r.error;
          if (r.missing) {
            missingTables.push(r.table);
          } else {
            console.error(`Count Error [${r.table}]:`, r.error);
          }
        }
      });
      setMissingSchemaTables(missingTables);

      // Identify missing links
      const missingTasks = [];
      
      if (!countsMap['bac_sections']) missingTasks.push({ 
        id: 't1', 
        task: 'Initialize Bac Sections', 
        severity: 'high',
        context: { type: 'initialization', info: 'Create core sections (Science, æ–‡å­¦, etc.)' }
      });

      if (countsMap['bac_sections'] > 0 && !countsMap['bac_tracks']) missingTasks.push({ 
        id: 't2', 
        task: 'Add Tracks to existing Sections', 
        severity: 'high',
        context: { type: 'linkage', info: 'Match Math/Physics tracks to Sections' }
      });

      if (!countsMap['rag_chunks']) {
        missingTasks.push({ 
          id: 't3', 
          task: 'Populate RAG Content from PDFs', 
          severity: 'medium',
          context: { type: 'population', info: 'Table rag_chunks is currently empty.' }
        });
      } else {
        // NEW: Check for null embeddings (Vector Gaps)
        const { count: vectorGapsCount, data: gapData, error: gapError } = await supabase
          .from('rag_chunks')
          .select('id', { count: 'exact' })
          .is('embedding', null)
          .limit(1000);
        
        let gapCount = vectorGapsCount;
        if (gapCount === null || gapCount === undefined) {
          gapCount = gapData ? gapData.length : 0;
        }
        
        if (!gapError && gapCount > 0) {
          missingTasks.push({
            id: 't_vector_gap',
            task: 'Fragment & Embed Existing Knowledge',
            severity: 'high',
            context: { 
              type: 'vector_sync', 
              info: `${gapCount} nodes found with missing vectors. Semantic search will skip these.` 
            }
          });
        }
      }
      
      // Data Integrity checks
      if (countsMap['bac_sections'] > 0) {
        const { data: orphans } = await supabase.from('bac_sections').select('name, bac_tracks(id)');
        const sectionGaps = orphans?.filter(o => !o.bac_tracks || o.bac_tracks.length === 0) || [];
        sectionGaps.forEach(s => {
          missingTasks.push({ 
            id: `s-${s.name}`, 
            task: `Add Tracks for ${s.name}`, 
            severity: 'medium',
            context: { type: 'integrity', info: `Section '${s.name}' exists but has no associated tracks.` }
          });
        });
      }

      setDataHealth({
        counts: countsMap,
        errors: errorsMap,
        missingTables,
        todo: missingTasks
      });
      
      const errorTables = Object.keys(errorsMap).filter(table => !missingTables.includes(table));
      if (missingTables.length > 0) {
        setApiStatus({
          type: 'error',
          msg: `RAG migration missing in Supabase: ${missingTables.join(', ')}. Run migrations/006_rag_chunk_repair_validation.sql.`,
        });
      } else if (errorTables.length > 0) {
        setApiStatus({ type: 'error', msg: `Sync finished with access limits on ${errorTables.length} tables (Check RLS policies).` });
      } else {
        setApiStatus({ type: 'success', msg: 'Database scanned successfully.' });
      }
      
    } catch (err: any) {
      setApiStatus({ type: 'error', msg: `Monitor Failed: ${err.message}` });
    } finally {
      setIsScanning(false);
    }
  };

  const fetchExplorerData = async (table: string = explorerTable) => {
    if (!supabaseUrl || !supabaseKey) {
      setApiStatus({ type: 'error', msg: 'Supabase credentials required. Please configure them in Config / API tab.' });
      return;
    }
    
    setIsFetchingExplorerData(true);
    setApiStatus(null);
    
    try {
      const supabase = getSupabase();
      
      const { data, error } = await supabase.from(table).select('*').limit(50);
      if (error) {
        setSupabaseExplorerData([]);
        if (isMissingSupabaseTableError(error)) {
          if (!missingSchemaTables.includes(table)) {
            setMissingSchemaTables(prev => [...prev, table]);
          }
          setApiStatus({ type: 'error', msg: `Table ${table} is not installed in Supabase yet. Run migrations/006_rag_chunk_repair_validation.sql.` });
        } else {
          console.error('Fetch error:', error);
          setApiStatus({ type: 'error', msg: `Explorer Error: ${error.message}` });
        }
      } else {
        setSupabaseExplorerData(data || []);
        if (missingSchemaTables.includes(table)) {
          setMissingSchemaTables(prev => prev.filter(name => name !== table));
        }
        if (!data || data.length === 0) {
          setApiStatus({ type: 'success', msg: `Table ${table} is empty. (If data exists, check Supabase RLS policies!)` });
        }
      }
      setExplorerTable(table);
    } catch (err: any) {
      console.error('Explorer Fetch Error:', err);
      setApiStatus({ type: 'error', msg: `Connection Failed: ${err.message}` });
    } finally {
      setIsFetchingExplorerData(false);
    }
  };

  const deleteExplorerRow = async (id: any, table: string = explorerTable) => {
    if (!supabaseUrl || !supabaseKey) return;
    if (!confirm('Are you sure you want to delete this record?')) return;
    
    try {
      const supabase = getSupabase();
      
      const { error } = await supabase.from(table).delete().eq('id', id);
      if (error) throw error;
      
      setApiStatus({ type: 'success', msg: `Row deleted from ${table}` });
      fetchExplorerData(table);
      runDatabaseMonitor(); // Update counts
    } catch (err: any) {
      setApiStatus({ type: 'error', msg: `Delete Failed: ${err.message}` });
    }
  };

  const testSupabaseConnection = async () => {
    if (!supabaseUrl || !supabaseKey) {
      setApiStatus({ type: 'error', msg: 'URL and Anon Key are required.' });
      return;
    }

    setIsTestingSupabase(true);
    setApiStatus({ type: 'success', msg: 'Checking heartbeat... (Waking up database if paused)' });

    try {
      const supabase = getSupabase();
      
      // Use AbortController for a 15-second timeout on the health check
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      try {
        const { error } = await supabase.from('rag_chunks').select('id').limit(1).abortSignal(controller.signal);
        clearTimeout(timeoutId);
        
        if (error) {
          if (error.code === 'PGRST116' || error.message.includes('not found')) {
            setApiStatus({ type: 'success', msg: 'Connected! (Note: Core tables not found yet)' });
            fetchDbParams();
          } else {
            throw new Error(error.message);
          }
        } else {
          setApiStatus({ type: 'success', msg: 'Connection Successful! Initializing workspace...' });
          fetchDbParams();
          runDatabaseMonitor();
        }
      } catch (innerErr: any) {
        if (innerErr.name === 'AbortError') {
          throw new Error('Connection timed out. Supabase project might be taking long to wake up. Please try again in 30 seconds.');
        }
        throw innerErr;
      }
    } catch (err: any) {
      console.error('Supabase Test Error:', err);
      setApiStatus({ type: 'error', msg: `Connection Failed: ${err.message}` });
    } finally {
      setIsTestingSupabase(false);
    }
  };

  return (
    <div className="flex h-screen w-full bg-[#050505] text-white font-sans overflow-hidden">
      <div className="atmosphere"></div>
      
      {/* Sidebar Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-30 md:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside className={`fixed md:relative w-[260px] h-full border-r border-[var(--glass-border)] bg-[#070101] backdrop-blur-md flex flex-col z-40 transition-transform duration-300 ease-in-out ${
        isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      }`}>
        <div className="p-6">
          <div className="flex items-center gap-3 mb-10">
            <div className="w-10 h-10 bg-[var(--color-accent)] rounded-lg flex items-center justify-center text-black shadow-[0_0_20px_var(--color-accent-dim)]">
              <AppWindow className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">Flux PDF</h1>
              <span className="text-[10px] text-white/40 uppercase tracking-[2px]">Combiner Pro</span>
            </div>
          </div>

          <nav className="space-y-1">
            <button 
              onClick={() => navigateMainTab('dashboard')} 
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-all group ${
                activeMainTab === 'dashboard' 
                  ? 'bg-white/5 text-[var(--color-accent)] border-[var(--color-accent)]/20' 
                  : 'text-white/40 hover:text-white hover:bg-white/5 border-transparent'
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              <span className="text-sm font-medium">File Upload</span>
            </button>
            <button 
              onClick={() => navigateMainTab('processing')} 
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-all group ${
                activeMainTab === 'processing' 
                  ? 'bg-white/5 text-[var(--color-accent)] border-[var(--color-accent)]/20' 
                  : 'text-white/40 hover:text-white hover:bg-white/5 border-transparent'
              }`}
            >
              <Layers className="w-4 h-4" />
              <span className="text-sm font-medium">AI Pipeline</span>
            </button>
            <button 
              onClick={() => navigateMainTab('settings')} 
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-all group ${
                activeMainTab === 'settings' 
                  ? 'bg-white/5 text-[var(--color-accent)] border-[var(--color-accent)]/20' 
                  : 'text-white/40 hover:text-white hover:bg-white/5 border-transparent'
              }`}
            >
              <Settings className="w-4 h-4" />
              <span className="text-sm font-medium">Config / API</span>
            </button>
            <button 
              onClick={() => navigateMainTab('database')} 
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-all group ${
                activeMainTab === 'database' 
                  ? 'bg-white/5 text-[var(--color-accent)] border-[var(--color-accent)]/20' 
                  : 'text-white/40 hover:text-white hover:bg-white/5 border-transparent'
              }`}
            >
              <Database className="w-4 h-4" />
              <span className="text-sm font-medium">Database Hub</span>
            </button>
            <button 
              onClick={() => navigateMainTab('taskcenter')} 
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-all group ${
                activeMainTab === 'taskcenter' 
                  ? 'bg-white/5 text-[var(--color-accent)] border-[var(--color-accent)]/20' 
                  : 'text-white/40 hover:text-white hover:bg-white/5 border-transparent'
              }`}
            >
              <ListChecks className="w-4 h-4" />
              <span className="text-sm font-medium">Task Center</span>
            </button>
            <button 
              onClick={() => navigateMainTab('chunkreview')} 
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-all group ${
                activeMainTab === 'chunkreview' 
                  ? 'bg-white/5 text-[var(--color-accent)] border-[var(--color-accent)]/20' 
                  : 'text-white/40 hover:text-white hover:bg-white/5 border-transparent'
              }`}
            >
              <Eye className="w-4 h-4" />
              <span className="text-sm font-medium">Chunk Review</span>
            </button>
            <button 
              onClick={() => navigateMainTab('extractionjobs')} 
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-all group ${
                activeMainTab === 'extractionjobs' 
                  ? 'bg-white/5 text-[var(--color-accent)] border-[var(--color-accent)]/20' 
                  : 'text-white/40 hover:text-white hover:bg-white/5 border-transparent'
              }`}
            >
              <BrainCircuit className="w-4 h-4" />
              <span className="text-sm font-medium">Extraction Jobs</span>
            </button>
          </nav>
        </div>

        <div className="mt-auto p-6 space-y-4">
          <div className="p-4 bg-white/5 rounded-2xl border border-white/5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Database className={`w-3.5 h-3.5 ${isSupabaseEnabled ? 'text-[#3ECF8E]' : 'text-white/20'}`} />
                <span className="text-[10px] font-bold uppercase tracking-wider">Supabase</span>
              </div>
              <button 
                onClick={() => setIsSupabaseEnabled(!isSupabaseEnabled)}
                className={`relative w-8 h-4 rounded-full transition-colors duration-200 focus:outline-none ${isSupabaseEnabled ? 'bg-[#3ECF8E]' : 'bg-white/10'}`}
              >
                <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform duration-200 ${isSupabaseEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
            </div>
            <p className="text-[9px] text-white/40 leading-relaxed">
              Toggle cloud database synchronization and storage features.
            </p>
          </div>

          <div className="p-4 bg-[var(--color-accent-dim)] rounded-2xl border border-[var(--color-accent)]/10">
            <h4 className="text-xs font-semibold mb-2 flex items-center gap-2">
              <Info className="w-3 h-3 text-[var(--color-accent)]" />
              Quick Info
            </h4>
            <div className="space-y-2">
              <div className="flex justify-between text-[10px] text-white/60">
                <span>Max File Size</span>
                <span className="text-[var(--color-accent)]">{MAX_FILE_SIZE_MB}MB</span>
              </div>
              <div className="flex justify-between text-[10px] text-white/60">
                <span>Total Files</span>
                <span>{files.length}</span>
              </div>
              <div className="flex justify-between text-[10px] text-white/60">
                <span>Combined Size</span>
                <span>{formatBytes(files.reduce((acc, f) => acc + f.size, 0))}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 px-4 text-white/30 text-[10px]">
            <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${
              aiProvider === 'gemini' ? 'bg-[#3ECF8E]' : 
              aiProvider === 'local' ? 'bg-orange-500' : 'bg-[#4F46E5]'
            }`}></div>
            {aiProvider === 'gemini' ? 'Gemini 2.0 Active' : aiProvider === 'local' ? 'Local Engine Active' : 'OpenRouter Active'}
          </div>
        </div>
      </aside>

      {/* Main Container */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* Top Bar */}
        <header className="h-[72px] border-b border-[var(--glass-border)] bg-[#050505]/30 backdrop-blur-xl flex items-center justify-between px-4 lg:px-8 z-10 transition-all">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="md:hidden p-2 -ml-2 text-white/60 hover:text-white transition-colors"
            >
              <Menu className="w-6 h-6" />
            </button>
            <h2 className="text-xs sm:text-sm font-medium text-white/70 truncate whitespace-nowrap overflow-hidden max-w-[200px] sm:max-w-none">
              Workspace / {['taskcenter', 'chunkreview', 'extractionjobs'].includes(activeMainTab) ? 'Admin' : 'Project'} / <span className="text-white">
                {activeMainTab === 'taskcenter' ? 'Task Center' : 
                 activeMainTab === 'chunkreview' ? 'Chunk Review' :
                 activeMainTab === 'extractionjobs' ? 'Extraction Jobs' :
                 activeMainTab === 'database' ? 'Database Hub' :
                 activeMainTab === 'processing' ? 'AI Pipeline' :
                 activeMainTab === 'settings' ? 'Configuration' : 'New Curriculum'}
              </span>
            </h2>
          </div>
          <button 
            onClick={() => setShowGuideModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--color-accent)]/10 hover:bg-[var(--color-accent)]/20 text-[var(--color-accent)] border border-[var(--color-accent)]/30 rounded-full text-[10px] font-black uppercase tracking-widest transition-all"
          >
            <MapIcon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Master Guide</span>
          </button>
        </header>

        {/* Workspace Content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-8 custom-scrollbar bg-[#0b0601]">
          <AnimatePresence mode="wait">
            {activeMainTab === 'dashboard' && (
              <motion.div 
                key="dashboard"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="max-w-[800px] mx-auto space-y-8 pb-12"
              >
                <header>
                  <h1 className="text-3xl font-light mb-2">Assemble Documents</h1>
                  <p className="text-white/40 text-sm">Drag and drop to organize your final output.</p>
                </header>

                {error && (
                  <motion.div 
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-2xl flex items-start gap-3 text-sm"
                  >
                    <AlertCircle className="w-5 h-5 shrink-0" />
                    <p>{error}</p>
                  </motion.div>
                )}

                <div className="space-y-6">
                  <div 
                  className={`border-2 border-dashed rounded-[32px] p-6 lg:p-12 text-center transition-all cursor-pointer flex flex-col items-center justify-center min-h-[200px] lg:min-h-[260px] group ${
                    files.length > 0 ? 'bg-white/5 border-white/10' : 'bg-white/[0.02] border-white/5 hover:border-[var(--color-accent)]/30 hover:bg-white/[0.04]'
                  }`}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.add('border-[var(--color-accent)]', 'bg-[var(--color-accent)]/5', 'scale-[1.01]');
                  }}
                  onDragLeave={(e) => {
                    e.currentTarget.classList.remove('border-[var(--color-accent)]', 'bg-[var(--color-accent)]/5', 'scale-[1.01]');
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.remove('border-[var(--color-accent)]', 'bg-[var(--color-accent)]/5', 'scale-[1.01]');
                    const droppedFiles = Array.from(e.dataTransfer.files) as File[];
                    const pdfFiles = droppedFiles.filter(f => f.type === 'application/pdf');
                    if (pdfFiles.length > 0) {
                      const newFiles = pdfFiles.map(file => ({
                        id: Math.random().toString(36).substr(2, 9),
                        file,
                        name: file.name,
                        size: file.size,
                        type: file.type
                      }));
                      setFiles(prev => [...prev, ...newFiles]);
                    }
                  }}
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept=".pdf,application/pdf"
                    multiple
                    className="hidden"
                  />
                  <div className="w-16 h-16 border-2 border-white/10 rounded-[24px] flex items-center justify-center mb-6 text-white/20 group-hover:text-[var(--color-accent)] group-hover:border-[var(--color-accent)]/50 transition-all">
                    {files.length > 0 ? (
                      <FilePlus className="w-8 h-8 text-[var(--color-accent)]" />
                    ) : (
                      <Upload className="w-8 h-8" />
                    )}
                  </div>
                  <h3 className="text-xl font-medium mb-1 drop-shadow-sm font-sans">
                    {files.length > 0 ? `${files.length} Files in Queue` : 'Feed the Brain'}
                  </h3>
                  <p className="text-sm text-white/30 max-w-[280px] mx-auto">
                    {files.length > 0 ? 'Add more documents or start processing' : 'Drop your PDFs here to begin your AI RAG preparation'}
                  </p>
                </div>

                {files.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-white/50 uppercase tracking-wider px-2">File Order ({files.length})</h3>
                    <AnimatePresence mode="popLayout">
                      {files.map((file, index) => (
                        <motion.div 
                          key={file.id} 
                          layout
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          className="flex items-center justify-between p-4 bg-white/5 border border-[var(--glass-border)] rounded-2xl hover:border-white/20 transition-all group"
                        >
                          <div className="flex items-center gap-4 overflow-hidden">
                            <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center shrink-0 text-xs font-bold text-[#ff4d4d]">
                              PDF
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-sm truncate">{file.name}</p>
                              <p className="text-xs text-white/30 mt-0.5">{formatBytes(file.size)}</p>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => moveFile(index, 'up')}
                              disabled={index === 0}
                              className="p-2 text-white/40 hover:text-white hover:bg-white/10 rounded-xl disabled:opacity-30 transition-colors"
                            >
                              <ArrowUp className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => moveFile(index, 'down')}
                              disabled={index === files.length - 1}
                              className="p-2 text-white/40 hover:text-white hover:bg-white/10 rounded-xl disabled:opacity-30 transition-colors"
                            >
                              <ArrowDown className="w-4 h-4" />
                            </button>
                            <div className="w-px h-4 bg-white/10 mx-1"></div>
                            <button
                              onClick={() => removeFile(file.id)}
                              className="p-2 text-white/40 hover:text-[#ff4d4d] hover:bg-[#ff4d4d]/10 rounded-xl transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                )}
                </div>
              </motion.div>
            )}

            {activeMainTab === 'processing' && (
              <motion.div 
                key="processing"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="max-w-[900px] mx-auto space-y-8 pb-12"
              >
                <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
                  <div>
                    <h1 className="text-3xl font-light mb-2">Processing Engine</h1>
                    <p className="text-white/40 text-sm">Configure AI parameters and run the Dogwasher Pipeline.</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    <button
                      onClick={() => setShowAiConfig(true)}
                      className="flex-1 sm:flex-none py-2 px-3 sm:px-4 bg-white/5 border border-white/10 hover:border-white/20 text-white rounded-lg font-bold text-[9px] sm:text-[10px] uppercase tracking-wider transition-all flex items-center justify-center gap-2"
                    >
                      <Settings className="w-3.5 h-3.5" />
                      AI Config
                    </button>
                    <button
                      onClick={() => {
                        if (activeTask?.id === 't_vector_gap') {
                          runVectorMaintenance();
                        } else {
                          runDogwasherPipeline();
                        }
                      }}
                      disabled={(files.length === 0 && activeTask?.id !== 't_vector_gap') || isAutoPiloting || !supabaseUrl}
                      className="flex-1 sm:flex-none py-2 px-4 sm:px-6 bg-[var(--color-accent)] text-black rounded-lg font-bold text-[9px] sm:text-[10px] uppercase tracking-wider transition-all disabled:opacity-50 hover:shadow-[0_0_15px_var(--color-accent-dim)] whitespace-nowrap"
                    >
                      {isAutoPiloting ? 'Active...' : activeTask?.id === 't_vector_gap' ? 'Run Vector Sync' : 'Start Pipeline'}
                    </button>
                    <button
                      onClick={async () => {
                        setPipelineLogs(prev => [...prev, "ðŸš€ Sending signal to launch headless embedder..."]);
                        setTimeout(() => logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
                        try {
                          const res = await fetch('/api/run-embedder', { method: 'POST' });
                          if (res.ok) {
                            setPipelineLogs(prev => [...prev, "âœ… Headless embedding agent is now running in the background! (Check your IDE terminal for progress logs)"]);
                          } else {
                            setPipelineLogs(prev => [...prev, "âŒ Failed to start background embedder. (Check network)"]);
                          }
                        } catch(err) {
                          setPipelineLogs(prev => [...prev, "âŒ Cannot connect to local API. Ensure you are running locally via Vite."]);
                        }
                      }}
                      disabled={isAutoPiloting}
                      className="py-2 px-3 sm:px-4 bg-[#6A5ACD]/20 text-[#B0A0FF] border border-[#6A5ACD]/30 hover:bg-[#6A5ACD]/40 rounded-lg font-bold text-[9px] sm:text-[10px] uppercase tracking-wider transition-all disabled:opacity-50 whitespace-nowrap"
                    >
                      Run Embedder (Bg)
                    </button>
                    {pipelineLogs.length > 0 && (
                      <button
                        onClick={() => setPipelineLogs([])}
                        className="py-2 px-3 sm:px-4 bg-black/20 text-white/40 hover:text-white rounded-lg font-bold text-[9px] sm:text-[10px] uppercase tracking-wider transition-all"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </header>

                <div className="space-y-6">

                  {/* â”€â”€ AUTO-PIPELINE CONTROL PANEL â”€â”€ */}
                  <div className="p-4 bg-white/[0.03] border border-white/10 rounded-2xl space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Activity className="w-4 h-4 text-[var(--color-accent)]" />
                        <span className="text-xs font-bold uppercase tracking-widest text-white/80">Auto-Pipeline</span>
                        {autoPipelineEnabled && (
                          <span className="px-2 py-0.5 text-[9px] font-black uppercase tracking-wider bg-green-500/20 text-green-400 rounded-full border border-green-500/30 animate-pulse">
                            LIVE
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => setAutoPipelineEnabled(v => !v)}
                        className={`relative w-10 h-5 rounded-full transition-colors duration-300 focus:outline-none ${
                          autoPipelineEnabled ? 'bg-[var(--color-accent)]' : 'bg-white/10'
                        }`}
                      >
                        <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-300 ${
                          autoPipelineEnabled ? 'translate-x-5' : 'translate-x-0'
                        }`} />
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div className="col-span-2 space-y-1">
                        <label className="text-[10px] uppercase text-white/40 font-bold tracking-wider">Run Every (seconds)</label>
                        <input
                          type="number"
                          min={10}
                          max={3600}
                          value={autoPipelineInterval}
                          onChange={e => setAutoPipelineInterval(Math.max(10, Number(e.target.value)))}
                          className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm focus:border-[var(--color-accent)]/50 focus:outline-none transition-all"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] uppercase text-white/40 font-bold tracking-wider">Next Run</label>
                        <div className={`flex items-center justify-center h-[38px] rounded-xl border text-sm font-mono font-bold ${
                          autoPipelineEnabled
                            ? autoPipelineCountdown <= 10
                              ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                              : 'bg-green-500/10 border-green-500/20 text-green-400'
                            : 'bg-black/20 border-white/5 text-white/20'
                        }`}>
                          {autoPipelineEnabled ? `${autoPipelineCountdown}s` : 'â€”'}
                        </div>
                      </div>
                    </div>

                    <p className="text-[10px] text-white/30 leading-relaxed">
                      When enabled, the pipeline will automatically process any queued files every {autoPipelineInterval}s.
                      New files from <code className="text-[var(--color-accent)]/80">auto_ingest_pdfs/</code> are ingested every 5s.
                    </p>

                    {Object.keys(ingestStatus).length > 0 && (
                      <div className="space-y-1.5 pt-1 border-t border-white/5">
                        <p className="text-[10px] uppercase font-bold text-white/40 tracking-wider">Ingest Tracker</p>
                        {Object.entries(ingestStatus).slice(-5).map(([name, status]) => (
                          <div key={name} className="flex items-center justify-between text-[10px]">
                            <span className="text-white/50 truncate max-w-[200px]" title={name}>{name}</span>
                            <span className={`px-2 py-0.5 rounded-full font-bold uppercase tracking-wide ${
                              status === 'done' ? 'bg-green-500/15 text-green-400' :
                              status === 'duplicate' ? 'bg-yellow-500/15 text-yellow-400' :
                              status === 'processing' ? 'bg-blue-500/15 text-blue-400 animate-pulse' :
                              'bg-white/5 text-white/30'
                            }`}>{status}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {activeTask && (
                    <div className="p-3 bg-[var(--color-accent)]/10 border border-[var(--color-accent)]/20 rounded-xl flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                        <span className="text-[10px] text-[var(--color-accent)] font-bold uppercase">Goal: {activeTask.task}</span>
                      </div>
                      <button 
                        onClick={() => setActiveTask(null)}
                        className="text-[10px] text-white/40 hover:text-white"
                      >
                        Clear
                      </button>
                    </div>
                  )}

                  {/* Live Terminal for Dogwasher Logs */}
                  <div className="bg-[#0a0a0a] border border-white/10 rounded-xl overflow-hidden shadow-[0_0_30px_rgba(0,0,0,0.5)] flex flex-col h-[500px]">
                    <div className="bg-white/5 border-b border-white/5 px-4 py-3 flex items-center gap-2">
                      <div className="flex gap-1.5">
                        <div className="w-3 h-3 rounded-full bg-[#ff5f56]"></div>
                        <div className="w-3 h-3 rounded-full bg-[#ffbd2e]"></div>
                        <div className="w-3 h-3 rounded-full bg-[#27c93f]"></div>
                      </div>
                      <span className="text-[10px] font-mono text-white/40 ml-2 uppercase tracking-wide">terminal / dogwasher / process.log</span>
                      {isAutoPiloting && <Sparkles className="w-3.5 h-3.5 text-[var(--color-accent)] animate-pulse ml-auto" />}
                    </div>
                    <div className="flex-1 overflow-y-auto p-6 font-mono text-xs leading-relaxed text-white/60 space-y-2">
                      {pipelineLogs.length === 0 ? (
                        <div className="flex items-center justify-center h-full text-white/20">
                          Ready to process {files.length} {files.length === 1 ? 'file' : 'files'}...
                        </div>
                      ) : (
                        pipelineLogs.map((log, idx) => (
                          <div key={idx} className={`${
                            log.includes('âŒ') ? 'text-red-400' : 
                            log.includes('âœ…') || log.includes('ðŸŽ‰') ? 'text-green-400' : 
                            log.includes('ðŸŽ¯') ? 'text-cyan-400' : 
                            log.includes('ðŸ•') ? 'text-[var(--color-accent)]' : ''
                          }`}>
                            <span className="opacity-40 mr-3">[{new Date().toLocaleTimeString([], {hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit'})}]</span>
                            {log}
                          </div>
                        ))
                      )}
                      <div ref={logsEndRef} />
                    </div>
                  </div>
                </div>

                <AnimatePresence>
                  {showAiConfig && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="bg-[#0f0f0f] border border-white/10 rounded-2xl p-6 w-full max-w-lg shadow-2xl relative"
                      >
                        <button 
                          onClick={() => setShowAiConfig(false)}
                          className="absolute top-4 right-4 text-white/40 hover:text-white transition-colors"
                        >
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                        
                        <div className="space-y-6 max-h-[70vh] overflow-y-auto px-1 custom-scrollbar">
                          <div className="flex flex-col gap-1">
                            <h3 className="text-sm font-bold text-[var(--color-accent)] uppercase tracking-wider">AI Configuration</h3>
                            <p className="text-[11px] text-white/40">Select and configure the intelligence engine for extraction.</p>
                          </div>
                          
                          <div className="flex flex-wrap items-center gap-1.5 bg-black/40 p-1.5 rounded-xl border border-white/5">
                            <button
                              onClick={() => setAiProvider('gemini')}
                              className={`flex-1 min-w-0 px-2 py-2 text-[9px] sm:text-[10px] uppercase font-bold rounded-lg transition-all ${aiProvider === 'gemini' ? 'bg-[var(--color-accent)] text-black' : 'text-white/40 hover:text-white/80'}`}
                            >
                              Cloud
                            </button>
                            <button
                              onClick={() => setAiProvider('local')}
                              className={`flex-1 min-w-0 px-2 py-2 text-[9px] sm:text-[10px] uppercase font-bold rounded-lg transition-all ${aiProvider === 'local' ? 'bg-orange-500 text-black' : 'text-white/40 hover:text-white/80'}`}
                            >
                              Local (Ollama)
                            </button>
                            <button
                              onClick={() => setAiProvider('openrouter')}
                              className={`flex-1 min-w-0 px-2 py-2 text-[9px] sm:text-[10px] uppercase font-bold rounded-lg transition-all ${aiProvider === 'openrouter' ? 'bg-[#4F46E5] text-white' : 'text-white/40 hover:text-white/80'}`}
                            >
                              OpenRouter
                            </button>
                          </div>
                          
                          {aiProvider === 'local' ? (
                            <div className="space-y-4 pt-2">
                              <div className="space-y-1.5">
                                <label className="text-[10px] text-[var(--color-accent)] uppercase pl-1">Ollama API Endpoint</label>
                                <input 
                                  type="text"
                                  value={localEndpoint}
                                  onChange={(e) => setLocalEndpoint(e.target.value)}
                                  className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-xs focus:border-orange-500/50 transition-all focus:outline-none"
                                  placeholder="http://localhost:11434/api/generate"
                                />
                              </div>
                              <div className="space-y-1.5">
                                <label className="text-[10px] text-[var(--color-accent)] uppercase pl-1">Model Name</label>
                                <input 
                                  type="text"
                                  value={localModel}
                                  onChange={(e) => setLocalModel(e.target.value)}
                                  className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-xs focus:border-orange-500/50 transition-all focus:outline-none"
                                  placeholder="gemma"
                                />
                              </div>
                            </div>
                          ) : aiProvider === 'openrouter' ? (
                            <div className="space-y-4 pt-2">
                              <div className="space-y-1.5">
                                <label className="text-[10px] text-[#4F46E5] uppercase pl-1">OpenRouter API Key</label>
                                <input 
                                  type="password"
                                  value={openRouterKey}
                                  onChange={(e) => setOpenRouterKey(e.target.value)}
                                  className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-xs focus:border-[#4F46E5]/50 transition-all focus:outline-none"
                                  placeholder="sk-or-v1-..."
                                />
                              </div>
                              <div className="space-y-1.5">
                                <label className="text-[10px] text-[#4F46E5] uppercase pl-1">Model Name</label>
                                <input 
                                  type="text"
                                  value={openRouterModel}
                                  onChange={(e) => setOpenRouterModel(e.target.value)}
                                  className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-xs focus:border-[#4F46E5]/50 transition-all focus:outline-none"
                                  placeholder="qwen/qwen-2.5-7b-instruct:free"
                                />
                              </div>
                            </div>
                          ) : (
                            <div className="p-4 bg-black/20 rounded-xl border border-dashed border-[var(--color-accent)]/20 flex items-center gap-4 mt-2">
                              <div className="w-10 h-10 rounded-lg bg-[var(--color-accent)]/10 flex items-center justify-center shrink-0">
                                <Sparkles className="w-5 h-5 text-[var(--color-accent)]" />
                              </div>
                              <div>
                                <p className="text-[12px] font-medium text-[var(--color-accent)]">Gemini 2.0 Flash</p>
                                <p className="text-[10px] text-[var(--color-accent)]/60 mt-1">Using default API environment credentials. Optimized for fast, accurate text structuring.</p>
                              </div>
                            </div>
                          )}

                          <div className="pt-4 border-t border-white/5 flex justify-end">
                            <button
                              onClick={() => setShowAiConfig(false)}
                              className="py-2.5 px-6 bg-white/10 hover:bg-white/20 text-white rounded-lg font-bold text-[10px] uppercase tracking-wider transition-all"
                            >
                              Done
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    </div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}

            {activeMainTab === 'settings' && (
              <motion.div 
                key="settings"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="max-w-[700px] mx-auto space-y-8 pb-12"
              >
                <header>
                  <h1 className="text-3xl font-light mb-2">Configuration</h1>
                  <p className="text-white/40 text-sm">Manage API keys and global application settings.</p>
                </header>

                <div className="space-y-6">
                  <div className="p-6 bg-white/5 rounded-3xl border border-white/5 space-y-4">
                    <h3 className="text-sm font-bold text-white/60 uppercase tracking-widest flex items-center gap-2">
                      <Settings className="w-4 h-4 text-[#3ECF8E]" />
                      Global Credentials
                    </h3>
                    
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase font-bold text-white/30 ml-1">Supabase Instance</label>
                        <div className="relative">
                          <input
                            type="text"
                            placeholder="Supabase Project URL"
                            value={supabaseUrl}
                            onChange={(e) => setSupabaseUrl(e.target.value)}
                            className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-xs focus:border-[#3ECF8E] transition-all pr-10"
                          />
                          <Database className="absolute right-4 top-3.5 w-4 h-4 text-white/20" />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] uppercase font-bold text-white/30 ml-1">API Key (Anon / Service)</label>
                        <div className="relative">
                          <input
                            type="password"
                            placeholder="Supabase Anon Key"
                            value={supabaseKey}
                            onChange={(e) => setSupabaseKey(e.target.value)}
                            className="w-full bg-black/50 border border-white/10 rounded-xl px-4 py-3 text-xs focus:border-[#3ECF8E] transition-all pr-10"
                          />
                          <Settings className="absolute right-4 top-3.5 w-4 h-4 text-white/20" />
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={testSupabaseConnection}
                      disabled={isTestingSupabase || !supabaseUrl || !supabaseKey}
                      className="w-full py-4 bg-[#3ECF8E]/10 border border-[#3ECF8E]/20 hover:bg-[#3ECF8E] hover:text-black text-[#3ECF8E] rounded-xl font-bold text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-3 mt-4"
                    >
                      {isTestingSupabase ? (
                        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
                      ) : (
                        <Sparkles className="w-4 h-4" />
                      )}
                      Verify Connection
                    </button>

                    {apiStatus && (
                      <motion.div 
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`text-[11px] p-4 rounded-xl border flex items-start gap-3 ${apiStatus.type === 'success' ? 'bg-green-500/10 border-green-500/20 text-green-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}
                      >
                        <Info className="w-4 h-4 shrink-0 mt-0.5" />
                        {apiStatus.msg}
                      </motion.div>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {activeMainTab === 'database' && (
              <motion.div 
                key="database"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="max-w-[1400px] mx-auto space-y-8 pb-12"
              >
                {!isSupabaseEnabled ? (
                  <div className="flex flex-col items-center justify-center p-20 text-center border border-dashed border-white/5 rounded-[40px] bg-white/[0.02]">
                    <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-6">
                      <Database className="w-10 h-10 text-white/20" />
                    </div>
                    <h2 className="text-2xl font-light mb-4">Cloud Database Disabled</h2>
                    <p className="text-white/40 max-w-[400px] mb-8 leading-relaxed">
                      Enable Supabase in the sidebar to access full-page metrics, real-time sync, and the knowledge explorer.
                    </p>
                    <button 
                      onClick={() => setIsSupabaseEnabled(true)}
                      className="px-8 py-3 bg-[var(--color-accent)] text-black rounded-xl font-bold uppercase text-[10px] tracking-widest hover:scale-105 transition-all shadow-xl shadow-[var(--color-accent-dim)]"
                    >
                      Activate Now
                    </button>
                  </div>
                ) : (
                  <>
                    <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                      <div>
                        <h1 className="text-4xl font-light mb-2 flex items-center gap-4">
                          Database Hub 
                          <div className="flex items-center gap-1.5 px-3 py-1 bg-[#3ECF8E]/10 border border-[#3ECF8E]/20 rounded-full">
                            <div className="w-1.5 h-1.5 rounded-full bg-[#3ECF8E] animate-pulse"></div>
                            <span className="text-[10px] font-bold text-[#3ECF8E] uppercase tracking-wider">Live Sync</span>
                          </div>
                        </h1>
                        <p className="text-white/40 text-sm">Full-page metrics and knowledge management for your Supabase cluster.</p>
                      </div>
                      
                      <div className="flex bg-black/40 p-1.5 rounded-2xl border border-white/5">
                        <button 
                          onClick={() => setActiveMonitorTab('overview')} 
                          className={`flex items-center gap-2 px-6 py-2.5 text-[11px] font-bold uppercase rounded-xl transition-all ${activeMonitorTab === 'overview' ? 'bg-white/10 text-white shadow-lg' : 'text-white/40 hover:text-white/60'}`}
                        >
                          <Activity className="w-3.5 h-3.5" />
                          Overview
                        </button>
                        <button 
                          onClick={() => setActiveMonitorTab('queue')} 
                          className={`flex items-center gap-2 px-6 py-2.5 text-[11px] font-bold uppercase rounded-xl transition-all ${activeMonitorTab === 'queue' ? 'bg-white/10 text-white shadow-lg' : 'text-white/40 hover:text-white/60'}`}
                        >
                          <ListTodo className="w-3.5 h-3.5" />
                          Health Queue
                        </button>
                        <button 
                          onClick={() => { setActiveMonitorTab('explorer'); fetchExplorerData(); }} 
                          className={`flex items-center gap-2 px-6 py-2.5 text-[11px] font-bold uppercase rounded-xl transition-all ${activeMonitorTab === 'explorer' ? 'bg-white/10 text-white shadow-lg' : 'text-white/40 hover:text-white/60'}`}
                        >
                          <Search className="w-3.5 h-3.5" />
                          Data Explorer
                        </button>
                        <button 
                          onClick={() => setActiveMonitorTab('planner')} 
                          className={`flex items-center gap-2 px-6 py-2.5 text-[11px] font-bold uppercase rounded-xl transition-all ${activeMonitorTab === 'planner' ? 'bg-white/10 text-white shadow-lg' : 'text-white/40 hover:text-white/60'}`}
                        >
                          <ListChecks className="w-3.5 h-3.5" />
                          Planner
                        </button>
                      </div>
                    </header>

                    <AnimatePresence>
                      {apiStatus && (
                        <motion.div 
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className={`text-[11px] p-4 mb-4 rounded-2xl border flex items-center gap-3 ${apiStatus.type === 'success' ? 'bg-green-500/10 border-green-500/20 text-green-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}
                        >
                          <Info className="w-4 h-4" />
                          {apiStatus.msg}
                          <button onClick={() => setApiStatus(null)} className="ml-auto opacity-40 hover:opacity-100 transition-opacity">
                            âœ•
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <div className="space-y-6">
                      {activeMonitorTab === 'overview' && (
                        <motion.div 
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="space-y-8"
                        >
                          {!dataHealth ? (
                            <div className="p-20 text-center border border-dashed border-white/10 rounded-[40px] bg-white/[0.02]">
                              <Activity className="w-12 h-12 text-white/5 mx-auto mb-6" />
                              <h3 className="text-xl font-light mb-4 text-white/60">No Metrics Captured</h3>
                              <p className="text-white/30 text-sm mb-8">Initiate a deep schema scan to visualize your database health.</p>
                              <button
                                onClick={runDatabaseMonitor}
                                disabled={isScanning || !supabaseUrl}
                                className="px-10 py-4 bg-[#3ECF8E] text-black rounded-full font-bold uppercase text-xs tracking-widest hover:scale-105 transition-all"
                              >
                                {isScanning ? 'Pulsing...' : 'Perform Deep Scan'}
                              </button>
                            </div>
                          ) : (
                            <>
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                <div className="p-6 bg-white/5 rounded-[32px] border border-white/5 relative overflow-hidden group">
                                  <div className="absolute top-0 right-0 w-32 h-32 bg-[#3ECF8E]/5 rounded-full -translate-y-12 translate-x-12 blur-3xl"></div>
                                  <p className="text-[10px] text-white/30 uppercase font-black tracking-widest mb-4">Total Tables</p>
                                  <p className="text-5xl font-light">{SCHEMA_TABLES.length}</p>
                                  <div className="mt-6 flex items-center gap-2 text-[10px] text-[#3ECF8E]/60">
                                    <div className="w-2 h-2 rounded-full bg-[#3ECF8E]"></div>
                                    Standard Edu-Schema
                                  </div>
                                </div>
                                <div className="p-6 bg-white/5 rounded-[32px] border border-white/5 relative overflow-hidden group border-b-[#3ECF8E]/30">
                                  <p className="text-[10px] text-white/30 uppercase font-black tracking-widest mb-4">Healthy Nodes</p>
                                  <p className="text-5xl font-light text-[#3ECF8E]">
                                    {Object.values(dataHealth.counts).filter((c: any) => c > 0).length}
                                  </p>
                                  <div className="mt-6 flex items-center gap-2 text-[10px] text-[#3ECF8E]/60">
                                    <ArrowUp className="w-3 h-3" />
                                    Active Data Tables
                                  </div>
                                </div>
                                <div className="p-6 bg-white/5 rounded-[32px] border border-white/5 relative overflow-hidden group border-b-red-500/30">
                                  <p className="text-[10px] text-white/30 uppercase font-black tracking-widest mb-4">Empty / Blocked</p>
                                  <p className="text-5xl font-light text-red-400">
                                    {Object.values(dataHealth.counts).filter((c: any) => c === 0).length}
                                  </p>
                                  <div className="mt-6 flex items-start gap-2 text-[10px] text-red-400/60 leading-tight">
                                    <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                                    Zero rows found OR access blocked by Supabase RLS policies.
                                  </div>
                                </div>
                                <div className="p-6 bg-white/5 rounded-[32px] border border-white/5 relative overflow-hidden group border-b-yellow-500/30">
                                  <p className="text-[10px] text-white/30 uppercase font-black tracking-widest mb-4">Integrity Gaps</p>
                                  <p className="text-5xl font-light text-yellow-500">{dataHealth.todo.length}</p>
                                  <div className="mt-6 flex items-center gap-2 text-[10px] text-yellow-500/60">
                                    <BrainCircuit className="w-3 h-3" />
                                    Knowledge Warnings
                                  </div>
                                </div>
                              </div>

                              <div className="p-8 bg-white/5 rounded-[40px] border border-white/5">
                                <div className="flex items-center justify-between mb-8">
                                  <h4 className="text-lg font-light flex items-center gap-3">
                                    Schema Density Map
                                    <Info className="w-4 h-4 text-white/20" />
                                  </h4>
                                  <button
                                    onClick={runDatabaseMonitor}
                                    disabled={isScanning}
                                    className="px-6 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full text-[10px] uppercase font-black tracking-widest transition-all"
                                  >
                                    Refresh Visuals
                                  </button>
                                </div>
                                
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                                  {SCHEMA_TABLES.map(table => (
                                    <div key={table} className="p-4 bg-black/30 rounded-2xl border border-white/5 hover:border-white/20 transition-all cursor-default group">
                                      <p className="text-[9px] text-white/30 font-mono mb-2 truncate group-hover:text-white/60 transition-colors">{table}</p>
                                      <div className="flex items-end gap-2">
                                        <span className="text-xl font-medium">
                                          {dataHealth.missingTables?.includes(table) ? 'Missing' : (dataHealth.counts[table] || 0)}
                                        </span>
                                        <span className="text-[9px] text-white/20 mb-1">
                                          {dataHealth.missingTables?.includes(table) ? 'migration' : 'items'}
                                        </span>
                                      </div>
                                      <div className="mt-3 w-full h-[3px] bg-white/5 rounded-full overflow-hidden">
                                        <div 
                                          className={`h-full transition-all duration-1000 ${
                                            dataHealth.missingTables?.includes(table)
                                              ? 'bg-amber-500/60'
                                              : (dataHealth.counts[table] || 0) > 0 ? 'bg-[#3ECF8E]' : 'bg-red-500/40'
                                          }`} 
                                          style={{ width: dataHealth.missingTables?.includes(table) ? '45%' : (dataHealth.counts[table] || 0) > 0 ? '100%' : '10%' }}
                                        />
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </>
                          )}
                        </motion.div>
                      )}

                      {activeMonitorTab === 'queue' && (
                        <motion.div 
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="max-w-[1000px] mx-auto space-y-6"
                        >
                          {!dataHealth ? (
                             <div className="p-20 text-center border border-dashed border-white/5 rounded-[40px]">
                               <ListTodo className="w-12 h-12 text-white/5 mx-auto mb-4" />
                               <p className="text-white/30">Connect and Scan in Overview to build the queue.</p>
                             </div>
                          ) : (
                            <div className="space-y-4">
                              <h3 className="text-xl font-light mb-6 flex items-center gap-3">
                                <Sparkles className="w-5 h-5 text-yellow-500" />
                                Knowledge Correction Tasks
                              </h3>
                              {dataHealth.todo.length === 0 ? (
                                <div className="p-20 bg-green-500/5 rounded-[40px] border border-green-500/10 flex flex-col items-center">
                                  <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mb-6">
                                    <Sparkles className="w-8 h-8 text-green-500" />
                                  </div>
                                  <p className="text-lg text-green-400 font-light">Your database is pristine.</p>
                                </div>
                              ) : (
                                <div className="grid gap-4">
                                  {dataHealth.todo.map((item: any) => (
                                    <div key={item.id} className="p-6 bg-white/5 border border-white/5 rounded-3xl hover:border-white/10 transition-all flex items-center justify-between group">
                                      <div className="flex gap-5">
                                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${
                                          item.severity === 'high' ? 'bg-red-500/10 text-red-500' : 'bg-yellow-500/10 text-yellow-500'
                                        }`}>
                                          <AlertCircle className="w-6 h-6" />
                                        </div>
                                        <div>
                                          <p className="text-lg text-white/90 font-light">{item.task}</p>
                                          <p className="text-sm text-white/40 mt-1">{item.context?.info || 'Data link detected as missing or broken.'}</p>
                                          <div className="flex gap-3 mt-4">
                                             <span className="px-2 py-0.5 bg-white/5 rounded text-[9px] uppercase tracking-widest text-white/30 border border-white/5 font-black">
                                               Type: {item.context?.type || 'schema'}
                                             </span>
                                             <span className={`px-2 py-0.5 rounded text-[9px] uppercase tracking-widest font-black ${
                                               item.severity === 'high' ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'bg-yellow-500/10 text-yellow-500 border border-yellow-500/20'
                                             }`}>
                                               Priority: {item.severity}
                                             </span>
                                          </div>
                                        </div>
                                      </div>
                                      <button 
                                        onClick={() => {
                                          setActiveTask(item);
                                          setActiveMainTab('processing');
                                        }}
                                        className="px-6 py-3 bg-[var(--color-accent)] text-black rounded-xl font-bold uppercase text-[10px] tracking-widest hover:scale-105 transition-all opacity-0 group-hover:opacity-100 shadow-xl shadow-[var(--color-accent-dim)]"
                                      >
                                        Auto-Fix
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </motion.div>
                      )}

                      {activeMonitorTab === 'explorer' && (
                        <motion.div 
                          initial={{ opacity: 0, scale: 0.98 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="bg-white/5 rounded-[40px] border border-white/5 overflow-hidden flex flex-col h-[700px]"
                        >
                          <div className="p-8 border-b border-white/5 flex flex-col md:flex-row md:items-center justify-between gap-6 bg-black/20">
                            <div>
                              <h3 className="text-xl font-light mb-1">Knowledge Explorer</h3>
                              <p className="text-white/30 text-xs tracking-wider uppercase font-bold">Direct Raw Data Access</p>
                            </div>
                            
                            <div className="flex items-center gap-4">
                              <div className="relative">
                                <select
                                  value={explorerTable}
                                  onChange={(e) => { setExplorerTable(e.target.value); fetchExplorerData(e.target.value); }}
                                  className="bg-black/40 border border-white/10 text-sm px-6 py-3 rounded-xl focus:outline-none focus:border-[#3ECF8E] appearance-none cursor-pointer pr-12 text-white/80 font-medium"
                                >
                                  {SCHEMA_TABLES.map(t => (
                                    <option key={t} value={t} className="bg-[#0a0a0a]">{t}</option>
                                  ))}
                                </select>
                                <Database className="absolute right-4 top-3.5 w-4 h-4 text-white/20 pointer-events-none" />
                              </div>
                              <div className="flex bg-black/40 p-1.5 rounded-2xl border border-white/5">
                                <button
                                  onClick={() => runGapAnalysis(explorerTable)}
                                  className="px-4 py-2 bg-white/5 hover:bg-[#3ECF8E]/20 text-[#3ECF8E] border border-transparent hover:border-[#3ECF8E]/40 rounded-xl transition-all flex items-center gap-2 text-[10px] tracking-widest font-bold uppercase"
                                  title="Analyze Data Gaps"
                                >
                                  <PieChart className="w-4 h-4 mr-1" /> Completeness
                                </button>
                                <button
                                  onClick={() => fetchExplorerData(explorerTable)}
                                  className="p-2.5 ml-1 bg-transparent hover:bg-white/10 text-white/60 hover:text-white rounded-xl transition-all"
                                  title="Refresh Data"
                                >
                                  <Search className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          </div>

                          <div className="flex-1 overflow-auto custom-scrollbar p-1">
                            {isFetchingExplorerData ? (
                              <div className="flex flex-col items-center justify-center h-full gap-4">
                                <div className="w-12 h-12 border-4 border-[#3ECF8E] border-t-transparent rounded-full animate-spin shadow-xl shadow-[#3ECF8E]/20"></div>
                                <p className="text-white/30 text-[10px] uppercase font-black tracking-[4px]">Fetching Nodes...</p>
                              </div>
                            ) : supabaseExplorerData.length === 0 ? (
                                <div 
                                  onClick={() => {
                                    if (!missingSchemaTables.includes(explorerTable)) {
                                      setShowTaskModal(explorerTable);
                                    }
                                  }}
                                  className={`flex flex-col items-center justify-center h-full gap-5 rounded-3xl m-8 transition-all ${
                                    missingSchemaTables.includes(explorerTable)
                                      ? 'border border-amber-500/20 bg-amber-500/[0.03]'
                                      : 'border border-transparent hover:border-[#3ECF8E]/20 bg-transparent hover:bg-white/[0.02] cursor-pointer group'
                                  }`}
                                >
                                  <div className={`w-20 h-20 rounded-full flex items-center justify-center transition-colors ${
                                    missingSchemaTables.includes(explorerTable)
                                      ? 'bg-amber-500/10'
                                      : 'bg-white/5 group-hover:bg-[#3ECF8E]/10'
                                  }`}>
                                    <Database className={`w-10 h-10 transition-colors ${
                                      missingSchemaTables.includes(explorerTable)
                                        ? 'text-amber-300'
                                        : 'group-hover:text-[#3ECF8E] text-white/30'
                                    }`} />
                                  </div>
                                  <div className="text-center px-4">
                                    {missingSchemaTables.includes(explorerTable) ? (
                                      <>
                                        <p className="text-xl font-light text-amber-200 mb-2">Table missing for <span className="font-mono text-amber-300">{explorerTable}</span></p>
                                        <p className="text-xs text-white/40 max-w-md mx-auto leading-relaxed">This table has not been created in your Supabase project yet. Run <span className="font-mono">migrations/006_rag_chunk_repair_validation.sql</span> in Supabase SQL Editor, then refresh.</p>
                                      </>
                                    ) : (
                                      <>
                                        <p className="text-xl font-light text-white/60 mb-2">No records found for <span className="font-mono text-[#3ECF8E]">{explorerTable}</span></p>
                                        <p className="text-xs text-white/40 max-w-md mx-auto leading-relaxed">This entity is completely empty. Click here to open the Action Guide and plan your automated data extraction strategy.</p>
                                      </>
                                    )}
                                  </div>
                                  {missingSchemaTables.includes(explorerTable) ? (
                                    <div className="mt-2 flex items-center gap-2 px-6 py-2.5 bg-amber-500/10 rounded-xl border border-amber-500/20 text-[10px] uppercase font-bold tracking-widest text-amber-300">
                                      <AlertCircle className="w-4 h-4" /> Run Migration 006
                                    </div>
                                  ) : (
                                    <div className="mt-2 flex items-center gap-2 px-6 py-2.5 bg-white/5 rounded-xl border border-white/5 text-[10px] uppercase font-bold tracking-widest text-[#3ECF8E] group-hover:bg-[#3ECF8E] group-hover:text-black transition-all">
                                      <ListTodo className="w-4 h-4" /> Plan Extraction
                                    </div>
                                  )}
                                </div>
                              ) : (
                              <table className="w-full text-left border-separate border-spacing-0">
                                <thead className="sticky top-0 bg-black/80 backdrop-blur-md z-10 border-b border-white/10">
                                  <tr>
                                    {Object.keys(supabaseExplorerData[0] || {}).map((key) => (
                                      <th key={key} className="px-6 py-4 text-[9px] uppercase tracking-widest font-black text-white/40 border-b border-white/5">
                                        {key}
                                      </th>
                                    ))}
                                    <th className="px-6 py-4 text-[9px] uppercase tracking-widest font-black text-white/40 border-b border-white/5 text-right pr-10">Actions</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-white/[0.03]">
                                  {supabaseExplorerData.map((row, i) => (
                                    <tr key={i} className="hover:bg-white/[0.03] transition-all group">
                                      {Object.values(row).map((val: any, j) => (
                                        <td key={j} className="px-6 py-4 text-[11px] text-white/60 max-w-[250px] truncate leading-relaxed" title={String(val)}>
                                          {typeof val === 'object' && val !== null ? 
                                            <span className="text-[10px] font-mono text-purple-400 opacity-80">{JSON.stringify(val)}</span> : 
                                            String(val)
                                          }
                                        </td>
                                      ))}
                                      <td className="px-6 py-4 text-right pr-10">
                                        <button 
                                          onClick={() => deleteExplorerRow(row.id || Object.values(row)[0])}
                                          className="p-2.5 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white transition-all scale-90 hover:scale-100 opacity-60 group-hover:opacity-100"
                                          title="Delete Row"
                                        >
                                          <Trash2 className="w-4 h-4" />
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        </motion.div>
                      )}

                      {activeMonitorTab === 'planner' && (
                        <motion.div 
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="space-y-6"
                        >
                          <div className="bg-white/5 rounded-[40px] border border-white/5 p-8">
                            <h3 className="text-2xl font-light mb-2 flex items-center gap-3">
                              <GraduationCap className="w-8 h-8 text-[#3ECF8E]" />
                              Curriculum Planner
                            </h3>
                            <p className="text-white/40 text-sm mb-8">Select a grade to generate a precise step-by-step hydration blueprint across subjects, topics, and exercises.</p>
                            
                            <div className="flex flex-col md:flex-row gap-4 mb-10">
                              <div className="relative flex-1 max-w-md">
                                <select
                                  value={selectedPlannerGrade}
                                  onChange={(e) => {
                                    setSelectedPlannerGrade(e.target.value);
                                    if(e.target.value) generatePlannerTasks(e.target.value);
                                  }}
                                  className="w-full bg-black/40 border border-white/10 text-sm px-6 py-4 rounded-2xl focus:outline-none focus:border-[#3ECF8E] appearance-none cursor-pointer pr-12 text-white/80 font-medium"
                                >
                                  <option value="">-- Select Target Grade --</option>
                                  {plannerHierarchies.map(h => (
                                    <option key={h.id} value={h.id} className="bg-[#0a0a0a]">
                                      {h.cycles?.curricula?.name} / {h.cycles?.name} / {h.name}
                                    </option>
                                  ))}
                                </select>
                                <ChevronRight className="absolute right-6 top-4 w-5 h-5 text-white/20 pointer-events-none rotate-90" />
                              </div>
                            </div>

                            {/* Planner Tasks */}
                            {isFetchingPlannerTasks ? (
                              <div className="py-20 flex flex-col items-center justify-center gap-4">
                                <div className="w-12 h-12 border-4 border-[#3ECF8E] border-t-transparent rounded-full animate-spin"></div>
                                <p className="text-[#3ECF8E] text-[10px] tracking-widest uppercase font-black">Analyzing Dependencies...</p>
                              </div>
                            ) : plannerTasks && plannerTasks.length > 0 ? (
                              <div className="space-y-4">
                                {plannerTasks.map((t, idx) => {
                                  const isCompleted = t.status === 'completed';
                                  const isLocked = t.status === 'locked';
                                  const isActionable = t.status === 'actionable';

                                  return (
                                    <div key={idx} className={`p-6 rounded-3xl border flex flex-col gap-4 transition-all 
                                      ${isCompleted ? 'bg-green-500/5 border-green-500/20' : 
                                        isLocked ? 'bg-black/20 border-white/5 opacity-60' : 
                                        'bg-white/5 border-white/20 shadow-[0_0_20px_rgba(62,207,142,0.05)]'}`}>
                                      <div className="flex items-start gap-4">
                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-sm shrink-0 shadow-lg 
                                          ${isCompleted ? 'bg-green-500/20 text-green-500 border border-green-500/30' : 
                                            isLocked ? 'bg-white/5 text-white/20 border border-white/5' : 
                                            'bg-[#3ECF8E]/20 text-[#3ECF8E] border border-[#3ECF8E]/30'}`}>
                                          {isCompleted ? <CheckCircle2 className="w-4 h-4" /> : isLocked ? <Lock className="w-3.5 h-3.5" /> : t.step}
                                        </div>
                                        <div className="flex-1">
                                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                                            <h4 className={`text-lg font-medium ${isCompleted ? 'text-green-500/80 line-through decoration-green-500/30' : isLocked ? 'text-white/40' : 'text-white/90'}`}>
                                              {t.title}
                                            </h4>
                                            {t.metrics && (
                                              <span className={`text-[9px] uppercase tracking-widest font-black px-2.5 py-1 rounded-md border text-center
                                                ${isCompleted ? 'text-green-500/80 border-green-500/20 bg-green-500/10' : isLocked ? 'text-white/30 border-white/10' : 'text-[#3ECF8E] border-[#3ECF8E]/20 bg-[#3ECF8E]/10'}`}>
                                                {t.metrics}
                                              </span>
                                            )}
                                          </div>
                                          <p className={`text-sm leading-relaxed ${isActionable ? 'text-white/70' : 'text-white/40'}`}>{t.description}</p>
                                        </div>
                                      </div>
                                      {isActionable && t.prompt && (
                                        <div className="ml-12 flex items-center gap-3">
                                          <div className="flex-1 bg-black/40 border border-white/5 px-4 py-3 rounded-xl text-xs font-mono text-white/40 truncate select-all">
                                            {t.prompt}
                                          </div>
                                          <button 
                                            onClick={() => navigator.clipboard.writeText(t.prompt)}
                                            className="p-3 bg-[#3ECF8E]/10 text-[#3ECF8E] hover:bg-[#3ECF8E] hover:text-black rounded-xl transition-all shadow-lg shrink-0"
                                            title="Copy AI Prompt"
                                          >
                                            <Copy className="w-4 h-4" />
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  )
                                })}
                              </div>
                            ) : selectedPlannerGrade && (
                              <div className="py-20 text-center text-white/40">No plan available for this configuration.</div>
                            )}

                          </div>
                        </motion.div>
                      )}
                    </div>
                  </>
                )}

              </motion.div>
            )}

            {activeMainTab === 'taskcenter' && (
              <motion.div
                key="taskcenter"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="max-w-[1500px] mx-auto pb-12"
              >
                <TaskCenter
                  supabaseUrl={supabaseUrl}
                  supabaseKey={supabaseKey}
                  isSupabaseEnabled={isSupabaseEnabled}
                />
              </motion.div>
            )}

            {activeMainTab === 'chunkreview' && (
              <motion.div
                key="chunkreview"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="max-w-[1500px] mx-auto pb-12"
              >
                <RagRepairAdmin
                  view="chunk-review"
                  onNavigate={(nextView) => navigateMainTab(nextView === 'chunk-review' ? 'chunkreview' : 'extractionjobs')}
                />
              </motion.div>
            )}

            {activeMainTab === 'extractionjobs' && (
              <motion.div
                key="extractionjobs"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="max-w-[1500px] mx-auto pb-12"
              >
                <RagRepairAdmin
                  view="extraction-jobs"
                  onNavigate={(nextView) => navigateMainTab(nextView === 'chunk-review' ? 'chunkreview' : 'extractionjobs')}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {/* Footer info fixed center or similar */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-[9px] text-white/20 uppercase tracking-[3px] pointer-events-none z-0">
          Processed Locally â€¢ End-to-End Encryption
        </div>

        {/* Data Extraction Task Modal */}
        <AnimatePresence>
          {showTaskModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-[#0f0f0f] border border-[#3ECF8E]/20 rounded-[32px] p-6 lg:p-10 w-full max-w-xl shadow-2xl relative max-h-[85vh] flex flex-col"
              >
                <button 
                  onClick={() => setShowTaskModal(null)}
                  className="absolute top-6 right-6 text-white/40 hover:text-white transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
                
                <div className="mb-8">
                  <h2 className="text-3xl font-light mb-2 flex items-center gap-3">
                    <ListTodo className="w-8 h-8 text-[#3ECF8E]" />
                    Data Gap Analysis
                  </h2>
                  <p className="text-white/40 text-sm">Automated completeness check and workflow generator for <strong className="text-[#3ECF8E] font-mono font-medium">{showTaskModal}</strong></p>
                </div>
                
                <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-6">
                  {isAnalyzing ? (
                    <div className="flex flex-col items-center justify-center py-16 gap-6">
                      <div className="w-16 h-16 border-4 border-[#3ECF8E] border-t-transparent rounded-full animate-spin"></div>
                      <p className="text-[10px] uppercase font-black tracking-widest text-[#3ECF8E]">Analyzing relational data gaps...</p>
                    </div>
                  ) : gapAnalysis ? (
                    <div className="space-y-8">
                      {/* Score Bar */}
                      <div className="bg-white/5 p-6 rounded-2xl border border-white/5">
                        <div className="flex justify-between items-end mb-3">
                          <span className="text-white/60 text-[10px] uppercase tracking-widest font-bold">Completeness Score</span>
                          <span className="text-4xl font-light text-[#3ECF8E]">{gapAnalysis.score}%</span>
                        </div>
                        <div className="w-full h-3 bg-black/50 rounded-full overflow-hidden shadow-inner">
                          <div className="h-full bg-[#3ECF8E] transition-all duration-1000" style={{width: `${gapAnalysis.score}%`}}></div>
                        </div>
                      </div>

                      {/* To Do Items */}
                      <div className="space-y-4">
                        <h4 className="text-[11px] font-black text-white/80 uppercase tracking-widest flex items-center gap-2 mb-6">
                          <CheckSquare className="w-4 h-4 text-[#3ECF8E]" /> Actionable Missing Data
                        </h4>
                        
                        {gapAnalysis.missing.map((item, idx) => (
                          <div key={idx} className="p-5 bg-white/[0.02] border border-white/5 rounded-2xl hover:border-white/10 transition-all flex flex-col gap-4 group hover:bg-white/[0.04]">
                              <div className="flex justify-between items-start gap-4">
                                <div className="flex items-start gap-3">
                                  <div className={`mt-0.5 w-4 h-4 rounded shadow shrink-0 ${item.type === 'high' ? 'bg-red-500/20 border border-red-500/50' : 'bg-yellow-500/20 border border-yellow-500/50'}`}></div>
                                  <p className="text-sm text-white/90 leading-relaxed font-medium">{item.title}</p>
                                </div>
                                <span className={`text-[9px] uppercase tracking-widest px-2 py-0.5 rounded font-black shrink-0 ${item.type === 'high' ? 'text-red-400 bg-red-400/10 border border-red-400/20' : 'text-yellow-400 bg-yellow-400/10 border border-yellow-400/20'}`}>
                                  {item.type} Priority
                                </span>
                              </div>
                              <div className="ml-7 flex items-center gap-3">
                                <div className="flex-1 bg-black/40 border border-white/5 px-4 py-3 rounded-xl text-xs font-mono text-white/40 truncate select-all">
                                  {item.prompt}
                                </div>
                                <button 
                                  onClick={() => navigator.clipboard.writeText(item.prompt)}
                                  className="p-3 bg-[#3ECF8E]/10 text-[#3ECF8E] hover:bg-[#3ECF8E] hover:text-black rounded-xl transition-all shadow-lg"
                                  title="Copy AI Prompt"
                                >
                                  <Copy className="w-4 h-4" />
                                </button>
                              </div>
                          </div>
                        ))}
                        
                        {gapAnalysis.missing.length === 0 && (
                          <div className="text-center p-8 bg-green-500/5 border border-green-500/20 rounded-2xl flex flex-col items-center">
                            <Sparkles className="w-8 h-8 text-green-400 mb-4" />
                            <p className="text-green-400 font-medium">Everything looks perfect!</p>
                            <p className="text-green-400/60 text-xs mt-1">No relational gaps found in this check.</p>
                          </div>
                        )}
                      </div>
                      
                      <div className="mt-8 p-4 rounded-2xl border border-blue-500/20 bg-blue-500/5 flex items-start gap-4">
                        <Lightbulb className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
                        <div>
                          <p className="text-xs text-blue-200/80 leading-relaxed font-medium">Tip: Click the green copy button next to an action item to copy an optimized prompt. Paste this prompt directly into Gemini or ChatGPT to instantly generate the exact JSON data needed for hydration.</p>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
                
                <div className="mt-6 flex justify-end">
                   <button 
                     onClick={() => setShowTaskModal(null)}
                     className="px-6 py-3 bg-[#3ECF8E] text-black font-bold uppercase text-[10px] tracking-widest rounded-xl hover:scale-105 transition-transform"
                   >
                     Acknowledge Action Plan
                   </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Master Guide Modal */}
        <AnimatePresence>
          {showGuideModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-[#0f0f0f] border border-white/10 rounded-[32px] p-6 lg:p-10 w-full max-w-2xl shadow-2xl relative max-h-[85vh] flex flex-col"
              >
                <button 
                  onClick={() => setShowGuideModal(false)}
                  className="absolute top-6 right-6 text-white/40 hover:text-white transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
                
                <div className="mb-8">
                  <h2 className="text-3xl font-light mb-2 flex items-center gap-3">
                    <MapIcon className="w-8 h-8 text-[var(--color-accent)]" />
                    Architecture Blueprint
                  </h2>
                  <p className="text-white/40 text-sm">Follow this initialization tree to establish your Curriculum RAG Platform.</p>
                </div>
                
                <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-8">
                  
                  {/* Phase 1 */}
                  <div className="relative">
                    <div className="flex items-center gap-3 mb-4">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${!!supabaseUrl ? 'bg-[#3ECF8E]/20 text-[#3ECF8E]' : 'bg-white/10 text-white/40'}`}>
                        {!!supabaseUrl ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
                      </div>
                      <h3 className="tracking-widest font-black uppercase text-[11px] text-white/60">Phase 1: Environment Link</h3>
                    </div>
                    <div className="border-l border-white/10 ml-3 pl-6 space-y-6 pb-2">
                      <div className="relative">
                        <div className="absolute -left-[29px] top-1.5 w-2 h-2 rounded-full border border-white/20 bg-black"></div>
                        <p className="text-sm font-medium mb-1 flex items-center gap-2">
                          Establish Cloud Link
                          {!!supabaseUrl && <span className="text-[9px] px-2 py-0.5 bg-[#3ECF8E]/10 text-[#3ECF8E] rounded border border-[#3ECF8E]/20 uppercase font-black tracking-widest">Done</span>}
                        </p>
                        <p className="text-xs text-white/40 flex items-start gap-1.5 leading-relaxed">
                          <Lightbulb className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[var(--color-accent)]" />
                          <span>Input your Supabase URL & Anon Key in the <b>Config / API</b> tab. This connects the app directly to your 29 curriculum tables.</span>
                        </p>
                      </div>
                      <div className="relative">
                        <div className="absolute -left-[29px] top-1.5 w-2 h-2 rounded-full border border-white/20 bg-black"></div>
                        <p className="text-sm font-medium mb-1 flex items-center gap-2">
                          Resolve RLS Policies
                          {dataHealth && Object.keys(dataHealth.errors || {}).length === 0 && <span className="text-[9px] px-2 py-0.5 bg-[#3ECF8E]/10 text-[#3ECF8E] rounded border border-[#3ECF8E]/20 uppercase font-black tracking-widest">Done</span>}
                        </p>
                        <p className="text-xs text-white/40 flex items-start gap-1.5 leading-relaxed">
                          <Lightbulb className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[var(--color-accent)]" />
                          <span>In your Supabase Dashboard, ensure Row-Level Security (RLS) policies allow <b>SELECT</b> and <b>INSERT</b> so data is fully visible to the system.</span>
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Phase 2 */}
                  <div className="relative">
                    <div className="flex items-center gap-3 mb-4">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${dataHealth && dataHealth?.todo?.length === 0 ? 'bg-[#3ECF8E]/20 text-[#3ECF8E]' : 'bg-white/10 text-white/40'}`}>
                        {dataHealth && dataHealth?.todo?.length === 0 ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
                      </div>
                      <h3 className="tracking-widest font-black uppercase text-[11px] text-white/60">Phase 2: Database Foundation</h3>
                    </div>
                    <div className="border-l border-white/10 ml-3 pl-6 space-y-6 pb-2">
                      <div className="relative">
                        <div className="absolute -left-[29px] top-1.5 w-2 h-2 rounded-full border border-white/20 bg-black"></div>
                        <p className="text-sm font-medium mb-1 flex items-center gap-2">
                          Execute Deep Scan
                          {!!dataHealth && <span className="text-[9px] px-2 py-0.5 bg-[#3ECF8E]/10 text-[#3ECF8E] rounded border border-[#3ECF8E]/20 uppercase font-black tracking-widest">Done</span>}
                        </p>
                        <p className="text-xs text-white/40 flex items-start gap-1.5 leading-relaxed">
                          <Lightbulb className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[var(--color-accent)]" />
                          <span>Head to the <b>Database Hub</b> tab and run a deep scan to generate your schema density map and uncover gaps.</span>
                        </p>
                      </div>
                      <div className="relative">
                        <div className="absolute -left-[29px] top-1.5 w-2 h-2 rounded-full border border-white/20 bg-black"></div>
                        <p className="text-sm font-medium mb-1 flex items-center gap-2">
                          Purge Health Queue
                          {dataHealth?.todo?.length === 0 && <span className="text-[9px] px-2 py-0.5 bg-[#3ECF8E]/10 text-[#3ECF8E] rounded border border-[#3ECF8E]/20 uppercase font-black tracking-widest">Done</span>}
                        </p>
                        <p className="text-xs text-white/40 flex items-start gap-1.5 leading-relaxed">
                          <Lightbulb className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[var(--color-accent)]" />
                          <span>Check the <b>Health Queue</b> inside the Database Hub. Use the automated "Take Action" buttons to fix missing tracks, sections, or vectors.</span>
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Phase 3 */}
                  <div className="relative">
                    <div className="flex items-center gap-3 mb-4">
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${files.length > 0 && pipelineLogs.join('').includes('Pipeline complete') ? 'bg-[#3ECF8E]/20 text-[#3ECF8E]' : 'bg-white/10 text-white/40'}`}>
                         {files.length > 0 && pipelineLogs.join('').includes('Pipeline complete') ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
                      </div>
                      <h3 className="tracking-widest font-black uppercase text-[11px] text-white/60">Phase 3: Deep Knowledge Pipeline</h3>
                    </div>
                    <div className="ml-3 pl-6 space-y-6">
                      <div className="relative">
                        <div className="absolute -left-[29px] top-1.5 w-2 h-2 rounded-full border border-white/20 bg-black"></div>
                        <p className="text-sm font-medium mb-1 flex items-center gap-2">
                          Stage Documents
                          {files.length > 0 && <span className="text-[9px] px-2 py-0.5 bg-[#3ECF8E]/10 text-[#3ECF8E] rounded border border-[#3ECF8E]/20 uppercase font-black tracking-widest">Done</span>}
                        </p>
                        <p className="text-xs text-white/40 flex items-start gap-1.5 leading-relaxed">
                          <Lightbulb className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[var(--color-accent)]" />
                          <span>Drag and Drop PDF files (<b>.pdf</b>) into the <b>Upload Zone</b> on the Pipeline tab. The system will automatically extract, classify, and stage them for RAG ingestion.</span>
                        </p>
                      </div>
                    </div>
                  </div>

                </div>

                <div className="mt-6 flex justify-end">
                  <button
                    onClick={() => setShowGuideModal(false)}
                    className="px-6 py-3 bg-[var(--color-accent)] text-black font-bold uppercase text-[10px] tracking-widest rounded-xl hover:scale-105 transition-transform"
                  >
                    Got It
                  </button>
                </div>
              </motion.div>
          </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

