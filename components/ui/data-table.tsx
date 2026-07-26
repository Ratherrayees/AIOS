import type { ReactNode } from "react";

import { EmptyState, LoadingState } from "./empty-state";

export type DataTableColumn<Row> = {
  key: string;
  header: string;
  render: (row: Row) => ReactNode;
  align?: "start" | "center" | "end";
};

type DataTableProps<Row> = {
  caption: string;
  columns: DataTableColumn<Row>[];
  rows: Row[];
  getRowKey: (row: Row) => string;
  emptyTitle: string;
  emptyDescription: string;
  loading?: boolean;
  loadingLabel?: string;
  compact?: boolean;
};

export function DataTable<Row>({
  caption,
  columns,
  rows,
  getRowKey,
  emptyTitle,
  emptyDescription,
  loading = false,
  loadingLabel = "Loading records",
  compact = false,
}: DataTableProps<Row>) {
  return (
    <div
      className={`ui-data-table-shell${compact ? " ui-data-table-compact" : ""}`}
      aria-busy={loading}
    >
      <table className="ui-data-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                className={`ui-data-table-${column.align ?? "start"}`}
                key={column.key}
                scope="col"
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={columns.length}>
                <LoadingState label={loadingLabel} rows={3} />
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length}>
                <EmptyState
                  compact
                  title={emptyTitle}
                  description={emptyDescription}
                />
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={getRowKey(row)}>
                {columns.map((column) => (
                  <td
                    className={`ui-data-table-${column.align ?? "start"}`}
                    key={column.key}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
