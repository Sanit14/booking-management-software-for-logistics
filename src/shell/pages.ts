import { ChartColumn, Database, FilePlus, History, Landmark, LayoutDashboard, SlidersHorizontal, Truck, Wallet, type LucideIcon } from 'lucide-react';

export type PageId = 'dashboard' | 'lrEntry' | 'loadingMemo' | 'firmAccounts' | 'wasuli' | 'reports' | 'history' | 'masters' | 'settings';

export const mainPages: PageId[] = ['dashboard', 'lrEntry', 'loadingMemo'];
export const adminPages: PageId[] = ['firmAccounts', 'wasuli', 'reports', 'history', 'masters', 'settings'];

export const pageIcons: Record<PageId, LucideIcon> = {
  dashboard: LayoutDashboard,
  lrEntry: FilePlus,
  loadingMemo: Truck,
  firmAccounts: Landmark,
  wasuli: Wallet,
  reports: ChartColumn,
  history: History,
  masters: Database,
  settings: SlidersHorizontal,
};
