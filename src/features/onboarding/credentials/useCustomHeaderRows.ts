import { useCallback, useState } from 'react';
import { MAX_CUSTOM_HEADERS } from '@/providers/http/customHeader';

type CustomHeaderRow = { name: string; value: string };

const emptyRow = (): CustomHeaderRow => ({ name: '', value: '' });

/**
 * The editable rows behind the custom-header section.
 *
 * A hook rather than state in the screen because the credentials screen is one
 * of the files the architecture gate bounds, and three row operations are not
 * what that screen is about. The values stay here only until submit; the
 * keystore is where they are stored.
 */
export function useCustomHeaderRows() {
  const [rows, setRows] = useState<CustomHeaderRow[]>([emptyRow()]);

  const update = useCallback((index: number, patch: Partial<CustomHeaderRow>) => {
    setRows(current => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }, []);

  const add = useCallback(() => {
    setRows(current =>
      current.length >= MAX_CUSTOM_HEADERS ? current : [...current, emptyRow()]
    );
  }, []);

  const remove = useCallback((index: number) => {
    setRows(current => {
      const next = current.filter((_, i) => i !== index);
      return next.length > 0 ? next : [emptyRow()];
    });
  }, []);

  return { rows, update, add, remove };
}
