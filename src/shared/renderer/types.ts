export type Style = "default" | "muted" | "bold" | "success" | "failure";

export type Column<T> = {
  header: string;
  value: (item: T) => string;
  style?: Style;
  /**
   * When the table would overflow the terminal width, the first column
   * marked `flex: true` gets truncated with `…` to make the row fit on
   * one line. Columns that carry data the user needs verbatim (ids, urls,
   * states) should leave this off.
   */
  flex?: boolean;
};

export type Field<T> = {
  label: string;
  value: (item: T) => string;
  style?: Style;
};

export interface Renderer {
  /** Info output. Stdout in text mode, suppressed in JSON mode. */
  message(text: string): void;
  /** Errors. Always stderr, plain text regardless of mode. */
  error(text: string): void;
  /** Collection. Text mode: aligned columns. JSON mode: raw array. */
  list<T>(items: T[], columns: Column<T>[]): void;
  /** Single item. Text mode: labeled fields. JSON mode: raw object. */
  detail<T>(item: T, fields: Field<T>[]): void;
}
