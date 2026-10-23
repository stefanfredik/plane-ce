/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
// plane imports
import { useTranslation } from "@plane/i18n";
import type { TIntakeSubmission, TPublicIntakeField, TPublicIntakeForm } from "@plane/services";
import { SitesIntakeFormService } from "@plane/services";
import { cn } from "@plane/utils";
// components
import { PoweredBy } from "@/components/common/powered-by";
import type { Route } from "./+types/page";

const service = new SitesIntakeFormService();

const INPUT =
  "w-full rounded-md border-[0.5px] border-strong bg-surface-1 px-3 py-2 text-13 text-primary outline-none focus:border-accent-strong";

type TErrors = Record<string, string>;

/** One custom property on the public form; values travel as lists of strings like everywhere else. */
function FieldInput(props: { field: TPublicIntakeField; value: string[]; onChange: (value: string[]) => void }) {
  const { field, value, onChange } = props;
  const { t } = useTranslation();
  const first = value[0] ?? "";
  const one = (text: string) => onChange(text.trim() ? [text] : []);
  switch (field.property_type) {
    case "PARAGRAPH":
      return <textarea className={cn(INPUT, "min-h-20")} value={first} onChange={(e) => one(e.target.value)} />;
    case "NUMBER":
      return <input type="number" className={INPUT} value={first} onChange={(e) => one(e.target.value)} />;
    case "DATE":
      return <input type="date" className={INPUT} value={first} onChange={(e) => one(e.target.value)} />;
    case "URL":
      return (
        <input
          type="url"
          className={INPUT}
          value={first}
          onChange={(e) => one(e.target.value)}
          placeholder="https://"
        />
      );
    case "EMAIL":
      return <input type="email" className={INPUT} value={first} onChange={(e) => one(e.target.value)} />;
    case "BOOLEAN":
      return (
        <label className="flex items-center gap-2 text-13 text-secondary">
          <input
            type="checkbox"
            checked={first === "true"}
            onChange={(e) => onChange([e.target.checked ? "true" : "false"])}
          />
          {t("intake_form.yes")}
        </label>
      );
    case "OPTION":
      if (field.is_multi)
        return (
          <div className="flex flex-wrap gap-2">
            {field.options.map((option) => (
              <label key={option.id} className="flex items-center gap-1.5 text-13 text-secondary">
                <input
                  type="checkbox"
                  checked={value.includes(option.id)}
                  onChange={(e) =>
                    onChange(e.target.checked ? [...value, option.id] : value.filter((id) => id !== option.id))
                  }
                />
                {option.name}
              </label>
            ))}
          </div>
        );
      return (
        <select className={INPUT} value={first} onChange={(e) => one(e.target.value)}>
          <option value="">{t("intake_form.select")}</option>
          {field.options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      );
    case "CASCADING": {
      // second-level options, shown with their parent
      const leaves = field.options.filter((o) => !field.options.some((child) => child.parent_id === o.id));
      const parentName = (id: string | null) => field.options.find((o) => o.id === id)?.name;
      return (
        <select className={INPUT} value={first} onChange={(e) => one(e.target.value)}>
          <option value="">{t("intake_form.select")}</option>
          {leaves.map((option) => (
            <option key={option.id} value={option.id}>
              {option.parent_id ? `${parentName(option.parent_id)} › ${option.name}` : option.name}
            </option>
          ))}
        </select>
      );
    }
    default:
      return <input className={INPUT} value={first} onChange={(e) => one(e.target.value)} maxLength={255} />;
  }
}

const fieldLabel = (text: string, required: boolean, htmlFor?: string) => (
  <label htmlFor={htmlFor} className="text-12 font-medium text-primary">
    {text}
    {required && <span className="text-danger-primary"> *</span>}
  </label>
);

export default function IntakeFormPage({ params }: Route.ComponentProps) {
  const { anchor } = params;
  const { t } = useTranslation();
  const [form, setForm] = useState<TPublicIntakeForm | null | undefined>(undefined);
  const [data, setData] = useState<TIntakeSubmission>({ name: "", email: "", title: "", description: "", values: {} });
  const [errors, setErrors] = useState<TErrors>({});
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent] = useState<{ reference?: string } | null>(null);

  useEffect(() => {
    service
      .retrieve(anchor)
      .then(setForm)
      .catch(() => setForm(null));
  }, [anchor]);

  const set = (key: keyof TIntakeSubmission) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setData((prev) => ({ ...prev, [key]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSending(true);
    setErrors({});
    try {
      setSent(await service.submit(anchor, data));
    } catch (error) {
      const response = error as { errors?: TErrors; error?: string; detail?: string } | undefined;
      setErrors(response?.errors ?? { form: response?.detail ?? response?.error ?? "Error" });
    } finally {
      setIsSending(false);
    }
  };

  const error = (key: string) => errors[key] && <p className="text-11 text-danger-primary">{errors[key]}</p>;

  return (
    <div className="flex min-h-screen w-full justify-center overflow-y-auto bg-surface-2 px-4 py-10">
      <div className="w-full max-w-xl">
        {form === undefined ? (
          <div className="h-64 animate-pulse rounded-lg bg-layer-1" />
        ) : form === null ? (
          <div className="rounded-lg border-[0.5px] border-subtle bg-surface-1 p-8 text-center text-13 text-secondary">
            {t("intake_form.unavailable")}
          </div>
        ) : sent ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border-[0.5px] border-subtle bg-surface-1 p-8 text-center">
            <CheckCircle2 className="size-10 text-success-primary" />
            <h1 className="text-16 font-semibold text-primary">{t("intake_form.sent")}</h1>
            <p className="text-13 text-secondary">{form.success_message || t("intake_form.success_placeholder")}</p>
            {sent.reference && (
              <p className="text-12 text-tertiary">{t("intake_form.sent_reference", { reference: sent.reference })}</p>
            )}
            <button
              type="button"
              className="mt-2 text-13 font-medium text-accent-primary hover:underline"
              onClick={() => {
                setSent(null);
                setData({ name: data.name, email: data.email, title: "", description: "", values: {} });
              }}
            >
              {t("intake_form.send_another")}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5 rounded-lg border-[0.5px] border-subtle bg-surface-1 p-6">
            <div className="space-y-1">
              <p className="text-12 text-tertiary">
                {form.workspace.name} · {form.project.name}
              </p>
              <h1 className="text-18 font-semibold text-primary">{form.title}</h1>
              {form.description && <p className="text-13 whitespace-pre-line text-secondary">{form.description}</p>}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                {fieldLabel(t("intake_form.name"), true, "intake-name")}
                <input id="intake-name" className={INPUT} value={data.name} onChange={set("name")} maxLength={255} />
                {error("name")}
              </div>
              <div className="space-y-1">
                {fieldLabel(t("intake_form.email"), form.require_email, "intake-email")}
                <input id="intake-email" type="email" className={INPUT} value={data.email} onChange={set("email")} />
                {error("email")}
              </div>
            </div>
            <div className="space-y-1">
              {fieldLabel(t("intake_form.work_item_title"), true, "intake-title")}
              <input id="intake-title" className={INPUT} value={data.title} onChange={set("title")} maxLength={255} />
              {error("title")}
            </div>
            <div className="space-y-1">
              {fieldLabel(t("intake_form.work_item_description"), false, "intake-description")}
              <textarea
                id="intake-description"
                className={cn(INPUT, "min-h-28")}
                value={data.description}
                onChange={set("description")}
              />
              {error("description")}
            </div>
            {form.fields.map((field) => (
              <div key={field.id} className="space-y-1">
                {fieldLabel(field.name, field.is_required)}
                {field.description && <p className="text-11 text-tertiary">{field.description}</p>}
                <FieldInput
                  field={field}
                  value={data.values[field.id] ?? []}
                  onChange={(value) => setData((prev) => ({ ...prev, values: { ...prev.values, [field.id]: value } }))}
                />
                {error(field.id)}
              </div>
            ))}
            {/* hidden from people; bots fill it in */}
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden
              className="hidden"
              value={data.website ?? ""}
              onChange={set("website")}
            />
            {error("form")}
            <button
              type="submit"
              disabled={isSending}
              className="w-full rounded-md bg-accent-primary px-4 py-2 text-13 font-medium text-on-color hover:bg-accent-primary-hover disabled:opacity-60"
            >
              {isSending ? t("intake_form.sending") : t("intake_form.submit")}
            </button>
          </form>
        )}
        <PoweredBy />
      </div>
    </div>
  );
}
