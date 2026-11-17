import type { ReactNode } from 'react';
import { COMPANY_NAME } from '../../shared';
import { strings } from '../strings';
import { PageHeader } from '../ui/Card';
import type { PageId } from './pages';

/** A page with its teal header. */
export default function Page({ id, children }: { id: PageId; children: ReactNode }) {
  return (
    <>
      <PageHeader title={strings.pages[id]} subtitle={id === 'dashboard' ? COMPANY_NAME : undefined} />
      {children}
    </>
  );
}
