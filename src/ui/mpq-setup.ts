// 첫 접속 화면: 유저가 자기 Diablo II 설치 폴더의 MPQ 를 고르면 이 브라우저(IndexedDB)에 보관한다.
// 파일은 서버로 보내지 않는다. 다음 접속부터는 보관된 파일로 곧바로 시작한다.
import { editionOf, LOD_MPQS } from '../assets/edition';
import { ALL_MPQS, canonicalName, isMpq, MpqStore, OPTIONAL_MPQS } from '../assets/local-mpq';

const CSS = `
#mpq-setup { width: 800px; height: 600px; box-sizing: border-box; padding: 48px 64px; background: #000; color: #c7b377;
  font: 16px serif; display: flex; flex-direction: column; gap: 14px; }
#mpq-setup h1 { margin: 0 0 8px; font-size: 28px; color: #d8c690; letter-spacing: 1px; }
#mpq-setup p { margin: 0; line-height: 1.5; }
#mpq-setup .muted { color: #8f8563; font-size: 14px; }
#mpq-setup .drop { border: 1px dashed #6b5f3c; padding: 22px; text-align: center; }
#mpq-setup .drop.over { border-color: #d8c690; background: #151208; }
#mpq-setup button { background: #1a160c; color: #d8c690; border: 1px solid #6b5f3c; padding: 8px 16px; font: 15px serif; cursor: pointer; margin: 0 6px; }
#mpq-setup button:hover { border-color: #d8c690; }
#mpq-setup button:disabled { opacity: .4; cursor: default; }
#mpq-setup ul { margin: 0; padding: 0; list-style: none; columns: 2; font-size: 14px; }
#mpq-setup li.ok::before { content: '✓ '; color: #7fbf5f; }
#mpq-setup li.no::before { content: '· '; }
#mpq-setup li.no.req { color: #d05040; }
#mpq-setup .status { min-height: 20px; }
#mpq-setup .edition { color: #d8c690; }
#mpq-setup .err { color: #d05040; }
`;

/**
 * 보관된 MPQ 가 필수 3개를 모두 갖췄으면 곧바로, 아니면 고르는 화면을 띄우고 다 고르면 돌려준다.
 * reopen: 이미 갖췄어도 화면을 띄운다 (메인 메뉴 "Game Files" — 확장팩·소리 파일을 더 넣거나 바꾼다)
 */
export async function ensureLocalMpqs(host: HTMLElement, reopen = false): Promise<Map<string, Blob>> {
  const have = await MpqStore.all();
  if (!reopen && MpqStore.missing(have).length === 0) return have;
  void navigator.storage?.persist?.().catch(() => false);
  return new Promise((done) => showSetup(host, have, done, reopen));
}

