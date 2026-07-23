import { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Clock3,
  LayoutList,
  ListOrdered,
  RefreshCw,
  SlidersHorizontal,
  X,
} from 'lucide-react';

import type { LocalStateController } from '../local-state';
import { queueLayouts, useMediaQuery, WIDE_SCREEN_QUERY } from '../ui-shared';

type BoardControlsProps = {
  boardLayout: LocalStateController['state']['prefs']['boardLayout'];
  boardOrder: LocalStateController['state']['prefs']['boardOrder'];
  isFetching: boolean;
  onOrderChange: (order: LocalStateController['state']['prefs']['boardOrder']) => void;
  onRefresh: () => void;
  onSetLayout: (layout: LocalStateController['state']['prefs']['boardLayout']) => void;
  onToggleFullDay: () => void;
  showFullDay: boolean;
  total: number;
};

export function BoardControls({
  boardLayout,
  boardOrder,
  isFetching,
  onOrderChange,
  onRefresh,
  onSetLayout,
  onToggleFullDay,
  showFullDay,
  total,
}: BoardControlsProps) {
  const [layoutOpen, setLayoutOpen] = useState(false);
  const currentLayout =
    queueLayouts.find((layout) => layout.value === boardLayout) ?? queueLayouts[0];
  const CurrentLayoutIcon = currentLayout.icon;
  return (
    <section aria-label="Board controls" className="board-controls">
      <div className="board-controls-row">
        <div className="board-controls-tools">
          <button
            aria-label="Refresh queue"
            className="icon-button"
            disabled={isFetching}
            onClick={onRefresh}
            title="Refresh queue"
            type="button"
          >
            <RefreshCw aria-hidden="true" className={isFetching ? 'is-spinning' : ''} />
          </button>
          <div aria-label="Board order" className="segmented-control">
            <button
              aria-pressed={boardOrder === 'up_next'}
              onClick={() => onOrderChange('up_next')}
              title="Group waiting entries first"
              type="button"
            >
              <ListOrdered aria-hidden="true" />
              Up next
            </button>
            <button
              aria-pressed={boardOrder === 'as_added'}
              onClick={() => onOrderChange('as_added')}
              title="Keep entries in join order"
              type="button"
            >
              <LayoutList aria-hidden="true" />
              Added
            </button>
          </div>
          <button
            aria-haspopup="dialog"
            className="layout-picker-button"
            onClick={() => setLayoutOpen(true)}
            title="Change how the board looks"
            type="button"
          >
            <CurrentLayoutIcon aria-hidden="true" />
            <span>{currentLayout.label}</span>
            <ChevronDown aria-hidden="true" className="picker-caret" />
          </button>
        </div>
      </div>
      <button className="secondary-button full-day-button" onClick={onToggleFullDay} type="button">
        <Clock3 aria-hidden="true" />
        {showFullDay ? 'Show recent' : `Show full day (${total})`}
      </button>
      {layoutOpen ? (
        <LayoutDialog
          current={boardLayout}
          onClose={() => setLayoutOpen(false)}
          onSelect={(value) => {
            onSetLayout(value);
            setLayoutOpen(false);
          }}
        />
      ) : null}
    </section>
  );
}

type Placement = { vertical: 'up' | 'down'; horizontal: 'left' | 'right' };

