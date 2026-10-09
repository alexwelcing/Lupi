import { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber/webgpu';
import { Raycaster, Vector2 } from 'three';
import { resolveTypeDisplayRadius } from '@atlas/core';
import type { MoleculeCard } from './toolResult';
import { inspectionPairs, type InspectionTarget } from './inspection';
import { isInspectionTap, pickMolecule } from './pickMolecule';

/** Canvas-local events: hover does not call tools, steal OrbitControls gestures,
 * or share mutable picking state with another card. A tap pins; a drag does not. */
export function InspectionPicker({ card, onHover, onPin }: {
  card: MoleculeCard;
  onHover: (target: InspectionTarget | null) => void;
  onPin: (target: InspectionTarget | null) => void;
}) {
  const get = useThree((state) => state.get);
  const latest = useRef({ onHover, onPin });
  latest.current = { onHover, onPin };
  const data = useMemo(() => {
    const selected = new Set(card.view.highlightAtomIds);
    const scale = card.view.style === 'spacefill' ? 2.8 : 1;
    return { pairs: inspectionPairs(card), positions: card.frame.positions,
      radii: Array.from(card.frame.types, (type, index) => resolveTypeDisplayRadius(card.frame, type) * scale * (selected.has(card.frame.ids[index]) ? 1.18 : 1)),
      showBonds: card.view.style === 'ball-and-stick' };
  }, [card.frame, card.perceivedBonds, card.view]);

  useEffect(() => {
    const canvas = get().renderer.domElement as HTMLCanvasElement;
    const raycaster = new Raycaster(), pointer = new Vector2();
    const active = new Map<number, { x: number; y: number; max: number }>();
    let multiTouch = false, pending = 0;
    let hoverPoint: { x: number; y: number } | null = null;
    const pick = (x: number, y: number) => {
      const box = canvas.getBoundingClientRect();
      if (!box.width || !box.height || x < box.left || x > box.right || y < box.top || y > box.bottom) return null;
      pointer.set((x - box.left) / box.width * 2 - 1, 1 - (y - box.top) / box.height * 2);
      const camera = get().camera;
      camera.updateMatrixWorld();
      raycaster.setFromCamera(pointer, camera);
      return pickMolecule({ ...data,
        origin: raycaster.ray.origin.toArray() as [number, number, number],
        direction: raycaster.ray.direction.toArray() as [number, number, number] });
    };
    const clearHover = () => {
      hoverPoint = null;
      if (pending) cancelAnimationFrame(pending);
      pending = 0;
      latest.current.onHover(null);
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 && e.pointerType !== 'touch') return;
      active.set(e.pointerId, { x: e.clientX, y: e.clientY, max: 0 });
      if (active.size > 1) multiTouch = true;
      clearHover();
    };
    const move = (e: PointerEvent) => {
      const press = active.get(e.pointerId);
      if (press) press.max = Math.max(press.max, Math.hypot(e.clientX - press.x, e.clientY - press.y));
      if (e.target !== canvas || e.buttons || active.size || e.pointerType === 'touch') { clearHover(); return; }
      hoverPoint = { x: e.clientX, y: e.clientY };
      if (!pending) pending = requestAnimationFrame(() => {
        pending = 0;
        if (hoverPoint) latest.current.onHover(pick(hoverPoint.x, hoverPoint.y));
      });
    };
    const up = (e: PointerEvent) => {
      const press = active.get(e.pointerId);
      if (press) {
        press.max = Math.max(press.max, Math.hypot(e.clientX - press.x, e.clientY - press.y));
        if (isInspectionTap(press.max, active.size, multiTouch)) latest.current.onPin(pick(e.clientX, e.clientY));
      }
      active.delete(e.pointerId);
      if (!active.size) multiTouch = false;
    };
    const cancel = () => { active.clear(); multiTouch = false; clearHover(); };
    // Capture sees release before OrbitControls drops pointer capture, without
    // cancelling any event or changing camera behavior.
    canvas.addEventListener('pointerdown', down, true);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', cancel);
    canvas.addEventListener('pointerleave', clearHover);
    canvas.addEventListener('wheel', clearHover, { passive: true });
    window.addEventListener('blur', cancel);
    window.addEventListener('resize', clearHover);
    return () => {
      if (pending) cancelAnimationFrame(pending);
      canvas.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', cancel);
      canvas.removeEventListener('pointerleave', clearHover);
      canvas.removeEventListener('wheel', clearHover);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('resize', clearHover);
    };
  }, [get, data]);
  return null;
}
