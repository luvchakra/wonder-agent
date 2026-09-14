import { cn } from "@/lib/utils";

/**
 * Shared form-field primitives so every restyled bare form (this session's
 * EXPERIENCE-P0-03/09 rollout) uses one consistent input/select/textarea
 * treatment instead of each page hand-rolling its own className string —
 * per docs/design/UI-UX-DESIGN-RULES.md's design-consistency section.
 */
export const fieldInputClass =
  "block w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";
export const fieldLabelClass = "mb-1 block text-sm font-medium text-muted-foreground";

export function Field({ label, htmlFor, hint, required, children }: { label: string; htmlFor: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className={fieldLabelClass}>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function TextField({
  label,
  name,
  hint,
  className,
  ...props
}: { label: string; hint?: string; className?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} htmlFor={name!} hint={hint} required={props.required}>
      <input id={name} name={name} className={cn(fieldInputClass, className)} {...props} />
    </Field>
  );
}

export function TextareaField({
  label,
  name,
  hint,
  className,
  ...props
}: { label: string; hint?: string; className?: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Field label={label} htmlFor={name!} hint={hint} required={props.required}>
      <textarea id={name} name={name} className={cn(fieldInputClass, className)} {...props} />
    </Field>
  );
}

export function SelectField({
  label,
  name,
  hint,
  className,
  children,
  ...props
}: { label: string; hint?: string; className?: string; children: React.ReactNode } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Field label={label} htmlFor={name!} hint={hint} required={props.required}>
      <select id={name} name={name} className={cn(fieldInputClass, className)} {...props}>
        {children}
      </select>
    </Field>
  );
}
