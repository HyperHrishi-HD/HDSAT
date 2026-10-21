import { FloatingToolWindow } from './FloatingToolWindow';
import { MathReferenceSheet } from './MathTools';

/**
 * Floating math reference sheet.
 *
 * The header drags the window, every edge and corner resizes it like a normal
 * desktop window, and the size is remembered. The heavy part — the official
 * College Board image — lives only in this component, so dragging never
 * re-renders the test runner behind it.
 */
export function ReferenceWindow({
  assessment,
  onClose,
}: {
  assessment?: string;
  onClose: () => void;
}) {
  return (
    <FloatingToolWindow
      title="Math Reference"
      onClose={onClose}
      storageKey="hdsat.window.reference"
      defaultWidth={720}
      defaultHeight={520}
      minWidth={260}
      minHeight={180}
      testId="reference-sheet-modal"
    >
      <MathReferenceSheet assessment={assessment} />
    </FloatingToolWindow>
  );
}
