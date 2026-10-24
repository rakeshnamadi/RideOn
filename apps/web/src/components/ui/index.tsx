import { AlertTriangle, Inbox, Loader2, X } from 'lucide-react';
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { ApiError } from '@/services/api';
import { humanize } from '@/utils/format';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ─────────── Buttons ───────────

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'accent';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800 disabled:bg-brand-700/50',
  accent: 'bg-accent-400 text-stone-900 hover:bg-accent-500 disabled:opacity-50',
  secondary: 'bg-white text-stone-800 ring-1 ring-stone-300 hover:bg-stone-100 disabled:opacity-50',
  danger: 'bg-red-700 text-white hover:bg-red-800 disabled:bg-red-700/50',
  ghost: 'text-stone-700 hover:bg-stone-200/70 disabled:opacity-50',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  const sizes = { sm: 'px-2.5 py-1.5 text-sm', md: 'px-4 py-2 text-sm', lg: 'px-5 py-3 text-base' };
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cx('inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed', VARIANTS[variant], sizes[size], className)}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

// ─────────── Form controls ───────────

const control =
  'block w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-stone-900 ring-1 ring-stone-300 placeholder:text-stone-400 focus:ring-2 focus:ring-brand-600 focus:outline-none disabled:bg-stone-100 aria-[invalid=true]:ring-red-500';

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  children: (id: string, describedBy?: string) => ReactNode;
  className?: string;
}

export function Field({ label, error, hint, children, className }: FieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-stone-700">
        {label}
      </label>
      {children(id, describedBy)}
      {error ? (
        <p id={`${id}-err`} className="mt-1 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-stone-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string };
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ label, error, hint, className, ...rest }, ref) {
  return (
    <Field label={label} error={error} hint={hint} className={className}>
      {(id, describedBy) => <input ref={ref} id={id} aria-invalid={!!error} aria-describedby={describedBy} className={control} {...rest} />}
    </Field>
  );
});

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string; hint?: string; options: { value: string; label: string }[] };
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ label, error, hint, options, className, ...rest }, ref) {
  return (
    <Field label={label} error={error} hint={hint} className={className}>
      {(id, describedBy) => (
        <select ref={ref} id={id} aria-invalid={!!error} aria-describedby={describedBy} className={control} {...rest}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
});

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string; hint?: string };
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ label, error, hint, className, ...rest }, ref) {
  return (
    <Field label={label} error={error} hint={hint} className={className}>
      {(id, describedBy) => <textarea ref={ref} id={id} rows={3} aria-invalid={!!error} aria-describedby={describedBy} className={control} {...rest} />}
    </Field>
  );
});

export function Checkbox({ label, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className="flex items-start gap-2 text-sm text-stone-700">
      <input type="checkbox" className="mt-0.5 size-4 rounded border-stone-300 text-brand-700 focus:ring-brand-600" {...rest} />
      <span>{label}</span>
    </label>
  );
}

// ─────────── Layout primitives ───────────

export function Card({ children, className, title, actions }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={cx('rounded-xl bg-white p-4 shadow-sm ring-1 ring-stone-200 sm:p-5', className)}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-stone-600">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, tone = 'default' }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'default' | 'warn' | 'good' }) {
  return (
    <div className={cx('rounded-xl bg-white p-4 shadow-sm ring-1', tone === 'warn' ? 'ring-amber-300' : tone === 'good' ? 'ring-brand-100' : 'ring-stone-200')}>
      <p className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-stone-500">{hint}</p>}
    </div>
  );
}

// ─────────── Status ───────────

const TONES: Record<string, string> = {
  green: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  red: 'bg-red-50 text-red-800 ring-red-200',
  blue: 'bg-sky-50 text-sky-800 ring-sky-200',
  gray: 'bg-stone-100 text-stone-700 ring-stone-200',
};

const STATUS_TONE: Record<string, keyof typeof TONES> = {
  ACTIVE: 'green', APPROVED: 'green', VERIFIED: 'green', COMPLETED: 'green', PAID: 'green', SUCCEEDED: 'green', ONLINE: 'green', CONFIRMED: 'green', RESOLVED: 'green', APPLIED: 'green',
  PENDING: 'amber', APPLIED_MEMBERSHIP: 'amber', UNDER_REVIEW: 'amber', REQUESTED: 'amber', PAYMENT_PENDING: 'amber', OPEN: 'amber', IN_REVIEW: 'amber', HELD: 'amber', SCHEDULED: 'blue', BOARDING: 'blue', DRAFT: 'gray',
  ACCEPTED: 'blue', ARRIVING: 'blue', IN_PROGRESS: 'blue', ON_TRIP: 'blue', ESCALATED: 'red', URGENT: 'red', HIGH: 'amber',
  REJECTED: 'red', SUSPENDED: 'red', CANCELLED: 'gray', EXPIRED: 'gray', NO_DRIVER_AVAILABLE: 'red', NO_SHOW: 'red', PAYMENT_FAILED: 'red', FAILED: 'red', DEACTIVATED: 'gray', OFFLINE: 'gray', INACTIVE: 'gray', WITHDRAWN: 'gray', LEFT: 'gray', NOT_DUE: 'gray',
  REFUNDED: 'blue', PARTIALLY_REFUNDED: 'blue',
};

