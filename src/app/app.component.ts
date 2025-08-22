import { Component, ElementRef, ViewChild, computed, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AiService } from './ai.service';
import type { ChatItem } from './types';
import { MdBoldPipe } from './md-bold.pipe';
import { Subscription } from 'rxjs';

type Mode = 'ask' | 'promptgen';

type Conversation = {
  id: string;
  title: string;
  created: number;
  updated: number;
  messages: ChatItem[];
};

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, MdBoldPipe],
  template: `
    <div class="layout">
      <!-- Sidebar (chat history) -->
      <aside class="sidebar" [class.open]="sidebarOpen()">
        <div class="sidebar-head">
          <button class="new" (click)="newChat()">＋ New chat</button>
          <button class="toggle" (click)="sidebarOpen.set(false)">Close</button>
        </div>

        <ul class="chatlist">
          <li *ngFor="let c of conversations()" (click)="selectChat(c.id)"
              [class.active]="c.id === activeId()">
            <div class="title" [title]="c.title">{{ c.title }}</div>
            <div class="preview">{{ preview(c) }}</div>
            <div class="row-actions">
              <button (click)="renameChat(c.id); $event.stopPropagation()">Rename</button>
              <button (click)="deleteChat(c.id); $event.stopPropagation()">Delete</button>
            </div>
          </li>
        </ul>
      </aside>

      <!-- Main chat area -->
      <main class="app">
        <header class="bar">
          <div class="brand">
            <button class="hamburger" (click)="sidebarOpen.set(true)">☰</button>
            <img src="assets/angular.png" alt="App logo" class="logo" />
            <h1>{{ activeTitle() }}</h1>
          </div>

          <div class="actions">
            <button class="ghost" (click)="newChat()">New</button>
            <button class="ghost" (click)="clearActive()" [disabled]="loading() || messages().length === 0">Clear</button>
          </div>
        </header>

        <section class="tip" *ngIf="mode === 'promptgen'">
          Enter a short idea; the AI returns a single, ready-to-use prompt.
        </section>

        <section #historyBox class="history" aria-live="polite" aria-atomic="false" (scroll)="onHistoryScroll()">
          <ng-container *ngFor="let m of messages()">
            <div class="msg" [class.me]="m.role==='user'" [class.ai]="m.role==='assistant'">
              <div class="avatar" [attr.aria-label]="m.role === 'user' ? 'User' : 'Assistant'">
                <img *ngIf="m.role==='assistant'; else youInitials"
                  src="assets/bot.png"
                  alt="AI assistant avatar"
                  class="avatar-img" />
              </div>
              <ng-template #youInitials>YOU</ng-template>

              <ng-container *ngIf="m.role === 'assistant'; else userPlain">
                <div class="bubble" [innerHTML]="m.content | mdBold">
                  <div class="actions-inline">
                    <button class="copy" (click)="copy(m.content)" title="Copy">Copy</button>
                  </div>
                </div>
              </ng-container>
              <ng-template #userPlain>
                <div class="bubble">{{ m.content }}</div>
              </ng-template>
            </div>
          </ng-container>

          <button class="jump" *ngIf="!autoStick()" (click)="jumpToBottom()">
            Jump to Latest
          </button>

          <div #historyEnd></div>
        </section>

        <section class="error" *ngIf="error()">{{ error() }}</section>

        <form class="composer" (ngSubmit)="send()">
          <textarea
            name="prompt"
            [(ngModel)]="prompt"
            (input)="autoResize($event)"
            (keydown.enter)="onEnter($any($event))"
            [placeholder]="mode === 'ask' ? 'Ask me anything!' : 'Describe your idea; I will craft a high-quality prompt'"
            [disabled]="loading()"
            rows="1"
            required
          ></textarea>

          <button type="submit" [disabled]="loading()">
            {{ loading() ? 'Sending' : (mode === 'ask' ? 'Send' : 'Generate') }}
          </button>

          <button type="button" class="ghost" *ngIf="loading()" (click)="stop()">Stop</button>
        </form>
      </main>
    </div>
  `,
  styles: [`
    :host { display:block; min-height:100dvh; background:#0b1020; color:#e7eaf3; }

    /* Layout with sidebar */
    .layout {
      display: grid;
      grid-template-columns: 280px 1fr;
      min-height: 100dvh;
      height: 100dvh;
      overflow: hidden;
    }
    @media (max-width: 900px) {
      .layout { grid-template-columns: 1fr; }
      .sidebar { position: fixed; inset: 0 auto 0 0; width: 80%; max-width: 320px; transform: translateX(-100%); }
      .sidebar.open { transform: translateX(0); }
      .app { padding-left: clamp(12px, 2vw, 24px); padding-right: clamp(12px, 2vw, 24px); }
      .hamburger { display: inline-block; }
    }

    /* Sidebar styles */
    .sidebar {
      background:#0a0f1f;
      border-right: 1px solid #1b2547;
      padding: 14px 12px;
      overflow: auto;
      transition: transform .22s ease;
      z-index: 20;
    }
    .sidebar-head { display:flex; gap:8px; align-items:center; justify-content:space-between; margin-bottom:10px; }
    .sidebar .new { border:1px solid #2a3354; background:#122044; color:#dbe3ff; padding:6px 10px; border-radius:10px; cursor:pointer; }
    .sidebar .toggle { border:1px solid #2a3354; background:transparent; color:#9fb0ff; padding:6px 10px; border-radius:10px; cursor:pointer; display:none; }
    @media (max-width: 900px) { .sidebar .toggle { display:inline-block; } }

    .chatlist { list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:8px; }
    .chatlist li {
      border:1px solid #1e2a53; background:#0f1733; border-radius:12px; padding:10px;
      cursor:pointer; transition: background .15s ease, border-color .15s ease;
    }
    .chatlist li.active { border-color:#3551cc; background:#101e44; }
    .chatlist .title { font-weight:600; font-size:.95rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .chatlist .preview { opacity:.8; font-size:.8rem; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .row-actions { display:flex; gap:6px; margin-top:8px; }
    .row-actions button { font-size:.75rem; border:1px solid #2a3354; background:transparent; color:#cbd2f0; padding:4px 6px; border-radius:8px; }

    /* Main app area */
    .app { width: 100%; max-width: 100%; margin: 0; padding: clamp(12px, 2vw, 24px); display:flex; flex-direction:column; min-height:100dvh; }
    .bar { display:flex; gap:12px; justify-content:space-between; align-items:center; margin-bottom: 12px; flex-wrap: wrap; }
    .brand { display:flex; align-items:center; gap:10px; min-width:0; }
    .hamburger { display:none; border:1px solid #2a3354; background:transparent; color:#cbd2f0; padding:6px 10px; border-radius:10px; cursor:pointer; }
    .logo { width:28px; height:28px; display:block; object-fit:contain; }
    h1 { font-size: 1.05rem; margin:0; line-height:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width: min(60vw, 900px); }
    .actions { display:flex; gap:8px; }
    .ghost { background: transparent; border: 1px solid #2a3354; color: #cbd2f0; padding: 6px 10px; border-radius: 10px; cursor:pointer; }
    .ghost:disabled { opacity:.5; cursor:not-allowed; }

    .tip { font-size:.9rem; opacity:.8; margin-bottom:10px; }

    /* History grows + scrolls; composer at bottom */
    .history {
      position: relative;
      flex: 1 1 auto;
      min-height: 0;
      overflow:auto;
      display:flex;
      flex-direction:column;
      gap: 10px;
      padding-inline-end: 12px;
      margin-bottom: 12px;
      scrollbar-gutter: stable both-edges;
    }

    .jump {
      position: sticky;           /* sticks near bottom inside .history */
      bottom: 8px;
      align-self: flex-end;       /* place on the right */
      margin-right: 8px;

      border: 1px solid #2a3354;
      background: #122044;
      color: #dbe3ff;
      padding: 6px 10px;
      border-radius: 999px;
      cursor: pointer;
      box-shadow: 0 2px 10px rgba(0,0,0,.25);
      opacity: .95;
    }
    .jump:hover { opacity: 1; }

    .msg { display:flex; gap:10px; align-items:flex-end; }
    .msg.me { flex-direction: row-reverse; }
    .avatar { width:36px; height:36px; border-radius:50%; background:#1f2745; border:1px solid #2f3a6f; display:flex; align-items:center; justify-content:center; font-size:0.9rem; overflow:hidden; }
    .avatar-img { width:100%; height:100%; object-fit:cover; display:block; }
    .msg.me .avatar { background:#10304a; border-color:#1c557d; }

    .bubble {
      position:relative; max-width: calc(100% - 200px);
      background:#151b34; border:1px solid #263055; padding:10px 12px; border-radius: 12px;
      white-space:pre-wrap; word-break: break-word; overflow-wrap: anywhere;
    }
    .msg.me .bubble { background:#102436; border-color:#1e5075; }

    .actions-inline { position:absolute; top:6px; right:6px; opacity:.0; transition:opacity .15s ease; }
    .bubble:hover .actions-inline { opacity:.9; }
    .copy { font-size:.75rem; border:1px solid #38437a; background:#1a244a; color:#cdd6ff; padding:2px 6px; border-radius:8px; cursor:pointer; }

    .typing { display:inline-flex; gap:6px; align-items:center; }
    .dot { width:8px; height:8px; border-radius:50%; background:#9fb0ff; display:inline-block; animation: blink 1.3s infinite; }
    .dot:nth-child(2){ animation-delay:.2s } .dot:nth-child(3){ animation-delay:.4s }
    @keyframes blink { 0%{opacity:.3} 50%{opacity:1} 100%{opacity:.3} }

    .composer { position:sticky; bottom:0; display:flex; gap:10px; backdrop-filter: blur(6px); padding-top:4px; padding-bottom: max(0px, env(safe-area-inset-bottom)); }
    .composer textarea {
      font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI",
               Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
      font-size: 16px;
      line-height: 1.4;
      flex:1; min-height:60px; max-height: min(40vh, 240px);
      overflow-y:auto; resize:none; border-radius: 12px; padding: 12px;
      border:1px solid #2a3354; background:#0e1830; color:#e7eaf3;
      white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere;
    }
    .composer textarea::placeholder {
      font-family: inherit;
      opacity: .75;
    }
    .composer button { border-radius: 12px; padding: 12px 16px; border:1px solid #3750a7; background:#3352cc; color:white; cursor:pointer; }
    .composer button:disabled { opacity:.6; cursor:not-allowed; }

    .error { background:#3b1120; color:#ffd3da; border:1px solid #5d1d2e; padding:10px 12px; border-radius:12px; }
  `]
})
export class AppComponent {
  prompt = '';
  mode: Mode = 'ask';

