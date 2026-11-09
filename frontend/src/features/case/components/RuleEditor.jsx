import React, { useState } from "react";
import { Field, Form } from "@/shared/ui/Form.jsx";
import { Select } from "@/shared/ui/FormRow.jsx";
import { TrashIcon } from "@/shared/ui/icons.jsx";

export function RuleEditor({ rules, busy, onSave }) {
  const [related, setRelated] = useState(rules.related || []);

  return (
    <details className="card">
      <summary>
        客户独立规则与关联名单
        {related.length > 0 && `（${related.length}/50）`}
      </summary>
      <p className="muted">
        完整账号优先匹配；未填账号时使用完整姓名。规则修改会使已提交的复核失效。
      </p>
      <Form
        onSave={(form) =>
          onSave({
            ...rules,
            related,
            require_counterparty: form.has("require_counterparty"),
            positive: String(form.get("positive"))
              .split(/[，,\n]/)
              .map((value) => value.trim())
              .filter(Boolean),
            negative: String(form.get("negative"))
              .split(/[，,\n]/)
              .map((value) => value.trim())
              .filter(Boolean),
          })
        }
      >
        {related.map((person, index) => (
          <div className="relation" key={index}>
            <input
              aria-label="关联人姓名"
              placeholder="完整姓名"
              value={person.name}
              onChange={(event) =>
                setRelated(
                  related.map((value, current) =>
                    current === index
                      ? { ...value, name: event.target.value }
                      : value,
                  ),
                )
              }
            />
            <input
              aria-label="关联人账号"
              placeholder="完整账号（选填）"
              value={person.account}
              onChange={(event) =>
                setRelated(
                  related.map((value, current) =>
                    current === index
                      ? { ...value, account: event.target.value }
                      : value,
                  ),
                )
              }
            />
            <Select
              aria-label="关联人往来处理"
              label="关联人往来处理"
              value={person.mode}
              onChange={(event) =>
                setRelated(
                  related.map((value, current) =>
                    current === index
                      ? { ...value, mode: event.target.value }
                      : value,
                  ),
                )
              }
            >
              <option value="pending">待核实</option>
              <option value="excluded">剔除</option>
            </Select>
            <button
              type="button"
              className="ghost relation-remove"
              aria-label={`移除第 ${index + 1} 位关联人`}
              title="移除"
              onClick={() =>
                setRelated(related.filter((_, current) => index !== current))
              }
            >
              <TrashIcon size={14} />
            </button>
          </div>
        ))}
        <button
          type="button"
          disabled={related.length >= 50}
          onClick={() =>
            setRelated([...related, { name: "", account: "", mode: "pending" }])
          }
        >
          ＋ 添加关联人
        </button>
        <div className="grid2">
          <Field label="正向关键词（逗号分隔）">
            <textarea name="positive" defaultValue={rules.positive.join("，")} />
          </Field>
          <Field label="负向关键词（逗号分隔）">
            <textarea name="negative" defaultValue={rules.negative.join("，")} />
          </Field>
        </div>
        <label className="check">
          <input
            type="checkbox"
            name="require_counterparty"
            defaultChecked={rules.require_counterparty}
          />
          银行卡未提供对手姓名及账号时标为待核实
        </label>
        <div className="actions-end">
          <button className="primary" disabled={busy}>
            保存客户规则
          </button>
        </div>
      </Form>
    </details>
  );
}
