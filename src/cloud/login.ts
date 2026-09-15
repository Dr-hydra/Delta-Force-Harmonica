/** Only explicit account actions use this wrapper. Background reads stay silent. */
export function isToyLoginRequired(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { code?: unknown; reason?: unknown; type?: unknown };
  return value.code === -101 || value.code === '-101'
    || value.reason === 'not_logged_in' || value.type === 'not_logged_in';
}

let pendingLogin: Promise<void> | null = null;

function requestLogin(): Promise<void> {
  if (pendingLogin) return pendingLogin;
  pendingLogin = new Promise<void>((resolve, reject) => {
    const previousFocus = document.activeElement;
    const dialog = document.createElement('dialog');
    dialog.className = 'toy-login-dialog';
    dialog.setAttribute('aria-label', '登录 B站后继续');
    const title = document.createElement('h2');
    title.textContent = '此功能需要登录 B站';
    const description = document.createElement('p');
    description.textContent = '已尝试打开官方登录页。如未弹出，请点击“打开登录页”。登录后回到这里继续，当前乐谱会保留。B站 App 内请先完成账号登录。';
    const buttons = document.createElement('div');
    buttons.className = 'toy-login-actions';
    const finish = (accepted: boolean) => {
      dialog.remove();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
      if (accepted) resolve(); else reject(new Error('已取消登录，可继续使用本地转换与编辑'));
    };
    const open = () => {
      try { window.open('https://passport.bilibili.com/login', '_blank', 'noopener,noreferrer'); }
      catch { description.textContent = '浏览器阻止了登录窗口，请先在 B站登录，再回到这里点击“登录后继续”。'; }
    };
    for (const [label, action] of [
      ['打开登录页', open], ['登录后继续', () => finish(true)], ['暂不登录', () => finish(false)]
    ] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button';
      button.textContent = label;
      button.onclick = action;
      buttons.append(button);
    }
    dialog.append(title, description, buttons);
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(false); });
    document.body.append(dialog);
    dialog.showModal();
    open();
  }).finally(() => { pendingLogin = null; });
  return pendingLogin;
}

export async function withToyLogin<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (!isToyLoginRequired(error)) throw error;
    await requestLogin();
    try { return await operation(); }
    catch (retryError) {
      if (isToyLoginRequired(retryError)) throw new Error('尚未检测到 B站登录状态，请完成登录后再次操作');
      throw retryError;
    }
  }
}
