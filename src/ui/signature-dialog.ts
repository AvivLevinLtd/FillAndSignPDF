import { processUpload } from '../image';
import { SignaturePad } from './signature-pad';

// Saved signatures live only in this browser (localStorage), never on a server.
const STORAGE_KEY = 'fillandsign.signatures';
const MAX_SAVED = 8;

function loadSaved(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

function writeSaved(list: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_SAVED)));
  } catch {
    // Storage full or blocked: the signature still works for this session.
  }
}

type Tab = 'draw' | 'upload' | 'saved';

const $ = <T extends Element>(root: ParentNode, sel: string) => root.querySelector(sel) as T;

/** Show the signature dialog; resolves to a PNG data URL, or null if cancelled. */
export function openSignatureDialog(): Promise<string | null> {
  const dialog = $<HTMLDialogElement>(document, '#sig-dialog');
  const canvas = $<HTMLCanvasElement>(dialog, '.pad');
  const fileInput = $<HTMLInputElement>(dialog, '#sig-file');
  const preview = $<HTMLImageElement>(dialog, '.upload-preview');
  const removeWhite = $<HTMLInputElement>(dialog, '#sig-remove-white');
  const saveBox = $<HTMLInputElement>(dialog, '#sig-save');
  const useBtn = $<HTMLButtonElement>(dialog, '#sig-use');
  const grid = $<HTMLDivElement>(dialog, '.saved-grid');
  const tabButtons = [...dialog.querySelectorAll<HTMLButtonElement>('[data-tab]')];

  let tab: Tab = 'draw';
  let uploaded: string | null = null;
  let uploadFile: File | null = null;

  const pad = new SignaturePad(canvas, () => refresh());

  const refresh = () => {
    for (const b of tabButtons) {
      b.setAttribute('aria-selected', String(b.dataset.tab === tab));
      b.tabIndex = b.dataset.tab === tab ? 0 : -1; // one tab stop; arrows move between tabs
    }
    for (const p of dialog.querySelectorAll<HTMLElement>('[data-panel]')) p.hidden = p.dataset.panel !== tab;
    useBtn.disabled = tab === 'saved' || (tab === 'draw' ? pad.isEmpty() : !uploaded);
    useBtn.hidden = tab === 'saved';
    saveBox.parentElement!.hidden = tab === 'saved';
    preview.hidden = !uploaded;
    if (uploaded) preview.src = uploaded;
  };

  const renderSaved = () => {
    const saved = loadSaved();
    grid.replaceChildren(
      ...saved.map((src, i) => {
        const item = document.createElement('div');
        item.className = 'saved-item';
        const pick = document.createElement('button');
        pick.type = 'button';
        pick.className = 'saved-pick';
        pick.title = 'Use this signature';
        pick.innerHTML = `<img alt="Saved signature ${i + 1}">`;
        pick.querySelector('img')!.src = src;
        pick.onclick = () => finish(src, false);
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'saved-delete';
        del.title = 'Delete this saved signature';
        del.setAttribute('aria-label', `Delete saved signature ${i + 1}`);
        del.textContent = '×';
        del.onclick = () => {
          writeSaved(loadSaved().filter((_, j) => j !== i));
          renderSaved();
        };
        item.append(pick, del);
        return item;
      }),
    );
    $<HTMLElement>(dialog, '.saved-empty').hidden = saved.length > 0;
  };

  const reprocessUpload = async () => {
    if (!uploadFile) return;
    try {
      uploaded = await processUpload(uploadFile, removeWhite.checked);
    } catch (err) {
      uploaded = null;
      alertInDialog(dialog, err instanceof Error ? err.message : String(err));
    }
    refresh();
  };

  let resolve!: (v: string | null) => void;
  const finish = (src: string | null, save: boolean) => {
    if (src && save) writeSaved([src, ...loadSaved().filter((s) => s !== src)]);
    cleanup();
    dialog.close();
    resolve(src);
  };

  const selectTab = (t: Tab) => {
    tab = t;
    if (t === 'saved') renderSaved();
    refresh();
    if (t === 'draw') pad.resize();
  };
  const onTab = (e: Event) => selectTab((e.currentTarget as HTMLElement).dataset.tab as Tab);
  const onTabKey = (e: KeyboardEvent) => {
    const i = tabButtons.findIndex((b) => b.dataset.tab === tab);
    const next =
      e.key === 'ArrowRight' ? (i + 1) % tabButtons.length
      : e.key === 'ArrowLeft' ? (i - 1 + tabButtons.length) % tabButtons.length
      : e.key === 'Home' ? 0
      : e.key === 'End' ? tabButtons.length - 1
      : -1;
    if (next < 0) return;
    e.preventDefault();
    selectTab(tabButtons[next].dataset.tab as Tab);
    tabButtons[next].focus();
  };
  const onColor = (e: Event) => {
    pad.color = (e.target as HTMLInputElement).value;
  };
  const onClear = () => pad.clear();
  const onFile = () => {
    uploadFile = fileInput.files?.[0] ?? null;
    void reprocessUpload();
  };
  const onUse = () => {
    const src = tab === 'draw' ? pad.toDataUrl() : uploaded;
    finish(src, saveBox.checked);
  };
  const onClose = () => {
    cleanup();
    resolve(null);
  };

  const tabList = $<HTMLElement>(dialog, '[role="tablist"]');
  const colorInputs = [...dialog.querySelectorAll<HTMLInputElement>('input[name="sig-color"]')];
  const clearBtn = $<HTMLButtonElement>(dialog, '#sig-clear');
  tabButtons.forEach((b) => b.addEventListener('click', onTab));
  tabList.addEventListener('keydown', onTabKey);
  colorInputs.forEach((c) => c.addEventListener('change', onColor));
  clearBtn.addEventListener('click', onClear);
  fileInput.addEventListener('change', onFile);
  removeWhite.addEventListener('change', reprocessUpload);
  useBtn.addEventListener('click', onUse);
  dialog.addEventListener('close', onClose);

  function cleanup() {
    tabButtons.forEach((b) => b.removeEventListener('click', onTab));
    tabList.removeEventListener('keydown', onTabKey);
    colorInputs.forEach((c) => c.removeEventListener('change', onColor));
    clearBtn.removeEventListener('click', onClear);
    fileInput.removeEventListener('change', onFile);
    removeWhite.removeEventListener('change', reprocessUpload);
    useBtn.removeEventListener('click', onUse);
    dialog.removeEventListener('close', onClose);
    fileInput.value = '';
  }

  // Open on the Saved tab when there is something to reuse.
  tab = loadSaved().length > 0 ? 'saved' : 'draw';
  colorInputs.forEach((c) => (c.checked = c.value === pad.color));
  renderSaved();
  refresh();
  dialog.showModal();
  pad.resize();

  return new Promise((r) => (resolve = r));
}

function alertInDialog(dialog: HTMLDialogElement, message: string): void {
  const el = $<HTMLElement>(dialog, '.sig-error');
  el.textContent = message;
  el.hidden = false;
  setTimeout(() => (el.hidden = true), 4000);
}
