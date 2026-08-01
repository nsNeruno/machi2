import { useState, type FormEvent } from 'react';
import { Ticket, X } from 'lucide-react';
import { nameSchema, type DoneReason, type QueueEntryResponse } from '@machi2/shared';

import type { LocalStateController, NameCard } from '../local-state';
import { cardStyle, doneReasons } from '../ui-shared';
import { NameField } from './name-field';

export function OnboardingDialog({ local }: { local: LocalStateController }) {
  const [name, setName] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = nameSchema.safeParse(name);
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? 'Enter a valid name.');
      return;
    }
    local.saveCard(parsed.data, false);
  };

  return (
    <div className="dialog-backdrop onboarding-backdrop" role="presentation">
      <section
        aria-labelledby="onboarding-title"
        aria-modal="true"
        className="dialog onboarding-dialog"
        role="dialog"
      >
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">Your queue card</p>
            <h2 id="onboarding-title">Pick a name for the board</h2>
          </div>
        </div>
        <p className="onboarding-note">
          Saved on your device and shown on the queue. It is not an account, so play fair.
        </p>
        <form onSubmit={submit}>
          <NameField
            autoComplete="nickname"
            autoFocus
            id="onboarding-name"
            label="Display name"
            onChange={(value) => {
              setName(value);
              setValidationError(null);
            }}
            value={name}
          />
          {validationError ? <p className="field-error">{validationError}</p> : null}
          <button className="primary-button" type="submit">
            <Ticket aria-hidden="true" />
            Start queueing
          </button>
        </form>
      </section>
    </div>
  );
}

export function JoinDialog({
  activeCard,
  cards,
  isCheckingLocation,
  isSubmitting,
  onClose,
  onSelectCard,
  onSubmit,
}: {
  activeCard: NameCard | null;
  cards: NameCard[];
  isCheckingLocation: boolean;
  isSubmitting: boolean;
  onClose: () => void;
  onSelectCard: (card: NameCard) => void;
  onSubmit: (name: string, autoRequeue: boolean) => void;
}) {
  const [name, setName] = useState(activeCard?.name ?? '');
  const [autoRequeue, setAutoRequeue] = useState(activeCard?.autoRequeueDefault ?? false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = nameSchema.safeParse(name);
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? 'Enter a valid name.');
      return;
    }
    onSubmit(parsed.data, autoRequeue);
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <section aria-labelledby="join-title" aria-modal="true" className="dialog" role="dialog">
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">Your name card</p>
            <h2 id="join-title">Join queue</h2>
          </div>
          <button
            aria-label="Close"
            className="icon-button compact"
            onClick={onClose}
            title="Close"
            type="button"
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <form onSubmit={submit}>
          <NameField
            autoComplete="nickname"
            autoFocus
            id="join-name"
            label="Display name"
            onChange={(value) => {
              setName(value);
              setValidationError(null);
            }}
            value={name}
          />
          {cards.length > 1 ? (
            <div className="saved-card-picks">
              <span>Your saved cards</span>
              <div>
                {cards.map((card) => (
                  <button
                    key={card.id}
                    onClick={() => {
                      setName(card.name);
                      setAutoRequeue(card.autoRequeueDefault);
                      onSelectCard(card);
                    }}
                    style={cardStyle(card)}
                    type="button"
                  >
                    {card.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {validationError ? <p className="field-error">{validationError}</p> : null}
          <label className="checkbox-label" htmlFor="join-auto-requeue">
            <input
              checked={autoRequeue}
              id="join-auto-requeue"
              onChange={(event) => setAutoRequeue(event.target.checked)}
              type="checkbox"
            />
            Re-join after I play
          </label>
          <div className="dialog-actions">
            <button className="secondary-button" onClick={onClose} type="button">
              Cancel
            </button>
            <button
              className="primary-button"
              disabled={isCheckingLocation || isSubmitting}
              type="submit"
            >
              <Ticket aria-hidden="true" />
              {isCheckingLocation ? 'Checking location' : isSubmitting ? 'Joining' : 'Add to queue'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function DoneReasonDialog({
  entry,
  isCheckingLocation,
  isSubmitting,
  needsStaffPin,
  onClose,
  onSubmit,
}: {
  entry: QueueEntryResponse;
  isCheckingLocation: boolean;
  isSubmitting: boolean;
  needsStaffPin: boolean;
  onClose: () => void;
  onSubmit: (reason: DoneReason, staffPin?: string) => void;
}) {
  const [staffPin, setStaffPin] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (reason: DoneReason) => {
    if (needsStaffPin && staffPin.trim().length === 0) {
      setError('Enter the staff PIN to change another player’s entry.');
      return;
    }
    onSubmit(reason, staffPin.trim() || undefined);
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <section aria-labelledby="done-title" aria-modal="true" className="dialog" role="dialog">
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">Queue entry</p>
            <h2 id="done-title">
              Mark #{entry.ticketNumber} {entry.displayName} as done
            </h2>
          </div>
          <button
            aria-label="Close"
            className="icon-button compact"
            onClick={onClose}
            title="Close"
            type="button"
          >
            <X aria-hidden="true" />
          </button>
        </div>
        {needsStaffPin ? (
          <label className="name-field" htmlFor="staff-pin">
            <span>Staff PIN</span>
            <input
              autoComplete="current-password"
              id="staff-pin"
              onChange={(event) => setStaffPin(event.target.value)}
              type="password"
              value={staffPin}
            />
          </label>
        ) : null}
        {error ? <p className="field-error">{error}</p> : null}
        {isCheckingLocation ? (
          <p aria-live="polite" className="dialog-status">
            Checking your location before updating the queue…
          </p>
        ) : null}
        <div className="reason-grid">
          {doneReasons.map((detail) => (
            <button
              className={`reason-button is-${detail.reason}`}
              disabled={isCheckingLocation || isSubmitting}
              key={detail.reason}
              onClick={() => submit(detail.reason)}
              type="button"
            >
              <span>{detail.icon}</span>
              {detail.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
