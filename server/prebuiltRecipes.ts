import { WebMCPToolDefinition } from '../shared/types.js';

export const PREBUILT_RECIPES: Record<string, WebMCPToolDefinition[]> = {
  'news.ycombinator.com': [
    {
      id: 'hn_get_top_stories',
      name: 'get_top_stories',
      description: 'Fetch current top news items from Hacker News with title, score, submitter, and link URL.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of top items to retrieve (default: 15)' },
        },
        required: [],
      },
      annotations: {
        readOnly: true,
        destructive: false,
        requiresConfirmation: false,
        category: 'data_extraction',
        confidenceScore: 0.99,
        sourceDomain: 'news.ycombinator.com',
        sourceUrl: 'https://news.ycombinator.com',
      },
      actionRecipe: [
        {
          id: 'step_nav_hn',
          type: 'navigate',
          url: 'https://news.ycombinator.com',
          description: 'Navigate to Hacker News frontpage',
        },
        {
          id: 'step_extract_stories',
          type: 'evaluate_js',
          value: `
            Array.from(document.querySelectorAll('.athing')).slice(0, 20).map(row => {
              const titleEl = row.querySelector('.titleline > a');
              const subtextRow = row.nextElementSibling;
              const scoreEl = subtextRow?.querySelector('.score');
              const authorEl = subtextRow?.querySelector('.hnuser');
              return {
                id: row.id,
                title: titleEl?.innerText || '',
                url: titleEl?.href || '',
                score: scoreEl?.innerText || '0 points',
                author: authorEl?.innerText || 'unknown',
              };
            })
          `,
          description: 'Extract top stories and metadata from DOM',
        },
      ],
      status: 'approved',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      domain: 'news.ycombinator.com',
    },
    {
      id: 'hn_search_stories',
      name: 'search_hn_stories',
      description: 'Search Hacker News stories using the Algolia search bar.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term or keyword to search on HN' },
        },
        required: ['query'],
      },
      annotations: {
        readOnly: true,
        destructive: false,
        requiresConfirmation: false,
        category: 'search',
        confidenceScore: 0.97,
        sourceDomain: 'news.ycombinator.com',
        sourceUrl: 'https://news.ycombinator.com',
      },
      actionRecipe: [
        {
          id: 'step_nav_search',
          type: 'navigate',
          url: 'https://hn.algolia.com/?q=',
          dynamicParam: 'query',
          description: 'Navigate to Algolia search with query',
        },
        {
          id: 'step_wait_res',
          type: 'wait_for',
          selector: '.Story',
          timeoutMs: 5000,
          description: 'Wait for search items to render',
        },
        {
          id: 'step_extract_search_res',
          type: 'evaluate_js',
          value: `
            Array.from(document.querySelectorAll('.Story')).slice(0, 10).map(item => ({
              title: item.querySelector('.Story_title')?.innerText || '',
              url: item.querySelector('.Story_title a')?.href || '',
              meta: item.querySelector('.Story_meta')?.innerText || '',
            }))
          `,
          description: 'Extract search results list',
        },
      ],
      status: 'approved',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      domain: 'news.ycombinator.com',
    },
  ],
  'en.wikipedia.org': [
    {
      id: 'wiki_search_article',
      name: 'search_wikipedia_article',
      description: 'Search Wikipedia for an article topic and navigate directly to it.',
      inputSchema: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'Article title or concept to look up' },
        },
        required: ['topic'],
      },
      annotations: {
        readOnly: true,
        destructive: false,
        requiresConfirmation: false,
        category: 'search',
        confidenceScore: 0.98,
        sourceDomain: 'en.wikipedia.org',
        sourceUrl: 'https://en.wikipedia.org',
      },
      actionRecipe: [
        {
          id: 'step_goto_wiki',
          type: 'navigate',
          url: 'https://en.wikipedia.org/wiki/Special:Search?search=',
          dynamicParam: 'topic',
          description: 'Navigate to Wikipedia Search query',
        },
        {
          id: 'step_extract_wiki',
          type: 'extract_text',
          selector: '#mw-content-text p',
          description: 'Extract introductory paragraphs of the Wikipedia article',
        },
      ],
      status: 'approved',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      domain: 'en.wikipedia.org',
    },
    {
      id: 'wiki_extract_infobox',
      name: 'extract_infobox_data',
      description: 'Extract structured metadata table / infobox from the current Wikipedia page.',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
      annotations: {
        readOnly: true,
        destructive: false,
        requiresConfirmation: false,
        category: 'data_extraction',
        confidenceScore: 0.95,
        sourceDomain: 'en.wikipedia.org',
        sourceUrl: 'https://en.wikipedia.org',
      },
      actionRecipe: [
        {
          id: 'step_extract_infobox',
          type: 'evaluate_js',
          value: `
            const box = document.querySelector('.infobox');
            if (!box) return { found: false, message: 'No infobox found on this page' };
            const rows = Array.from(box.querySelectorAll('tr')).map(tr => {
              const label = tr.querySelector('th')?.innerText?.trim() || '';
              const value = tr.querySelector('td')?.innerText?.trim() || '';
              return label ? { label, value } : null;
            }).filter(Boolean);
            return { found: true, title: box.querySelector('.infobox-title')?.innerText || '', data: rows };
          `,
          description: 'Parse infobox key-value rows',
        },
      ],
      status: 'approved',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      domain: 'en.wikipedia.org',
    },
  ],
  'github.com': [
    {
      id: 'github_search_repositories',
      name: 'search_github_repositories',
      description: 'Search GitHub repositories for open-source projects, tools, or libraries.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Repository search term (e.g. "webmcp" or "playwright agent")' },
        },
        required: ['query'],
      },
      annotations: {
        readOnly: true,
        destructive: false,
        requiresConfirmation: false,
        category: 'search',
        confidenceScore: 0.96,
        sourceDomain: 'github.com',
        sourceUrl: 'https://github.com',
      },
      actionRecipe: [
        {
          id: 'step_search_gh',
          type: 'navigate',
          url: 'https://github.com/search?q=',
          dynamicParam: 'query',
          description: 'Navigate to GitHub search',
        },
        {
          id: 'step_extract_gh_results',
          type: 'evaluate_js',
          value: `
            Array.from(document.querySelectorAll('[data-testid="results-list"] > div, .repo-list-item')).slice(0, 10).map(el => ({
              name: el.querySelector('a')?.innerText?.trim() || '',
              url: el.querySelector('a')?.href || '',
              description: el.querySelector('p, .mb-1')?.innerText?.trim() || '',
            }))
          `,
          description: 'Extract repository search results',
        },
      ],
      status: 'approved',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      domain: 'github.com',
    },
  ],
  'quotes.toscrape.com': [
    {
      id: 'quotes_extract_top_quotes',
      name: 'extract_quotes',
      description: 'Extract quotes, authors, and tag lists from Quotes to Scrape sandbox.',
      inputSchema: {
        type: 'object',
        properties: {
          tag: { type: 'string', description: 'Optional tag filter (e.g. "love", "inspirational", "humor")' },
        },
        required: [],
      },
      annotations: {
        readOnly: true,
        destructive: false,
        requiresConfirmation: false,
        category: 'data_extraction',
        confidenceScore: 0.98,
        sourceDomain: 'quotes.toscrape.com',
        sourceUrl: 'https://quotes.toscrape.com',
      },
      actionRecipe: [
        {
          id: 'step_nav_quotes',
          type: 'navigate',
          url: 'https://quotes.toscrape.com',
          description: 'Navigate to Quotes to Scrape',
        },
        {
          id: 'step_extract_quotes',
          type: 'evaluate_js',
          value: `
            Array.from(document.querySelectorAll('.quote')).slice(0, 10).map(q => ({
              text: q.querySelector('.text')?.innerText || '',
              author: q.querySelector('.author')?.innerText || '',
              tags: Array.from(q.querySelectorAll('.tag')).map(t => t.innerText),
            }))
          `,
          description: 'Extract quote items with author and tags',
        },
      ],
      status: 'approved',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      domain: 'quotes.toscrape.com',
    },
  ],
  'books.toscrape.com': [
    {
      id: 'books_browse_catalog',
      name: 'browse_book_catalog',
      description: 'Browse book titles, ratings, prices, and availability from Books to Scrape catalog.',
      inputSchema: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Optional category (e.g. "travel", "mystery", "classics")' },
        },
        required: [],
      },
      annotations: {
        readOnly: true,
        destructive: false,
        requiresConfirmation: false,
        category: 'data_extraction',
        confidenceScore: 0.97,
        sourceDomain: 'books.toscrape.com',
        sourceUrl: 'https://books.toscrape.com',
      },
      actionRecipe: [
        {
          id: 'step_nav_books',
          type: 'navigate',
          url: 'https://books.toscrape.com',
          description: 'Navigate to Books to Scrape',
        },
        {
          id: 'step_extract_books',
          type: 'evaluate_js',
          value: `
            Array.from(document.querySelectorAll('.product_pod')).slice(0, 12).map(pod => ({
              title: pod.querySelector('h3 a')?.getAttribute('title') || pod.querySelector('h3 a')?.innerText || '',
              price: pod.querySelector('.price_color')?.innerText || '',
              inStock: pod.querySelector('.instock.availability')?.innerText?.trim() || '',
              rating: pod.querySelector('.star-rating')?.className.replace('star-rating', '').trim() || '',
            }))
          `,
          description: 'Extract catalog book cards',
        },
      ],
      status: 'approved',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      domain: 'books.toscrape.com',
    },
    {
      id: 'books_simulate_add_to_cart',
      name: 'simulate_add_to_cart',
      description: 'Simulate adding a book item to cart with quantity confirmation.',
      inputSchema: {
        type: 'object',
        properties: {
          bookTitle: { type: 'string', description: 'Title of the book to add' },
          quantity: { type: 'number', description: 'Quantity (1-5)' },
        },
        required: ['bookTitle'],
      },
      annotations: {
        readOnly: false,
        destructive: true,
        requiresConfirmation: true,
        category: 'checkout',
        confidenceScore: 0.92,
        sourceDomain: 'books.toscrape.com',
        sourceUrl: 'https://books.toscrape.com',
      },
      actionRecipe: [
        {
          id: 'step_find_book',
          type: 'click',
          selector: '.product_pod h3 a',
          description: 'Click matching book link in catalog',
        },
        {
          id: 'step_click_add_cart',
          type: 'click',
          selector: 'button.btn-primary',
          optional: true,
          description: 'Click Add to Basket button',
        },
      ],
      status: 'approved',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      domain: 'books.toscrape.com',
    },
  ],
};

