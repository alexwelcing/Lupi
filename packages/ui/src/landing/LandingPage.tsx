import { HeroSection } from './HeroSection';
import { LandingProofSection } from './LandingProofSection';
import { FeaturedShowcase } from './FeaturedShowcase';
import { DropZoneSection } from './DropZoneSection';
import { GallerySection } from './GallerySection';
import { LandingFooter } from './LandingFooter';
import { WorldHomeBackground } from './WorldHomeBackground';
import { ANIMATION_CSS } from './shared';
import { HOME_SEO, useSeo } from '../seo';

export function LandingPage() {
  useSeo(HOME_SEO);

  return (
    <>
      <style>{ANIMATION_CSS}</style>
      <div className="lupi-world-home" data-testid="world-gallery-home">
        <WorldHomeBackground />
        <div className="lupi-world-home-content">
          <HeroSection />
          <LandingProofSection />
          <FeaturedShowcase />
          <DropZoneSection />
          <GallerySection />
          <LandingFooter />
        </div>
      </div>
    </>
  );
}
