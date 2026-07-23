import { useCallback, useEffect, useMemo, useState } from 'react';
import { DndContext, type DragEndEvent } from '@dnd-kit/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowDownWideNarrow,
  ArrowLeft,
  ArrowUpNarrowWide,
  Info,
  Plus,
  X,
} from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import type {
  DoneReason,
  LocationDetailResponse,
  QueueBoardResponse,
  QueueEntryResponse,
} from '@machi2/shared';

import {
  completeQueueEntry,
  enqueueGame,
  fetchQueueBoard,
  subscribeToQueueStream,
  type DeviceIdentity,
} from '../api';
import type { LocalStateController, NameCard } from '../local-state';
import { formatQueueTime } from '../time';
import { createUuid } from '../uuid';
import {
  errorMessage,
  useMediaQuery,
  useNowTick,
  useScrolledPast,
  WIDE_SCREEN_QUERY,
  type PublicConnectionState,
  type Toast,
} from '../ui-shared';
import { FloatingBoardControls } from './queue-controls';
import { DoneReasonDialog, JoinDialog } from './dialogs';
import { EmptyQueue, ErrorPage, LoadingPage } from './feedback';
import {
  DraggableJoinCard,
  EntryCollection,
  IntegrityNotice,
  JoinDropZone,
  NowPlayingCard,
  StatusLegend,
} from './queue-entries';

