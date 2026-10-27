import type { ReactNode } from "react";
import { CalendarDays, FileText } from "lucide-react";
export { money, date } from "../domain/format";
export const dateTime = (value: string) =>
  new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value)) + " น. เวลาไทย";
export const field = (data: FormData, key: string) =>
  String(data.get(key) || "");
export const cents = (data: FormData, key: string) =>
  Math.round(Number(field(data, key)) * 100);
export function Button({
  children,
  onClick,
  secondary = false,
  type = "button",
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  secondary?: boolean;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      className={secondary ? "button secondary" : "button"}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
export function Input({
  label,
  name,
  type = "text",
  value,
  required = false,
  hint,
  min,
  max,
  step,
}: {
  label: string;
  name: string;
  type?: string;
  value?: string | number;
  required?: boolean;
  hint?: string;
  min?: string;
  max?: string;
  step?: string;
}) {
  return (
    <label className="field">
      {label}
      <input
        name={name}
        type={type}
        defaultValue={value}
        required={required}
        min={type === "password" ? undefined : min}
        minLength={type === "password" && min ? Number(min) : undefined}
        max={max}
        step={step}
      />
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Empty({
  title,
  text,
  children,
  calendar = false,
}: {
  title: string;
  text?: string;
  children?: ReactNode;
  calendar?: boolean;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        {calendar ? <CalendarDays /> : <FileText />}
      </span>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {children}
    </div>
  );
}
