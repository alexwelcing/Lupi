import { Suspense, lazy } from 'react';
import { Testbed } from './Testbed';
import EmojiPlayground from './EmojiPlayground';
import BillionAtomsPage from './BillionAtomsPage';
import { ViewerApp } from './ViewerApp';
import {
  isBillionAtomsRoute,
  isEmojiRoute,
  isScienceDemoRoute,
  isTestbedRoute,
} from './viewer/viewerRoutes';

export { xrStore } from './viewer/xrStore';

/**
 * The science-panel demo (panel + Z1 fixture) is code-split: the production
 * viewer bundle never pays for it and loads it only on the demo route.
 */
const SciencePanelDemo = lazy(() => import('./science/SciencePanelDemo'));

/** Hook-free route switch. Hook-bearing viewer behavior lives in ViewerApp. */
export default function App() {
  if (typeof window !== 'undefined' && isTestbedRoute()) return <Testbed />;
  if (typeof window !== 'undefined' && isEmojiRoute()) return <EmojiPlayground />;
  if (typeof window !== 'undefined' && isBillionAtomsRoute()) return <BillionAtomsPage />;
  if (typeof window !== 'undefined' && isScienceDemoRoute()) {
    return (
      <Suspense fallback={<div style={{ minHeight: '100vh', background: '#e9e7e0' }} />}>
        <SciencePanelDemo />
      </Suspense>
    );
  }
  return <ViewerApp />;
}
