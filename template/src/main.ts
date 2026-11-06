import '@alcariss/pwa-kit/styles.css';
import './styles.css';
import { registerSW } from 'virtual:pwa-register';
import {
  ApiError,
  AUTH_ERROR_CODES,
  DEFAULT_AUTH_ERROR_MESSAGES,
  createApiClient,
  createAuth,
  createCache,
  createPushNotifications,
  createResource,
  createStore,
  escapeHtml,
  formatAge,
  formatIsoDate,
  isDebugEnabled,
  mountPushToggle,
  readApiConfig,
  renderDiagnostics,
  renderLoginScreen,
  requiredElement,
  setupInstallHint,
  setupUpdatePrompt,
  toIsoDate,
  type Diagnostics,
  type InstallHint,
  type PushToggle
} from '@alcariss/pwa-kit';
import { toNote, toNoteParams, type Note, type NoteInput } from './notes';

const APP_NAME = 'Notes';
const LOCALE = 'en';
/**
 * Web Push about records other people add. Turn on once the app's table has
 * `push` in worker/src/apps.ts; notes are private, so the starter leaves it off.
 */
const PUSH_NOTIFICATIONS = false;

const config = readApiConfig(import.meta.env);
const auth = createAuth({ apiUrl: config.primaryUrl });
const client = createApiClient(config, { getSessionToken: () => auth.current()?.token ?? null });
const store = createStore<Note, NoteInput>({
  resource: createResource(client, { mapRow: toNote, toParams: toNoteParams }),
  cache: createCache<Note>('notes:v1:items')
});
const root = requiredElement('#app');
const signInRequired = config.authProviders.length > 0;

setupUpdatePrompt(registerSW);
// Also clears the app badge whenever the app comes to the front.
const push = PUSH_NOTIFICATIONS ? createPushNotifications(client) : null;

let installHint: InstallHint | null = null;
let pushToggle: PushToggle | null = null;

/** Shown before sign-in too: an app installed on iOS starts signed out. */
function showInstallHint(target: HTMLElement): void {
  installHint?.dispose();
  installHint = setupInstallHint(target, {
    storageKey: 'notes:install-hint-dismissed',
    signInRequired
  });
}

function showLogin(message: string | null = null): void {
  store.clear();
  pushToggle?.dispose();
  pushToggle = null;
  renderLoginScreen(root, {
    title: APP_NAME,
    providers: config.authProviders,
    message,
    onSelect: (provider) => auth.login(provider)
  });
  showInstallHint(requiredElement('.pk-login', root));
}

function showApp(): void {
  root.innerHTML = `
    <main class="container">
      <header class="header">
        <h1>${escapeHtml(APP_NAME)}</h1>
        ${signInRequired ? '<button id="logout" type="button" class="link">Sign out</button>' : ''}
      </header>
      <div id="install-hint"></div>
      <div id="push"></div>
      <form id="add-form" class="card">
        <textarea id="add-text" rows="3" required placeholder="Write a note…"></textarea>
        <div class="row">
          <input id="add-date" type="date" required />
          <button id="add-submit" type="submit">Save</button>
        </div>
      </form>
      <p id="status" class="status" role="status"></p>
      <ul id="notes" class="notes"></ul>
      <section id="debug"></section>
      <footer class="version">${escapeHtml(__APP_VERSION__)}</footer>
    </main>
  `;
  showInstallHint(requiredElement('#install-hint'));
  if (push) {
    // On iOS in Safari this shows "add to Home Screen first"; the install hint above says how.
    pushToggle = mountPushToggle(requiredElement('#push'), push);
  }

  const form = requiredElement<HTMLFormElement>('#add-form');
  const text = requiredElement<HTMLTextAreaElement>('#add-text');
  const date = requiredElement<HTMLInputElement>('#add-date');
  const submit = requiredElement<HTMLButtonElement>('#add-submit');
  date.value = toIsoDate();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      render(await store.create({ date: date.value, text: text.value }));
      text.value = '';
      setStatus('Saved.');
    } catch (error) {
      handleError(error, 'Could not save the note.');
    } finally {
      submit.disabled = false;
    }
  });

  requiredElement('#notes').addEventListener('click', async (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-delete]');
    if (!button?.dataset.delete || !confirm('Delete this note?')) {
      return;
    }
    button.disabled = true;
    try {
      render(await store.remove(button.dataset.delete));
      setStatus('Deleted.');
    } catch (error) {
      button.disabled = false;
      handleError(error, 'Could not delete the note.');
    }
  });

  document.querySelector('#logout')?.addEventListener('click', async () => {
    // Signed-out devices should stop getting other people's records.
    await push?.disable().catch(() => undefined);
    auth.logout();
    showLogin();
  });
}

function setStatus(message: string, tone: 'info' | 'error' = 'info'): void {
  const status = requiredElement('#status');
  status.textContent = message;
  status.dataset.tone = tone;
}

function render(result: { items: Note[]; diagnostics?: Diagnostics }): void {
  requiredElement('#notes').innerHTML = result.items.length === 0
    ? '<li class="empty">No notes yet.</li>'
    : result.items.map((note) => `
        <li class="note card">
          <div class="note-meta">
            <time datetime="${escapeHtml(note.date)}">${escapeHtml(formatIsoDate(note.date, LOCALE))}</time>
            <button type="button" class="link danger" data-delete="${escapeHtml(note.id)}">Delete</button>
          </div>
          <p>${escapeHtml(note.text)}</p>
        </li>
      `).join('');

  if (isDebugEnabled() && result.diagnostics) {
    renderDiagnostics(requiredElement('#debug'), result.diagnostics, { Version: __APP_VERSION__ });
  }
}

function handleError(error: unknown, message: string): void {
  if (error instanceof ApiError && AUTH_ERROR_CODES.includes(error.code)) {
    auth.logout();
    showLogin(error.code === 'FORBIDDEN'
      ? DEFAULT_AUTH_ERROR_MESSAGES.not_allowed
      : 'Your session has expired. Sign in again.');
    return;
  }
  console.error(error);
  setStatus(`${message} ${error instanceof Error ? error.message : ''}`.trim(), 'error');
}

async function start(): Promise<void> {
  const outcome = auth.completeLogin();
  if (outcome.status === 'failed') {
    showLogin(DEFAULT_AUTH_ERROR_MESSAGES[outcome.reason] ?? 'Sign-in failed. Try again.');
    return;
  }
  if (signInRequired && auth.current() === null) {
    showLogin();
    return;
  }

  showApp();
  const cached = store.loadCached();
  if (cached) {
    render(cached);
    setStatus(`Saved copy from ${formatAge(cached.ageMs, LOCALE)}, updating…`);
  } else {
    setStatus('Loading…');
  }

  try {
    const result = await store.refresh();
    render(result);
    setStatus(result.diagnostics.source === 'cache' ? 'Offline: showing the saved copy.' : '');
  } catch (error) {
    handleError(error, 'Could not load notes.');
  }
}

void start();
