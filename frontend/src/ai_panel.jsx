import React, {useEffect, useState} from 'react';
import {request} from './account.jsx';

const STATUS = {uploading: '正在上传', queued: '排队中', running: '分析中', done: '已完成', failed: '失败'};

export function AIAnalysisPanel({cid}) {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    try {
      const data = await request(`/api/clients/${cid}/ai-analysis`);
      setItems(data.items || []);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { void load(); }, [cid]);

  useEffect(() => {
    const latest = items[0];
    if (!latest || !['uploading', 'queued', 'running'].includes(latest.status)) return;
    const timer = setInterval(load, 2500);
    return () => clearInterval(timer);
  }, [items[0]?.id, items[0]?.status, cid]);

  async function start() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await request(`/api/clients/${cid}/ai-analysis`, {});
      setNotice('已提交，AI 正在阅读原件；完成后会显示在这里。');
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const latest = items[0];

  return <section className="card ai-panel">
    <div className="section-title">
      <h2>AI 辅助分析</h2>
      <p>基于原件文字与页面视觉生成摘要、异常点和需核实问题；不替代规则结论，不自动签发报告。</p>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="success" role="status">{notice}</p>}
    <div className="actions-row">
      <button className="primary" disabled={busy} onClick={() => void start()}>{busy ? '提交中…' : '生成 AI 辅助分析'}</button>
      <button className="ghost" onClick={() => void load()}>刷新</button>
    </div>
    {latest && <div className="ai-result">
      <p className="muted">状态：<span className={`badge ${latest.status === 'done' ? '' : 'amber'}`}>{STATUS[latest.status] || latest.status}</span>{latest.error ? ` · ${latest.error}` : ''}</p>
      {latest.result?.summary && <p className="ai-summary">{latest.result.summary}</p>}
      {latest.result?.income_structure?.length > 0 && <div><h3>收入结构</h3><ul>{latest.result.income_structure.map((row, i) => <li key={i}>{row.source} · {row.amount} <small>{row.evidence}</small></li>)}</ul></div>}
      {latest.result?.anomalies?.length > 0 && <div><h3>异常点</h3><ul>{latest.result.anomalies.map((row, i) => <li key={i}>{row.item} <small>{row.evidence}</small></li>)}</ul></div>}
      {latest.result?.questions?.length > 0 && <div><h3>建议核实</h3><ul>{latest.result.questions.map((row, i) => <li key={i}>{row}</li>)}</ul></div>}
      {latest.result?.disclaimer && <p className="muted">{latest.result.disclaimer}</p>}
    </div>}
    {items.length > 1 && <details><summary>历史分析（{items.length}）</summary><ul>{items.slice(1).map((item) => <li key={item.id}>{new Date(item.created).toLocaleString('zh-CN')} · {STATUS[item.status] || item.status}</li>)}</ul></details>}
  </section>;
}
