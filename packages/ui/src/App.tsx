import { lazy } from 'react';
const Testbed = lazy(() => import('./Testbed').then(module => ({ default: module.Testbed })));
const EmojiPlayground = lazy(() => import('./EmojiPlayground'));
const BillionAtomsPage = lazy(() => import('./BillionAtomsPage'));
import { ViewerApp } from './ViewerApp';
import { isBillionAtomsRoute, isEmojiRoute, isTestbedRoute } from './viewer/viewerRoutes';

export { xrStore } from './viewer/xrStore';

/** Hook-free route switch. Hook-bearing viewer behavior lives in ViewerApp. */
export default function App() {
  if (typeof window !== 'undefined' && isTestbedRoute()) return <Testbed />;
  if (typeof window !== 'undefined' && isEmojiRoute()) return <EmojiPlayground />;
  if (typeof window !== 'undefined' && isBillionAtomsRoute()) return <BillionAtomsPage />;
  // Science routes (`#/science/<index>`, legacy `?demo=science-panel`) are
  // first-class viewer routes: ViewerApp loads the bound Z1 trajectory and
  // opens the SCIENCE deck section instead of a standalone page.
  return <ViewerApp />;
}