const SAMPLE_METADATA: Record<string, { name: string; url?: string; description: string }> = {
  'news.ycombinator.com': {
    name: 'Hacker News',
    description: 'Tech & startup community news feed and Algolia search',
  },
  'en.wikipedia.org': {
    name: 'Wikipedia',
    url: 'https://en.wikipedia.org/wiki/Artificial_intelligence',
    description: 'The free encyclopedia with millions of articles and infoboxes',
  },
  'github.com': {
    name: 'GitHub Search',
    url: 'https://github.com/search?q=webmcp',
    description: 'Explore open source codebases and repositories',
  },
  'quotes.toscrape.com': {
    name: 'Quotes to Scrape (Sandbox)',
    description: 'Clean sandbox testing site with pagination, quotes, and author tags',
  },
  'books.toscrape.com': {
    name: 'Books to Scrape (E-Commerce Sandbox)',
    description: 'E-commerce sandbox with catalog, book ratings, pricing, and cart simulation',
  },
};

export const SAMPLE_TARGETS = Object.keys(PREBUILT_RECIPES).map((domain) => {
  const metadata = SAMPLE_METADATA[domain];
  return {
    name: metadata?.name || domain,
    url: metadata?.url || `https://${domain}`,
    description: metadata?.description || `Registered WebMCP tools for ${domain}`,
    domain,
  };
});
