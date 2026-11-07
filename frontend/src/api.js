let csrf = '';

export function setCsrf(value) {
  csrf = value || '';
}

export async function api(path, body) {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: body instanceof FormData
      ? { 'X-CSRF-Token': csrf }
      : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/login') location.assign('/login');
    throw new Error(data.error || '请求未完成，请稍后重试');
  }
  return data;
}

export function yuan(value) {
  if (value == null) return '—';
  return (Number(value) / 100).toFixed(2);
}

export function points(value) {
  if (value == null) return '—';
  return Number(value).toLocaleString('zh-CN');
}
