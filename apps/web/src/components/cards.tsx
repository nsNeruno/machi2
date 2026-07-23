import { useState, type FormEvent } from 'react';
import { ChevronRight, Plus, Trash2, UserRound, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { nameSchema } from '@machi2/shared';

import type { LocalStateController, NameCard } from '../local-state';
import { cardStyle } from '../ui-shared';
import { NameField } from './name-field';

export function CardsRoute({
  local,
  onRemoveCard,
}: {
  local: LocalStateController;
  onRemoveCard: (card: NameCard) => void;
}) {
  return (
    <main className="page-shell">
      <section className="page-intro">
        <p className="eyebrow">This device</p>
        <h1>My name cards</h1>
        <p>Saved only on this device. Switch cards to choose who is acting on the board.</p>
      </section>
      <CardsManager local={local} onRemoveCard={onRemoveCard} />
    </main>
  );
}

export function CardsDrawer({
  local,
  onClose,
  onRemoveCard,
}: {
  local: LocalStateController;
  onClose: () => void;
  onRemoveCard: (card: NameCard) => void;
}) {
  return (
    <div className="drawer-backdrop" onMouseDown={onClose} role="presentation">
      <aside
        aria-labelledby="cards-title"
        aria-modal="true"
        className="cards-drawer"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">This device</p>
            <h2 id="cards-title">Name cards</h2>
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
        <CardsManager local={local} onRemoveCard={onRemoveCard} />
        <Link className="drawer-route-link" onClick={onClose} to="/cards">
          Open full card manager <ChevronRight aria-hidden="true" />
        </Link>
      </aside>
    </div>
  );
}

function CardsManager({
  local,
  onRemoveCard,
}: {
  local: LocalStateController;
  onRemoveCard: (card: NameCard) => void;
}) {
  const [name, setName] = useState('');
  const [autoRequeue, setAutoRequeue] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = nameSchema.safeParse(name);
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? 'Enter a valid name.');
      return;
    }
    local.saveCard(parsed.data, autoRequeue);
    setName('');
    setAutoRequeue(false);
    setValidationError(null);
  };

  return (
    <>
      <div className="card-list">
        {local.state.cards.map((card) => (
          <article
            className={`name-card${card.id === local.activeCard?.id ? ' is-active' : ''}`}
            key={card.id}
            style={cardStyle(card)}
          >
            <button
              className="name-card-select"
              onClick={() => local.selectCard(card.id)}
              type="button"
            >
              <UserRound aria-hidden="true" />
              <span>{card.name}</span>
              {card.id === local.activeCard?.id ? <b>Active</b> : null}
            </button>
            <button
              aria-label={`Remove ${card.name}`}
              className="icon-button compact"
              onClick={() => onRemoveCard(card)}
              title={`Remove ${card.name}`}
              type="button"
            >
              <Trash2 aria-hidden="true" />
            </button>
          </article>
        ))}
      </div>
      <form className="add-card-form" onSubmit={submit}>
        <NameField
          id="card-name"
          label="Add a name card"
          onChange={(value) => {
            setName(value);
            setValidationError(null);
          }}
          placeholder="Name"
          value={name}
        />
        {validationError ? <p className="field-error">{validationError}</p> : null}
        <label className="checkbox-label" htmlFor="card-auto-requeue">
          <input
            checked={autoRequeue}
            id="card-auto-requeue"
            onChange={(event) => setAutoRequeue(event.target.checked)}
            type="checkbox"
          />
          Re-join after I play
        </label>
        <button className="secondary-button full-width" type="submit">
          <Plus aria-hidden="true" />
          Add card
        </button>
      </form>
    </>
  );
}
