let csrfToken = '';
export function setCsrf(value: string) { csrfToken = value; }
export async function api<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(`/api${path}`, { method: body === undefined ? 'GET' : method, credentials: 'same-origin', headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result: unknown = await response.json();
  if (!response.ok) throw new Error(typeof result === 'object' && result !== null && 'error' in result && typeof result.error === 'string' ? result.error : 'ไม่สามารถทำรายการได้');
  // The same-origin API owns validation and its response models are shared in domain/types.
  return result as T;
}
export async function restoreBackup(file: File): Promise<{ borrowers: number; loans: number }> {
  const response = await fetch('/api/restore', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }, body: file });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'นำข้อมูลสำรองกลับมาไม่สำเร็จ');
  return result;
}
export async function upload(file: File, ids: Record<string, string>) {
  const response = await fetch(`/api/attachments?${new URLSearchParams(ids)}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type, 'X-Filename': encodeURIComponent(file.name), 'X-CSRF-Token': csrfToken }, body: file });
  if (!response.ok) { const result = await response.json(); throw new Error(result.error || 'แนบไฟล์ไม่สำเร็จ'); }
}
