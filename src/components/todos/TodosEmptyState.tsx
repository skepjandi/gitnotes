import React from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '../ui';

interface TodosEmptyStateProps {
  isFiltered: boolean;
  onCreate: () => void;
}

export function TodosEmptyState({ isFiltered, onCreate }: TodosEmptyStateProps) {
  const { t } = useTranslation();

  return (
    <EmptyState
      icon="checkbox-outline"
      title={isFiltered ? t('todos.noMatchingTodos') : t('todos.noTodosYet')}
      subtitle={isFiltered ? t('notes.tryAdjusting') : t('todos.addFirst')}
      actionLabel={isFiltered ? undefined : t('todos.newTodo')}
      onAction={isFiltered ? undefined : onCreate}
      actionTestID="todo-list.button.empty-create"
    />
  );
}
