let supabaseModulePromise: Promise<typeof import('@supabase/supabase-js')> | null = null;
let pdfJsModulePromise: Promise<typeof import('pdfjs-dist')> | null = null;
let googleGenAiModulePromise: Promise<typeof import('@google/genai')> | null = null;

export const loadSupabaseModule = async () => {
  if (!supabaseModulePromise) {
    supabaseModulePromise = import('@supabase/supabase-js');
  }
  return supabaseModulePromise;
};

export const loadPdfJsModule = async () => {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = import('pdfjs-dist').then((module) => {
      module.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${module.version}/build/pdf.worker.min.mjs`;
      return module;
    });
  }
  return pdfJsModulePromise;
};

export const loadGoogleGenAiModule = async () => {
  if (!googleGenAiModulePromise) {
    googleGenAiModulePromise = import('@google/genai');
  }
  return googleGenAiModulePromise;
};
