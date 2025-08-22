import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpErrorResponse } from '@angular/common/http';
import {
  Observable, of, timer, throwError,
  map, retryWhen, mergeMap
} from 'rxjs';
import { environment } from '../environments/environment';

@Injectable({ providedIn: 'root' })
export class AiService {
  private http = inject(HttpClient);

  generate(prompt: string): Observable<string> {
    const provider = environment.provider;
    if (!prompt?.trim()) return of('');

    switch (provider) {
      case 'openai':
        return this.callOpenAI(prompt);
      default:
        return of(`(mock) You said: ${prompt}`);
    }
  }

  // ---------- OPENAI ----------
  private callOpenAI(prompt: string): Observable<string> {
    const apiKey = environment.openAiApiKey;
    if (!apiKey) {
      return throwError(() => new Error(
        'OpenAI key missing. Set environment.openAiApiKey or use the proxy.'
      ));
    }

    const headers = new HttpHeaders({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    });

    const body = {
      model: environment.openAiModel || 'gpt-4o-mini',
      messages: [
        environment.systemPrompt ? { role: 'system', content: environment.systemPrompt } : undefined,
        { role: 'user', content: prompt },
      ].filter(Boolean),
      temperature: environment.temperature ?? 0.7,
      max_tokens: environment.maxTokens ?? 256,
    } as any;

    return this.http.post<any>('https://api.openai.com/v1/chat/completions', body, { headers }).pipe(
      map(res => res?.choices?.[0]?.message?.content ?? '(OpenAI) No content returned.'),
      // Smart retry for rate limits only
      retryWhen(errors =>
        errors.pipe(
          mergeMap((err: HttpErrorResponse, attempt) => {
            // Stop on non-429 errors
            if (err.status !== 429) {
              return throwError(() => this.toNiceError(err));
            }

            // If quota is exhausted, don't keep retrying
            const t = (err.error?.error?.type || '').toString();
            if (t === 'insufficient_quota') {
              return throwError(() => new Error(
                'OpenAI quota exceeded. Add billing or wait for quota reset.'
              ));
            }

            // Compute backoff (use server hints if available)
            const retryAfterSec = Number(err.headers?.get('retry-after')) || 0;
            const resetRequestsSec = Number(err.headers?.get('x-ratelimit-reset-requests')) || 0;
            const serverWaitMs = Math.max(retryAfterSec, resetRequestsSec) * 1000;

            // Exponential backoff with jitter; cap attempts
            const maxRetries = 5; // total attempts = maxRetries
            if (attempt >= maxRetries) {
              return throwError(() => new Error(
                'Hit rate limit repeatedly. Please try again in a minute.'
              ));
            }
            const expoMs = Math.pow(2, attempt) * 500; // 0.5s,1s,2s,4s,8s...
            const jitter = Math.floor(Math.random() * 300);
            const delayMs = Math.max(serverWaitMs, expoMs + jitter);

            // Optional: log for debugging
            console.warn(`[OpenAI] 429 retry #${attempt + 1} in ${Math.round(delayMs)}ms`);

            return timer(delayMs);
          })
        )
      )
    );
  }

  // ---------- HUGGING FACE ----------
  private callHuggingFace(prompt: string): Observable<string> {
    const apiKey = environment.hfApiKey;
    const model = environment.hfModel || 'google/gemma-2-2b-it';
    if (!apiKey) {
      return throwError(() => new Error(
        'Hugging Face key missing. Set environment.hfApiKey.'
      ));
    }

    const headers = new HttpHeaders({
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    });

    const body = {
      inputs: prompt,
      parameters: {
        max_new_tokens: environment.maxTokens ?? 256,
        temperature: environment.temperature ?? 0.7,
        return_full_text: false,
      },
    };

    return this.http.post<any>(`https://api-inference.huggingface.co/models/${model}`, body, { headers }).pipe(
      map(res => {
        if (Array.isArray(res) && res[0]?.generated_text) return String(res[0].generated_text);
        const text = res?.generated_text || res?.[0]?.generated_text;
        return text ?? '(HF) No content returned.';
      })
    );
  }

  // ---------- helpers ----------
  private toNiceError(err: HttpErrorResponse): Error {
    const msg = err.error?.error?.message || err.message || 'Request failed';
    if (err.status === 401) return new Error('Unauthorized: check your API key.');
    if (err.status === 403) return new Error('Forbidden: key or organization not allowed.');
    if (err.status === 429) return new Error('Rate limit: please try again shortly.');
    return new Error(msg);
  }

  streamGenerate(prompt: string): Observable<string> {
    if (environment.provider !== 'openai') {
      return new Observable<string>(observer => {
        this.generate(prompt).subscribe({
          next: (full) => { observer.next(full); observer.complete(); },
          error: (e) => observer.error(e),
        });
      });
    }
    return this.streamOpenAI(prompt);
  }

  /** OpenAI Chat Completions streaming via SSE. Emits incremental content. */
  private streamOpenAI(prompt: string): Observable<string> {
    const apiKey = environment.openAiApiKey;
    if (!apiKey) {
      return new Observable(obs => obs.error(new Error('OpenAI key missing.')));
    }

    return new Observable<string>(observer => {
      const ctrl = new AbortController();

      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      };

      const body = {
        model: environment.openAiModel || 'gpt-4o-mini',
        stream: true,
        temperature: environment.temperature ?? 0.7,
        max_tokens: environment.maxTokens ?? 256,
        messages: [
          environment.systemPrompt ? { role: 'system', content: environment.systemPrompt } : undefined,
          { role: 'user', content: prompt },
        ].filter(Boolean),
      };

      (async () => {
        try {
          const resp = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: ctrl.signal,
          });

          if (!resp.ok) {
            let msg = `HTTP ${resp.status}`;
            try { const j = await resp.json(); msg = j?.error?.message || msg; } catch {}
            observer.error(new Error(msg));
            return;
          }

          const reader = resp.body!.getReader();
          const decoder = new TextDecoder('utf-8');
          let buf = '';

          while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buf += decoder.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop() ?? '';

            for (const line of lines) {
              const t = line.trim();
              if (!t.startsWith('data:')) continue;

              const data = t.slice(5).trim();
              if (data === '[DONE]') {
                observer.complete();
                return;
              }

              try {
                const json = JSON.parse(data);
                // Chat Completions streaming: choices[0].delta.content
                const delta: string = json?.choices?.[0]?.delta?.content ?? '';
                if (delta) observer.next(delta);
              } catch {
                // ignore malformed keep-alives
              }
            }
          }

          observer.complete();
        } catch (err: any) {
          if (err?.name === 'AbortError') observer.complete();
          else observer.error(err);
        }
      })();

      // teardown: abort the request
      return () => ctrl.abort();
    });
  }
}
