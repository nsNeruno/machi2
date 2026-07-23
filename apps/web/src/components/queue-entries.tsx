import { useState } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { Check, Grab, Repeat2, ShieldCheck, Ticket } from 'lucide-react';
import type { DoneReason, QueueEntryResponse } from '@machi2/shared';

import type { LocalStateController, NameCard } from '../local-state';
import { formatQueueTime } from '../time';
import { cardStyle, doneReasons } from '../ui-shared';

export function EntryCollection({
  entries,
  layout,
  now,
  onComplete,
  timezone,
  topWaitingId,
}: {
  entries: QueueEntryResponse[];
  layout: LocalStateController['state']['prefs']['boardLayout'];
  now: number;
  onComplete: (entry: QueueEntryResponse) => void;
  timezone: string;
  topWaitingId: string | null;
}) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <div className={`entry-list layout-${layout}`}>
      {entries.map((entry) => (
        <QueueEntryRow
          entry={entry}
          isTopWaiting={entry.id === topWaitingId}
          key={entry.id}
          layout={layout}
          now={now}
          onComplete={() => onComplete(entry)}
          timezone={timezone}
        />
      ))}
    </div>
  );
}

function QueueEntryRow({
  entry,
  isTopWaiting,
  layout,
  now,
  onComplete,
  timezone,
}: {
  entry: QueueEntryResponse;
  isTopWaiting: boolean;
  layout: LocalStateController['state']['prefs']['boardLayout'];
  now: number;
  onComplete: () => void;
  timezone: string;
}) {
  const [swipeStart, setSwipeStart] = useState<number | null>(null);
  const isDone = entry.status === 'done';
  const reason = doneReasons.find((candidate) => candidate.reason === entry.doneReason) ?? null;
  const actor =
    entry.doneByRole === 'self'
      ? 'self'
      : entry.doneByRole === 'staff' || entry.doneByRole === 'admin'
        ? entry.doneByRole
        : entry.doneByName
          ? `by ${entry.doneByName}`
          : null;
  const meta = isDone
    ? `Done ${entry.doneAt ? formatQueueTime(entry.doneAt, now, timezone) : 'just now'}${actor ? ` · ${actor}` : ''}`
    : `Joined ${formatQueueTime(entry.createdAt, now, timezone)}`;

  return (
    <article
      className={`queue-entry layout-${layout}${isDone ? ' is-done' : ''}${entry.mine ? ' is-mine' : ''}${isTopWaiting ? ' is-up-next' : ''}`}
      onPointerCancel={() => setSwipeStart(null)}
      onPointerDown={(event) => {
        if (!isDone && !(event.target instanceof Element && event.target.closest('button'))) {
          setSwipeStart(event.clientX);
        }
      }}
      onPointerUp={(event) => {
        if (swipeStart !== null && event.clientX - swipeStart < -48) {
          onComplete();
        }
        setSwipeStart(null);
      }}
    >
      <span className="ticket-number">#{entry.ticketNumber}</span>
      <div className="entry-copy">
        <strong>{entry.displayName}</strong>
        <span className="entry-meta">
          {entry.autoRequeue ? <Repeat2 aria-label="Re-joins after playing" /> : null}
          {meta}
        </span>
      </div>
      {isDone && reason ? <StatusTag reason={reason.reason} /> : null}
      {!isDone ? (
        <button
          aria-label={entry.mine && isTopWaiting ? "I'm up" : `Mark ${entry.displayName} done`}
          className={`complete-button${entry.mine && isTopWaiting ? ' is-primary' : ''}`}
          onClick={onComplete}
          title={entry.mine && isTopWaiting ? "I'm up" : 'Mark done'}
          type="button"
        >
          <Check aria-hidden="true" />
          {entry.mine && isTopWaiting ? <span>I'm up</span> : null}
        </button>
      ) : null}
    </article>
  );
}

export function StatusTag({ reason }: { reason: DoneReason }) {
  const detail = doneReasons.find((candidate) => candidate.reason === reason)!;
  return (
    <span className={`status-tag is-${reason}`}>
      {detail.icon} {detail.label}
    </span>
  );
}

export function StatusLegend() {
  return (
    <aside aria-label="Completion legend" className="status-legend">
      {doneReasons.map((reason) => (
        <StatusTag key={reason.reason} reason={reason.reason} />
      ))}
    </aside>
  );
}

export function NowPlayingCard({
  entry,
  isCompleting,
  onComplete,
}: {
  entry: QueueEntryResponse;
  isCompleting: boolean;
  onComplete: (entry: QueueEntryResponse) => void;
}) {
  return (
    <section className="now-playing-card">
      <span className="eyebrow">Now playing</span>
      <div>
        <span className="ticket-number">#{entry.ticketNumber}</span>
        <strong>{entry.displayName}</strong>
        <button
          className="primary-button"
          disabled={isCompleting}
          onClick={() => onComplete(entry)}
          type="button"
        >
          <Check aria-hidden="true" />
          Clear
        </button>
      </div>
    </section>
  );
}

export function IntegrityNotice() {
  return (
    <aside className="integrity-notice">
      <ShieldCheck aria-hidden="true" />
      <p>
        Anyone can update this board. Keep it accurate and do not change other players’ entries
        unfairly.
      </p>
    </aside>
  );
}

export function JoinDropZone() {
  const { isOver, setNodeRef } = useDroppable({ id: 'queue-drop' });
  return (
    <div className={`join-drop-zone${isOver ? ' is-over' : ''}`} ref={setNodeRef}>
      <Ticket aria-hidden="true" />
      <span>Drop a name card here to join</span>
    </div>
  );
}

export function DraggableJoinCard({ card, onTap }: { card: NameCard; onTap: () => void }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    data: { card },
    id: `card:${card.id}`,
  });
  const style = {
    ...cardStyle(card),
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
  };

  return (
    <button
      className="drag-name-card"
      onClick={onTap}
      ref={setNodeRef}
      style={style}
      title={`Drag ${card.name} onto the queue to join`}
      type="button"
      {...attributes}
      {...listeners}
    >
      <span className="drag-grab" aria-hidden="true">
        <Grab />
      </span>
      <span>{card.name}</span>
    </button>
  );
}
