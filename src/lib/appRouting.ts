export type MainTab =
  | 'dashboard'
  | 'scraper'
  | 'extractionjobs'
  | 'chunkreview'
  | 'publish'
  | 'settings';

export const routeToMainTab = (pathname: string): MainTab | null => {
  if (pathname === '/admin/scraper') return 'scraper';
  if (pathname === '/admin/chunk-review') return 'chunkreview';
  if (pathname === '/admin/extraction-jobs') return 'extractionjobs';
  if (pathname === '/admin/publish') return 'publish';
  if (pathname === '/admin/settings') return 'settings';
  if (pathname === '/') return 'dashboard';
  return null;
};

export const mainTabToPath = (tab: MainTab): string => {
  if (tab === 'scraper') return '/admin/scraper';
  if (tab === 'chunkreview') return '/admin/chunk-review';
  if (tab === 'extractionjobs') return '/admin/extraction-jobs';
  if (tab === 'publish') return '/admin/publish';
  if (tab === 'settings') return '/admin/settings';
  return '/';
};
