import { Component, signal, ViewChild, ElementRef, AfterViewInit, OnInit } from '@angular/core';
import { NgClass, NgIf, NgFor, TitleCasePipe } from '@angular/common';

interface ChatMessage {
  role: 'user' | 'ai';
  content: string;
}

const CHAT_STORAGE_KEY = 'botfusion-chat';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [NgClass, NgIf, NgFor, TitleCasePipe],
  providers: [TitleCasePipe],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class AppComponent implements AfterViewInit, OnInit {
  // Signals for state management
  model = signal<'openai' | 'claude' | 'azure'>('openai');
  apiKey = signal('');
  prompt = signal('');
  chat = signal<ChatMessage[]>([]);
  loading = signal(false);
  error = signal<string | null>(null);

  @ViewChild('chatDisplay') chatDisplayRef!: ElementRef<HTMLDivElement>;

  ngOnInit() {
    // Load chat history from localStorage
    const saved = localStorage.getItem(CHAT_STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          this.chat.set(parsed);
        }
      } catch {}
    }
    // Save chat on every update
    const originalUpdate = this.chat.update.bind(this.chat);
    this.chat.update = (fn: (c: ChatMessage[]) => ChatMessage[]) => {
      const result = originalUpdate(fn);
      localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(this.chat()));
      return result;
    };
    // Also save on set
    const originalSet = this.chat.set.bind(this.chat);
    this.chat.set = (v: ChatMessage[]) => {
      originalSet(v);
      localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(this.chat()));
    };
  }

  ngAfterViewInit() {
    this.scrollToBottom();
  }

  private scrollToBottom() {
    setTimeout(() => {
      if (this.chatDisplayRef && this.chatDisplayRef.nativeElement) {
        this.chatDisplayRef.nativeElement.scrollTop = this.chatDisplayRef.nativeElement.scrollHeight;
      }
    }, 0);
  }

  // Handlers for UI events
  onModelChange(event: Event) {
    const value = (event.target as HTMLSelectElement).value as 'openai' | 'claude' | 'azure';
    this.model.set(value);
    this.error.set(null);
  }

  onApiKeyChange(event: Event) {
    this.apiKey.set((event.target as HTMLInputElement).value);
    this.error.set(null);
  }

  onPromptChange(event: Event) {
    this.prompt.set((event.target as HTMLTextAreaElement).value);
    this.error.set(null);
  }

  clearChat() {
    this.chat.set([]);
    this.error.set(null);
    this.scrollToBottom();
  }

  async onSend(event: Event) {
    event.preventDefault();
    const promptValue = this.prompt();
    if (!promptValue.trim()) return;
    // Add user message to chat
    this.chat.update((c) => [...c, { role: 'user', content: promptValue }]);
    this.prompt.set('');
    this.loading.set(true);
    this.error.set(null);
    this.scrollToBottom();

    if (this.model() === 'openai') {
      try {
        const aiResponse = await this.callOpenAI(promptValue);
        this.chat.update((c) => [...c, { role: 'ai', content: aiResponse }]);
      } catch (err: any) {
        this.error.set('OpenAI: ' + (err?.message || err));
        this.chat.update((c) => [...c, { role: 'ai', content: 'Error: ' + (err?.message || err) }]);
      } finally {
        this.loading.set(false);
        this.scrollToBottom();
      }
    } else if (this.model() === 'claude') {
      try {
        const aiResponse = await this.callClaude(promptValue);
        this.chat.update((c) => [...c, { role: 'ai', content: aiResponse }]);
      } catch (err: any) {
        this.error.set('Claude: ' + (err?.message || err));
        this.chat.update((c) => [...c, { role: 'ai', content: 'Error: ' + (err?.message || err) }]);
      } finally {
        this.loading.set(false);
        this.scrollToBottom();
      }
    } else if (this.model() === 'azure') {
      try {
        const aiResponse = await this.callAzureOpenAI(promptValue);
        this.chat.update((c) => [...c, { role: 'ai', content: aiResponse }]);
      } catch (err: any) {
        this.error.set('Azure: ' + (err?.message || err));
        this.chat.update((c) => [...c, { role: 'ai', content: 'Error: ' + (err?.message || err) }]);
      } finally {
        this.loading.set(false);
        this.scrollToBottom();
      }
    } else {
      setTimeout(() => {
        this.chat.update((c) => [...c, { role: 'ai', content: 'This is a placeholder AI response.' }]);
        this.loading.set(false);
        this.scrollToBottom();
      }, 1000);
    }
  }

  async callOpenAI(prompt: string): Promise<string> {
    const apiKey = this.apiKey().trim();
    if (!apiKey) throw new Error('API key is required for OpenAI.');
    const endpoint = 'https://api.openai.com/v1/chat/completions';
    const body = {
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        ...this.chat().filter(m => m.role === 'user' || m.role === 'ai').map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
    };
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error?.message || 'OpenAI API error');
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || '[No response]';
  }

  async callClaude(prompt: string): Promise<string> {
    const apiKey = this.apiKey().trim();
    if (!apiKey) throw new Error('API key is required for Claude.');
    
    // Use a CORS proxy to bypass browser restrictions
    const proxyUrl = 'https://cors-anywhere.herokuapp.com/';
    const endpoint = 'https://api.anthropic.com/v1/messages';
    const fullUrl = proxyUrl + endpoint;
    
    const body = {
      model: 'claude-3-opus-20240229',
      max_tokens: 1024,
      messages: [
        { role: 'user', content: prompt },
      ],
    };
    
    const res = await fetch(fullUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Origin': 'http://localhost:4200',
      },
      body: JSON.stringify(body),
    });
    
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error?.message || 'Claude API error');
    }
    const data = await res.json();
    return data.content?.[0]?.text?.trim() || '[No response]';
  }

  async callAzureOpenAI(prompt: string): Promise<string> {
    const apiKey = this.apiKey().trim();
    if (!apiKey) throw new Error('API key is required for Azure OpenAI.');
    // For Azure, user must provide endpoint and deployment name in the API key field, separated by | (for demo purposes)
    // Example: <endpoint>|<deployment>|<api-key>
    const [endpoint, deployment, key] = apiKey.split('|').map(s => s.trim());
    if (!endpoint || !deployment || !key) throw new Error('For Azure, enter: <endpoint>|<deployment>|<api-key>');
    const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=2024-02-15-preview`;
    const body = {
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        ...this.chat().filter(m => m.role === 'user' || m.role === 'ai').map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': key,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error?.message || 'Azure OpenAI API error');
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || '[No response]';
  }
}