export function Badge({ children, tone = 'gray' }: { children: ReactNode; tone?: keyof typeof TONES }) {
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', TONES[tone])}>{children}</span>;
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={STATUS_TONE[status] ?? 'gray'}>{label ?? humanize(status)}</Badge>;
}

export function MockLabel({ children = 'Mock — development only' }: { children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-900">
      {children}
    </span>
  );
}

// ─────────── States ───────────

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-stone-500">
      <Loader2 className="size-5 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-stone-300 px-4 py-10 text-center">
      <Inbox className="size-8 text-stone-400" aria-hidden />
      <p className="font-medium text-stone-800">{title}</p>
      {children && <div className="max-w-md text-sm text-stone-600">{children}</div>}
      {action}
    </div>
  );
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const fields = err.fieldErrors;
    if (fields.length) return `${err.message}: ${fields.map((f) => (f.path ? `${f.path} — ${f.message}` : f.message)).join('; ')}`;
    if (Array.isArray(err.details) && err.details.every((d) => typeof d === 'string')) return `${err.message}: ${(err.details as string[]).join('; ')}`;
    return err.message;
  }
  return err instanceof Error ? err.message : 'Something went wrong';
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const reqId = error instanceof ApiError ? error.requestId : undefined;
  return (
    <div role="alert" className="flex flex-col items-start gap-2 rounded-xl bg-red-50 p-4 text-sm text-red-900 ring-1 ring-red-200">
      <p className="flex items-center gap-2 font-medium">
        <AlertTriangle className="size-4" aria-hidden /> {errorMessage(error)}
      </p>
      {reqId && <p className="text-xs text-red-700">Reference: {reqId}</p>}
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Alert({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error' | 'success'; children: ReactNode }) {
  const t = { info: 'bg-sky-50 text-sky-900 ring-sky-200', warn: 'bg-amber-50 text-amber-900 ring-amber-200', error: 'bg-red-50 text-red-900 ring-red-200', success: 'bg-emerald-50 text-emerald-900 ring-emerald-200' };
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cx('rounded-lg p-3 text-sm ring-1', t[tone])}>
      {children}
    </div>
  );
}

/** Wraps the three query states so pages only write the happy path. */
export function QueryState<T>({ query, children, empty }: { query: { data?: T; isLoading: boolean; error: unknown; refetch: () => unknown }; children: (data: T) => ReactNode; empty?: (data: T) => ReactNode | false }) {
  if (query.isLoading) return <Spinner />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  if (query.data === undefined) return null;
  const e = empty?.(query.data);
  if (e) return <>{e}</>;
  return <>{children(query.data)}</>;
}

// ─────────── Modal & confirm ───────────

export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl p-0 shadow-xl backdrop:bg-stone-900/40"
      aria-labelledby="modal-title"
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3">
            <h2 id="modal-title" className="font-semibold">
              {title}
            </h2>
            <button onClick={onClose} className="rounded p-1 text-stone-500 hover:bg-stone-100" aria-label="Close">
              <X className="size-5" />
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-stone-200 px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  tone = 'danger',
  loading,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Go back
          </Button>
          <Button variant={tone} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-stone-700">
        {message}
        {children}
      </div>
    </Modal>
  );
}

// ─────────── Tables ───────────

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

export function DataTable<T>({ rows, columns, rowKey, empty = 'Nothing here yet' }: { rows: T[]; columns: Column<T>[]; rowKey: (row: T) => string; empty?: string }) {
  if (rows.length === 0) return <EmptyState title={empty} />;
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="min-w-full divide-y divide-stone-200 text-sm">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.header} scope="col" className={cx('whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-stone-500', c.className)}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {rows.map((r) => (
            <tr key={rowKey(r)} className="hover:bg-stone-50">
              {columns.map((c) => (
                <td key={c.header} className={cx('px-3 py-2 align-top', c.className)}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <nav className="mt-3 flex items-center justify-between text-sm" aria-label="Pagination">
      <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </Button>
      <span className="text-stone-600">
        Page {page} of {totalPages}
      </span>
      <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
        Next
      </Button>
    </nav>
  );
}

export function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[] }) {
  return (
    <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-stone-200/60 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx('whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium', value === o.value ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function DefinitionList({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-stone-500">{k}</dt>
          <dd className="text-stone-900">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
