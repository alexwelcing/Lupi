/**
 * Entry of Lupi Daily (/daily/, /daily/<date>, /daily/text), a separate Vite
 * input (daily.html). scripts/generate-daily-pages.mts fills the built
 * template once per page; this script plays the day's puzzle. No React, no
 * three.
 */
import '@atlas/ui/moleculePage/page.css';
import '@atlas/ui/daily/daily.css';
import { mountDailyPage } from '@atlas/ui/daily/page';

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountDailyPage, { once: true });
} else {
  mountDailyPage();
}