// Pointer-interaction constants (not visual style tokens): how far a press must travel
// before it counts as a drag, and how far to keep the button clear of the viewport edge.
const DRAG_THRESHOLD_PX = 6;
const VIEWPORT_EDGE_MARGIN_PX = 8;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export function FloatingBoardControls({
  open,
  onToggle,
  ...controls
}: BoardControlsProps & { open: boolean; onToggle: (open: boolean) => void }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<{
    pointerX: number;
    pointerY: number;
    originLeft: number;
    originTop: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [placement, setPlacement] = useState<Placement>({ vertical: 'up', horizontal: 'right' });
  // On wide screens the dock is centered, so the button can rest as a stationary corner
  // FAB; dragging only earns its keep on narrow screens where the dock spans full width.
  const isWide = useMediaQuery(WIDE_SCREEN_QUERY);

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (isWide || !fabRef.current) {
      return;
    }
    const rect = fabRef.current.getBoundingClientRect();
    dragRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      originLeft: rect.left,
      originTop: rect.top,
      moved: false,
    };
    fabRef.current.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || !fabRef.current) {
      return;
    }
    const deltaX = event.clientX - drag.pointerX;
    const deltaY = event.clientY - drag.pointerY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) < DRAG_THRESHOLD_PX) {
      return;
    }
    drag.moved = true;
    if (!dragging) {
      setDragging(true);
    }
    const rect = fabRef.current.getBoundingClientRect();
    setPosition({
      left: clamp(
        drag.originLeft + deltaX,
        VIEWPORT_EDGE_MARGIN_PX,
        window.innerWidth - rect.width - VIEWPORT_EDGE_MARGIN_PX,
      ),
      top: clamp(
        drag.originTop + deltaY,
        VIEWPORT_EDGE_MARGIN_PX,
        window.innerHeight - rect.height - VIEWPORT_EDGE_MARGIN_PX,
      ),
    });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (fabRef.current?.hasPointerCapture(event.pointerId)) {
      fabRef.current.releasePointerCapture(event.pointerId);
    }
    if (drag?.moved) {
      // Swallow the click that a browser fires after a drag so it doesn't toggle the panel.
      suppressClickRef.current = true;
      setDragging(false);
    }
  };

  const handleClick = () => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (open) {
      onToggle(false);
      return;
    }
    if (fabRef.current) {
      const rect = fabRef.current.getBoundingClientRect();
      setPlacement({
        vertical: rect.top + rect.height / 2 > window.innerHeight / 2 ? 'up' : 'down',
        horizontal: rect.left + rect.width / 2 > window.innerWidth / 2 ? 'right' : 'left',
      });
    }
    onToggle(true);
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointerDownOutside = (event: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        onToggle(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onToggle(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDownOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDownOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onToggle]);

  useEffect(() => {
    const handleResize = () => {
      setPosition((current) => {
        if (!current || !fabRef.current) {
          return current;
        }
        const rect = fabRef.current.getBoundingClientRect();
        return {
          left: clamp(
            current.left,
            VIEWPORT_EDGE_MARGIN_PX,
            window.innerWidth - rect.width - VIEWPORT_EDGE_MARGIN_PX,
          ),
          top: clamp(
            current.top,
            VIEWPORT_EDGE_MARGIN_PX,
            window.innerHeight - rect.height - VIEWPORT_EDGE_MARGIN_PX,
          ),
        };
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div
      ref={wrapperRef}
      className="floating-controls"
      style={
        !isWide && position
          ? { left: position.left, top: position.top, right: 'auto', bottom: 'auto' }
          : undefined
      }
    >
      <button
        ref={fabRef}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={open ? 'Hide board controls' : 'Show board controls'}
        className={`floating-controls-fab${open ? ' is-open' : ''}${dragging ? ' is-dragging' : ''}`}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        title="Board controls"
        type="button"
      >
        <SlidersHorizontal aria-hidden="true" />
      </button>
      {open ? (
        <div
          aria-label="Board controls"
          className={`floating-controls-panel is-${placement.vertical} is-${placement.horizontal}`}
          role="dialog"
        >
          <div className="floating-controls-head">
            <strong>
              <SlidersHorizontal aria-hidden="true" />
              Controls
            </strong>
            <button
              aria-label="Close controls"
              className="icon-button compact"
              onClick={() => onToggle(false)}
              title="Close controls"
              type="button"
            >
              <X aria-hidden="true" />
            </button>
          </div>
          <BoardControls {...controls} />
        </div>
      ) : null}
    </div>
  );
}

function LayoutPreview({ value }: { value: (typeof queueLayouts)[number]['value'] }) {
  const rows = value === 'cards' ? 4 : value === 'table' ? 5 : 3;
  return (
    <span aria-hidden="true" className={`layout-preview is-${value}`}>
      {Array.from({ length: rows }, (_, index) => (
        <i key={index} />
      ))}
    </span>
  );
}

function LayoutDialog({
  current,
  onClose,
  onSelect,
}: {
  current: LocalStateController['state']['prefs']['boardLayout'];
  onClose: () => void;
  onSelect: (value: LocalStateController['state']['prefs']['boardLayout']) => void;
}) {
  return (
    <div className="dialog-backdrop" onMouseDown={onClose} role="presentation">
      <section
        aria-labelledby="layout-title"
        aria-modal="true"
        className="dialog layout-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">Board view</p>
            <h2 id="layout-title">Choose a layout</h2>
          </div>
          <button
            aria-label="Close"
            className="icon-button"
            onClick={onClose}
            title="Close"
            type="button"
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="layout-options">
          {queueLayouts.map(({ description, icon: Icon, label, value }) => (
            <button
              aria-pressed={current === value}
              className={`layout-option${current === value ? ' is-selected' : ''}`}
              key={value}
              onClick={() => onSelect(value)}
              type="button"
            >
              <LayoutPreview value={value} />
              <span className="layout-option-copy">
                <strong>
                  <Icon aria-hidden="true" />
                  {label}
                  {current === value ? <Check aria-hidden="true" className="layout-check" /> : null}
                </strong>
                <span>{description}</span>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
