import { promises as fs } from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';

const KEYWORDS_FILE = path.join(process.cwd(), 'keywords-queue.json');
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = 'danieldk04/zenbtw';
const GITHUB_BRANCH = 'main';
const GITHUB_FILE_PATH = 'keywords-queue.json';

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

async function readLocalFile(): Promise<KeywordQueue> {
  try {
    const data = await fs.readFile(KEYWORDS_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return { queue: [], published: [] };
  }
}

async function getGithubFile(): Promise<{ content: KeywordQueue; sha: string } | null> {
  if (!GITHUB_TOKEN) return null;

  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}?ref=${GITHUB_BRANCH}`,
    {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
      },
      cache: 'no-store',
    }
  );

  if (!res.ok) return null;

  const data = await res.json();
  const content = JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
  return { content, sha: data.sha };
}

async function writeGithubFile(content: KeywordQueue, sha: string): Promise<boolean> {
  if (!GITHUB_TOKEN) return false;

  const encoded = Buffer.from(JSON.stringify(content, null, 2) + '\n').toString('base64');

  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: 'admin: update keywords queue',
        content: encoded,
        sha,
        branch: GITHUB_BRANCH,
      }),
    }
  );

  return res.ok;
}

export async function GET() {
  try {
    // Try GitHub first (fresh data), fall back to local file
    const github = await getGithubFile();
    const keywords = github ? github.content : await readLocalFile();
    return NextResponse.json(keywords);
  } catch {
    return NextResponse.json({ error: 'Failed to load keywords' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { keyword } = await request.json();
    if (!keyword?.trim()) {
      return NextResponse.json({ error: 'Keyword is required' }, { status: 400 });
    }

    const github = await getGithubFile();
    if (!github) {
      return NextResponse.json(
        { error: 'GITHUB_TOKEN not configured — cannot save' },
        { status: 503 }
      );
    }

    const { content: keywords, sha } = github;
    const normalized = keyword.toLowerCase().trim();

    const alreadyExists =
      keywords.queue.some((k) => k.keyword === normalized) ||
      keywords.published.some((k) => k.keyword === normalized);

    if (alreadyExists) {
      return NextResponse.json({ error: 'Keyword already exists' }, { status: 400 });
    }

    const maxPriority = keywords.queue.reduce((m, k) => Math.max(m, k.priority ?? 0), 0);
    const newItem: KeywordItem = {
      keyword: normalized,
      status: 'pending',
      priority: maxPriority + 1,
      addedDate: new Date().toISOString().split('T')[0],
    };

    keywords.queue.push(newItem);
    keywords.queue.sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));

    const ok = await writeGithubFile(keywords, sha);
    if (!ok) return NextResponse.json({ error: 'Failed to save' }, { status: 500 });

    return NextResponse.json(newItem, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Failed to add keyword' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { keyword, priority } = await request.json();
    if (!keyword || typeof priority !== 'number') {
      return NextResponse.json({ error: 'keyword and priority required' }, { status: 400 });
    }

    const github = await getGithubFile();
    if (!github) {
      return NextResponse.json({ error: 'GITHUB_TOKEN not configured' }, { status: 503 });
    }

    const { content: keywords, sha } = github;
    const item = keywords.queue.find((k) => k.keyword === keyword);
    if (!item) return NextResponse.json({ error: 'Keyword not found' }, { status: 404 });

    item.priority = priority;
    keywords.queue.sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));

    const ok = await writeGithubFile(keywords, sha);
    if (!ok) return NextResponse.json({ error: 'Failed to save' }, { status: 500 });

    return NextResponse.json(item);
  } catch {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { keyword, status } = await request.json();
    if (!keyword) return NextResponse.json({ error: 'keyword required' }, { status: 400 });

    const github = await getGithubFile();
    if (!github) {
      return NextResponse.json({ error: 'GITHUB_TOKEN not configured' }, { status: 503 });
    }

    const { content: keywords, sha } = github;

    if (status === 'published') {
      keywords.published = keywords.published.filter((k) => k.keyword !== keyword);
    } else {
      keywords.queue = keywords.queue.filter((k) => k.keyword !== keyword);
    }

    const ok = await writeGithubFile(keywords, sha);
    if (!ok) return NextResponse.json({ error: 'Failed to save' }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
