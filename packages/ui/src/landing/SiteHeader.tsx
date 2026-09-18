import { LupiAgentDock } from '../LupiAgentDock';

export type SiteSection = 'home' | 'library';

/**
 * One header for the landing page and the Library. Section anchors point at
 * the homepage so they work from any path; the Library link is a real route.
 */
export function SiteHeader({ current }: { current: SiteSection }) {
  const home = current === 'home' ? '' : '/';
  return (
    <header className="student-header student-width">
      <a className="student-wordmark" href="/" aria-label="Lupi home">
        Lupi<span>See what things are made of.</span>
      </a>
      <nav aria-label="Primary">
        <a href={`${home}#molecules`}>Molecules</a>
        <a href="/library" aria-current={current === 'library' ? 'page' : undefined}>
          Library
        </a>
        <a href={`${home}#learn`}>How to use</a>
        <a href={`${home}#dropzone`}>Open a file</a>
      </nav>
      <LupiAgentDock />
    </header>
  );
}