function showSetup(host: HTMLElement, have: Map<string, Blob>, done: (m: Map<string, Blob>) => void, reopen: boolean): void {
  const style = document.createElement('style');
  style.textContent = CSS;
  const root = document.createElement('div');
  root.id = 'mpq-setup';
  root.innerHTML = `
    <h1>Diablo II 원작 파일 불러오기</h1>
    ${reopen
      ? `<p>✓ 표시는 이 브라우저에 보관된 파일입니다. 확장팩(d2exp.mpq 등)이나 소리 파일을 더 넣거나, 같은 이름의 파일을 넣어 바꿀 수 있습니다.</p>
         <p class="muted">확장팩으로 바꾸려면 확장팩 설치 폴더를 통째로 고르세요 (patch_d2·d2char 가 확장팩판으로 바뀌고 d2exp 가 더해집니다).</p>`
      : `<p>가지고 계신 Diablo II (1.14d) 설치 폴더의 MPQ 파일을 선택하세요.</p>
         <p class="muted">확장팩(Lord of Destruction)을 설치한 폴더면 확장팩으로, 클래식만 설치했으면 클래식으로 시작합니다.</p>`}
    <p class="muted">파일은 서버로 전송되지 않고 이 브라우저에만 저장됩니다. 한 번만 하면 다음부터는 바로 시작합니다.</p>
    <div class="drop">
      <p>여기로 MPQ 파일(또는 폴더)을 끌어다 놓거나</p><br>
      <button type="button" data-pick="files">파일 선택</button>
      <button type="button" data-pick="dir">폴더 선택</button>
      <input type="file" multiple accept=".mpq" data-input="files" hidden>
      <input type="file" webkitdirectory data-input="dir" hidden>
    </div>
    <ul></ul>
    <p class="edition"></p>
    <p class="status"></p>
    <p><button type="button" data-start disabled>시작</button>${reopen ? '<button type="button" data-clear>보관한 파일 모두 지우기</button>' : ''}</p>`;
  host.replaceChildren(style, root);

  const list = root.querySelector('ul')!;
  const status = root.querySelector('.status') as HTMLElement;
  const edition = root.querySelector('.edition') as HTMLElement;
  const start = root.querySelector('[data-start]') as HTMLButtonElement;
  const clear = root.querySelector('[data-clear]') as HTMLButtonElement | null;
  const drop = root.querySelector('.drop') as HTMLElement;
  let busy = false;

  const render = (): void => {
    list.innerHTML = ALL_MPQS.map((n) => {
      const lod = (LOD_MPQS as readonly string[]).includes(n);
      const req = !lod && !(OPTIONAL_MPQS as readonly string[]).includes(n);
      const tag = lod ? ' <span class="muted">(확장팩)</span>' : req ? '' : ' <span class="muted">(소리)</span>';
      return `<li class="${have.has(n) ? 'ok' : 'no'}${req ? ' req' : ''}">${n}${tag}</li>`;
    }).join('');
    edition.textContent = editionOf(have.keys()) === 'lod' ? '확장팩(Lord of Destruction)으로 시작합니다' : '클래식으로 시작합니다 (확장팩: d2exp.mpq 필요)';
    const miss = MpqStore.missing(have);
    const quiet = OPTIONAL_MPQS.filter((n) => !have.has(n));
    start.disabled = busy || miss.length > 0;
    if (clear) clear.disabled = busy;
    if (busy) return;
    if (miss.length) status.innerHTML = `<span class="err">필요한 파일: ${miss.join(', ')}</span>`;
    else if (quiet.length) status.textContent = `소리 파일이 없어 소리 없이 시작합니다 (${quiet.join(', ')})`;
    else status.textContent = '준비 완료';
  };

  const add = async (files: File[]): Promise<void> => {
    if (busy) return;
    busy = true;
    render();
    const skipped: string[] = [];
    const picked = files.filter((f) => canonicalName(f.name));
    let n = 0;
    try {
      for (const f of picked) {
        const name = canonicalName(f.name)!;
        status.textContent = `저장 중… ${++n}/${picked.length} ${name} (${Math.round(f.size / 1048576)}MB)`;
        if (!(await isMpq(f))) {
          skipped.push(f.name);
          continue;
        }
        await MpqStore.put(name, f);
        have.set(name, f);
      }
      // IndexedDB 에 들어간 사본(디스크)을 쓴다 — 원래 File 은 선택 폴더가 바뀌면 못 읽을 수 있다
      const stored = await MpqStore.all();
      for (const [k, v] of stored) have.set(k, v);
    } catch (e) {
      busy = false;
      render();
      status.innerHTML = `<span class="err">저장 실패: ${(e as Error).message} (브라우저 저장 공간을 확인하세요)</span>`;
      return;
    }
    busy = false;
    render();
    if (skipped.length) status.innerHTML += `<br><span class="err">MPQ 가 아닌 파일은 건너뜀: ${skipped.join(', ')}</span>`;
    if (picked.length === 0 && files.length) status.innerHTML += '<br><span class="err">알맞은 MPQ 파일 이름이 없습니다</span>';
  };

  for (const b of root.querySelectorAll<HTMLButtonElement>('[data-pick]')) {
    b.onclick = () => (root.querySelector(`[data-input="${b.dataset.pick}"]`) as HTMLInputElement).click();
  }
  for (const inp of root.querySelectorAll<HTMLInputElement>('[data-input]')) {
    inp.onchange = () => {
      void add([...(inp.files ?? [])]);
      inp.value = '';
    };
  }
  drop.ondragover = (e) => {
    e.preventDefault();
    drop.classList.add('over');
  };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    void droppedFiles(e.dataTransfer).then(add);
  };
  // 보관한 MPQ 만 지운다 (캐릭터 저장은 다른 DB). 지우면 필수 파일이 빠져 시작이 꺼지고, 다시 넣으면 켜진다
  if (clear) clear.onclick = () => {
    if (busy) return;
    busy = true;
    render();
    void MpqStore.clear().then(() => {
      have.clear();
      busy = false;
      render();
    });
  };
  start.onclick = () => {
    if (start.disabled) return;
    host.replaceChildren();
    done(have);
  };
  render();
}

/** 끌어다 놓은 파일 (폴더면 그 안의 파일까지) */
async function droppedFiles(dt: DataTransfer | null): Promise<File[]> {
  if (!dt) return [];
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  if (!entries.length) return [...dt.files];
  const out: File[] = [];
  const walk = async (e: FileSystemEntry): Promise<void> => {
    if (e.isFile) {
      out.push(await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej)));
    } else if (e.isDirectory) {
      const reader = (e as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const c of batch) await walk(c);
      }
    }
  };
  for (const e of entries) await walk(e);
  return out;
}
