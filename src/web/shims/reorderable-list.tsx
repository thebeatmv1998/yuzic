/**
 * Web shim for `react-native-reorderable-list`.
 *
 * The real list reorders by drag, which needs the native gesture handler. This
 * renders an ordinary `FlatList`, so the same rows appear, scroll and press;
 * drag-to-reorder itself is not offered (the drag handle is a no-op).
 *
 * `reorderItems` is the pure array move the package exports, reproduced exactly
 * so the reorder math still works wherever it is called directly.
 */
import React, { createContext, useContext } from 'react';
import { FlatList, View } from 'react-native';

export type ReorderableListReorderEvent = { from: number; to: number };

type DragHandler = () => void;

const DragContext = createContext<DragHandler>(() => {});
const ActiveContext = createContext(false);

export function useReorderableDrag(): DragHandler {
  return useContext(DragContext);
}

export function useIsActive(): boolean {
  return useContext(ActiveContext);
}

export function reorderItems<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) next.splice(to, 0, moved);
  return next;
}

type ListProps = {
  onReorder?: (event: ReorderableListReorderEvent) => void;
  [key: string]: unknown;
};

function ReorderableList({ onReorder: _onReorder, ...rest }: ListProps) {
  void _onReorder;
  return <FlatList {...(rest as never)} />;
}

function NestedReorderableList({ onReorder: _onReorder, ...rest }: ListProps) {
  void _onReorder;
  return <FlatList {...(rest as never)} />;
}

function ScrollViewContainer(props: { style?: unknown; children?: React.ReactNode }) {
  return <View style={props.style as never}>{props.children}</View>;
}

export { ReorderableList, NestedReorderableList, ScrollViewContainer };
export default ReorderableList;
