'use client';

import { useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { Plus, Trash2, CheckCircle2, Clock, ChevronUp, ChevronDown, Loader2, AlertCircle } from 'lucide-react';

interface KeywordItem {
  keyword: string;
  status: 'pending' | 'published';
  priority: number;
  addedDate: string;
  publishedDate?: string;
}

interface KeywordQueue {
  queue: KeywordItem[];
  published: KeywordItem[];
}

export function KeywordQueue() {
  const [data, setData] = useState<KeywordQueue>({ queue: [], published: [] });
  const [newKeyword, setNewKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch('/api/keywords');
      if (!res.ok) throw new Error(await res.text());
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError('Kon keywords niet laden');
    } finally {
      setLoading(false);
    }
  }

  async function addKeyword(e: React.FormEvent) {
    e.preventDefault();
    if (!newKeyword.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: newKeyword.trim() }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Toevoegen mislukt');
      }
      setNewKeyword('');
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function movePriority(keyword: string, direction: 'up' | 'down') {
    const sorted = [...data.queue].sort((a, b) => a.priority - b.priority);
    const idx = sorted.findIndex(k => k.keyword === keyword);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) return;

    const newPriority = sorted[swapIdx].priority;
    const swapPriority = sorted[idx].priority;

    setSaving(true);
    try {
      await Promise.all([
        fetch('/api/keywords', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keyword: sorted[idx].keyword, priority: newPriority }),
        }),
        fetch('/api/keywords', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ keyword: sorted[swapIdx].keyword, priority: swapPriority }),
        }),
      ]);
      await load();
    } catch {
      setError('Prioriteit wijzigen mislukt');
    } finally {
      setSaving(false);
    }
  }

  async function remove(keyword: string, status: 'pending' | 'published') {
    setSaving(true);
    try {
      const res = await fetch('/api/keywords', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword, status }),
      });
      if (!res.ok) throw new Error('Verwijderen mislukt');
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const sorted = [...data.queue].sort((a, b) => a.priority - b.priority);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32 text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Laden...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Social Media Keywords</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Posts worden automatisch 3× per dag gepubliceerd op basis van prioriteit
          </p>
        </div>
        {saving && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 text-red-800 rounded-md text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-red-500 hover:text-red-700">✕</button>
        </div>
      )}

      {/* Add keyword */}
      <form onSubmit={addKeyword} className="flex gap-2">
        <input
          type="text"
          value={newKeyword}
          onChange={e => setNewKeyword(e.target.value)}
          placeholder="Keyword toevoegen (bijv. 'btw kleding', 'kor calculator')..."
          className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-600"
          disabled={saving}
        />
        <Button type="submit" disabled={saving || !newKeyword.trim()} className="shrink-0">
          <Plus className="w-4 h-4 mr-1" /> Toevoegen
        </Button>
      </form>

      {/* Pending queue */}
      <Card className="divide-y divide-gray-100 overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 flex items-center gap-2">
          <Clock className="w-4 h-4 text-amber-500" />
          <span className="font-medium text-sm">Wachtrij</span>
          <Badge variant="outline" className="ml-auto">{sorted.length} keywords</Badge>
        </div>

        {sorted.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-400">
            Geen keywords in de wachtrij. Voeg er een toe hierboven.
          </div>
        ) : (
          sorted.map((item, idx) => (
            <div key={item.keyword} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
              {/* Priority badge */}
              <span className="text-xs font-mono w-5 text-center text-gray-400">{idx + 1}</span>

              {/* Up/down */}
              <div className="flex flex-col gap-0.5">
                <button
                  onClick={() => movePriority(item.keyword, 'up')}
                  disabled={idx === 0 || saving}
                  className="text-gray-300 hover:text-gray-600 disabled:opacity-20 disabled:cursor-not-allowed"
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => movePriority(item.keyword, 'down')}
                  disabled={idx === sorted.length - 1 || saving}
                  className="text-gray-300 hover:text-gray-600 disabled:opacity-20 disabled:cursor-not-allowed"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Keyword */}
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium truncate block">{item.keyword}</span>
                <span className="text-xs text-gray-400">Toegevoegd {item.addedDate}</span>
              </div>

              {/* Delete */}
              <button
                onClick={() => remove(item.keyword, 'pending')}
                disabled={saving}
                className="text-gray-300 hover:text-red-500 disabled:opacity-30 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))
        )}
      </Card>

      {/* Published history */}
      {data.published.length > 0 && (
        <Card className="divide-y divide-gray-100 overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <span className="font-medium text-sm">Gepubliceerd</span>
            <Badge variant="outline" className="ml-auto">{data.published.length}</Badge>
          </div>
          <div className="max-h-48 overflow-y-auto divide-y divide-gray-100">
            {data.published.map(item => (
              <div key={item.keyword} className="flex items-center gap-3 px-4 py-2.5">
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-gray-600 truncate block">{item.keyword}</span>
                  <span className="text-xs text-gray-400">
                    Geplaatst op {item.publishedDate ?? item.addedDate}
                  </span>
                </div>
                <button
                  onClick={() => remove(item.keyword, 'published')}
                  disabled={saving}
                  className="text-gray-300 hover:text-red-500 disabled:opacity-30 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <p className="text-xs text-gray-400">
        Keywords worden gekoppeld aan blogs via de bestandsnaam. De bot post altijd het hoogste keyword in de wachtrij dat een overeenkomende blog heeft.
      </p>
    </div>
  );
}
