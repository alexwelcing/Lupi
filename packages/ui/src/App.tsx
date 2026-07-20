import { Testbed } from './Testbed';
import EmojiPlayground from './EmojiPlayground';
import BillionAtomsPage from './BillionAtomsPage';
import { ViewerApp } from './ViewerApp';
import {
  isBillionAtomsRoute,
  isEmojiRoute,
  isTestbedRoute,
} from './viewer/viewerRoutes';

export { xrStore } from './viewer/xrStore';

/** Hook-free route switch. Hook-bearing viewer behavior lives in ViewerApp. */
export default function App() {
  if (typeof window !== 'undefined' && isTestbedRoute()) return <Testbed />;
  if (typeof window !== 'undefined' && isEmojiRoute()) return <EmojiPlayground />;
  if (typeof window !== 'undefined' && isBillionAtomsRoute()) return <BillionAtomsPage />;
  return <ViewerApp />;
}
