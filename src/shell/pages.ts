import { ChartColumn, Database, FilePlus, Folder, History, Landmark, LayoutDashboard, SlidersHorizontal, Truck, Wallet, type LucideIcon } from 'lucide-react';
import type { PageId } from '../logic/sidebar';

export type { PageId };

export const pageIcons: Record<PageId, LucideIcon> = {
  dashboard: LayoutDashboard,
  lrEntry: FilePlus,
  loadingMemo: Truck,
  savedMemos: Folder,
  wasuli: Wallet,
  firmAccounts: Landmark,
  reports: ChartColumn,
  masters: Database,
  history: History,
  settings: SlidersHorizontal,
};