  // Conversations state
  conversations = signal<Conversation[]>(this.loadConversations());
  activeId = signal<string>(this.loadActiveId());
  sidebarOpen = signal(false);

  // Derived
  activeConv = computed(() => this.conversations().find(c => c.id === this.activeId()) ?? null);
  messages = computed(() => this.activeConv()?.messages ?? []);
  activeTitle = computed(() => this.activeConv()?.title ?? 'New chat');

  // Request state
  loading = signal(false);
  error = signal<string | null>(null);

  autoStick = signal(true);

  @ViewChild('historyBox') historyBox!: ElementRef<HTMLDivElement>;
  @ViewChild('historyEnd') historyEnd!: ElementRef<HTMLDivElement>;

  onHistoryScroll() {
    const el = this.historyBox?.nativeElement;
    if (!el) return;
    this.autoStick.set(this.isNearBottom(el));
  }

  // Jump pill
  jumpToBottom() {
    this.autoStick.set(true);
    this.stickToBottom();
  }

  private isNearBottom(el: HTMLElement, threshold = 64) {
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    return distance <= threshold;
  }

  private stickToBottom() {
    const el = this.historyBox?.nativeElement;
    if (!el) return;
    // Wait for the new chunk to render, then scroll
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }

  private streamSub?: Subscription;