export function QueueBoard({
  device,
  local,
  onConnectionChange,
  onOpenCards,
  onServiceDateChange,
  onToast,
}: {
  device: DeviceIdentity;
  local: LocalStateController;
  onConnectionChange: (state: PublicConnectionState) => void;
  onOpenCards: () => void;
  onServiceDateChange: (serviceDate: string | null) => void;
  onToast: (toast: Omit<Toast, 'id'>) => void;
}) {
  const { slug = '', gameId = '' } = useParams();
  const queryClient = useQueryClient();
  const now = useNowTick();
  const isWide = useMediaQuery(WIDE_SCREEN_QUERY);
  const [joinOpen, setJoinOpen] = useState(false);
  const [reasonEntry, setReasonEntry] = useState<QueueEntryResponse | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [heroSentinelRef, headerPinned] = useScrolledPast();
  const boardKey = useMemo(() => ['queue-board', gameId] as const, [gameId]);
  const board = useQuery({
    queryKey: boardKey,
    queryFn: () => fetchQueueBoard(gameId, device),
    enabled: Boolean(gameId),
    refetchOnWindowFocus: false,
  });

  const updateGameCount = useCallback(
    (nextBoard: QueueBoardResponse) => {
      queryClient.setQueryData<LocationDetailResponse>(['location', slug], (location) => {
        if (!location) {
          return location;
        }
        const waitingCount = nextBoard.entries.filter((entry) => entry.status === 'waiting').length;
        return {
          ...location,
          games: location.games.map((game) =>
            game.id === nextBoard.game.id ? { ...game, waitingCount } : game,
          ),
        };
      });
    },
    [queryClient, slug],
  );

  useEffect(() => {
    if (!gameId) {
      return;
    }
    const unsubscribe = subscribeToQueueStream(gameId, device, {
      onEvent: (event) => {
        if (event.type === 'queue-updated' || event.type === 'day-rollover') {
          queryClient.setQueryData<QueueBoardResponse>(boardKey, event.board);
          updateGameCount(event.board);
        }
      },
      onState: onConnectionChange,
    });
    return () => {
      unsubscribe();
      onConnectionChange('idle');
    };
  }, [boardKey, device, gameId, onConnectionChange, queryClient, updateGameCount]);

  const serviceDate = board.data?.serviceDate ?? null;
  useEffect(() => {
    onServiceDateChange(serviceDate);
    return () => onServiceDateChange(null);
  }, [onServiceDateChange, serviceDate]);

  const enqueue = useMutation({
    mutationFn: (input: { displayName: string; autoRequeue: boolean }) =>
      enqueueGame(gameId, input, device),
    onMutate: async (input) => {
      const previous = queryClient.getQueryData<QueueBoardResponse>(boardKey);
      if (!previous) {
        return { previous, temporaryId: null };
      }
      const temporaryId = createUuid();
      const temporaryEntry: QueueEntryResponse = {
        autoRequeue: input.autoRequeue,
        createdAt: new Date().toISOString(),
        displayName: input.displayName,
        doneAt: null,
        doneByName: null,
        doneByRole: null,
        doneReason: null,
        id: temporaryId,
        mine: true,
        roundNumber: 1,
        status: 'waiting',
        ticketNumber: Math.max(0, ...previous.entries.map((entry) => entry.ticketNumber)) + 1,
      };
      const next = { ...previous, entries: [...previous.entries, temporaryEntry] };
      queryClient.setQueryData(boardKey, next);
      updateGameCount(next);
      return { previous, temporaryId };
    },
    onSuccess: (result, _input, context) => {
      queryClient.setQueryData<QueueBoardResponse>(boardKey, (current) => {
        if (!current) {
          return current;
        }
        const entries = current.entries.map((entry) =>
          entry.id === context?.temporaryId ? result.entry : entry,
        );
        const next = { ...current, entries };
        updateGameCount(next);
        return next;
      });
      setActionError(null);
      setJoinOpen(false);
      onToast({ message: `Joined as ${result.entry.displayName}.` });
    },
    onError: (error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(boardKey, context.previous);
        updateGameCount(context.previous);
      }
      setActionError(errorMessage(error));
    },
  });

  const complete = useMutation({
    mutationFn: (input: { entry: QueueEntryResponse; reason: DoneReason; staffPin?: string }) =>
      completeQueueEntry(
        input.entry.id,
        {
          actingName: local.activeCard?.name ?? '',
          reason: input.reason,
          staffPin: input.staffPin,
        },
        device,
      ),
    onMutate: async (input) => {
      const previous = queryClient.getQueryData<QueueBoardResponse>(boardKey);
      if (!previous) {
        return { previous };
      }
      const completedAt = new Date().toISOString();
      const next = {
        ...previous,
        entries: previous.entries.map((entry) =>
          entry.id === input.entry.id
            ? {
                ...entry,
                doneAt: completedAt,
                doneByName: input.entry.mine ? null : (local.activeCard?.name ?? null),
                doneByRole: input.entry.mine ? ('self' as const) : ('player' as const),
                doneReason: input.reason,
                status: 'done' as const,
              }
            : entry,
        ),
      };
      queryClient.setQueryData(boardKey, next);
      updateGameCount(next);
      return { previous };
    },
    onSuccess: (result) => {
      queryClient.setQueryData<QueueBoardResponse>(boardKey, (current) => {
        if (!current) {
          return current;
        }
        const entries = current.entries.map((entry) =>
          entry.id === result.entry.id ? result.entry : entry,
        );
        if (
          result.requeuedEntry &&
          !entries.some((entry) => entry.id === result.requeuedEntry?.id)
        ) {
          entries.push(result.requeuedEntry);
        }
        const next = { ...current, entries };
        updateGameCount(next);
        return next;
      });
      setActionError(null);
      setReasonEntry(null);
      onToast({
        message: result.autoRequeueSkipped
          ? 'Marked done. The line was full, so you were not re-joined.'
          : result.requeuedEntry
            ? 'Marked played and re-joined at the back of the line.'
            : 'Marked done.',
      });
    },
    onError: (error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(boardKey, context.previous);
        updateGameCount(context.previous);
      }
      setActionError(errorMessage(error));
    },
  });

  if (board.isPending) {
    return <LoadingPage label="Loading queue" />;
  }
  if (board.isError || !board.data) {
    return <ErrorPage message={errorMessage(board.error)} onRetry={() => void board.refetch()} />;
  }

  const allEntries = [...board.data.entries].sort(
    (left, right) => left.ticketNumber - right.ticketNumber,
  );
  const waitingEntries = allEntries.filter((entry) => entry.status === 'waiting');
  const doneEntries = allEntries.filter((entry) => entry.status === 'done');
  const nowPlaying = board.data.boardMode === 'now_playing' ? (waitingEntries[0] ?? null) : null;
  const waitingForList = nowPlaying ? waitingEntries.slice(1) : waitingEntries;
  const visibleWaiting = local.state.prefs.showFullDayByDefault
    ? waitingForList
    : waitingForList.slice(0, 10);
  // The chronological lists ("In order added" and "Completed") honor the sort-direction
  // toggle; the priority "Up next" list always leads with the head of line. Slicing keeps
  // its "latest N" meaning by running on ascending order, then the display flips.
  const isDescending = local.state.prefs.sortDirection === 'desc';
  const applyDirection = <Entry,>(entries: Entry[]): Entry[] =>
    isDescending ? [...entries].reverse() : entries;
  const visibleDone = applyDirection(
    local.state.prefs.showFullDayByDefault ? doneEntries : doneEntries.slice(-10),
  );
  const orderedEntries =
    local.state.prefs.boardOrder === 'as_added'
      ? applyDirection(
          local.state.prefs.showFullDayByDefault ? allEntries : allEntries.slice(-10),
        )
      : [];
  const ownWaitingEntry = waitingEntries.find((entry) => entry.mine) ?? null;

  const handleJoin = (name: string, autoRequeue: boolean) => {
    local.saveCard(name, autoRequeue);
    enqueue.mutate({ displayName: name, autoRequeue });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    if (event.over?.id !== 'queue-drop') {
      return;
    }
    const data = event.active.data.current as { card?: NameCard } | undefined;
    const card = data?.card;
    if (!card || enqueue.isPending || ownWaitingEntry) {
      return;
    }
    local.selectCard(card.id);
    handleJoin(card.name, card.autoRequeueDefault);
  };

  const beginCompletion = (entry: QueueEntryResponse) => {
    if (!local.activeCard) {
      setActionError('Choose a name card before changing a queue entry.');
      onOpenCards();
      return;
    }
    const isHead = waitingEntries[0]?.id === entry.id;
    if (entry.mine && isHead && board.data.boardMode === 'self_serve') {
      complete.mutate({ entry, reason: 'played' });
      return;
    }
    setReasonEntry(entry);
  };

  // The board pieces are declared once and arranged two ways: a single stacked column on
  // mobile, and a main-queue / info-rail split on wide screens (UI_DESIGN §7.1c).
  const heroSection = (
    <section className="queue-hero">
      <div>
        <h1>{board.data.game.name}</h1>
        <p>{board.data.game.cabinetLabel ?? 'Queue board'}</p>
      </div>
    </section>
  );

  const actionErrorBanner = actionError ? (
    <div className="action-error" role="alert">
      <AlertTriangle aria-hidden="true" />
      <span>{actionError}</span>
      <button
        aria-label="Dismiss error"
        className="icon-button compact"
        onClick={() => setActionError(null)}
        title="Dismiss error"
        type="button"
      >
        <X aria-hidden="true" />
      </button>
    </div>
  ) : null;

  const communityNoteCard = board.data.communityNote ? (
    <aside className="community-note">
      <Info aria-hidden="true" />
      <div>
        <strong>Note from staff</strong>
        <p>{board.data.communityNote.body}</p>
        {board.data.communityNote.updatedAt ? (
          <span>
            Updated{' '}
            {formatQueueTime(board.data.communityNote.updatedAt, now, board.data.locationTimezone)}
          </span>
        ) : null}
      </div>
    </aside>
  ) : null;

  const nowPlayingCard =
    board.data.boardMode === 'now_playing' && nowPlaying ? (
      <NowPlayingCard
        entry={nowPlaying}
        isCompleting={complete.isPending}
        onComplete={beginCompletion}
      />
    ) : null;

  // A single sort-direction toggle, shown only on the chronological lists ("In order
  // added" and "Completed") — never on the priority "Up next" list. The two lists live in
  // different board modes, so at most one toggle is on screen at a time.
  const sortToggle = (
    <button
      aria-label={isDescending ? 'Sort descending' : 'Sort ascending'}
      className="sort-toggle"
      onClick={() => local.setSortDirection(isDescending ? 'asc' : 'desc')}
      title={isDescending ? 'Sort descending' : 'Sort ascending'}
      type="button"
    >
      {isDescending ? (
        <ArrowDownWideNarrow aria-hidden="true" />
      ) : (
        <ArrowUpNarrowWide aria-hidden="true" />
      )}
    </button>
  );

  const queueSection = (
    <section className="queue-section" aria-labelledby="queue-heading">
      <div className="section-heading">
        <h2 id="queue-heading">
          {local.state.prefs.boardOrder === 'as_added' ? 'In order added' : 'Up next'}
        </h2>
        <div className="section-heading-meta">
          {local.state.prefs.boardOrder === 'as_added' ? sortToggle : null}
          <span className="section-heading-count">{waitingEntries.length}</span>
        </div>
      </div>
      {allEntries.length === 0 ? <EmptyQueue /> : null}
      {local.state.prefs.boardOrder === 'as_added' ? (
        <EntryCollection
          entries={orderedEntries}
          layout={local.state.prefs.boardLayout}
          now={now}
          onComplete={beginCompletion}
          timezone={board.data.locationTimezone}
          topWaitingId={waitingEntries[0]?.id ?? null}
        />
      ) : (
        <>
          <EntryCollection
            entries={visibleWaiting}
            layout={local.state.prefs.boardLayout}
            now={now}
            onComplete={beginCompletion}
            timezone={board.data.locationTimezone}
            topWaitingId={waitingEntries[0]?.id ?? null}
          />
          {visibleDone.length > 0 ? (
            <section className="completed-section" aria-labelledby="completed-heading">
              <div className="section-heading">
                <h2 id="completed-heading">Completed</h2>
                <div className="section-heading-meta">
                  {sortToggle}
                  <span className="section-heading-count">{doneEntries.length}</span>
                </div>
              </div>
              <EntryCollection
                entries={visibleDone}
                layout={local.state.prefs.boardLayout}
                now={now}
                onComplete={beginCompletion}
                timezone={board.data.locationTimezone}
                topWaitingId={null}
              />
            </section>
          ) : null}
        </>
      )}
    </section>
  );

  const statusLegend = doneEntries.length > 0 ? <StatusLegend /> : null;
  const integrityNotice = !board.data.requireApprovalForOthers ? <IntegrityNotice /> : null;

  const actionBar = (
    <section aria-label="Queue actions" className="queue-action-bar">
      {local.activeCard ? (
        <DraggableJoinCard card={local.activeCard} onTap={() => setJoinOpen(true)} />
      ) : null}
      {ownWaitingEntry ? (
        <span className="your-ticket">Your ticket #{ownWaitingEntry.ticketNumber}</span>
      ) : (
        <button className="primary-button" onClick={() => setJoinOpen(true)} type="button">
          <Plus aria-hidden="true" />
          Join queue
        </button>
      )}
    </section>
  );

  return (
    <DndContext onDragEnd={handleDragEnd}>
      <div
        className={`queue-sticky-bar${headerPinned ? ' is-pinned' : ''}`}
        aria-hidden={!headerPinned}
      >
        <div className="queue-sticky-copy">
          <strong>{board.data.game.name}</strong>
          <span>
            <b>{waitingEntries.length}</b> up next
          </span>
        </div>
        {ownWaitingEntry ? (
          <span className="your-ticket">Your ticket #{ownWaitingEntry.ticketNumber}</span>
        ) : (
          <button
            className="primary-button"
            onClick={() => setJoinOpen(true)}
            tabIndex={headerPinned ? 0 : -1}
            type="button"
          >
            <Plus aria-hidden="true" />
            Join
          </button>
        )}
      </div>
      <main className="page-shell queue-page">
        <div className="queue-topline">
          <Link className="back-link" to={`/l/${slug}`}>
            <ArrowLeft aria-hidden="true" />
            {board.data.game.name}
          </Link>
          {board.data.game.cabinetLabel ? (
            <span className="queue-topline-cabinet">{board.data.game.cabinetLabel}</span>
          ) : null}
        </div>
        {isWide ? (
          <>
            <div ref={heroSentinelRef} aria-hidden="true" />
            {actionErrorBanner}
            <div className="queue-body">
              <div className="queue-main">
                {nowPlayingCard}
                {queueSection}
                {statusLegend}
              </div>
              <div className="queue-rail">
                {heroSection}
                {communityNoteCard}
                {integrityNotice}
                <div className="rail-join">
                  {actionBar}
                  <JoinDropZone />
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            {heroSection}
            <div ref={heroSentinelRef} aria-hidden="true" />
            {actionErrorBanner}
            {communityNoteCard}
            {nowPlayingCard}
            {queueSection}
            {statusLegend}
            <div className="board-dock">
              <section aria-label="Board tools" className="board-footer">
                {integrityNotice}
                <JoinDropZone />
              </section>
              {actionBar}
            </div>
          </>
        )}
      </main>
      <FloatingBoardControls
        boardLayout={local.state.prefs.boardLayout}
        boardOrder={local.state.prefs.boardOrder}
        isFetching={board.isFetching}
        onOrderChange={local.setBoardOrder}
        onRefresh={() => void board.refetch()}
        onSetLayout={local.setBoardLayout}
        onToggle={local.setDockExpanded}
        onToggleFullDay={() => local.setShowFullDay(!local.state.prefs.showFullDayByDefault)}
        open={local.state.prefs.dockExpanded}
        showFullDay={local.state.prefs.showFullDayByDefault}
        total={allEntries.length}
      />
      {joinOpen ? (
        <JoinDialog
          activeCard={local.activeCard}
          cards={local.state.cards}
          isSubmitting={enqueue.isPending}
          onClose={() => setJoinOpen(false)}
          onSelectCard={(card) => local.selectCard(card.id)}
          onSubmit={handleJoin}
        />
      ) : null}
      {reasonEntry ? (
        <DoneReasonDialog
          entry={reasonEntry}
          isSubmitting={complete.isPending}
          needsStaffPin={board.data.requireApprovalForOthers && !reasonEntry.mine}
          onClose={() => setReasonEntry(null)}
          onSubmit={(reason, staffPin) => complete.mutate({ entry: reasonEntry, reason, staffPin })}
        />
      ) : null}
    </DndContext>
  );
}
