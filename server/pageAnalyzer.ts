import { Page } from 'playwright';
import { PageElementInfo, PageAnalysisResult } from '../shared/types.js';

function buildSelector(element: any): string {
  if (element.id) {
    return `#${CSS.escape(element.id)}`;
  }
  if (element.name) {
    return `${element.tagName.toLowerCase()}[name="${CSS.escape(element.name)}"]`;
  }
  return element.tagName.toLowerCase();
}

export async function analyzeCurrentPage(page: Page): Promise<PageAnalysisResult> {
  const result: PageAnalysisResult = await page.evaluate(() => {
    const interactiveElements: PageElementInfo[] = Array.from(
      document.querySelectorAll(
        'button, a, input, select, textarea, [role="button"], [role="link"], [role="searchbox"]'
      )
    )
      .slice(0, 100)
      .map((element, index) => {
        const htmlElement = element as HTMLElement & {
          disabled?: boolean;
          type?: string;
          name?: string;
          placeholder?: string;
        };

        const rect = htmlElement.getBoundingClientRect();
        const style = window.getComputedStyle(htmlElement);

        return {
          id: `elem_${index}`,
          tagName: htmlElement.tagName.toLowerCase(),
          type: (htmlElement as HTMLInputElement).type,
          name: htmlElement.getAttribute('name') || undefined,
          placeholder: (htmlElement as HTMLInputElement).placeholder || undefined,
          ariaLabel: htmlElement.getAttribute('aria-label') || undefined,
          selector: '',
          isVisible: rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden',
          isEnabled: !htmlElement.hasAttribute('disabled'),
          isInteractive: true,
        };
      });

    interactiveElements.forEach((element, index) => {
      element.selector = buildSelectorFromDom(element, index);
    });

    return {
      url: window.location.href,
      title: document.title,
      interactiveElements,
      forms: Array.from(document.forms).map((form, index) => ({
        id: form.id || `form_${index}`,
        action: form.action,
        method: form.method,
        fields: Array.from(form.elements)
          .filter((element): element is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement =>
            element instanceof HTMLInputElement ||
            element instanceof HTMLTextAreaElement ||
            element instanceof HTMLSelectElement
          )
          .map((element) => ({
            name: element.name,
            type: element instanceof HTMLSelectElement ? 'select' : (element as HTMLInputElement).type || element.tagName.toLowerCase(),
            required: element.hasAttribute('required'),
          })),
      })),
    } as PageAnalysisResult;
  });

  return result;
}

function buildSelectorFromDom(element: PageElementInfo, index: number): string {
  if (element.tagName === 'a' || element.tagName === 'button') {
    return `${element.tagName.toLowerCase()}:nth-of-type(${index + 1})`;
  }
  return element.tagName.toLowerCase();
}