  constructor(private ai: AiService) {
    // Persist conversations and active chat
    effect(() => {
      const convs = this.conversations();
      localStorage.setItem('ai-conversations', JSON.stringify(convs));
    });
    effect(() => {
      const id = this.activeId();
      localStorage.setItem('ai-active-id', id ?? '');
    });

    // Auto-scroll as messages change
    effect(() => {
      this.messages();
      if (this.autoStick()) this.stickToBottom();
    });
  }

  // Load and Migrate
  private loadConversations(): Conversation[] {
    // New storage
    const raw = localStorage.getItem('ai-conversations');
    if (raw) {
      try {
        const parsed: Conversation[] = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) return parsed;
      } catch {}
    }
    // Migrate old single-thread storage if present
    const old = localStorage.getItem('chat-history');
    if (old) {
      try {
        const items: ChatItem[] = JSON.parse(old);
        const firstTitle = this.deriveTitleFrom(items);
        const firstConv: Conversation = {
          id: uid(),
          title: firstTitle || 'Imported chat',
          created: Date.now(),
          updated: Date.now(),
          messages: items
        };
        // clean old key
        localStorage.removeItem('chat-history');
        return [firstConv];
      } catch {}
    }
    // Otherwise start with one empty conversation
    return [this.blankConversation()];
  }

  private loadActiveId(): string {
    const id = localStorage.getItem('ai-active-id');
    if (id) return id;
    const convs = this.loadConversations();
    return convs[0]?.id ?? this.blankConversation().id;
  }

  private blankConversation(): Conversation {
    return { id: uid(), title: 'New chat', created: Date.now(), updated: Date.now(), messages: [] };
  }

  // Sidebar helpers
  newChat() {
    const conv = this.blankConversation();
    this.conversations.update(cs => [conv, ...cs]);
    this.activeId.set(conv.id);
    this.sidebarOpen.set(false);

    // Clear composer focus state
    this.prompt = '';
  }

  selectChat(id: string) {
    this.activeId.set(id);
    this.sidebarOpen.set(false);
  }

  deleteChat(id: string) {
    this.conversations.update(cs => cs.filter(c => c.id !== id));
    if (this.activeId() === id) {
      const first = this.conversations()[0] ?? this.blankConversation();
      if (!this.conversations().length) {
        this.conversations.set([first]);
      }
      this.activeId.set(this.conversations()[0].id);
    }
  }

  renameChat(id: string) {
    const curr = this.conversations().find(c => c.id === id);
    const name = window.prompt('Rename chat', curr?.title ?? 'New chat');
    if (!name) return;
    this.conversations.update(cs => cs.map(c => c.id === id ? { ...c, title: name } : c));
  }

  preview(c: Conversation): string {
    const last = c.messages[c.messages.length - 1];
    const text = last?.content ?? '';
    return text.length > 60 ? text.slice(0, 60) + '…' : text;
  }

  // Chat title from first user line
  private ensureTitleAfterFirstUser(msg: string) {
    const conv = this.activeConv();
    if (!conv) return;
    if (conv.title === 'New chat' || conv.title === 'Imported chat') {
      const title = this.deriveTitleFrom([{ role: 'user', content: msg, time: Date.now() } as ChatItem]) || 'New chat';
      this.conversations.update(cs => cs.map(c => c.id === conv.id ? { ...c, title } : c));
    }
  }

  private deriveTitleFrom(items: ChatItem[]): string {
    const firstUser = items.find(m => m.role === 'user')?.content?.trim() || '';
    return firstUser ? (firstUser.length > 40 ? firstUser.slice(0, 40) + '…' : firstUser) : '';
  }


  private updateActive(updater: (msgs: ChatItem[]) => ChatItem[]) {
    const id = this.activeId();
    this.conversations.update(cs =>
      cs.map(c => c.id === id ? { ...c, messages: updater(c.messages), updated: Date.now() } : c)
    );
  }

  send() {
    const q = this.prompt.trim();
    if (!q || this.loading()) return;

    this.loading.set(true);
    this.error.set(null);
    this.autoStick.set(true);
    this.stickToBottom();

    // Push user message to active conversation
    this.updateActive(h => [...h, { role: 'user', content: q, time: Date.now() }]);
    this.ensureTitleAfterFirstUser(q);
    this.prompt = '';

    this.updateActive(h => [...h, { role: 'assistant', content: '', time: Date.now() }]);

    const payload = this.buildPrompt(q);

    // Stream deltas into the last assistant message
    this.streamSub = this.ai.streamGenerate(payload).subscribe({
      next: (delta) => this.appendToLastAssistant(delta),
      error: (e) => {
        this.error.set(e?.message ?? 'Something went wrong.');
        this.loading.set(false);
      },
      complete: () => this.loading.set(false),
    });
  }

  stop() {
    this.streamSub?.unsubscribe();
    this.loading.set(false);
  }

  private appendToLastAssistant(delta: string) {
    if (!delta) return;
    this.updateActive(h => {
      if (!h.length) return h;
      const i = h.length - 1;
      const last = h[i];
      if (last.role !== 'assistant') return h;
      const updated = { ...last, content: (last.content || '') + delta };
      return [...h.slice(0, i), updated];
    });
    if (this.autoStick()) this.stickToBottom();
  }

  clearActive() {
    const id = this.activeId();
    this.conversations.update(cs => cs.map(c => c.id === id ? { ...c, messages: [], updated: Date.now() } : c));
    this.error.set(null);
  }

  copy(text: string) {
    navigator.clipboard?.writeText(text).catch(() => {});
  }

  onEnter(ev: KeyboardEvent) {
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      this.send();
    }
  }

  autoResize(ev: Event) {
    const ta = ev.target as HTMLTextAreaElement;
    const hardCap = Math.min(window.innerHeight * 0.40, 240);
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, hardCap) + 'px';
  }

  private scrollToBottom() {
    this.historyEnd?.nativeElement?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  private buildPrompt(user: string): string {
    if (this.mode === 'promptgen') {
      return [
        'You are an expert prompt engineer.',
        'From the user idea below, produce ONE concise, high-quality prompt ready for a general LLM.',
        'Return ONLY the prompt text. No preface, no code fences, no quotes.',
        '',
        `User idea: ${JSON.stringify(user)}`
      ].join('\n');
    }
    return user;
  }

  private clean(text: string): string {
    let s = (text ?? '').trim();
    if (s.startsWith('```')) s = s.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '').trim();
    s = s.replace(/^prompt\s*:\s*/i, '').trim();
    s = s.replace(/^["'`]+/, '').replace(/["'`]+$/, '').trim();
    return s;
  }
}
