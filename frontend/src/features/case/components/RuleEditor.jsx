import React, { useState } from "react";
import { Field, Form } from "@/shared/ui/Form.jsx";
import { Select } from "@/shared/ui/FormRow.jsx";
import { FoldPanel } from "@/shared/ui/FoldPanel.jsx";
import { TrashIcon } from "@/shared/ui/icons.jsx";

export function RuleEditor({ rules, busy, onSave }) {
  const [related, setRelated] = useState(rules.related || []);

  function updatePerson(index, patch) {
    setRelated((rows) =>
      rows.map((row, current) =>
        current === index ? { ...row, ...patch } : row,
      ),
    );
  }

  return (
    <FoldPanel
      className="card fold-panel--card rule-editor-panel"
      title="客户独立规则与关联名单"
      badge={
        related.length > 0 ? (
          <em className="fold-panel-badge">{related.length}/50</em>
        ) : null
      }
    >
      <p className="muted rule-editor-hint">
        完整账号优先匹配；未填账号时使用完整姓名。规则修改会使已提交的复核失效。
      </p>
      <Form
        className="rule-editor-form"
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
        <section className="rule-section">
          <div className="rule-section-head">
            <strong>关联人</strong>
            <button
              type="button"
              className="ghost rule-add"
              disabled={related.length >= 50}
              onClick={() =>
                setRelated([
                  ...related,
                  { name: "", account: "", mode: "pending" },
                ])
              }
            >
              ＋ 添加关联人
            </button>
          </div>
          {related.length === 0 ? (
            <p className="muted rule-empty">暂无关联人，需要时再添加。</p>
          ) : (
            <div className="relation-list">
              <div className="relation relation-head" aria-hidden="true">
                <span>姓名</span>
                <span>账号（选填）</span>
                <span>处理</span>
                <span />
              </div>
              {related.map((person, index) => (
                <div className="relation" key={index}>
                  <input
                    aria-label="关联人姓名"
                    placeholder="完整姓名"
                    value={person.name}
                    onChange={(event) =>
                      updatePerson(index, { name: event.target.value })
                    }
                  />
                  <input
                    aria-label="关联人账号"
                    placeholder="完整账号"
                    value={person.account}
                    onChange={(event) =>
                      updatePerson(index, { account: event.target.value })
                    }
                  />
                  <Select
                    aria-label="关联人往来处理"
                    label="关联人往来处理"
                    className="relation-mode"
                    value={person.mode}
                    onChange={(event) =>
                      updatePerson(index, { mode: event.target.value })
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
                      setRelated((rows) =>
                        rows.filter((_, current) => current !== index),
                      )
                    }
                  >
                    <TrashIcon size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rule-section">
          <div className="rule-section-head">
            <strong>关键词</strong>
          </div>
          <div className="grid2 rule-keywords">
            <Field label="正向（逗号分隔）">
              <textarea
                name="positive"
                rows={3}
                defaultValue={rules.positive.join("，")}
              />
            </Field>
            <Field label="负向（逗号分隔）">
              <textarea
                name="negative"
                rows={3}
                defaultValue={rules.negative.join("，")}
              />
            </Field>
          </div>
        </section>

        <div className="form-footer">
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
        </div>
      </Form>
    </FoldPanel>
  );
}
