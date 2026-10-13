// Shared message board. Everyone sees the same note; it saves as you type.
// Options: note (id, default "board"), placeholder

export default function note(el, opts, { h, api, fmt, on }) {
  const id = encodeURIComponent(opts.note || 'board');
  const area = h('textarea', {
    class: 'field',
    placeholder: opts.placeholder || 'Leave a message for everyone…',
    maxlength: 5000,
    style: { height: '100%', minHeight: '120px', resize: 'none', fontSize: '18px', lineHeight: '1.5' },
  });
  const status = h('div', { class: 'small muted', style: { marginTop: '6px' } });
  el.style.display = 'flex';
  el.style.flexDirection = 'column';
  el.append(area, status);

  let timer;
  area.addEventListener('input', () => {
    status.textContent = 'Saving…';
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const n = await api(`/api/notes/${id}`, { method: 'PUT', body: { text: area.value } });
      status.textContent = `Saved ${fmt.since(n.updatedAt)}`;
    }, 700);
  });

  async function load() {
    if (document.activeElement === area) return;
    const n = await api(`/api/notes/${id}`);
    area.value = n.text;
    status.textContent = n.updatedAt ? `Updated ${fmt.since(n.updatedAt)}` : '';
  }
  load().catch((err) => { status.textContent = err.message; });
  on('notes', load);
}
