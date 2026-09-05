import { useEffect } from 'react';
import { useStore } from '../store';
import { resolveEffects } from '../postprocess/controls';

/** Sync legacy postprocess fields so older surfaces remain coherent while the
 *  renderer reads the authored preset as the source of truth. */
export function PresetLegacyBridge() {
  const presetId = useStore(s => s.postprocessPreset);
  const overrides = useStore(s => s.effectOverrides);
  useEffect(() => {
    const preset = resolveEffects(presetId, overrides);
    if (!preset) return;
    useStore.setState({
      ssao: preset.ssao.enabled,
      bloom: preset.bloom.enabled,
      dof: preset.dof.enabled,
      autoDepthOfField: preset.dof.auto,
      toneMapping: preset.toneMapping,
    });
  }, [presetId, overrides]);
  return null;
}
