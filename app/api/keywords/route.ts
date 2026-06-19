import { promises as fs } from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';

const KEYWORDS_FILE = path.join(process.cwd(), 'keywords-queue.json');

async function loadKeywords() {
  try {
    const data = await fs.readFile(KEYWORDS_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return { queue: [], published: [] };
  }
}

async function saveKeywords(data: any) {
  await fs.writeFile(KEYWORDS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

export async function GET() {
  try {
    const keywords = await loadKeywords();
    return NextResponse.json(keywords);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to load keywords' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { keyword } = await request.json();

    if (!keyword || typeof keyword !== 'string') {
      return NextResponse.json(
        { error: 'Invalid keyword' },
        { status: 400 }
      );
    }

    const keywords = await loadKeywords();

    // Check if keyword already exists
    const exists = keywords.queue.some((k: any) => k.keyword.toLowerCase() === keyword.toLowerCase());
    if (exists) {
      return NextResponse.json(
        { error: 'Keyword already exists' },
        { status: 400 }
      );
    }

    // Add new keyword with highest priority + 1
    const maxPriority = keywords.queue.reduce((max: number, k: any) => Math.max(max, k.priority || 0), 0);
    const newKeyword = {
      keyword: keyword.toLowerCase().trim(),
      status: 'pending',
      priority: maxPriority + 1,
      addedDate: new Date().toISOString().split('T')[0]
    };

    keywords.queue.push(newKeyword);
    keywords.queue.sort((a: any, b: any) => (a.priority || 999) - (b.priority || 999));

    await saveKeywords(keywords);
    return NextResponse.json(newKeyword, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to add keyword' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { keyword, priority } = await request.json();

    if (!keyword || typeof priority !== 'number') {
      return NextResponse.json(
        { error: 'Invalid request' },
        { status: 400 }
      );
    }

    const keywords = await loadKeywords();
    const item = keywords.queue.find((k: any) => k.keyword === keyword);

    if (!item) {
      return NextResponse.json(
        { error: 'Keyword not found' },
        { status: 404 }
      );
    }

    item.priority = priority;
    keywords.queue.sort((a: any, b: any) => (a.priority || 999) - (b.priority || 999));

    await saveKeywords(keywords);
    return NextResponse.json(item);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to update keyword' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { keyword, status } = await request.json();

    if (!keyword) {
      return NextResponse.json(
        { error: 'Invalid keyword' },
        { status: 400 }
      );
    }

    const keywords = await loadKeywords();

    if (status === 'pending') {
      keywords.queue = keywords.queue.filter((k: any) => k.keyword !== keyword);
    } else if (status === 'published') {
      keywords.published = keywords.published.filter((k: any) => k.keyword !== keyword);
    }

    await saveKeywords(keywords);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to delete keyword' },
      { status: 500 }
    );
  }
}
