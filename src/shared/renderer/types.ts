export type Style = "default" | "muted" | "bold" | "success" | "failure";

export type Column<T> = {
  header: string;
  value: (item: T) => string;
  style?: Style;
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
