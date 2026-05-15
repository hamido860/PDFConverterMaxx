export type MainTab =
  | 'documents'
  | 'reviewqueue'
  | 'scraper'
  | 'knowledgebase'
  | 'settings'
  | 'publish' // Keep publish for Supabase Publish if needed, or remove later
  | 'raghealth'
  | 'processing' // kept for legacy / transitional
  | 'database'   // kept for legacy / transitional
  | 'taskcenter' // kept for legacy / transitional
  | 'extractionjobs' // kept for legacy / transitional
  | 'chunkreview' // kept for legacy / transitional
  | 'dashboard'; // kept for legacy / transitional

export const routeToMainTab = (pathname: string): MainTab | null => {
  if (pathname === '/documents') return 'documents';
  if (pathname === '/review-queue') return 'reviewqueue';
  if (pathname === '/scraper') return 'scraper';
  if (pathname === '/knowledge-base') return 'knowledgebase';
  if (pathname === '/settings') return 'settings';
  if (pathname === '/admin/publish') return 'publish';
  if (pathname === '/admin/rag-health') return 'raghealth';
  if (pathname === '/') return 'documents';
  return null;
};

export const mainTabToPath = (tab: MainTab): string => {
  if (tab === 'documents') return '/documents';
  if (tab === 'reviewqueue') return '/review-queue';
  if (tab === 'scraper') return '/scraper';
  if (tab === 'knowledgebase') return '/knowledge-base';
  if (tab === 'settings') return '/settings';
  if (tab === 'publish') return '/admin/publish';
  if (tab === 'raghealth') return '/admin/rag-health';
  return '/';
};
