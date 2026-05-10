export type MainTab =
  | 'dashboard'
  | 'processing'
  | 'settings'
  | 'database'
  | 'taskcenter'
  | 'chunkreview'
  | 'extractionjobs';

export const routeToMainTab = (pathname: string): MainTab | null => {
  if (pathname === '/admin/chunk-review') return 'chunkreview';
  if (pathname === '/admin/extraction-jobs') return 'extractionjobs';
  return null;
};

export const mainTabToPath = (tab: MainTab): string => {
  if (tab === 'chunkreview') return '/admin/chunk-review';
  if (tab === 'extractionjobs') return '/admin/extraction-jobs';
  return '/';
};
