'use client';

import { useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { Plus, Trash2, CheckCircle2, Clock } from 'lucide-react';

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
  const [keywords, setKeywords] = useState<KeywordQueue>({ queue: [], published: [] });
  const [newKeyword, setNewKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadKeywords();
  }, []);

  async function loadKeywords() {
    try {
      const response = await fetch('/api/keywords');
      if (!response.ok) throw new Error('Failed to load keywords');
      const data = await response.json();
      setKeywords(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load keywords');
    } finally {
      setLoading(false);
    }
  }

  async function addKeyword(e: React.FormEvent) {
    e.preventDefault();
    if (!newKeyword.trim()) return;

    try {
      const response = await fetch('/api/keywords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword: newKeyword.trim() })
      });

      if (!response.ok) throw new Error('Failed to add keyword');

      setNewKeyword('');
      await loadKeywords();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add keyword');
    }
  }

  async function removeKeyword(keyword: string, status: 'pending' | 'published') {
    try {
      const response = await fetch('/api/keywords', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword, status })
      });

      if (!response.ok) throw new Error('Failed to remove keyword');

      await loadKeywords();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove keyword');
    }
  }

  async function updatePriority(keyword: string, newPriority: number) {
    try {
      const response = await fetch('/api/keywords', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword, priority: newPriority })
      });

      if (!response.ok) throw new Error('Failed to update priority');

      await loadKeywords();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update priority');
    }
  }

  if (loading) {
    return <div className="animate-pulse h-48 bg-white rounded-lg border" />;
  }

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5" />
          Social Media Posting Queue
        </h2>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-800 rounded-md text-sm">
            {error}
          </div>
        )}

        <form onSubmit={addKeyword} className="mb-6 flex gap-2">
          <input
            type="text"
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            placeholder="Add new keyword (e.g., 'etsy', 'shopify', 'vinted')"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <Button
            type="submit"
            className="bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Add Keyword
          </Button>
        </form>

        <div className="space-y-4">
          <div>
            <h3 className="font-semibold text-sm text-gray-700 mb-3 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Pending Keywords ({keywords.queue.length})
            </h3>
            {keywords.queue.length === 0 ? (
              <p className="text-sm text-gray-500">No pending keywords</p>
            ) : (
              <div className="space-y-2">
                {keywords.queue.map((item) => (
                  <div
                    key={item.keyword}
                    className="flex items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded-md"
                  >
                    <div className="flex-1">
                      <div className="font-medium text-sm">{item.keyword}</div>
                      <div className="text-xs text-gray-500">
                        Added: {new Date(item.addedDate).toLocaleDateString()}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 mr-3">
                      <Badge variant="outline" className="bg-yellow-50">
                        Priority {item.priority}
                      </Badge>
                      <select
                        value={item.priority}
                        onChange={(e) => updatePriority(item.keyword, parseInt(e.target.value))}
                        className="px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </div>

                    <Button
                      onClick={() => removeKeyword(item.keyword, 'pending')}
                      variant="ghost"
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t pt-4">
            <h3 className="font-semibold text-sm text-gray-700 mb-3 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              Published Keywords ({keywords.published.length})
            </h3>
            {keywords.published.length === 0 ? (
              <p className="text-sm text-gray-500">No published keywords yet</p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {keywords.published.map((item) => (
                  <div
                    key={item.keyword}
                    className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-md"
                  >
                    <div className="flex-1">
                      <div className="font-medium text-sm text-green-900">{item.keyword}</div>
                      <div className="text-xs text-green-700">
                        Published: {item.publishedDate || item.addedDate}
                      </div>
                    </div>

                    <Button
                      onClick={() => removeKeyword(item.keyword, 'published')}
                      variant="ghost"
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card className="p-4 bg-blue-50 border-blue-200">
        <p className="text-xs text-blue-800">
          <strong>ℹ️ How it works:</strong> Keywords are matched against blog filenames. Add keywords to the queue
          and they'll be prioritized for social media posts. Once posted, keywords move to published.
        </p>
      </Card>
    </div>
  );
}
