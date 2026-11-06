import React from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '../ui';

interface NotesEmptyStateProps {
  isFiltered: boolean;
  onCreate: () => void;
}

export function NotesEmptyState({ isFiltered, onCreate }: NotesEmptyStateProps) {
  const { t } = useTranslation();

  return (
    <EmptyState
      icon="document-text-outline"
      title={isFiltered ? t('notes.noMatchingNotes') : t('notes.noNotesYet')}
      subtitle={isFiltered ? t('notes.tryAdjusting') : t('notes.createFirst')}
      actionLabel={isFiltered ? undefined : t('notes.newNote')}
      onAction={isFiltered ? undefined : onCreate}
      actionTestID="notes-list.button.empty-create"
    />
  );
}
